import Vec3 from 'vec3';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { digCell, eyeDistance, REACH } from './dig.js';
import { ledgerFor } from './ledger.js';
import { isNaturalBlockName, protectorFor } from './protect.js';
import { tidyLine } from './report.js';
import { chatShown } from './chat.js';

// Tidying the bot's own scaffold (SPEC §11.10, REQ-OWN-7 … 10): the sweep
// `tidyNear`, one function for every trigger, removes the live scaffold
// entries within reach without moving; `Tidy` holds the active sweep, the
// interrupted remainder, the launch checks of the triggers (after a mode, at
// task end, `!tidy`) and the owner's !stop keep. S3's build cleanup wraps the
// sweep with its own approach walk (REQ-BLD-23).

export const TIDY_MAX_DIGS = 32;        // constants, not keys (SPEC §14)
export const TIDY_MAX_MS = 60000;
export const TIDY_HOSTILE_RADIUS = 16;
const MODEL_STOP_MS = 60000;            // a !stop this soon after an owner message counts as the owner's
const REMAINDER_MS = 300000;            // an interrupted remainder expires after 5 minutes
// The waits of the sweep and its triggers (SPEC §14 constants; tests shorten them).
export const TIDY = {
    landMs: 2000,         // pillar-down: grounded one block lower within this, else the sweep ends
    pollMs: 50,
    taskEndMs: 5000,      // the task-end launch window
    recheckMs: 5000,      // after a mode, while a hostile is near
    recheckForMs: 60000,
};
const HALF_WIDTH = 0.3;   // the bot's hitbox half width
const EMPTY = ['air', 'cave_air', 'void_air'];
const LIQUIDS = ['water', 'lava', 'bubble_column'];
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const UNDER = 'part of what I stand on';
const BURIED = 'under a block that stays';

const tidies = new WeakMap();   // bot -> Tidy (the sweep registers itself there)
export const tidyFor = bot => tidies.get(bot) ?? null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = p => `${p.x},${p.y},${p.z}`;
const vec = p => new Vec3(p.x, p.y, p.z);
const dimOf = bot => bot.game?.dimension ?? 'overworld';
const grounded = bot => Boolean(bot.entity?.onGround);
const hostileNear = bot => Boolean(world.getNearestEntityWhere(bot, e => mc.isHostile(e), TIDY_HOSTILE_RADIUS));
// REQ-OWN-4: which old (gap) scaffold is still the bot's, for
// ledger.scaffoldEligible: the Protector's component guard.
const guardOf = bot => ({ gap: entry => Boolean(protectorFor(bot)?.gapHers(entry)) });

// The cells under the bot's hitbox footprint (x ± 0.3, z ± 0.3 at its feet).
function footprint(bot) {
    const p = bot.entity.position;
    const y = Math.floor(p.y - 0.01);
    const cells = new Map();
    for (const dx of [-HALF_WIDTH, HALF_WIDTH]) for (const dz of [-HALF_WIDTH, HALF_WIDTH]) {
        const cell = { x: Math.floor(p.x + dx), y, z: Math.floor(p.z + dz) };
        cells.set(key(cell), cell);
    }
    return [...cells.values()];
}

// A block the bot placed (an entry of any kind, live or not) that is still there.
function recorded(bot, ledger, pos) {
    const entry = ledger.entryAt(pos);
    return entry && bot.blockAt(vec(pos))?.name === entry.block ? entry : null;
}

// The structure under the bot: the components of its recorded blocks that a
// cell under its footprint belongs to, computed before any eligibility filter.
export function standingOn(bot, ledger) {
    const component = new Map();
    const queue = footprint(bot).filter(c => recorded(bot, ledger, c));
    for (const c of queue) component.set(key(c), c);
    for (let i = 0; i < queue.length; i++) {
        for (const [dx, dy, dz] of FACES) {
            const next = { x: queue[i].x + dx, y: queue[i].y + dy, z: queue[i].z + dz };
            if (component.has(key(next)) || !recorded(bot, ledger, next)) continue;
            component.set(key(next), next);
            queue.push(next);
        }
    }
    return component;
}

// A full cube: one collision box filling the cell (a slab or a fence is not,
// though both have boundingBox 'block').
const FULL = [0, 0, 0, 1, 1, 1];
export const fullCube = block => block?.shapes?.length === 1 && block.shapes[0].every((v, i) => v === FULL[i]);

// Pillar-down: the block under the bot, when the structure it stands on is a
// plain vertical column of live scaffold (passing `want`) on a loaded full
// cube; else null.
function pillarTop(bot, ledger, under, want) {
    if (!under.size || !grounded(bot)) return null;
    const cells = [...under.values()];
    const { x, z } = cells[0];
    if (cells.some(c => c.x !== x || c.z !== z)) return null;
    for (const c of cells) {
        const entry = ledger.entryAt(c);
        if (!ledger.scaffoldEligible(entry, guardOf(bot)) || !want(entry)) return null;
    }
    const ys = cells.map(c => c.y);
    const support = bot.blockAt(new Vec3(x, Math.min(...ys) - 1, z));
    if (!fullCube(support) || LIQUIDS.includes(support.name)) return null;
    return { x, y: Math.max(...ys), z };
}

// Top-down: removable only when what is above is air, or a non-solid natural
// block that breaks with its support (snow layer, short grass, flowers).
function freeAbove(bot, pos) {
    const above = bot.blockAt(new Vec3(pos.x, pos.y + 1, pos.z));
    if (!above) return false;
    if (EMPTY.includes(above.name)) return true;
    return above.boundingBox === 'empty' && !LIQUIDS.includes(above.name) && isNaturalBlockName(above.name);
}

// Live scaffold entries of this dimension within reach, block still matching:
// top-down, then nearest first.
function candidates(bot, ledger, dim, want) {
    const found = [];
    for (const entry of ledger.list()) {
        if (entry.kind !== 'scaffold' || entry.dim !== dim || !want(entry)) continue;
        if (eyeDistance(bot, entry.pos) > REACH || bot.blockAt(vec(entry.pos))?.name !== entry.block) continue;
        if (!ledger.scaffoldEligible(entry, guardOf(bot))) continue;
        found.push(entry);
    }
    return found.sort((a, b) => b.pos.y - a.pos.y || eyeDistance(bot, a.pos) - eyeDistance(bot, b.pos));
}

async function landed(bot, y) {
    const by = Date.now() + TIDY.landMs;
    for (;;) {
        if (grounded(bot) && Math.floor(bot.entity.position.y + 0.01) === y) return true;
        if (bot.interrupt_code || Date.now() >= by) return false;
        await sleep(TIDY.pollMs);
    }
}

const reasonOf = refusal => refusal.reason === 'occupied' ? (refusal.by === 'me' ? 'I stand on it' : 'a player is on it') : refusal.reason;
// Reasons that end the sweep rather than describe a cell.
const ENDS = new Set(['interrupted', 'in another dimension', 'not on the ground', 'a hostile is near', 'sweep limit']);

// The sweep (REQ-OWN-7). `only_by` limits it to entries placed under those
// action labels (a sweep inside a task). Never moves, places or paths: digs
// go through the dig seam with move and obtain off, by hand when no held tool
// harvests. Returns {removed: [pos], left: [{pos, block, reason, cell}],
// ended, interrupted}; `ended` is null when it ran to its end, and `cell`
// marks a block left for a reason of its own (not because the sweep ended).
export async function tidyNear(bot, { only_by = null, now = Date.now } = {}) {
    const ledger = ledgerFor(bot);
    const removed = [];
    const left = new Map();
    if (!ledger) return { removed, left: [], ended: 'no ledger', interrupted: false };
    // The sweep context, registered for the whole run: what an owner !stop
    // keeps (and the dig it cancels).
    const sweep = { candidates: new Map(), attempts: [], kept: false, digging: false };
    const registry = tidyFor(bot);
    registry?.begin(sweep);
    const started = now();
    const dim = dimOf(bot);
    const want = e => !only_by || only_by.has(e.by);
    let digs = 0;
    let ended = null;
    const halted = () => bot.interrupt_code ? 'interrupted' : sweep.kept ? 'kept (stopped)' : null;
    const stop = () => halted()
        ?? (dimOf(bot) !== dim ? 'in another dimension' : null)
        ?? (digs >= TIDY_MAX_DIGS || now() - started >= TIDY_MAX_MS ? 'sweep limit' : null)
        ?? (hostileNear(bot) ? 'a hostile is near' : null)
        ?? (grounded(bot) ? null : 'not on the ground');
    const choose = () => {
        const chosen = candidates(bot, ledger, dim, want);
        for (const entry of chosen) sweep.candidates.set(key(entry.pos), entry.pos);
        return chosen;
    };
    const leave = (entry, reason) => left.set(key(entry.pos), { pos: entry.pos, block: entry.block, reason, cell: true });
    const gone = entry => { left.delete(key(entry.pos)); sweep.candidates.delete(key(entry.pos)); };
    // Why this entry may not be dug now: the sweep's own checks, also run by
    // the dig seam synchronously right before the dig packet.
    const veto = (entry, pillar) => {
        const why = stop();
        if (why) return why;
        if (ledger.get(entry.pos) !== entry || !want(entry) || bot.blockAt(vec(entry.pos))?.name !== entry.block) return 'changed';
        if (!ledger.scaffoldEligible(entry, guardOf(bot))) return 'changed';   // kept by the owner, or no longer hers (REQ-OWN-4)
        if (pillar) {
            const top = pillarTop(bot, ledger, standingOn(bot, ledger), want);
            return top && key(top) === key(entry.pos) ? null : UNDER;
        }
        if (standingOn(bot, ledger).has(key(entry.pos))) return UNDER;   // the footprint, recomputed (knockback, water)
        if (!freeAbove(bot, entry.pos)) return BURIED;
        return null;
    };
    const dig = async (entry, pillar = false) => {
        const before = veto(entry, pillar);
        let result = before ? { ok: false, reason: before } : null;
        if (!result) {
            sweep.digging = true;
            try {
                result = await digCell(bot, bot.blockAt(vec(entry.pos)), { move: false, obtain: false, hand: true, dim,
                    standing: pillar, final: () => veto(entry, pillar) });
            } finally {
                sweep.digging = false;
                digs++;
            }
        }
        if (result.ok) {
            removed.push(entry.pos);
            gone(entry);
            return true;
        }
        const why = halted() ?? result.reason;
        if (halted() || ENDS.has(why)) ended = why;
        else if (why === 'changed') gone(entry);   // no longer the bot's block
        else leave(entry, reasonOf(result));
        return false;
    };
    try {
        // The candidates and pending attempts within reach are registered
        // before the first await, so a stop during the settle wait keeps them.
        choose();
        sweep.attempts = [...ledger.attempts.values()].filter(a => a.dim === dim && want(a) && eyeDistance(bot, a.pos) <= REACH);
        // Pending attempts settle first (at most the settle window, plus one
        // poll as a margin), so the top of a pillar just built is not missed.
        const settled = Date.now() + ledger.settleMs + TIDY.pollMs;
        while (!halted() && sweep.attempts.some(a => ledger.attempts.get(a.key) === a) && Date.now() < settled) await sleep(TIDY.pollMs);
        rounds: while (!(ended = halted())) {
            if (!grounded(bot)) { ended = 'not on the ground'; break; }
            for (const entry of choose()) {
                const k = key(entry.pos);
                // A cell refusal stands; only these can change after pillar-down.
                if (left.has(k) && left.get(k).reason !== UNDER && left.get(k).reason !== BURIED) continue;
                await dig(entry);
                if (ended) break rounds;
            }
            // Pillar-down: dig the block under the bot, land one lower, choose again.
            const top = pillarTop(bot, ledger, standingOn(bot, ledger), want);
            if (!top) break;
            const entry = ledger.get(top);
            sweep.candidates.set(key(top), top);
            if (!(await dig(entry, true))) break;
            if (!(await landed(bot, top.y))) { ended = halted() ?? 'did not land one block lower'; break; }
        }
    } finally {
        // What was chosen and is still there stays live, with why.
        for (const [k, pos] of sweep.candidates) {
            const entry = ledger.get(pos);
            if (!left.has(k) && entry) left.set(k, { pos, block: entry.block, reason: ended ?? 'not reached', cell: false });
        }
        registry?.end(sweep, ended);
    }
    return { removed, left: [...left.values()], ended, interrupted: ended === 'interrupted' || sweep.kept };
}

// The work layer's tidying: one per Work instance (agent.work.tidy).
export class Tidy {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        this.sweep = null;       // the active sweep
        this.remainder = null;   // a mode-interrupted sweep's rest, until the next sweep starts
        this.deferred = null;    // a mode-end request waiting out a hostile
        this.keeps = 0;          // the keep generation: every owner keep cancels scheduled triggers
        this.timers = new Set();
        tidies.set(this.bot, this);
    }

    get config() { return this.work.config.tidy; }
    get ledger() { return this.work.ledger; }

    dispose() {
        this.disposed = true;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        if (tidies.get(this.bot) === this) tidies.delete(this.bot);
    }

    later(fn, ms) {
        const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) fn(); }, ms);
        timer.unref?.();
        this.timers.add(timer);
        return timer;
    }

    // --- the sweep context (REQ-OWN-7) ------------------------------------------

    // Every action start (Work's runtime wrap of actions.runAction): what
    // interrupted a sweep is the last action started while it ran.
    onActionStart(label) {
        this.lastStarted = label;
    }

    // A new sweep supersedes the interrupted remainder (attempts already marked
    // keep stay keep: the mark is on the attempt).
    begin(sweep) {
        this.remainder = null;
        this.lastStarted = null;
        this.sweep = sweep;
    }

    // Only a mode's interruption keeps a remainder (REQ-OWN-7).
    end(sweep, ended) {
        if (this.sweep === sweep) this.sweep = null;
        if (ended === 'interrupted' && !sweep.kept && String(this.lastStarted).startsWith('mode:')) {
            sweep.at = this.work.now();
            this.remainder = sweep;
        }
    }

    // One sweep, for every trigger: logged (REQ-OBS-4) and its line posted
    // (REQ-OWN-10): always into history, to chat as `detail` (REQ-CHAT-1). The
    // line reports only blocks left for a reason of their own; a sweep that
    // removed nothing and left nothing for such a reason (ended by a hostile,
    // a bound, the ground) says nothing.
    async run(trigger, { only_by = null } = {}) {
        const result = await tidyNear(this.bot, { only_by, now: this.work.now });
        const removed = result.removed.map(key).join(' ');
        const left = result.left.map(l => `${key(l.pos)} ${l.reason}`).join('; ');
        this.work.log(`tidy (${trigger}): removed ${result.removed.length}${removed ? `: ${removed}` : ''}; ` +
            `left ${result.left.length}${left ? `: ${left}` : ''}${result.ended ? `; ended: ${result.ended}` : ''}`);
        const cells = result.left.filter(l => l.cell);
        result.line = result.removed.length || cells.length ? tidyLine({ removed: result.removed, left: cells }) : null;
        if (result.line && !result.interrupted) {
            result.posted = true;
            result.said = chatShown(this.agent, 'detail');
            this.work.postReport(result.line, { category: 'detail' });
        }
        return result;
    }

    launch(trigger) {
        this.work.log(`tidy: starting action:tidy (${trigger})`);
        this.agent.actions.runAction('action:tidy', async () => {
            try {
                await this.run(trigger);
            } catch (err) {
                console.error('[work] the tidy sweep failed:', err);
            }
        }, { timeout: -1 }).catch(err => console.error('[work] could not start the tidy sweep:', err));
    }

    // Live or pending scaffold within reach that passes `want` (old scaffold
    // only while the component guard says it is the bot's, REQ-OWN-4).
    within(want = () => true) {
        const bot = this.bot;
        const dim = dimOf(bot);
        const near = e => e.dim === dim && want(e) && eyeDistance(bot, e.pos) <= REACH;
        const live = this.ledger.list().filter(e => e.kind === 'scaffold' && near(e) && this.ledger.scaffoldEligible(e, guardOf(bot)));
        return [...live, ...[...this.ledger.attempts.values()].filter(near)];
    }

    modeScaffold() {
        return this.within(e => typeof e.by === 'string' && e.by.startsWith('mode:'));
    }

    // No action executing or stopping.
    quiet() {
        const actions = this.agent.actions;
        return !actions.executing && !actions.stopPromise && !this.bot.interrupt_code;
    }

    // --- triggers (REQ-OWN-8) ---------------------------------------------------

    // 1. Task end, from the run's finally: never awaited (starting the sweep
    // inside the run would deadlock on runAction stopping action:task).
    scheduleTaskEnd(record) {
        const terminal = () => record.status === 'done' || record.status === 'failed';
        if (!this.config.enabled || !record || !terminal()) return;
        const { agent } = this;
        const actions = agent.actions;
        const stopEpoch = agent.stop_epoch;
        const lastAction = actions.last_action_time;
        const keeps = this.keeps;
        const until = Date.now() + TIDY.taskEndMs;
        const check = () => {
            if (actions.executing) {
                if (Date.now() < until) this.later(check, TIDY.pollMs);
                return;
            }
            if (Date.now() >= until || this.keeps !== keeps || this.work.record !== record || !terminal() || agent.stop_epoch !== stopEpoch
                || actions.last_action_time !== lastAction || !agent.isIdle() || !this.within().length) return;
            this.launch(`task end, ${record.status}`);
        };
        this.later(check, 0);
    }

    // 2. After a mode: the modes carry calls this at the end of execute. The
    // stop epoch, the last action, the keep generation and the deadline are
    // captured here, before any timer.
    onModeEnd(name, codeReturn) {
        if (!this.config.enabled || codeReturn?.interrupted) return;
        const since = { stopEpoch: this.agent.stop_epoch, lastAction: this.agent.actions.last_action_time,
            keeps: this.keeps, until: Date.now() + TIDY.recheckForMs };
        this.later(() => this.afterMode(name, since), 0);
    }

    // Nothing stopped or kept, no action started since `since`, and its deadline not passed.
    unchanged(since) {
        return this.agent.stop_epoch === since.stopEpoch && this.agent.actions.last_action_time === since.lastAction
            && this.keeps === since.keeps && Date.now() < since.until;
    }

    afterMode(name, since) {
        if (!this.quiet() || !this.unchanged(since)) return;
        const near = this.modeScaffold();
        if (!near.length) return;
        if (this.work.hasLiveTask()) {
            // The runner sweeps them at the start of its next unit.
            const runner = this.work.runner;
            runner.tidyAfterMode = new Set([...(runner.tidyAfterMode ?? []), ...near.map(e => e.by)]);
            this.work.log(`tidy: after ${name}, during the task: the next unit sweeps ${[...runner.tidyAfterMode].join(', ')}`);
            return;
        }
        if (this.agent.actions.resume_func) return;   // a resumable action (following) resumes first
        this.cancelDeferred();
        const request = { name, since, timer: null };
        this.deferred = request;
        this.tryAfterMode(request);
    }

    // Every launch, first or re-check, re-validates everything right before
    // it: any stop or action since the mode ended, or a passed deadline, ends it.
    tryAfterMode(request) {
        if (this.deferred !== request) return;
        request.timer = null;
        const valid = this.unchanged(request.since) && this.quiet() && !this.work.hasLiveTask()
            && !this.agent.actions.resume_func && this.modeScaffold().length > 0;
        if (!valid) { this.deferred = null; return; }
        if (hostileNear(this.bot)) {
            request.timer = this.later(() => this.tryAfterMode(request), TIDY.recheckMs);
            return;
        }
        this.deferred = null;
        this.launch(`after ${request.name}`);
    }

    cancelDeferred() {
        const request = this.deferred;
        this.deferred = null;
        if (request?.timer) { clearTimeout(request.timer); this.timers.delete(request.timer); }
    }

    // 3. !tidy: the same sweep as action:tidy; refused while a task is live.
    // REQ-OWN-10: a posted line is already in history, so a !tidy in her own
    // turns returns nothing then; in the owner's turn, typed by him or issued
    // by the model for his words (fix wave 1, G2), it returns the line
    // whenever the chat line was not said. A sweep with no line answers as before.
    async command() {
        if (this.work.hasLiveTask()) return 'A task is running; I tidy when it ends.';
        let result = null;
        const code = await this.agent.actions.runAction('action:tidy', async () => { result = await this.run('!tidy'); }, { timeout: -1 });
        if (code.interrupted || result?.interrupted) return;
        if (!result) return code.message;
        if (result.posted) return !result.said && this.work.turnVoice() === 'owner' ? result.line : undefined;
        return result.line ?? (result.ended ? `Nothing tidied (${result.ended}).` : 'No scaffold of mine within reach.');
    }

    // --- owner !stop (REQ-OWN-9) -------------------------------------------------

    // The active sweep, or else the interrupted remainder (for 5 minutes), is
    // kept at once; the active sweep's dig in progress is cancelled (no dig
    // starts after a keep: the sweep re-checks before every dig packet);
    // deferred mode-tidy requests are cancelled.
    keep(why) {
        this.keeps++;   // also with no target: a scheduled trigger's check sees it
        this.cancelDeferred();
        if (this.work.runner) this.work.runner.tidyAfterMode = null;
        if (this.remainder && this.work.now() - this.remainder.at > REMAINDER_MS) this.remainder = null;
        const target = this.sweep ?? this.remainder;
        if (!target) return;
        target.kept = true;
        if (target === this.sweep && target.digging) this.bot.stopDigging();
        if (target === this.remainder) this.remainder = null;
        try {
            this.ledger.keep({ candidates: [...target.candidates.values()], attempts: target.attempts }, why);
        } catch (err) {
            console.error('[work] could not write the kept scaffold:', err?.message ?? err);
        }
    }

    // The !stop command: within 60 s of an owner message it counts as the
    // owner's (he said "stop tidying" in words); any other keeps nothing.
    onStopCommand() {
        const last = this.work.lastOwnerMessage;
        if (last?.at != null && this.work.now() - last.at <= MODEL_STOP_MS) this.keep('a !stop within 60 s of an owner message');
    }
}
