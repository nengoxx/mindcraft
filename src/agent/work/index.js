import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import Vec3 from 'vec3';
import { getCommand, containsCommand } from '../commands/index.js';
import * as skills from '../library/skills.js';
import { findAllBlocks } from './commands.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { loadWorkConfig } from './config.js';
import { chatMode, chatShown } from './chat.js';
import { recordPath, loadRecord, saveRecord, newRecord, newStep, setStatus, isTerminal } from './record.js';
import { planFromText, resolvePosition, STEPS } from './plan.js';
import { Runner, MAX_STEP_ATTEMPTS, updateProgress } from './runner.js';
import { Protector, installSafeToBreakPatch, guardBot, unguardBot, installCleanStop } from './protect.js';
import { Ledger, ledgerPath } from './ledger.js';
import { clearScope } from './steps/clear.js';
import { Tidy } from './tidy.js';
import { Sleeper, SLEEP_LABELS } from './sleep.js';
import { Upkeep, ITEMS_LABEL, FOLLOW_LABEL } from './inventory.js';
import { Combat } from './combat.js';
import { Travel } from './travel.js';
import { newQuestion, parseAnswer } from './ask.js';
import { renderView } from './view.js';
import { stepResult, doneReport, doneLine, blockedReport, blockedAgainLine, deathLine, failedReport, goalStopped, chatLines } from './report.js';

// The work module (SPEC §5): task record, runner, resume, protection and the
// hooks into Mindcraft. One instance per agent process (agent.work).

export const RESTART_MESSAGE = 'Agent process restarted.';
export const TASK_ACTIVE = 'a task is active — use !taskRevise or !taskCancel';
const TICK_MS = 1000;
const STALL_WRITE_MS = 10000; // how often the self-heal timer persists stall time
const REPORT_WAIT_MS = 15000; // how long a timer block's report waits for a run that does not return
const LINE_GAP_MS = 1000;     // between the chat lines of one report, under the server's chat-spam kick
const turns = new AsyncLocalStorage();   // the handleMessage call (turn) code runs in
const QUESTION = Symbol('question');     // the store while code posts the open question

// Items the task layer cannot make in this iteration go back to the existing
// commands (smelting, mob drops, crops, food).
const NO_METHOD_HINT = '. For an item with no method here, use the existing commands instead (!collectBlocks, !craftRecipe, !smeltItem, or !goal for a longer job); ' +
    'crops and farmed plants (wheat, sugar cane, bamboo, cactus, berries, kelp) are protected as possible farms and cannot be collected';

// REQ-CHAT-2: the same step args whatever their key order (the DSL keeps the
// order typed) or their prototype (a loaded record holds plain objects).
const plain = value => JSON.parse(JSON.stringify(value ?? null));
const sameArgs = (a, b) => isDeepStrictEqual(plain(a), plain(b));
// REQ-CHAT-1: whether the owner hears the task's done line; a record from
// before `notify_done` is judged by who asked and whether a goal ran it.
const ownerAsked = record => record.notify_done ?? Boolean(record.requested_by && !record.goal);

// REQ-SAFE-13 (DECISIONS 2026-11-13): the owner's blocks on request.
export const PLACED_LABEL = 'action:collectPlaced';
export const PLACED_NOT_OWNER = 'Only the owner can ask me to mine protected blocks.';
export const PLACED_TASK_QUESTION = 'A task question is waiting; ask me again after it.';
export const PLACED_LAPSED = 'The mining question lapsed.';
// DECISIONS 2026-11-13 (evening): after his "no", "a fixed short reply [...], no model call".
export const PLACED_LEFT = 'OK, I\'ll leave them.';
const PLACED_LISTED = 4;   // positions the question lists one by one
const cellText = c => `${c.x},${c.y},${c.z}`;
const andList = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// The one yes/no question naming the exact cells (design r4 §3).
function blockQuestion(type, cells, more) {
    const which = cells.length <= PLACED_LISTED
        ? `${cells.length} protected ${type} at ${andList(cells.map(cellText))}`
        : `the ${cells.length} nearest protected ${type}, from ${cellText(cells[0])} to ${cellText(cells.at(-1))}`;
    const rest = more ? ` ${more} more ${more === 1 ? 'is' : 'are'} nearby.` : '';
    return `May I mine ${which}?${rest} Answer yes or no.`;
}

// The action output with the granted collect's complete summary line, which
// getBotOutputSummary may have cut (rulings r1 S5).
const withSummary = (message, summary) => !summary || message.includes(summary) ? message : `${message}\n${summary}`.trim();

function refusal(command, errors) {
    return `${command} refused: ${errors.join('; ')}${errors.some(e => /no method for/.test(e)) ? NO_METHOD_HINT : ''}`;
}

export class Work {
    constructor(agent, { now = Date.now, timers = true } = {}) {
        this.agent = agent;
        this.now = now;
        this.timers = timers;
        this.record = null;
        this.ledger = null;      // the placements ledger (ledger.js, REQ-OWN-1)
        this.tidy = null;        // tidying the bot's own scaffold (tidy.js, REQ-OWN-7 … 10)
        this.sleeper = null;     // sleeping through the night (sleep.js, REQ-SLP-1 … 10)
        this.items = null;       // the idle inventory cleanup (inventory.js, REQ-OBT-11)
        this.combat = null;      // whom to fight, the leash and the walk back (combat.js, REQ-CMB-1 … 9)
        this.travel = null;      // the walk keeper (travel.js, REQ-TRV-1 … 3)
        this.follow = null;      // {fn, name}: the pending follow's target, seen while it ran (followTarget)
        this.lastStart = null;   // {label, voice, goal}: the last action started (the runAction wrap)
        this.lastRun = null;     // {label, promise}: the newest action started through the wrap (the keeper's settle)
        this.liveTurns = new Set();  // every handleMessage call in flight (guardTurns; the cleanup's turn count)
        this.ownerGeneration = 0;    // bumped by every owner message (the cleanup's currency)
        this.stallHeld = false;  // the stall clock's hold while she sleeps (REQ-RES-16)
        this.planGeneration = 0;
        this.goalEpoch = 0;
        this.reportWaitMs = REPORT_WAIT_MS;
        this.stallClock = now();
        this.lastWrite = 0;
        this.idleSince = null;
        this.lastOwnerMessage = null;
        this.armed = null;          // the id of the open question while it takes an answer (REQ-REC-12)
        this.disarming = new Set(); // the turns that disarmed it and have not finished
        this.postings = 0;          // the question's post generation
        this.lineGapMs = LINE_GAP_MS;
        this.outbox = Promise.resolve();   // the owner-output queue (deliver)
        this.nextSend = 0;
        this.handoff = null;        // {message, ownerTask}: the blocked report being handed to the model (its turn's voice is `alert`)
        this.answerPending = false; // the owner's last turn showed nothing (G1, guardTurns)
        // REQ-SAFE-13: the mining question, one in-memory slot apart from the
        // task's pending_question: {type, cells, owner, text, asked_at, armed, reposted}.
        this.blockAsk = null;
        this.actionStarts = 0;      // every action start (onActionStart): a newer action drops a hand-back
        this.disposers = [];
    }

    // --- start-up -------------------------------------------------------------

    init(init_message = null) {
        const { agent } = this;
        const bot = agent.bot;
        this.config = loadWorkConfig(agent.prompter?.profile?.work);
        this.file = recordPath(agent.name);
        this.runner = new Runner(this);
        this.ledger = new Ledger(bot, { file: ledgerPath(agent.name), max: this.config.ledger_max, now: this.now,
            label: () => agent.actions?.currentActionLabel || null });
        this.protector = new Protector(bot, { ledger: this.ledger, scope: () => this.clearScope(), config: () => this.config });
        installSafeToBreakPatch();
        guardBot(bot, this.protector, () => this.record?.status === 'active');
        this.disposers.push(() => unguardBot(bot));
        this.listen(bot, 'death', () => this.onDeath());
        const onOwnerMessage = (username, message) => this.onOwnerMessage(username, message);
        this.listen(bot, 'whisper', onOwnerMessage);
        this.listen(bot, 'chat', onOwnerMessage);
        this.guardRespond();
        this.guardActions();
        this.guardCommands();
        this.guardBuild();
        this.guardTurns();
        this.disposers.push(installCleanStop(() => {
            try {
                this.ledger.flush();
            } catch (err) {
                console.error('[work] could not write the placements ledger:', err?.message ?? err);
            }
            this.writeCleanStop();
        }));

        const { record, state } = loadRecord(this.file);
        if (state === 'unknown_version' || state === 'unreadable')
            console.warn(`[work] ${this.file}: ${state}; left untouched, starting with no task`);
        // REQ-OWN-1: the ledger is its own file; on its first load the stations
        // of the S2 record migrate once, and the record's placements key goes.
        this.ledger.load(record?.placements ? { placements: record.placements, structures: record.structures } : null);
        // REQ-OWN-4: scaffold records are kept; at process start (here, not at
        // the runner's per-run reload) every one is marked as from before, and
        // the cells already loaded are checked once (REQ-OWN-5 hygiene).
        this.ledger.startGap();
        this.ledger.install();
        this.disposers.push(() => this.ledger.dispose());
        this.ledger.hygiene(() => true, 'at start');
        this.tidy = new Tidy(this);
        this.disposers.push(() => this.tidy.dispose());
        this.sleeper = new Sleeper(this);
        this.disposers.push(() => this.sleeper.dispose());
        // REQ-CMB-1: the self_defense carry's policy; unknown mob names are logged and dropped.
        this.combat = new Combat(this);
        this.disposers.push(() => this.combat.dispose());
        this.combat.check();
        // REQ-TRV-1: the walk keeper (its listener goes with the disposers).
        this.travel = new Travel(this);
        // REQ-OBT-11: the item names against the registry; a bad list is told once.
        this.items = new Upkeep(this);
        this.items.check();
        this.adopt(record);
        // REQ-REC-7/9: a crash restart is init_message 'Agent process restarted.'
        // with no clean_stop; anything else is a fresh start. clean_stop is
        // cleared in the same write that pauses, so no crash between two
        // writes can revive a stopped task.
        const crash = init_message === RESTART_MESSAGE && Boolean(record) && !record.clean_stop;
        let changed = Boolean(record?.clean_stop);
        if (record) record.clean_stop = false;
        if (record && 'placements' in record) { delete record.placements; changed = true; }
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
        // REQ-REC-12: an open question is not armed after a restart until it
        // is posted again, which also tells the owner it is still open.
        if (record?.pending_question && record.status === 'blocked') setTimeout(() => this.postQuestion({ repost: true }), 0);
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
                    agent.work?.tidy?.onStopCommand();   // REQ-OWN-9: a !stop soon after an owner message keeps the sweep's rest
                } catch (err) {
                    console.error('[work] !stop: could not keep the scaffold:', err?.message ?? err);
                }
                try {
                    agent.work?.stopTask();
                } catch (err) {
                    console.error('[work] !stop: could not write the cancelled task:', err?.message ?? err);
                }
                try {
                    agent.work?.stopBlocks();   // REQ-SAFE-13: the mining question and any grant end
                } catch (err) {
                    console.error('[work] !stop: could not end the mining question:', err?.message ?? err);
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
                // REQ-TRV-2 (design travel r4 §0b S3): it stops the fight but
                // changes no stop epoch, so the held walk is dropped here.
                agent.work?.travel?.drop('!endGoal');
                return perform.call(this, agent, ...args);
            };
            ending.workGuarded = true;
            endGoal.perform = ending;
        }
    }

    // REQ-OWN-9: the owner's raw messages through MindServer reach
    // agent.respondFunc directly (mindserver_proxy.js:66); chat and whispers
    // reach the work layer's own listeners. Observed synchronously, before any
    // translation or model call; this path applies only the !stop keep (it is
    // not the last owner message). MindServer's web UI sends as 'ADMIN', which
    // only_chat_with filters out; the operator helper sends as the owner.
    guardRespond() {
        const agent = this.agent;
        const respondFunc = agent.respondFunc;
        if (typeof respondFunc !== 'function') return;
        const work = this;
        const wrapped = function (username, message, ...rest) {
            if (work.fromOwner(username)) work.ownerGeneration++;
            work.keepOnStop(username, message);
            return respondFunc.call(this, username, message, ...rest);
        };
        agent.respondFunc = wrapped;
        this.disposers.push(() => { if (agent.respondFunc === wrapped) agent.respondFunc = respondFunc; });
    }

    // REQ-OWN-7: the tidy sweep learns which action interrupted it (only a
    // mode's interruption keeps a remainder). Runtime wrap; every caller
    // (modes, commands, the runner) starts actions through runAction.
    // REQ-SLP-2, 7: the sleeper learns the same, and the turn and goal state
    // each action started in (a goal's own action may be cut by sleep).
    // REQ-TRV-1: a walk command runs through the keeper (travel.js), which
    // starts it, and restarts it after a cut, through `start`; every start is
    // the newest run (`lastRun`, the keeper's settle).
    guardActions() {
        const actions = this.agent.actions;
        if (typeof actions?.runAction !== 'function') return;
        const runAction = actions.runAction;
        const work = this;
        const wrapped = function (label, fn, opts) {
            const start = (l, f, o) => {
                work.onActionStart(l, f, o);
                // I1-13 fix wave 1 (Sol S4): an action in place of the task
                // settles the stall clock at its entry (the time before it was
                // the task's) and at its end (none of its time is).
                const inPlace = work.inPlaceLabel(l) && work.record?.status === 'active';
                if (inPlace) work.save();
                const promise = runAction.call(this, l, f, o);
                if (inPlace) {
                    const end = () => { work.stallClock = work.now(); };
                    promise.then(end, end);
                }
                work.lastRun = { label: l, promise };
                return promise;
            };
            if (work.travel?.keeps(label, opts)) return work.travel.run(label, fn, opts, start);
            return start(label, fn, opts);
        };
        actions.runAction = wrapped;
        this.disposers.push(() => { if (actions.runAction === wrapped) actions.runAction = runAction; });
    }

    // REQ-OWN-2: a !buildStructure run's placements are `building` entries,
    // exempt while the run lasts and protected once it returns. The context is
    // entered inside the executed action, after the previous action stopped:
    // the instance's build_goal.executeNext under the action:buildStructure
    // label. The command's perform stays as it is, since runAsAction finds its
    // label by perform identity (actions.js:12).
    guardBuild() {
        const goal = this.agent.npc?.build_goal;
        if (!goal) return;
        const work = this;
        const executeNext = goal.executeNext;
        goal.executeNext = async function (...args) {
            if (work.agent.actions?.currentActionLabel !== 'action:buildStructure') return executeNext.apply(this, args);
            const id = work.ledger.beginBuild();
            try {
                return await executeNext.apply(this, args);
            } finally {
                work.ledger.endBuild(id);
            }
        };
        this.disposers.push(() => { goal.executeNext = executeNext; });
    }

    // REQ-REC-12: the open question takes an answer only while it is armed:
    // once every line of its latest post is out, and while the bot has said
    // nothing else to the owner since. Any other bot chat (a model reply,
    // whatever started its turn) and an owner message that goes on to the
    // model disarm it, with a token of the turn that caused it; when every
    // such turn has finished and its chat is sent, code posts the question
    // again, which arms it. Runtime wraps of this agent's handleMessage (each
    // call is a turn, carried through its awaits) and openChat; no upstream
    // change.
    // The turn also carries its voice (REQ-CHAT-1): `owner` for the owner's
    // message (agent.js's own test: not 'system', not the bot, not another
    // bot), `alert` for the blocked report the work layer hands over (with
    // whether that report's task was the owner's, G3), else `own`; and how
    // many of its lines were shown. An owner turn cut to one response because
    // a goal ran at its start (agent.js max_responses = 1) that ends with
    // none shown (the response was a query) leaves `answerPending`: the next
    // model response of any turn takes it (`takeAnswer`, shown or not; its
    // text is a `reply`, work/chat.js replyCategory), and any shown `reply`
    // clears it (fix wave 1, G1; wave 2, A1).
    guardTurns() {
        const agent = this.agent;
        const work = this;
        const handleMessage = agent.handleMessage;
        agent.handleMessage = function (...args) {
            const [source, message] = args;
            const handoff = work.handoff;
            work.handoff = null;   // consumed at entry, per handoff
            const owner = source !== 'system' && source !== agent.name && !convoManager.isOtherAgent(source);
            const alert = !owner && handoff != null && source === 'system' && message === handoff.message;
            const voice = owner ? 'owner' : alert ? 'alert' : 'own';
            // REQ-SAFE-13: `raw`, the owner's typed command, by
            // agent.js's raw-branch test (his message holds a command); only
            // that command reads it (rawOwnerCommand).
            const raw = owner && typeof message === 'string' ? containsCommand(message) || null : null;
            // `model`: the owner's words go to the model (not a raw command,
            // not an answer code consumes) while a goal runs; only such a turn
            // can leave his answer pending.
            const model = owner && !raw && Boolean(agent.self_prompter?.isActive());
            const turn = { done: false, chats: 0, voice, ownerTask: alert && handoff.ownerTask, shown: 0, model, raw };
            // REQ-OBT-11: every turn in flight, counted synchronously on entry;
            // `turn.action` is the last action started inside it (onActionStart).
            work.liveTurns.add(turn);
            return turns.run(turn, async () => {
                try {
                    // REQ-SAFE-13: a raw owner command is not his answer: it
                    // disarms the mining question here, before agent.js:286 returns.
                    if (raw && work.blockAsk) work.disarm();
                    return await handleMessage.apply(this, args);
                } finally {
                    work.liveTurns.delete(turn);
                    turn.done = true;
                    if (voice === 'owner') work.answerPending = turn.model && turn.shown === 0;
                    work.settle(turn);
                }
            });
        };
        const openChat = agent.openChat;
        agent.openChat = function (...args) {
            // A line the chat gate drops is not said, so it does not disarm (REQ-CHAT-1).
            const category = args[1] ?? 'detail';
            const shown = chatShown(agent, category);
            if (shown) {
                const store = turns.getStore();
                if (store && store !== QUESTION && !store.done) store.shown++;
                if (category === 'reply') work.answerPending = false;
            }
            const token = shown ? work.onChat() : null;
            let sent;
            try {
                sent = openChat.apply(this, args);
            } finally {
                if (token) Promise.resolve(sent).catch(() => {}).finally(() => { token.chats--; work.settle(token); });
            }
            return sent;
        };
        this.disposers.push(() => { agent.handleMessage = handleMessage; agent.openChat = openChat; });
    }

    // The voice of the turn code runs in, or null outside a live turn: a
    // finished turn and the question's post (runner code started from a turn
    // inherits its store) never read as the owner's.
    turnVoice() {
        const store = turns.getStore();
        return store && store !== QUESTION && !store.done ? store.voice : null;
    }

    // A model response takes the owner's pending answer (G1, A1): true once,
    // whether or not the response shows any text.
    takeAnswer() {
        const pending = this.answerPending;
        this.answerPending = false;
        return pending;
    }

    // A task started in this turn is the owner's (REQ-CHAT-1): his own turn,
    // or the blocked-report turn about a task of his (G3).
    ownerTurn() {
        const voice = this.turnVoice();
        return voice === 'owner' || (voice === 'alert' && Boolean(turns.getStore().ownerTask));
    }

    // Disarms the open question for the current turn (or, outside a live
    // turn, for a token that is already finished) and returns the token.
    // REQ-SAFE-13: the mining question follows the same rule; after its one
    // re-post, any further disarm (a non-answer or bot chat) clears it.
    disarm() {
        const store = turns.getStore();
        const token = store && store !== QUESTION && !store.done ? store : { done: true, chats: 0 };
        this.armed = null;
        if (this.blockAsk?.reposted) this.dropBlockAsk('disarmed after its re-post');
        else if (this.blockAsk) this.blockAsk.armed = false;
        this.disarming.add(token);
        return token;
    }

    // A bot chat to the owner: anything but the question's own lines disarms it.
    onChat() {
        if (turns.getStore() === QUESTION || (!this.record?.pending_question && !this.blockAsk)) return null;
        const token = this.disarm();
        token.chats++;
        return token;
    }

    settle(token) {
        if (!token.done || token.chats || !this.disarming.delete(token) || this.disarming.size) return;
        if (this.blockAsk) {
            this.postBlockAsk(this.blockAsk, { repost: true });
            return;
        }
        if (this.record?.pending_question) this.log(`asking the owner again (${this.record.pending_question.kind})`);
        this.postQuestion({ repost: true });
    }

    // Posts the open question, and arms it once every line is sent, if it is
    // still the current question and post and nothing disarmed it meanwhile.
    // A re-post goes into history as a code line (I1-5).
    async postQuestion({ repost = false } = {}) {
        const record = this.record;
        const question = record?.pending_question;
        if (this.disposed || !question || record.status !== 'blocked') return;
        const posting = ++this.postings;
        this.armed = null;
        // Checked before every line: a replaced task or question, or a newer
        // post of the same one, stops this post (its lines could otherwise
        // ask the owner about the task that replaced it).
        const current = () => {
            const now = this.record;
            return posting === this.postings && now?.id === record.id && now.pending_question?.id === question.id && now.status === 'blocked';
        };
        let sent;
        try {
            sent = await turns.run(QUESTION, () => this.deliver(question.text, { current, category: 'question', code: repost }));
        } catch (err) {
            console.error('[work] could not post the owner question:', err?.message ?? err);
            return;
        }
        if (sent && current() && !this.disarming.size) this.armed = question.id;
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
    }

    reload() {
        const { record, state } = loadRecord(this.file);
        if (state === 'ok') this.adopt(record);
    }

    write() {
        if (this.disposed) return;
        saveRecord(this.file, this.record, this.now());
        this.lastWrite = this.now();
        // REQ-OWN-1: the ledger is flushed at task changes (a new task or a
        // status change), between them at most once per 2 s.
        const state = `${this.record?.id}:${this.record?.status}`;
        if (state === this.writtenState) return;
        this.writtenState = state;
        try {
            this.ledger?.flush();
        } catch (err) {
            console.error('[work] could not write the placements ledger:', err?.message ?? err);
        }
    }

    // The active clear step's box scope for the Protector (REQ-CLR-5): only
    // while the task is active and its current step is a clear step.
    clearScope() {
        const record = this.record;
        if (record?.status !== 'active') return null;
        // The box and its grants hold in the anchor's dimension only.
        if (record.anchor?.dim && (this.agent.bot.game?.dimension ?? 'overworld') !== record.anchor.dim) return null;
        const step = record.plan[record.cursor];
        return step?.skill === 'clear' ? clearScope(step, this.config) : null;
    }

    resetStallClock() {
        this.stallClock = this.now();
    }

    // REQ-RES-16 (S2d): an explicit hold while mode:sleeping or action:bed
    // runs. On entry the work time up to then is charged; during the hold the
    // clock advances without charging; the hold closes before the task
    // resumes (the routines' finally), so no sleep time reaches a later save.
    holdStall() {
        if (this.stallHeld) return;
        try {
            this.save();
        } catch (err) {
            console.error('[work] could not save before the sleep hold:', err?.message ?? err);
        }
        this.stallHeld = true;
    }

    releaseStall() {
        this.stallHeld = false;
        this.stallClock = this.now();
    }

    // I1-13: an action other than the task's run, a mode or upkeep is running.
    inPlaceOfTask() {
        const actions = this.agent.actions;
        return this.inPlaceLabel(actions?.executing ? actions.currentActionLabel : null);
    }

    inPlaceLabel(label) {
        return Boolean(label) && label !== 'action:task' && !label.startsWith('mode:') && !this.isUpkeep(label);
    }

    // Every write of an active task adds the elapsed process time to the
    // current step's stalled_s, so it carries across restarts while time with
    // the process down does not count; at work.step_stall_s the step blocks
    // with its last recorded cause (REQ-RES-16).
    // `sample` (the self-heal timer's periodic save) measures the step first,
    // so a long call that keeps progressing is not counted as stalled.
    // I1-17 (DECISIONS 2026-11-14): accumulated unrounded, so frequent writes
    // add up. I1-13: no time is charged while an action runs in place of the
    // task (the owner's or the model's: not the run, a mode or upkeep); the
    // task resumes after it (§7.5).
    save({ sample = false } = {}) {
        const record = this.record;
        if (!record) return;
        const now = this.now();
        const step = record.status === 'active' ? record.plan[record.cursor] : null;
        if (step?.progress) {
            if (sample && updateProgress(step, STEPS[step.skill].measure(this.runner.ctx(), step), now)) this.stallClock = now;
            if (!this.stallHeld && !this.inPlaceOfTask()) step.progress.stalled_s += (now - this.stallClock) / 1000;
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

    // The follow's target while it runs (its GoalFollow entity), kept for the
    // pending follow it belongs to; else the owner. One helper and one cache
    // for the item cleanup and combat (combat design r10 §4): combat's mode
    // update calls it while the follow still runs, so it learns whom she follows.
    followTarget() {
        const actions = this.agent.actions;
        const bot = this.agent.bot;
        const goal = bot.pathfinder?.goal;
        if (actions.currentActionLabel === FOLLOW_LABEL && actions.currentActionFn === actions.resume_func && goal?.entity?.username)
            this.follow = { fn: actions.resume_func, name: goal.entity.username };
        const name = this.follow?.fn === actions.resume_func ? this.follow.name : this.owner();
        return name ? bot.players?.[name]?.entity ?? null : null;
    }

    view() {
        return renderView(this.record, { bot: this.agent.bot, selfPromptActive: !this.agent.self_prompter?.isStopped(), now: this.now(),
            sleeping: Boolean(this.sleeper?.asleep()) });
    }

    neededItems() {
        const items = new Set();
        const record = this.record;
        if (!record) return items;
        // A finished task's goods (gear design r5 §5; DECISIONS 2026-11-13: "a
        // finished task's goods stay 30 minutes or until the next task, even
        // over the cap"): the obtain targets of the last done task, from its
        // `done_at` (a record done before it was stamped protects nothing).
        const keepMs = (this.config.inventory.done_keep_min ?? 0) * 60000;
        if (record.status === 'done' && Number.isFinite(record.done_at) && this.now() - record.done_at < keepMs)
            for (const step of record.plan) if (step.skill === 'obtain' && step.args?.item) items.add(step.args.item);
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

    fromOwner(username) {
        if (username === this.agent.name) return false;
        const allowed = settings.only_chat_with || [];
        return !allowed.length || allowed.includes(username);
    }

    onOwnerMessage(username, message) {
        if (!this.fromOwner(username)) return;
        this.ownerGeneration++;
        this.lastOwnerMessage = { username, message, at: this.now() };
        this.keepOnStop(username, message);
    }

    // REQ-OWN-9: an owner !stop keeps the sweep's rest at once, parsed with the
    // command parser handleMessage uses; stopping stays with !stop.
    // REQ-OBT-11: during an item pass it also holds the idle cleanup.
    keepOnStop(username, message) {
        if (!this.fromOwner(username)) return;
        try {
            if (typeof message === 'string' && containsCommand(message) === '!stop') {
                this.items?.onOwnerStop();
                this.tidy?.keep('owner !stop');
            }
        } catch (err) {
            console.error('[work] could not keep the scaffold on the owner\'s !stop:', err?.message ?? err);
        }
    }

    // REQ-OWN-8: the modes carry calls this at the end of every mode action.
    onModeEnd(name, codeReturn) {
        this.tidy?.onModeEnd(name, codeReturn);
    }

    // Every action start (the runAction wrap, guardActions).
    onActionStart(label, fn, opts) {
        this.actionStarts++;
        this.lastStart = { label, voice: this.turnVoice(), goal: Boolean(this.agent.self_prompter?.isActive()) };
        // REQ-OBT-11 (C-F1): the turn an action starts in stays open while it runs.
        const store = turns.getStore();
        if (store && store !== QUESTION && !store.done) store.action = { label, fn };
        this.tidy?.onActionStart(label);
        this.travel?.onActionStart(label);
        try {
            this.sleeper?.onActionStart(label, fn, opts);
        } catch (err) {
            console.error('[sleep] could not mark the night:', err?.message ?? err);
        }
    }

    // Her own upkeep (REQ-OWN-8, REQ-SLP-9, REQ-OBT-11): the tidy sweep, the
    // sleep routine, the bed pickup, the item cleanup.
    isUpkeep(label) {
        return label === 'action:tidy' || SLEEP_LABELS.has(label) || label === ITEMS_LABEL;
    }

    // The actions a mode may cut without a model call (the modes carry):
    // upkeep, and a walk the keeper holds (REQ-TRV-1).
    isQuietAction(label) {
        return this.isUpkeep(label) || Boolean(this.travel?.holds(label));
    }

    // REQ-CHAT-2: her death is one code `alert` line; the model's turn for it
    // (agent.js messagestr) is her own, so quiet drops its text.
    onDeath() {
        const paused = this.record?.status === 'active';
        if (paused) this.pause('died');
        const pos = this.agent.bot.entity?.position;
        if (pos) this.postReport(deathLine(pos, paused), { category: 'alert' });
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
        // REQ-RES-16 (S2d): sleep and the bed pickup keep the step's last cause.
        if (step?.progress && !SLEEP_LABELS.has(this.lastStart?.label)) step.progress.last_cause = 'interruption';
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
        this.expireBlockAsk();
        // REQ-SLP-5: the bed pickup, before the active-task guard and whatever
        // work.sleep.when says.
        try {
            this.sleeper?.reconcile();
        } catch (err) {
            console.error('[sleep] the bed check failed:', err);
        }
        // REQ-OBT-11: the idle item cleanup, after the bed (bed pickup > tidy > items).
        try {
            this.items?.tick();
        } catch (err) {
            console.error('[items] the cleanup check failed:', err);
        }
        const record = this.record;
        if (record?.status !== 'active') { this.idleSince = null; return; }
        this.watch();
        if (record.status !== 'active') return;
        const actions = this.agent.actions;
        const last = record.interruptions.last;
        if (last && last.by == null && actions.currentActionLabel && actions.currentActionLabel !== 'action:task') {
            last.by = actions.currentActionLabel;
            // REQ-RES-16 (S2d): sleep and the bed pickup keep the step's last cause.
            if (record.plan[record.cursor]?.progress && !SLEEP_LABELS.has(last.by)) record.plan[record.cursor].progress.last_cause = `${last.by} interruption`;
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

    // The in-task sweep flag belongs to its task (REQ-OWN-8).
    endTidyFlag() {
        if (this.runner) this.runner.tidyAfterMode = null;
    }

    cancel(reason) {
        setStatus(this.record, 'cancelled', reason);
        this.endTidyFlag();
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
        const ownerTask = ownerAsked(record);   // before the goal is cleared (G3)
        record.goal = null; // the report says the goal stays stopped: it does, also after a resume
        // REQ-CHAT-2: blocks per step ordinal (owner questions are not blocks),
        // kept through resume; the second one is said by code, once, whatever
        // the model does with the report.
        let again = null;
        if (step) {
            const n = record.cursor + 1;
            const counts = record.blocks_by_step ??= {};
            counts[n] = (counts[n] ?? 0) + 1;
            if (counts[n] === 2) again = blockedAgainLine(n, cause);
        }
        this.write();
        if (again) {
            this.log(`step ${record.cursor + 1} blocked a second time`);
            this.postReport(again, { category: 'alert' });
        }
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
            // REQ-CHAT-1: marked right before the call; guardTurns consumes it
            // at the turn's entry, so that turn's voice is `alert`.
            this.handoff = { message: report, ownerTask };
            try {
                this.agent.handleMessage('system', report);
            } finally {
                this.handoff = null;
            }
        };
        if (this.runner.executing) {
            this.runner.afterRun = post;
            timer = setTimeout(post, this.reportWaitMs);
        } else setTimeout(post, 0);
    }

    // REQ-REC-12: code asks the owner; the task is blocked(awaiting_owner) with
    // no model call and no timeout. The question goes to the owner directly and
    // into history, so the model knows it is open.
    askOwner(step, ask) {
        const record = this.record;
        this.dropBlockAsk('a task question was asked');   // REQ-SAFE-13: one question at a time
        record.pending_question = newQuestion(ask, this.now());
        setStatus(record, 'blocked', 'awaiting_owner');
        step.status = 'blocked';
        this.releaseResume();
        this.log(`asked the owner (${ask.kind}): ${ask.text}`);
        this.write();
        this.disarming.clear();   // a turn that spoke before this question is not why it is re-posted
        this.postQuestion();
    }

    // The agent.js interception, before the model (REQ-REC-12): true when the
    // owner's message answered the open question and was consumed. Only the
    // owner's own chat answers; anything else goes on to the model and the
    // question stays open.
    answerQuestion(source, message) {
        if (this.blockAsk && this.answerBlockAsk(source, message)) return true;
        const record = this.record;
        const question = record?.pending_question;
        if (!question || record.status !== 'blocked') return false;
        const owner = record.requested_by ?? this.owner();
        if (!owner || source !== owner) return false;
        // Only an armed question takes an answer: until code has posted it
        // again after the bot's last other words, a yes may answer those
        // (guardTurns).
        if (this.armed !== question.id) return false;
        const answer = parseAnswer(message, question.options);
        if (!answer) {
            this.settle(this.disarm());   // goes to the model; re-posted after this turn
            return false;
        }
        const step = record.plan[record.cursor];
        const outcome = STEPS[step.skill].answer?.(this.runner.ctx(), step, question, answer) ?? {};
        record.pending_question = null;
        const store = turns.getStore();
        if (store && store !== QUESTION) store.model = false;   // answered by code: nothing pending (G1)
        this.log(`the owner answered ${question.kind}: ${answer}`);
        const line = `Asked the owner: "${question.text}" The owner answered: ${answer}.`;
        this.agent.history.add('system', line).then(() => this.agent.history.save())
            .catch(err => console.error('[work] could not save the answered question:', err?.message ?? err));
        if (outcome.cancel) {
            this.cancel(outcome.cancel);
            return true;
        }
        step.status = 'pending';
        setStatus(record, 'active');
        this.activate();
        this.write();
        this.scheduleRun();
        return true;
    }

    // --- the owner's blocks on request (REQ-SAFE-13; design ownblocks r4 §3) ---

    // True only for the live owner turn's own typed command (the guardTurns
    // marker), once: the grant authority is here and in the perform, never a
    // skills option generated code could pass (a typed !newAction is raw too).
    rawOwnerCommand(name) {
        const store = turns.getStore();
        if (!store || store === QUESTION || store.done || store.voice !== 'owner' || store.raw !== name) return false;
        store.raw = null;
        return true;
    }

    // The grantable cells of `type` around where she stands now, nearest first,
    // by the complete search; the first `num`, frozen with their dimension.
    grantCandidates(type, num) {
        const bot = this.agent.bot;
        const start = bot.entity.position.floored();
        const dim = bot.game?.dimension ?? 'overworld';
        const radius = this.config.collect.placed_radius;
        const all = findAllBlocks(bot, type, radius, start).positions.filter(pos => this.protector.grantable(bot.blockAt(pos)));
        return { cells: all.slice(0, num).map(p => ({ x: p.x, y: p.y, z: p.z, name: type, dim })), more: Math.max(0, all.length - num), radius };
    }

    // !collectPlaced (DECISIONS 2026-11-13, "if I ask, obviously she can mine
    // a block that I placed, but only if I ask"): typed by the owner it mines
    // at once; run by the model in his turn, code asks him about the exact
    // cells and only his yes grants them; in any other turn it is refused.
    async collectPlaced(type, num) {
        // Before the first await: the start position, the dimension and whether this is his typed command.
        const typed = this.rawOwnerCommand('!collectPlaced');
        if (!typed && this.turnVoice() !== 'owner') return PLACED_NOT_OWNER;
        if (!typed && this.record?.pending_question && this.record.status === 'blocked') return PLACED_TASK_QUESTION;
        // His typed command is a newer ask: an open mining question lapses, never re-posted (rulings r1 A8).
        if (typed) this.dropBlockAsk('a typed !collectPlaced');
        const { cells, more, radius } = this.grantCandidates(type, num);
        if (!cells.length) return `No protected ${type} within ${radius} that I may mine.`;
        if (!typed) {
            // A plain perform that returns nothing, so the model's loop ends
            // (the work/commands.js pattern); his answer is read before the model.
            await this.askBlocks(type, cells, more);
            return;
        }
        console.log(`[protect] owner grant (typed): ${type} ×${cells.length} at ${cells.map(cellText).join('; ')}`);
        const result = await this.runGrant(type, num, cells, cells);
        const message = withSummary(result.message ?? '', result.summary);
        // As runAsAction: an interrupted run keeps its output in history and ends the loop.
        if (result.interrupted && !result.timedout) {
            if (message) {
                await this.agent.history.add('system', message);
                await this.agent.history.save();
            }
            return;
        }
        return message;
    }

    // The granted action: `granted` (the cells still grantable) are exempt
    // only inside its own function; the frozen `cells` are dug in order.
    // Returns the action's result with `summary`, the complete summary line
    // (the action output may shorten it, rulings r1 S5). The stop epoch and
    // the open mining question are captured before runAction queues the
    // function: a !stop (or a newer ask) while an older action is still
    // stopping means nothing is granted (rulings r1 S1).
    async runGrant(type, num, cells, granted) {
        const bot = this.agent.bot;
        const epoch = this.agent.stop_epoch;
        const asked = this.blockAsk;
        let summary = null;
        const result = await this.agent.actions.runAction(PLACED_LABEL, async () => {
            if (this.agent.stop_epoch !== epoch || this.blockAsk !== asked) {
                console.log('[protect] owner grant dropped: a !stop or a newer ask came first');
                return;
            }
            summary = (await this.protector.withGrant(granted, () => skills.collectGrantedCells(bot, type, num, cells))).summary;
        }, { timeout: 10 });
        return { ...result, summary };
    }

    async askBlocks(type, cells, more) {
        this.dropBlockAsk('a newer ask');
        const ask = { type, cells, owner: this.owner(), text: blockQuestion(type, cells, more), asked_at: this.now(), armed: false, reposted: false };
        this.blockAsk = ask;
        this.disarming.clear();   // a turn that spoke before this question is not why it is re-posted
        console.log(`[protect] asked the owner: ${ask.text}`);
        await this.postBlockAsk(ask);
    }

    // Posts the mining question and arms it once every line is out, if it is
    // still the open one and nothing disarmed it meanwhile (the task
    // question's rule, postQuestion); a re-post happens once.
    async postBlockAsk(ask, { repost = false } = {}) {
        if (this.disposed || this.blockAsk !== ask) return;
        if (repost) {
            ask.reposted = true;
            console.log('[protect] asking the owner again (the mining question)');
        }
        ask.armed = false;
        const current = () => this.blockAsk === ask;
        let sent;
        try {
            sent = await turns.run(QUESTION, () => this.deliver(ask.text, { current, category: 'question', code: repost }));
        } catch (err) {
            console.error('[work] could not post the mining question:', err?.message ?? err);
            return;
        }
        if (sent && current() && !this.disarming.size) ask.armed = true;
    }

    dropBlockAsk(why) {
        if (!this.blockAsk) return;
        this.blockAsk = null;
        console.log(`[protect] the mining question lapsed (${why})`);
        this.agent.history.add('system', PLACED_LAPSED).then(() => this.agent.history.save())
            .catch(err => console.error('[work] could not save the lapsed question:', err?.message ?? err));
    }

    expireBlockAsk() {
        if (this.blockAsk && this.now() - this.blockAsk.asked_at >= this.config.collect.question_s * 1000) this.dropBlockAsk('no answer in time');
    }

    // The !stop wrapper: the question and any grant end at once.
    stopBlocks() {
        this.dropBlockAsk('stop');
        if (this.protector) this.protector.grant = null;
    }

    // The agent.js interception (answerQuestion): his armed yes or no, by the
    // task question's parser; a non-answer of his disarms it.
    answerBlockAsk(source, message) {
        this.expireBlockAsk();
        const ask = this.blockAsk;
        if (!ask || !ask.owner || source !== ask.owner || !ask.armed) return false;
        const answer = parseAnswer(message, ['yes', 'no']);
        if (!answer) {
            this.settle(this.disarm());   // goes to the model; re-posted once after this turn
            return false;
        }
        this.blockAsk = null;
        const store = turns.getStore();
        if (store && store !== QUESTION) store.model = false;   // answered by code: nothing pending (G1)
        console.log(`[protect] the owner answered the mining question: ${answer}`);
        this.agent.history.add('system', `Asked the owner: "${ask.text}" The owner answered: ${answer}.`).then(() => this.agent.history.save())
            .catch(err => console.error('[work] could not save the answered question:', err?.message ?? err));
        if (answer === 'yes') this.grantAsked(ask).catch(err => console.error('[work] the granted collect failed:', err?.message ?? err));
        else this.deliver(PLACED_LEFT, { category: 'reply', record: false }).catch(err => console.error('[work] could not answer the no:', err?.message ?? err));
        return true;
    }

    // His yes: each cell re-validated (still that block, in this dimension,
    // still grantable), the listed cells dug with no model call; then the
    // result goes back to the model once (DECISIONS 2026-11-13, "after his yes
    // the result goes back to the model"), after the action has ended, as the
    // blocked report does (blockStep): dropped after a !stop or a newer action.
    async grantAsked(ask) {
        const bot = this.agent.bot;
        const dim = bot.game?.dimension ?? 'overworld';
        const granted = ask.cells.filter(c => {
            const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
            return c.dim === dim && block?.name === c.name && this.protector.grantable(block);
        });
        console.log(`[protect] owner grant (answered yes): ${ask.type} ×${granted.length} at ${granted.map(cellText).join('; ')}`);
        const stopEpoch = this.agent.stop_epoch;
        const run = this.runGrant(ask.type, ask.cells.length, ask.cells, granted);
        const ours = this.actionStarts;   // counted synchronously as the action started (guardActions)
        const result = await run;
        const summary = result.summary;
        const message = withSummary(result.message ?? '', summary);
        try {
            if (summary) await this.deliver(summary, { category: 'reply', record: false });
        } catch (err) {
            console.error('[work] could not tell the granted collect:', err?.message ?? err);
        }
        if (!message) return;
        if (this.disposed || this.agent.stop_epoch !== stopEpoch || this.actionStarts !== ours || (result.interrupted && !result.timedout)) {
            await this.agent.history.add('system', message);
            await this.agent.history.save();
            return;
        }
        // REQ-CHAT-1: marked right before the call; the turn's voice is
        // `alert`, never the owner's, so a !collectPlaced in it is refused.
        this.handoff = { message, ownerTask: true };
        try {
            Promise.resolve(this.agent.handleMessage('system', message))
                .catch(err => console.error('[work] could not hand the granted collect back:', err?.message ?? err));
        } finally {
            this.handoff = null;
        }
    }

    finishDone() {
        setStatus(this.record, 'done');
        // Stamped once (gear design r5 §5): later saves move updated_at, never done_at.
        this.record.done_at ??= this.now();
        this.endTidyFlag();
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
        // REQ-CHAT-1: a task the owner asked for ends with one short line in
        // quiet (a clear keeps its whole report: anything left must show); one
        // she started herself says nothing. A record from before notify_done
        // is judged here, with no write-back.
        const report = doneReport(record, this.agent.bot);
        const notify = ownerAsked(record);
        const whole = chatMode(this.agent) === 'debug' || record.plan.some(s => s.skill === 'clear');
        this.postReport(report, { then: goal ? handBack : null, category: notify ? 'done' : 'detail', chat: whole ? report : doneLine(record) });
    }

    fail(reason) {
        setStatus(this.record, 'failed', reason);
        this.endTidyFlag();
        this.releaseResume();
        this.log(`failed: ${reason}`);
        const report = failedReport(this.record, this.agent.bot);
        this.record.goal = null;
        this.write();
        this.postReport(report, { category: 'alert' });
    }

    // Fix wave 1 (Sol S3, I1-5): a command result that is a code line (the
    // worded !tidy's line) is marked here; agent.js's command loop asks
    // isCodeResult when it writes the result, once.
    codeResult(line) {
        this.code_result = line;
        return line;
    }

    isCodeResult(result) {
        const hit = result != null && result === this.code_result;
        this.code_result = null;
        return hit;
    }

    // A fact report needs no model call: it goes into history and to the
    // owner, whole, as chat lines (report.js chatLines).
    // `options` go to deliver; `then` runs once it is done.
    postReport(report, { then = null, ...options } = {}) {
        setTimeout(async () => {
            try {
                await this.deliver(report, options);
            } catch (err) {
                console.error('[work] could not post a report:', err?.message ?? err);
            }
            then?.();
        }, 0);
    }

    // Lines of one report are paced, so a long one does not trip the
    // server's chat-spam kick (vanilla: +20 a message, -1 a tick, kick above 200).
    // All of it goes through one queue with one next-send time, so two
    // deliveries never interleave or send faster than one line a gap.
    // REQ-CHAT-1: the report always goes into history; its chat text (`chat`,
    // by default the report) is queued only when its category is shown, with
    // no pacing wait for a dropped one. False when it was dropped or `current`
    // stopped it. `record` false leaves history to the caller (a hand-back
    // to the model records it as its own message). `code` (I1-5, DECISIONS
    // 2026-11-14): a code line of the work layer's own (the tidy line, a
    // re-posted question), visible to the model but never summarised (history.js).
    async deliver(report, { current = () => true, category = 'detail', chat = report, record = true, code = false } = {}) {
        if (record) {
            await this.agent.history.add('system', report, { code });
            await this.agent.history.save();
        }
        if (!chatShown(this.agent, category)) {
            console.log(`[chat] quiet: dropped (${category}): ${chat}`);
            return false;
        }
        const lines = chatLines(chat);
        const job = this.outbox.then(async () => {
            for (const line of lines) {
                const wait = this.nextSend - Date.now();
                if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
                if (this.disposed || !current()) return false;
                await this.agent.openChat(line, category);
                this.nextSend = Date.now() + this.lineGapMs;
            }
            return true;
        });
        this.outbox = job.catch(() => {});
        return job;
    }

    // REQ-PLAN-8: the anchor is frozen before validation, which uses it.
    planContext(anchor = null) {
        const ctx = { bot: this.agent.bot, owner: this.owner(), config: this.config };
        ctx.anchor = anchor ?? resolvePosition(ctx, 'here');
        return ctx;
    }

    // What the steps state about themselves in the confirmation (REQ-CLR-4).
    // A markers= clear's statement is apart (`statement`, null when none): it
    // is said as an `alert` line of its own whoever started the task, since
    // that box is cleared at once (REQ-CHAT-1); a box= clear states its box in
    // its question, so its statement stays in the line.
    statements(steps) {
        const marked = s => s.skill === 'clear' && Boolean(s.args.markers);
        const texts = list => list.map(s => STEPS[s.skill].describe?.(s.args)).filter(Boolean);
        return { inline: texts(steps.filter(s => !marked(s))).map(text => ` ${text}`).join(''),
            statement: texts(steps.filter(marked)).join(' ') || null };
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
        this.endTidyFlag();
        const owner = ctx.owner;
        const request_text = this.lastOwnerMessage && this.lastOwnerMessage.username === owner ? this.lastOwnerMessage.message : null;
        // REQ-CHAT-1: the owner hears the done line only for a task he asked
        // for: started in his turn.
        const record = newRecord({
            objective: String(objective), request_text, requested_by: owner,
            anchor: ctx.anchor, steps, now: this.now(), notify_done: this.ownerTurn(),
        });
        this.adopt(record);
        this.activate();
        this.write();
        this.log(`started: "${record.objective}" with ${steps.length} step(s)`);
        this.scheduleRun();
        const { inline, statement } = this.statements(steps);
        return { ok: true, message: `Task started: "${record.objective}" (${steps.length} step${steps.length === 1 ? '' : 's'}).${inline}`, statement };
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
        const ctx = this.planContext(record.anchor);
        const { steps, errors } = planFromText(ctx, stepsText, { offset: fromStep - 1, maxSteps: Infinity });
        if (kept.length + steps.length > this.config.max_steps) errors.push(`more than ${this.config.max_steps} steps`);
        if (errors.length) return { ok: false, message: refusal('!taskRevise', errors) };
        // REQ-REC-12: a revision that keeps the step that asked the owner leaves
        // the question open and the task blocked(awaiting_owner); one that
        // replaces that step drops the question (a new clear step asks its own).
        const waiting = Boolean(record.pending_question) && fromStep - 1 > record.cursor;
        // REQ-CHAT-2: a revised ordinal whose skill or args changed is not the
        // same step; its block count starts again.
        const old = record.plan;
        for (const [i, s] of steps.entries()) {
            const before = old[fromStep - 1 + i];
            if (record.blocks_by_step && (!before || before.skill !== s.skill || !sameArgs(before.args, s.args)))
                delete record.blocks_by_step[fromStep + i];
        }
        record.plan = [...kept, ...steps.map((s, i) => newStep(fromStep + i, s.skill, s.args))];
        // REQ-CHAT-1: an owner's revision makes it his task.
        if (this.turnVoice() === 'owner') record.notify_done = true;
        const { inline, statement } = this.statements(steps);
        if (waiting) {
            this.write();
            this.log(`revised from step ${fromStep}; still waiting for the owner's answer`);
            return { ok: true, message: `Task revised from step ${fromStep}: now ${record.plan.length} steps. Still waiting for the owner's yes or no.${inline}`, statement };
        }
        record.cursor = record.plan.findIndex(s => s.status !== 'done');
        if (record.cursor === -1) record.cursor = record.plan.length;
        record.pending_question = null;
        if (record.status !== 'active') setStatus(record, 'active');
        this.activate();
        this.write();
        this.log(`revised from step ${fromStep}`);
        // A run of the old plan ends now (its interruption is not counted, the
        // plan generation changed) and a run of the new plan starts.
        if (this.runner.executing && this.agent.actions.currentActionLabel === 'action:task') await this.agent.actions.stop();
        this.scheduleRun();
        return { ok: true, message: `Task revised from step ${fromStep}: now ${record.plan.length} step${record.plan.length === 1 ? '' : 's'}.${inline}`, statement };
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
        // REQ-REC-12: no command answers an owner question, from the model or
        // the owner alike.
        if (record.pending_question) return { ok: false, message: "!taskResume refused: waiting for the owner's yes or no; only the owner can answer" };
        const step = record.plan[record.cursor];
        if (step) {
            step.status = 'pending';
            step.attempts = 0;
            if (step.progress) { step.progress.stalled_s = 0; step.progress.junk_drops = 0; step.progress.junk_givebacks = 0; }
            // A resumed give starts a new baseline: it re-gives only the
            // outstanding count from what is in the inventory now.
            if (step.skill === 'give' && step.progress) step.progress.inv_start = null;
        }
        setStatus(record, 'active');
        if (this.turnVoice() === 'owner') record.notify_done = true;   // REQ-CHAT-1, as in reviseTask
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
