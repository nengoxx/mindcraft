import { readFileSync } from 'fs';
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import { WORK_DEFAULTS } from './config.js';

// Protection (SPEC §13): one predicate for paths, collection and (from S3)
// building, applied through Movements.prototype.safeToBreak (REQ-SAFE-3).

const natural = JSON.parse(readFileSync(new URL('./data/natural_blocks.json', import.meta.url), 'utf8'));
const NATURAL_NAMES = new Set(natural.names);
const NATURAL_SUFFIXES = natural.suffixes;
const TREE_MAX_LOGS = 40;        // REQ-SAFE-4: the upward search bound
const TREE_COMPONENT_MAX = 64;   // REQ-SAFE-4: the component cap (dark oaks reach about 50)
// REQ-OWN-4, the component guard: a component of old scaffold larger than this
// is lapsed (measured: an uncached 40-block component added 18 ms per A*
// search, 160 blocks 110 ms). A constant, not a key.
const SCAFFOLD_COMPONENT_MAX = 64;
const GUARD_MEMO_MS = 50;        // a guard verdict holds until a block or entry change, or one game tick

// I1-4 (DECISIONS 2026-11-14): the work layer's one empty-block test (air,
// cave air, void air), shared by climb, sleep, protect, ledger, dig, tidy and
// the clear step; a cave's cave_air is as empty as air.
export const EMPTY_BLOCKS = Object.freeze(['air', 'cave_air', 'void_air']);
export const isEmptyBlock = block => Boolean(block) && EMPTY_BLOCKS.includes(block.name);
const EMPTY_OR_LIQUID = [...EMPTY_BLOCKS, 'water', 'lava', 'bubble_column'];

export function isLogName(name) {
    return name.endsWith('_log') && !name.startsWith('stripped_');
}

function isLeavesName(name) {
    return name.endsWith('_leaves');
}

// By name only: logs and leaves count here; the block-level tests below decide.
export function isNaturalBlockName(name) {
    return NATURAL_NAMES.has(name) || NATURAL_SUFFIXES.some(suffix => name.endsWith(suffix))
        || isLogName(name) || isLeavesName(name);
}

export function posKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function naturalLeaves(block) {
    return block && isLeavesName(block.name) && block.getProperties?.().persistent === false;
}

const OPEN = [...EMPTY_BLOCKS, 'water'];
// Blocks world generation puts against a natural trunk besides terrain and
// leaves, including the farmed plants left off the natural list (REQ-SAFE-1):
// accepted beside a tree, never collectable themselves.
const BESIDE_TRUNKS = ['cocoa', 'bee_nest', 'beehive', 'creaking_heart',
    'sugar_cane', 'bamboo', 'bamboo_sapling', 'cactus', 'cactus_flower', 'sweet_berry_bush', 'kelp', 'kelp_plant', 'melon', 'pumpkin'];
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// One step up a trunk: straight first, then the eight diagonals (bent acacia
// trunks, branches).
const UP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// The protection predicate for one bot. `ledger` is the placements ledger
// (ledger.js: get, retire and the !buildStructure run in progress); `scope()`
// returns the active clear step's box scope or null (REQ-CLR-5; steps/clear.js);
// `config()` the work settings (the container list, the collect radius).
export class Protector {
    constructor(bot, { ledger = null, scope = () => null, config = () => WORK_DEFAULTS } = {}) {
        this.bot = bot;
        this.ledger = ledger;
        this.scope = scope;
        this.config = config;
        this.treeMemo = null;
        this.componentMemo = null;
        this.running = false;
        this.guardMemo = null;   // {generation, at, verdicts}: the component guard's verdicts (REQ-OWN-4)
        this.grant = null;       // REQ-SAFE-13: {cells: [{x, y, z, name, dim}]} while a granted action runs (withGrant)
    }

    // The tree test is memoized per position inside a run only (REQ-SAFE-3),
    // because the pathfinder asks about the same blocks many times; outside a
    // run every answer is computed fresh.
    newRun() {
        this.treeMemo = new Map();
        this.componentMemo = new Map();
        this.running = true;
    }

    endRun() {
        this.treeMemo = null;
        this.componentMemo = null;
        this.running = false;
    }

    isProtected(block) {
        if (!block?.name || !block.position) return false;
        const name = block.name;
        // REQ-CLR-5: while a clear step is current, its kept outer layer is
        // protected for every caller; inside its box the spawner never goes,
        // a container only on the owner's explicit grant, and a granted
        // position is exempt while its block still matches (REQ-CLR-9).
        const scope = this.scope();
        if (scope?.inShell(block.position)) return true;
        const inBox = Boolean(scope?.inBox(block.position));
        // REQ-SAFE-2, REQ-OWN-2: the bot's own placement, by kind, while the
        // recorded block is still the one there; a different block retires it.
        const entry = this.ledger?.get(block.position);
        const recorded = entry?.block === name ? entry : null;
        if (entry && !recorded) this.ledger.retire(block.position, `now ${name}`);
        if (inBox) {
            if (scope.neverRemove.has(name)) return true;
            // A completed build's block stays before any grant or container
            // rule: a box exempts only scaffold and own entries.
            if (recorded?.kind === 'building' && !this.exempt(recorded, true)) return true;
            if (scope.granted(block.position, name)) return false;
            if (scope.containers.has(name)) return true;
        }
        // REQ-OWN-2: the bed the sleep routine placed is exempt only for its
        // own pickup dig, scoped to that exact live entry (withOwnBed).
        if (recorded && recorded === this.ownBed) return false;
        // REQ-OWN-4: a lapsed old scaffold entry falls through to the default
        // predicate, as an unrecorded block (its record is kept).
        if (recorded && !this.lapsed(recorded, inBox)) return !this.exempt(recorded, inBox);
        // REQ-SAFE-13 (DECISIONS 2026-11-13, "only if I ask"): the owner's
        // grant, checked after the clear scope and her own records, so a kept
        // layer, her records and a box's containers stay protected; the exact
        // cell, while it still holds the granted block.
        if (this.granted(block)) return false;
        if (isLeavesName(name)) return !naturalLeaves(block);
        if (isLogName(name)) return !this.isNaturalTree(block);
        // A task-layer harvesting policy, not owner property: inside a task run
        // I1 collects only ores with an open face (air or water); buried ores
        // are tunnelled to only from I5. Outside runs ores are natural, and a
        // clear step digs buried ores inside its box (REQ-SAFE-1, REQ-CLR-5).
        if (name.endsWith('_ore')) return this.running && !inBox ? !this.isExposed(block) : false;
        return !isNaturalBlockName(name);
    }

    // REQ-OWN-2, REQ-SLP-6: the sleep routine's bed (an `own` entry by
    // mode:sleeping, still live) is exempt while `fn` runs, synchronously, for
    // every protection check inside it (the dig seam's and the patched
    // safeToBreak's); any other entry, or none, changes nothing.
    withOwnBed(entry, fn) {
        const mine = entry?.kind === 'own' && entry.by === 'mode:sleeping' && this.ledger?.get(entry.pos) === entry;
        if (!mine) return fn();
        const before = this.ownBed;
        this.ownBed = entry;
        try {
            return fn();
        } finally {
            this.ownBed = before;
        }
    }

    // --- the owner's grant (REQ-SAFE-13) ---------------------------------------

    // Only the granted cell being dug now (focusGrant) is exempt, so the
    // pathfinder never digs another granted cell on the way (rulings r1 S4).
    granted(block) {
        const c = this.grant?.current;
        if (!c) return false;
        const dim = this.bot.game?.dimension ?? 'overworld';
        const { x, y, z } = block.position.floored ? block.position.floored() : block.position;
        return c.x === x && c.y === y && c.z === z && c.name === block.name && c.dim === dim;
    }

    // The collect names the cell it digs now; a cell outside the frozen list, or none, lifts nothing.
    focusGrant(cell) {
        if (!this.grant) return;
        this.grant.current = cell && this.grant.cells.includes(cell) ? cell : null;
    }

    // A cell the owner may grant: protected by the default predicate only.
    // Never a clear scope cell, a record of hers (lapsed or not), a container,
    // bed or spawner by name, nor an ore (protected only by a run's harvest
    // policy: natural, not his).
    grantable(block) {
        if (!block?.name || !block.position) return false;
        const name = block.name;
        const scope = this.scope();
        if (scope?.inShell(block.position) || scope?.inBox(block.position)) return false;
        if (this.ledger?.get(block.position)?.block === name) return false;
        const { containers, never_remove } = this.config().clear;
        if (containers.includes(name) || never_remove.includes(name) || name.endsWith('_bed') || name.endsWith('_ore')) return false;
        return this.isProtected(block);
    }

    // The grant lives only while `fn` runs: Work sets it inside the granted
    // action's own function, after any older action has stopped, so nothing
    // else ever sees it; it ends with the action (or on !stop).
    async withGrant(cells, fn) {
        this.grant = { cells, current: null };
        try {
            return await fn();
        } finally {
            this.grant = null;
        }
    }

    // --- the component guard (REQ-OWN-4) ---------------------------------------

    // A scaffold entry that lived through a gap (`gap_at`: a restart, an
    // unload) is the bot's inside an active clear box, and outside one only
    // while its component stands free; otherwise it is lapsed.
    lapsed(entry, inBox) {
        return entry.kind === 'scaffold' && entry.gap_at != null && !inBox && !this.standsFree(entry);
    }

    // The same verdict for the tidy helpers (ledger.scaffoldEligible's `gap`).
    gapHers(entry) {
        return Boolean(this.scope()?.inBox(entry.pos)) || this.standsFree(entry);
    }

    // A component of old scaffold (face-connected live `scaffold` entries with
    // `gap_at`, block still matching) stands free when every face neighbour of
    // every member is loaded and is empty or liquid, a member, her live
    // matching same-session scaffold (no `gap_at`), or natural by the default
    // predicate's own tests (logs and leaves only through the tree and canopy
    // tests, never by name: a log build around her pillar lapses it). An
    // `own`, `building` or `station` neighbour lapses it, whatever its
    // material (kept dirt is not terrain, S4): `own` holds owner-kept
    // scaffold (fix wave 1, D3: the safe
    // direction against design §8b's "any non-scaffold entry"). More than
    // SCAFFOLD_COMPONENT_MAX members: lapsed. The verdict, and the tree and
    // canopy answers behind it (never the run's memos, S1), are memoized per
    // component until the ledger's next block or entry change, or one game tick.
    standsFree(entry) {
        const ledger = this.ledger;
        const now = Date.now();
        if (!this.guardMemo || this.guardMemo.generation !== ledger.generation || now - this.guardMemo.at >= GUARD_MEMO_MS)
            this.guardMemo = { generation: ledger.generation, at: now, verdicts: new Map(), tree: new Map(), component: new Map() };
        const memo = this.guardMemo.verdicts;
        const start = new Vec3(entry.pos.x, entry.pos.y, entry.pos.z);
        const startKey = posKey(start);
        if (memo.has(startKey)) return memo.get(startKey);
        const recordedAt = (pos, block) => {
            const e = ledger.get(pos);
            return e && e.block === block.name ? e : null;
        };
        const members = new Map([[startKey, start]]);
        let free = true;
        for (let i = 0, queue = [start]; i < queue.length && free; i++) {
            for (const [dx, dy, dz] of FACES) {
                const next = queue[i].offset(dx, dy, dz);
                const key = posKey(next);
                if (members.has(key)) continue;
                const block = this.bot.blockAt(next);
                if (!block) { free = false; break; }   // not loaded: unknown
                const other = recordedAt(next, block);
                if (other?.kind === 'scaffold' && other.gap_at != null) {
                    if (members.size >= SCAFFOLD_COMPONENT_MAX) { free = false; break; }
                    members.set(key, next);
                    queue.push(next);
                    continue;
                }
                // A matching own, building or station entry lapses it whatever
                // its material: kept dirt or stone is not terrain (S4).
                if (other) {
                    if (other.kind === 'scaffold') continue;
                    free = false;
                    break;
                }
                if (EMPTY_OR_LIQUID.includes(block.name) || this.isNatural(block, this.guardMemo)) continue;
                free = false;
                break;
            }
        }
        // Every member found belongs to the one component, so the verdict is theirs.
        for (const key of members.keys()) memo.set(key, free);
        return free;
    }

    // Natural by the default predicate's own tests (an ore by its name), with
    // the guard's own tree memos.
    isNatural(block, memos) {
        const name = block.name;
        if (isLeavesName(name)) return naturalLeaves(block);
        if (isLogName(name)) return this.isNaturalTree(block, memos);
        return isNaturalBlockName(name);
    }

    // REQ-OWN-2, the kinds stated once: `station` and live `scaffold` are exempt
    // everywhere; `own` (code, commands, task-time placements, owner-kept
    // scaffold) is protected outside an active clear box whatever its
    // material, exempt inside one; `building` is exempt only while its build
    // runs (a !buildStructure build ends when that action returns).
    exempt(entry, inBox) {
        switch (entry.kind) {
            case 'station':
            case 'scaffold': return true;
            case 'own': return inBox;
            case 'building': return entry.build_id != null && entry.build_id === this.ledger.building;
            default: return false;
        }
    }

    isExposed(block) {
        return FACES.some(([dx, dy, dz]) => OPEN.includes(this.bot.blockAt(block.position.offset(dx, dy, dz))?.name));
    }

    // REQ-SAFE-4: a log is a natural tree when (1) a path of same-type logs
    // going up (one block up per step, straight or diagonal, at most
    // TREE_MAX_LOGS logs) reaches a log with non-persistent leaves directly
    // above it: a trunk ends under its canopy; and (2) its component, the
    // 26-connected same-type logs containing it, is a bare tree: at most
    // TREE_COMPONENT_MAX logs, none touching a block world generation would not
    // put there (besideTree; a log of another type counts as foreign). An all-log cabin has no such path, even where a tree's
    // leaves touch its side; a log build under a canopy touches its planks,
    // door, glass or torches. There is no ground condition: a felled trunk
    // stays a tree.
    // `memos` ({tree, component}): the caller's memos instead of the run's
    // (the component guard keeps its own, invalidated with its verdicts).
    isNaturalTree(block, { tree = this.treeMemo, component = this.componentMemo } = {}) {
        const memo = tree ?? new Map();
        const budget = { left: TREE_MAX_LOGS, exhausted: false };
        const start = block.position.floored ? block.position.floored() : new Vec3(block.position.x, block.position.y, block.position.z);
        return this.reachesCanopy(start, block.name, memo, budget) && this.isBareTree(start, block.name, component);
    }

    isBareTree(start, name, memo = this.componentMemo) {
        const startKey = posKey(start);
        if (memo?.has(startKey)) return memo.get(startKey);
        const logs = new Map([[startKey, start]]);
        let bare = true;
        for (let i = 0, queue = [start]; i < queue.length && bare; i++) {
            for (const next of around(queue[i])) {
                const key = posKey(next);
                if (logs.has(key)) continue;
                const neighbour = this.bot.blockAt(next);
                if (!neighbour) continue;
                if (neighbour.name === name) {
                    if (logs.size >= TREE_COMPONENT_MAX) { bare = false; break; }   // over the cap
                    logs.set(key, next);
                    queue.push(next);
                } else if (!this.besideTree(neighbour)) { bare = false; break; }
            }
        }
        // Every log found belongs to the one component, so the verdict is theirs.
        if (memo) for (const key of logs.keys()) memo.set(key, bare);
        return bare;
    }

    besideTree(block) {
        const name = block.name;
        if (this.ledger?.get(block.position)?.block === name) return true;
        if (isLogName(name)) return false; // another wood type: a mixed-wood build
        return OPEN.includes(name) || isLeavesName(name) || BESIDE_TRUNKS.includes(name) || isNaturalBlockName(name);
    }

    reachesCanopy(pos, name, memo, budget) {
        const key = posKey(pos);
        if (memo.has(key)) return memo.get(key);
        if (budget.left-- <= 0) { budget.exhausted = true; return false; }
        let found = naturalLeaves(this.bot.blockAt(pos.offset(0, 1, 0)));
        for (const [dx, dz] of UP) {
            if (found) break;
            const next = pos.offset(dx, 1, dz);
            if (this.bot.blockAt(next)?.name === name) found = this.reachesCanopy(next, name, memo, budget);
        }
        if (found || !budget.exhausted) memo.set(key, found);
        return found;
    }
}

function* around(pos) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        if (dx || dy || dz) yield pos.offset(dx, dy, dz);
}

// The predicate for one bot, for callers that dig without the pathfinder
// (placeBlock's break-in-the-way, skills.js). False when no work layer runs.
export function isProtectedForBot(bot, block) {
    const guard = guards.get(bot);
    return Boolean(guard && block && (guard.locked || guard.protector.isProtected(block)));
}

// The bot's Protector, or null when no work layer runs (the tidy sweep's guard).
export function protectorFor(bot) {
    return guards.get(bot)?.protector ?? null;
}

// --- the Movements.prototype.safeToBreak patch ---------------------------------

const guards = new WeakMap(); // bot -> {protector, taskRunning}
let original = null;

// The pathfinder's falling blocks are sand and gravel only (movements.js:64-66);
// suspicious sand and gravel fall too and lose their loot, and a clear keeps
// them as containers, so their support is not dug either.
const FALLING = ['suspicious_sand', 'suspicious_gravel'];
export function knowFallingBlocks(m) {
    if (m.workFalling) return;
    m.workFalling = true;
    for (const name of FALLING) {
        const id = m.bot.registry.blocksByName[name]?.id;
        if (id != null) m.gravityBlocks.add(id);
    }
}

// Installed once per process (REQ-SAFE-3). Because it is the prototype, it also
// covers Movements instances that never reach setMovements: collectBlock's own
// (skills.js) and the collect plugin's (CollectBlock.js:70).
export function installSafeToBreakPatch() {
    if (original) return;
    original = pf.Movements.prototype.safeToBreak;
    const base = original;
    pf.Movements.prototype.safeToBreak = function (block) {
        const guard = guards.get(this.bot);
        // I1-8 (DECISIONS 2026-11-14): with digging off the base check refuses
        // at once, so a no-dig search spends no protection test (tree tests).
        if (!guard || !this.canDig) return base.call(this, block);
        if (guard.locked) return false;
        knowFallingBlocks(this);
        if (guard.protector.isProtected(block)) return false;
        if (!guard.taskRunning()) return base.call(this, block);
        // REQ-FIND-16: both flags are read only inside safeToBreak, and
        // collectBlock / the collect plugin set them false; force them back.
        const flow = this.dontCreateFlow;
        const falling = this.dontMineUnderFallingBlock;
        this.dontCreateFlow = true;
        this.dontMineUnderFallingBlock = true;
        try {
            return base.call(this, block);
        } finally {
            this.dontCreateFlow = flow;
            this.dontMineUnderFallingBlock = falling;
        }
    };
}

export function uninstallSafeToBreakPatch() {
    if (!original) return;
    pf.Movements.prototype.safeToBreak = original;
    original = null;
}

export function guardBot(bot, protector, taskRunning) {
    guards.set(bot, { protector, taskRunning });
}

export function unguardBot(bot) {
    guards.delete(bot);
}

// I1-14 fix wave 1 (build2 r1 rulings): the task layer failed to start, so no
// Protector knows the owner's blocks; every block is protected instead (no dig,
// no break of a block in a placement's way) until a restart. protectorFor
// stays null, so the work-only callers keep their "no work layer" path.
export function lockBot(bot) {
    installSafeToBreakPatch();
    guards.set(bot, { protector: null, locked: true, taskRunning: () => false });
}

// Fix wave 2: placeBlock's replaceable targets (plants, snow) are refused under the lock.
export function isLockedBot(bot) {
    return Boolean(guards.get(bot)?.locked);
}

// --- SIGINT clean_stop (REQ-REC-7) -------------------------------------------

// MindServer's "stop agent" sends SIGINT. Write clean_stop synchronously, remove
// the handler and re-raise, so the parent still sees the signal and does not
// restart the process.
export function installCleanStop(writeCleanStop) {
    const handler = () => {
        try {
            writeCleanStop();
        } catch (err) {
            console.error('[work] could not write clean_stop:', err);
        }
        process.removeListener('SIGINT', handler);
        process.kill(process.pid, 'SIGINT');
    };
    process.on('SIGINT', handler);
    return () => process.removeListener('SIGINT', handler);
}
