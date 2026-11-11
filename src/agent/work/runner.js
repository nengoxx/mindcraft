import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { STEPS } from './plan.js';
import { clipResult } from './record.js';
import { planJunkDrop, recordJunkDrop, largestStacks, JUNK_MAX_RERUNS } from './resolve.js';

// The runner (SPEC §7): one run is one Mindcraft action. It never throws out of
// run(), because an exception would clear resume_func (REQ-RES-4,
// action_manager.js:144).

export const HOSTILE_RADIUS = 8;        // the self_defense radius (REQ-RES-8), a constant
export const MAX_STEP_ATTEMPTS = 3;     // failed units of one step before it blocks
const RETURN_CLOSENESS = 2;

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function floored(pos, dim) {
    return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dim };
}

// Progress bookkeeping for the stall rule (REQ-RES-16): `best` is the best
// score seen (higher is better); improving on it resets stalled_s.
export function updateProgress(step, measure, now) {
    const p = step.progress;
    p.now = measure.now;
    p.target = measure.target;
    if (p.best == null || measure.score > p.best) {
        p.best = measure.score;
        p.last_progress_at = now;
        p.stalled_s = 0;
        return true;
    }
    return false;
}

export function newProgress(step, measure, now) {
    return { metric: step.skill === 'go_to' ? 'distance' : 'count', start: measure.now, now: measure.now,
        target: measure.target, best: measure.score, last_progress_at: now, stalled_s: 0, last_cause: null };
}

export class Runner {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        this.deadline = null;
        this.worldEvents = 0;
        this.executing = false;
        this.afterRun = null;
        // REQ-OWN-8: mode labels whose scaffold the next unit sweeps (set by
        // Tidy.afterMode during a live task); cleared when that sweep completes.
        this.tidyAfterMode = null;
        // A stable function identity: resume_func === runFn means "ours".
        this.runFn = async () => { await this.run(); };
        const bump = () => { this.worldEvents++; };
        const attachDig = () => { if (!this.bot.listeners('diggingCompleted').includes(bump)) this.bot.on('diggingCompleted', bump); };
        attachDig();
        // Mineflayer drops every diggingCompleted listener on death
        // (digging.js:216-219); attach again on respawn.
        this.bot.on('spawn', attachDig);
        this.bot.on('blockPlaced', bump);
    }

    get config() { return this.work.config; }

    ctx() {
        return { bot: this.bot, agent: this.agent, config: this.config, anchor: this.work.record?.anchor ?? null, call: (label, fn) => this.call(label, fn),
            checkpoint: () => this.work.write() };
    }

    signature() {
        const pos = this.bot.entity.position;
        return JSON.stringify([world.getInventoryCounts(this.bot), Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), this.worldEvents]);
    }

    // REQ-RES-5: one no-progress deadline for every actuator call, crafting sync
    // included. No inventory, position or dig/place change for no_progress_s ends
    // the call through requestInterrupt; the run then ends, and the self-heal
    // timer starts the next attempt. interrupt_code is never cleared here.
    async call(label, fn) {
        const limit = this.config.no_progress_s * 1000;
        let last = Date.now();
        let signature = this.signature();
        const timer = setInterval(() => {
            const now = this.signature();
            if (now !== signature) {
                signature = now;
                last = Date.now();
            } else if (Date.now() - last >= limit) {
                clearInterval(timer);
                this.deadline = label;
                this.work.log(`no progress for ${this.config.no_progress_s} s during ${label}; interrupting the run`);
                this.agent.requestInterrupt();
            }
        }, Math.max(10, Math.min(1000, limit / 4)));
        try {
            return await fn();
        } finally {
            clearInterval(timer);
        }
    }

    interrupted() {
        return Boolean(this.bot.interrupt_code);
    }

    async run() {
        const work = this.work;
        this.executing = true;
        this.deadline = null;
        const started = work.now();
        const runGeneration = work.planGeneration;
        let step = null;
        let record = null;
        let ran = false;   // the record was active when this run started
        // A result that arrives after the task was blocked, paused, cancelled or
        // revised meanwhile is discarded (REQ-RES-16).
        const current = () => record != null && work.record === record && record.status === 'active' && work.planGeneration === runGeneration;
        try {
            work.reload();
            record = work.record;
            if (!record || record.status !== 'active') {
                work.releaseResume();
                return;
            }
            ran = true;
            work.protector.newRun();
            step = record.plan[record.cursor];
            // Progress exists from the first run on, so a refusing resume check
            // already records its cause for the stall rule.
            if (step && !step.progress) step.progress = newProgress(step, STEPS[step.skill].measure(this.ctx(), step), work.now());
            work.log(`run start: step ${record.cursor + 1}/${record.plan.length}`);

            // REQ-RES-8: the resume check. It returns and lets the modes act; the
            // next idle retries it. A long refusal is caught by the stall rule.
            const enemy = world.getNearestEntityWhere(this.bot, entity => mc.isHostile(entity), HOSTILE_RADIUS);
            if (enemy && await world.isClearPath(this.bot, enemy)) {
                if (step?.progress) step.progress.last_cause = `${enemy.name} within ${HOSTILE_RADIUS} blocks`;
                work.log(`resume check refused: ${enemy.name} within ${HOSTILE_RADIUS} blocks`);
                work.save();
                return;
            }

            while (record.status === 'active' && record.cursor < record.plan.length) {
                if (this.interrupted()) return;
                if (work.planGeneration !== runGeneration) return; // revised: the next run takes the new plan
                // REQ-RES-6: the run bound, checked only between actuator calls.
                if (work.now() - started >= this.config.run_deadline_s * 1000) {
                    work.log('run bound reached; ending the run normally');
                    work.save();
                    return;
                }
                // REQ-OWN-8: scaffold a mode placed during the task is swept at
                // the start of the next unit, only that (the task's own access
                // scaffold stays until the task ends).
                if (this.tidyAfterMode) {
                    const labels = this.tidyAfterMode;
                    let swept = null;
                    try {
                        swept = await work.tidy.run('after a mode, in the task', { only_by: labels });
                    } catch (err) {
                        // Not the step's failure; the flag goes, so it cannot repeat every unit.
                        console.error('[work] the in-task tidy sweep failed:', err);
                    }
                    if (this.interrupted() || !current()) return;
                    if ((!swept || !swept.ended) && this.tidyAfterMode === labels) this.tidyAfterMode = null;
                }
                step = record.plan[record.cursor];
                if (step.status === 'done') {
                    record.cursor++;
                    work.resetStallClock();
                    continue;
                }
                const handler = STEPS[step.skill];
                const ctx = this.ctx();
                if (!step.progress) step.progress = newProgress(step, handler.measure(ctx, step), work.now());
                step.status = 'running';

                if (handler.needsFreeSlots) {
                    const slots = await this.ensureFreeSlots(step);
                    if (this.interrupted() || !current()) return;
                    // 'drop-only' (the clear step): the junk drop runs, but a dig
                    // needs no free slot, so a full inventory never blocks it.
                    if (slots.blocked && handler.needsFreeSlots !== 'drop-only') { work.blockStep(step, slots.blocked); return; }
                }
                if (step.skill === 'obtain') {
                    if (!step.work_pos) step.work_pos = floored(this.bot.entity.position, this.bot.game?.dimension);
                    else if (distance(this.bot.entity.position, step.work_pos) > this.config.return_radius) {
                        await this.call('return to work', () => skills.goToPosition(this.bot, step.work_pos.x, step.work_pos.y, step.work_pos.z, RETURN_CLOSENESS));
                        if (this.interrupted() || !current()) return;
                    }
                }

                // The runner's own before/after measure of the unit decides where
                // the work is; the timer's stall sampling never consumes it.
                const before = handler.measure(ctx, step).score;
                let result;
                try {
                    result = await handler.unit(ctx, step);
                } catch (err) {
                    if (this.interrupted() || !current()) return;
                    result = { failed: `error: ${err?.message ?? err}` };
                }
                if (!current()) return;
                const measured = handler.measure(ctx, step);
                updateProgress(step, measured, work.now());
                if (this.interrupted()) return;

                if (result.done) {
                    step.status = 'done';
                    step.attempts = 0;
                    step.result = clipResult(work.stepResult(step));
                    record.cursor++;
                    work.resetStallClock();
                    work.log(`step ${step.n} done: ${step.result}`);
                    work.save();
                    continue;
                }
                if (result.blocked) {
                    work.blockStep(step, result.blocked);
                    return;
                }
                if (result.ask) {
                    // REQ-REC-12: blocked(awaiting_owner), no model call.
                    work.askOwner(step, result.ask);
                    return;
                }
                if (result.wait) {
                    // The step cannot work here now: the run ends as a refusing
                    // resume check does, with no model call; the next idle
                    // retries it and the stall rule bounds it.
                    step.progress.last_cause = result.wait;
                    work.log(`step ${step.n} waits: ${result.wait}`);
                    work.save();
                    return;
                }
                if (result.failed) {
                    step.attempts++;
                    step.progress.last_cause = result.failed;
                    work.log(`step ${step.n} attempt ${step.attempts} failed: ${result.failed}`);
                    if (step.attempts >= MAX_STEP_ATTEMPTS) {
                        work.blockStep(step, `failed ${step.attempts} times; last: ${result.failed}`);
                        return;
                    }
                } else if (step.skill === 'obtain' && measured.score > before) {
                    // The work position follows the work: where the last progress was made.
                    step.work_pos = floored(this.bot.entity.position, this.bot.game?.dimension);
                }
                work.save();
            }
            if (record.status === 'active' && record.cursor >= record.plan.length) work.finishDone();
        } catch (err) {
            // REQ-RES-4: never throw out of the run. A step whose code keeps
            // throwing ends the task as failed.
            console.error('[work] runner error:', err);
            try {
                if (current() && step) {
                    step.attempts++;
                    step.progress && (step.progress.last_cause = `error: ${err?.message ?? err}`);
                    if (step.attempts >= MAX_STEP_ATTEMPTS) work.fail(`step ${step.n} code threw repeatedly: ${err?.message ?? err}`);
                    else work.save();
                }
            } catch (inner) {
                console.error('[work] could not record the runner error:', inner);
            }
        } finally {
            this.executing = false;
            work.protector.endRun();
            if (this.interrupted()) {
                try {
                    this.work.afterInterruptedRun(step, this.deadline, runGeneration);
                } catch (err) {
                    console.error('[work] could not classify the interruption:', err);
                }
            }
            // A report deferred while the run executed (REQ-RES-12).
            const post = this.afterRun;
            this.afterRun = null;
            if (post) setTimeout(post, 0);
            // REQ-OWN-8: the task-end sweep, scheduled here (every run, resumed
            // ones too, passes through) and never awaited.
            if (ran && work.record === record && (record.status === 'done' || record.status === 'failed')) {
                try {
                    work.tidy?.scheduleTaskEnd(record);
                } catch (err) {
                    console.error('[work] could not schedule the task-end tidy:', err);
                }
            }
        }
    }

    // REQ-OBT-11: below min_free_slots, drop junk-list items where the bot
    // stands, facing away from the work, before moving to the work. A refill
    // re-runs the drop at most twice per step.
    async ensureFreeSlots(step) {
        const { bot } = this;
        const config = this.config;
        if (bot.inventory.emptySlotCount() >= config.min_free_slots) return {};
        const p = step.progress;
        p.junk_drops = p.junk_drops || 0;
        const full = () => ({ blocked: `inventory full: ${bot.inventory.emptySlotCount()} free slots, ${config.min_free_slots} needed; largest stacks: ` +
            largestStacks(bot).map(s => `${s.name} ${s.count}`).join(', ') });
        if (p.junk_drops > JUNK_MAX_RERUNS) return full();
        const drops = planJunkDrop(bot, config, this.work.neededItems());
        if (drops.length) {
            const here = bot.entity.position.clone();
            const work = step.work_pos ?? this.work.record.anchor;
            let dx = 1, dz = 0;
            if (work && Math.hypot(here.x - work.x, here.z - work.z) > 0.5) {
                const len = Math.hypot(here.x - work.x, here.z - work.z);
                dx = (here.x - work.x) / len;
                dz = (here.z - work.z) / len;
            }
            await bot.lookAt(here.offset(dx * 3, 1.6, dz * 3), true);
            // The drop point and the attempt are recorded before the first toss,
            // so an interruption mid-drop keeps the guard and uses up the attempt.
            recordJunkDrop(bot, config, here, Date.now());
            p.junk_drops++;
            this.work.write();
            this.work.log(`junk drop ${p.junk_drops}: ${drops.map(d => `${d.count} ${d.name}`).join(', ')}`);
            // One observed inventory stack per toss, so an interruption stops
            // the drop between any two stacks.
            for (const drop of drops) {
                for (let left = drop.count; left > 0;) {
                    if (this.interrupted()) return {};
                    const stack = bot.inventory.findInventoryItem(drop.name);
                    if (!stack) break;
                    const n = Math.min(left, stack.count);
                    await skills.discard(bot, drop.name, n);
                    left -= n;
                }
            }
        }
        if (bot.inventory.emptySlotCount() < config.min_free_slots) return full();
        return {};
    }
}
