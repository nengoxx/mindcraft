import { climbOut, CLIMB } from './climb.js';

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
// today's behaviour (the AUTO MESSAGE). Design §11 Q1 and Q2 are open owner
// questions: !goToRememberedPlace, self_preservation and sleeping stay out
// until he answers (each a one-line change here).
export const WALK_LABELS = Object.freeze(new Set(['action:goToCoordinates', 'action:goToPlayer', 'action:searchForBlock']));
export const RESTART_AFTER = Object.freeze(new Set(['mode:self_defense', 'mode:unstuck']));
// Constants, not keys (SPEC §14): an unstuck cut this close to a spot where
// the fallback already ran means it failed.
export const TRAVEL = { stuckRadius: 8 };

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
        if (walk.cutter == null) {
            walk.cutter = label;
            if (!RESTART_AFTER.has(label)) walk.held = false;
            return;
        }
        if (!label?.startsWith('mode:') && !this.work.isUpkeep(label)) walk.newer = true;
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
            deaths: this.deaths, dim: dimOf(bot), restarts: 0, stuck: [], climbing: false, gaveUp: false, told: false };
        this.walk = walk;
        let body = fn;
        try {
            for (;;) {
                walk.cutter = null;
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
                walk.restarts++;
                log(`${label} cut by ${walk.cutter} at ${cell(at)}: restart ${walk.restarts}${body === fn ? '' : ', climbing out first'}`);
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
