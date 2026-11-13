import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { itemLine } from './report.js';
import { NO_DIG } from './sleep.js';
import { fullCube } from './tidy.js';
import * as gear from './gear.js';

// Inventory upkeep (SPEC §9.4, REQ-OBT-11; design junk-council/recommended-
// design.md r7 §2–§6, part A). One item policy (work.inventory, merged in
// config.js), one planner (`planRemoval`: what to remove, never where, so a
// later chest destination needs no rewrite), one dropper (`dropItems`) shared
// by the task runner's free-slot check and the idle cleanup (`Upkeep`, the
// quiet action `action:items` from Work.tick), and the re-pickup guard the
// pickupNearbyItems carry reads (`isGuardedJunk`). S2e-fu (design
// s2efu/design.md §1–§5, DECISIONS 2026-11-12): junk in her hand, the throw
// over a one-block lip, the walk to a drop spot, the kept report, the best kept.

// Constants, not keys (SPEC §14). The look, the 2-tick wait, the ~3-block
// landing and standing still afterwards were measured live by probe P15
// (runtime/diagnostics/i1-build/s2e-review/p15-live-20261112.md), the throw
// over a one-block lip by P16 (s2efu/p16-live-20261112.md); the guard
// against pickupNearbyItems and an obstacle within 3 blocks were not probed.
export const INVENTORY = {
    throwBlocks: 3,       // the facing is free this far, the look point and the drop point are this far out
    lookTicks: 2,         // after the look, before the first toss: the look packet goes out first (G1)
    stepClear: 0.5,       // a block at most this far above her feet does not block the throw (it leaves 1.32 up; P15)
    lipHeight: 1,         // in her feet row a block up to this far above her feet is a lip she throws over (P16)
    walkRadius: 5,        // with no free direction she walks to a drop spot this far away (horizontally) ...
    walkMs: 15000,        // ... within this long (the pathfinder is stopped then)
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
// The dropper's reason, and the idle hold's, when no direction is free (F5).
const NO_DIRECTION = 'no free direction nearby';

const dimOf = bot => bot.game?.dimension ?? 'overworld';
const range = bot => ({ start: bot.inventory.inventoryStart ?? 9, end: bot.inventory.inventoryEnd ?? 45 });
// The selected hotbar slot's inventory slot (the main hand), or null.
const heldSlot = bot => Number.isInteger(bot.quickBarSlot) ? range(bot).end - 9 + bot.quickBarSlot : null;
const summary = removed => Object.entries(removed).map(([name, n]) => `${n} ${name}`).join(', ');
const total = removed => Object.values(removed).reduce((n, c) => n + c, 0);

// --- the policy (REQ-OBT-11, design §2) -----------------------------------------

// How many of `name` she keeps: undefined (not listed: all of it), Infinity
// ("all"), 'slot' (one slot, the best stack) or a count ("stack": the item's
// registry stack size). With `cap` "stack" (DECISIONS 2026-11-12 (night): "cap
// all items for now"), every item whose stack size is above 1 keeps at most
// one stack, listed or not: "all" and unlisted become one stack, a count above
// a stack is capped, 0 and lower counts stay, "slot" stays. Non-stackables
// (tools, weapons, armour, the bed) are outside the cap.
export function keepOf(bot, policy, name) {
    const listed = policy?.items?.[name];
    const size = bot.registry?.itemsByName?.[name]?.stackSize ?? 64;
    let keep = listed;
    if (listed === 'all') keep = Infinity;
    else if (listed === 'stack') keep = size;
    if (policy?.cap !== 'stack' || size <= 1 || keep === 'slot') return keep;
    return keep === undefined ? size : Math.min(keep, size);
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

// An item's worth, for keeping the best of a limited item: the sum of its
// enchantment levels and an ominous bottle's amplifier (the 26.1
// `ominous_bottle_amplifier` component, a varint; checked offline through the
// protocol codec, live unprobed), then the durability left; [0, 0] for items
// with none of them. Enchantments on this version are unprobed live (P16: none
// was available), so an unreadable list counts as none rather than failing the plan.
function worth(item) {
    let levels = Number(item.componentMap?.get?.('ominous_bottle_amplifier')?.data) || 0;
    try {
        levels += (item.enchants ?? []).reduce((n, e) => n + (Number(e?.lvl) || 0), 0);
    } catch {
        // as none
    }
    return [levels, item.maxDurability ? item.maxDurability - (item.durabilityUsed ?? 0) : 0];
}
// Of a gear name the gear rank decides instead (gear rulings r1, 4: adversary
// G2): the best of the name by `!itemList`'s rules, never the enchantment count.
const rankOf = (bot, item) => gear.gearRank(bot, item) ?? worth(item);
const byWorth = (a, b) => gear.compare(a.worth, b.worth);

// The gear spares that may go [{item, slot}] (`gear` "best" only): never a
// needed name, and a listed name follows its list value.
function gearSpares(bot, policy, needed) {
    if (policy.gear !== 'best') return [];
    return gear.spares(bot).filter(e => !needed.has(e.item.name) && policy.items[e.item.name] === undefined);
}

// Slot operations [{slot, name, count, have, whole, sig}]: what to remove, never
// where. Sources are the 36 main slots, the selected hotbar slot included
// (DECISIONS 2026-11-12: junk in her hand is junk; the dropper switches her
// hand off it); armour and offhand are outside them. Never an unlisted, "all"
// or needed item (with `cap` "stack" an unlisted or "all" stackable keeps one
// stack: keepOf). Order: every tier-0 stack whole; then, with `gear` "best",
// the gear spares (work/gear.js spares: every item of a kind but its best,
// lowest rank first, whole; never unreadable, needed or listed: a listed name
// follows its list value); then per limited item, for a
// "slot" item every slot but its best (highest worth, of a gear name its gear
// rank: gear.gearRank; then the larger count),
// for a counted one its surplus as whole stacks smallest first, then lowest worth, then slot, within
// its budget (DECISIONS 2026-11-12 "best one, period": the best stays), and a
// remainder below a whole stack from the first stack left in that order (it may
// free no slot, so it never counts toward minFree). Each operation carries the
// item's component signature (`sig`), which the dropper re-checks. `freed`
// (every whole slot the plan empties) and `reaches` are the simulation; the
// caller re-reads the real free slots afterwards.
export function planRemoval(bot, policy, { needed = new Set(), minFree = 0 } = {}) {
    const ops = [];
    ops.freed = 0;
    ops.reaches = bot.inventory.emptySlotCount() >= minFree;
    if (!removalEnabled(policy)) return ops;
    const { start, end } = range(bot);
    const totals = new Map();
    const stacks = new Map();
    for (let slot = start; slot < end; slot++) {
        const item = bot.inventory.slots[slot];
        if (!item) continue;
        totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
        if (!stacks.has(item.name)) stacks.set(item.name, []);
        stacks.get(item.name).push({ slot, count: item.count, item });
    }
    const op = (s, count, whole) => ({ slot: s.slot, name: s.item.name, count, have: s.count, whole, sig: gear.signature(s.item) });
    const limited = [];
    for (const [name, list] of stacks) {
        const keep = keepOf(bot, policy, name);
        if (keep === undefined || keep === Infinity || needed.has(name)) continue;
        if (keep === 0) for (const s of list) ops.push(op(s, s.count, true));
        else limited.push({ name, list, keep });
    }
    // DECISIONS 2026-11-12 (night), "Gear: the best one, period": her
    // placeholder diamond pickaxe and axe and her diamond sword go as spares.
    for (const e of gearSpares(bot, policy, needed)) ops.push(op({ ...e, count: e.item.count }, e.item.count, false));
    ops.freed = ops.length;
    for (const { name, list, keep } of limited) {
        for (const s of list) s.worth = rankOf(bot, s.item);
        if (keep === 'slot') {
            // One slot of the best (DECISIONS 2026-11-12: bottles of different
            // strengths do not stack together): every other slot goes whole,
            // lowest worth first, then the smaller count, then by slot.
            const sorted = [...list].sort((a, b) => byWorth(a, b) || a.count - b.count || a.slot - b.slot);
            for (const s of sorted.slice(0, -1)) ops.push(op(s, s.count, false));
            ops.freed += sorted.length - 1;
            continue;
        }
        let left = totals.get(name) - keep;
        const sorted = [...list].sort((a, b) => a.count - b.count || byWorth(a, b) || a.slot - b.slot);
        const taken = new Set();
        for (const s of sorted) {
            if (s.count > left) break;
            ops.push(op(s, s.count, false));
            taken.add(s.slot);
            left -= s.count;
            ops.freed++;
        }
        const rest = sorted.find(s => !taken.has(s.slot));
        if (left > 0 && rest) ops.push(op(rest, left, false));
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

// Free: not a liquid, and no collision box more than `clear` above her feet
// (by default INVENTORY.stepClear: short grass, leaf litter and cave air are
// free; so is a floor lower than a full block, a path, farmland, soul sand,
// mud, a bottom slab or a carpet, and the grass edge beside a path: R1-7); an
// unloaded cell is not.
const free = (block, feetY, clear = INVENTORY.stepClear) => Boolean(block) && !LIQUIDS.includes(block.name) && (block.boundingBox === 'empty'
    || (block.shapes?.length > 0 && block.shapes.every(s => block.position.y + s[4] <= feetY + clear + 1e-6)));

// `pos` lies ahead of `here` along [dx, dz] (and more than half a block away).
const toward = ([dx, dz], pos, here) => Boolean(pos) && Math.hypot(pos.x - here.x, pos.z - here.z) > 0.5
    && dx * (pos.x - here.x) + dz * (pos.z - here.z) > 0;

// A cardinal free from her feet to her eyes for INVENTORY.throwBlocks blocks,
// from where she stands or from `from`, or null. Her feet row may hold a lip up
// to INVENTORY.lipHeight above her feet, from distance 1 on (DECISIONS 2026-11-12: she throws over
// a one-block lip, as a player can; P16: the toss leaves 1.32 up and cleared
// one at distance 1 on all four sides); a fence or wall (1.5) still blocks,
// and so does a wall in any row above. Never one toward `never` (a follow's
// target: R1-9); among the rest the first, most opposite `awayFrom`, that is
// toward neither `awayFrom` nor `avoid` (a task's owner within 16: R1-10),
// else the most opposite.
export function chooseFacing(bot, awayFrom = null, { avoid = null, never = null, from = null } = {}) {
    const here = from ?? bot.entity.position;
    const x0 = Math.floor(here.x), z0 = Math.floor(here.z);
    const y0 = Math.floor(here.y), y1 = Math.floor(here.y + (bot.entity.eyeHeight ?? 1.62));
    // A follow's target within half a block is on top of her: no direction is away from him.
    if (never && Math.hypot(never.x - here.x, never.z - here.z) <= 0.5) return null;
    let order = CARDINALS;
    if (awayFrom) {
        const ax = here.x - awayFrom.x, az = here.z - awayFrom.z;
        if (Math.hypot(ax, az) > 0.5) order = [...CARDINALS].sort((a, b) => (b[0] * ax + b[1] * az) - (a[0] * ax + a[1] * az));
    }
    // The lip in her feet row must start at distance 1 (her own pit's edge, what P16
    // probed); a face 2 or 3 out behind an open cell can bounce the toss back into
    // reach (review r1, adversary D2), so there only the half-block rule applies.
    const clear = ([dx, dz]) => {
        let lip = true;
        for (let i = 1; i <= INVENTORY.throwBlocks; i++)
            for (let y = y0; y <= y1; y++) {
                const block = bot.blockAt(new Vec3(x0 + dx * i, y, z0 + dz * i));
                if (free(block, here.y)) {
                    if (y === y0) lip = false;
                } else if (y !== y0 || !lip || !free(block, here.y, INVENTORY.lipHeight)) return false;
            }
        return true;
    };
    const open = order.filter(d => !toward(d, never, here) && clear(d));
    const pick = open.find(d => !toward(d, awayFrom, here) && !toward(d, avoid, here)) ?? open[0];
    return pick ? { dx: pick[0], dz: pick[1] } : null;
}

// Where she can stand: a full cube below, the feet and head cells passable
// and not a liquid.
const passable = block => Boolean(block) && block.boundingBox === 'empty' && !LIQUIDS.includes(block.name);
const standable = (bot, pos) => fullCube(bot.blockAt(pos.offset(0, -1, 0))) && passable(bot.blockAt(pos)) && passable(bot.blockAt(pos.offset(0, 1, 0)));
// The cardinal an offset is closest to, as its index in CARDINALS (the first on a tie).
const cardinalOf = (dx, dz) => CARDINALS.reduce((best, [cx, cz], i) => (cx * dx + cz * dz > CARDINALS[best][0] * dx + CARDINALS[best][1] * dz ? i : best), 0);

// When no direction is free where she stands (DECISIONS 2026-11-12: a pit
// deeper than one block, or a lip she cannot throw over: she walks to the
// nearest open spot within a few blocks): the cell of a standable spot within
// INVENTORY.walkRadius horizontally and from 1 below to 3 above her feet,
// never toward `never` (a follow's target), where chooseFacing finds a
// direction; nearest first (horizontally, then vertically, then the cardinal
// order). A Vec3, or null.
export function findDropSpot(bot, { awayFrom = null, avoid = null, never = null } = {}) {
    const here = bot.entity.position;
    const x0 = Math.floor(here.x), y0 = Math.floor(here.y), z0 = Math.floor(here.z);
    const r = INVENTORY.walkRadius;
    const cells = [];
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const h = Math.hypot(dx, dz);
        // Not her own column (no direction there: why she looks), nor toward a follow's target.
        if (h === 0 || h > r || toward([dx, dz], never, here)) continue;
        for (let dy = -1; dy <= 3; dy++) cells.push({ dx, dy, dz, h, order: cardinalOf(dx, dz) });
    }
    cells.sort((a, b) => a.h - b.h || Math.abs(a.dy) - Math.abs(b.dy) || a.order - b.order);
    for (const { dx, dy, dz } of cells) {
        const pos = new Vec3(x0 + dx, y0 + dy, z0 + dz);
        if (standable(bot, pos) && chooseFacing(bot, awayFrom, { avoid, never, from: pos.offset(0.5, 0, 0.5) })) return pos;
    }
    return null;
}

// The walk's movements, by caller. Neither digs (no terrain or build damage).
// In a task she may tower and scaffold: the ledger records those placements
// and the task-end tidy takes them back, as on any task path (S2c). An idle
// pass has no tidy trigger and the owner ruled she leaves no pathfinder blocks
// behind (DECISIONS 2026-11-11, clearing), so the idle walk places nothing
// (the sleep routine's NO_DIG). Neither opens a door or gate: nothing would
// close it behind her (review r1, adversary D4).
const NO_DOORS = m => { m.canOpenDoors = false; };
const WALKS = Object.freeze({
    task: m => { m.canDig = false; NO_DOORS(m); },
    idle: m => { NO_DIG(m); NO_DOORS(m); },
});

// The walk to a drop spot, with the caller's movements (WALKS), bounded by
// INVENTORY.walkMs, when the pathfinder is stopped (as Sleeper.walk). A walk
// that fails or runs out is no error: the caller checks where she stands. Its
// goal is cleared at the end while still active (a rejected goto can leave a
// partial route running: review r1, Sol 2).
async function walkTo(bot, spot, walk) {
    let bounded = false;
    const goal = new pf.goals.GoalBlock(spot.x, spot.y, spot.z);
    const timer = setTimeout(() => { bounded = true; bot.pathfinder?.setGoal?.(null); }, INVENTORY.walkMs);
    try {
        await skills.goToGoal(bot, goal, WALKS[walk]);
    } catch {
        // where she ended is checked by the caller
    } finally {
        clearTimeout(timer);
        if (bot.pathfinder?.goal === goal) bot.pathfinder.setGoal(null);
        if (bounded) console.log(`[items] the walk to a drop spot ran out of its ${INVENTORY.walkMs} ms`);
    }
}

// The owner's position when he is within INVENTORY.ownerRadius, else null.
export function ownerNear(bot, owner) {
    const entity = owner ? bot.players?.[owner]?.entity : null;
    return entity && entity.position.distanceTo(bot.entity.position) <= INVENTORY.ownerRadius ? entity.position : null;
}

// The slot still holds what the operation planned (design §3, F-N8): a tier-0
// stack the same item with at least the planned count (a contact pickup may
// have merged into it), any other the same item with the planned count; the
// same component signature (gear design r5 §5: no toss of the wrong
// same-name item after an equip swap); and it is not the live selected
// hotbar slot (the hand-off found no other slot, or the server selected it since: R1-3).
function stillThere(bot, op, item) {
    if (!item || item.name !== op.name || gear.signature(item) !== op.sig || op.slot === heldSlot(bot)) return false;
    return op.whole ? item.count >= op.count : item.count === op.have;
}

// Junk in her hand (DECISIONS 2026-11-12): when a planned slot is the live
// selected one, she selects the first empty hotbar slot, else the first that
// holds no planned operation, else none (stillThere then skips that one
// operation). Every operation is a toss of exactly its slot, so the stack she
// then holds is never tossed by name (the old R1-1/R1-3 concern); the held-item
// packet goes out before the window clicks, on the same connection.
function handOff(bot, plan) {
    const held = heldSlot(bot);
    if (held === null || !plan.some(op => op.slot === held)) return;
    const first = range(bot).end - 9;
    const planned = new Set(plan.map(op => op.slot));
    const hotbar = [...Array(9).keys()];
    const to = hotbar.find(i => !bot.inventory.slots[first + i]) ?? hotbar.find(i => !planned.has(first + i));
    if (to !== undefined) bot.setQuickBarSlot(to);
}

// Removes the plan's slot operations where she stands: faces a free cardinal
// (away from `awayFrom`); with none and `walk` ('task' or 'idle': WALKS), walks
// to the nearest drop spot first (findDropSpot), and only once she stands on
// it plans again (`replan`, the caller's planner) and faces again; looks level at a point 3
// blocks out at eye height, waits 2 ticks (a forced look sends no packet of
// its own, so a toss could otherwise fly the way she was looking: G1), switches
// her hand off a planned slot, records the drop point, then one slot operation
// per toss, re-checked before each one. `current` is the caller's currency,
// checked after the walk, after the wait and between tosses. Non-throwing:
// {outcome: done | interrupted | unavailable | failed, removed: {name: count}, reason}.
export async function dropItems(bot, plan, { awayFrom = null, avoid = null, never = null, walk = false, replan = null, current = () => true, now = Date.now } = {}) {
    const removed = {};
    const halted = () => Boolean(bot.interrupt_code) || !current();
    const end = (outcome, reason = null) => {
        if (total(removed) && bot.modes) bot.modes.behavior_log += 'Dropped junk.\n';
        return { outcome, removed, reason };
    };
    if (!plan.length) return end('done');
    // The armour controller clicks nothing while this runs, and catches up after (gear design r5 §4).
    const release = gear.holdSlots(bot);
    try {
        let facing = chooseFacing(bot, awayFrom, { avoid, never });
        if (!facing && walk) {
            const spot = findDropSpot(bot, { awayFrom, avoid, never });
            if (!spot) return end('unavailable', NO_DIRECTION);
            await walkTo(bot, spot, walk);
            if (halted()) return end('interrupted');
            // Only from the spot itself: a bounded or partial walk may have
            // stopped anywhere (review r1, adversary D3).
            if (!bot.entity.position.floored().equals(spot)) return end('unavailable', NO_DIRECTION);
            // The walk may have used her blocks (scaffold), so the plan is made
            // again from the live bag (review r1, Sol 1).
            if (replan) plan = replan();
            if (!plan.length) return end('done');
            facing = chooseFacing(bot, awayFrom, { avoid, never });
        }
        if (!facing) return end('unavailable', NO_DIRECTION);
        const here = bot.entity.position.clone();
        const out = INVENTORY.throwBlocks;
        await bot.lookAt(here.offset(facing.dx * out, bot.entity.eyeHeight ?? 1.62, facing.dz * out), true);
        await bot.waitForTicks(INVENTORY.lookTicks);
        if (halted()) return end('interrupted');
        handOff(bot, plan);
        const point = recordDropPoint(bot, here.offset(facing.dx * out, 0, facing.dz * out), now());
        for (const op of plan) {
            if (halted()) return end('interrupted');
            const item = bot.inventory.slots[op.slot];
            if (!stillThere(bot, op, item)) continue;   // the next pass plans again from the live inventory
            const why = gear.busy(bot);
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
    } finally {
        release();
    }
}

// The INVENTORY.keptShown largest items, totalled by name ("dirt 128, arrow
// 32"): the kept-items note and a blocked step's inventory-full report.
export function largestItems(bot) {
    return Object.entries(world.getInventoryCounts(bot)).sort((a, b) => b[1] - a[1])
        .slice(0, INVENTORY.keptShown).map(([name, n]) => `${name} ${n}`).join(', ');
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
        this.idleHold = null;        // {inv, pos, dim, at, why}: after a pass that removed nothing, or no direction
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

    // The cheap check: removal is enabled, and her free slots are low or a
    // surplus allowance is set (then `admit` asks `due` of the plan).
    wanted() {
        return removalEnabled(this.policy) && this.policy.idle === true
            && (this.bot.inventory.emptySlotCount() < this.config.min_free_slots || Number.isInteger(this.policy.surplus_slots));
    }

    // Whether a plan is due (gear design r5 §5; DECISIONS 2026-11-12 (night):
    // "when there's 2 spares, the 3rd one gets dropped, and [...] when she has
    // fewer than 4 free slots, then yeah, definitely"; 2026-11-13: one shared
    // count over junk, spares and extra stacks): not empty, and her free slots
    // below min_free_slots, or more whole slots to free than `surplus_slots`.
    due(plan) {
        if (!plan.length) return false;
        const allowance = this.policy.surplus_slots;
        return this.bot.inventory.emptySlotCount() < this.config.min_free_slots || (Number.isInteger(allowance) && plan.freed > allowance);
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
        if (this.idleHold && !this.released(now)) return `waiting: ${this.idleHold.why}`;
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

    // The inventory as the holds and the not-due memo see it: the counts by
    // name, the held slot and each slot's component signature (without wear:
    // gear design r5 §5; gear Sol review r1, 7; adversary r2).
    signature() {
        const slots = this.bot.inventory.slots.map((item, slot) => (item ? [slot, gear.signature(item)] : null)).filter(Boolean);
        return JSON.stringify([world.getInventoryCounts(this.bot), heldSlot(this.bot), slots]);
    }

    // The hold of a pass that removed nothing or found no direction, with why
    // (F5: `!itemList` names the cause).
    hold(now, why) {
        const p = this.bot.entity.position;
        this.idleHold = { inv: this.signature(), pos: { x: p.x, y: p.y, z: p.z }, dim: dimOf(this.bot), at: now, why };
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
        // A bag of kept items, or surplus within the allowance, is planned
        // once per inventory and task state, not every second (the needed
        // items of a paused task cost world lookups); at most for the 5-minute
        // retry (R1-4; gear design r5 §5: "not due" under the same key).
        const record = this.work.record;
        const key = `${this.signature()}|${record?.id}:${record?.status}:${record?.cursor}`;
        if (this.emptyKey?.key === key && now - this.emptyKey.at < INVENTORY.retryMs) return null;
        const plan = this.plan();
        if (!this.due(plan)) {
            this.emptyKey = { key, at: now };
            // The kept tell only for a low bag (gear design r5 §5; adversary r3, D1): above
            // min_free_slots an empty plan is simply not due.
            if (bot.inventory.emptySlotCount() < this.config.min_free_slots) this.noteKept();
            return null;
        }
        this.emptyKey = null;
        const awayFrom = follow ? target.position : ownerNear(bot, this.work.owner());
        // No free direction (never toward a follow's target): idle, a drop spot
        // to walk to admits (the pass walks: DECISIONS 2026-11-12); following,
        // no walk and no cut (R1-8, R1-9: the follow moves her anyway). Else the
        // same hold as a pass that removed nothing, so it is not re-planned
        // every second.
        if (!chooseFacing(bot, awayFrom, { never: follow ? target.position : null }) && (follow || !findDropSpot(bot, { awayFrom }))) {
            this.hold(now, NO_DIRECTION);
            return null;
        }
        // The turns a pass may run beside: only the one parked on the cut follow (R1-5).
        return { follow, awayFrom, turns: new Set(follow ? turns : []) };
    }

    plan() {
        return planRemoval(this.bot, this.policy, { needed: this.work.neededItems(), minFree: this.config.min_free_slots });
    }

    // The bag is low on slots and nothing in it may go (the caller checks
    // the slots): the five largest kept items, totalled by name, once per session.
    noteKept() {
        this.tellOnce('kept', largestItems(this.bot));
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
        // From the live inventory, and nothing unless still due (also after a
        // walk: gear design r5 §5; adversary r3, D2). A pass drops the whole plan: the third
        // surplus slot sends all surplus (DECISIONS 2026-11-13).
        const duePlan = () => { const plan = this.plan(); return this.due(plan) ? plan : []; };
        const plan = duePlan();
        if (!plan.length) return;
        let awayFrom = admitted.awayFrom;
        if (admitted.follow) awayFrom = this.followTarget()?.position ?? awayFrom;   // always away from the follow target (C-F3)
        // While following no walk (the follow moves her anyway); idle she may walk to a drop spot, placing nothing.
        const result = await dropItems(bot, plan, { awayFrom, never: admitted.follow ? awayFrom : null, walk: admitted.follow ? false : 'idle', replan: duePlan, current });
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
            this.hold(now, result.reason === NO_DIRECTION ? NO_DIRECTION : 'nothing to drop from here');
        }
    }

    // !itemList (design §6; gear design r5 §6): the cap and gear rules, per
    // kind the best item and why, the spares that go, the effective list by
    // tier with what she holds, her free slots and the surplus count, whether
    // the idle cleanup is on or held and why, and the last pass. Code-rendered.
    render(now = Date.now()) {
        const bot = this.bot;
        const policy = this.policy;
        const needed = this.work.neededItems();
        const counts = world.getInventoryCounts(bot);
        const tiers = new Map();
        for (const name of Object.keys(policy.items)) {
            const keep = keepOf(bot, policy, name);
            const tier = keep === Infinity ? 'Keep all' : keep === 0 ? 'Drop all' : keep === 'slot' ? 'Keep 1 slot' : `Keep ${keep}`;
            if (!tiers.has(tier)) tiers.set(tier, []);
            tiers.get(tier).push(counts[name] ? `${name} ${counts[name]}` : name);
        }
        const order = ([a], [b]) => (a === 'Drop all' ? -1 : b === 'Drop all' ? 1 : a === 'Keep all' ? 1 : b === 'Keep all' ? -1 : parseInt(a.slice(5)) - parseInt(b.slice(5)));
        const list = [...tiers].sort(order).map(([tier, names]) => `${tier}: ${names.join(', ')}.`).join(' ');
        const allowance = policy.surplus_slots;
        const slots = `${bot.inventory.emptySlotCount()} free slots; I clean up below ${this.config.min_free_slots}` + (Number.isInteger(allowance)
            ? `, or when more than ${allowance} slots hold spares, extra stacks or junk (now ${planRemoval(bot, policy, { needed }).freed}).` : '.');
        const state = this.held(now) ?? 'on';
        const last = this.last ? `Last pass: dropped ${summary(this.last.removed)}, ${Math.max(0, Math.round((now - this.last.at) / 60000))} min ago.` : 'No pass yet.';
        const cap = policy.cap === 'stack' ? 'one stack at most of anything that stacks, listed or not; anything else not listed I keep' : 'anything not listed I keep';
        const rule = policy.gear === 'best' ? 'of gear only the best of each kind' : 'all my gear, and I use the best';
        return `Item list (${cap}; ${rule}): ${this.renderGear(needed)}${list} ${slots} Idle cleanup: ${state}. ${last}`;
    }

    // The gear part of !itemList: per kind the best and why, then (gear
    // "best") the spares that go; nothing when she has no gear.
    renderGear(needed) {
        const bot = this.bot;
        const { kinds } = gear.assess(bot);
        const best = [...kinds].map(([kind, { winner }]) => `${kind} ${winner.item.name}${winner.worn ? ' (worn)' : ''}: ${gear.why(bot, kind, winner.item)}`);
        if (!best.length) return '';
        const spares = gearSpares(bot, this.policy, needed).map(e => e.item.name);
        const go = this.policy.gear === 'best' ? ` Spares that go: ${spares.length ? spares.join(', ') : 'none'}.` : '';
        return `Best gear: ${best.join('; ')}.${go} `;
    }
}
