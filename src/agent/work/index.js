import { getCommand } from '../commands/index.js';
import settings from '../settings.js';
import { loadWorkConfig } from './config.js';
import { recordPath, loadRecord, saveRecord, newRecord, newStep, setStatus, isTerminal } from './record.js';
import { planFromText, resolvePosition, STEPS } from './plan.js';
import { Runner, MAX_STEP_ATTEMPTS, updateProgress } from './runner.js';
import { Protector, installSafeToBreakPatch, guardBot, unguardBot, ledgerEntry, carryStations, installCleanStop, posKey, isStationBlock } from './protect.js';
import { renderView } from './view.js';
import { stepResult, doneReport, blockedReport, failedReport, goalStopped } from './report.js';

// The work module (SPEC §5): task record, runner, resume, protection and the
// hooks into Mindcraft. One instance per agent process (agent.work).

export const RESTART_MESSAGE = 'Agent process restarted.';
export const TASK_ACTIVE = 'a task is active — use !taskRevise or !taskCancel';
const TICK_MS = 1000;
const STALL_WRITE_MS = 10000; // how often the self-heal timer persists stall time
const REPORT_WAIT_MS = 15000; // how long a timer block's report waits for a run that does not return

// Items the task layer cannot make in this iteration go back to the existing
// commands (smelting, mob drops, crops, food).
const NO_METHOD_HINT = '. For an item with no method here, use the existing commands instead (!collectBlocks, !craftRecipe, !smeltItem, or !goal for a longer job); ' +
    'crops and farmed plants (wheat, sugar cane, bamboo, cactus, berries, kelp) are protected as possible farms and cannot be collected';

function refusal(command, errors) {
    return `${command} refused: ${errors.join('; ')}${errors.some(e => /no method for/.test(e)) ? NO_METHOD_HINT : ''}`;
}

export class Work {
    constructor(agent, { now = Date.now, timers = true } = {}) {
        this.agent = agent;
        this.now = now;
        this.timers = timers;
        this.record = null;
        this.ledger = new Map(); // posKey -> placement entry (REQ-SAFE-2)
        this.loose = [];         // the bot's placements while no record exists
        this.planGeneration = 0;
        this.goalEpoch = 0;
        this.reportWaitMs = REPORT_WAIT_MS;
        this.stallClock = now();
        this.lastWrite = 0;
        this.idleSince = null;
        this.lastOwnerMessage = null;
        this.disposers = [];
    }

    // --- start-up -------------------------------------------------------------

    init(init_message = null) {
        const { agent } = this;
        const bot = agent.bot;
        this.config = loadWorkConfig(agent.prompter?.profile?.work);
        this.file = recordPath(agent.name);
        this.runner = new Runner(this);
        this.protector = new Protector(bot, { ledgerGet: pos => this.ledger.get(posKey(pos)) ?? null, ledgerDrop: pos => this.dropPlacement(pos) });
        installSafeToBreakPatch();
        guardBot(bot, this.protector, () => this.record?.status === 'active');
        this.disposers.push(() => unguardBot(bot));
        this.listen(bot, 'blockPlaced', (oldBlock, newBlock) => this.onBlockPlaced(newBlock));
        this.listen(bot, 'death', () => this.onDeath());
        const onOwnerMessage = (username, message) => this.onOwnerMessage(username, message);
        this.listen(bot, 'whisper', onOwnerMessage);
        this.listen(bot, 'chat', onOwnerMessage);
        this.guardCommands();
        this.disposers.push(installCleanStop(() => this.writeCleanStop()));

        const { record, state } = loadRecord(this.file);
        if (state === 'unknown_version' || state === 'unreadable')
            console.warn(`[work] ${this.file}: ${state}; left untouched, starting with no task`);
        this.adopt(record);
        // REQ-REC-7/9: a crash restart is init_message 'Agent process restarted.'
        // with no clean_stop; anything else is a fresh start. clean_stop is
        // cleared in the same write that pauses, so no crash between two
        // writes can revive a stopped task.
        const crash = init_message === RESTART_MESSAGE && Boolean(record) && !record.clean_stop;
        let changed = Boolean(record?.clean_stop);
        if (record) record.clean_stop = false;
        // A goal kept for a handback belongs to the old session (REQ-RES-9).
        if (!crash && record?.goal) { record.goal = null; changed = true; }
        if (record?.status === 'active') {
            if (crash) {
                this.log('crash restart: resuming the active task with no model call');
                this.scheduleRun();
            } else {
                setStatus(record, 'paused', 'fresh_start');
                this.log('paused: fresh_start');
                changed = true;
            }
        }
        if (changed) this.write();
        if (this.timers) {
            const timer = setInterval(() => this.tick(), TICK_MS);
            this.disposers.push(() => clearInterval(timer));
        }
        return this;
    }

    // Detach from the bot and the process; a disposed instance writes nothing.
    dispose() {
        this.disposed = true;
        for (const dispose of this.disposers.splice(0)) dispose();
    }

    listen(emitter, event, fn) {
        emitter.on(event, fn);
        this.disposers.push(() => emitter.removeListener(event, fn));
    }

    // REQ-RES-9: !goal (and !newAction on the text path) are refused while a task
    // is non-terminal. Wrapping perform covers the model's text command and the
    // owner's forced command alike. Installed once per process.
    // REQ-SAFE-11: !stop is final for the task: the wrapper cancels any
    // non-terminal task and writes it before !stop awaits the action shutdown.
    guardCommands() {
        const stop = getCommand('!stop');
        if (stop && !stop.perform.workGuarded) {
            const perform = stop.perform;
            // Upstream !stop always runs, even when the record cannot be written.
            const stopping = async function (agent, ...args) {
                try {
                    agent.work?.stopTask();
                } catch (err) {
                    console.error('[work] !stop: could not write the cancelled task:', err?.message ?? err);
                }
                return perform.call(this, agent, ...args);
            };
            stopping.workGuarded = true;
            stop.perform = stopping;
        }
        for (const name of ['!goal', '!newAction']) {
            const command = getCommand(name);
            if (!command || command.perform.workGuarded) continue;
            const perform = command.perform;
            const guarded = async function (agent, ...args) {
                if (agent.work?.hasLiveTask()) return TASK_ACTIVE;
                if (name === '!goal') agent.work?.clearGoal(); // a new goal replaces any pending handback
                return perform.call(this, agent, ...args);
            };
            guarded.workGuarded = true;
            command.perform = guarded;
        }
        const endGoal = getCommand('!endGoal');
        if (endGoal && !endGoal.perform.workGuarded) {
            const perform = endGoal.perform;
            const ending = async function (agent, ...args) {
                agent.work?.clearGoal();
                return perform.call(this, agent, ...args);
            };
            ending.workGuarded = true;
            endGoal.perform = ending;
        }
    }

    // The goal a task was started in is not handed back once the owner ended,
    // stopped or replaced it (REQ-RES-9). goalEpoch invalidates a pending handback.
    clearGoal() {
        this.goalEpoch++;
        if (!this.record?.goal) return;
        this.record.goal = null;
        try {
            this.write();
        } catch (err) {
            console.error('[work] could not write the cleared goal:', err?.message ?? err);
        }
    }

    // --- record ---------------------------------------------------------------

    adopt(record) {
        this.record = record;
        this.ledger = new Map([...(record?.placements || []), ...this.loose].map(e => [posKey(e.pos), e]));
    }

    // A ledger entry whose block is gone or replaced is retired (persisted with
    // the next write).
    dropPlacement(pos) {
        const key = posKey(pos);
        this.ledger.delete(key);
        const keep = e => posKey(e.pos) !== key;
        if (this.record?.placements) this.record.placements = this.record.placements.filter(keep);
        this.loose = this.loose.filter(keep);
    }

    reload() {
        const { record, state } = loadRecord(this.file);
        if (state === 'ok') this.adopt(record);
    }

    write() {
        if (this.disposed) return;
        saveRecord(this.file, this.record, this.now());
        this.lastWrite = this.now();
    }

    resetStallClock() {
        this.stallClock = this.now();
    }

    // Every write of an active task adds the elapsed process time to the
    // current step's stalled_s, so it carries across restarts while time with
    // the process down does not count; at work.step_stall_s the step blocks
    // with its last recorded cause (REQ-RES-16).
    // `sample` (the self-heal timer's periodic save) measures the step first,
    // so a long call that keeps progressing is not counted as stalled.
    save({ sample = false } = {}) {
        const record = this.record;
        if (!record) return;
        const now = this.now();
        const step = record.status === 'active' ? record.plan[record.cursor] : null;
        if (step?.progress) {
            if (sample && updateProgress(step, STEPS[step.skill].measure(this.runner.ctx(), step), now)) this.stallClock = now;
            step.progress.stalled_s = Math.round((step.progress.stalled_s + (now - this.stallClock) / 1000) * 10) / 10;
            this.stallClock = now;
            if (step.progress.stalled_s >= this.config.step_stall_s) {
                const minutes = Math.round(this.config.step_stall_s / 60);
                this.blockStep(step, `no progress for ${minutes} min; last: ${step.progress.last_cause ?? 'no cause recorded'}`);
                // A block from the timer also ends a run still in its actuator call.
                if (this.runner.executing) this.agent.requestInterrupt();
                return;
            }
        } else {
            this.stallClock = now;
        }
        this.write();
    }

    writeCleanStop() {
        const { record } = loadRecord(this.file);
        if (!record) return;
        record.clean_stop = true;
        record.goal = null;
        saveRecord(this.file, record, this.now());
    }

    log(message) {
        console.log(`[task ${this.record?.id ?? '-'}] ${message}`);
    }

    taskId() {
        return isTerminal(this.record) ? null : this.record.id;
    }

    hasLiveTask() {
        return !isTerminal(this.record);
    }

    owner() {
        return settings.only_chat_with?.[0] ?? this.lastOwnerMessage?.username ?? null;
    }

    view() {
        return renderView(this.record, { bot: this.agent.bot, selfPromptActive: !this.agent.self_prompter?.isStopped(), now: this.now() });
    }

    neededItems() {
        const items = new Set();
        const record = this.record;
        if (!record) return items;
        const ctx = this.runner.ctx();
        for (const step of record.plan.slice(record.cursor)) {
            if (step.status === 'done') continue;
            for (const item of STEPS[step.skill].neededItems(ctx, step)) items.add(item);
        }
        return items;
    }

    stepResult(step) {
        return stepResult(step, this.agent.bot);
    }

    // --- events ---------------------------------------------------------------

    onOwnerMessage(username, message) {
        if (username === this.agent.name) return;
        const allowed = settings.only_chat_with || [];
        if (allowed.length && !allowed.includes(username)) return;
        this.lastOwnerMessage = { username, message };
    }

    // REQ-BLD-22: every block the bot places while a task is active, from
    // Mineflayer's blockPlaced event (pathfinder pillars included). Otherwise
    // (no task, or one paused, blocked or ended) only its stations (crafting table, furnace), so a one-off !craftRecipe takes back
    // the table it placed while anything else it builds stays protected. Such
    // an entry goes into the finished record, or, before the first task, stays
    // in memory until a record exists.
    onBlockPlaced(newBlock) {
        if (!newBlock?.position) return;
        const active = this.record?.status === 'active';
        if (!active && !isStationBlock(newBlock.name)) return;
        const entry = ledgerEntry(newBlock, active ? this.record.id : null, this.now());
        this.ledger.set(posKey(entry.pos), entry);
        if (!this.record) { this.loose.push(entry); return; }
        this.record.placements.push(entry);
        this.write();
    }

    onDeath() {
        if (this.record?.status === 'active') this.pause('died');
    }

    // --- running --------------------------------------------------------------

    scheduleRun() {
        setTimeout(() => this.startRun(), 0);
    }

    // REQ-RES-1: the runner is a resumable Mindcraft action with no timeout.
    startRun() {
        if (this.record?.status !== 'active') return;
        this.agent.actions.runAction('action:task', this.runner.runFn, { resume: true, timeout: -1 })
            .catch(err => console.error('[work] could not start the run:', err));
    }

    ours() {
        return this.agent.actions.resume_func === this.runner.runFn;
    }

    releaseResume() {
        if (this.ours()) this.agent.actions.cancelResume();
    }

    async stopOurRun() {
        const actions = this.agent.actions;
        if (this.runner.executing && actions.currentActionLabel === 'action:task') await actions.stop();
        this.releaseResume();
    }

    // REQ-RES-13: the cause of an interrupted run, from real events.
    afterInterruptedRun(step, deadline, generation) {
        const record = this.record;
        if (record?.status !== 'active' || generation !== this.planGeneration) return;
        const actions = this.agent.actions;
        if (actions.resume_func && !this.ours()) return this.pause(`replaced: ${actions.resume_name}`);
        if (deadline && step) {
            step.attempts++;
            step.no_progress++;
            step.progress.last_cause = `no progress for ${this.config.no_progress_s} s during ${deadline}`;
            if (step.attempts >= MAX_STEP_ATTEMPTS)
                return this.blockStep(step, `failed ${step.attempts} times; last: ${step.progress.last_cause}`);
            return this.save();
        }
        const pos = this.agent.bot.entity.position;
        record.interruptions.count++;
        record.interruptions.last = { by: null, at: this.now(), step: step?.n ?? null, pos: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } };
        if (step?.progress) step.progress.last_cause = 'interruption';
        this.log('run interrupted');
        this.save();
    }

    // A replacing resumable action, seen while no run executes.
    watch() {
        if (this.record?.status !== 'active') return;
        const actions = this.agent.actions;
        if (actions.resume_func && !this.ours() && !this.runner.executing) this.pause(`replaced: ${actions.resume_name}`);
    }

    // The self-heal timer (REQ-RES-10), also the stall clock while no run writes.
    tick() {
        const record = this.record;
        if (record?.status !== 'active') { this.idleSince = null; return; }
        this.watch();
        if (record.status !== 'active') return;
        const actions = this.agent.actions;
        const last = record.interruptions.last;
        if (last && last.by == null && actions.currentActionLabel && actions.currentActionLabel !== 'action:task') {
            last.by = actions.currentActionLabel;
            if (record.plan[record.cursor]?.progress) record.plan[record.cursor].progress.last_cause = `${last.by} interruption`;
            this.save(); // the next run reloads the record from disk
        }
        const now = this.now();
        if (this.agent.isIdle()) {
            this.idleSince ??= now;
            if (now - this.idleSince >= this.config.stall_s * 1000) {
                this.idleSince = null;
                if (this.ours()) {
                    this.log('self-heal: resuming the task');
                    actions.resumeAction();
                } else if (!actions.resume_func) {
                    this.log('self-heal: restarting the task run');
                    this.startRun();
                }
            }
        } else {
            this.idleSince = null;
        }
        if (now - this.lastWrite >= STALL_WRITE_MS) this.save({ sample: true });
    }

    // --- lifecycle (SPEC §6.4) ------------------------------------------------

    pause(reason) {
        setStatus(this.record, 'paused', reason);
        this.releaseResume();
        this.log(`paused: ${reason}`);
        this.write();
    }

    cancel(reason) {
        setStatus(this.record, 'cancelled', reason);
        this.record.goal = null;
        this.goalEpoch++;
        this.releaseResume();
        this.log(`cancelled: ${reason}`);
        this.write();
    }

    blockStep(step, cause) {
        const record = this.record;
        setStatus(record, 'blocked', cause);
        if (step) {
            step.status = 'blocked';
            step.result = String(cause).slice(0, 160);
        }
        this.releaseResume();
        this.log(`blocked: ${cause}`);
        const report = blockedReport(record, step, this.agent.bot);
        record.goal = null; // the report says the goal stays stopped: it does, also after a resume
        this.write();
        // One model call: the blocked report goes to the model after the run
        // has ended, never while it still executes (REQ-RES-12); a block from
        // the timer waits for the interrupted run to return, or at most
        // REPORT_WAIT_MS for a call that never returns. Exactly once, and only
        // while the task is still this blocked one: a stop, cancel, resume or
        // revision meanwhile drops it.
        const generation = this.planGeneration;
        const stopEpoch = this.agent.stop_epoch;
        let timer = null;
        let posted = false;
        const post = () => {
            if (posted) return;
            posted = true;
            clearTimeout(timer);
            if (this.disposed || this.record !== record || record.status !== 'blocked'
                || this.planGeneration !== generation || this.agent.stop_epoch !== stopEpoch) return;
            this.agent.handleMessage('system', report);
        };
        if (this.runner.executing) {
            this.runner.afterRun = post;
            timer = setTimeout(post, this.reportWaitMs);
        } else setTimeout(post, 0);
    }

    finishDone() {
        setStatus(this.record, 'done');
        this.releaseResume();
        this.log('done');
        this.write();
        // A task started inside a !goal hands back to it once done, unless the
        // goal was ended, stopped or replaced meanwhile or a newer task exists.
        const record = this.record;
        const goal = record.goal;
        const epoch = this.goalEpoch;
        const handBack = () => {
            const sp = this.agent.self_prompter;
            if (this.record === record && record.goal === goal && this.goalEpoch === epoch && sp.isStopped()) sp.start(goal);
        };
        this.postReport(doneReport(record, this.agent.bot), goal ? handBack : null);
    }

    fail(reason) {
        setStatus(this.record, 'failed', reason);
        this.releaseResume();
        this.log(`failed: ${reason}`);
        const report = failedReport(this.record, this.agent.bot);
        this.record.goal = null;
        this.write();
        this.postReport(report);
    }

    // A fact report needs no model call: it goes to the owner and into history.
    postReport(report, then = null) {
        setTimeout(async () => {
            this.agent.openChat(report);
            await this.agent.history.add('system', report);
            await this.agent.history.save();
            then?.();
        }, 0);
    }

    planContext() {
        return { bot: this.agent.bot, owner: this.owner(), config: this.config };
    }

    activate() {
        this.planGeneration++;
        this.idleSince = null;
        this.resetStallClock();
        // The self-prompter stays stopped in task mode: resumeAction does nothing
        // while it is active (action_manager.js:63). A goal it was running is
        // kept in the record and restarted when the task is done.
        const sp = this.agent.self_prompter;
        if (sp && !sp.isStopped()) {
            this.record.goal = sp.prompt;
            sp.stop(false);
        }
    }

    // The !stop wrapper (REQ-SAFE-11): synchronous, before any await.
    stopTask() {
        if (!isTerminal(this.record)) this.cancel('stop');
        else this.clearGoal(); // also a goal handback still pending after a done task
    }

    // !taskStart (REQ-PLAN-1/2, REQ-REC-5).
    startTask(objective, stepsText) {
        const old = this.record;
        if (old?.status === 'active') return { ok: false, message: TASK_ACTIVE };
        const ctx = this.planContext();
        const { steps, errors } = planFromText(ctx, stepsText);
        if (errors.length) return { ok: false, message: refusal('!taskStart', errors) };
        if (old && !isTerminal(old)) {
            setStatus(old, 'cancelled', 'superseded');
            this.log('superseded by a new task');
            this.write();
        }
        const owner = ctx.owner;
        const request_text = this.lastOwnerMessage && this.lastOwnerMessage.username === owner ? this.lastOwnerMessage.message : null;
        const placements = carryStations({ structures: old?.structures, placements: [...(old?.placements || []), ...this.loose] }, this.agent.bot);
        this.loose = [];
        const record = newRecord({
            objective: String(objective), request_text, requested_by: owner,
            anchor: resolvePosition(ctx, 'here'), steps, placements, now: this.now(),
        });
        this.adopt(record);
        this.activate();
        this.write();
        this.log(`started: "${record.objective}" with ${steps.length} step(s)`);
        this.scheduleRun();
        return { ok: true, message: `Task started: "${record.objective}" (${steps.length} step${steps.length === 1 ? '' : 's'}).` };
    }

    // !taskRevise (REQ-PLAN-6): replace the steps from from_step on; done steps
    // are kept. Allowed while active, paused or blocked.
    async reviseTask(fromStep, stepsText) {
        const record = this.record;
        if (isTerminal(record)) return { ok: false, message: '!taskRevise refused: there is no task to revise (use !taskStart)' };
        const firstOpen = record.plan.findIndex(s => s.status !== 'done');
        const firstEditable = (firstOpen === -1 ? record.plan.length : firstOpen) + 1;
        if (!Number.isInteger(fromStep) || fromStep < firstEditable || fromStep > record.plan.length + 1)
            return { ok: false, message: `!taskRevise refused: from_step must be ${firstEditable === record.plan.length + 1 ? firstEditable : `${firstEditable} to ${record.plan.length + 1}`} (earlier steps are done)` };
        const kept = record.plan.slice(0, fromStep - 1);
        const ctx = this.planContext();
        const { steps, errors } = planFromText(ctx, stepsText, { offset: fromStep - 1, maxSteps: Infinity });
        if (kept.length + steps.length > this.config.max_steps) errors.push(`more than ${this.config.max_steps} steps`);
        if (errors.length) return { ok: false, message: refusal('!taskRevise', errors) };
        record.plan = [...kept, ...steps.map((s, i) => newStep(fromStep + i, s.skill, s.args))];
        record.cursor = record.plan.findIndex(s => s.status !== 'done');
        if (record.cursor === -1) record.cursor = record.plan.length;
        if (record.status !== 'active') setStatus(record, 'active');
        this.activate();
        this.write();
        this.log(`revised from step ${fromStep}`);
        // A run of the old plan ends now (its interruption is not counted, the
        // plan generation changed) and a run of the new plan starts.
        if (this.runner.executing && this.agent.actions.currentActionLabel === 'action:task') await this.agent.actions.stop();
        this.scheduleRun();
        return { ok: true, message: `Task revised from step ${fromStep}: now ${record.plan.length} step${record.plan.length === 1 ? '' : 's'}.` };
    }

    async pauseTask() {
        if (this.record?.status !== 'active') return { ok: false, message: 'No active task to pause.' };
        this.pause('command');
        await this.stopOurRun();
        return { ok: true, message: `Task paused: "${this.record.objective}". !taskResume continues it.` };
    }

    resumeTask() {
        const record = this.record;
        if (record?.status !== 'paused' && record?.status !== 'blocked')
            return { ok: false, message: record?.status === 'active' ? 'The task is already running.' : 'No paused or blocked task to resume.' };
        const step = record.plan[record.cursor];
        if (step) {
            step.status = 'pending';
            step.attempts = 0;
            if (step.progress) { step.progress.stalled_s = 0; step.progress.junk_drops = 0; }
            // A resumed give starts a new baseline: it re-gives only the
            // outstanding count from what is in the inventory now.
            if (step.skill === 'give' && step.progress) step.progress.inv_start = null;
        }
        setStatus(record, 'active');
        this.activate();
        this.write();
        this.log('resumed by command');
        this.scheduleRun();
        return { ok: true, message: `Task resumed: "${record.objective}".` };
    }

    async cancelTask() {
        if (isTerminal(this.record)) return { ok: false, message: 'No task to cancel.' };
        const note = goalStopped(this.record);
        this.cancel('command');
        await this.stopOurRun();
        return { ok: true, message: `Task cancelled: "${this.record.objective}".${note}` };
    }
}
