import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: the runner and resume (SPEC §7) on the real ActionManager and modes:
// interruptions, deadlines, causes, owner chat during a run, reports.
const { work: W, mc, commands } = F.modules;
const agents = [];
const stops = [];
after(() => { stops.forEach(stop => stop()); F.cleanup(agents); });
// The give unit's confirmation wait is 30 s; tests with no pickup wait 1 s.
const GIVE = F.modules.plan.STEPS.give;
const { GIVE_CONFIRM_S } = await import('../src/agent/work/steps/give.js');
beforeEach(() => { F.useSettings(); GIVE.confirmMs = 1000; });

let n = 0;
function setup({ world, inventory, modes, work, replies, now, ownerAt = [0, 64, 0], drive = true, name, keep = false, init_message = null } = {}) {
    const bot = F.makeBot({ world, inventory });
    if (ownerAt) F.player(bot, F.OWNER, ownerAt);
    const agent = F.makeAgent({ bot, modes, work, replies, name: name ?? `runner${n++}` });
    if (!keep) F.clearRecord(agent);
    F.startWork(agent, { now, init_message });
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}
const forest = (count = 3) => {
    const world = new F.World();
    for (let i = 0; i < count; i++) F.tree(world, 3 + i * 3, 64, 0, 4);
    return world;
};
const untilInterrupted = bot => F.until(() => bot.interrupt_code, { timeout: 60000 });
const done = agent => F.until(() => agent.work.record?.status === 'done', { timeout: 8000 });

for (const night of [false, true]) {
    test(`a mode interrupt resumes with no AUTO MESSAGE and no model call${night ? ' (at night, no dig-in)' : ''}`, async () => {
        const agent = setup({ world: forest(), modes: { self_defense: true, sleeping: true } });
        const { bot } = agent;
        if (night) bot.time = { timeOfDay: 18000, isDay: false, day: 3 };
        let first = true;
        let nightAtFight = null;
        bot.hooks.collect = async () => {
            if (!first) return;
            first = false;
            nightAtFight = bot.time?.isDay === false && bot.time.timeOfDay >= 13000;
            F.hostile(bot, 'zombie', [3, 0, 0]);
            await untilInterrupted(bot); // self_defense interrupts the run
        };
        agent.work.startTask('6 oak logs', 'obtain item=oak_log count=6');
        await done(agent);
        assert.equal(nightAtFight, night); // the night variant really fights at night
        assert.equal(bot.count('oak_log'), 6);
        assert.equal(agent.modelCalls, 0);
        assert.equal(agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), false);
        const { interruptions } = agent.work.record;
        assert.equal(interruptions.count, 1);
        assert.equal(interruptions.last.by, 'mode:self_defense');
        // No dig-in: nothing was placed or dug besides the logs, and no night policy exists in I1;
        // the night's only configuration is sleeping (S2d, work.sleep), and with no bed she does not sleep.
        assert.equal(bot.calls.filter(c => c[0] === 'collect').every(c => c[1] === 'oak_log'), true);
        assert.equal(bot.calls.some(c => c[0] === 'place' || c[0] === 'dig'), false);
        const { WORK_DEFAULTS } = await import('../src/agent/work/config.js');
        assert.equal(Object.keys(WORK_DEFAULTS).some(k => /night|shelter/.test(k)), false);
        assert.deepEqual(Object.keys(WORK_DEFAULTS).filter(k => /sleep/.test(k)), ['sleep']);
    });
}

test('an interrupted run (no idle) is resumed by the self-heal timer after work.stall_s', async () => {
    const c = F.clock();
    const agent = setup({ world: forest(), now: c.now, drive: false });
    const { bot } = agent;
    let first = true;
    bot.hooks.collect = async () => {
        if (!first) return;
        first = false;
        agent.requestInterrupt();
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => !first && agent.isIdle());
    await F.sleep(60); // no idle, so Mindcraft's own resume never comes
    assert.equal(agent.work.record.status, 'active');
    assert.equal(agent.work.record.interruptions.count, 1);
    agent.work.tick();
    c.advance(14);
    agent.work.tick();
    assert.equal(agent.isIdle(), true);
    c.advance(1);
    agent.work.tick();
    await done(agent);
    assert.equal(bot.count('oak_log'), 3);
});

test('a thrown error is caught inside the run and resume_func survives', async () => {
    const agent = setup({ world: forest() });
    const { bot } = agent;
    const equip = bot.tool.equipForBlock;
    let threw = 0;
    let survived = null;
    bot.tool.equipForBlock = async block => {
        if (!threw++) throw new Error('fixture tool failure');
        survived ??= agent.actions.resume_func === agent.work.runner.runFn;
        return equip(block);
    };
    agent.work.startTask('2 oak logs', 'obtain item=oak_log count=2');
    await done(agent);
    assert.equal(survived, true);
    assert.equal(agent.work.record.plan[0].status, 'done');
});

for (const kind of ['craft', 'collect', 'go_to', 'give']) {
    test(`one no-progress deadline ends a stuck ${kind} call through requestInterrupt; the next attempt comes from the self-heal timer`, async () => {
        const inventory = kind === 'craft' ? { oak_log: 1 } : kind === 'give' ? { stick: 4 } : {};
        const agent = setup({ world: forest(1), inventory, work: { no_progress_s: 0.7, stall_s: 0.1 }, ownerAt: [20, 64, 0] });
        const { bot } = agent;
        let interrupts = 0;
        const request = agent.requestInterrupt;
        agent.requestInterrupt = function () { interrupts++; return request.call(this); };
        let stuck = true;
        const hang = async () => { if (stuck) { stuck = false; await untilInterrupted(bot); } };
        // Mineflayer's craft loop ignores interrupt_code: the stuck craft ends on its own, later.
        if (kind === 'craft') bot.hooks.craft = async () => { if (stuck) { stuck = false; await F.sleep(1500); } };
        if (kind === 'collect') bot.hooks.collect = hang;
        if (kind === 'go_to' || kind === 'give') bot.hooks.goto = hang;
        bot.hooks.toss = (name, count, entity) => setTimeout(() => bot.collect(F.OWNER, entity), 5);
        const steps = { craft: 'obtain item=oak_planks count=4', collect: 'obtain item=oak_log count=1',
            go_to: 'go_to target=20,64,0', give: `give player=${F.OWNER} item=stick count=4` }[kind];
        agent.work.startTask(kind, steps);
        await done(agent);
        assert.equal(interrupts, 1);
        const step = agent.work.record.plan[0];
        assert.equal(step.no_progress, 1);
        assert.match(step.progress.last_cause ?? '', /no progress for 0.7 s during/);
        assert.equal(agent.modelCalls, 0);
    });
}

test('the default no-progress deadline is one 120 s for every call', async () => {
    const { WORK_DEFAULTS } = await import('../src/agent/work/config.js');
    assert.equal(WORK_DEFAULTS.no_progress_s, 120);
    assert.equal(Object.keys(WORK_DEFAULTS).some(k => /craft/.test(k)), false); // no separate craft deadline
});

test('a run ends itself at the run bound, checked only between actuator calls', async () => {
    const agent = setup({ world: forest(), work: { run_deadline_s: 0.05 } });
    const { bot } = agent;
    let midCall = 0;
    bot.hooks.collect = async () => {
        await F.sleep(40);
        if (bot.interrupt_code) midCall++;
    };
    bot.hooks.craft = async () => { await F.sleep(80); if (bot.interrupt_code) midCall++; };
    const logs = [];
    const log = agent.work.log.bind(agent.work);
    agent.work.log = message => { logs.push(message); log(message); };
    agent.work.startTask('8 planks', 'obtain item=oak_planks count=8');
    await done(agent);
    assert.equal(midCall, 0); // the bound never cut a call short
    assert.ok(logs.includes('run bound reached; ending the run normally'));
    assert.ok(logs.filter(m => m.startsWith('run start')).length >= 2); // idle fired and the next run continued
    assert.equal(agent.work.record.interruptions.count, 0);
    assert.equal(bot.count('oak_planks'), 8);
});

// REQ-RES-8 as amended by REQ-CMB-8: the check is combat.threat(), so it asks
// only while self_defense is on (the modes stay undriven: nothing fights).
// The modes module drives the agent made last (modes.js `_agent`), so no
// earlier test's driver may run the mode here.
const stopDrivers = () => stops.splice(0).forEach(stop => stop());
test('resume check: refuses while a hostile within 8 has a clear path, passes once it is gone, never blocks by itself', async () => {
    stopDrivers();
    const modes = { self_defense: true };
    const agent = setup({ modes, drive: false });
    const { bot } = agent;
    const zombie = F.hostile(bot, 'zombie', [5, 0, 0]);
    agent.work.startTask('stay', 'go_to target=0,64,0');
    await F.sleep(300);
    const record = agent.work.record;
    assert.equal(record.status, 'active');
    assert.notEqual(record.plan[0].status, 'done');
    assert.match(record.plan[0].progress.last_cause, /zombie 5 blocks away/);
    delete bot.entities[zombie.id];
    await done(agent);

    const walled = setup({ modes, drive: false });
    walled.bot.hooks.noPath = true; // no clear path: the check passes
    F.hostile(walled.bot, 'zombie', [5, 0, 0]);
    walled.work.startTask('stay', 'go_to target=0,64,0');
    await done(walled);
    const far = setup({ modes, drive: false });
    F.hostile(far.bot, 'zombie', [9, 0, 0]);
    far.work.startTask('stay', 'go_to target=0,64,0');
    await done(far);
    const off = setup({ drive: false });   // self_defense off: no fight would start, the check passes (REQ-CMB-8)
    F.hostile(off.bot, 'zombie', [5, 0, 0]);
    off.work.startTask('stay', 'go_to target=0,64,0');
    await done(off);
});

test('allays and golems are not hostile; zombies and creepers are (owner ruling, P11)', () => {
    for (const name of ['allay', 'copper_golem', 'iron_golem', 'snow_golem'])
        assert.equal(mc.isHostile({ name, type: 'mob' }), false, name);
    for (const name of ['zombie', 'creeper'])
        assert.equal(mc.isHostile({ name, type: 'hostile' }), true, name);
});

const hangingSteps = {
    obtain: ['obtain item=oak_log count=2', bot => { bot.hooks.collect = () => untilInterrupted(bot); }],
    go_to: ['go_to target=30,64,0', bot => { bot.hooks.goto = () => untilInterrupted(bot); }],
    give: [`give player=${F.OWNER} item=stick count=2`, bot => { bot.hooks.goto = () => untilInterrupted(bot); }],
};
for (const [skill, [steps, hang]] of Object.entries(hangingSteps)) {
    test(`owner !stop during a ${skill} step cancels the task`, async () => {
        const agent = setup({ world: forest(1), inventory: { stick: 2 }, ownerAt: [10, 64, 0] });
        hang(agent.bot);
        agent.work.startTask(skill, steps);
        await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'collect' || c[0] === 'goto'));
        await F.ownerSays(agent, '!stop');
        await F.until(() => agent.work.record.status !== 'active');
        assert.deepEqual([agent.work.record.status, agent.work.record.reason], ['cancelled', 'stop']);
        assert.equal(agent.actions.resume_func, null);
        await F.sleep(50);
        assert.equal(agent.work.runner.executing, false); // final: nothing resumes it
    });

    test(`death during a ${skill} step pauses the task as died`, async () => {
        const agent = setup({ world: forest(1), inventory: { stick: 2 }, ownerAt: [10, 64, 0] });
        hang(agent.bot);
        agent.work.startTask(skill, steps);
        await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'collect' || c[0] === 'goto'));
        agent.bot.emit('death');
        await F.until(() => !agent.work.runner.executing);
        assert.deepEqual([agent.work.record.status, agent.work.record.reason], ['paused', 'died']);
        assert.equal(agent.work.record.interruptions.count, 0);
    });
}

test('owner chat during a run: a non-resumable chat action interrupts the runner, which resumes afterwards', async () => {
    const agent = setup({ world: forest(), replies: ['On my way! !goToPlayer("steve", 3)'], ownerAt: [-10, 64, 0] });
    const { bot } = agent;
    let first = true;
    bot.hooks.collect = async () => { if (first) { first = false; await F.sleep(150); } };
    bot.hooks.goto = goal => goal.entity?.username === F.OWNER ? F.sleep(150) : null; // the walk to the owner
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => !first);
    await F.ownerSays(agent, 'come here');
    await done(agent);
    // The command and the model's reply to its result (upstream's command loop);
    // the task itself costs none.
    assert.equal(agent.modelCalls, 2);
    assert.equal(agent.work.record.interruptions.count, 1);
    assert.equal(agent.work.record.interruptions.last.by, 'action:goToPlayer');
    assert.equal(bot.count('oak_log'), 3);
});

test('owner chat: followPlayer, a resumable action, pauses the task as replaced', async () => {
    const agent = setup({ world: forest(), ownerAt: [-10, 64, 0] });
    agent.bot.hooks.collect = () => untilInterrupted(agent.bot);
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.work.runner.executing);
    // Not awaited, as in agent.js: the forced command runs until followPlayer ends.
    const following = F.ownerSays(agent, '!followPlayer("steve", 3)');
    await F.until(() => agent.work.record.status !== 'active');
    assert.deepEqual([agent.work.record.status, agent.work.record.reason], ['paused', 'replaced: action:followPlayer']);
    await F.until(() => agent.actions.currentActionLabel === 'action:followPlayer' && agent.actions.resume_name === 'action:followPlayer');
    await agent.actions.stop();
    await following;
});

test('unstuck is paused for stationary (craft) calls, not for movement (collect) calls', async () => {
    const agent = setup({ world: forest(1), inventory: { oak_log: 1 } });
    const { bot } = agent;
    const events = [];
    const pause = bot.modes.pause.bind(bot.modes);
    const unpause = bot.modes.unpause.bind(bot.modes);
    bot.modes.pause = name => { events.push(`pause ${name}`); pause(name); };
    bot.modes.unpause = name => { events.push(`unpause ${name}`); unpause(name); };
    bot.hooks.craft = async () => { events.push('craft'); };
    bot.hooks.collect = async () => { events.push('collect'); };
    agent.work.startTask('8 planks', 'obtain item=oak_planks count=8');
    await done(agent);
    const craft = events.indexOf('craft');
    const collect = events.indexOf('collect');
    assert.ok(collect >= 0 && craft > collect);
    assert.equal(events.slice(0, collect).includes('pause unstuck'), false);
    assert.equal(events.lastIndexOf('pause unstuck', craft), craft - 1);
    assert.equal(events[craft + 1], 'unpause unstuck');
});

test('the report is posted after the run, from facts, with no nested runAction and no model call', async () => {
    const agent = setup({ world: forest(), inventory: { oak_log: 1 } });
    const actions = agent.actions;
    let nested = 0;
    const runAction = actions.runAction.bind(actions);
    actions.runAction = (...args) => { if (actions.executing && args[0] === 'action:task' && actions.currentActionLabel === 'action:task') nested++; return runAction(...args); };
    let executingAtReport = null;
    agent.openChat = message => { if (/^Task done/.test(message)) executingAtReport = actions.executing; agent.chats.push(message); };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await done(agent);
    await F.until(() => executingAtReport !== null);
    assert.equal(executingAtReport, false);
    assert.equal(nested, 0);
    assert.equal(agent.modelCalls, 0);
    const report = agent.chats.find(c => /^Task done/.test(c));
    assert.match(report, /have 3 oak_log \(target 3, had 1 at the start\)/);
    assert.match(report, /Inventory now: oak_log 3\./);
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content === report));
});

test('a blocked step costs one model call, posted after the run', async () => {
    const agent = setup({ replies: ['There are no trees here. !taskCancel'] });
    agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status === 'cancelled');
    assert.equal(agent.modelCalls, 1);
    assert.match(agent.turns.find(t => t.source === 'system' && /is blocked at step 1\/1/.test(t.content)).content,
        /none reachable: no oak_log within 64 blocks/);
});

test('go_to and give steps reach their facts', async () => {
    const agent = setup({ inventory: { stick: 5 }, ownerAt: [8, 64, 0] });
    agent.bot.hooks.toss = (name, count, entity) => setTimeout(() => agent.bot.collect(F.OWNER, entity), 5);
    agent.work.startTask('sticks for steve', `go_to target=owner; give player=${F.OWNER} item=stick count=3`);
    await done(agent);
    assert.equal(agent.bot.count('stick'), 2);
    assert.match(agent.work.record.plan[0].result, /^arrived 1 blocks from 8, 64, 0|^arrived 0 blocks/);
    assert.match(agent.work.record.plan[1].result, /steve picked up 3 stick/);
    assert.ok(commands.getCommand('!taskStart'));
});

test('after an interruption that moved the bot more than 6 blocks, the next run walks back within 6 of work_pos first', async () => {
    const agent = setup({ world: forest(), work: { stall_s: 0.1 } });
    const { bot } = agent;
    let first = true;
    let backAt = null;
    bot.hooks.collect = async () => {
        if (first) {
            first = false;
            bot.entity.position = bot.entity.position.offset(15, 0, 0); // a fight dragged it away
            agent.requestInterrupt();
            return;
        }
        backAt ??= bot.entity.position.clone();
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await done(agent);
    const workPos = agent.work.record.plan[0].work_pos;
    assert.ok(backAt, 'collected again after the interruption');
    assert.ok(Math.hypot(backAt.x - workPos.x, backAt.z - workPos.z) <= 6 + 1, `back at ${backAt} for ${JSON.stringify(workPos)}`);
    const calls = bot.calls.map(c => c[0]);
    const firstCollect = calls.indexOf('collect');
    assert.ok(calls.indexOf('goto', firstCollect) > firstCollect && calls.indexOf('goto', firstCollect) < calls.indexOf('collect', firstCollect + 1));
});

// --- fix wave 1 ------------------------------------------------------------

const toOwner = bot => (name, count, entity) => setTimeout(() => bot.collect(F.OWNER, entity), 5);

test('give: a toss nobody picks up blocks the step with that fact and is never tossed again (F11)', async () => {
    const agent = setup({ inventory: { stick: 6 }, ownerAt: [3, 64, 0] });
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    assert.equal(agent.work.record.reason, 'dropped 4 stick near steve, not picked up');
    assert.equal(agent.bot.calls.filter(c => c[0] === 'toss').length, 1);
    await F.until(() => agent.turns.some(t => /is blocked at step 1\/1/.test(t.content)));
    assert.match(agent.turns.find(t => /is blocked/.test(t.content)).content, /dropped 4 stick near steve, not picked up/);
    assert.equal(agent.work.record.plan[0].progress.confirmed, 0);
});

test('give: inv_start is on disk before the first toss, so a crash after it never gives twice (F10)', async () => {
    const first = setup({ name: 'giver', inventory: { stick: 8 }, ownerAt: [3, 64, 0], drive: false });
    let onDisk = null;
    first.bot.hooks.toss = () => {
        onDisk = F.readRecord(first).plan[0].progress?.inv_start ?? null;
        first.work.dispose();               // the process dies right after the toss
        first.bot.interrupt_code = true;
    };
    first.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => onDisk !== null);
    assert.equal(onDisk, 8);
    const second = setup({ name: 'giver', inventory: { stick: 4 }, ownerAt: [3, 64, 0], keep: true, init_message: W.RESTART_MESSAGE });
    second.bot.hooks.toss = toOwner(second.bot);
    await F.until(() => second.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(second.work.record.status, 'blocked');
    assert.equal(second.work.record.reason, 'dropped 4 stick near steve, not confirmed picked up');
    assert.equal(second.bot.calls.filter(c => c[0] === 'toss').length, 0);
    assert.equal(second.bot.count('stick'), 4);
});

function walker({ moving }) {
    const c = F.clock();
    const agent = setup({ now: c.now, drive: false });
    let release = false;
    agent.bot.hooks.goto = () => F.until(() => release || agent.bot.interrupt_code, { timeout: 60000 });
    agent.work.startTask('far walk', 'go_to target=80,64,0');
    const walk = async seconds => {
        for (let t = 10; t <= seconds; t += 10) {
            c.advance(10);
            if (moving) agent.bot.entity.position = new F.Vec3(t / 10, 64, 0); // one block closer every 10 s
            agent.work.tick();
        }
    };
    return { agent, walk, release: () => { release = true; } };
}

test('stall rule during one long call: steady progress is never blocked; the timer samples it (F12)', async () => {
    const { agent, walk, release } = walker({ moving: true });
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await walk(700);
    assert.equal(agent.work.record.status, 'active');
    assert.ok(agent.work.record.plan[0].progress.stalled_s < 15);
    release();
    await done(agent);
});

test('stall rule during one long call: a real stall blocks, ends the run, and leaves the record consistent (F12)', async () => {
    const { agent, walk } = walker({ moving: false });
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await walk(600);
    const record = agent.work.record;
    assert.equal(record.status, 'blocked');
    await F.until(() => !agent.work.runner.executing); // the timer interrupted the actuator call
    assert.equal(record.status, 'blocked');
    assert.equal(record.cursor, 0);
    assert.equal(record.plan[0].status, 'blocked');
    assert.equal(F.readRecord(agent).status, 'blocked');
});

test('a craft result that arrives after the task was blocked is discarded (F12)', async () => {
    const c = F.clock();
    const agent = setup({ inventory: { oak_log: 1 }, now: c.now, drive: false });
    let released = false;
    agent.bot.hooks.craft = () => F.until(() => released, { timeout: 60000 }); // ignores interrupts, like Mineflayer
    agent.work.startTask('planks', 'obtain item=oak_planks count=4');
    await F.until(() => agent.bot.calls.some(c => c[0] === 'craft'));
    for (let t = 0; t < 60; t++) { c.advance(10); agent.work.tick(); }
    assert.equal(agent.work.record.status, 'blocked');
    released = true;
    await F.until(() => !agent.work.runner.executing);
    const step = agent.work.record.plan[0];
    assert.equal(agent.bot.count('oak_planks'), 4);  // the craft did finish
    assert.equal(step.status, 'blocked');
    assert.equal(step.progress.now, 0);              // but nothing of it was committed
    assert.equal(agent.work.record.cursor, 0);
});

test('a craft unit runs at most 4 recipe runs, so the runner re-observes between them (F13)', async () => {
    const agent = setup({ inventory: { oak_log: 10 } });
    agent.work.startTask('planks', 'obtain item=oak_planks count=40');
    await done(agent);
    const crafts = agent.bot.calls.filter(c => c[0] === 'craft').map(c => c[2]);
    assert.deepEqual(crafts, [4, 4, 2]);
    assert.equal(agent.bot.count('oak_planks'), 40);
});

test('a task started inside a !goal hands back to the goal when done; a blocked task leaves it stopped and says so (F17)', async () => {
    for (const outcome of ['done', 'blocked']) {
        const agent = setup({ world: outcome === 'done' ? forest() : new F.World(), replies: [''] });
        const sp = agent.self_prompter;
        sp.state = 1; // ACTIVE, as after !goal
        sp.prompt = 'build a hut';
        const started = [];
        sp.start = prompt => { started.push(prompt); sp.state = 1; };
        agent.work.startTask('logs', 'obtain item=oak_log count=2');
        assert.equal(sp.isStopped(), true);         // REQ-RES-9 still holds while the task runs
        assert.equal(agent.work.record.goal, 'build a hut');
        if (outcome === 'done') {
            await done(agent);
            await F.until(() => started.length === 1);
            assert.deepEqual(started, ['build a hut']);
            assert.match(agent.chats.find(m => /^Task done/.test(m)), /Back to the goal "build a hut"\./);
        } else {
            await F.until(() => agent.work.record.status === 'blocked');
            await F.until(() => agent.turns.some(t => /is blocked/.test(t.content)));
            await F.sleep(30);
            assert.deepEqual(started, []);
            assert.equal(sp.isStopped(), true);
            assert.match(agent.turns.find(t => /is blocked/.test(t.content)).content, /The goal "build a hut" that started this task stays stopped\./);
        }
    }
});

test('the runner counts dig events again after a death and respawn (R5)', () => {
    const agent = setup({ drive: false });
    const runner = agent.work.runner;
    agent.bot.emit('diggingCompleted', {});
    const before = runner.worldEvents;
    agent.bot.emit('death');   // mineflayer drops every diggingCompleted listener
    agent.bot.emit('spawn');
    agent.bot.emit('diggingCompleted', {});
    assert.equal(runner.worldEvents, before + 1);
});

test('the self-heal timer catches a replacing resumable action while no run executes', async () => {
    stopDrivers();
    const bot = F.makeBot();
    F.player(bot, F.OWNER, [0, 64, 0]);
    const agent = F.makeAgent({ bot, name: 'watcher', idleDelay: 2000, modes: { self_defense: true } });   // undriven: the check refuses, nothing fights
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    F.hostile(bot, 'zombie', [4, 0, 0]);  // the resume check refuses: the run ends at once
    agent.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => /zombie/.test(agent.work.record.plan[0].progress?.last_cause ?? '') && !agent.work.runner.executing);
    const follow = agent.actions.runAction('action:followPlayer', () => F.until(() => bot.interrupt_code, { timeout: 60000 }), { resume: true, timeout: -1 });
    await F.until(() => agent.actions.resume_name === 'action:followPlayer');
    assert.equal(agent.work.record.status, 'active');
    agent.work.tick();
    assert.deepEqual([agent.work.record.status, agent.work.record.reason], ['paused', 'replaced: action:followPlayer']);
    await agent.actions.stop();
    await follow;
});

test('a revision ends the old run without counting it as an interruption (generation check)', async () => {
    const agent = setup();
    agent.bot.hooks.goto = goal => goal.x === 40 ? untilInterrupted(agent.bot) : null;
    agent.work.startTask('walk', 'go_to target=40,64,0');
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await agent.work.reviseTask(1, 'go_to target=2,64,0');
    await done(agent);
    assert.equal(agent.work.record.interruptions.count, 0);
});

for (const command of ['pauseTask', 'cancelTask']) {
    test(`${command} ends the running actuator call before it returns`, async () => {
        const agent = setup();
        agent.bot.hooks.goto = () => untilInterrupted(agent.bot);
        agent.work.startTask('walk', 'go_to target=40,64,0');
        await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
        await agent.work[command]();
        assert.equal(agent.work.runner.executing, false);
    });
}

test('!taskResume gives a blocked step its full attempts again', async () => {
    const agent = setup({ inventory: { stick: 2 }, ownerAt: null, replies: ['', ''] }); // steve is not in view
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=2`);
    await F.until(() => agent.work.record.status === 'blocked');
    assert.match(agent.work.record.reason, /^failed 3 times/);
    agent.work.resumeTask();
    await F.until(() => agent.work.record.status === 'blocked');
    assert.match(agent.work.record.reason, /^failed 3 times/);
});

test('the self-heal timer starts a new run when resume_func was cleared (no run, no resume)', async () => {
    const c = F.clock();
    const agent = setup({ world: forest(), now: c.now, drive: false });
    let first = true;
    agent.bot.hooks.collect = async () => { if (first) { first = false; await untilInterrupted(agent.bot); } };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => !first && agent.work.runner.executing);
    agent.actions.cancelResume();   // as upstream's fast-loop guard does (action_manager.js:84-87)
    agent.requestInterrupt();
    await F.until(() => !agent.work.runner.executing && agent.isIdle());
    await F.sleep(60);
    assert.equal(agent.actions.resume_func, null);
    assert.equal(agent.work.record.status, 'active');
    agent.work.tick();
    c.advance(15);
    agent.work.tick();
    await done(agent);
});

// --- fix wave 2 ------------------------------------------------------------

test('work_pos follows the collection even when the timer sampled the gain during the unit (G2)', async () => {
    const world = new F.World();
    F.tree(world, 20, 64, 0, 8);
    const agent = setup({ world, drive: false });
    let sampled = false;
    agent.bot.hooks.collect = async () => {
        if (sampled) return;
        sampled = true;
        agent.bot.give('oak_log', 1);       // a gain inside the unit…
        agent.work.save({ sample: true });  // …that the timer's save samples first
    };
    agent.work.startTask('9 logs', 'obtain item=oak_log count=9');
    await F.until(() => agent.work.record.plan[0].work_pos?.x >= 19, { timeout: 4000 });
    await agent.work.cancelTask();
});

const slowHistory = agent => {
    const add = agent.history.add;
    agent.history.add = async (...args) => { await F.sleep(60); return add(...args); };
};
function goalAgent(opts = {}) {
    const agent = setup({ world: forest(), replies: ['', ''], ...opts });
    const sp = agent.self_prompter;
    sp.state = 1;
    sp.prompt = 'build a hut';
    const started = [];
    sp.start = prompt => { started.push(prompt); sp.state = 1; };
    return { agent, sp, started };
}

test('goal handback: not after !endGoal during the task, nor after a !stop while the report is pending (G3)', async () => {
    const ended = goalAgent();
    ended.agent.bot.hooks.collect = () => F.sleep(30);
    ended.agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.modules.commands.getCommand('!endGoal').perform(ended.agent);
    assert.equal(ended.agent.work.record.goal, null);
    await done(ended.agent);
    await F.sleep(80);
    assert.deepEqual(ended.started, []);

    const stopped = goalAgent();
    slowHistory(stopped.agent);
    stopped.agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await done(stopped.agent);
    stopped.sp.start = prompt => stopped.started.push(prompt); // keep it stopped for the check
    await F.modules.commands.getCommand('!stop').perform(stopped.agent);
    await F.sleep(150);
    assert.deepEqual(stopped.started, []);

    const replaced = goalAgent();
    slowHistory(replaced.agent);
    replaced.agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await done(replaced.agent);
    replaced.sp.state = 0;
    await F.modules.commands.getCommand('!goal').perform(replaced.agent, 'fish'); // the owner's new goal
    assert.equal(replaced.agent.work.record.goal, null);
    assert.equal(F.readRecord(replaced.agent).goal, null);
    await F.sleep(150);
    assert.deepEqual(replaced.started, ['fish']); // the new goal only, not the old one handed back
});

test('goal handback: not after a fresh start, nor after a blocked task is resumed (G3)', async () => {
    const first = goalAgent({ name: 'goalfresh', drive: false });
    first.agent.bot.hooks.collect = () => untilInterrupted(first.agent.bot);
    first.agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => first.agent.work.runner.executing);
    first.agent.work.dispose();
    first.agent.bot.interrupt_code = true;
    const fresh = goalAgent({ name: 'goalfresh', keep: true });
    assert.equal(fresh.agent.work.record.status, 'paused');
    assert.equal(fresh.agent.work.record.goal, null);
    assert.equal(F.readRecord(fresh.agent).goal, null);

    const blocked = goalAgent({ world: new F.World() });
    blocked.agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => blocked.agent.work.record.status === 'blocked');
    assert.equal(blocked.agent.work.record.goal, null);
    F.tree(blocked.agent.bot.world, 3, 64, 0, 3);
    blocked.agent.work.resumeTask();
    await done(blocked.agent);
    await F.sleep(80);
    assert.deepEqual(blocked.started, []);
});

test('a block from the timer posts its report only after the run has ended (G4)', async () => {
    const { agent, walk } = walker({ moving: false });
    let executingAtCall = null;
    const prompt = agent.prompter.promptConvo;
    agent.prompter.promptConvo = async (...args) => { executingAtCall ??= agent.work.runner.executing; return prompt(...args); };
    agent.bot.hooks.goto = () => F.sleep(80); // the interrupted call takes a while to return
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await walk(600);
    assert.equal(agent.work.record.status, 'blocked');
    await F.until(() => executingAtCall !== null);
    assert.equal(executingAtCall, false);
    assert.equal(agent.work.runner.afterRun, null); // posted once, then cleared (H8)
});

const systemCalls = agent => {
    const calls = [];
    const handle = agent.handleMessage.bind(agent);
    agent.handleMessage = (source, message, ...rest) => { if (source === 'system') calls.push(message); return handle(source, message, ...rest); };
    return calls;
};

test('a timer block\'s deferred report is dropped when !stop comes before the run returns (H2)', async () => {
    const { agent, walk } = walker({ moving: false });
    const calls = systemCalls(agent);
    let returnNow = false;
    agent.bot.hooks.goto = () => F.until(() => returnNow, { timeout: 60000 }); // ignores the interrupt
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await walk(600);
    assert.equal(agent.work.record.status, 'blocked');
    const stopping = F.modules.commands.getCommand('!stop').perform(agent);
    returnNow = true;
    await stopping;
    await F.until(() => !agent.work.runner.executing);
    await F.sleep(100);
    assert.deepEqual(calls, []);
    assert.equal(agent.work.record.status, 'cancelled');
});

test('a timer block on a call that never returns posts its report after the bound, exactly once (H5)', async () => {
    const { agent, walk } = walker({ moving: false });
    agent.work.reportWaitMs = 150;
    const calls = systemCalls(agent);
    let finish = null;
    agent.bot.hooks.goto = () => new Promise(resolve => { finish = resolve; }); // does not return within the test
    await F.until(() => agent.work.runner.executing && agent.bot.calls.some(c => c[0] === 'goto'));
    await walk(600);
    assert.equal(agent.work.record.status, 'blocked');
    await F.until(() => calls.length > 0, { timeout: 2000 });
    assert.equal(agent.work.runner.executing, true);
    await F.sleep(300);
    finish();
    await F.until(() => !agent.work.runner.executing);
    await F.sleep(50);
    assert.equal(calls.length, 1); // and not again when the run ends
});

test('goal handback does not start the goal again when the self-prompter is already active (H8)', async () => {
    const { agent, sp, started } = goalAgent();
    slowHistory(agent);
    agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await done(agent);
    sp.state = 1; // running again before the handback fires
    await F.sleep(150);
    assert.deepEqual(started, []);
});

// --- give: one bounded attempt per unit (final design ruling) ---------------

const tosses = (bot, item) => bot.calls.filter(c => c[0] === 'toss' && (!item || c[1] === item));

test('give: a pickup after upstream\'s window but within 30 s confirms, and the step is done', async () => {
    GIVE.confirmMs = GIVE_CONFIRM_S * 1000; // the code's default
    const agent = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0] });
    agent.bot.hooks.toss = (name, count, entity) => setTimeout(() => agent.bot.collect(F.OWNER, entity), 3500);
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => agent.work.record.status === 'done', { timeout: 15000 });
    assert.equal(agent.work.record.plan[0].progress.confirmed, 4);
    assert.equal(tosses(agent.bot).length, 1);
});

test('give: a matching stack the target picks up during the approach is not credited when the call fails', async () => {
    const agent = setup({ inventory: { stick: 4 }, ownerAt: [6, 64, 0], replies: [''] });
    agent.bot.hooks.goto = () => {
        agent.bot.collect(F.OWNER, { id: -4, getDroppedItem: () => ({ name: 'stick', count: 4 }) }); // someone else's sticks
        throw new Error('no path');
    };
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'blocked');
    assert.equal(agent.work.record.plan[0].progress.confirmed, 0);
    assert.equal(tosses(agent.bot).length, 0);
    assert.equal(agent.bot.count('stick'), 4);
});

test('give: the bot re-picking up its own drop stays blocked and never re-tosses by itself', async () => {
    const agent = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0], replies: [''] });
    agent.bot.hooks.toss = (name, count, entity) => setTimeout(() => {
        agent.bot.give(name, count);
        agent.bot.collect(agent.bot.username, entity);
    }, 5);
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    assert.equal(agent.work.record.reason, 'dropped 4 stick near steve, not picked up');
    await F.sleep(500); // ticks run meanwhile
    assert.equal(agent.work.record.status, 'blocked');
    assert.equal(tosses(agent.bot).length, 1);
    assert.equal(agent.work.record.plan[0].progress.confirmed, 0);
});

test('give: when the call throws after a toss, the pickup within the window still counts (no over-delivery)', async () => {
    const agent = setup({ inventory: { cobblestone: 192 }, ownerAt: [3, 64, 0], replies: ['', ''] });
    let n = 0;
    agent.bot.hooks.toss = (name, count, entity) => {
        n++;
        if (n === 2) throw new Error('window closed'); // the second transfer of the first attempt fails
        setTimeout(() => agent.bot.collect(F.OWNER, entity), 20);
    };
    agent.work.startTask('cobble', `give player=${F.OWNER} item=cobblestone count=128`);
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    // The first stack was picked up after the call threw: it counts, so a resume re-gives 64, not 128.
    assert.equal(agent.work.record.plan[0].progress.confirmed, 64);
    assert.equal(agent.work.record.reason, 'steve picked up 64 of 128 cobblestone; 64 dropped near steve, not picked up');
});

test('give: a partial pickup across two stacks blocks with what was picked up; !taskResume re-gives only the outstanding count', async () => {
    const agent = setup({ inventory: { cobblestone: 192 }, ownerAt: [3, 64, 0], replies: ['', ''] });
    let pickups = 1; // only the first stack is picked up
    agent.bot.hooks.toss = (name, count, entity) => { if (pickups > 0) { pickups--; setTimeout(() => agent.bot.collect(F.OWNER, entity), 5); } };
    agent.work.startTask('cobble', `give player=${F.OWNER} item=cobblestone count=128`);
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    assert.equal(agent.work.record.plan[0].progress.confirmed, 64);
    assert.equal(agent.work.record.reason, 'steve picked up 64 of 128 cobblestone; 64 dropped near steve, not picked up');
    assert.equal(agent.bot.count('cobblestone'), 64);
    pickups = 10;
    const before = tosses(agent.bot).length;
    agent.work.resumeTask();
    await done(agent);
    const again = tosses(agent.bot).slice(before);
    assert.equal(again.reduce((sum, c) => sum + c[2], 0), 64); // only the outstanding 64, from the inventory
    assert.equal(agent.bot.count('cobblestone'), 0);
    assert.equal(agent.work.record.plan[0].progress.confirmed, 128);
});

test('give: a late pickup never resumes a blocked give by itself, so the owner\'s newer action is never interrupted', async () => {
    const agent = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0], replies: [''] });
    let dropped = null;
    agent.bot.hooks.toss = (name, count, entity) => { dropped = entity; };
    agent.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    await F.until(() => !agent.work.runner.executing);
    let finished = false;
    let interrupted = false;
    const newer = agent.actions.runAction('action:followPlayer', async () => {
        for (let i = 0; i < 10; i++) { await F.sleep(80); if (agent.bot.interrupt_code) { interrupted = true; return; } }
        finished = true;
    });
    agent.bot.collect(F.OWNER, dropped); // the owner picks the sticks up meanwhile
    await newer;
    assert.equal(interrupted, false);
    assert.equal(finished, true);
    assert.equal(agent.work.record.status, 'blocked');
    assert.equal(tosses(agent.bot).length, 1);
});

test('give confirmation counts only the target player\'s pickups of the item', async () => {
    // An unrelated item the player picks up is no confirmation.
    const other = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0], replies: [''] });
    other.bot.hooks.toss = () => setTimeout(() => other.bot.collect(F.OWNER, { id: -2, getDroppedItem: () => ({ name: 'dirt', count: 4 }) }), 5);
    other.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => other.work.record.status === 'blocked', { timeout: 8000 });
    assert.equal(other.work.record.plan[0].progress.confirmed, 0);
    // The bot's own pickup of something else first does not hide the real one.
    const own = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0] });
    own.bot.hooks.toss = (name, count, entity) => setTimeout(() => {
        own.bot.collect(own.bot.username, { id: -1, getDroppedItem: () => ({ name: 'stick', count: 4 }) });
        own.bot.collect(F.OWNER, entity);
    }, 5);
    own.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await done(own);
    assert.equal(own.work.record.plan[0].progress.confirmed, 4);
});

test('give: !taskResume with nothing left in the inventory blocks truthfully', async () => {
    const empty = setup({ inventory: { stick: 4 }, ownerAt: [3, 64, 0], replies: ['', ''] });
    empty.work.startTask('sticks', `give player=${F.OWNER} item=stick count=4`);
    await F.until(() => empty.work.record.status === 'blocked', { timeout: 8000 });
    empty.work.resumeTask();
    await F.until(() => empty.work.record.status === 'blocked' && /have 0/.test(empty.work.record.reason ?? ''), { timeout: 8000 });
    assert.equal(empty.work.record.reason, 'have 0 stick, 4 still to give to steve');
});

const quarry = () => {
    const world = new F.World();
    for (let i = 0; i < 30; i++) world.set(2 + i, 64, 0, 'stone');
    return world;
};
const silk = (bot, name) => { bot.inventory.items().find(i => i.name === name).enchants = [{ name: 'silk_touch', lvl: 1 }]; };
// The gear plugin's tool choice in place of the fixture's (REQ-GEAR-1: the silk rule lives there now).
const gearTools = bot => { bot.tool.equipForBlock = (block, options) => F.modules.gear.equipForBlock(bot, block, options); };

test('obtain cobblestone with a silk-touch pickaxe and a plain one uses the plain one', async () => {
    const agent = setup({ world: quarry(), inventory: { diamond_pickaxe: 1, iron_pickaxe: 1 } });
    silk(agent.bot, 'diamond_pickaxe');
    gearTools(agent.bot);
    agent.work.startTask('cobble', 'obtain item=cobblestone count=3');
    await done(agent);
    assert.equal(agent.bot.count('cobblestone'), 3);
    assert.equal(agent.bot.count('stone'), 0);
});

test('obtain cobblestone with only a silk-touch pickaxe digs nothing', async () => {
    const agent = setup({ world: quarry(), inventory: { diamond_pickaxe: 1 }, replies: [''] });
    silk(agent.bot, 'diamond_pickaxe');
    agent.work.startTask('cobble', 'obtain item=cobblestone count=3');
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    assert.equal(agent.bot.calls.filter(c => c[0] === 'collect').length, 0); // nothing dug
    assert.equal(agent.bot.count('stone'), 0);
});

test('a collect that brings in none of the wanted item fails at once, so the step blocks after a few blocks', async () => {
    const agent = setup({ world: quarry(), inventory: { diamond_pickaxe: 1 }, replies: [''] });
    const equip = agent.bot.tool.equipForBlock;
    agent.bot.tool.equipForBlock = async block => { await equip(block); delete agent.bot.heldItem.enchants; };
    agent.bot.hooks.collect = async () => silk(agent.bot, 'diamond_pickaxe'); // past the tool check: the drop is stone
    agent.work.startTask('cobble', 'obtain item=cobblestone count=3');
    await F.until(() => agent.work.record.status === 'blocked', { timeout: 8000 });
    assert.match(agent.work.record.reason, /collected cobblestone but got no cobblestone/);
    assert.ok(agent.bot.count('stone') <= 9, String(agent.bot.count('stone')));
});

test('obtain dirt with only a silk-touch shovel digs grass by hand and gets dirt', async () => {
    const world = new F.World();
    for (let i = 0; i < 10; i++) world.set(2 + i, 64, 0, 'grass_block');
    const agent = setup({ world, inventory: { diamond_shovel: 1 } });
    silk(agent.bot, 'diamond_shovel');
    agent.bot.heldItem = agent.bot.inventory.items()[0];   // held, as the fastest tool for grass
    gearTools(agent.bot);
    agent.work.startTask('dirt', 'obtain item=dirt count=2');
    await done(agent);
    assert.equal(agent.bot.count('dirt'), 2);
    assert.equal(agent.bot.count('grass_block'), 0);
});
