import fs from 'fs';
import path from 'path';
import { GPT } from './gpt.js';
import { runtimePath } from '../utils/runtime_paths.js';

// OpenAI-compatible provider for the task layer (SPEC §5.2, §12.2). In I1 it is
// GPT's text path unchanged plus one log line per provider call (REQ-OBS-1).
// Logging wraps the client's chat.completions.create, so a line is one model call
// as the bot sees it: GPT's shorter-context retry is a new call and a new line,
// while the SDK's own retries and back-off happen inside one call and one line.
// The native tool path (I2) is logged by the same wrapper when it calls create.
export class OpenAITools extends GPT {
    static prefix = 'openai_tools';

    constructor(model_name, url, params) {
        super(model_name, url, params);
        const completions = this.openai.chat.completions;
        const create = completions.create.bind(completions);
        completions.create = (body, options = {}) => {
            // `kind` and `task_id` arrive in sendRequest's options from the prompter;
            // they are ours, so they are removed before the options reach the HTTP client.
            const { kind = null, task_id = null, ...requestOptions } = options;
            const started = Date.now();
            const request = create(body, requestOptions);
            // The SDK's own APIPromise is returned, so awaiting it and withResponse()
            // work. Logging parses the response body, so asResponse() and the beta
            // parse helpers fail on this client: accepted, no I1 or specified I2
            // caller uses them (review S0-lite round 2).
            request.then(
                response => logRequest(kind, task_id, body, response, null, started),
                error => logRequest(kind, task_id, body, null, error, started));
            return request;
        };
    }
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
