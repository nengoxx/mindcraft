import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { botDataPath, botLogPath } from '../utils/runtime_paths.js';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from '../agent/commands/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../agent/settings.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectAPI, createModel } from './_model_map.js';
import { loadWorkConfig } from '../agent/work/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Prompter {
    constructor(agent, profile) {
        this.agent = agent;
        this.profile = profile;
        const defaults_dir = path.join(__dirname, '../../profiles/defaults');
        let default_profile = JSON.parse(readFileSync(path.join(defaults_dir, '_default.json'), 'utf8'));
        let base_fp = '';
        if (settings.base_profile.includes('survival')) {
            base_fp = path.join(defaults_dir, 'survival.json');
        } else if (settings.base_profile.includes('assistant')) {
            base_fp = path.join(defaults_dir, 'assistant.json');
        } else if (settings.base_profile.includes('creative')) {
            base_fp = path.join(defaults_dir, 'creative.json');
        } else if (settings.base_profile.includes('god_mode')) {
            base_fp = path.join(defaults_dir, 'god_mode.json');
        }
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base

        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.decisions = 0; // fork carry (I1-1): decisions in flight (promptConvo)
        this.awaiting_coding = false;
        this.coding_abort_controller = null;

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        let chat_model_profile = selectAPI(this.profile.model);
        this.chat_model = createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = selectAPI(this.profile.code_model);
            this.code_model = createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            let vision_model_profile = selectAPI(this.profile.vision_model);
            this.vision_model = createModel(vision_model_profile);
        }
        else {
            this.vision_model = this.chat_model;
        }

        // Fork carry (REQ-RES-17, OQ-21): the prompter is built before Work, so it
        // reads the model keys of the profile's work section itself and hands the
        // client timeout and retry count to the providers that take them.
        this.work_config = loadWorkConfig(this.profile.work);
        for (const model of new Set([this.chat_model, this.code_model, this.vision_model]))
            model.configureClient?.(this.work_config);

        let embedding_model_profile = null;
        if (this.profile.embedding) {
            try {
                embedding_model_profile = selectAPI(this.profile.embedding);
            } catch (e) {
                embedding_model_profile = null;
            }
        }
        if (this.profile.embedding === false) {
            this.embedding_model = null;
        }
        else if (embedding_model_profile) {
            this.embedding_model = createModel(embedding_model_profile);
        }
        else {
            this.embedding_model = createModel({api: chat_model_profile.api});
        }

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(botDataPath(name), { recursive: true });
        writeFileSync(botDataPath(name, 'last_profile.json'), JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent) + '\n';
            stats += await getCommand('!entities').perform(this.agent) + '\n';
            stats += await getCommand('!nearbyBlocks').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent));
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            prompt = prompt.replaceAll(
                '$CODE_DOCS',
                await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
            );
        }
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            // Fork carry: the task view replaces this text whenever a task record exists (REQ-REC-10).
            const task_view = this.agent.work?.view();
            let self_prompt = task_view ? task_view + '\n' : !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : 'You currently have no active persistent goal. Do not resume a goal that was stopped or ended, or a task that appears only in your memory summary, unless the owner asks again. Respond to the owner\'s latest request in the conversation normally, following your usual instructions for new or resumed work.\n';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    // REQ-OBS-1: the request kind and the current task's id reach the provider
    // in sendRequest's options. REQ-RES-17: so does an `outcome` object, which
    // the openai_tools provider marks `unreachable` (with the cause) when the
    // model could not be reached; other providers ignore it.
    // I1-2 (DECISIONS 2026-11-14): `kind_params`, the profile's request body
    // params for this kind (work.request_params[kind]), which the openai_tools
    // provider sends over the model's own params; a kind with none keeps them.
    requestOptions(kind, extra = {}) {
        const kind_params = this.work_config?.request_params?.[kind];
        return { outcome: {}, ...extra, kind, task_id: this.agent.work?.taskId() ?? null, ...(kind_params ? { kind_params } : {}) };
    }

    // REQ-RES-17: every call reports to the shared outage state, which tells the
    // owner once when an outage begins and once when it ends. True when reachable.
    reachable(outcome) {
        if (outcome.unreachable) {
            this.agent.model_outage?.down(outcome.unreachable);
            return false;
        }
        this.agent.model_outage?.up();
        return true;
    }

    // REQ-RES-18: the recovery probe of an outage-paused goal, one short request
    // (with the profile's params, so not always a quick one: SPEC §16).
    async probeModel() {
        const options = this.requestOptions('probe');
        await this.chat_model.sendRequest([{role: 'user', content: 'ping'}], 'Reply with the single word OK.', undefined, options);
        return this.reachable(options.outcome);
    }

    summaryTimeoutMs() {
        return (this.work_config?.summary_timeout_s ?? 120) * 1000;
    }

    // Final ruling (build2 r3): during an engine stall a summary cut by its
    // deadline gets double the deadline at its next attempt, capped by
    // work.model_timeout_s, and back to work.summary_timeout_s after one
    // completes, so slow summaries still publish. A decision's wait stays
    // summaryTimeoutMs.
    summaryRequestMs() {
        const cap = (this.work_config?.model_timeout_s ?? 600) * 1000;
        return Math.min(this.summaryTimeoutMs() * 2 ** (this.summary_cuts ?? 0), Math.max(cap, this.summaryTimeoutMs()));
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    // Fork carry (REQ-RES-17/18): every turn is registered from entry, before any
    // await, until it ends, so the recovery probe never resumes a goal over a
    // turn still running or waiting. `self_prompt` (handleMessage's flag): only
    // such a turn ending inside its wait marks wait_ended for the self-prompter.
    // Fork carry (I1-1, DECISIONS 2026-11-14): the backend serves one request
    // at a time, so a decision goes first: from entry to return it is counted
    // in `decisions`, a running memory summary yields to it (history.js), and
    // the summary starts again when the last decision in flight returns. A
    // summary a chunk overdue is not aborted: the decision waits for it (fix
    // wave 1, history.js summaryOverdue). Fix wave 2 (build2 r2 rulings): the
    // wait is for one chunk (history.js stops after it) and at most
    // work.summary_timeout_s; a !stop or a newer message during it ends the
    // turn with no request. Final ruling (build2 r3): the entry counter is the
    // supersession check throughout (promptConvoTurn's `stale`), so an older
    // response still generating is dropped once a newer turn entered, and after
    // a wait the decision sends the history as compacted.
    async promptConvo(messages, self_prompt = false) {
        const entry = this.convo_entries = (this.convo_entries ?? 0) + 1;
        const turn = { outage_wait: this.agent.model_outage?.waiter(), self_prompt, entry };
        this.decisions = (this.decisions ?? 0) + 1;
        const stop_epoch = this.agent.stop_epoch;
        try {
            const deadline = Date.now() + this.summaryTimeoutMs();
            let waited = false;
            for (let overdue; Date.now() < deadline && (overdue = this.agent.history?.yieldSummary?.()); ) {
                waited = true;
                let timer;
                await Promise.race([overdue, new Promise(resolve => { timer = setTimeout(resolve, deadline - Date.now()); })]);
                clearTimeout(timer);
            }
            if (waited && (this.agent.stop_epoch !== stop_epoch || this.convo_entries !== entry)) return '';
            if (waited) messages = this.agent.history?.getHistory?.() ?? messages;
            return await this.promptConvoTurn(messages, turn);
        } finally {
            turn.outage_wait?.end();
            if (--this.decisions === 0) this.agent.history?.startSummary?.();
        }
    }

    async promptConvoTurn(messages, turn) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;
        // Final ruling (build2 r3): a newer promptConvo entry supersedes this
        // turn, even one still waiting behind a summary (it has not reached here).
        const stale = () => current_msg_time !== this.most_recent_msg_time ||
            (turn.entry !== undefined && this.convo_entries !== turn.entry);
        // The outage wait stops for a newer message or the owner's !stop.
        const stop_epoch = this.agent.stop_epoch;
        const superseded = () => stale() || this.agent.stop_epoch !== stop_epoch;

        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (stale()) {
                return '';
            }

            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            if (superseded()) // fork carry: no request after a stop or newer message (REQ-RES-17)
                return '';
            let generation;
            // REQ-RES-17: promptConvo is this call's one retry owner, so no SDK retries.
            const options = this.requestOptions('decision', { maxRetries: 0 });

            try {
                generation = await this.chat_model.sendRequest(messages, prompt, undefined, options);
                if (!this.reachable(options.outcome)) {
                    // Fork carry (REQ-RES-17): an unreachable model spends none of the
                    // 3 tries and its stand-in reply ("My brain disconnected") is never
                    // used. Wait with back-off for up to work.model_outage_wait_s, unless
                    // a newer message supersedes this turn; then there is no reply.
                    if (!await turn.outage_wait.next(superseded)) {
                        if (turn.self_prompt) this.agent.model_outage.wait_ended = true;
                        return '';
                    }
                    i--;
                    continue;
                }
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', generation);
                    throw new Error('Generated response is not a string');
                }
                console.log("Generated response:", generation);
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                console.error('Error during message generation or file writing:', error);
                continue;
            }

            // Check for hallucination or invalid output
            if (generation?.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }

            if (stale()) {
                console.warn(`${this.agent.name} received new message while generating, discarding old response.`);
                return '';
            }

            if (generation?.includes('</think>')) {
                const [_, afterThink] = generation.split('</think>')
                generation = afterThink
            }

            return generation;
        }

        return '';
    }

    cancelCoding() {
        this.coding_abort_controller?.abort();
    }

    // Fork carry (REQ-RES-17): the coder passes `outcome`, so it learns when the
    // model was unreachable instead of reading the stand-in reply as "no code".
    async promptCoding(messages, outcome = {}) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        const controller = new AbortController();
        this.coding_abort_controller = controller;
        try {
            await this.checkCooldown();
            controller.signal.throwIfAborted();
            let prompt = this.profile.coding;
            prompt = await this.replaceStrings(prompt, messages, this.coding_examples);
            controller.signal.throwIfAborted();

            let resp = await this.code_model.sendRequest(messages, prompt, undefined, this.requestOptions('coding', {signal: controller.signal, outcome}));
            this.reachable(outcome);
            controller.signal.throwIfAborted();
            await this._saveLog(prompt, messages, resp, 'coding');
            controller.signal.throwIfAborted();
            return resp;
        } finally {
            this.awaiting_coding = false;
            this.coding_abort_controller = null;
        }
    }

    // Fork carry (I1-1): `signal` (history.js) aborts the summary when a decision starts.
    // An aborted summary sets no cooldown (fix wave 1): the abort puts the
    // prompt time back at once, before the decision's own cooldown check reads it.
    async promptMemSaving(to_summarize, signal = null) {
        const before = this.last_prompt_time;
        await this.checkCooldown();
        const sent_at = this.last_prompt_time;
        const unset = () => { if (this.last_prompt_time === sent_at) this.last_prompt_time = before; };
        if (signal?.aborted) unset();
        signal?.throwIfAborted();
        signal?.addEventListener('abort', unset, { once: true });
        let resp;
        try {
            let prompt = this.profile.saving_memory;
            prompt = await this.replaceStrings(prompt, null, null, to_summarize);
            signal?.throwIfAborted();
            // Fix wave 2: no SDK retry and its own deadline, which also covers
            // a body that never arrives (the SDK's timeout ends at the headers).
            const timeout = this.summaryRequestMs();
            const deadline = AbortSignal.timeout(timeout);
            const options = this.requestOptions('summary', { maxRetries: 0, timeout,
                signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
            try {
                resp = await this.chat_model.sendRequest([], prompt, undefined, options);
            } catch (err) {
                if (deadline.aborted && !signal?.aborted) this.summary_cuts = (this.summary_cuts ?? 0) + 1;
                throw err;
            }
            this.summary_cuts = 0;
            this.reachable(options.outcome); // history.js already rejects the stand-in reply
            await this._saveLog(prompt, to_summarize, resp, 'memSaving');
        } finally {
            signal?.removeEventListener('abort', unset);
        }
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>')
            resp = afterThink;
        }
        return resp;
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, null, null, messages);
        const options = this.requestOptions('bot_responder');
        let res = await this.chat_model.sendRequest([], prompt, undefined, options);
        this.reachable(options.outcome);
        return res.trim().toLowerCase() === 'respond';
    }

    async promptVision(messages, imageBuffer) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
        prompt = await this.replaceStrings(prompt, messages, null, null, null);
        return await this.vision_model.sendVisionRequest(messages, prompt, imageBuffer);
    }

    async promptGoalSetting(messages, last_goals) {
        // deprecated
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async _saveLog(prompt, messages, generation, tag) {
        if (!settings.log_all_prompts)
            return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logEntry;
        let task_id = this.agent.task.task_id;
        if (task_id == null) {
            logEntry = `[${timestamp}] \nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        } else {
            logEntry = `[${timestamp}] Task ID: ${task_id}\nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        }
        const logFile = `${tag}_${timestamp}.txt`;
        await this._saveToFile(logFile, logEntry);
    }

    async _saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        let logDir;
        if (task_id == null) {
            logDir = botLogPath(this.agent.name);
        } else {
            logDir = botLogPath(this.agent.name, String(task_id));
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }
}
