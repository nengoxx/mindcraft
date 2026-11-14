import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../../library/skills.js';
import * as world from '../../library/world.js';
import { findAllBlocks } from '../commands.js';
import { digCell, isCleared, occupant } from '../dig.js';
import { ledgerFor } from '../ledger.js';
import { isEmptyBlock, isProtectedForBot, posKey } from '../protect.js';
import { resolveObtain } from '../resolve.js';
import { clearStatement, clearReport, leftoversQuestion } from '../report.js';
import obtain from './obtain.js';

// clear{box | markers, shell}: empty a box of everything the bot may remove,
// top-down, with no model call per cell, and report what is left and why
// (SPEC §11.9, REQ-CLR-1 … 9). Progress comes from rescans, never counters.

export const DIGS_PER_UNIT = 16;   // constants, not keys (SPEC §14)
export const HARD_FAILURES = 2;
const SETTLE_MS = 1000;            // the wait before the settled second scan
const WAIT_MS = 1000;              // after a unit that dug nothing
const EXCLUDED = 100;              // exclusionAreas weight the pathfinder treats as impossible to break

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const span = (a, b) => ({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), z1: Math.min(a.z, b.z), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), z2: Math.max(a.z, b.z) });
export const cellCount = b => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1);
const within = (b, p) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2 && p.z >= b.z1 && p.z <= b.z2;
const INTEGER = /^-?\d+$/;

// `x1,y1,z1:x2,y2,z2` -> a normalized box, or null.
export function parseBox(value) {
    const corners = String(value).split(':');
    if (corners.length !== 2) return null;
    const points = corners.map(c => c.split(','));
    if (points.some(p => p.length !== 3 || !p.every(v => INTEGER.test(v)))) return null;
    const [a, b] = points.map(([x, y, z]) => ({ x: Number(x), y: Number(y), z: Number(z) }));
    return span(a, b);
}

function* cells(box) {
    for (let y = box.y2; y >= box.y1; y--)
        for (let x = box.x1; x <= box.x2; x++)
            for (let z = box.z1; z <= box.z2; z++) yield new Vec3(x, y, z);
}

function distanceTo(box, p) {
    const d = (v, lo, hi) => Math.max(lo - v, 0, v - hi);
    return Math.hypot(d(p.x, box.x1, box.x2), d(p.y, box.y1, box.y2), d(p.z, box.z1, box.z2));
}

// REQ-CLR-2: the markers mark the corners of one box: each marker's x, y and z
// each equal a minimum or a maximum of their bounding box; at least 4 of them,
// spanning three axes.
function markedBox(positions, name, radius, notLoaded) {
    const k = positions.length;
    const note = notLoaded ? ' (part of the range is not loaded)' : '';
    if (!k) return { error: `no ${name} within ${radius} blocks to mark the box (name the marker block, or give the box as x1,y1,z1:x2,y2,z2)${note}` };
    const bounds = positions.reduce((b, p) => b ? span({ x: Math.min(b.x1, p.x), y: Math.min(b.y1, p.y), z: Math.min(b.z1, p.z) }, { x: Math.max(b.x2, p.x), y: Math.max(b.y2, p.y), z: Math.max(b.z2, p.z) }) : span(p, p), null);
    if (k < 4 || bounds.x1 === bounds.x2 || bounds.y1 === bounds.y2 || bounds.z1 === bounds.z2)
        return { error: `found ${k} ${name} within ${radius} blocks; a marked box needs at least 4, on three axes; give the box as x1,y1,z1:x2,y2,z2${note}` };
    const off = positions.find(p => ![bounds.x1, bounds.x2].includes(p.x) || ![bounds.y1, bounds.y2].includes(p.y) || ![bounds.z1, bounds.z2].includes(p.z));
    if (off) return { error: `${k} ${name} within ${radius} blocks do not mark the corners of one box (${off.x},${off.y},${off.z} is not a corner); give the box as x1,y1,z1:x2,y2,z2${note}` };
    return { bounds };
}

// The active clear step's scope for the Protector (REQ-CLR-5), read from the
// frozen args; the grants live in its progress (REQ-CLR-9).
const scopes = new WeakMap();
export function clearScope(step, config) {
    let scope = scopes.get(step);
    if (!scope) {
        const { box, bounds, shell } = step.args;
        scope = {
            inBox: pos => within(box, pos),
            inShell: shell === 'keep' ? pos => within(bounds, pos) && !within(box, pos) : () => false,
            containers: new Set(config.clear.containers),
            neverRemove: new Set(config.clear.never_remove),
            granted: (pos, name) => step.progress?.granted?.[posKey(pos)] === name,
        };
        scopes.set(step, scope);
    }
    return scope;
}

// The clear step's own movements: nothing outside the box is broken (the
// approach is non-destructive there) and nothing is placed in the kept layer
// (REQ-CLR-5, 6). Placement is filtered by each generated move's actual
// destination (reference + face): exclusionAreasPlace is handed the feet cell
// for a forward bridge that places one cell below it (movements.js:412-413).
export function clearMovements(scope) {
    return m => {
        m.exclusionAreasBreak.push(block => !scope.inBox(block.position) ? EXCLUDED : 0);
        const neighbors = m.getNeighbors;
        m.getNeighbors = function (node) {
            return neighbors.call(this, node).filter(move => !move.toPlace.some(p => !p.useOne
                && scope.inShell({ x: p.x + p.dx, y: p.y + p.dy, z: p.z + p.dz })));
        };
    };
}

// The box is in the task's anchor dimension; elsewhere the same coordinates
// are another place, so nothing there is scanned, granted or dug.
function elsewhere(ctx) {
    const dim = ctx.anchor?.dim;
    return Boolean(dim) && (ctx.bot.game?.dimension ?? 'overworld') !== dim;
}

// One rescan of the box: what is empty, what may be dug, and what stays and why.
function scan(ctx, step) {
    const { bot } = ctx;
    const p = step.progress ?? {};
    const scope = clearScope(step, ctx.config);
    const ledger = ledgerFor(bot);
    const s = { empty: 0, unloaded: 0, candidates: [], leftovers: [], containers: [], kept: [] };
    for (const pos of cells(step.args.box)) {
        const block = bot.blockAt(pos);
        if (!block) { s.unloaded++; continue; }
        if (isCleared(block)) { s.empty++; continue; }
        const name = block.name;
        const cell = { x: pos.x, y: pos.y, z: pos.z, block: name };
        if (scope.neverRemove.has(name)) { s.kept.push({ ...cell, why: `${name} (never removed)` }); continue; }
        // A completed build's block (a furnished build's chest included) is
        // never asked about or granted (REQ-OWN-2).
        const entry = ledger?.get(pos);
        if (entry?.kind === 'building' && entry.block === name && isProtectedForBot(bot, block)) { s.kept.push({ ...cell, why: 'part of my build' }); continue; }
        if (scope.containers.has(name) && !scope.granted(pos, name)) { s.containers.push(cell); continue; }
        const failure = p.failures?.[posKey(pos)];
        if (failure?.n >= HARD_FAILURES) { s.kept.push({ ...cell, why: failure.reason }); continue; }
        if (isProtectedForBot(bot, block)) {
            // An unrecorded non-natural block goes to the leftovers question; a
            // recorded one here is part of a build the bot made (REQ-OWN-2).
            if (ledger?.get(pos)) s.kept.push({ ...cell, why: 'part of my build' });
            else s.leftovers.push(cell);
            continue;
        }
        s.candidates.push(pos);
    }
    return s;
}

function toolStep(step) {
    const t = step.progress.tool;
    return { skill: 'obtain', args: { item: t.item, count: 1 }, progress: t.progress };
}

// REQ-CLR-7: the next cell is in the highest layer left, nearest first; cells
// under the bot come last in their layer.
function nextCell(bot, candidates, tried) {
    const left = candidates.filter(c => !tried.has(posKey(c)));
    if (!left.length) return { cell: null };
    const top = Math.max(...left.map(c => c.y));
    const layer = left.filter(c => c.y === top);
    const free = layer.filter(c => occupant(bot, c) !== 'me');
    if (!free.length) return { cell: null, underMe: layer };
    const here = bot.entity.position;
    free.sort((a, b) => a.offset(0.5, 0.5, 0.5).distanceTo(here) - b.offset(0.5, 0.5, 0.5).distanceTo(here));
    return { cell: free[0] };
}

// A cleared cell of the box to stand in: empty at feet and head (I1-4: the
// shared test, so a cave's cave_air counts), a solid block below that is not a
// cell still to dig.
function standCell(ctx, step, avoid) {
    const { bot } = ctx;
    const here = bot.entity.position;
    let best = null;
    for (const pos of cells(step.args.box)) {
        const feet = bot.blockAt(pos);
        const head = bot.blockAt(pos.offset(0, 1, 0));
        const below = bot.blockAt(pos.offset(0, -1, 0));
        if (!isEmptyBlock(feet) || !isEmptyBlock(head) || below?.boundingBox !== 'block') continue;
        if (avoid.some(c => c.equals(below.position))) continue;
        const d = pos.distanceTo(here);
        if (!best || d < best.d) best = { pos, d };
    }
    return best?.pos ?? null;
}

function fail(step, pos, reason) {
    const p = step.progress;
    const key = posKey(pos);
    const n = (p.failures[key]?.n ?? 0) + 1;
    p.failures[key] = { n, reason };
}

export default {
    keys: {
        box: { type: 'box' },
        markers: { type: 'block' },
        shell: { type: 'shell' },
    },
    needsFreeSlots: 'drop-only',   // REQ-CLR-8: junk is dropped, a full inventory never blocks a dig
    settleMs: SETTLE_MS,
    waitMs: WAIT_MS,

    // REQ-CLR-1 … 3, REQ-PLAN-4: complete and freeze args.box (the cells to
    // clear), bounds, shell, markers and cells. The marker search is centred on
    // the frozen anchor (REQ-PLAN-8).
    validate(ctx, args) {
        const { bot, config, anchor } = ctx;
        const limits = config.clear;
        if (args.box && args.markers) return ['give box=… or markers=…, not both'];
        if (!args.box && !args.markers) return ["missing key 'box' or 'markers'"];
        let box, bounds, shell = null;
        if (args.box) {
            if (args.shell) return ['shell= goes with markers=, not box= (a box= box is exactly its cells)'];
            box = bounds = args.box;
        } else {
            shell = args.shell ?? 'keep';
            const center = new Vec3(anchor.x, anchor.y, anchor.z);
            const { positions, unloaded } = findAllBlocks(bot, args.markers, limits.marker_radius, center);
            const marked = markedBox(positions, args.markers, limits.marker_radius, unloaded);
            if (marked.error) return [marked.error];
            bounds = marked.bounds;
            if (shell === 'keep') {
                box = { x1: bounds.x1 + 1, y1: bounds.y1 + 1, z1: bounds.z1 + 1, x2: bounds.x2 - 1, y2: bounds.y2 - 1, z2: bounds.z2 - 1 };
                if (box.x1 > box.x2 || box.y1 > box.y2 || box.z1 > box.z2)
                    return [`the marked box has no inside (${bounds.x2 - bounds.x1 + 1}×${bounds.y2 - bounds.y1 + 1}×${bounds.z2 - bounds.z1 + 1}); use shell=clear`];
            } else {
                box = bounds;
            }
        }
        const errors = [];
        const count = cellCount(box);
        if (count > limits.max_cells) errors.push(`the box has ${count} cells; at most ${limits.max_cells}`);
        const away = distanceTo(box, anchor);
        if (away > limits.max_distance) errors.push(`the box is ${Math.round(away)} blocks away; at most ${limits.max_distance}`);
        if (errors.length) return errors;
        Object.assign(args, { box, bounds, shell, markers: args.markers ?? null, cells: count });
        return [];
    },

    // The !taskStart confirmation (REQ-CLR-4).
    describe(args) {
        return clearStatement(args);
    },

    // metric = the empty cells (air or liquid) of the box, from a rescan.
    measure(ctx, step) {
        // In another dimension the last measure stands (no false progress there).
        if (elsewhere(ctx)) return { now: step.progress?.now ?? 0, target: step.args.cells, score: step.progress?.best ?? 0 };
        let empty = 0;
        for (const pos of cells(step.args.box)) if (isCleared(ctx.bot.blockAt(pos))) empty++;
        return { now: empty, target: step.args.cells, score: empty };
    },

    neededItems(ctx, step) {
        return step.progress?.tool ? obtain.neededItems(ctx, toolStep(step)) : new Set();
    },

    async unit(ctx, step) {
        const { bot } = ctx;
        const p = step.progress;
        p.failures ??= {};
        // REQ-CLR-4: a box= box (the model may have written the coordinates)
        // waits for the owner's yes before any dig.
        if (!step.args.markers && !p.started)
            return { ask: { kind: 'clear_start', text: `${clearStatement(step.args)} Clear it? yes / no`, options: ['yes', 'no'] } };
        // In another dimension the step waits, with no model call (the
        // stall rule bounds it), and goes on once back in the anchor's.
        const away = () => ({ wait: `the box is in ${ctx.anchor.dim}; I am in ${bot.game?.dimension ?? 'overworld'}` });
        if (elsewhere(ctx)) return away();
        // REQ-CLR-7: a tool obtained through an inline obtain sub-progress.
        if (p.tool) {
            if ((world.getInventoryCounts(bot)[p.tool.item] || 0) >= 1) { p.tool = null; return {}; }
            const result = await obtain.unit(ctx, toolStep(step));
            if (result.done) p.tool = null;
            if (result.blocked) return { blocked: `needs a ${p.tool.item} to dig ${p.tool.for}: ${result.blocked}` };
            return result.failed ? { failed: result.failed } : {};
        }
        let s = scan(ctx, step);
        if (!s.candidates.length) {
            // REQ-CLR-8: done only when a settled second scan agrees.
            await sleep(this.settleMs);
            if (bot.interrupt_code) return {};
            if (elsewhere(ctx)) return away();
            s = scan(ctx, step);
            if (!s.candidates.length) return this.finish(step, s);
        }
        const scope = clearScope(step, ctx.config);
        const configure = clearMovements(scope);
        const tried = new Set();
        let digs = 0;
        let moved = false;
        while (digs < DIGS_PER_UNIT && !bot.interrupt_code) {
            const { cell, underMe } = nextCell(bot, s.candidates, tried);
            if (!cell) {
                if (!underMe) break;
                // REQ-CLR-7: only cells under the bot are left in this layer:
                // move to a cleared cell first (once per unit). With none yet
                // they wait for a later unit (a soft refusal, never counted:
                // lower layers dug meanwhile give it a cell to stand in).
                const stand = moved ? null : standCell(ctx, step, s.candidates);
                if (!stand) {
                    // I1-4: the cause the stall rule's block reports.
                    p.last_cause = moved ? 'could not step off the cells under me'
                        : 'only cells under me are left and no cleared cell of the box to stand in';
                    for (const c of underMe) tried.add(posKey(c));
                    continue;
                }
                moved = true;
                await ctx.call('clear: step off', () => skills.goToGoal(bot, new pf.goals.GoalBlock(stand.x, stand.y, stand.z), configure).catch(() => {}));
                if (bot.interrupt_code) return {};
                if (elsewhere(ctx)) return away();
                continue;
            }
            tried.add(posKey(cell));
            const block = bot.blockAt(cell);
            if (!block || isCleared(block)) continue;
            const container = scope.containers.has(block.name) && scope.granted(cell, block.name);
            const result = await ctx.call(`clear ${block.name}`, () => digCell(bot, block, { move: true, obtain: true, hand: false, configure, container, dim: ctx.anchor?.dim }));
            if (bot.interrupt_code) return {};
            if (elsewhere(ctx)) return away();
            if (result.ok) { digs++; continue; }
            if (result.reason === 'needs a tool') {
                const tool = result.tools.find(t => !resolveObtain(bot, t, 1, { static: true }).error);
                if (tool) {
                    p.tool = { item: tool, for: block.name, progress: { choices: {} } };
                    return {};
                }
            }
            if (!result.soft) fail(step, cell, result.reason);
        }
        // A unit that dug nothing (a player stands on the last cells) yields
        // before the next rescan instead of spinning; the stall rule bounds it.
        if (!digs && !bot.interrupt_code) await sleep(this.waitMs);
        return {};
    },

    // The step ends: one owner question when unrecorded non-natural cells or
    // containers are left (REQ-CLR-9), else the report from the final scan.
    finish(step, s) {
        const p = step.progress;
        if (!p.asked && (s.leftovers.length || s.containers.length)) {
            p.asked = true;
            const options = s.containers.length ? ['yes', 'yes, chests too', 'no'] : ['yes', 'no'];
            return { ask: { kind: 'clear_leftovers', text: leftoversQuestion(step.args, s), options,
                extra: { cells: s.leftovers, containers: s.containers } } };
        }
        p.report = clearReport(step.args, s, { declined: Boolean(p.declined) });
        return { done: true };
    },

    // The owner's answer (REQ-CLR-4, 9). A yes grants exactly the listed
    // positions, each only while its block still matches (clearScope.granted);
    // containers only on "yes, chests too". A grant resets the failure counts
    // of the granted positions.
    answer(ctx, step, question, answer) {
        const p = step.progress;
        if (question.kind === 'clear_start') {
            if (answer !== 'yes') return { cancel: 'owner_declined' };
            p.started = true;
            return {};
        }
        if (answer === 'no') { p.declined = true; return {}; }
        const grant = [...question.cells, ...(answer === 'yes, chests too' ? question.containers : [])];
        p.granted ??= {};
        p.failures ??= {};
        for (const c of grant) {
            const key = posKey(c);
            p.granted[key] = c.block;
            delete p.failures[key];
        }
        return {};
    },
};
