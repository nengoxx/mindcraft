import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2c-fu: quiet chat (SPEC REQ-CHAT-1, 2) through the real agent.js chat
// path: the real openChat (its gate) and routeResponse, capturing
// bot.whisper; prompter.work_config set; show_command_syntax "full" (the
// owner's setting), so the quiet branch must replace the whole dispatch.
const { Agent, work: W } = F.modules;
const chat = await import('../src/agent/work/chat.js');
const agents = [];
const stops = [];
after(() => { stops.forEach(stop => stop()); F.cleanup(agents); });
beforeEach(() => F.useSettings({ show_command_syntax: 'full' }));

const at = (x, y, z) => new F.Vec3(x, y, z);
const MARKER = 'stripped_spruce_wood';
const OWNER_AT = [6, 64, 6];

function site({ markers = false } = {}) {
    const world = new F.World();
    world.fill(-6, 62, -6, 10, 63, 8, 'dirt');
    world.fill(2, 64, 0, 4, 66, 2, 'stone');
    if (markers) for (const x of [1, 5]) for (const y of [63, 67]) for (const z of [-1, 3]) world.set(x, y, z, MARKER);
    return world;
}

let n = 0;
function setup({ mode = 'quiet', replies = [], world = site(), drive = false } = {}) {
    const bot = F.makeBot({ world, inventory: { wooden_pickaxe: 1 }, position: [0.5, 64, 1.5] });
    F.player(bot, F.OWNER, OWNER_AT);
    const agent = F.makeAgent({ bot, replies, work: { chat: mode, clear: { marker_radius: 12 } }, name: `chat${n++}` });
    // The real agent.js chat path instead of the fixture's capture.
    delete agent.openChat;
    delete agent.routeResponse;
    delete agent.cleanKill;
    F.clearRecord(agent);
    F.startWork(agent);
    agent.work.lineGapMs = 5;
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}
// What the owner saw (openChat appends a space after a line with no command).
const seen = agent => agent.bot.calls.filter(c => c[0] === 'whisper').map(c => c[2].trim());
const until = (agent, line) => F.until(() => seen(agent).includes(line), { timeout: 4000 });
const hang = agent => { agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 }); };

test('the switch: work.chat quiet (default) or debug; an unknown value means quiet and is logged once', () => {
    assert.equal(F.modules.config.WORK_DEFAULTS.chat, 'quiet');
    assert.equal(chat.chatMode({ prompter: { work_config: F.modules.config.loadWorkConfig() } }), 'quiet');
    const warn = mock.method(console, 'warn', () => {});
    try {
        const loud = { prompter: { work_config: { chat: 'loud' } } };
        assert.equal(chat.chatMode(loud), 'quiet');
        assert.equal(chat.chatMode(loud), 'quiet');
        assert.equal(warn.mock.calls.filter(c => /unknown work.chat "loud"/.test(c.arguments[0])).length, 1);
    } finally {
        warn.mock.restore();
    }
    const debug = { prompter: { work_config: { chat: 'debug' } } };
    for (const category of chat.CATEGORIES) assert.equal(chat.chatShown(debug, category), true);
    const quiet = { prompter: { work_config: { chat: 'quiet' } } };
    assert.deepEqual(chat.CATEGORIES.map(c => chat.chatShown(quiet, c)), [true, true, true, true, false]);
    assert.equal(chat.chatShown(quiet), false);   // an untagged line is detail
});

test('an owner turn: the text of every response is shown (a query, then the answer at i=1), never the command syntax; debug shows today\'s full lines', async () => {
    for (const mode of ['quiet', 'debug']) {
        const agent = setup({ mode, replies: ['Let me look. !blockPositions("stone", 4)', 'The stone is right next to me.'] });
        await F.ownerSays(agent, 'where is the stone?');
        await until(agent, 'The stone is right next to me.');
        assert.deepEqual(seen(agent), mode === 'quiet'
            ? ['Let me look.', 'The stone is right next to me.']
            : ['Let me look. !blockPositions("stone", 4)', 'The stone is right next to me.']);
    }
});

test('her own turns: text before a command is dropped (and logged), a reply with no command and the text before !endGoal are shown', async () => {
    const agent = setup({ replies: ['I will look around. !blockPositions("stone", 4)', '', 'Hello there.', 'The goal is done. !endGoal'] });
    const log = mock.method(console, 'log');
    try {
        await agent.handleMessage('system', 'Look around.');
        assert.ok(log.mock.calls.some(c => c.arguments[0] === '[chat] quiet: dropped (detail): I will look around.'));
    } finally {
        log.mock.restore();
    }
    assert.deepEqual(seen(agent), []);
    await agent.handleMessage('system', 'Say hello.');
    await agent.handleMessage(agent.name, 'Finish the goal.');
    assert.deepEqual(seen(agent), ['Hello there.', 'The goal is done.']);
});

test('a blocked-report turn is shown (the relay and the task receipt); the second block of a step is one code alert line, once', async () => {
    const agent = setup({ replies: ["I can't get there: no path.", '', '', '!taskCancel', ''] });
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');     // her own task
    const work = agent.work;
    work.blockStep(work.record.plan[0], 'no path');
    await until(agent, "I can't get there: no path.");
    await F.sleep(40);
    assert.deepEqual(seen(agent), ["I can't get there: no path."]);          // not at the first block
    work.resumeTask();                                        // blocked a second time, resumed between
    work.blockStep(work.record.plan[0], 'no path');
    await until(agent, 'Step 1 blocked again: no path.');     // at exactly the second
    await F.until(() => agent.modelCalls === 2);
    work.resumeTask();                                        // and a third: no second alert
    work.blockStep(work.record.plan[0], 'no path');
    await F.until(() => agent.modelCalls === 3);
    await F.sleep(40);
    assert.deepEqual(seen(agent), ["I can't get there: no path.", 'Step 1 blocked again: no path.']);
    assert.deepEqual(F.readRecord(agent).blocks_by_step, { 1: 3 });   // persisted
    // A revision of that ordinal with the same step keeps the count; a changed one resets it.
    await work.reviseTask(1, 'go_to target=40,64,0');
    assert.deepEqual(work.record.blocks_by_step, { 1: 3 });
    await work.reviseTask(1, 'go_to target=30,64,0');
    assert.deepEqual(work.record.blocks_by_step, {});
    // A task receipt in a blocked-report turn follows the relay (`reply`).
    await F.until(() => work.runner.executing);
    work.blockStep(work.record.plan[0], 'no path');
    agent.bot.interrupt_code = true;                          // the run ends; the report goes after it
    await until(agent, 'Task cancelled: "walk".');
    assert.deepEqual(work.record.blocks_by_step, { 1: 1 });
});

test('the block count survives a revision that only reorders a step\'s args (S2); a changed value resets it', async () => {
    const agent = setup();
    hang(agent);
    const work = agent.work;
    work.startTask('dirt', 'obtain item=dirt count=1');
    work.pause('command');
    work.record.blocks_by_step = { 1: 1 };
    await work.reviseTask(1, 'obtain count=1 item=dirt');
    assert.deepEqual(work.record.blocks_by_step, { 1: 1 });
    await work.reviseTask(1, 'obtain count=2 item=dirt');
    assert.deepEqual(work.record.blocks_by_step, {});
});

test('every raw owner task command is answered in quiet; the echo is not; the model\'s task lines in her own turns are dropped', async () => {
    const agent = setup();
    hang(agent);
    await F.ownerSays(agent, '!taskStart("walk", "go_to target=40,64,0")');
    await F.ownerSays(agent, '!taskPause');
    await F.ownerSays(agent, '!taskResume');
    await F.ownerSays(agent, '!taskRevise(1, "go_to target=30,64,0")');
    await F.ownerSays(agent, '!taskCancel');
    await F.ownerSays(agent, '!noSuchCommand');
    await F.ownerSays(agent, '!blockPositions("stone", 4)');   // a query's result (agent.js :306)
    assert.equal(seen(agent).length, 7);
    assert.match(seen(agent).at(-1), /stone/);
    assert.deepEqual(seen(agent).slice(0, 6), [
        'Task started: "walk" (1 step).',
        'Task paused: "walk". !taskResume continues it.',
        'Task resumed: "walk".',
        'Task revised from step 1: now 1 step.',
        'Task cancelled: "walk".',
        "Command '!noSuchCommand' does not exist.",
    ]);
    const model = setup({ replies: ['!taskStart("walk", "go_to target=40,64,0")', ''] });
    hang(model);
    await model.handleMessage('system', 'Walk over there.');
    assert.equal(model.work.record.status, 'active');
    assert.deepEqual(seen(model), []);
    assert.ok(model.turns.some(t => t.content === 'Task started: "walk" (1 step).'));   // the history keeps it
    await model.work.cancelTask();
});

test('a markers= box statement is shown alone as an alert, whoever started the task; the start line follows the turn', async () => {
    const agent = setup({ world: site({ markers: true }), replies: [`!taskStart("clear the cube", "clear markers=${MARKER}")`, ''] });
    hang(agent);
    agent.bot.hooks.dig = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 });
    await agent.handleMessage('system', 'Clear the marked cube.');
    const statement = 'Clearing x 2..4, y 64..66, z 0..2: 27 cells inside the marked box; its outer layer stays.';
    assert.deepEqual(seen(agent), [statement]);
    assert.ok(agent.turns.some(t => t.content === `Task started: "clear the cube" (1 step). ${statement}`));
    await agent.work.cancelTask();
});

test('a dropped line does not disarm the open question; a shown one does (debug)', async () => {
    for (const mode of ['quiet', 'debug']) {
        const agent = setup({ mode, drive: true });
        agent.work.startTask('clear the box', 'clear box=2,64,0:4,66,2');
        await F.until(() => agent.work.armed && agent.work.armed === agent.work.record.pending_question?.id, { timeout: 4000 });
        const id = agent.work.armed;
        agent.openChat('I am waiting here.');                  // detail, outside any turn
        assert.equal(agent.work.armed, mode === 'quiet' ? id : null);
        await agent.work.cancelTask();
    }
});

test('the done line: one short line only for a task the owner asked for (a clear keeps its whole report); none for her own', async () => {
    const owner = setup();
    await F.ownerSays(owner, '!taskStart("walk", "go_to target=3,64,0")');
    assert.equal(owner.work.record.notify_done, true);
    await until(owner, 'Task done: "walk".');
    const own = setup();
    own.work.startTask('walk', 'go_to target=3,64,0');
    assert.equal(own.work.record.notify_done, false);
    await F.until(() => own.work.record.status === 'done');
    await F.until(() => own.turns.some(t => /^Task done: "walk"\. 1\. go_to/.test(t.content)));   // history keeps the report
    await F.sleep(30);
    assert.deepEqual(seen(own), []);
    // An owner's resume makes it his task; a record from before the field is judged at done time.
    hang(own);
    own.work.startTask('walk far', 'go_to target=40,64,0');
    await own.work.pauseTask();
    await F.ownerSays(own, '!taskResume');
    assert.equal(own.work.record.notify_done, true);
    await own.work.cancelTask();
    // So does an owner's revision.
    own.work.startTask('walk far', 'go_to target=40,64,0');
    await own.work.pauseTask();
    assert.equal(own.work.record.notify_done, false);
    await F.ownerSays(own, '!taskRevise(1, "go_to target=41,64,0")');
    assert.equal(own.work.record.notify_done, true);
    await own.work.cancelTask();
    own.bot.hooks.goto = null;
    own.bot.interrupt_code = false;
    own.work.startTask('walk back', 'go_to target=0,64,1');
    delete own.work.record.notify_done;
    own.work.write();                                         // the run reloads the record from disk
    assert.equal(own.work.record.requested_by, F.OWNER);
    await until(own, 'Task done: "walk back".');
    assert.equal('notify_done' in F.readRecord(own), false);   // judged, not written back
});

test('in quiet a clear the owner asked for ends with its whole report, not the short line', async () => {
    const agent = setup({ world: site({ markers: true }) });
    await F.ownerSays(agent, `!taskStart("clear the cube", "clear markers=${MARKER}")`);
    await F.until(() => agent.work.record.status === 'done', { timeout: 8000 });
    await F.until(() => seen(agent).some(l => l.startsWith('Task done: "clear the cube".')), { timeout: 4000 });
    await F.sleep(40);
    const done = seen(agent).filter(l => l.startsWith('Task done: "clear the cube"'));
    assert.ok(done.length === 1 && done[0] !== 'Task done: "clear the cube".', seen(agent).join('\n'));
});

test('in quiet the outage notice, its recovery and a task failure are alerts (shown)', async () => {
    const { ModelOutage, outageNotice, RECOVERY_NOTICE } = F.modules.outage;
    const agent = setup();
    const outage = new ModelOutage(agent, F.modules.config.loadWorkConfig({}));
    outage.down('ECONNREFUSED');
    outage.up();
    await until(agent, RECOVERY_NOTICE.trim());
    assert.deepEqual(seen(agent), [outageNotice('ECONNREFUSED').trim(), RECOVERY_NOTICE.trim()]);
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');     // her own task
    await F.until(() => agent.work.runner.executing);
    agent.work.fail('the way is gone');
    await F.until(() => seen(agent).some(l => l.startsWith('Task failed: "walk": the way is gone.')), { timeout: 4000 });
    agent.bot.interrupt_code = true;
});

test('a task started in the blocked-report turn about an owner\'s task is his (notify_done inherited); about her own, not (G3)', async () => {
    for (const ownerTask of [true, false]) {
        const agent = setup({ replies: ['!taskStart("walk back", "go_to target=0,64,1")', ''] });
        hang(agent);
        if (ownerTask) await F.ownerSays(agent, '!taskStart("walk", "go_to target=40,64,0")');
        else agent.work.startTask('walk', 'go_to target=40,64,0');
        await F.until(() => agent.work.runner.executing);
        agent.work.blockStep(agent.work.record.plan[0], 'no path');
        agent.bot.interrupt_code = true;
        await F.until(() => agent.work.record.objective === 'walk back', { timeout: 4000 });
        assert.equal(agent.work.record.notify_done, ownerTask);
        await agent.work.cancelTask();
    }
});

test('an owner question answered after a goal\'s single query response: the next model response is his answer, once; only while a goal runs (G1, A1)', async () => {
    const agent = setup({ replies: ['!blockPositions("stone", 4)', 'The stone is right next to me. !blockPositions("stone", 2)', 'Looking again. !blockPositions("stone", 1)', ''] });
    agent.self_prompter.isActive = () => true;               // a goal runs: agent.js answers the owner with one response
    await F.ownerSays(agent, 'where is the stone?');
    assert.deepEqual(seen(agent), []);
    assert.equal(agent.work.answerPending, true);
    await agent.handleMessage(agent.name, 'Continue the goal.');
    await until(agent, 'The stone is right next to me.');
    assert.equal(agent.work.answerPending, false);
    await F.sleep(40);
    assert.deepEqual(seen(agent), ['The stone is right next to me.']);   // "Looking again." is her own again
    // A1: with no goal running, a silent owner turn leaves nothing pending.
    const free = setup({ replies: ['!blockPositions("stone", 4)', '', 'I will go and get wood. !blockPositions("stone", 2)', ''] });
    await F.ownerSays(free, 'what is around you?');
    assert.equal(free.work.answerPending, false);
    await free.handleMessage(free.name, 'Continue.');
    await F.sleep(40);
    assert.deepEqual(seen(free), []);
    // The pending answer does not outlive one response: a command-only
    // response takes it, and the next one's text is her own again.
    const once = setup({ replies: ['!blockPositions("stone", 4)', '!blockPositions("stone", 3)', 'Heading to the cave now. !blockPositions("stone", 2)', ''] });
    once.self_prompter.isActive = () => true;
    await F.ownerSays(once, 'where is the stone?');
    assert.equal(once.work.answerPending, true);
    await once.handleMessage(once.name, 'Continue the goal.');
    assert.equal(once.work.answerPending, false);
    await F.sleep(40);
    assert.deepEqual(seen(once), []);
    // An owner turn that shows a line leaves nothing pending; a raw command
    // that shows nothing neither (no model call), nor an answer code consumes.
    const shown = setup({ replies: ['Hello.'] });
    shown.self_prompter.isActive = () => true;
    await F.ownerSays(shown, 'hi');
    assert.equal(shown.work.answerPending, false);
    const stats = F.modules.commands.getCommand('!stats');
    const silent = mock.method(stats, 'perform', async () => undefined);
    try {
        shown.work.answerPending = true;
        await F.ownerSays(shown, '!stats');
        assert.equal(shown.work.answerPending, false);
    } finally {
        silent.mock.restore();
    }
    const asked = setup({ drive: true });
    asked.self_prompter.isActive = () => true;
    asked.work.startTask('clear the box', 'clear box=2,64,0:4,66,2');
    await F.until(() => asked.work.armed && asked.work.armed === asked.work.record.pending_question?.id, { timeout: 4000 });
    asked.work.answerPending = true;
    await F.ownerSays(asked, 'yes');
    assert.equal(asked.work.record.pending_question, null);
    assert.equal(asked.work.answerPending, false);
    await asked.work.cancelTask();
});

test('her death is one alert line in quiet; the task part only when it paused a task', async () => {
    const agent = setup();
    agent.bot.entity.position = new F.Vec3(10.4, 70.9, -3.2);
    agent.bot.emit('death');
    await until(agent, 'I died at 10, 70, -4.');
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    agent.bot.emit('death');
    await until(agent, 'I died at 10, 70, -4; my task is paused.');
    assert.equal(agent.work.record.reason, 'died');
});

test('the goal loop giving up is an alert, shown in quiet (self_prompter.js carry)', async () => {
    const agent = setup({ replies: ['hm', 'hm', 'hm'] });
    agent.self_prompter.start('collect wood');
    await until(agent, 'Agent did not use command in the last 3 auto-prompts. Stopping auto-prompting.');
});

test('cleanKill: no public "Restarting."/"Exiting." in quiet; debug keeps it', () => {
    const exit = mock.method(process, 'exit', () => {});
    try {
        for (const mode of ['quiet', 'debug']) {
            const agent = setup({ mode });
            agent.cleanKill('bye', 1);
            assert.deepEqual(agent.bot.calls.filter(c => c[0] === 'chat'), mode === 'quiet' ? [] : [['chat', 'Exiting.']]);
        }
    } finally {
        exit.mock.restore();
    }
});

test('turnVoice: owner (not system, not the bot itself), alert for the handed-over blocked report, own otherwise; null outside a live turn', async () => {
    const agent = setup({ replies: [] });
    const voices = [];
    agent.prompter.promptConvo = async () => { voices.push(agent.work.turnVoice()); return ''; };
    await agent.handleMessage(F.OWNER, 'hi');
    await agent.handleMessage('system', 'tick');
    await agent.handleMessage(agent.name, 'goal');
    agent.work.handoff = { message: 'Task "x" is blocked', ownerTask: true };
    await agent.handleMessage('system', 'something else');   // not the handed-over report
    assert.equal(agent.work.handoff, null);                   // consumed at the turn's entry
    assert.deepEqual(voices, ['owner', 'own', 'own', 'own']);
    assert.equal(agent.work.turnVoice(), null);
    // Code started inside the owner's turn and running after it (a timer, the
    // runner) inherits the turn's store, yet never reads as the owner's.
    let later = 'unset';
    agent.prompter.promptConvo = async () => { setTimeout(() => { later = agent.work.turnVoice(); }, 20); return ''; };
    await agent.handleMessage(F.OWNER, 'hi again');
    await F.until(() => later !== 'unset');
    assert.equal(later, null);
    agent.prompter.promptConvo = async () => { voices.push(agent.work.turnVoice()); return ''; };
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    agent.work.blockStep(agent.work.record.plan[0], 'no path');
    await F.until(() => voices.length === 5);
    assert.equal(voices[4], 'alert');
    await agent.work.cancelTask();
});
