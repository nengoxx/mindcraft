import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { climbOut, CLIMB } from './climb.js';
import { SLEEP } from './sleep.js';

// The walk keeper (SPEC §7.11, REQ-TRV-1 … 3; design
// travel/recommended-design.md r4 §1, §2). DECISIONS 2026-11-13 (evening): "A
// fight cuts a walk: the code itself restarts the cut walk (goToCoordinates,
// goToPlayer, searchForBlock) after the fight, with no model call; the 'action
// was interrupted' message does not reach the model for a walk the code
// resumes", and "Stuck in a low cave: [...] she tries one fallback, climbing
// out as goToSurface does, then walks on to the goal; if that fails she tells
// him in chat instead of asking the model."
//
// One walk command is one call of `run` from the runAction wrap
// (Work.guardActions): a loop around the real runAction, inside the command's
// own call, so its result goes where an uncut walk's goes (his typed command:
// a reply; the model's: its loop; a goal's: its loop) and the resume slot is
// never touched. The AUTO MESSAGE is held back through Work.isQuietAction.

// The walks kept and the cuts they restart after; every other cutter keeps
// today's behaviour (the AUTO MESSAGE). The owner's answers to design §11
// (DECISIONS 2026-11-14, "Walks after sleeping; reliability before S3"):
// !goToRememberedPlace is kept like the other walks (Q3); a self_preservation
// cut restarts once it is safe (Q2: the safety wait, `safeThen`); sleep, which
// under work.sleep.when "always" may now cut a held walk (sleep.js mayCut),
// and the bed pickup are cutters too (Q1: "she should continue the task after
// sleeping regardless of what it is").
export const WALK_LABELS = Object.freeze(new Set(['action:goToCoordinates', 'action:goToPlayer', 'action:searchForBlock', 'action:goToRememberedPlace']));
export const RESTART_AFTER = Object.freeze(new Set(['mode:self_defense', 'mode:unstuck', 'mode:self_preservation', 'mode:sleeping', 'action:bed']));
// Constants, not keys (SPEC §14): an unstuck cut this close to a spot where
// the fallback already ran means it failed; the safety wait looks again this often.
export const TRAVEL = { stuckRadius: 8, safePollMs: 500 };
const UNSAFE = 'not safe';

const dimOf = bot => bot.game?.dimension ?? 'overworld';
const cell = pos => `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
const log = message => console.log(`[travel] ${message}`);
const stuckLine = pos => `I'm stuck near ${cell(pos)} and couldn't get out, so I stopped walking.`;

export class Travel {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        this.walk = null;    // the walk command held now (run)
        this.deaths = 0;     // a death drops the restart
        work.listen(this.bot, 'death', () => { this.deaths++; });
    }

    get limit() {
        return this.work.config.travel.resume_max;
    }

    // A walk the keeper runs: a walk label, not a resume, the keeper on.
    keeps(label, opts) {
        return WALK_LABELS.has(label) && !opts?.resume && this.limit > 0;
    }

    // Work.isQuietAction: the held walk's own label, and any mode while a walk
    // is held (a fight cut by another mode). execute() reads it before the
    // keeper's continuation runs, so the walk is still held then (design §1).
    holds(label) {
        const walk = this.walk;
        return Boolean(walk?.held) && (label === walk.label || Boolean(label?.startsWith('mode:')));
    }

    // Work.onActionStart, for every start through the wrap. The first start
    // after the walk's own is its cutter; a cutter the keeper does not restart
    // after lets the walk go at once (its AUTO MESSAGE comes as today). Any
    // later start that is neither a mode nor upkeep is newer than the walk.
    onActionStart(label) {
        const walk = this.walk;
        if (!walk || walk.starting) return;
        // A fight in the cut is a hostile near until it ends (the safety wait).
        if (label === 'mode:self_defense') walk.fought = true;
        // Sleep in the cut: the bed wait may follow (only this walk's own sleep; build r3 R3-1).
        if (label === 'mode:sleeping') walk.slept = true;
        if (walk.cutter == null) {
            walk.cutter = label;
            if (!RESTART_AFTER.has(label)) walk.held = false;
            return;
        }
        if (!label?.startsWith('mode:') && !this.work.isUpkeep(label)) walk.newer = true;
    }

    // The modes.js carry, right before self_preservation's near-death flee
    // (its moveAway(20), "I'm dying!"): a held walk it cuts, first or after a
    // fight, waits until it is safe. Its fire, lava and falling-sand moves do
    // not call this, so after them the walk restarts at once, hurt or not
    // (DECISIONS 2026-11-14, Q2).
    onNearDeath() {
        if (this.walk?.held) this.walk.fled = true;
    }

    // A command that stops actions without starting one (!endGoal): the held
    // walk is not restarted (design §0b S3).
    drop(why) {
        if (!this.walk) return;
        this.walk.newer = true;
        log(`${why}: ${this.walk.label} is not restarted`);
    }

    // One walk command: `start(label, fn, opts)` is the wrap's own start (the
    // hooks and the real runAction).
    async run(label, fn, opts, start) {
        const { agent, bot } = this;
        // A newer walk command: the held one returns at once (adversary O3).
        if (this.walk) this.walk.newer = true;
        const walk = { label, held: true, starting: false, cutter: null, newer: false, epoch: agent.stop_epoch,
            deaths: this.deaths, dim: dimOf(bot), restarts: 0, stuck: [], climbing: false, gaveUp: false, told: false,
            fled: false, fought: false, waiting: false, waitSince: 0, hostileAt: -Infinity, slept: false, bedSince: 0 };
        this.walk = walk;
        let body = fn;
        try {
            for (;;) {
                walk.cutter = null;
                walk.fled = false;
                walk.starting = true;
                let running;
                try {
                    running = start(label, body, opts);
                } finally {
                    walk.starting = false;
                }
                const result = await running;
                // A failed climb: the alert is out; the interrupted result, so
                // nothing goes on into the model's loop (design §0b S5, §0c N3).
                if (walk.gaveUp) {
                    this.flush();
                    return { ...result, interrupted: true };
                }
                if (!result.interrupted || result.timedout) return this.done(walk, result);
                const at = bot.entity.position.clone();   // the cut spot, before unstuck's moveAway
                if (this.walk !== walk || !RESTART_AFTER.has(walk.cutter)) return result;
                const dropped = await this.settle(walk) ?? (agent.actions.executing ? `${agent.actions.currentActionLabel} runs` : null);
                if (dropped) {
                    log(`${label} cut by ${walk.cutter}: not restarted (${dropped})`);
                    return result;
                }
                // The quiet clock starts when the cut ends: a fight in it was a
                // hostile near until then, and a near-death flee is never quiet
                // time (a hostile may chase her through it; build r1 S1, D-B1).
                if (walk.fought || walk.fled) {
                    walk.fought = false;
                    walk.hostileAt = Date.now();
                }
                // The AUTO MESSAGE branch flushed it; its lines go to the console,
                // on every exit from here (adversary G4; build r1 F2).
                this.flush();
                if (walk.restarts >= this.limit) {
                    this.tell(walk, `I stopped walking at ${cell(bot.entity.position)}: interrupted ${walk.restarts + 1} times on the way.`);
                    return result;
                }
                body = fn;
                if (walk.cutter === 'mode:unstuck') {
                    // The stuck rule (design §2): the first unstuck cut at a
                    // spot climbs out, then walks on; another within 8 of a
                    // spot where that ran means it failed (also while climbing: §0d).
                    if (walk.stuck.some(p => p.distanceTo(at) <= TRAVEL.stuckRadius)) {
                        this.tell(walk, stuckLine(at));
                        return result;
                    }
                    walk.stuck.push(at);
                    body = this.climbThenWalk(walk, fn);
                } else if (walk.climbing) {
                    // A fight cut the climb: climb again, no new stuck spot (§0c N1).
                    body = this.climbThenWalk(walk, fn);
                }
                const climbs = body !== fn;
                // DECISIONS 2026-11-14 (Q2): after a flee the walk goes on only
                // once it is safe; a cut of the wait waits again, its minute
                // counted from the first flee.
                if (walk.fled && !walk.waiting) {
                    walk.waiting = true;
                    walk.waitSince = Date.now();
                }
                // The bed wait (build r3 R3-1): only after a sleep that cut this
                // walk, while that bed stands; its deadline is one per walk, so
                // pickups that cut the wait do not restart it (Sol r3 MED-1).
                const bed = walk.slept && this.bedStands();
                walk.slept = bed;
                if (!this.bedStands()) walk.bedSince = 0;   // the bed is back: a later night's sleep gets its own wait (build r4 W1)
                if (bed && !walk.bedSince) walk.bedSince = Date.now();
                if (walk.waiting || bed) body = this.safeThen(walk, body);
                walk.restarts++;
                const first = [walk.waiting && 'once it is safe', bed && 'after my bed', climbs && 'climbing out first'].filter(Boolean).join(', ');
                log(`${label} cut by ${walk.cutter} at ${cell(at)}: restart ${walk.restarts}${first ? `, ${first}` : ''}`);
            }
        } finally {
            walk.held = false;
            if (this.walk === walk) this.walk = null;
        }
    }

    // Why the held walk is not restarted, or null.
    dropReason(walk) {
        const { agent, bot } = this;
        return walk.newer ? 'a newer command' : this.work.disposed ? 'disposed'
            : agent.stop_epoch !== walk.epoch ? '!stop' : this.deaths !== walk.deaths ? 'death'
            : dimOf(bot) !== walk.dim ? 'another dimension' : null;
    }

    // The cutter and every mode or upkeep action chained after it: null once
    // the newest action started has ended; a drop reason as soon as one holds.
    // The reasons are checked before each wait too, so a newer indefinite
    // action (a follow) never holds the old command open (build r1 F1).
    async settle(walk) {
        for (;;) {
            let why = this.dropReason(walk);
            if (why) return why;
            const run = this.work.lastRun;
            await run?.promise?.catch(() => {});
            why = this.dropReason(walk);
            if (why) return why;
            if (this.work.lastRun === run) return null;
        }
    }

    // The behaviour log of a kept cut goes to the console, not the next prompt.
    flush() {
        const behaviour = this.bot.modes.flushBehaviorLog().trim();
        if (behaviour) log(`behaviour: ${behaviour.replaceAll('\n', '; ')}`);
    }

    // The fallback body: climb out (default movements: dig and tower, as
    // goToSurface; protection applies), then the walk. `up` or `nothing` (on
    // the surface already: a plain restart from where moveAway left her) walk
    // on; `failed` tells him and gives the walk up. A cut climb stays climbing.
    climbThenWalk(walk, fn) {
        const bot = this.bot;
        return async () => {
            walk.climbing = true;
            const { outcome } = await climbOut(bot, { ms: CLIMB.walkMs });
            if (bot.interrupt_code) return;
            walk.climbing = false;
            if (outcome === 'failed') {
                this.tell(walk, stuckLine(bot.entity.position));
                walk.gaveUp = true;
                return;
            }
            await fn();
        };
    }

    // A hostile within work.travel.safe_radius (the item cleanup's predicate).
    hostileNear() {
        return Boolean(world.getNearestEntityWhere(this.bot, e => mc.isHostile(e), this.work.config.travel.safe_radius));
    }

    // The safety wait before the body (DECISIONS 2026-11-14, Q2: "the cut walk
    // restarts once her health is back above half and no hostile has been
    // within 16 blocks for a few seconds; if that does not happen within about
    // a minute she tells him she stopped"). It runs as the restarted walk, so
    // nothing else starts meanwhile (the idle resume, the self-heal) and every
    // cutter applies to it as to the walk: a fight cuts it (it waits again
    // after), a newer command or !stop ends it at once; the drop reasons are
    // checked at each look. The fire, lava and falling-sand moves start no
    // safety wait (onNearDeath). The same wait also holds a walk that sleep
    // cut while her bed still stands within 16 (bedStands; build r1 S4, r2 N1, r3 R3-1;
    // DECISIONS 2026-11-14 Q1: she carries on "once she is up and her bed is
    // back"): sleep cuts the wait and lies down again, or the pickup takes the
    // bed; at most work.travel.safe_wait_s, then she walks on and the
    // sleeper's "I left my bed" line tells him.
    safeThen(walk, body) {
        const bot = this.bot;
        return async () => {
            const why = await this.untilSafe(walk);
            if (bot.interrupt_code) return;
            if (why === UNSAFE) this.tell(walk, `I stopped walking at ${cell(bot.entity.position)}: it wasn't safe after I got away.`);
            else if (why) log(`${walk.label}: not restarted (${why})`);
            if (why) {
                walk.gaveUp = true;
                return;
            }
            walk.waiting = false;
            await body();
        };
    }

    // Her own bed (the sleep routine's ledger entry, `myBedNear(SLEEP.reuseRadius)`)
    // still stands within 16, whatever `wanted()` says (build r2 S4: a night
    // marked done leaves it placed until the pickup takes it). Only under
    // work.sleep.when "always", where sleep and the pickup may cut the held
    // wait (under "idle" neither does, so waiting would only delay her).
    // Asked only for a walk whose own cut chain held `mode:sleeping`
    // (`walk.slept`), so an older bed of hers never holds a walk (build r3 R3-1).
    bedStands() {
        const sleeper = this.work.sleeper;
        return Boolean(sleeper && sleeper.when() === 'always' && sleeper.myBedNear(SLEEP.reuseRadius));
    }

    // null once safe and the bed is back or waited for safe_wait_s (or
    // interrupted), else a drop reason or UNSAFE. Safe: her health above
    // safe_health, no hostile near now and none for safe_quiet_s (build r1
    // S3: 0 s still needs none now). `unstuck` is paused while she stands
    // still on purpose (it would take the wait for a stuck walk).
    async untilSafe(walk) {
        const { bot } = this;
        const t = this.work.config.travel;
        bot.modes?.pause('unstuck');
        try {
            for (;;) {
                if (bot.interrupt_code) return null;
                const why = this.dropReason(walk);
                if (why) return why;
                const now = Date.now();
                const near = this.hostileNear();
                if (near) walk.hostileAt = now;
                const safe = !walk.waiting || (!near && bot.health > t.safe_health && now - walk.hostileAt >= t.safe_quiet_s * 1000);
                // Build r2 N1: the bed wait ends after safe_wait_s (sleep may keep refusing before a try).
                const bed = walk.slept && this.bedStands();
                if (safe && bed && now - walk.bedSince >= t.safe_wait_s * 1000) {
                    log(`${walk.label}: my bed is still placed after ${t.safe_wait_s} s; walking on`);
                    walk.slept = false;
                    return null;
                }
                if (safe && !bed) return null;
                if (!safe && now - walk.waitSince >= t.safe_wait_s * 1000) return UNSAFE;
                await new Promise(resolve => setTimeout(resolve, TRAVEL.safePollMs));
            }
        } finally {
            bot.modes?.unpause('unstuck');
        }
    }

    // The walk is over: the result as an uncut walk's, with the count.
    done(walk, result) {
        if (!walk.restarts) return result;
        const line = `Resumed after ${walk.restarts} interruption${walk.restarts === 1 ? '' : 's'}.`;
        log(`${walk.label} ended; ${line}`);
        return { ...result, message: result.message ? `${result.message.trimEnd()}\n${line}` : line };
    }

    // Once per walk: one alert line to him, into history as `system`, no model call.
    tell(walk, line) {
        if (walk.told) return;
        walk.told = true;
        log(line);
        this.work.deliver(line, { category: 'alert' }).catch(err => console.error('[travel] could not tell the owner:', err?.message ?? err));
    }
}
