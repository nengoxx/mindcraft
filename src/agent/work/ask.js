// Owner questions, the I1 core (REQ-REC-12): code renders the question, records
// it as the task's `pending_question` and reads the owner's reply before the
// model (the agent.js interception calls Work.answerQuestion). The step that
// asked applies the answer (its handler's `answer`). The survival iteration's
// consumers reuse this.

const YES = '(?:yes|y|yeah|yep|yup|sure|ok|okay)';
// Only short, exact answers count (case and trailing . or ! ignored): a first
// word alone would read "keep going" or "no problem, go ahead" as no. Anything
// else goes on to the model and the question stays open.
const ANSWERS = {
    yes: new RegExp(`^(?:${YES}|go ahead|do it)(?: please)?$`),
    no: /^(?:no|n|nope|nah|no thanks|no,? keep them|keep them|don'?t)$/,
    // REQ-CLR-9: only this explicit answer covers containers.
    'yes, chests too': new RegExp(`^${YES},? (?:the )?(?:chests?|containers?) too(?: please)?$`),
};

// The option the owner's message answers, or null.
export function parseAnswer(message, options) {
    const text = String(message ?? '').toLowerCase().trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
    return options.find(option => ANSWERS[option]?.test(text)) ?? null;
}

// `extra` carries what the asking step needs back (for clear_leftovers, the
// positions and blocks the question covers).
export function newQuestion({ kind, text, options, extra = {} }, now) {
    return { id: `q${now.toString(36)}`, kind, text, options, asked_at: now, ...extra };
}
