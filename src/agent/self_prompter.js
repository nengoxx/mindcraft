const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
        // Fork carry (REQ-RES-18): a goal paused by a model outage is PAUSED with
        // this flag (a new state would need every isStopped() consumer and
        // handleLoad changed). goal_epoch changes with every start, stop, pause or
        // new goal, so a recovery probe resumes only the goal it paused.
        this.outage = false;
        this.goal_epoch = 0;
    }

    // Any start, stop, manual pause or new goal ends an outage pause.
    clearOutage() {
        this.outage = false;
        this.goal_epoch++;
    }

    // REQ-RES-18: after promptConvo's foreground wait the goal pauses instead of
    // stopping, and the recovery probe resumes this same goal once the model is
    // reachable, if nothing replaced, stopped or resumed it meanwhile. Resuming
    // only sets the goal ACTIVE: update() restarts the loop once the agent is
    // idle, so an owner's action running at recovery is not cut short.
    pauseForOutage() {
        this.state = PAUSED;
        this.outage = true;
        const epoch = this.goal_epoch;
        console.log('Self-prompting paused: the model is unreachable.');
        this.agent.history.save().catch(err => console.error('Failed to save the outage pause:', err));
        const current = () => this.outage && this.state === PAUSED && this.goal_epoch === epoch;
        this.agent.model_outage.watch(current, () => {
            this.clearOutage();
            this.state = ACTIVE;
        });
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.clearOutage();
        // A turn still in flight belongs to the goal this start replaces: it is
        // superseded, so a reply that arrives late (after an outage) never runs.
        if (this.loop_active)
            this.agent.prompter.most_recent_msg_time = Date.now();
        this.state = ACTIVE;
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state, outage = false) {
        if (state == undefined)
            state = STOPPED;
        this.clearOutage();
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
        else if (state === PAUSED && outage) {
            // REQ-RES-18: a loaded outage pause restarts the probe. The outage is
            // taken as still on (no new notice), so only a probe or a request that
            // succeeds in this process resumes the goal.
            this.agent.model_outage.down('before the restart', false);
            this.pauseForOutage();
        }
    }

    setPromptPaused(prompt) {
        this.clearOutage();
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        while (!this.interrupt) {
            const msg = `You are self-prompting with the goal: '${this.prompt}'. Your next response MUST contain a command with this syntax: !commandName. Respond:`;
            
            if (this.agent.model_outage.isWaiting()) {
                // REQ-RES-18: another turn (the owner's) waits through an outage;
                // a goal turn now would supersede it, so the goal pauses instead.
                this.pauseForOutage();
                break;
            }
            const epoch = this.goal_epoch;
            this.agent.model_outage.wait_ended = false;
            let used_command = await this.agent.handleMessage('system', msg, -1);
            if (this.goal_epoch !== epoch) {
                // REQ-RES-18: the goal was replaced, stopped or paused during the
                // turn; its reply does not count against the current goal.
                no_command_count = 0;
                continue;
            }
            if (this.agent.model_outage.wait_ended && !this.interrupt) {
                // REQ-RES-18: the turn ended inside its outage wait (gave up, or was
                // cut short by a newer message); it is not counted and the goal is
                // paused, never stopped. A single failed call elsewhere never pauses.
                this.pauseForOutage();
                break;
            }
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.clearOutage();
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
    }

    async pause() {
        this.clearOutage();
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}