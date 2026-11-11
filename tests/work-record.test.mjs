import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: the task record (SPEC §6), restart rules (REQ-REC-7/9), the stall rule
// (REQ-RES-16), the anchor freeze (REQ-PLAN-8) and the memory cap (REQ-REC-11).
const { record: R, work: W, runner } = F.modules;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

let botCount = 0;
function setup({ name = `rec${botCount++}`, now, init_message = null, keep = false, world, inventory, ownerAt = [0, 64, 0] } = {}) {
    const bot = F.makeBot({ world, inventory });
    if (ownerAt) F.player(bot, F.OWNER, ownerAt);
    const agent = F.makeAgent({ bot, name });
    if (!keep) F.clearRecord(agent);
    F.startWork(agent, { init_message, now });
    agents.push(agent);
    return agent;
}
const hang = agent => { agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 }); };
// A crashed process leaves its record as it was: stop the old instance's hooks
// without touching the file.
function crash(agent) {
    agent.work.dispose();
    agent.bot.interrupt_code = true;
}

test('record writes are atomic: a failed rename leaves the previous file intact', t => {
    const file = `${F.runtime}/atomic/task.json`;
    const record = R.newRecord({ objective: 'a', request_text: null, requested_by: F.OWNER, anchor: null, steps: [] });
    R.saveRecord(file, record);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(JSON.parse(before).revision, 1);
    t.mock.method(fs, 'renameSync', () => { throw new Error('disk full'); });
    syncBuiltinESMExports();
    try {
        record.objective = 'b';
        assert.throws(() => R.saveRecord(file, record), /disk full/);
    } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    }
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    R.saveRecord(file, record);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).objective, 'b');
    assert.deepEqual(fs.readdirSync(`${F.runtime}/atomic`), ['task.json']);
});

test('a record with an unknown version, or unreadable, is left untouched and no task starts', t => {
    t.mock.method(console, 'warn', () => {});
    for (const content of [JSON.stringify({ version: 99, status: 'active' }), '{not json']) {
        const bot = F.makeBot();
        const agent = F.makeAgent({ bot, name: 'oldversion' });
        fs.mkdirSync(F.recordFile(agent).replace(/task\.json$/, ''), { recursive: true });
        fs.writeFileSync(F.recordFile(agent), content);
        F.startWork(agent, { init_message: W.RESTART_MESSAGE });
        agents.push(agent);
        assert.equal(agent.work.record, null);
        assert.equal(fs.readFileSync(F.recordFile(agent), 'utf8'), content);
        agent.work.dispose();
    }
});

test('every lifecycle transition (SPEC §6.4)', async () => {
    const allowed = {
        active: ['paused', 'blocked', 'done', 'failed', 'cancelled'],
        paused: ['active', 'failed', 'cancelled'],
        blocked: ['active', 'failed', 'cancelled'],
        done: [], failed: [], cancelled: [],
    };
    const states = Object.keys(allowed);
    for (const from of states) for (const to of states) {
        const record = { id: 'x', status: from };
        if (allowed[from].includes(to)) assert.equal(R.setStatus(record, to, 'r').status, to);
        else assert.throws(() => R.setStatus(record, to), /illegal transition/, `${from} -> ${to}`);
    }
    // Through the commands and events that cause them.
    const agent = setup();
    hang(agent);
    const w = agent.work;
    assert.equal(w.startTask('walk', 'go_to target=40,64,0').ok, true);
    assert.equal(w.record.status, 'active');
    assert.equal(w.record.cursor, 0);
    await F.until(() => w.runner.executing);
    await w.pauseTask();
    assert.deepEqual([w.record.status, w.record.reason], ['paused', 'command']);
    assert.equal(w.resumeTask().ok, true);
    assert.equal(w.record.status, 'active');
    await F.until(() => w.runner.executing);
    w.blockStep(w.record.plan[0], 'fixture blocker');
    assert.deepEqual([w.record.status, w.record.reason], ['blocked', 'fixture blocker']);
    assert.equal((await w.reviseTask(1, 'go_to target=41,64,0')).ok, true);
    assert.equal(w.record.status, 'active');
    await w.cancelTask();
    assert.deepEqual([w.record.status, w.record.reason], ['cancelled', 'command']);
    assert.equal(F.readRecord(agent).status, 'cancelled');

    const done = setup();
    done.work.startTask('here', 'go_to target=0,64,0');
    await F.until(() => done.work.record.status === 'done');
    const failed = setup();
    hang(failed);
    failed.work.startTask('walk', 'go_to target=40,64,0');
    failed.work.fail('fixture failure');
    assert.deepEqual([failed.work.record.status, failed.work.record.reason], ['failed', 'fixture failure']);
    assert.equal(failed.work.cancelTask instanceof Function, true);
    assert.equal((await failed.work.cancelTask()).ok, false); // terminal stays terminal
});

test('!taskRevise keeps done steps and replaces unfinished ones from from_step', async () => {
    const agent = setup();
    hang(agent);
    agent.bot.hooks.goto = goal => goal.x === 40 ? F.until(() => agent.bot.interrupt_code, { timeout: 60000 }) : null;
    const w = agent.work;
    w.startTask('two walks', 'go_to target=0,64,0; go_to target=40,64,0');
    await F.until(() => w.record.plan[0].status === 'done' && w.runner.executing);
    assert.match((await w.reviseTask(1, 'go_to target=5,64,0')).message, /from_step must be 2 to 3/);
    const revised = await w.reviseTask(2, 'go_to target=3,64,0; go_to target=4,64,0');
    assert.equal(revised.ok, true);
    assert.deepEqual(w.record.plan.map(s => [s.n, s.args.target.x, s.status]).slice(0, 1), [[1, 0, 'done']]);
    assert.deepEqual(w.record.plan.map(s => s.args.target.x), [0, 3, 4]);
    await F.until(() => w.record.status === 'done');
    assert.match((await w.reviseTask(4, 'go_to target=0,64,0')).message, /no task to revise/);
});

test('crash restart resumes the active task with zero model calls', async () => {
    const world = new F.World();
    F.tree(world, 3, 64, 0, 4);
    const first = setup({ name: 'crashbot', world });
    first.bot.hooks.collect = () => F.until(() => first.bot.interrupt_code, { timeout: 60000 });
    first.work.startTask('4 oak planks', 'obtain item=oak_planks count=4');
    await F.until(() => first.bot.calls.some(c => c[0] === 'collect'));
    crash(first);

    const world2 = new F.World();
    F.tree(world2, 3, 64, 0, 4);
    const second = setup({ name: 'crashbot', world: world2, keep: true, init_message: W.RESTART_MESSAGE });
    // The agent's own start-up path sends no restart inference when memory was
    // loaded and the self-prompter is stopped (agent.js:214-216).
    second.bot.autoEat = {};
    await F.modules.Agent.prototype._setupEventHandlers.call(second, { self_prompt: null, turns: [] }, W.RESTART_MESSAGE);
    await F.until(() => second.work.record.status === 'done');
    assert.equal(second.bot.count('oak_planks'), 4);
    assert.equal(second.modelCalls, 0);
});

test('a fresh start loads an active task as paused', () => {
    const first = setup({ name: 'freshbot' });
    hang(first);
    first.work.startTask('walk', 'go_to target=40,64,0');
    crash(first);
    for (const init_message of [null, '', 'Respond with hello world and your name']) {
        F.recordFile(first);
        const record = F.readRecord(first);
        record.status = 'active';
        record.reason = null;
        R.saveRecord(F.recordFile(first), record);
        const again = setup({ name: 'freshbot', keep: true, init_message });
        assert.deepEqual([again.work.record.status, again.work.record.reason], ['paused', 'fresh_start']);
        assert.equal(again.actions.resume_func, null);
        again.work.dispose();
    }
});

test('SIGINT writes clean_stop and re-raises; the next start (even "Agent process restarted.") is fresh and clears it; a later crash resumes', async () => {
    const name = 'sigintbot';
    const probe = F.makeAgent({ bot: F.makeBot(), name });
    F.clearRecord(probe);
    const child = spawn(process.execPath, ['--experimental-test-module-mocks', new URL('./s2/sigint-child.mjs', import.meta.url).pathname], {
        env: { ...process.env, WORK_TEST_RUNTIME: F.runtime, WORK_TEST_BOT: name }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', () => {});
    await F.until(() => out.includes('ready'), { timeout: 20000 });
    const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    child.kill('SIGINT');
    assert.deepEqual(await exited, { code: null, signal: 'SIGINT' }); // the parent still sees the signal
    const stopped = F.readRecord(probe);
    assert.deepEqual([stopped.status, stopped.clean_stop], ['active', true]);
    // The placements ledger is flushed on SIGINT too (REQ-OWN-1).
    assert.deepEqual(F.readLedger(probe).entries.map(e => e.block), ['oak_planks']);

    const restarted = setup({ name, keep: true, init_message: W.RESTART_MESSAGE });
    assert.deepEqual([restarted.work.record.status, restarted.work.record.reason], ['paused', 'fresh_start']);
    assert.equal(F.readRecord(restarted).clean_stop, false); // cleared right after it was read
    hang(restarted);
    restarted.work.resumeTask();
    await F.until(() => restarted.work.runner.executing);
    crash(restarted);
    const crashed = setup({ name, keep: true, init_message: W.RESTART_MESSAGE });
    hang(crashed);
    assert.equal(crashed.work.record.status, 'active');
    await F.until(() => crashed.work.runner.executing);
    await crashed.work.cancelTask();
});

test('stall rule: resets on improvement, carries across a restart, ignores downtime, blocks at 600 s with the last cause', async () => {
    const c = F.clock();
    const agent = setup({ name: 'stallbot', now: c.now });
    hang(agent);
    const w = agent.work;
    w.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => w.runner.executing);
    const step = () => w.record.plan[0];
    c.advance(200);
    w.save();
    assert.equal(step().progress.stalled_s, 200);
    // Improvement on best resets it.
    assert.equal(runner.updateProgress(step(), { now: 30, target: 0, score: step().progress.best + 5 }, c.now()), true);
    assert.equal(step().progress.stalled_s, 0);
    c.advance(300);
    step().progress.last_cause = 'zombie interruption';
    w.save();
    assert.equal(step().progress.stalled_s, 300);
    crash(agent);

    c.advance(5000); // the process is down: not counted
    const again = setup({ name: 'stallbot', keep: true, now: c.now, init_message: W.RESTART_MESSAGE });
    hang(again);
    await F.until(() => again.work.runner.executing);
    assert.equal(again.work.record.plan[0].progress.stalled_s, 300);
    c.advance(299);
    again.work.save();
    assert.equal(again.work.record.status, 'active');
    c.advance(1);
    again.work.save();
    assert.equal(again.work.record.status, 'blocked');
    assert.equal(again.work.record.reason, 'no progress for 10 min; last: zombie interruption');
});

test('stall rule: constant combat with progress never blocks; a crash loop blocks', async () => {
    const c = F.clock();
    const fighter = setup({ name: 'fighter', now: c.now });
    hang(fighter);
    fighter.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => fighter.work.runner.executing);
    const step = fighter.work.record.plan[0];
    for (let i = 0; i < 30; i++) {
        c.advance(100);
        step.progress.last_cause = 'zombie interruption';
        runner.updateProgress(step, { now: 30 - i, target: 0, score: step.progress.best + 1 }, c.now());
        fighter.work.save();
    }
    assert.equal(fighter.work.record.status, 'active'); // 3000 s of combat, progress all along
    await fighter.work.cancelTask();

    const looping = setup({ name: 'looper', now: c.now });
    hang(looping);
    looping.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => looping.work.runner.executing);
    let current = looping;
    for (let restarts = 0; restarts < 10 && current.work.record.status === 'active'; restarts++) {
        c.advance(90);
        current.work.save();
        crash(current);
        c.advance(30); // down: ignored
        current = setup({ name: 'looper', keep: true, now: c.now, init_message: W.RESTART_MESSAGE });
        hang(current);
        await F.until(() => current.work.runner.executing || current.work.record.status !== 'active');
    }
    current.work.save();
    assert.equal(current.work.record.status, 'blocked');
    assert.match(current.work.record.reason, /^no progress for 10 min/);
});

test('anchor: here is the owner when tracked, else the bot; frozen through revisions and restarts', async () => {
    const tracked = setup({ name: 'anchorbot', ownerAt: [12, 70, -3] });
    tracked.bot.hooks.goto = goal => goal.x === 40 ? F.until(() => tracked.bot.interrupt_code, { timeout: 60000 }) : null;
    tracked.work.startTask('come here', 'go_to target=here; go_to target=40,64,0');
    const anchor = tracked.work.record.anchor;
    assert.deepEqual(anchor, { x: 12, y: 70, z: -3, dim: 'overworld', given: 'here' });
    assert.deepEqual(tracked.work.record.plan[0].args.target, anchor);
    tracked.bot.players[F.OWNER].entity.position = new F.Vec3(100, 64, 100); // the owner walks off
    await F.until(() => tracked.work.record.cursor === 1 && tracked.work.runner.executing);
    await tracked.work.reviseTask(2, 'obtain item=oak_log count=1; go_to target=40,64,0');
    assert.deepEqual(tracked.work.record.anchor, anchor);
    crash(tracked);
    const again = setup({ name: 'anchorbot', keep: true, init_message: W.RESTART_MESSAGE, ownerAt: [-50, 64, 9] });
    assert.deepEqual(again.work.record.anchor, anchor);
    assert.deepEqual(again.work.record.plan[0].args.target, anchor);
    await again.work.cancelTask();

    const untracked = setup({ ownerAt: null });
    untracked.bot.entity.position = new F.Vec3(7.6, 63, 2.2);
    untracked.work.startTask('here', 'go_to target=here');
    assert.deepEqual(untracked.work.record.anchor, { x: 7, y: 63, z: 2, dim: 'overworld', given: 'here' });
    await F.until(() => untracked.work.record.status === 'done');
    assert.match(untracked.work.startTask('x', 'go_to target=owner').message, /owner is not in view/);
});

test('the request kind path carries the active task id; finished tasks carry none', async () => {
    const agent = setup();
    hang(agent);
    assert.equal(agent.work.taskId(), null);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    const id = agent.work.record.id;
    assert.equal(agent.work.taskId(), id);
    await agent.work.pauseTask();
    assert.equal(agent.work.taskId(), id); // paused is still the task's time
    await agent.work.cancelTask();
    assert.equal(agent.work.taskId(), null);
});

test('summary cap honours memory_max_chars (default 1000)', async () => {
    const { History } = await import('../src/agent/history.js');
    const summarize = async limit => {
        F.useSettings(limit ? { memory_max_chars: limit } : {});
        const history = Object.create(History.prototype);
        history.agent = { prompter: { promptMemSaving: async () => 'm'.repeat(5000) } };
        return (await history.summarizeMemories([])).length;
    };
    assert.equal(await summarize(null), 1000);
    assert.equal(await summarize(1200), 1200);
});

test('$SELF_PROMPT shows the task view while a record exists, else the upstream text', async () => {
    const { Prompter } = await import('../src/models/prompter.js');
    const agent = setup();
    const prompter = Object.create(Prompter.prototype);
    prompter.agent = agent;
    const selfPrompt = () => prompter.replaceStrings('$SELF_PROMPT', []);
    assert.match(await selfPrompt(), /^You currently have no active persistent goal/);
    hang(agent);
    agent.work.startTask('walk east', 'go_to target=40,64,0');
    await F.until(() => agent.work.record.plan[0].progress);
    const view = await selfPrompt();
    assert.match(view, /^CURRENT TASK \(active\): "walk east"\. Step 1\/1: go_to \(40, 64, 0\), \d+ blocks to go\./);
    assert.match(view, /do not use !goal/);
    assert.ok(view.length <= 701);
    await agent.work.cancelTask();
    assert.match(await selfPrompt(), /^LAST TASK \(cancelled: command\): "walk east"\. No task is active now/);
    agent.self_prompter.state = 1; // a !goal self-prompt runs: its text wins over a finished task
    agent.self_prompter.prompt = 'build a hut';
    assert.equal(await selfPrompt(), 'YOUR CURRENT ASSIGNED GOAL: "build a hut"\n');
    agent.self_prompter.state = 0;
});

test("agent.js startEvents builds the task layer with the process's init_message", async t => {
    for (const [init_message, status] of [[W.RESTART_MESSAGE, 'active'], [null, 'paused']]) {
        const first = setup({ name: 'eventsbot' });
        hang(first);
        first.work.startTask('walk', 'go_to target=40,64,0');
        crash(first);
        const bot = F.makeBot();
        const agent = F.makeAgent({ bot, name: 'eventsbot' });
        agents.push(agent);
        agent.npc = { init() {} };
        // Hold back upstream's endless update loop and idle resume (setTimeout);
        // the crash restart's own run is scheduled the same way.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        try {
            F.modules.Agent.prototype.startEvents.call(agent, init_message);
        } finally {
            t.mock.timers.reset();
        }
        assert.ok(agent.work instanceof W.Work);
        assert.equal(agent.work.record.status, status, String(init_message));
        agent.work.dispose();
    }
});

// --- fix wave 1 ------------------------------------------------------------

test('owner !stop cancels any non-terminal task, written before the action shutdown is awaited (F8)', async () => {
    const stop = F.modules.commands.getCommand('!stop');
    // paused and blocked
    const paused = setup();
    hang(paused);
    paused.work.startTask('walk', 'go_to target=40,64,0');
    await paused.work.pauseTask();
    await F.ownerSays(paused, '!stop');
    assert.deepEqual([paused.work.record.status, paused.work.record.reason], ['cancelled', 'stop']);
    const blocked = setup();
    blocked.work.startTask('logs', 'obtain item=oak_log count=1'); // no tree: blocks
    await F.until(() => blocked.work.record.status === 'blocked');
    await F.ownerSays(blocked, '!stop');
    assert.equal(F.readRecord(blocked).status, 'cancelled');
    // active, while the action shutdown never finishes (the 10 s stop watchdog case)
    const active = setup();
    hang(active);
    active.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => active.work.runner.executing);
    active.actions.stop = () => new Promise(() => {});
    stop.perform(active); // not awaited: it never returns
    assert.deepEqual([F.readRecord(active).status, F.readRecord(active).reason], ['cancelled', 'stop']);
    active.bot.interrupt_code = true;
});

test('startup clears clean_stop and pauses in one write: a crash after it cannot revive the task (F9)', t => {
    const first = setup({ name: 'onewrite' });
    hang(first);
    first.work.startTask('walk', 'go_to target=40,64,0');
    crash(first);
    const file = F.recordFile(first);
    const record = F.readRecord(first);
    record.clean_stop = true;
    R.saveRecord(file, record);
    let writes = 0;
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (...args) => {
        if (++writes > 1) throw new Error('crash after the first write');
        return rename(...args);
    });
    syncBuiltinESMExports();
    try {
        try { setup({ name: 'onewrite', keep: true }); } catch { /* a crash at the second write */ }
    } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    }
    const after = F.readRecord(first);
    assert.equal(writes, 1);
    assert.deepEqual([after.status, after.reason, after.clean_stop], ['paused', 'fresh_start', false]);
});

test('a finished task\'s view keeps the "do not resume" guidance (F22); every view is clipped to 700 characters', () => {
    const record = R.newRecord({ objective: 'o'.repeat(900), request_text: null, requested_by: F.OWNER, anchor: null,
        steps: [{ skill: 'obtain', args: { item: 'oak_log', count: 3 } }] });
    const view = F.modules.view.renderView(record, { bot: F.makeBot() });
    assert.equal(view.length, 700);
    assert.ok(view.endsWith('…'));
    record.objective = 'logs';
    record.status = 'done';
    assert.match(F.modules.view.renderView(record, { bot: F.makeBot() }),
        /Do not resume a goal that was stopped or ended, or a task that appears only in your memory summary, unless the owner asks again\./);
});

test('!stop still stops the bot when the cancelled task cannot be written (G1)', async t => {
    const agent = setup();
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => agent.work.runner.executing);
    const errors = t.mock.method(console, 'error', () => {});
    t.mock.method(fs, 'renameSync', () => { throw new Error('ENOSPC'); });
    syncBuiltinESMExports();
    try {
        assert.equal(await F.modules.commands.getCommand('!stop').perform(agent), 'Agent stopped.');
    } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    }
    assert.equal(agent.stop_epoch, 1);
    await F.until(() => !agent.work.runner.executing);
    assert.equal(errors.mock.calls.filter(c => /!stop: could not write/.test(String(c.arguments[0]))).length, 1);
});

test('a finished obtain task\'s view shows what the bot holds now (a repeat was once answered "done" from memory)', () => {
    const record = R.newRecord({ objective: '40 oak planks', request_text: null, requested_by: F.OWNER, anchor: null,
        steps: [{ skill: 'obtain', args: { item: 'oak_planks', count: 40 } }] });
    record.status = 'done';
    const bot = F.makeBot({ inventory: { oak_planks: 3 } });
    const view = F.modules.view.renderView(record, { bot });
    assert.match(view, /^LAST TASK \(done\): "40 oak planks"\. You hold now: 3 oak_planks\. No task is active now/);
});

test('a finished task\'s guidance survives a long objective: the variable text is clipped first (G10)', () => {
    const record = R.newRecord({ objective: 'o'.repeat(680), request_text: null, requested_by: F.OWNER, anchor: null, steps: [] });
    record.status = 'done';
    const view = F.modules.view.renderView(record, { bot: F.makeBot() });
    assert.ok(view.length <= 700, String(view.length));
    assert.match(view, /Do not resume a goal that was stopped or ended, or a task that appears only in your memory summary, unless the owner asks again\. Every new gathering, crafting or delivery request, even one that repeats the last task, is new work: start it with !taskStart\. Never say something is done unless your inventory shows it now\.$/);
});
