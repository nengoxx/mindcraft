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

test("gpt.js's shorter-context retry (a context_length_exceeded error) is logged as two requests of the same kind", async () => {
    let n = 0;
    reply = () => {
        if (n++ === 0) throw Object.assign(new Error('too long'), { code: 'context_length_exceeded' });
        return completion('ok');
    };
    assert.equal(await new OpenAITools('fixture', URL).sendRequest(turns(), 'sys', undefined, { kind: 'decision' }), 'ok');

    const lines = logLines();
    assert.deepEqual(lines.map(l => [l.kind, l.error]), [['decision', 'too long'], ['decision', null]]);
    assert.match(JSON.stringify(lines[0].prompt), /get 40 oak planks/);
    assert.doesNotMatch(JSON.stringify(lines[1].prompt), /get 40 oak planks/);
});

// I1-15 (DECISIONS 2026-11-14): a reply cut at max_tokens is not a context overflow.
test('I1-15: a reply cut at max_tokens (finish_reason length) is one request, never re-sent with a shorter context', async () => {
    reply = () => ({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'cut' } }] });
    assert.equal(await new OpenAITools('fixture', URL).sendRequest(turns(), 'sys', undefined, { kind: 'decision' }), 'My brain disconnected, try again.');
    assert.deepEqual(logLines().map(l => [l.kind, l.finish_reason]), [['decision', 'length']]);
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

// --- Reliability 2 (DECISIONS 2026-11-14): decisions first, summary params ----------

const { History } = await import('../src/agent/history.js');
const { loadWorkConfig } = await import('../src/agent/work/config.js');
const until = async (check, ms = 2000) => {
    for (const end = Date.now() + ms; !check(); await new Promise(resolve => setTimeout(resolve, 5)))
        if (Date.now() > end) throw new Error('until: timed out');
};
const kindOf = body => body.messages[0].content.startsWith('SYSTEM: convo') ? 'decision' : 'summary';

// The real History and prompter paths around the logged provider; 14 turns,
// so the next line crosses the summary threshold (15).
function memoryAgent(work = {}) {
    const model = new OpenAITools('fixture', URL);
    const agent = { name: 'reliability2', stop_epoch: 0, task: { taskStartTime: null }, last_sender: null,
        self_prompter: { state: 0, prompt: null, outage: false, isStopped: () => true } };
    const prompter = Object.create(Prompter.prototype);
    Object.assign(prompter, {
        agent, profile: { conversing: 'convo', saving_memory: 'memory $TO_SUMMARIZE' }, work_config: loadWorkConfig(work),
        cooldown: 0, last_prompt_time: 0, decisions: 0, chat_model: model, convo_examples: null,
    });
    const history = new History(agent);
    history.max_messages = 15;
    for (let i = 0; i < 14; i++) history.turns.push({ role: 'user', content: `owner: line ${i}` });
    Object.assign(agent, { prompter, history });
    return { agent, prompter, history };
}

test('I1-1: a decision started with a summary is sent first; the summary follows it and publishes', async () => {
    const { prompter, history } = memoryAgent();
    const order = [];
    reply = async body => {
        order.push(kindOf(body));
        if (kindOf(body) === 'decision') await new Promise(resolve => setTimeout(resolve, 30));
        return completion(kindOf(body) === 'decision' ? 'On it.' : 'new memory');
    };
    // Fix wave 2 (adversary mutant M1): the summary's one-macrotask wait means
    // it never even starts its request work before the decision (no abort).
    let saving = 0;
    const realSaving = prompter.promptMemSaving;
    prompter.promptMemSaving = function (...args) { saving++; return realSaving.apply(this, args); };
    // agent.js handleMessage: the owner's line crosses the threshold, then the decision.
    await history.add('owner', 'get wood');
    assert.equal(await prompter.promptConvo(history.getHistory()), 'On it.');
    await until(() => history.memory === 'new memory');
    assert.deepEqual(order, ['decision', 'summary']);
    assert.equal(saving, 1, 'no summary was started and aborted before the decision');
    assert.deepEqual([history.turns.length, history.turns[0].content], [10, 'owner: line 5']);
});

test('I1-1: a summary running when a decision starts is aborted and sent again after it; no turn is lost', async () => {
    const { prompter, history } = memoryAgent();
    const sent = [];
    reply = (body, options) => {
        const kind = kindOf(body);
        sent.push({ kind, aborted: () => options.signal?.aborted ?? false });
        if (kind === 'decision') return completion('On it.');
        if (sent.filter(s => s.kind === 'summary').length > 1) return completion('new memory');
        // The first summary runs until it is aborted (or, without the abort, ends on its own).
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(completion('stale memory')), 300);
            options.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
            });
        });
    };
    await history.add('system', 'a line with no decision');   // the summary starts alone
    await until(() => sent.length === 1);
    const kept = history.turns.slice();
    assert.equal(await prompter.promptConvo(history.getHistory()), 'On it.');
    await history.add('owner', 'a line after the decision');
    await until(() => history.memory !== '');
    assert.deepEqual(sent.map(s => s.kind), ['summary', 'decision', 'summary']);
    assert.equal(sent[0].aborted(), true);
    assert.equal(history.memory, 'new memory');
    // The chunk left once, in order; every other line stayed.
    assert.deepEqual(history.turns, [...kept.slice(5), { role: 'user', content: 'owner: a line after the decision' }]);
});

test('I1-1: no summary starts while a decision is in flight; it starts when the decision returns', async () => {
    const { prompter, history } = memoryAgent();
    const order = [];
    let release;
    reply = body => {
        order.push(kindOf(body));
        if (kindOf(body) === 'summary') return completion('new memory');
        return new Promise(resolve => { release = () => resolve(completion('On it.')); });
    };
    const decision = prompter.promptConvo(history.getHistory());
    await until(() => release);
    await history.add('system', 'a line during the decision');   // crosses the threshold
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(order, ['decision']);
    release();
    await decision;
    await until(() => history.memory === 'new memory');
    assert.deepEqual(order, ['decision', 'summary']);
});

// Fix wave 1 (build2 r1 rulings, Sol S2 and the adversary): the abort is bounded.
test('I1-1 fix wave 1: 40 query iterations back to back keep history bounded and summaries publish', async () => {
    const { prompter, history } = memoryAgent();
    let summaries = 0, decisionsSent = 0, decisionsBehind = 0;
    reply = body => {
        if (kindOf(body) === 'decision') {
            decisionsSent++;
            return completion('!stats');
        }
        return new Promise(resolve => setTimeout(() => resolve(completion(`memory ${++summaries}`)), 20));
    };
    let most = 0;
    const realConvo = prompter.promptConvoTurn;
    prompter.promptConvoTurn = function (...args) {
        if (history.summary_pending && !history.summary_controller?.signal.aborted) decisionsBehind++;
        return realConvo.apply(this, args);
    };
    // agent.js's command loop: a query's result goes straight back to the model.
    await history.add('owner', 'what do you have?');
    for (let i = 0; i < 40; i++) {
        const response = await prompter.promptConvo(history.getHistory());
        await history.add('reliability2', response);
        await history.add('system', `stats result ${i}`);
        most = Math.max(most, history.countable());
    }
    await until(() => !history.summary_pending);   // nothing left to answer the next test's fixture
    assert.equal(decisionsSent, 40);
    assert.ok(most <= history.max_messages + history.summary_chunk_size + 2, `history reached ${most} turns`);
    assert.ok(history.memory.startsWith('memory '), `memory "${history.memory}"`);
    assert.equal(decisionsBehind, 0);   // a decision waits for an overdue summary; it never runs beside it
});

test('I1-1 fix wave 1: an aborted summary sets no cooldown; the decision that aborted it goes at once', async () => {
    const { prompter, history } = memoryAgent();
    prompter.cooldown = 400;
    prompter.last_prompt_time = Date.now() - 1000;
    const sent = [];
    reply = (body, options) => {
        sent.push({ kind: kindOf(body), at: Date.now() });
        if (kindOf(body) === 'decision') return completion('On it.');
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(completion('new memory')), 2000);
            options.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
            });
        });
    };
    await history.add('system', 'a line with no decision');   // the summary starts alone and is sent
    await until(() => sent.length === 1);
    await prompter.promptConvo(history.getHistory());
    assert.equal(sent[1].kind, 'decision');
    assert.ok(sent[1].at - sent[0].at < 200, `the decision went ${sent[1].at - sent[0].at} ms after the aborted summary`);
    await until(() => history.memory === 'new memory', 4000);
});

// Fix wave 2 (build2 r2 rulings, Sol S2, adversary A and B): the wait is bounded.
const overdueAgent = (turns = 19, work = {}) => {
    const made = memoryAgent(work);
    for (let i = 14; i < turns; i++) made.history.turns.push({ role: 'user', content: `owner: line ${i}` });
    return made;
};

test('I1-1 fix wave 2: a hanging summary does not hold a decision past work.summary_timeout_s; the summary request has no SDK retry and that timeout', async () => {
    const { prompter, history } = overdueAgent(19, { summary_timeout_s: 1 });
    const sent = [];
    reply = body => {
        sent.push({ kind: kindOf(body), at: Date.now() });
        if (kindOf(body) === 'decision') return completion('On it.');
        return new Promise(resolve => setTimeout(() => resolve(completion('late memory')), 3000));   // ignores its abort
    };
    await history.add('system', 'the line that makes it overdue');   // 20 countable: the summary starts
    await until(() => sent.length === 1);
    const started = Date.now();
    assert.equal(await prompter.promptConvo(history.getHistory()), 'On it.');
    assert.ok(Date.now() - started < 1600, `the decision waited ${Date.now() - started} ms`);
    const summary = calls.find(c => kindOf(c.body) === 'summary');
    assert.deepEqual([summary.options.maxRetries, summary.options.timeout], [0, 1000]);
    assert.equal(history.turns.length, 20);   // nothing lost while it hangs
    await until(() => !history.summary_pending, 5000);
    // A bad value keeps the default (checked like the other keys).
    assert.equal(loadWorkConfig({ summary_timeout_s: 0 }).summary_timeout_s, 120);
});

test('I1-1 fix wave 2: behind a 95-turn backlog the decision waits for one chunk, then goes; the rest follows it', async () => {
    const { prompter, history } = overdueAgent(94);
    const order = [];
    let n = 0;
    reply = body => {
        order.push(kindOf(body));
        if (kindOf(body) === 'decision') return completion('On it.');
        return new Promise(resolve => setTimeout(() => resolve(completion(`memory ${++n}`)), 5));
    };
    await history.add('system', 'line 95');   // the summary starts
    await prompter.promptConvo(history.getHistory());
    assert.deepEqual(order.slice(0, order.indexOf('decision') + 1), ['summary', 'decision']);
    await until(() => !history.summary_pending && history.countable() < history.max_messages, 5000);
});

test('I1-1 fix wave 2: a !stop during the wait behind a summary sends no decision', async () => {
    const { agent, prompter, history } = overdueAgent();
    const order = [];
    reply = body => {
        order.push(kindOf(body));
        if (kindOf(body) === 'decision') return completion('On it.');
        return new Promise(resolve => setTimeout(() => resolve(completion('new memory')), 200));
    };
    await history.add('system', 'the line that makes it overdue');
    await until(() => order.length === 1);
    const decision = prompter.promptConvo(history.getHistory());
    await new Promise(resolve => setTimeout(resolve, 50));
    agent.stop_epoch++;   // the owner's !stop
    assert.equal(await decision, '');
    assert.deepEqual(order, ['summary']);
});

// Final ruling after fix wave 2 (build2 r3, Sol #2 and the adversary's E1).
test('final ruling: an older decision already generating is dropped once a newer turn entered (its !collectBlocks never returns); of two waiting turns only the newer is sent', async () => {
    const { prompter, history } = overdueAgent(18);
    prompter.cooldown = 600;
    const sent = [];
    let releaseOld, summaryDone = null;
    reply = body => {
        const kind = kindOf(body);
        sent.push({ kind, last: body.messages.at(-1)?.content ?? '' });
        if (kind === 'summary') return new Promise(resolve => setTimeout(() => { summaryDone = Date.now(); resolve(completion('new memory')); }, 100));
        if (sent.filter(s => s.kind === 'decision').length === 1)
            return new Promise(resolve => { releaseOld = () => resolve(completion('!collectBlocks("dirt", 64)')); });
        return completion('!goToPlayer("owner", 2)');
    };
    await history.add('owner', 'get dirt');   // 19 countable
    const old = prompter.promptConvo(history.getHistory());
    await until(() => releaseOld);
    // His correction: turn 20, the summary is overdue, and two turns enter while it runs.
    await history.add('owner', 'leave the dirt and come here');
    const waiting = prompter.promptConvo(history.getHistory());
    const newest = prompter.promptConvo(history.getHistory());
    releaseOld();
    assert.equal(await old, '', 'the old response is dropped');
    assert.equal(await waiting, '');
    assert.ok(Date.now() - summaryDone < 200, `the older waiting turn ends ${Date.now() - summaryDone} ms after the summary, with no cooldown wait`);
    assert.equal(await newest, '!goToPlayer("owner", 2)');
    assert.equal(sent.filter(s => s.kind === 'decision').length, 2);   // the old one and the newest only
    await until(() => !history.summary_pending);
});

test('final ruling: after the wait the decision sends the compacted history', async () => {
    const { prompter, history } = overdueAgent(94);
    const sent = [];
    let n = 0;
    reply = body => {
        sent.push({ kind: kindOf(body), turns: body.messages.length });
        if (kindOf(body) === 'decision') return completion('On it.');
        return new Promise(resolve => setTimeout(() => resolve(completion(`memory ${++n}`)), 5));
    };
    const passed = [];
    const send = prompter.chat_model.sendRequest.bind(prompter.chat_model);
    prompter.chat_model.sendRequest = (turns, ...rest) => { if (rest[2]?.kind === 'decision') passed.push(turns.length); return send(turns, ...rest); };
    await history.add('system', 'line 95');
    const snapshot = history.getHistory();
    await prompter.promptConvo(snapshot);
    assert.deepEqual([snapshot.length, passed], [95, [90]]);   // one chunk summarised during the wait, then sent
    await until(() => !history.summary_pending && history.countable() < history.max_messages, 5000);
});

test('final ruling: a summary cut by work.summary_timeout_s gets double the deadline next time (capped by model_timeout_s) and publishes; history stays bounded', async () => {
    const { prompter, history } = overdueAgent(14, { summary_timeout_s: 1, model_timeout_s: 3 });
    const timeouts = [];
    reply = (body, options) => {
        timeouts.push(options.timeout);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(completion('slow memory')), 1300);   // slower than the first deadline
            options.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
            });
        });
    };
    for (let i = 0; i < 3 && history.memory !== 'slow memory'; i++) {
        await history.add('system', `line ${15 + i}`);
        await until(() => !history.summary_pending, 5000);
    }
    assert.equal(history.memory, 'slow memory');
    assert.deepEqual(timeouts, [1000, 2000]);
    assert.ok(history.turns.length <= 15, `${history.turns.length} turns`);
    // Reset after one completes; the cap is model_timeout_s.
    assert.equal(prompter.summaryRequestMs(), 1000);
    prompter.summary_cuts = 5;
    assert.equal(prompter.summaryRequestMs(), 3000);
});

test('I1-2: a summary request carries work.request_params.summary over the model params; a decision keeps its own', async () => {
    const { prompter, history } = memoryAgent();
    prompter.chat_model = new OpenAITools('fixture', URL, { reasoning_budget_tokens: 2048, max_tokens: 8192 });
    reply = body => completion(kindOf(body) === 'decision' ? 'On it.' : 'new memory');
    await prompter.promptConvo(history.getHistory());
    await prompter.promptMemSaving(history.turns.slice(0, 5));
    const [decision, summary] = calls.map(c => c.body);
    assert.deepEqual([decision.reasoning_budget_tokens, decision.max_tokens, 'chat_template_kwargs' in decision], [2048, 8192, false]);
    // Fix wave 1: the default also caps the summary's reasoning with the profile's budget key.
    assert.deepEqual([summary.reasoning_budget_tokens, summary.max_tokens, summary.chat_template_kwargs], [128, 8192, { enable_thinking: false }]);
    assert.deepEqual(logLines()[1].prompt, summary.messages);
    for (const call of calls) assert.equal('kind_params' in call.options, false);   // never an HTTP option
    // The profile sets its own per-kind params (replacing the default map whole).
    calls.length = 0;
    prompter.work_config = loadWorkConfig({ request_params: { summary: { reasoning_budget_tokens: 128 } } });
    await prompter.promptMemSaving(history.turns.slice(0, 5));
    assert.deepEqual([calls[0].body.reasoning_budget_tokens, 'chat_template_kwargs' in calls[0].body], [128, false]);
});
