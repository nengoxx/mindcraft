// Model outages (SPEC §7.8, REQ-RES-17/18): the outage state shared by the
// prompter, the coder and the self-prompter, created in the agent init carry.
// Every model call reports its outcome here (`down` with the cause, or `up`);
// the owner hears one notice when an outage begins and one when it ends,
// however many calls fail in between.

// Fixed policies (SPEC §14 keeps only the wait and probe intervals as keys).
const BACKOFF_FIRST_MS = 5000;
const BACKOFF_MAX_MS = 60000;
const POLL_MS = 1000; // how often a wait checks whether it should stop early

export const outageNotice = cause =>
    `I can't reach my model (${cause}). Tasks keep running; I'll answer and continue the goal when it's back.`;
export const RECOVERY_NOTICE = 'My model is reachable again.';

// Resolves after `ms`, or earlier once `stopped()` is true.
function pollingSleep(ms, stopped) {
    const end = Date.now() + ms;
    return new Promise(resolve => {
        const step = () => {
            const left = end - Date.now();
            if (left <= 0 || stopped()) resolve();
            else setTimeout(step, Math.min(POLL_MS, left));
        };
        step();
    });
}

export class ModelOutage {
    // config: loadWorkConfig's result (work.model_outage_wait_s, work.model_outage_probe_s).
    constructor(agent, config, { now = Date.now, sleep = pollingSleep } = {}) {
        this.agent = agent;
        this.config = config;
        this.now = now;
        this.sleep = sleep;
        this.cause = null;
        this.waits = new Set();  // one per promptConvo turn still running (its foreground wait, once begun)
        this.wait_ended = false; // set when a self-prompted turn ends inside its wait; the self-prompter resets it per turn
    }

    isDown() {
        return this.cause !== null;
    }

    // A running turn has met the outage and is in (or retrying from) its wait.
    isWaiting() {
        for (const wait of this.waits) if (wait.deadline !== null) return true;
        return false;
    }

    // `notify` false: an outage known from before a restart (REQ-RES-18), whose
    // notice the owner already had.
    down(cause, notify = true) {
        if (this.cause !== null) return;
        this.cause = cause;
        console.warn(`[outage] model unreachable: ${cause}`);
        if (notify) this.agent.openChat(outageNotice(cause));
    }

    // Recovery also ends the current back-off of every waiting turn, so the
    // owner's waiting message is retried at once.
    up() {
        if (this.cause === null) return;
        console.log(`[outage] model reachable again (was: ${this.cause})`);
        this.cause = null;
        for (const wait of this.waits) if (wait.deadline !== null) wait.woken = true;
        this.agent.openChat(RECOVERY_NOTICE);
    }

    // REQ-RES-17: promptConvo's foreground wait through an outage, registered on
    // entry to each turn (so the recovery probe defers to it from the first
    // request) and ended by promptConvo with the turn. The wait itself begins at
    // the first next(), the first unreachable reply. Each next() waits the next
    // back-off (5 s, doubling to 60 s) and resolves true to try again, or false,
    // with no further request, once work.model_outage_wait_s has passed since
    // that reply or `stopped()` holds (a newer message superseded the turn, or
    // the owner's !stop). A recovery meanwhile retries at once.
    waiter() {
        let delay = BACKOFF_FIRST_MS;
        const wait = {
            woken: false,
            deadline: null,
            next: async stopped => {
                wait.deadline ??= this.now() + this.config.model_outage_wait_s * 1000;
                const deadline = wait.deadline;
                if (!wait.woken && !stopped() && this.now() < deadline) {
                    const ms = Math.min(delay, deadline - this.now());
                    delay = Math.min(delay * 2, BACKOFF_MAX_MS);
                    await this.sleep(ms, () => stopped() || wait.woken);
                }
                // A wake retries even at or past the deadline: it means another
                // call has just succeeded, so this retry is the productive path
                // and a late reply is a working model's answer (SPEC §16).
                if (!stopped() && (wait.woken || this.now() < deadline)) {
                    wait.woken = false;
                    return true;
                }
                return false;
            },
            end: () => this.waits.delete(wait),
        };
        this.waits.add(wait);
        return wait;
    }

    // REQ-RES-18: the recovery probe of an outage-paused goal. Every
    // work.model_outage_probe_s, while `wanted()` holds, it checks the model:
    // when another call has already succeeded meanwhile no probe request is
    // needed. On recovery it calls `recovered()` once, if still wanted, but not
    // while a turn still waits (the owner's message is answered first; the next
    // interval resumes).
    async watch(wanted, recovered) {
        while (wanted()) {
            await this.sleep(this.config.model_outage_probe_s * 1000, () => !wanted());
            if (!wanted()) return;
            let reachable = !this.isDown();
            if (!reachable) {
                try {
                    reachable = await this.agent.prompter.probeModel();
                } catch (err) {
                    console.error('[outage] recovery probe failed:', err?.message ?? err);
                }
            }
            if (reachable && !this.waits.size) {
                if (wanted()) recovered();
                return;
            }
        }
    }
}
