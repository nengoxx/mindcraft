import fs from 'fs';
import path from 'path';
import { APIConnectionError, APIConnectionTimeoutError } from 'openai/error';
import { GPT } from './gpt.js';
import { runtimePath } from '../utils/runtime_paths.js';

// OpenAI-compatible provider for the task layer (SPEC §5.2, §12.2). In I1 it is
// GPT's text path unchanged plus one log line per provider call (REQ-OBS-1).
// Logging wraps the client's chat.completions.create, so a line is one model call
// as the bot sees it: GPT's shorter-context retry is a new call and a new line,
// while the SDK's own retries and back-off happen inside one call and one line.
// The native tool path (I2) is logged by the same wrapper when it calls create.
// The same wrapper is the outage seam (REQ-RES-17): a caller that passes an
// `outcome` object learns when the model was unreachable, with gpt.js unchanged.
export class OpenAITools extends GPT {
    static prefix = 'openai_tools';

    constructor(model_name, url, params) {
        super(model_name, url, params);
        const completions = this.openai.chat.completions;
        const create = completions.create.bind(completions);
        completions.create = (body, options = {}) => {
            // `kind`, `task_id`, `outcome` and `kind_params` arrive in sendRequest's
            // options from the prompter; they are ours, so they are removed before
            // the options reach the HTTP client. `kind_params` (I1-2, DECISIONS
            // 2026-11-14: a summary runs with little or no reasoning) are body
            // params sent over the model's own, each replacing the one it names.
            const { kind = null, task_id = null, outcome = null, kind_params = null, ...requestOptions } = options;
            if (kind_params) body = { ...body, ...kind_params };
            const started = Date.now();
            const request = create(body, requestOptions);
            // The SDK's own APIPromise is returned, so awaiting it and withResponse()
            // work. Logging parses the response body, so asResponse() and the beta
            // parse helpers fail on this client: accepted, no I1 or specified I2
            // caller uses them (review S0-lite round 2).
            // These handlers are attached before gpt.js awaits the request, so
            // `outcome` is set before gpt.js turns the error into its reply text.
            request.then(
                response => logRequest(kind, task_id, body, response, null, started),
                error => {
                    const cause = unreachableCause(error);
                    if (outcome && cause) outcome.unreachable = cause;
                    logRequest(kind, task_id, body, null, error, started);
                });
            return request;
        };
    }

    // REQ-RES-17: an explicit client timeout and retry count from the profile's
    // work section (work.model_timeout_s, work.model_max_retries), handed over by
    // the prompter. The client reads both at each request; a request's own
    // maxRetries wins (the decision's 0, as promptConvo retries it).
    configureClient({ model_timeout_s, model_max_retries }) {
        this.openai.timeout = model_timeout_s * 1000;
        this.openai.maxRetries = model_max_retries;
    }
}

// REQ-RES-17: a connection error (timeouts included) or an HTTP status of 500 or
// higher means the model is unreachable; the cause is shown to the owner in game
// chat, so it is only an error code, never a message (which can hold the
// endpoint's address). A 4xx or a user abort is not an outage.
export function unreachableCause(error) {
    if (error instanceof APIConnectionTimeoutError)
        return 'timed out';
    if (error instanceof APIConnectionError)
        return error.cause?.code ?? 'connection error';
    if (error?.status >= 500)
        return `HTTP ${error.status}`;
    return null;
}

function requestRecord(kind, task_id, body, response, error, started) {
    const usage = response?.usage;
    const choice = response?.choices?.[0];
    return {
        time: new Date(started).toISOString(),
        kind,
        task_id,
        // The full messages exactly as sent: what the model was given is what these
        // logs exist to inspect.
        prompt: body?.messages ?? null,
        prompt_tokens: usage?.prompt_tokens ?? null,
        // OpenAI's field, else llama.cpp's prompt-cache count.
        cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? response?.timings?.cache_n ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
        reasoning_chars: choice ? reasoningChars(choice.message) : null,
        finish_reason: choice?.finish_reason ?? null,
        duration_ms: Date.now() - started,
        error: error ? String(error.message ?? error) : null,
    };
}

// Reasoning arrives as a separate field (llama.cpp `reasoning_content`, some servers
// `reasoning`) or inline after `<think>`, closed by `</think>` unless it was cut off.
function reasoningChars(message) {
    const field = message?.reasoning_content ?? message?.reasoning;
    if (typeof field === 'string')
        return field.length;
    const content = message?.content;
    if (typeof content !== 'string')
        return 0;
    const end = content.indexOf('</think>');
    if (end !== -1)
        return content.slice(0, end).replace('<think>', '').length;
    const start = content.indexOf('<think>');
    return start === -1 ? 0 : content.length - start - '<think>'.length;
}

// Lines are appended synchronously when a call completes, so the file is in
// completion order while `time` is the start time: consumers sort by `time`.
// A write failure never reaches the request and is reported once.
let logFailureReported = false;

function logRequest(kind, task_id, body, response, error, started) {
    try {
        const file = runtimePath('diagnostics', 'requests.jsonl');
        // Every line, so a removed folder is recreated.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(requestRecord(kind, task_id, body, response, error, started)) + '\n', 'utf8');
    } catch (err) {
        if (logFailureReported)
            return;
        logFailureReported = true;
        console.error('Request log write failed; later failures are not reported:', err?.message ?? err);
    }
}
