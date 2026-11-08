import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, mock, test } from 'node:test';
import { APIPromise } from 'openai/core';

// S0-lite (REQ-OBS-1). The OpenAI HTTP client is substituted: it records each
// chat.completions.create call and answers from `reply` with the SDK's own
// APIPromise, as the real client does. No network, game or model.
const calls = [];
let reply;
class FakeOpenAI {
    constructor() {
        this.chat = { completions: { create: (body, options) => {
            calls.push({ body: structuredClone(body), options });
            const settled = (async () => ({
                data: await reply(body, options),
                response: new Response(null, { headers: { 'x-request-id': 'req-fixture' } }),
            }))();
            return new APIPromise(settled, props => props.data);
        } } };
    }
}
mock.module('openai', { defaultExport: FakeOpenAI });
process.env.OPENAI_API_KEY ??= 'test-no-auth';
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'work-s0-'));
process.env.MINDCRAFT_RUNTIME_DIR = runtime;
const logFile = path.join(runtime, 'diagnostics', 'requests.jsonl');

const { GPT } = await import('../src/models/gpt.js');
const { OpenAITools } = await import('../src/models/openai_tools.js');
const { Prompter } = await import('../src/models/prompter.js');
const { selectAPI, createModel } = await import('../src/models/_model_map.js');

const URL = 'http://127.0.0.1:1/v1';
const KINDS = ['decision', 'summary', 'coding', 'bot_responder'];
const FIELDS = ['cached_tokens', 'completion_tokens', 'duration_ms', 'error', 'finish_reason', 'kind',
    'prompt', 'prompt_tokens', 'reasoning_chars', 'task_id', 'time'];
const completion = (content, extra = {}) => ({
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, ...extra.message } }],
    ...extra.response,
});
// gpt.js appends the stop sequence to the turns it is given, so each call gets fresh ones.
const turns = () => [{ role: 'user', content: 'owner: get 40 oak planks' }, { role: 'assistant', content: 'On it.' },
    { role: 'user', content: 'owner: hurry' }];

function logLines() {
    if (!fs.existsSync(logFile))
        return [];
    return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

beforeEach(() => {
    fs.rmSync(logFile, { force: true });
    calls.length = 0;
    reply = () => completion('ok');
});
after(() => fs.rmSync(runtime, { recursive: true, force: true }));

test('a profile selects the provider with api openai_tools', () => {
    const profile = selectAPI({ api: 'openai_tools', url: URL, model: 'fixture', params: { max_tokens: 8192 } });
    const model = createModel(profile);
    assert.ok(model instanceof OpenAITools);
    assert.deepEqual([model.model_name, model.url, model.params], ['fixture', URL, { max_tokens: 8192 }]);
});

test('logs one line per request with every REQ-OBS-1 field, for each request kind', async () => {
    reply = () => completion('done', {
        message: { reasoning_content: 'thinking hard' },
        response: { usage: { prompt_tokens: 120, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 100 } } },
    });
    const model = new OpenAITools('fixture', URL, { max_tokens: 64 });
    for (const kind of KINDS)
        assert.equal(await model.sendRequest(turns(), `system for ${kind}`, undefined, { kind }), 'done');

    const lines = logLines();
    assert.equal(lines.length, KINDS.length);
    lines.forEach((line, i) => {
        assert.deepEqual(Object.keys(line).sort(), FIELDS);
        assert.equal(line.kind, KINDS[i]);
        assert.equal(new Date(line.time).toISOString(), line.time);
        assert.deepEqual(line.prompt, calls[i].body.messages);
        assert.match(line.prompt[0].content, new RegExp(`system for ${KINDS[i]}`));
        assert.equal(line.prompt_tokens, 120);
        assert.equal(line.cached_tokens, 100);
        assert.equal(line.completion_tokens, 7);
        assert.equal(line.reasoning_chars, 'thinking hard'.length);
        assert.equal(line.finish_reason, 'stop');
        assert.ok(Number.isInteger(line.duration_ms) && line.duration_ms >= 0);
        assert.equal(line.task_id, null);
        assert.equal(line.error, null);
    });
});

test('unreported usage is null; cache counts and reasoning are read in their precedence', async () => {
    const model = new OpenAITools('fixture', URL);
    const replies = [
        completion('plain'),
        completion('<think>abc</think>answer', { response: { timings: { cache_n: 42 } } }),
        completion('<think>cut off mid', { response: {
            usage: { prompt_tokens: 9, prompt_tokens_details: { cached_tokens: 8 } }, timings: { cache_n: 42 } } }),
        completion('<think>inline</think>x', { message: { reasoning_content: 'ab', reasoning: 'abcdef' } }),
        completion('x', { message: { reasoning: 'abcdef' } }),
    ];
    for (const r of replies) {
        reply = () => r;
        await model.sendRequest(turns(), 'sys', undefined, r === replies[1] ? undefined : { kind: 'decision' });
    }

    const [plain, inline, unclosed, both, alternate] = logLines();
    assert.equal(plain.prompt_tokens, null);
    assert.equal(plain.cached_tokens, null);
    assert.equal(plain.completion_tokens, null);
    assert.equal(plain.reasoning_chars, 0);
    assert.equal(inline.kind, null); // a caller that names no kind
    assert.equal(inline.cached_tokens, 42); // llama.cpp's count when usage has none
    assert.equal(inline.reasoning_chars, 3);
    assert.equal(unclosed.cached_tokens, 8); // OpenAI's field first
    assert.equal(unclosed.reasoning_chars, 'cut off mid'.length); // no </think>: truncated reasoning
    assert.equal(both.reasoning_chars, 2); // reasoning_content, then reasoning, then inline
    assert.equal(alternate.reasoning_chars, 6);
});

test('duration_ms spans the call and time is its start', async () => {
    reply = () => new Promise(resolve => setTimeout(() => resolve(completion('ok')), 120));
    const before = Date.now();
    await new OpenAITools('fixture', URL).sendRequest(turns(), 'sys', undefined, { kind: 'decision' });
    const elapsed = Date.now() - before;

    const [line] = logLines();
    assert.ok(line.duration_ms >= 110 && line.duration_ms <= elapsed, `duration_ms ${line.duration_ms}`);
    const start = Date.parse(line.time) - before;
    assert.ok(start >= 0 && start < 100, `time is ${start} ms after the call began`);
});

test("the wrapped create returns the SDK's APIPromise, so await and withResponse keep working", async () => {
    const model = new OpenAITools('fixture', URL);
    const request = model.openai.chat.completions.create({ model: 'fixture', messages: [] }, { kind: 'decision' });
    assert.ok(request instanceof APIPromise);
    const { data, request_id } = await request.withResponse();
    assert.equal(data.choices[0].message.content, 'ok');
    assert.equal(request_id, 'req-fixture');
    assert.equal(logLines().length, 1);
});

test("sends gpt.js's request body, never tools, and keeps the kind out of the HTTP options", async () => {
    const params = { max_tokens: 8192, reasoning_effort: 'medium', reasoning_budget_tokens: 2048 };
    const signal = new AbortController().signal;
    assert.equal(await new GPT('fixture', URL, params).sendRequest(turns(), 'sys', undefined, { signal }), 'ok');
    assert.equal(await new OpenAITools('fixture', URL, params).sendRequest(turns(), 'sys', undefined,
        { signal, kind: 'coding' }), 'ok');

    const [native, logged] = calls;
    assert.deepEqual(logged.body, native.body);
    for (const key of ['tools', 'tool_choice', 'parallel_tool_calls', 'functions', 'function_call'])
        assert.equal(key in logged.body, false, key);
    assert.deepEqual(logged.options, { signal });
});

test('a failed request is logged with its error and returns or rejects exactly as gpt.js does', async () => {
    const native = new GPT('fixture', URL);
    const logged = new OpenAITools('fixture', URL);

    reply = () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1'); };
    const nativeResult = await native.sendRequest(turns(), 'sys');
    assert.equal(nativeResult, 'My brain disconnected, try again.');
    assert.equal(await logged.sendRequest(turns(), 'sys', undefined, { kind: 'summary' }), nativeResult);

    const abort = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
    reply = () => { throw abort; };
    await assert.rejects(native.sendRequest(turns(), 'sys'), abort);
    await assert.rejects(logged.sendRequest(turns(), 'sys', undefined, { kind: 'coding' }), abort);

    const lines = logLines();
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(l => [l.kind, l.error]), [
        ['summary', 'connect ECONNREFUSED 127.0.0.1:1'], ['coding', 'Request was aborted.']]);
    for (const line of lines) {
        assert.equal(line.prompt_tokens, null);
        assert.equal(line.reasoning_chars, null);
        assert.ok(line.prompt.length > 0);
    }
});

test("gpt.js's shorter-context retry is logged as two requests of the same kind", async () => {
    let n = 0;
    reply = () => (n++ === 0
        ? { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'cut' } }] }
        : completion('ok'));
    assert.equal(await new OpenAITools('fixture', URL).sendRequest(turns(), 'sys', undefined, { kind: 'decision' }), 'ok');

    const lines = logLines();
    assert.deepEqual(lines.map(l => [l.kind, l.finish_reason]), [['decision', 'length'], ['decision', 'stop']]);
    assert.match(JSON.stringify(lines[0].prompt), /get 40 oak planks/);
    assert.doesNotMatch(JSON.stringify(lines[1].prompt), /get 40 oak planks/);
});

test('a log write failure does not break the request and is reported once', async t => {
    const errors = t.mock.method(console, 'error', () => {});
    const model = new OpenAITools('fixture', URL);
    // Failing write: `diagnostics` is a file, so the log directory cannot be created.
    const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'work-s0-blocked-'));
    fs.writeFileSync(path.join(blocked, 'diagnostics'), '');
    process.env.MINDCRAFT_RUNTIME_DIR = blocked;
    try {
        for (let i = 0; i < 2; i++)
            assert.equal(await model.sendRequest(turns(), 'sys', undefined, { kind: 'summary' }), 'ok');
    } finally {
        process.env.MINDCRAFT_RUNTIME_DIR = runtime;
        fs.rmSync(blocked, { recursive: true, force: true });
    }
    assert.equal(errors.mock.callCount(), 1);
    assert.match(errors.mock.calls[0].arguments[0], /Request log write failed/);
});

test('the request kind reaches the provider from all four prompter paths', async () => {
    reply = () => completion('respond');
    const model = new OpenAITools('fixture', URL);
    // Actual prompter methods with inert state: no profile files, examples or game.
    const prompter = Object.create(Prompter.prototype);
    Object.assign(prompter, {
        agent: { name: 'fixture', history: { getHistory: () => [] } },
        profile: { conversing: 'convo', coding: 'code', saving_memory: 'memory', bot_responder: 'responder' },
        cooldown: 0, last_prompt_time: 0, awaiting_coding: false,
        chat_model: model, code_model: model, convo_examples: null, coding_examples: null,
    });
    await prompter.promptConvo(turns());
    await prompter.promptMemSaving(turns());
    await prompter.promptCoding(turns());
    assert.equal(await prompter.promptShouldRespondToBot('other bot: hello'), true);

    const lines = logLines();
    assert.deepEqual(lines.map(l => [l.kind, l.prompt[0].content.split('\n')[0]]), [
        ['decision', 'SYSTEM: convo'], ['summary', 'SYSTEM: memory'], ['coding', 'SYSTEM: code'],
        ['bot_responder', 'SYSTEM: responder']]);
    assert.ok(calls[2].options.signal instanceof AbortSignal); // the coding signal still reaches the client
});

test('every prompter path logs the active task id, and null when there is none (S2)', async () => {
    reply = () => completion('respond');
    const model = new OpenAITools('fixture', URL);
    let active = 'tabc123';
    const prompter = Object.create(Prompter.prototype);
    Object.assign(prompter, {
        agent: { name: 'fixture', history: { getHistory: () => [] }, work: { taskId: () => active } },
        profile: { conversing: 'convo', coding: 'code', saving_memory: 'memory', bot_responder: 'responder' },
        cooldown: 0, last_prompt_time: 0, awaiting_coding: false,
        chat_model: model, code_model: model, convo_examples: null, coding_examples: null,
    });
    await prompter.promptConvo(turns());
    await prompter.promptMemSaving(turns());
    await prompter.promptCoding(turns());
    await prompter.promptShouldRespondToBot('other bot: hello');
    active = null;
    await prompter.promptConvo(turns());
    assert.deepEqual(logLines().map(l => [l.kind, l.task_id]), [
        ['decision', 'tabc123'], ['summary', 'tabc123'], ['coding', 'tabc123'], ['bot_responder', 'tabc123'], ['decision', null]]);
    assert.equal('task_id' in calls[0].options, false); // kept out of the HTTP options
});
