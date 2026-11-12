import Vec3 from 'vec3';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { itemLine } from './report.js';

// Inventory upkeep (SPEC §9.4, REQ-OBT-11; design junk-council/recommended-
// design.md r7 §2–§6, part A). One item policy (work.inventory, merged in
// config.js), one planner (`planRemoval`: what to remove, never where, so a
// later chest destination needs no rewrite), one dropper (`dropItems`) shared
// by the task runner's free-slot check and the idle cleanup (`Upkeep`, the
// quiet action `action:items` from Work.tick), and the re-pickup guard the
// pickupNearbyItems carry reads (`isGuardedJunk`).

// Constants, not keys (SPEC §14). The look, the 2-tick wait, the ~3-block
// landing and standing still afterwards were measured live by probe P15
// (runtime/diagnostics/i1-build/s2e-review/p15-live-20261112.md); the guard
// against pickupNearbyItems and an obstacle within 3 blocks were not probed.
export const INVENTORY = {
    throwBlocks: 3,       // the facing is free this far, the look point and the drop point are this far out
    lookTicks: 2,         // after the look, before the first toss: the look packet goes out first (G1)
    stepClear: 0.5,       // a block at most this far above her feet does not block the throw (it leaves 1.32 up; P15)
    guardRadius: 3,       // pickupNearbyItems skips the dropped names this close to a drop point
    guardMs: 300000,      // for this long (an item's life)
    guardMax: 32,         // drop points kept (oldest dropped): an approximate guard
    ownerRadius: 16,      // outside a task she faces away from the owner within this
    maxReruns: 2,         // a task step re-runs its drop at most this often
    hostileRadius: 16,    // the idle cleanup needs no hostile this close ...
    hostileQuietMs: 5000, // ... for this long (never mid-fight)
    cooldownMs: 30000,    // between idle passes
    resumeGapMs: 3000,    // a pending resume blocks the idle admission this long after an action ended normally
    retryMs: 300000,      // a pass that removed nothing is not retried before this ...
    retryBlocks: 8,       // ... unless she moved this far, or her inventory or config changed
    stopHoldMs: 600000,   // an owner !stop during a pass holds the idle cleanup this long
    capPasses: 4,         // this many passes that removed something ...
    capWindowMs: 600000,  // ... within this window hold the idle cleanup ...
    capHoldMs: 600000,    // ... for this long, told once
    keptShown: 5,         // the kept items the "full of things I keep" note names
};

export const ITEMS_LABEL = 'action:items';
const FOLLOW_LABEL = 'action:followPlayer';
const LIQUIDS = ['water', 'lava', 'bubble_column'];
// The four cardinals, in the order used when nothing is preferred.
const CARDINALS = Object.freeze([[0, 1], [-1, 0], [0, -1], [1, 0]]);

const dimOf = bot => bot.game?.dimension ?? 'overworld';
const range = bot => ({ start: bot.inventory.inventoryStart ?? 9, end: bot.inventory.inventoryEnd ?? 45 });
// The selected hotbar slot's inventory slot (the main hand), or null.
const heldSlot = bot => Number.isInteger(bot.quickBarSlot) ? range(bot).end - 9 + bot.quickBarSlot : null;
const summary = removed => Object.entries(removed).map(([name, n]) => `${n} ${name}`).join(', ');
const total = removed => Object.values(removed).reduce((n, c) => n + c, 0);

// --- the policy (REQ-OBT-11, design §2) -----------------------------------------

// How many of `name` she keeps: undefined (not listed: all of it), Infinity
// ("all") or a count ("stack": the item's registry stack size).
export function keepOf(bot, policy, name) {
    const keep = policy?.items?.[name];
    if (keep === undefined || keep === 'all') return keep === 'all' ? Infinity : undefined;
    if (keep === 'stack') return bot.registry?.itemsByName?.[name]?.stackSize ?? 64;
    return keep;
}

// Automatic removal is on only for a valid policy (a bad one never widens it).
export const removalEnabled = policy => Boolean(policy?.items) && !policy.error;

// The item names checked against the connected registry (Work.init: no bot
// exists when the config loads). The first unknown name, or null.
export function unknownItemName(bot, policy) {
    const names = bot.registry?.itemsByName;
    if (!names || !policy?.items) return null;
    // Own keys only: an inherited `constructor` is no item (R1-6).
    return Object.keys(policy.items).find(name => !Object.hasOwn(names, name)) ?? null;
}

// --- the planner (design §3) ---------------------------------------------------------

// Slot operations [{slot, name, count, have, whole}]: what to remove, never
// where. Sources are the 36 main slots except the selected hotbar slot (armour
// and offhand are outside them). Never an unlisted, "all", needed or held
// item. Order: every tier-0 stack whole; then each limited item's surplus as
// whole stacks smallest first within its budget, and a remainder below a
// whole stack from the smallest stack left (it may free no slot, so it never
// counts toward minFree). `freed` and `reaches` are the simulation; the
// caller re-reads the real free slots afterwards.
export function planRemoval(bot, policy, { needed = new Set(), minFree = 0 } = {}) {
    const ops = [];
    ops.freed = 0;
    ops.reaches = bot.inventory.emptySlotCount() >= minFree;
    if (!removalEnabled(policy)) return ops;
    const { start, end } = range(bot);
    const held = heldSlot(bot);
    const totals = new Map();
    const stacks = new Map();
    for (let slot = start; slot < end; slot++) {
        const item = bot.inventory.slots[slot];
        if (!item) continue;
        totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
        if (slot === held) continue;
        if (!stacks.has(item.name)) stacks.set(item.name, []);
        stacks.get(item.name).push({ slot, count: item.count });
    }
    const limited = [];
    for (const [name, list] of stacks) {
        const keep = keepOf(bot, policy, name);
        if (keep === undefined || keep === Infinity || needed.has(name)) continue;
        if (keep === 0) for (const s of list) ops.push({ slot: s.slot, name, count: s.count, have: s.count, whole: true });
        else limited.push({ name, list, surplus: totals.get(name) - keep });
    }
    ops.freed = ops.length;
    for (const { name, list, surplus } of limited) {
        let left = surplus;
        const sorted = [...list].sort((a, b) => a.count - b.count || a.slot - b.slot);
        const taken = new Set();
        for (const s of sorted) {
            if (s.count > left) break;
            ops.push({ slot: s.slot, name, count: s.count, have: s.count, whole: false });
            taken.add(s.slot);
            left -= s.count;
            ops.freed++;
        }
        const rest = sorted.find(s => !taken.has(s.slot));
        if (left > 0 && rest) ops.push({ slot: rest.slot, name, count: left, have: rest.count, whole: false });
    }
    ops.reaches = bot.inventory.emptySlotCount() + ops.freed >= minFree;
    return ops;
}

// --- the re-pickup guard (design §3) -------------------------------------------------

// A drop point at the landing spot, with the dimension and the time; each
// name is added just before its first toss. The data lives on the bot, so the
// pickupNearbyItems carry reads it without the agent.
function recordDropPoint(bot, pos, now) {
    const guard = bot.junk_guard ?? (bot.junk_guard = { drops: [] });
    guard.drops = guard.drops.filter(d => now - d.at < INVENTORY.guardMs);
    const point = { pos: { x: pos.x, y: pos.y, z: pos.z }, dim: dimOf(bot), at: now, names: [] };
    guard.drops.push(point);
    while (guard.drops.length > INVENTORY.guardMax) guard.drops.shift();
    return point;
}

// True for an item entity of a name dropped at a drop point within 3 blocks
// of it, in its dimension, in the last 5 minutes (bot.toss returns no entity
// ids, so the guard is keyed on drop points).
export function isGuardedJunk(bot, entity, now = Date.now()) {
    const drops = bot.junk_guard?.drops;
    if (!drops?.length || entity?.name !== 'item') return false;
    const name = entity.getDroppedItem?.()?.name;
    if (!name) return false;
    const dim = dimOf(bot);
    return drops.some(d => d.dim === dim && d.names.includes(name) && now - d.at < INVENTORY.guardMs &&
        Math.hypot(entity.position.x - d.pos.x, entity.position.y - d.pos.y, entity.position.z - d.pos.z) <= INVENTORY.guardRadius);
}

// --- the dropper (design §3) ---------------------------------------------------------

// Free: not a liquid, and no collision box more than INVENTORY.stepClear above
// her feet (short grass, leaf litter and cave air are free; so is a floor lower
// than a full block, a path, farmland, soul sand, mud, a bottom slab or a
// carpet, and the grass edge beside a path: R1-7); an unloaded cell is not.
const free = (block, feetY) => Boolean(block) && !LIQUIDS.includes(block.name) && (block.boundingBox === 'empty'
    || (block.shapes?.length > 0 && block.shapes.every(s => block.position.y + s[4] <= feetY + INVENTORY.stepClear + 1e-6)));

// A cardinal free from her feet to her eyes for INVENTORY.throwBlocks blocks,
// or null. Never one toward `never` (a follow's target: R1-9); among the rest
// the first, most opposite `awayFrom`, that is toward neither `awayFrom` nor
// `avoid` (a task's owner within 16: R1-10), else the most opposite.
export function chooseFacing(bot, awayFrom = null, { avoid = null, never = null } = {}) {
    const here = bot.entity.position;
    const x0 = Math.floor(here.x), z0 = Math.floor(here.z);
    const y0 = Math.floor(here.y), y1 = Math.floor(here.y + (bot.entity.eyeHeight ?? 1.62));
    const toward = ([dx, dz], pos) => Boolean(pos) && Math.hypot(pos.x - here.x, pos.z - here.z) > 0.5
        && dx * (pos.x - here.x) + dz * (pos.z - here.z) > 0;
    // A follow's target within half a block is on top of her: no direction is away from him.
    if (never && Math.hypot(never.x - here.x, never.z - here.z) <= 0.5) return null;
    let order = CARDINALS;
    if (awayFrom) {
        const ax = here.x - awayFrom.x, az = here.z - awayFrom.z;
        if (Math.hypot(ax, az) > 0.5) order = [...CARDINALS].sort((a, b) => (b[0] * ax + b[1] * az) - (a[0] * ax + a[1] * az));
    }
    const clear = ([dx, dz]) => {
        for (let i = 1; i <= INVENTORY.throwBlocks; i++)
            for (let y = y0; y <= y1; y++) if (!free(bot.blockAt(new Vec3(x0 + dx * i, y, z0 + dz * i)), here.y)) return false;
        return true;
    };
    const open = order.filter(d => !toward(d, never) && clear(d));
    const pick = open.find(d => !toward(d, awayFrom) && !toward(d, avoid)) ?? open[0];
    return pick ? { dx: pick[0], dz: pick[1] } : null;
}

// The owner's position when he is within INVENTORY.ownerRadius, else null.
export function ownerNear(bot, owner) {
    const entity = owner ? bot.players?.[owner]?.entity : null;
    return entity && entity.position.distanceTo(bot.entity.position) <= INVENTORY.ownerRadius ? entity.position : null;
}

// The slot still holds what the operation planned (design §3, F-N8): a tier-0
// stack the same item with at least the planned count (a contact pickup may
// have merged into it), any other the same item with the planned count; and
// it is not the live selected hotbar slot (R1-3: the server may select it).
function stillThere(bot, op, item) {
    if (!item || item.name !== op.name || op.slot === heldSlot(bot)) return false;
    return op.whole ? item.count >= op.count : item.count === op.have;
}

// Why no slot may be clicked now, or null: an item on the cursor (a one-slot
// transfer swaps it in and tosses it as a leftover: R1-1), or a container
// window open (the click would act on it: R1-2).
function busy(bot) {
    if (bot.inventory.selectedItem) return 'an item on the cursor';
    if (bot.currentWindow && bot.currentWindow !== bot.inventory) return 'a container is open';
    return null;
}

// Removes the plan's slot operations where she stands: faces a free cardinal
// (away from `awayFrom`), looks level at a point 3 blocks out at eye height,
// waits 2 ticks (a forced look sends no packet of its own, so a toss could
// otherwise fly the way she was looking: G1), records the drop point, then
// one slot operation per toss, re-checked before each one. `current` is the
// caller's currency, checked after the wait and between tosses. Non-throwing:
// {outcome: done | interrupted | unavailable | failed, removed: {name: count}, reason}.
export async function dropItems(bot, plan, { awayFrom = null, avoid = null, never = null, current = () => true, now = Date.now } = {}) {
    const removed = {};
    const halted = () => Boolean(bot.interrupt_code) || !current();
    const end = (outcome, reason = null) => {
        if (total(removed) && bot.modes) bot.modes.behavior_log += 'Dropped junk.\n';
        return { outcome, removed, reason };
    };
    if (!plan.length) return end('done');
    try {
        const facing = chooseFacing(bot, awayFrom, { avoid, never });
        if (!facing) return end('unavailable', 'no free direction to drop into');
        const here = bot.entity.position.clone();
        const out = INVENTORY.throwBlocks;
        await bot.lookAt(here.offset(facing.dx * out, bot.entity.eyeHeight ?? 1.62, facing.dz * out), true);
        await bot.waitForTicks(INVENTORY.lookTicks);
        if (halted()) return end('interrupted');
        const point = recordDropPoint(bot, here.offset(facing.dx * out, 0, facing.dz * out), now());
        for (const op of plan) {
            if (halted()) return end('interrupted');
            const item = bot.inventory.slots[op.slot];
            if (!stillThere(bot, op, item)) continue;   // the next pass plans again from the live inventory
            const why = busy(bot);
            if (why) return end('unavailable', why);
            const count = op.whole ? item.count : op.count;
            if (!point.names.includes(op.name)) point.names.push(op.name);
            await bot.transfer({ window: bot.inventory, itemType: item.type, metadata: null, count,
                sourceStart: op.slot, sourceEnd: op.slot + 1, destStart: -999 });
            removed[op.name] = (removed[op.name] ?? 0) + count;
        }
        return end('done');
    } catch (err) {
        if (halted()) return end('interrupted');
        return end('failed', String(err?.message ?? err));
    }
}

// The largest stacks, for a blocked step's report.
export function largestStacks(bot, k = 5) {
    return bot.inventory.items()
        .map(item => ({ name: item.name, count: item.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, k);
}

// --- the idle cleanup (design §4, §6) ------------------------------------------------

// One per Work instance (agent.work.items). Work.tick calls tick() after the
// bed reconcile and before its active-task guard; a pass runs as the quiet,
// non-resumable action:items under the maintenance latch (bed pickup > tidy >
// items), with no model call and no chat.
export class Upkeep {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        this.latch = false;          // a pass is launched or running
        this.lastPassAt = -Infinity; // the last pass's end
        this.passes = [];            // end times of passes that removed something
        this.capUntil = 0;           // the pass-cap hold
        this.stopUntil = 0;          // the owner-!stop hold
        this.idleHold = null;        // {inv, pos, dim, at}: after a pass that removed nothing
        this.lastHostileAt = -Infinity;
        this.lastIdleAt = -Infinity; // the last normal action end (the resume gap)
        this.follow = null;          // {fn, name}: the pending follow's target, seen while it ran
        this.last = null;            // {removed, at}: the last pass that removed something (!itemList)
        this.emptyKey = null;        // the inventory and task state whose plan was empty
        this.told = new Set();       // the owner lines said this session
        work.listen(this.bot, 'idle', () => { this.lastIdleAt = Date.now(); });
    }

    get config() { return this.work.config; }
    get policy() { return this.work.config.inventory; }

    log(message) {
        console.log(`[items] ${message}`);
    }

    // REQ-CHAT-1: the three owner lines are `alert`s, each once per session.
    tellOnce(what, data) {
        if (this.told.has(what)) return;
        this.told.add(what);
        this.work.postReport(itemLine(what, data), { category: 'alert' });
    }

    // Work.init: the registry check, and the owner line for a bad item list.
    check() {
        const policy = this.policy;
        const unknown = unknownItemName(this.bot, policy);
        if (unknown && !policy.error) policy.error = unknown;
        if (!policy.error) return;
        this.log(`the item list has an error (${policy.error}); automatic removal is off`);
        this.tellOnce('error', policy.error);
    }

    // An owner !stop (Work.keepOnStop): during a pass it holds the idle cleanup.
    onOwnerStop() {
        if (!this.latch) return;
        this.stopUntil = Date.now() + INVENTORY.stopHoldMs;
        this.log(`held for ${Math.round(INVENTORY.stopHoldMs / 60000)} min: the owner's !stop during a pass`);
    }

    // The follow's target while it runs (its GoalFollow entity), kept for the
    // pending follow it belongs to; else the owner.
    followTarget() {
        const actions = this.agent.actions;
        const goal = this.bot.pathfinder?.goal;
        if (actions.currentActionLabel === FOLLOW_LABEL && actions.currentActionFn === actions.resume_func && goal?.entity?.username)
            this.follow = { fn: actions.resume_func, name: goal.entity.username };
        const name = this.follow?.fn === actions.resume_func ? this.follow.name : this.work.owner();
        return name ? this.bot.players?.[name]?.entity ?? null : null;
    }

    // Removal is enabled and her free slots are low.
    wanted() {
        return removalEnabled(this.policy) && this.policy.idle === true && this.bot.inventory.emptySlotCount() < this.config.min_free_slots;
    }

    // What a pending pass re-checks besides the currency: no task running, no
    // open question, the goal stopped.
    workFree() {
        const record = this.work.record;
        return record?.status !== 'active' && !record?.pending_question && Boolean(this.agent.self_prompter?.isStopped?.());
    }

    // Why no pass may start now (null: it may). The cheap conditions first;
    // `admit` also needs the planner.
    held(now = Date.now()) {
        if (!removalEnabled(this.policy)) return `off: the item list has an error (${this.policy.error})`;
        if (this.policy.idle !== true) return 'off (work.inventory.idle)';
        if (now < this.stopUntil) return `held ${Math.ceil((this.stopUntil - now) / 60000)} min after a !stop`;
        if (now < this.capUntil) return `held ${Math.ceil((this.capUntil - now) / 60000)} min after ${INVENTORY.capPasses} passes in ${INVENTORY.capWindowMs / 60000} min`;
        if (this.idleHold && !this.released(now)) return 'waiting: nothing to drop from here';
        if (now - this.lastPassAt < INVENTORY.cooldownMs) return 'cooling down';
        return null;
    }

    // A pass that removed nothing is retried only after the inventory or her
    // position (> 8 blocks) changed, or 5 minutes. (The config changes only
    // with a restart, which starts a new Upkeep with no hold.)
    released(now) {
        const h = this.idleHold;
        const p = this.bot.entity.position;
        const moved = h.dim !== dimOf(this.bot) || Math.hypot(p.x - h.pos.x, p.y - h.pos.y, p.z - h.pos.z) > INVENTORY.retryBlocks;
        if (now - h.at < INVENTORY.retryMs && !moved && h.inv === this.signature()) return false;
        this.idleHold = null;
        return true;
    }

    signature() {
        return JSON.stringify(world.getInventoryCounts(this.bot));
    }

    // The admission (design §4): {follow, awayFrom} or null. Two admissions:
    // idle (nothing executing) and while following (the pending resumable
    // owner action action:followPlayer with its target visible, cut through
    // the launcher; the follow resumes by the existing idle resume).
    admit(now = Date.now()) {
        const { agent, bot } = this;
        const actions = agent.actions;
        if (this.latch || this.work.sleeper?.latch || this.work.sleeper?.running || this.work.tidy?.deferred) return null;
        if (!this.wanted() || this.held(now) || !this.workFree() || actions.stopPromise) return null;
        if (now - this.lastHostileAt < INVENTORY.hostileQuietMs) return null;
        const turns = this.work.liveTurns;
        const target = this.followTarget();
        let follow = false;
        if (actions.executing) {
            // Only the pending follow, its target visible; the turn that started it stays open while it runs (C-F1).
            const label = actions.currentActionLabel;
            if (label !== FOLLOW_LABEL || !actions.resume_func || label !== actions.resume_name || actions.currentActionFn !== actions.resume_func) return null;
            if (!target || this.bot.pathfinder?.goal?.entity !== target) return null;
            if (turns.size > 1 || [...turns].some(t => t.action?.fn !== actions.currentActionFn)) return null;
            follow = true;
        } else {
            if (turns.size) return null;
            // A pending resume is due within the resume gap; a follow whose target is not visible re-runs every second (F-N2).
            if (actions.resume_func && now - this.lastIdleAt < INVENTORY.resumeGapMs && !(actions.resume_name === FOLLOW_LABEL && !target)) return null;
        }
        // A bag of kept items is planned once per inventory, selected slot and
        // task state, not every second (the needed items of a paused task cost
        // world lookups); at most for the 5-minute retry (R1-4).
        const record = this.work.record;
        const key = `${this.signature()}|${bot.quickBarSlot}|${record?.id}:${record?.status}:${record?.cursor}`;
        if (this.emptyKey?.key === key && now - this.emptyKey.at < INVENTORY.retryMs) return null;
        const plan = this.plan();
        if (!plan.length) {
            this.emptyKey = { key, at: now };
            this.noteKept();
            return null;
        }
        this.emptyKey = null;
        const awayFrom = follow ? target.position : ownerNear(bot, this.work.owner());
        // No free direction (never toward a follow's target): no launch, no cut (R1-8, R1-9),
        // and the same hold as a pass that removed nothing, so it is not re-planned every second.
        if (!chooseFacing(bot, awayFrom, { never: follow ? target.position : null })) {
            const p = bot.entity.position;
            this.idleHold = { inv: this.signature(), pos: { x: p.x, y: p.y, z: p.z }, dim: dimOf(bot), at: now };
            return null;
        }
        // The turns a pass may run beside: only the one parked on the cut follow (R1-5).
        return { follow, awayFrom, turns: new Set(follow ? turns : []) };
    }

    plan() {
        return planRemoval(this.bot, this.policy, { needed: this.work.neededItems(), minFree: this.config.min_free_slots });
    }

    // The bag is low on slots and nothing in it may go: the five largest kept
    // items, totalled by name, once per session.
    noteKept() {
        const totals = world.getInventoryCounts(this.bot);
        const kept = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, INVENTORY.keptShown);
        this.tellOnce('kept', kept.map(([name, n]) => `${name} ${n}`).join(', '));
    }

    // Work.tick: samples the hostiles, then launches a pass when admitted.
    tick() {
        if (this.work.disposed) return;
        const now = Date.now();
        if (world.getNearestEntityWhere(this.bot, e => mc.isHostile(e), INVENTORY.hostileRadius)) this.lastHostileAt = now;
        if (this.latch || !this.wanted()) return;
        const admitted = this.admit(now);
        if (admitted) this.launch(admitted);
    }

    // S2d's launcher path for maintenance (Sleeper.launch): one synchronous
    // latch, the goal loop stopped non-awaited (a no-op here: the goal is
    // stopped), the launch's rejection observed, the latch released when the
    // action ends. The callback never throws: the ActionManager's catch would
    // cancel a pending resume (action_manager.js:139-143).
    launch(admitted) {
        const agent = this.agent;
        const stopEpoch = agent.stop_epoch;
        const generation = this.work.ownerGeneration;
        this.latch = true;
        if (agent.self_prompter?.isActive()) agent.self_prompter.stopLoop();
        this.log(`starting a pass${admitted.follow ? ' (cutting the follow)' : ''}`);
        let started;
        try {
            started = agent.actions.runAction(ITEMS_LABEL, async () => {
                try {
                    await this.pass(admitted, stopEpoch, generation);
                } catch (err) {
                    console.error('[items] the pass failed:', err);
                } finally {
                    this.lastPassAt = Date.now();
                }
            }, { timeout: -1 });
        } catch (err) {
            this.latch = false;
            console.error('[items] could not start a pass:', err);
            return;
        }
        Promise.resolve(started).catch(err => console.error('[items] the pass ended with an error:', err))
            .finally(() => { this.latch = false; });
    }

    // One pass. Currency (R1-8): the stop epoch and the owner-message
    // generation captured at admission, re-checked with the work conditions
    // at entry, after the tick wait and between tosses.
    async pass(admitted, stopEpoch, generation) {
        const { agent, bot } = this;
        const turns = admitted.turns ?? new Set();
        // R1-5 (r7 §4 "with the conditions above"): also no hostile within 16
        // for 5 s, and no message turn but the one parked on a cut follow.
        const calm = () => {
            if (world.getNearestEntityWhere(bot, e => mc.isHostile(e), INVENTORY.hostileRadius)) this.lastHostileAt = Date.now();
            return Date.now() - this.lastHostileAt >= INVENTORY.hostileQuietMs;
        };
        const current = () => agent.stop_epoch === stopEpoch && this.work.ownerGeneration === generation
            && this.workFree() && removalEnabled(this.policy) && this.policy.idle === true
            && [...this.work.liveTurns].every(t => turns.has(t)) && calm();
        // Idle: nothing else got in between the launch and the entry.
        if (!current() || this.work.lastStart?.label !== ITEMS_LABEL || bot.interrupt_code) {
            this.log('pass dropped before it started');
            return;
        }
        const plan = this.plan();   // from the live inventory
        if (!plan.length) return;
        let awayFrom = admitted.awayFrom;
        if (admitted.follow) awayFrom = this.followTarget()?.position ?? awayFrom;   // always away from the follow target (C-F3)
        const result = await dropItems(bot, plan, { awayFrom, never: admitted.follow ? awayFrom : null, current });
        const now = Date.now();
        const n = total(result.removed);
        this.log(`pass ${result.outcome}${result.reason ? ` (${result.reason})` : ''}: ${n ? `dropped ${summary(result.removed)}` : 'nothing dropped'}`);
        if (n) {
            this.last = { removed: result.removed, at: now };
            this.passes = this.passes.filter(t => now - t < INVENTORY.capWindowMs);
            this.passes.push(now);
            if (this.passes.length >= INVENTORY.capPasses) {
                this.capUntil = now + INVENTORY.capHoldMs;
                this.passes = [];
                this.log(`held for ${INVENTORY.capHoldMs / 60000} min: ${INVENTORY.capPasses} passes in ${INVENTORY.capWindowMs / 60000} min`);
                this.tellOnce('cap', { passes: INVENTORY.capPasses, window: INVENTORY.capWindowMs / 60000, hold: INVENTORY.capHoldMs / 60000 });
            }
        } else if (result.outcome !== 'interrupted') {
            const p = bot.entity.position;
            this.idleHold = { inv: this.signature(), pos: { x: p.x, y: p.y, z: p.z }, dim: dimOf(bot), at: now };
        }
    }

    // !itemList (design §6): the effective list by tier with what she holds,
    // her free slots, whether the idle cleanup is on or held and why, and the
    // last pass. Code-rendered.
    render(now = Date.now()) {
        const bot = this.bot;
        const policy = this.policy;
        const counts = world.getInventoryCounts(bot);
        const tiers = new Map();
        for (const name of Object.keys(policy.items)) {
            const keep = keepOf(bot, policy, name);
            const tier = keep === Infinity ? 'Keep all' : keep === 0 ? 'Drop all' : `Keep ${keep}`;
            if (!tiers.has(tier)) tiers.set(tier, []);
            tiers.get(tier).push(counts[name] ? `${name} ${counts[name]}` : name);
        }
        const order = ([a], [b]) => (a === 'Drop all' ? -1 : b === 'Drop all' ? 1 : a === 'Keep all' ? 1 : b === 'Keep all' ? -1 : parseInt(a.slice(5)) - parseInt(b.slice(5)));
        const list = [...tiers].sort(order).map(([tier, names]) => `${tier}: ${names.join(', ')}.`).join(' ');
        const slots = `${bot.inventory.emptySlotCount()} free slots; I clean up below ${this.config.min_free_slots}.`;
        const state = this.held(now) ?? 'on';
        const last = this.last ? `Last pass: dropped ${summary(this.last.removed)}, ${Math.max(0, Math.round((now - this.last.at) / 60000))} min ago.` : 'No pass yet.';
        return `Item list (anything not listed I keep): ${list} ${slots} Idle cleanup: ${state}. ${last}`;
    }
}
