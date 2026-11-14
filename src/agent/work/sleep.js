import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../library/skills.js';
import * as mc from '../../utils/mcdata.js';
import { digCell, eyeDistance, REACH } from './dig.js';
import { fullCube } from './tidy.js';
import { bedLine } from './report.js';
import { ITEMS_LABEL } from './inventory.js';

// Sleeping through the night (SPEC §7.9, REQ-SLP-1 … 10; design
// sleep-council/recommended-design.md r3 and its §14, amended by the junk
// design r7 §5). The `sleeping` mode (modes.js carry) asks `next()` every
// tick and runs the returned routine as `mode:sleeping`; the bed pickup by
// day runs from Work.tick as the quiet action `action:bed`. Observe, then
// act: every start re-derives what to do from the world and the ledger; the
// night record, the cooldown and the collection receipt live in memory.

// Constants, not keys (SPEC §14); tests shorten the waits.
export const SLEEP = {
    nightStart: 12541,    // mineflayer's sleep window starts here (bed.js:81)
    nightEnd: 23000,      // later is not worth a bed
    maxTries: 3,          // failed tries before the night is done
    cooldownMs: 30000,    // after a failed try (and after a soft pickup refusal)
    skipWaitMs: 15000,    // in bed this long without the night skipping: get up
    spotRadius: 6,        // the stand cell, from her
    spotDy: 2,
    spotCandidates: 3,
    reuseRadius: 16,      // my bed is reused, or picked up, within this
    wakeMs: 3000,         // the guarded wake waits this long for `wake`
    walkMs: 10000,        // every walk of the routines is bounded by this
    pollMs: 500,          // in bed
    dropRadius: 5,        // the dropped bed is looked for this close to the bed
    dropWaitMs: 1000,     // for the drop to appear, and for the pickup after each walk
    collectWalks: 3,      // walks into the drop's cell, following it if it slides
    receiptMs: 300000,    // an item's life: a receipt older than this is a lost bed
    freeSlots: 2,         // Work.tick launches a pickup only with this many free slots (junk design §5)
    pickupSlots: 1,       // the pickup itself needs the bed's own slot (inside the routine too)
    lateMs: 2000,         // after a placement, how long she watches the cells for her bed (a late answer, the head's update)
    modeCuts: 6,          // work.sleep.max_mode_cuts when the profile's value is not a positive integer
};

export const SLEEP_LABEL = 'mode:sleeping';
export const BED_LABEL = 'action:bed';
export const SLEEP_LABELS = Object.freeze(new Set([SLEEP_LABEL, BED_LABEL]));
export const SLEEP_WHEN = Object.freeze(['always', 'idle', 'off']);

const FACING = Object.freeze({ south: [0, 0, 1], west: [-1, 0, 0], north: [0, 0, -1], east: [1, 0, 0] });
const AIR = ['air', 'cave_air'];
const LIQUIDS = ['water', 'lava', 'bubble_column'];
const falls = name => ['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'].includes(name) || Boolean(name?.endsWith('_concrete_powder'));
const BESIDE = [[0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
const UP = new Vec3(0, 1, 0);
// Every walk: no digging, no towers, no scaffold (S8). Also the idle item
// cleanup's walk (inventory.js).
export const NO_DIG = m => {
    m.canDig = false;
    m.allow1by1towers = false;
    m.scafoldingBlocks = [];
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const vec = p => new Vec3(p.x, p.y, p.z);
const fmt = p => `${p.x} ${p.y} ${p.z}`;
const isBed = name => typeof name === 'string' && name.endsWith('_bed');
const isAir = block => Boolean(block) && AIR.includes(block.name);
const props = block => block?.getProperties?.() ?? {};
const overworld = bot => bot.game?.dimension === 'overworld';
const inWindow = bot => {
    const t = bot.time?.timeOfDay;
    return Number.isFinite(t) && t >= SLEEP.nightStart && t <= SLEEP.nightEnd;
};
// The night's id: the world's day count, from its day time (so it follows
// /time set and skipped nights), captured when a try starts.
const nightOf = bot => Number.isFinite(bot.time?.day) ? bot.time.day : null;
const bedItem = bot => bot.inventory.items().find(i => isBed(i.name)) ?? null;
const bedCount = bot => bot.inventory.items().filter(i => isBed(i.name)).reduce((n, i) => n + i.count, 0);
const countOf = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

function liquidBeside(bot, pos) {
    return BESIDE.some(([dx, dy, dz]) => LIQUIDS.includes(bot.blockAt(pos.offset(dx, dy, dz))?.name));
}

// The partner half of a bed block (its head for a foot), or null.
function partnerOf(block) {
    const p = props(block);
    const d = FACING[p.facing];
    if (!d || (p.part !== 'foot' && p.part !== 'head')) return null;
    const s = p.part === 'foot' ? 1 : -1;
    return block.position.offset(d[0] * s, 0, d[2] * s);
}

// Mineflayer's monster box around a bed's head (bed.js:119, :135-146),
// with our hostile test beside its own.
function hostileInBedBox(bot, head) {
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e?.position || e === bot.entity || !(e.kind === 'Hostile mobs' || mc.isHostile(e))) continue;
        const p = e.position.floored();
        const dx = p.x - head.x, dy = p.y - head.y, dz = p.z - head.z;
        if (dx >= -8 && dx <= 7 && dy >= -6 && dy <= 4 && dz >= -8 && dz <= 7) return true;
    }
    return false;
}

// Any player or mob but her overlapping the cell (dropped items and orbs do
// not block a bed).
function othersIn(bot, cell) {
    for (const e of Object.values(bot.entities ?? {})) {
        if (!e?.position || e === bot.entity || e.name === 'item' || e.name === 'experience_orb') continue;
        const half = (e.width ?? 0.6) / 2;
        const p = e.position;
        if (p.x + half <= cell.x || p.x - half >= cell.x + 1 || p.z + half <= cell.z || p.z - half >= cell.z + 1) continue;
        if (p.y < cell.y + 1 && p.y + (e.height ?? 1.8) > cell.y) return true;
    }
    return false;
}

function standable(bot, cell) {
    const passable = b => Boolean(b) && b.boundingBox === 'empty' && !LIQUIDS.includes(b.name);
    return passable(bot.blockAt(cell)) && passable(bot.blockAt(cell.offset(0, 1, 0))) && bot.blockAt(cell.offset(0, -1, 0))?.boundingBox === 'block';
}

export class Sleeper {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        this.nights = new Map();  // id -> {id, done, tries, why}: this night and the last, in memory
        this.cooldownUntil = 0;   // after a failed try
        this.retryAt = 0;         // after a soft pickup refusal
        this.running = false;     // the sleep routine runs
        this.latch = false;       // a maintenance launch (action:bed) is in flight
        this.receipt = null;      // {pos, dim, item, at, count, ob}: from the pickup dig until the bed is back or lost
        this.told = new Map();    // obligation -> the owner lines said for it ('session': no_skip)
        this.leaving = null;      // the entry leave() retires itself (not a lost bed)
        this.unreachable = new Set(); // obligations whose bed she could not reach: retried only while idle
        this.onRetire = (entry, why) => this.retired(entry, why);
        work.ledger?.onRetire.push(this.onRetire);
        this.asleepAt = null;
        this.wakeTried = false;   // this routine's one guarded wake was tried
        this.warned = false;
    }

    dispose() {
        this.disposed = true;
        const listeners = this.work.ledger?.onRetire;
        const i = listeners?.indexOf(this.onRetire) ?? -1;
        if (i >= 0) listeners.splice(i, 1);
    }

    log(message) {
        console.log(`[sleep] ${message}`);
    }

    // work.sleep.when; an unknown value is logged once and means the default.
    when() {
        const when = this.work.config.sleep?.when;
        if (SLEEP_WHEN.includes(when)) return when;
        if (!this.warned) {
            this.warned = true;
            console.warn(`[sleep] unknown work.sleep.when ${JSON.stringify(when)}; using always`);
        }
        return 'always';
    }

    // work.sleep.max_mode_cuts; anything but a positive integer means the default.
    maxModeCuts() {
        const n = this.work.config.sleep?.max_mode_cuts;
        return Number.isInteger(n) && n > 0 ? n : SLEEP.modeCuts;
    }

    // New sleeps: the config and the session switch (!setMode sleeping off).
    enabled() {
        return this.when() !== 'off' && this.bot.modes?.isOn?.('sleeping') !== false;
    }

    // --- the night record ----------------------------------------------------------

    // A try's night is the one it started in (a sleep that ends after dawn
    // marks its own night); older nights are dropped.
    nightState(id) {
        let night = this.nights.get(id);
        if (!night) {
            night = { id, done: false, tries: 0, modeCuts: 0, why: null };
            this.nights.set(id, night);
            for (const old of this.nights.keys()) if (old < id - 1) this.nights.delete(old);
        }
        return night;
    }

    markDone(id, why) {
        if (id == null) return;
        const night = this.nightState(id);
        if (night.done) return;
        night.done = true;
        night.why = why;
        this.log(`night ${id} done: ${why}`);
    }

    failedTry(id, why) {
        if (id == null) return;
        const night = this.nightState(id);
        if (night.done) return;
        night.tries++;
        this.cooldownUntil = Date.now() + SLEEP.cooldownMs;
        this.log(`try ${night.tries} failed: ${why}`);
        if (night.tries >= SLEEP.maxTries) this.markDone(id, `${night.tries} failed tries`);
    }

    // A protective mode (a fight) cut the routine: the same cooldown, its own
    // cap (work.sleep.max_mode_cuts), not one of the 3 tries.
    modeCut(id, label) {
        if (id == null) return;
        const night = this.nightState(id);
        if (night.done) return;
        night.modeCuts++;
        this.cooldownUntil = Date.now() + SLEEP.cooldownMs;
        this.log(`cut ${night.modeCuts} by ${label}`);
        if (night.modeCuts >= this.maxModeCuts()) this.markDone(id, `${night.modeCuts} mode cuts`);
    }

    nightDone() {
        const id = nightOf(this.bot);
        return id == null || this.nightState(id).done;
    }

    // My bed is wanted for sleeping tonight (so it is not picked up).
    wanted() {
        return this.enabled() && overworld(this.bot) && inWindow(this.bot) && !this.nightDone();
    }

    // Sleeping now, inside the routine (the task view, REQ-SLP-9).
    asleep() {
        return this.running && Boolean(this.bot.isSleeping);
    }

    // --- my bed (REQ-OWN-2) ---------------------------------------------------------

    // The ledger's entry for a bed the routine placed at `pos`, live.
    entryAt(pos) {
        const entry = this.work.ledger?.get(pos);
        return entry?.kind === 'own' && entry.by === SLEEP_LABEL && isBed(entry.block) ? entry : null;
    }

    // My beds in this dimension, nearest first: {entry, dist, loaded} (an
    // unloaded cell is unknown, not gone). A loaded cell that shows another
    // block is skipped here; reconcile() retires it as a lost bed (gone()).
    myBeds() {
        const bot = this.bot;
        const dim = bot.game?.dimension ?? 'overworld';
        const me = bot.entity.position;
        const beds = [];
        for (const entry of this.work.ledger?.list() ?? []) {
            if (entry.kind !== 'own' || entry.by !== SLEEP_LABEL || entry.dim !== dim || entry.removed_at || entry.removing || !isBed(entry.block)) continue;
            const block = bot.blockAt(vec(entry.pos));
            if (block && block.name !== entry.block) continue;
            beds.push({ entry, loaded: Boolean(block), dist: me.distanceTo(vec(entry.pos).offset(0.5, 0, 0.5)) });
        }
        return beds.sort((a, b) => a.dist - b.dist);
    }

    myBedNear(radius) {
        return this.myBeds().find(b => b.loaded && b.dist <= radius) ?? null;
    }

    // My recorded beds in this dimension whose loaded foot cell shows another
    // block (broken while she was away, or before a restart).
    gone() {
        const bot = this.bot;
        const dim = bot.game?.dimension ?? 'overworld';
        return (this.work.ledger?.list() ?? []).filter(entry => {
            if (entry.kind !== 'own' || entry.by !== SLEEP_LABEL || entry.dim !== dim || entry.removed_at || entry.removing || !isBed(entry.block)) return false;
            const block = bot.blockAt(vec(entry.pos));
            return Boolean(block) && block.name !== entry.block;
        });
    }

    // --- obligations and the owner lines (REQ-SLP-8) ------------------------------------

    // One placed bed (or its drop) is one obligation: its lines are said once
    // each, and forgotten when it resolves (back, lost, or no longer hers).
    obligation(entry) {
        return entry ? `${entry.dim ?? 'overworld'}:${fmt(entry.pos)}:${entry.at ?? ''}` : null;
    }

    resolve(ob) {
        if (!ob) return;
        this.told.delete(ob);
        this.unreachable.delete(ob);
    }

    // A ledger retire of my bed that I did not do myself (a block update: a
    // player, a creeper, a broken support) is a lost bed, told once.
    retired(entry, why) {
        if (entry === this.leaving || entry?.kind !== 'own' || entry.by !== SLEEP_LABEL || !isBed(entry.block)) return;
        this.log(`my bed at ${fmt(entry.pos)} is gone (${why})`);
        const ob = this.obligation(entry);
        this.tellOnce('lost', entry.pos, { ob });
        this.resolve(ob);
    }

    // --- when she sleeps (REQ-SLP-2) -------------------------------------------------

    // What sleep (and the bed pickup) may cut now, under work.sleep.when.
    // `idle` (and `off`, for the pickup): only with nothing to do. `always`:
    // idle, unless a goal's model call is in flight; the task's run; the
    // pending resumable owner action unless a goal is ACTIVE (upstream would
    // not resume it, action_manager.js:63); a goal's own action; a walk the
    // keeper holds (DECISIONS 2026-11-14: "she should continue the task after
    // sleeping regardless of what it is"; travel.js restarts it once sleep and
    // the bed pickup are over). Never a mode, tidy, the bed pickup or another
    // one-off action, and nothing while a stop runs.
    mayCut(policy = this.when()) {
        const { agent } = this;
        const actions = agent.actions;
        const sp = agent.self_prompter;
        if (actions.stopPromise) return false;
        const goal = Boolean(sp?.isActive());
        if (policy !== 'always')
            return !actions.executing && !goal && !actions.resume_func && this.work.record?.status !== 'active';
        if (!actions.executing) return !(goal && sp.loop_active);
        const label = actions.currentActionLabel;
        if (!label || label.startsWith('mode:') || label === 'action:tidy' || label === BED_LABEL) return false;
        // The item cleanup (S2e) is cut by sleep; the bed pickup never meets
        // it: they share the maintenance latch (reconcile).
        if (label === 'action:task' || label === ITEMS_LABEL) return true;
        if (this.work.travel?.holds(label)) return true;
        if (actions.resume_func && label === actions.resume_name) return !goal;
        const start = this.work.lastStart;
        return goal && start?.label === label && start.goal && start.voice === 'own';
    }

    // The sleeping mode's update: the routine to run now, or null. Cheap.
    next() {
        try {
            if (this.disposed || this.running || this.latch || !this.enabled()) return null;
            const bot = this.bot;
            if (!overworld(bot) || !inWindow(bot)) return null;
            const id = nightOf(bot);
            if (id == null || this.nightState(id).done || Date.now() < this.cooldownUntil) return null;
            if (this.receipt) return null;   // a drop to collect first (Work.tick), so no sleep overwrites its receipt
            if (!this.mayCut()) return null;
            if (hostileInBedBox(bot, bot.entity.position.floored())) return null;
            if (!bedItem(bot) && !this.myBedNear(SLEEP.reuseRadius)) return null;
            return () => this.routine(id);
        } catch (err) {
            console.error('[sleep] next() failed:', err);
            return null;
        }
    }

    // REQ-SLP-7: a non-mode action that cuts the sleep, or a new resumable
    // action starting during the night, marks the night done; the task
    // runner's own runs and resumes and the bed pickup do not.
    onActionStart(label, fn, opts) {
        if (!label || label.startsWith('mode:') || label === 'action:task' || label === BED_LABEL) return;
        if (fn && fn === this.work.runner?.runFn) return;
        const bot = this.bot;
        if (!overworld(bot) || !inWindow(bot)) return;
        const id = nightOf(bot);
        if (this.running) this.markDone(id, `${label} cut the sleep`);
        else if (opts?.resume) this.markDone(id, `${label} started during the night`);
    }

    // --- the routine (REQ-SLP-3 … 5) ---------------------------------------------------

    // mode:sleeping. A non-throwing boundary: every expected failure is a
    // bounded outcome; the wake and the accounting run in finally.
    async routine(id) {
        const work = this.work;
        const stopEpoch = this.agent.stop_epoch;
        this.running = true;
        this.wakeTried = false;
        work.holdStall();
        let outcome = null;
        try {
            outcome = await this.sleepOnce(id);
        } catch (err) {
            console.error('[sleep] the sleep routine failed:', err);
            outcome = { failed: `error: ${err?.message ?? err}` };
        } finally {
            try {
                // One guarded wake per routine: a second 3 s wait could reach the stop watchdog.
                if (this.bot.isSleeping && !this.wakeTried) await this.wakeUp();
            } catch (err) {
                console.error('[sleep] could not get up:', err);
            }
            this.asleepAt = null;
            this.running = false;
            work.releaseStall();
            try {
                if (this.agent.stop_epoch !== stopEpoch) this.markDone(id, 'a !stop');
                else if (outcome?.done) this.markDone(id, outcome.done);
                else if (outcome?.failed) this.failedTry(id, outcome.failed);
                else if (outcome?.interrupted && work.lastStart?.label?.startsWith('mode:') && work.lastStart.label !== SLEEP_LABEL)
                    this.modeCut(id, work.lastStart.label);
                else if (outcome?.interrupted) this.failedTry(id, `cut by ${work.lastStart?.label ?? 'an interruption'}`);
            } catch (err) {
                console.error('[sleep] could not record the night:', err);
            }
        }
    }

    halted() {
        return Boolean(this.bot.interrupt_code);
    }

    async sleepOnce(id) {
        const bot = this.bot;
        const interrupted = { interrupted: true };
        let entry = null;
        const mine = this.myBedNear(SLEEP.reuseRadius);
        if (mine) {
            // 1. My bed, re-validated like a new spot, then walked to.
            const why = this.bedProblem(mine.entry);
            if (why) return { failed: `my bed at ${fmt(mine.entry.pos)}: ${why}` };
            this.log(`spot: my bed at ${fmt(mine.entry.pos)}`);
            const p = mine.entry.pos;
            if (!(await this.walk(new pf.goals.GoalNear(p.x, p.y, p.z, 2))) || eyeDistance(bot, p) > REACH)
                return this.halted() ? interrupted : { failed: 'could not reach my bed' };
            entry = mine.entry;
        } else {
            // 1. A spot, nearest first; 2. place from it.
            if (!bedItem(bot)) return { failed: 'no bed' };
            const spots = this.spots();
            if (!spots.length) return { failed: `no spot for a bed within ${SLEEP.spotRadius} blocks` };
            let spot = null;
            for (const s of spots) {
                if (this.halted()) return interrupted;
                this.log(`spot: stand ${fmt(s.B)}, bed ${fmt(s.F)} to ${fmt(s.H)}`);
                if (!(await this.walk(new pf.goals.GoalBlock(s.B.x, s.B.y, s.B.z)))) {
                    if (this.halted()) return interrupted;
                    continue;
                }
                if (bot.entity.position.floored().equals(s.B)) { spot = s; break; }
            }
            if (!spot) return { failed: 'could not reach a spot' };
            const placed = await this.place(spot);
            if (!placed.entry) return placed.outcome;
            entry = placed.entry;
        }
        // 3. Sleep.
        if (this.halted()) return interrupted;
        if (!overworld(bot)) return { failed: 'not in the overworld' };
        if (!inWindow(bot)) {
            await this.pickup(entry);
            return { done: 'the night ended before I lay down' };
        }
        bot.modes?.pause?.('unstuck');
        try {
            await bot.sleep(bot.blockAt(vec(entry.pos)));
        } catch (err) {
            if (this.halted()) return interrupted;
            // A failed try picks its bed up before it returns (S4).
            await this.pickup(entry);
            return { failed: `could not sleep (${err?.message ?? err})` };
        }
        this.asleepAt = Date.now();
        if (bot.modes) bot.modes.behavior_log += 'Sleeping.\n';
        this.log(`slept in my bed at ${fmt(entry.pos)}`);
        // 4. In bed.
        let skipped = false;
        let noSkip = false;
        for (;;) {
            if (this.halted()) {
                this.log(`woke by an interruption (${this.work.lastStart?.label ?? '-'}) after ${Math.round((Date.now() - this.asleepAt) / 1000)} s`);
                await this.wakeUp();
                return interrupted;   // the bed stays; Work.tick picks it up when allowed
            }
            if (!bot.isSleeping) {
                skipped = nightOf(bot) !== id || !inWindow(bot);
                this.log(`woke after ${Math.round((Date.now() - this.asleepAt) / 1000)} s: ${skipped ? 'the night skipped' : 'woken before the night ended'}`);
                break;
            }
            if (Date.now() - this.asleepAt >= SLEEP.skipWaitMs) {
                this.log(`the night did not skip after ${Math.round(SLEEP.skipWaitMs / 1000)} s; getting up`);
                await this.wakeUp();
                this.tellOnce('no_skip');
                noSkip = true;
                break;
            }
            await wait(SLEEP.pollMs);
        }
        // 5. Pick up.
        await this.pickup(entry);
        if (noSkip) return { done: 'the night did not skip' };
        return skipped ? { done: 'slept' } : { failed: 'woken before the night ended' };
    }

    // The guarded wake: the listener first; wake() only while asleep (it
    // throws when awake, and unguarded in a finally it exits the process);
    // at most SLEEP.wakeMs, well inside the ActionManager's 10 s stop
    // watchdog; return either way.
    async wakeUp() {
        const bot = this.bot;
        if (!bot.isSleeping) return true;
        this.wakeTried = true;
        let onWake = null;
        const woke = new Promise(resolve => { onWake = () => resolve(true); bot.once('wake', onWake); });
        let timer = null;
        try {
            try {
                await bot.wake();
            } catch {
                // already awake, or the packet could not be sent: the wait decides
            }
            const ok = await Promise.race([woke, new Promise(resolve => { timer = setTimeout(() => resolve(false), SLEEP.wakeMs); })]);
            if (ok || !bot.isSleeping) return true;
            this.log(`the wake was not confirmed within ${SLEEP.wakeMs} ms`);
            this.tellOnce('stuck', null, { category: 'detail' });
            return false;
        } finally {
            clearTimeout(timer);
            bot.removeListener('wake', onWake);
        }
    }

    // --- the spot (REQ-SLP-3) --------------------------------------------------------

    // Up to SLEEP.spotCandidates stand cells B (one per cell), nearest first
    // within the spot radius and |dy| ≤ 2, each with a cardinal d: the foot
    // F = B + d, the head H = B + 2d.
    spots() {
        const bot = this.bot;
        const me = bot.entity.position;
        const base = me.floored();
        const r = SLEEP.spotRadius;
        const found = [];
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.hypot(dx, dz) > r) continue;
            for (let dy = -SLEEP.spotDy; dy <= SLEEP.spotDy; dy++) {
                const B = base.offset(dx, dy, dz);
                if (!standable(bot, B)) continue;
                for (const [facing, [x, , z]] of Object.entries(FACING)) {
                    const d = new Vec3(x, 0, z);
                    if (this.spotProblem(B, d)) continue;
                    found.push({ B, d, facing, F: B.plus(d), H: B.plus(d.scaled(2)), dist: B.offset(0.5, 0, 0.5).distanceTo(me) });
                    break;
                }
            }
        }
        return found.sort((a, b) => a.dist - b.dist).slice(0, SLEEP.spotCandidates);
    }

    // Why the bed may not go at F = B + d, H = B + 2d; null when it may.
    spotProblem(B, d) {
        const bot = this.bot;
        const F = B.plus(d);
        const H = F.plus(d);
        for (const c of [F, H]) {
            if (!isAir(bot.blockAt(c))) return 'not air';
            if (!isAir(bot.blockAt(c.offset(0, 1, 0)))) return 'no room above';
            if (!fullCube(bot.blockAt(c.offset(0, -1, 0)))) return 'no full floor';
            if (liquidBeside(bot, c)) return 'next to water';
        }
        for (const c of [B, F, H]) if (othersIn(bot, c)) return 'someone is there';
        if (this.inClear([F, H, F.offset(0, -1, 0), H.offset(0, -1, 0)])) return 'in a clear box';
        if (hostileInBedBox(bot, H)) return 'a hostile is near';
        return null;
    }

    // My bed, re-validated the same way before it is reused.
    bedProblem(entry) {
        const bot = this.bot;
        const foot = bot.blockAt(vec(entry.pos));
        if (!foot || foot.name !== entry.block) return 'not there';
        const H = partnerOf(foot);
        const head = H && bot.blockAt(H);
        if (!head || head.name !== foot.name || props(head).part !== 'head') return 'not whole';
        for (const c of [foot.position, H]) {
            if (liquidBeside(bot, c)) return 'next to water';
            if (othersIn(bot, c)) return 'someone is there';
        }
        if (this.inClear([foot.position, H, foot.position.offset(0, -1, 0), H.offset(0, -1, 0)])) return 'in a clear box';
        if (hostileInBedBox(bot, H)) return 'a hostile is near';
        return null;
    }

    // An active clear step's box or kept shell holds one of the cells. (No
    // live build blueprint exists before S3.)
    inClear(cells) {
        const scope = this.work.clearScope();
        return Boolean(scope) && cells.some(c => scope.inBox(c) || scope.inShell(c));
    }

    // Every walk: no digging, no towers, no scaffold; bounded by
    // SLEEP.walkMs (the pathfinder is stopped then). True when the walk
    // ended without an interruption; the caller checks where she is.
    async walk(goal) {
        const bot = this.bot;
        let bounded = false;
        const timer = setTimeout(() => { bounded = true; bot.pathfinder?.setGoal?.(null); }, SLEEP.walkMs);
        try {
            await skills.goToGoal(bot, goal, NO_DIG);
            return !this.halted() && !bounded;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
            if (bounded) this.log(`a walk ran out of its ${SLEEP.walkMs} ms`);
        }
    }

    // 2. Place: in B, re-check the cells, equip the bed, click the top of F's
    // support (mineflayer looks toward F first), verify both halves, flush
    // the ledger entry synchronously. {entry} or {outcome}.
    async place(spot) {
        const bot = this.bot;
        if (!overworld(bot)) return { outcome: { failed: 'not in the overworld' } };
        const why = this.spotProblem(spot.B, spot.d);
        if (why) return { outcome: { failed: `the spot changed: ${why}` } };
        const item = bedItem(bot);
        if (!item) return { outcome: { failed: 'no bed' } };
        try {
            await bot.equip(item, 'hand');
        } catch (err) {
            if (this.halted()) return { outcome: { interrupted: true } };
            return { outcome: { failed: `could not hold the bed (${err?.message ?? err})` } };
        }
        if (this.halted()) return { outcome: { interrupted: true } };
        // The equip awaited: the dimension and the cells again.
        if (!overworld(bot)) return { outcome: { failed: 'not in the overworld' } };
        const changed = this.spotProblem(spot.B, spot.d);
        if (changed) return { outcome: { failed: `the spot changed: ${changed}` } };
        const held = countOf(bot, item.name);
        try {
            await bot.placeBlock(bot.blockAt(spot.F.offset(0, -1, 0)), UP);
        } catch (err) {
            // An issued placement that timed out (mineflayer gives up after 5 s
            // with no update for the cell, so blockPlaced never fires): the bed
            // may still arrive. Hers only when her bed appears at F and her bed
            // item count dropped by one within SLEEP.lateMs; otherwise nothing
            // new (a bed there stays protected). A refusal is never adopted.
            if (!/refused/i.test(String(err?.message ?? err)) && await this.lateBed(spot.F, item.name, held)) {
                this.work.ledger?.add({ pos: { x: spot.F.x, y: spot.F.y, z: spot.F.z }, block: item.name, kind: 'own', by: SLEEP_LABEL,
                    dim: bot.game?.dimension ?? 'overworld', at: this.work.ledger.now?.() ?? Date.now() });
                this.log(`the placement answered late (${err?.message ?? err}); the bed at ${fmt(spot.F)} is mine`);
            }
            if (this.halted()) return { outcome: { interrupted: true } };
            if (!this.entryAt(spot.F)) return { outcome: { failed: `the placement was refused (${err?.message ?? err})` } };
        }
        const entry = this.entryAt(spot.F);
        const whole = () => {
            const foot = bot.blockAt(spot.F);
            const head = bot.blockAt(spot.H);
            const fp = props(foot);
            return isBed(foot?.name) && fp.part === 'foot' && fp.facing === spot.facing
                && head?.name === foot.name && props(head).part === 'head';
        };
        // The placement resolves on the foot's update; the head comes in its
        // own update after it (live 2026-11-12: 1 ms later), so wait for it.
        const until = Date.now() + SLEEP.lateMs;
        while (!whole() && Date.now() < until) await wait(50);
        if (!whole()) {
            if (entry) await this.pickup(entry);
            return { outcome: { failed: 'the bed was not placed whole where planned' } };
        }
        if (!entry) {
            // An unrecorded bed is protected like any non-natural block: not hers to dig.
            this.tellOnce('left', spot.F, { ob: `${bot.game?.dimension ?? 'overworld'}:${fmt(spot.F)}:unrecorded` });
            return { outcome: { failed: 'the bed was not recorded' } };
        }
        try {
            this.work.ledger.flush();
        } catch (err) {
            await this.pickup(entry);
            return { outcome: { failed: `could not save the bed's record (${err?.message ?? err})` } };
        }
        this.log(`placed ${entry.block} at ${fmt(spot.F)} (head ${fmt(spot.H)}, facing ${spot.facing})`);
        return { entry };
    }

    // After a timed-out placement: true when, within SLEEP.lateMs, the cell
    // shows her bed (not yet recorded) and her count of that bed item is one
    // less than before the placement.
    async lateBed(F, name, held) {
        const bot = this.bot;
        const mine = () => bot.blockAt(F)?.name === name && countOf(bot, name) === held - 1 && !this.entryAt(F);
        const until = Date.now() + SLEEP.lateMs;
        while (!mine() && Date.now() < until) await wait(50);
        return mine();
    }

    // --- the pickup (REQ-SLP-5, 6) -------------------------------------------------------

    // Dig the foot through the dig seam with the ownBed exemption, then
    // collect the drop. 'done' (back in the bag), 'soft' (retry later: occupied,
    // interrupted, not loaded, unreachable for now: told once, kept), 'left' /
    // 'lost' (told once; no longer hers), 'held' (no free slot for the bed: it
    // stays placed and recorded, told once). The pickup itself needs only the
    // bed's own slot; the 2 free slots gate only the Work.tick launch.
    async pickup(entry) {
        const bot = this.bot;
        const ob = this.obligation(entry);
        if (bot.inventory.emptySlotCount() < SLEEP.pickupSlots) {
            this.log(`my bed at ${fmt(entry.pos)} stays: fewer than ${SLEEP.pickupSlots} free slot`);
            this.tellOnce('full', entry.pos, { ob, slots: SLEEP.pickupSlots });
            return 'held';
        }
        const pos = vec(entry.pos);
        let foot = bot.blockAt(pos);
        if (!foot) return 'soft';
        if (foot.name !== entry.block) return this.missing(entry, foot);
        if (eyeDistance(bot, pos) > REACH) {
            await this.walk(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 2));
            if (this.halted()) return 'soft';
            if (eyeDistance(bot, pos) > REACH) {
                // Unreachable for now: the obligation is kept, as for a bed beyond 16.
                this.log(`my bed at ${fmt(entry.pos)} is out of reach for now`);
                this.tellOnce('left', entry.pos, { ob });
                this.unreachable.add(ob);
                return 'soft';
            }
            this.unreachable.delete(ob);
            foot = bot.blockAt(pos);
            if (!foot) return 'soft';
            if (foot.name !== entry.block) return this.missing(entry, foot);
        }
        // Both halves: occupancy and hazards; again right before the dig packet.
        const hazard = (block, live) => {
            if (live && this.work.ledger?.get(entry.pos) !== entry) return { soft: 'no longer my bed' };
            const head = partnerOf(block);
            if (live && (!head || bot.blockAt(head)?.name !== block.name)) return { soft: 'not whole' };
            for (const c of [pos, head].filter(Boolean)) {
                if (othersIn(bot, c)) return { soft: 'occupied' };
                if (liquidBeside(bot, c)) return { hard: 'next to water' };
                if (falls(bot.blockAt(c.offset(0, 1, 0))?.name)) return { hard: 'under a falling block' };
            }
            return null;
        };
        const before = hazard(foot, false);
        if (before?.soft) return 'soft';
        if (before?.hard) return this.leave(entry, before.hard);
        const count = bedCount(bot);
        const final = block => { const h = hazard(block, true); return h ? (h.soft ?? h.hard) : null; };
        const result = await digCell(bot, foot, { move: false, hand: true, ownBed: entry, standing: true, dim: entry.dim, final });
        if (!result.ok) {
            if (result.soft || result.reason === 'out of reach') return 'soft';
            return this.leave(entry, result.reason);
        }
        this.receipt = { pos: { ...entry.pos }, dim: entry.dim, item: entry.block, at: Date.now(), count, ob };
        this.log(`dug my bed at ${fmt(entry.pos)}; collecting it`);
        return this.collect();
    }

    // The dropped bed item near the receipt's cell.
    drop(receipt) {
        const center = vec(receipt.pos).offset(0.5, 0.5, 0.5);
        let best = null;
        for (const e of Object.values(this.bot.entities ?? {})) {
            if (e?.name !== 'item' || !e.position || !isBed(e.getDroppedItem?.()?.name)) continue;
            const d = e.position.distanceTo(center);
            if (d <= SLEEP.dropRadius && (!best || d < best.d)) best = { e, d };
        }
        return best?.e ?? null;
    }

    // Collect the receipt's drop: wait for it (contact pickup often takes it
    // at once), walk to it (bounded), check the bed count rose.
    async collect() {
        const r = this.receipt;
        if (!r) return 'done';
        const bot = this.bot;
        const back = () => bedCount(bot) > r.count;
        const settle = async () => {
            const until = Date.now() + SLEEP.dropWaitMs;
            while (!back() && !this.halted() && Date.now() < until) await wait(50);
        };
        const until = Date.now() + SLEEP.dropWaitMs;
        while (!back() && !this.halted() && !this.drop(r) && Date.now() < until) await wait(50);
        // Into the drop's own cell: contact pickup reaches about a block past
        // her body, and a goal within 1 block is often met where she wakes, so
        // she never moved and the bed slid out of reach (live 2026-11-12). Again
        // while it lies in another cell: it slides after it lands.
        let last = null;
        for (let i = 0; i < SLEEP.collectWalks && !back() && !this.halted(); i++) {
            const item = this.drop(r);
            if (!item) break;
            const p = item.position.floored();
            if (last?.equals(p)) break;   // it has not moved since the last walk
            last = p;
            await this.walk(new pf.goals.GoalBlock(p.x, p.y, p.z));
            await settle();
        }
        if (back()) {
            this.receipt = null;
            this.took(r.ob);
            return 'done';
        }
        if (this.halted()) return 'soft';   // the receipt stays for Work.tick
        // No room for the bed: not lost; the receipt stays until its expiry.
        if (bot.inventory.emptySlotCount() < SLEEP.pickupSlots) {
            this.log(`no room for my bed at ${fmt(r.pos)}; collecting it later`);
            return 'soft';
        }
        this.lose(r);
        return 'lost';
    }

    took(ob) {
        if (this.bot.modes) this.bot.modes.behavior_log += 'Took my bed back.\n';
        this.log('took my bed back');
        this.resolve(ob);
    }

    // The receipt's drop is gone: told once, the obligation ends.
    lose(receipt) {
        if (this.receipt === receipt) this.receipt = null;
        this.log(`lost my bed at ${fmt(receipt.pos)}`);
        this.tellOnce('lost', receipt.pos, { ob: receipt.ob });
        this.resolve(receipt.ob);
    }

    // My bed's cell shows another block: the entry goes (the retire listener,
    // retired(), tells the owner once).
    missing(entry, block) {
        this.work.ledger?.retire(entry.pos, `now ${block.name}`);
        return 'lost';
    }

    // A hard refusal: told once, and the entry goes (the block, if it stays,
    // is no longer hers and is protected like any non-natural block).
    leave(entry, why) {
        const ob = this.obligation(entry);
        this.log(`left my bed at ${fmt(entry.pos)}: ${why}`);
        this.tellOnce('left', entry.pos, { ob });
        this.leaving = entry;
        try {
            this.work.ledger?.retire(entry.pos, `left by the sleep routine: ${why}`);
        } finally {
            this.leaving = null;
        }
        this.resolve(ob);
        return 'left';
    }

    // REQ-SLP-8: the owner lines are `alert`s, each said once per obligation
    // (one placed bed or its drop; forgotten when it resolves), or once per
    // session (`ob` null: the night that did not skip); the rest is `detail`.
    tellOnce(what, pos = null, { ob = null, category = 'alert', slots } = {}) {
        const key = ob ?? 'session';
        const line = slots == null ? what : `${what}:${slots}`;   // each slot count its own line (N2)
        let said = this.told.get(key);
        if (!said) this.told.set(key, said = new Set());
        if (said.has(line)) return;
        said.add(line);
        this.work.postReport(bedLine(what, pos, slots), { category });
    }

    // --- the bed pickup from Work.tick (REQ-SLP-5) -------------------------------------------

    // Before Work.tick's active-task guard, whatever work.sleep.when says: a
    // receipt whose bed is back (any pickup) is closed and an old one is
    // lost; a recorded bed whose cell shows another block is lost. A pending
    // receipt's drop within 16 is collected first, also at night (so no new
    // sleep overwrites it); my bed within 16 that is not wanted for sleeping
    // is taken back. Either runs as action:bed, cutting only what sleep may
    // cut. A bed beyond 16 (loaded or not) is told once and kept.
    reconcile() {
        if (this.disposed || this.latch || this.running || this.work.items?.latch) return;
        const bot = this.bot;
        const r = this.receipt;
        if (r) {
            if (bedCount(bot) > r.count) { this.receipt = null; this.took(r.ob); }
            else if (Date.now() - r.at >= SLEEP.receiptMs) this.lose(r);
        }
        for (const entry of this.gone()) this.missing(entry, bot.blockAt(vec(entry.pos)));
        if (Date.now() < this.retryAt) return;
        const dim = bot.game?.dimension ?? 'overworld';
        let target = null;
        let ob = null;
        let pos = null;
        if (this.receipt && this.receipt.dim === dim && bot.entity.position.distanceTo(vec(this.receipt.pos)) <= SLEEP.reuseRadius) {
            target = { receipt: this.receipt };
            ({ ob, pos } = this.receipt);
        } else if (!this.wanted()) {
            const beds = this.myBeds();
            // The obligation is kept whatever the distance; told once.
            for (const b of beds) if (b.dist > SLEEP.reuseRadius) this.tellOnce('left', b.entry.pos, { ob: this.obligation(b.entry) });
            const bed = beds.find(b => b.loaded && b.dist <= SLEEP.reuseRadius) ?? null;
            if (!bed) return;
            target = { entry: bed.entry };
            ob = this.obligation(bed.entry);
            pos = bed.entry.pos;
        }
        if (!target) return;
        // The launch gate for both targets (junk design §5, amendment 1).
        if (bot.inventory.emptySlotCount() < SLEEP.freeSlots) {
            this.tellOnce('full', pos, { ob, slots: SLEEP.freeSlots });
            return;
        }
        // An unreachable bed is retried only while she has nothing to do (N3).
        const idleOnly = Boolean(target.entry && this.unreachable.has(ob));
        if (!this.mayCut(idleOnly ? 'idle' : this.when())) return;
        this.launch(target);
    }

    // One synchronous latch, cleared in finally; the goal loop is stopped
    // like execute() does (non-awaited); the callback re-validates the entry,
    // stop_epoch and the policy (a placed bed is not taken while it is wanted
    // for sleeping; a receipt is collected also at night) when it starts.
    launch(target) {
        const agent = this.agent;
        const stopEpoch = agent.stop_epoch;
        this.latch = true;
        if (agent.self_prompter?.isActive()) agent.self_prompter.stopLoop();
        this.log(`taking my bed back (${target.entry ? fmt(target.entry.pos) : `the drop at ${fmt(target.receipt.pos)}`})`);
        let started;
        try {
            started = agent.actions.runAction(BED_LABEL, async () => {
                this.work.holdStall();
                try {
                    if (agent.stop_epoch !== stopEpoch) return;
                    if (target.entry && (this.wanted() || this.work.ledger?.get(target.entry.pos) !== target.entry)) return;
                    if (target.receipt && this.receipt !== target.receipt) return;
                    const outcome = target.entry ? await this.pickup(target.entry) : await this.collect();
                    if (outcome === 'soft') this.retryAt = Date.now() + SLEEP.cooldownMs;
                } catch (err) {
                    console.error('[sleep] the bed pickup failed:', err);
                } finally {
                    this.work.releaseStall();
                }
            }, { timeout: -1 });
        } catch (err) {
            this.latch = false;
            console.error('[sleep] could not start the bed pickup:', err);
            return;
        }
        Promise.resolve(started).catch(err => console.error('[sleep] the bed pickup ended with an error:', err))
            .finally(() => { this.latch = false; });
    }
}
