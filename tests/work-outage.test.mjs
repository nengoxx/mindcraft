import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2b: model outages (SPEC §7.8, REQ-RES-17/18). The provider runs the real
// OpenAI client against a loopback HTTP server; everything else uses inert
// models and a fake clock. No game, model or outside network.
const { OpenAITools, unreachableCause } = await import('../src/models/openai_tools.js');
const { APIConnectionError, APIConnectionTimeoutError } = await import('openai/error');
const { Prompter } = await import('../src/models/prompter.js');
const { Coder } = await import('../src/agent/coder.js');
const { History } = await import('../src/agent/history.js');
const convoManager = (await import('../src/agent/conversation.js')).default;
const { ModelOutage, outageNotice, RECOVERY_NOTICE } = F.modules.outage;
const { loadWorkConfig } = F.modules.config;
const BRAIN = 'My brain disconnected, try again.';
const PAUSED = 2, STOPPED = 0;

process.env.OPENAI_API_KEY ??= 'test-no-auth';
const agents = [];
after(() => F.cleanup(agents));

// --- the loopback server ------------------------------------------------------

let behaviour = 200;
let hits = 0;
const server = http.createServer((req, res) => {
    hits++;
    req.resume();
    req.on('end', () => {
        if (behaviour === 'hang') return; // never answers
        res.writeHead(behaviour, { 'content-type': 'application/json' });
        res.end(JSON.stringify(behaviour === 200
            ? { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }
            : { error: { message: `fixture ${behaviour}` } }));
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const URL = `http://127.0.0.1:${server.address().port}/v1`;
after(() => { server.closeAllConnections(); server.close(); });
// A port with nothing listening: a connection error.
const closed = http.createServer();
await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
const CLOSED_URL = `http://127.0.0.1:${closed.address().port}/v1`;
await new Promise(resolve => closed.close(resolve));

const turns = () => [{ role: 'user', content: 'owner: hello' }];

// --- fakes ----------------------------------------------------------------------

// The outage module's clock and sleep. `auto` sleeps pass at once on the fake
// clock; otherwise each sleep waits until release() (the oldest, or the oldest
// of `ms`), or ends early, with no time passing, once `stopped()` holds, as the
// real polling sleep does.
function fakeTime({ auto = true } = {}) {
    const t = { now: 0, slept: [], pending: [], auto, onSleep: null };
    t.clock = () => t.now;
    t.sleep = (ms, stopped) => {
        t.slept.push(ms);
        if (t.auto) {
            t.now += ms;
            t.onSleep?.();
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const entry = { ms, stopped };
            const done = () => { clearInterval(poll); t.pending.splice(t.pending.indexOf(entry), 1); resolve(); };
            entry.resolve = () => { t.now += ms; done(); };
            const poll = setInterval(() => { if (stopped()) done(); }, 2);
            poll.unref(); // a sleep still pending when the test ends keeps nothing alive
            t.pending.push(entry);
        });
    };
    t.release = (ms = null) => t.pending.find(p => ms === null || p.ms === ms).resolve();
    return t;
}

// A provider whose script entries are replies, or 'down:<cause>' for an
// unreachable model (outcome set, gpt.js's stand-in reply returned).
function scriptedModel(script = []) {
    const model = {
        kinds: [],
        async sendRequest(turns, system, stop, options = {}) {
            model.kinds.push(options.kind);
            const next = script.length ? script.shift() : 'ok';
            if (typeof next === 'string' && next.startsWith('down:')) {
                if (options.outcome) options.outcome.unreachable = next.slice(5);
                return BRAIN;
            }
            return next;
        },
    };
    return model;
}

// Actual prompter methods with inert state: no profile files, examples or game.
function prompterFor(agent, model) {
    const prompter = Object.create(Prompter.prototype);
    Object.assign(prompter, {
        agent,
        profile: { conversing: 'convo', coding: 'code', saving_memory: 'memory', bot_responder: 'responder' },
        cooldown: 0, last_prompt_time: 0, awaiting_coding: false,
        chat_model: model, code_model: model, convo_examples: null, coding_examples: null,
    });
    return prompter;
}

function stubAgent(time = fakeTime(), work = {}) {
    const agent = { name: 'outagestub', chats: [], history: { getHistory: () => [] } };
    agent.openChat = message => agent.chats.push(message);
    agent.model_outage = new ModelOutage(agent, loadWorkConfig(work), { now: time.clock, sleep: time.sleep });
    return agent;
}

const notices = agent => agent.chats.filter(m => m === RECOVERY_NOTICE || /^I can't reach my model/.test(m));

// --- provider -------------------------------------------------------------------

test('provider: outcome never reaches the request; unreachable on a connection error, a timeout and a 5xx, not on a 4xx', async () => {
    const cases = [
        [CLOSED_URL, 200, 'ECONNREFUSED'],
        [URL, 'hang', 'timed out'],
        [URL, 503, 'HTTP 503'],
        [URL, 500, 'HTTP 500'],
        [URL, 400, undefined],
        [URL, 429, undefined],
        [URL, 200, undefined],
    ];
    for (const [url, reply, cause] of cases) {
        behaviour = reply;
        const model = new OpenAITools('fixture', url);
        model.configureClient({ model_timeout_s: 0.3, model_max_retries: 0 });
        const seen = [];
        const post = model.openai.post.bind(model.openai);
        model.openai.post = (path, opts) => { seen.push(opts); return post(path, opts); };
        const outcome = {};
        const text = await model.sendRequest(turns(), 'sys', undefined, { kind: 'decision', outcome });
        assert.equal(outcome.unreachable, cause, `${url} ${reply}`);
        assert.equal(text, reply === 200 && url === URL ? 'ok' : BRAIN); // gpt.js unchanged
        assert.equal(seen.length, 1);
        for (const key of ['outcome', 'kind', 'task_id']) assert.equal(key in seen[0], false, key);
    }
    // A user abort (the coder's cancel) is no outage and still rejects.
    behaviour = 'hang';
    const model = new OpenAITools('fixture', URL);
    const controller = new AbortController();
    const outcome = {};
    const request = model.sendRequest(turns(), 'sys', undefined, { kind: 'coding', signal: controller.signal, outcome });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(request, err => err.name === 'AbortError' || err.constructor.name === 'APIUserAbortError');
    assert.equal(outcome.unreachable, undefined);
    behaviour = 200;
});

test('provider: the cause shown to the owner is only an error code, "timed out" or "HTTP <status>", else "connection error" (R10)', () => {
    const cause = { code: 'EAI_AGAIN' };
    assert.equal(unreachableCause(new APIConnectionError({ cause })), 'EAI_AGAIN');
    assert.equal(unreachableCause(new APIConnectionError({ cause: new Error('request to http://model-host:8080/v1 failed') })), 'connection error');
    assert.equal(unreachableCause(new APIConnectionError({})), 'connection error');
    assert.equal(unreachableCause(new APIConnectionTimeoutError()), 'timed out');
    assert.equal(unreachableCause(Object.assign(new Error('x'), { status: 502 })), 'HTTP 502');
    assert.equal(unreachableCause(Object.assign(new Error('x'), { status: 404 })), null);
});

test('provider: the prompter builds the client with the configured timeout and retries (defaults 600 s and 2)', async () => {
    F.useSettings({ base_profile: 'assistant' });
    try {
        const agent = { name: 'outageprompter' };
        const model = { api: 'openai_tools', url: URL, model: 'fixture' };
        const configured = new Prompter(agent, { name: 'outageprompter', model: { ...model }, embedding: false, work: { model_timeout_s: 7, model_max_retries: 1 } });
        assert.deepEqual([configured.chat_model.openai.timeout, configured.chat_model.openai.maxRetries], [7000, 1]);
        const defaults = new Prompter(agent, { name: 'outageprompter', model: { ...model }, embedding: false });
        assert.deepEqual([defaults.chat_model.openai.timeout, defaults.chat_model.openai.maxRetries], [600000, 2]);
        // The real client honours them, and a per-request maxRetries (the decision's 0) wins.
        behaviour = 503;
        for (const [prompter, options, expected] of [[defaults, {}, 3], [configured, {}, 2], [defaults, { maxRetries: 0 }, 1]]) {
            hits = 0;
            const outcome = {};
            await prompter.chat_model.sendRequest(turns(), 'sys', undefined, { outcome, ...options });
            assert.equal(hits, expected);
            assert.equal(outcome.unreachable, 'HTTP 503');
        }
    } finally {
        behaviour = 200;
        F.useSettings();
    }
});

// --- promptConvo ----------------------------------------------------------------

test('promptConvo waits through an outage with back-off from 5 s doubling to 60 s, spending none of its 3 tries', async () => {
    const time = fakeTime();
    const agent = stubAgent(time);
    const model = scriptedModel(['down:EAI_AGAIN', 'down:EAI_AGAIN', 'down:EAI_AGAIN', 'down:EAI_AGAIN',
        'down:EAI_AGAIN', 'down:EAI_AGAIN', 'down:EAI_AGAIN', 'Hello owner']);
    const reply = await prompterFor(agent, model).promptConvo(turns());
    assert.equal(reply, 'Hello owner');
    assert.deepEqual(time.slept, [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
    assert.deepEqual(agent.chats, [outageNotice('EAI_AGAIN'), RECOVERY_NOTICE]);
    // The 3 tries are still there for what they guard: hallucinated replies.
    const flaky = scriptedModel(['down:EAI_AGAIN', '(FROM OTHER BOT) hi', 'down:EAI_AGAIN', '(FROM OTHER BOT) hi', 'Hi']);
    assert.equal(await prompterFor(stubAgent(), flaky).promptConvo(turns()), 'Hi');
});

test('promptConvo gives up with no reply after work.model_outage_wait_s, and never says "My brain disconnected"', async () => {
    for (const wait_s of [600, 90]) {
        const time = fakeTime();
        const agent = stubAgent(time, { model_outage_wait_s: wait_s });
        const model = scriptedModel(Array(100).fill('down:ECONNREFUSED'));
        const reply = await prompterFor(agent, model).promptConvo(turns(), true);
        assert.equal(reply, '');
        assert.equal(time.slept.reduce((a, b) => a + b, 0), wait_s * 1000);
        assert.equal(time.slept.at(-1) <= 60000, true);
        // One request first and after each wait but the last: none starts at the deadline (R5).
        assert.equal(model.kinds.length, time.slept.length);
        assert.deepEqual(agent.chats, [outageNotice('ECONNREFUSED')]); // no recovery, no stand-in reply
        assert.equal(agent.model_outage.isDown(), true);
        assert.equal(agent.model_outage.wait_ended, true); // the self-prompted turn ended inside the outage wait
    }
    // Only a self-prompted turn's wait marks the end for the self-prompter (W1).
    const owner = stubAgent(fakeTime(), { model_outage_wait_s: 10 });
    assert.equal(await prompterFor(owner, scriptedModel(Array(10).fill('down:ECONNREFUSED'))).promptConvo(turns()), '');
    assert.equal(owner.model_outage.wait_ended, false);
});

test('promptConvo starts no request once the wait has run out, counting the time requests take (R5)', async () => {
    const time = fakeTime();
    const agent = stubAgent(time, { model_outage_wait_s: 10 });
    const model = scriptedModel(Array(10).fill('down:ECONNREFUSED'));
    const send = model.sendRequest;
    model.sendRequest = async (...args) => { time.now += 3000; return send(...args); }; // each request takes 3 s
    assert.equal(await prompterFor(agent, model).promptConvo(turns()), '');
    // t=3 fail (deadline 13) → 5 s → t=11 fail → 2 s to the deadline → no third request.
    assert.deepEqual([model.kinds.length, time.slept], [2, [5000, 2000]]);
});

test('a stop during the retry\'s cooldown or prompt preparation starts no further request (W3)', async () => {
    for (const step of ['checkCooldown', 'replaceStrings']) {
        const agent = stubAgent();
        agent.stop_epoch = 0;
        const model = scriptedModel(['down:ECONNREFUSED', 'late reply']);
        const prompter = prompterFor(agent, model);
        const original = prompter[step];
        let n = 0;
        prompter[step] = async (...args) => { if (++n === 2) agent.stop_epoch++; return original.apply(prompter, args); };
        assert.equal(await prompter.promptConvo(turns()), '', step);
        assert.equal(model.kinds.length, 1, step);
    }
});

test('a recovery while a turn\'s request is still in flight does not skip that turn\'s first back-off (W2)', async () => {
    const time = fakeTime();
    const agent = stubAgent(time);
    agent.model_outage.down('ECONNREFUSED');
    const model = scriptedModel(['down:ECONNREFUSED', 'Hi']);
    const send = model.sendRequest;
    let first = true;
    model.sendRequest = async (...args) => { // another call recovers while this request is out, then it fails
        if (first) { first = false; agent.model_outage.up(); }
        return send(...args);
    };
    assert.equal(await prompterFor(agent, model).promptConvo(turns()), 'Hi');
    assert.deepEqual(time.slept, [5000]);
});

test('decision requests pass maxRetries 0 (promptConvo retries them); every other call keeps the client default (R8)', async () => {
    const agent = stubAgent();
    const seen = {};
    const prompter = prompterFor(agent, { async sendRequest(t, s, stop, options) { seen[options.kind] = options; return 'OK'; } });
    await prompter.promptConvo(turns());
    await prompter.promptMemSaving(turns());
    await prompter.promptShouldRespondToBot('other bot: hi');
    await prompter.promptCoding(turns());
    await prompter.probeModel();
    assert.equal(seen.decision.maxRetries, 0);
    for (const kind of ['summary', 'bot_responder', 'coding', 'probe']) assert.equal('maxRetries' in seen[kind], false, kind);
});

test('the waiter: no sleep when already stopped; the real sleep ends early on stop, and recovery wakes it', async () => {
    const time = fakeTime();
    const outage = stubAgent(time).model_outage;
    assert.equal(await outage.waiter().next(() => true), false);
    assert.deepEqual(time.slept, []);
    // The real polling sleep (default): a stop or a recovery ends the 5 s back-off within about a second.
    const real = new ModelOutage({ openChat() {} }, loadWorkConfig({}));
    let stop = false;
    let started = Date.now();
    setTimeout(() => { stop = true; }, 50);
    assert.equal(await real.waiter().next(() => stop), false);
    assert.ok(Date.now() - started < 2000, `stopped after ${Date.now() - started} ms`);
    real.down('ECONNREFUSED');
    const wait = real.waiter();
    started = Date.now();
    setTimeout(() => real.up(), 50);
    assert.equal(await wait.next(() => false), true); // retry at once
    assert.ok(Date.now() - started < 2000, `woken after ${Date.now() - started} ms`);
    wait.end();
});

test('the watch: its real sleep ends early once the pause is no longer wanted', async () => {
    const real = new ModelOutage({ openChat() {}, prompter: { probeModel: async () => true } }, loadWorkConfig({}));
    let wanted = true;
    let resumed = false;
    const started = Date.now();
    setTimeout(() => { wanted = false; }, 50);
    await real.watch(() => wanted, () => { resumed = true; });
    assert.ok(Date.now() - started < 2000, `ended after ${Date.now() - started} ms`);
    assert.equal(resumed, false);
});

test('promptConvo stops waiting when a newer message supersedes the turn', async () => {
    const time = fakeTime();
    const agent = stubAgent(time);
    const prompter = prompterFor(agent, scriptedModel(Array(100).fill('down:ECONNREFUSED')));
    time.onSleep = () => { if (time.slept.length === 2) prompter.most_recent_msg_time = -1; }; // a newer message arrives
    assert.equal(await prompter.promptConvo(turns()), '');
    assert.deepEqual(time.slept, [5000, 10000]);
    assert.equal(prompter.chat_model.kinds.length, 2);
});

test('an owner message during an outage is answered after it, with one notice each way and no stand-in reply', async () => {
    const time = fakeTime();
    const agent = F.makeAgent({ name: 'outagechat' });
    agents.push(agent);
    agent.model_outage = new ModelOutage(agent, loadWorkConfig({}), { now: time.clock, sleep: time.sleep });
    agent.prompter = Object.assign(prompterFor(agent, scriptedModel(['down:EAI_AGAIN', 'down:EAI_AGAIN', 'down:EAI_AGAIN', 'Hi there'])),
        { getInitModes: agent.prompter.getInitModes, cancelCoding() {} });
    await F.ownerSays(agent, 'hello');
    assert.deepEqual(agent.chats, [outageNotice('EAI_AGAIN'), RECOVERY_NOTICE, 'Hi there']);
    assert.equal(agent.chats.some(m => m.includes('My brain disconnected')), false);
    assert.equal(agent.turns.some(t => t.content.includes('My brain disconnected')), false);
});

// --- notices ----------------------------------------------------------------------

test('one owner notice per outage and one on recovery, however many calls of any kind fail', async () => {
    const time = fakeTime();
    const agent = stubAgent(time);
    const prompter = prompterFor(agent, scriptedModel());
    const down = n => Array(n).fill('down:ECONNREFUSED');
    const run = async script => {
        prompter.chat_model = prompter.code_model = scriptedModel(script);
        await prompter.promptMemSaving(turns());
        await prompter.promptShouldRespondToBot('other bot: hi');
        await prompter.promptCoding(turns());
        await prompter.promptConvo(turns());
    };
    await run([...down(3), ...down(6), 'ok']); // summary, bot responder, coding, then a convo turn that waits 6 times
    assert.deepEqual(notices(agent), [outageNotice('ECONNREFUSED'), RECOVERY_NOTICE]);
    await run(['ok', 'ok', 'ok', 'ok']);
    assert.equal(notices(agent).length, 2); // calls while reachable say nothing
    await run(['down:HTTP 503', 'ok', 'ok', 'ok']);
    assert.deepEqual(notices(agent).slice(2), [outageNotice('HTTP 503'), RECOVERY_NOTICE]); // a new outage, a new pair
});

test('each kind of call on its own reports an outage: summary, bot responder, coding, probe', async () => {
    for (const call of [p => p.promptMemSaving(turns()), p => p.promptShouldRespondToBot('other bot: hi'),
        p => p.promptCoding(turns()), p => p.probeModel()]) {
        const agent = stubAgent();
        await call(prompterFor(agent, scriptedModel(['down:EAI_AGAIN'])));
        assert.deepEqual(notices(agent), [outageNotice('EAI_AGAIN')]);
    }
});

test('the recovery probe is one minimal request of kind probe that reports to the outage state', async () => {
    const agent = stubAgent();
    const prompter = prompterFor(agent, scriptedModel(['down:ECONNREFUSED', 'OK']));
    assert.equal(await prompter.probeModel(), false);
    assert.equal(await prompter.probeModel(), true);
    assert.deepEqual(prompter.chat_model.kinds, ['probe', 'probe']);
    assert.deepEqual(notices(agent), [outageNotice('ECONNREFUSED'), RECOVERY_NOTICE]);
});

// --- coder ------------------------------------------------------------------------

function coderWith(script, outputs = []) {
    const coder = Object.create(Coder.prototype);
    const time = fakeTime();
    const agent = stubAgent(time);
    let output = 0;
    Object.assign(agent, {
        bot: { interrupt_code: false, modes: { pause() {} } },
        actions: { getBotOutputSummary: () => outputs[output++] ?? 'fixture output' },
    });
    agent.prompter = prompterFor(agent, scriptedModel(script));
    agent.prompter.skill_libary = { async getAllSkillDocs() { return []; } };
    coder.agent = agent;
    coder.executed = 0;
    coder._stageCode = async code => ({
        src_lint_copy: coder._sanitizeCode(code),
        func: { async main() { coder.executed++; if (/throw/.test(code)) throw new Error('fixture'); } },
    });
    coder.history = { getHistory: () => [{ role: 'assistant', content: '!newAction("dig a hole")' }] };
    return coder;
}

test('coder: "no code was run" only when no execution began; otherwise the count, also of runs that threw, and the last output', async () => {
    const none = coderWith(['down:EAI_AGAIN']);
    assert.equal(await none.generateCode(none.history), 'Action stopped: my model is unreachable (EAI_AGAIN); no code was run.');
    assert.equal(none.executed, 0);

    const once = coderWith(['```js\nthrow new Error("x");\n```', 'down:EAI_AGAIN'], ['first output']);
    assert.equal(await once.generateCode(once.history),
        'Action stopped: my model became unreachable (EAI_AGAIN); the code ran once before that and no further code ran. Last code output:\nfirst output');

    const twice = coderWith(['```js\nthrow new Error("x");\n```', '```js\nthrow new Error("y");\n```', 'down:HTTP 503'],
        ['first output', 'second output']);
    assert.equal(await twice.generateCode(twice.history),
        'Action stopped: my model became unreachable (HTTP 503); the code ran 2 times before that and no further code ran. Last code output:\nsecond output');
    assert.equal(twice.executed, 2);
});

test('coder: an outage is never a "no code block" failure', async () => {
    // Three replies without code use up MAX_NO_CODE; the outage after them is still an outage.
    const control = coderWith(['no code here', 'still none', 'nope', 'none again']);
    assert.equal(await control.generateCode(control.history), 'Action failed, agent would not write code.');
    const coder = coderWith(['no code here', 'still none', 'nope', 'down:ECONNREFUSED']);
    assert.equal(await coder.generateCode(coder.history), 'Action stopped: my model is unreachable (ECONNREFUSED); no code was run.');
    assert.deepEqual(notices(coder.agent), [outageNotice('ECONNREFUSED')]);
});

// --- self-prompter --------------------------------------------------------------

const HANG = () => new Promise(() => {}); // a turn that is still thinking when the test ends
const goalOf = turns => turns?.map(t => t.content.match(/with the goal: '(.*?)'/)?.[1]).filter(Boolean).at(-1) ?? null;

// The backend behind the real prompter: down (every call unreachable) or up.
// Decisions take the next reply (by default a turn still thinking at the end);
// each call records its kind, the goal in its history and its last turn.
function backend() {
    const b = { down: true, replies: [], calls: [], probeGate: null };
    b.sendRequest = async (turns, system, stop, options = {}) => {
        b.calls.push({ kind: options.kind, goal: goalOf(turns), last: turns?.at(-1)?.content ?? null });
        if (options.kind === 'probe' && b.probeGate) await b.probeGate;
        if (b.down) { options.outcome.unreachable = 'ECONNREFUSED'; return BRAIN; }
        if (options.kind !== 'decision') return 'OK';
        const next = b.replies.shift();
        return typeof next === 'function' ? next() : next ?? HANG();
    };
    return b;
}
const probes = model => model.calls.filter(c => c.kind === 'probe').length;
const decisions = model => model.calls.filter(c => c.kind === 'decision');
const pendingMs = (time, ms) => time.pending.filter(p => p.ms === ms).length;

// The real handleMessage, prompter and self-prompter over that backend. The
// outage wait is 5 s, one back-off; every sleep waits for release().
function goalAgent(name, work = { model_outage_wait_s: 5 }, bot = undefined) {
    const time = fakeTime({ auto: false });
    const agent = F.makeAgent({ name, bot });
    agents.push(agent);
    agent.model_outage = new ModelOutage(agent, loadWorkConfig(work), { now: time.clock, sleep: time.sleep });
    const model = backend();
    agent.prompter = Object.assign(prompterFor(agent, model), { getInitModes: agent.prompter.getInitModes, cancelCoding() {} });
    return { agent, sp: agent.self_prompter, time, model };
}

// The goal's turn meets the outage, waits it out and gives up: the goal pauses.
async function pauseByOutage(sp, time, goal = 'collect wood') {
    sp.start(goal);
    await F.until(() => pendingMs(time, 5000) === 1);
    time.release(5000);
    await F.until(() => sp.outage && pendingMs(time, 60000) === 1);
}

test('self-prompter: an outage pauses the goal (PAUSED with the flag, saved), the probe runs every 60 s, and recovery resumes the same goal', async () => {
    const { agent, sp, time, model } = goalAgent('outagegoal');
    const saves = [];
    agent.history.save = async () => { saves.push([sp.state, sp.outage]); };
    await pauseByOutage(sp, time);
    assert.deepEqual([sp.state, sp.outage, sp.isStopped()], [PAUSED, true, false]);
    assert.ok(saves.some(([state, outage]) => state === PAUSED && outage)); // a restart loads the pause
    for (const up of [false, false, true]) {
        assert.equal(pendingMs(time, 60000), 1);
        model.down = !up;
        const n = probes(model);
        time.release(60000);
        await F.until(() => probes(model) === n + 1);
    }
    await F.until(() => sp.isActive());
    assert.deepEqual([sp.prompt, sp.outage, probes(model)], ['collect wood', false, 3]);
    model.replies.push('Working on it.');
    sp.update(sp.cooldown); // agent.js's update restarts the loop once idle (W4)
    await F.until(() => decisions(model).length === 3); // the goal's next turn succeeds, and the one after starts
    assert.deepEqual([decisions(model)[1].goal, sp.isActive(), sp.outage], ['collect wood', true, false]); // its old wait no longer counts
    assert.deepEqual(notices(agent), [outageNotice('ECONNREFUSED'), RECOVERY_NOTICE]);
    assert.equal(agent.chats.some(m => /did not use command/.test(m)), false);
});

test('self-prompter: a call that succeeds meanwhile ends the outage; the next probe interval resumes with no probe request', async () => {
    const { agent, sp, time, model } = goalAgent('outageowner');
    await pauseByOutage(sp, time);
    agent.model_outage.up(); // e.g. the owner's own message got its answer
    time.release(60000);
    await F.until(() => sp.isActive());
    assert.equal(probes(model), 0);
});

test('self-prompter: a goal replaced meanwhile is not resumed, even when it is paused by an outage again', async () => {
    const { sp, time, model } = goalAgent('outagereplace');
    await pauseByOutage(sp, time);
    await pauseByOutage(sp, time, 'mine stone'); // the new goal meets the outage too; the old watch has ended
    assert.deepEqual([probes(model), sp.state, sp.prompt], [0, PAUSED, 'mine stone']);
    model.down = false;
    time.release(60000);
    await F.until(() => sp.isActive());
    assert.deepEqual([probes(model), sp.prompt], [1, 'mine stone']);
});

test('self-prompter: a new goal during the old goal\'s foreground wait supersedes its turn; nothing stale runs (R1)', async () => {
    const { agent, sp, time, model } = goalAgent('outagenewgoal');
    sp.start('collect wood');
    await F.until(() => pendingMs(time, 5000) === 1); // the old turn is in its back-off
    model.down = false; // the model is back before the old turn retries
    await F.ownerSays(agent, '!goal("mine stone")');
    await F.until(() => decisions(model).length === 2);
    assert.deepEqual(decisions(model).map(d => d.goal), ['collect wood', 'mine stone']); // the old turn never retried
    assert.deepEqual([sp.prompt, sp.isActive(), sp.outage], ['mine stone', true, false]);
});

test('self-prompter: an owner !stop ends the foreground wait at once (R2)', async () => {
    const { agent, sp, time, model } = goalAgent('outagestopwait');
    sp.start('collect wood');
    await F.until(() => pendingMs(time, 5000) === 1);
    await F.ownerSays(agent, '!stop');
    await F.until(() => !sp.loop_active);
    assert.deepEqual([decisions(model).length, time.pending.length, sp.state, sp.outage], [1, 0, STOPPED, false]);
});

test('self-prompter: a failed background call after a successful decision does not pause the goal (R3)', async () => {
    const { agent, sp, time, model } = goalAgent('outagesummary');
    model.down = false;
    model.replies.push('Working on it.'); // the decision succeeds
    const handle = agent.handleMessage;
    let first = true;
    agent.handleMessage = async (...args) => { // a background summary fails as the turn ends
        const result = await handle.apply(agent, args);
        if (first) {
            first = false;
            model.down = true;
            await agent.prompter.promptMemSaving([]);
        }
        return result;
    };
    sp.start('collect wood');
    await F.until(() => time.pending.length === 1); // the next turn meets the outage
    assert.deepEqual([time.pending[0].ms, sp.state, sp.outage], [5000, 1, false]);
    assert.deepEqual(notices(agent), [outageNotice('ECONNREFUSED')]);
});

test('self-prompter: a turn whose loop was stopped (a mode, an owner action) is not turned into an outage pause', async () => {
    const { sp, time } = goalAgent('outageinterrupt');
    sp.start('collect wood');
    await F.until(() => pendingMs(time, 5000) === 1);
    const stopping = sp.stopLoop(); // modes.js and handleUserPromptedCmd stop the loop this way
    time.release(5000);
    await stopping;
    assert.deepEqual([sp.state, sp.outage, pendingMs(time, 60000)], [1, false, 0]);
});

test('self-prompter: an owner message during an outage pause is answered before the goal resumes (R6)', async () => {
    const { agent, sp, time, model } = goalAgent('outagerace');
    await pauseByOutage(sp, time);
    const owner = F.ownerSays(agent, 'hello'); // its turn meets the outage and waits
    await F.until(() => pendingMs(time, 5000) === 1);
    model.down = false;
    model.replies.push('Hi owner');
    time.release(60000); // the probe wins the race and recovery wakes the owner's turn
    await owner;
    assert.deepEqual(decisions(model).at(-1).last, 'hello');
    assert.ok(agent.chats.indexOf('Hi owner') > agent.chats.indexOf(RECOVERY_NOTICE));
    assert.equal(sp.isActive(), false); // not resumed over the owner's waiting turn
    await F.until(() => pendingMs(time, 60000) === 1);
    time.release(60000);
    await F.until(() => sp.isActive());
});

test('self-prompter: while the owner\'s turn waits through an outage the goal starts no turn over it; it pauses, the owner is answered, then the goal resumes (W1)', async () => {
    const { agent, sp, time, model } = goalAgent('outageactive');
    model.down = false;
    // The goal is ACTIVE between turns: its loop was stopped (an owner action, handleUserPromptedCmd).
    let stopping = null;
    model.replies.push(() => { stopping = sp.stopLoop(); return 'Working on it.'; }, 'Hi owner');
    sp.start('collect wood');
    await F.until(() => stopping);
    await stopping;
    assert.deepEqual([sp.loop_active, sp.isActive()], [false, true]);
    model.down = true; // the outage begins and the owner asks: his turn waits
    const owner = F.ownerSays(agent, 'hello');
    await F.until(() => pendingMs(time, 5000) === 1);
    sp.update(sp.cooldown); // agent.js's update restarts the goal's loop
    await F.until(() => sp.outage && pendingMs(time, 60000) === 1);
    assert.deepEqual([decisions(model).length, sp.state], [2, PAUSED]); // the goal's turn and the owner's; none over the wait
    model.down = false;
    time.release(60000); // the probe succeeds and recovery wakes the owner's turn
    await owner;
    assert.ok(agent.chats.includes('Hi owner'));
    assert.equal(sp.isActive(), false);
    await F.until(() => pendingMs(time, 60000) === 1);
    time.release(60000);
    await F.until(() => sp.isActive());
    sp.update(sp.cooldown);
    await F.until(() => decisions(model).length === 4);
    assert.equal(decisions(model)[3].goal, 'collect wood');
});

test('self-prompter: the owner\'s first request, still in flight at recovery, is answered before the goal resumes (W2)', async () => {
    const { agent, sp, time, model } = goalAgent('outagefirst');
    await pauseByOutage(sp, time);
    model.down = false;
    let answer = null;
    model.replies.push(() => new Promise(resolve => { answer = resolve; }));
    const owner = F.ownerSays(agent, 'hello');
    await F.until(() => answer); // the owner's first request is in flight
    time.release(60000); // the probe succeeds meanwhile
    await F.until(() => probes(model) === 1 && pendingMs(time, 60000) === 1);
    assert.equal(sp.isActive(), false);
    answer('Hi owner');
    await owner;
    assert.ok(agent.chats.includes('Hi owner'));
    time.release(60000);
    await F.until(() => sp.isActive());
});

test('self-prompter: recovery does not cut short the owner\'s running action; the goal resumes once idle (W4)', async () => {
    const { agent, sp, time, model } = goalAgent('outageaction');
    await pauseByOutage(sp, time);
    let finish = null;
    const action = agent.actions.runAction('action:owner', () => new Promise(resolve => { finish = resolve; }));
    await F.until(() => finish && agent.actions.executing);
    model.down = false;
    time.release(60000);
    await F.until(() => probes(model) === 1 && sp.isActive());
    sp.update(sp.cooldown);
    await F.sleep(20);
    assert.deepEqual([agent.actions.executing, decisions(model).length], [true, 1]); // no goal turn while it runs
    finish();
    await action;
    sp.update(sp.cooldown);
    await F.until(() => decisions(model).length === 2);
});

test('self-prompter: an owner !stop while a probe request is in flight wins over its recovery', async () => {
    const { agent, sp, time, model } = goalAgent('outageprobestop');
    await pauseByOutage(sp, time);
    let open;
    model.probeGate = new Promise(resolve => { open = resolve; });
    model.down = false;
    time.release(60000);
    await F.until(() => probes(model) === 1);
    await F.ownerSays(agent, '!stop');
    open();
    await F.sleep(20);
    assert.deepEqual([sp.state, sp.outage], [STOPPED, false]);
});

for (const [how, clear] of [
    ['an owner !stop', async agent => F.ownerSays(agent, '!stop')],
    ['a new goal', async agent => F.ownerSays(agent, '!goal("build a hut")')],
    ['a new goal while in conversation', async agent => agent.self_prompter.setPromptPaused('build a hut')],
    ['a manual pause', async agent => agent.self_prompter.pause()],
    ['a load of other state', async agent => agent.self_prompter.handleLoad('build a hut', PAUSED)],
]) {
    test(`self-prompter: ${how} clears the outage flag, and the probe never resumes the old goal`, async () => {
        const { agent, sp, time, model } = goalAgent(`outageclear${how.length}`);
        await pauseByOutage(sp, time);
        model.down = false;
        await clear(agent);
        assert.equal(sp.outage, false);
        await F.until(() => pendingMs(time, 60000) === 0); // the old watch ends by itself
        await F.sleep(20);
        assert.deepEqual([probes(model), sp.outage], [0, false]);
        assert.notEqual(sp.prompt === 'collect wood' && sp.isActive(), true);
    });
}

test('self-prompter: start() clears the flag, also through !stfu with a single bot', async t => {
    const { agent, sp, time } = goalAgent('outagestfu');
    await pauseByOutage(sp, time);
    convoManager.initAgent(agent);
    const start = sp.start.bind(sp);
    let seen = null;
    sp.start = (...args) => { const result = start(...args); seen ??= { outage: sp.outage, state: sp.state }; return result; };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        agent.shutUp(); // conversation.js _resumeSelfPrompter: start() 5 s later
        t.mock.timers.tick(5000);
        for (let i = 0; i < 10 && !seen; i++) await Promise.resolve();
    } finally {
        t.mock.timers.reset();
    }
    assert.deepEqual(seen, { outage: false, state: 1 });
});

test('self-prompter: the flag survives a save and load, and a loaded outage pause restarts the probe', async () => {
    // Save through the real History.
    const source = { name: 'outagesave', task: { taskStartTime: 1 }, last_sender: null };
    source.self_prompter = Object.assign(new F.modules.SelfPrompter(source), { state: PAUSED, prompt: 'collect wood', outage: true });
    const history = new History(source);
    await history.save();
    const saved = new History(source).load();
    assert.deepEqual([saved.self_prompting_state, saved.self_prompt, saved.self_prompt_outage], [PAUSED, 'collect wood', true]);

    // Load through agent.js's event setup (:203). With the flag the outage
    // state starts down, with no notice: only a probe or a request that
    // succeeds in this process resumes the goal (R4).
    for (const [data, probing] of [[saved, true], [{ ...saved, self_prompt_outage: false }, false]]) {
        const { agent, sp, time, model } = goalAgent(`outageload${probing}`);
        agent.bot.autoEat = {};
        await F.modules.Agent.prototype._setupEventHandlers.call(agent, data, null);
        assert.deepEqual([sp.state, sp.prompt, sp.outage], [PAUSED, 'collect wood', probing]);
        assert.deepEqual(time.pending.map(p => p.ms), probing ? [60000] : []);
        assert.deepEqual([agent.model_outage.isDown(), notices(agent)], [probing, []]);
        if (!probing) continue;
        time.release(60000); // the backend is still down
        await F.until(() => probes(model) === 1 && pendingMs(time, 60000) === 1);
        assert.equal(sp.state, PAUSED);
        model.down = false;
        time.release(60000);
        await F.until(() => sp.isActive());
        assert.deepEqual([sp.prompt, probes(model), notices(agent)], ['collect wood', 2, [RECOVERY_NOTICE]]);
    }
});

// --- agent.js and the task layer ----------------------------------------------------

test("a rejected handleMessage from respondFunc is caught and logged", async t => {
    const agent = F.makeAgent({ name: 'outagerespond' });
    agents.push(agent);
    agent.bot.autoEat = {};
    await F.modules.Agent.prototype._setupEventHandlers.call(agent, null, null);
    const errors = t.mock.method(console, 'error', () => {});
    const failure = new Error('turn failed');
    agent.handleMessage = async () => { throw failure; };
    await agent.respondFunc(F.OWNER, 'hello');
    await F.until(() => errors.mock.callCount() > 0);
    assert.equal(errors.mock.calls[0].arguments[0], 'Error handling message:');
    assert.equal(errors.mock.calls[0].arguments[1], failure);
});

test('an active task keeps running through an outage with no model call', async () => {
    const world = new F.World();
    for (let i = 0; i < 2; i++) F.tree(world, 3 + i * 3, 64, 0, 4);
    const bot = F.makeBot({ world });
    F.player(bot, F.OWNER, [0, 64, 0]);
    const { agent, time, model } = goalAgent('outagetask', { model_outage_wait_s: 5 }, bot);
    F.clearRecord(agent);
    F.startWork(agent);
    const stop = F.drive(agent);
    try {
        F.ownerSays(agent, 'how is it going?'); // a real call fails, and its turn waits
        await F.until(() => pendingMs(time, 5000) === 1);
        agent.work.startTask('4 logs', 'obtain item=oak_log count=4');
        await F.until(() => agent.work.record?.status === 'done', { timeout: 8000 });
        await F.until(() => agent.chats.some(m => /^Task done/.test(m))); // the fact report, posted after the run
        assert.equal(bot.count('oak_log'), 4);
        assert.deepEqual(model.calls.map(c => c.kind), ['decision']); // only the owner's failed one
        assert.deepEqual(notices(agent), [outageNotice('ECONNREFUSED')]);
    } finally {
        stop();
    }
});
