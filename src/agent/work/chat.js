import { WORK_DEFAULTS } from './config.js';

// What the bot says in chat (SPEC REQ-CHAT-1): one switch, `work.chat`, and
// one category per line. Quiet shows every category but `detail`; debug shows
// everything (today's output). Read through agent.prompter.work_config, which
// exists from Agent.start (before Work) and survives the panel's Apply.

export const CHAT_MODES = Object.freeze(['quiet', 'debug']);
export const CATEGORIES = Object.freeze(['reply', 'question', 'alert', 'done', 'detail']);
const QUIET_SHOWN = new Set(['reply', 'question', 'alert', 'done']);

let warned = false;   // an unknown value is logged once per process

export function chatMode(agent) {
    const mode = agent?.prompter?.work_config?.chat ?? WORK_DEFAULTS.chat;
    if (CHAT_MODES.includes(mode)) return mode;
    if (!warned) {
        warned = true;
        console.warn(`[chat] unknown work.chat ${JSON.stringify(mode)}; using quiet`);
    }
    return 'quiet';
}

export function chatShown(agent, category = 'detail') {
    return chatMode(agent) === 'debug' || QUIET_SHOWN.has(category);
}

// The category of a line that follows the turn it is said in: the owner's
// turns and blocked-report turns are answered (`reply`); her own turns are
// `detail`. The voice is the work layer's (Work.turnVoice; null means her own).
export function turnCategory(agent) {
    const voice = agent?.work?.turnVoice?.() ?? 'own';
    return voice === 'owner' || voice === 'alert' ? 'reply' : 'detail';
}

// A model reply's text before a command (agent.js quiet branch, called for
// every response with a command): by the turn, and the text before `!endGoal`
// is the goal's end (`done`). The response takes the owner's pending answer
// (Work.takeAnswer, G1, A1): its text, if any, is his answer, `reply`.
export function replyCategory(agent, command) {
    const pending = Boolean(agent?.work?.takeAnswer?.());
    const category = turnCategory(agent);
    if (category === 'reply' || pending) return 'reply';
    return command === '!endGoal' ? 'done' : 'detail';
}
