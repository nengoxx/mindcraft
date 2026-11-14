import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createRequire } from 'node:module';
import * as F from './work-fixture.mjs';

// Travel (SPEC §7.11, REQ-TRV-1 … 6; design travel/recommended-design.md r4
// §9; DECISIONS 2026-11-13 (evening) "Travel after the live trials"): the walk
// keeper, the stuck fallback, the planning retry, the climb helper and the
// fixes in their blast radius. The real ActionManager, modes, handleMessage
// and combat; a fixture bot whose walks block until the test lets them end.
const require = createRequire(import.meta.url);
const { combat: CB, skills, plan: P } = F.modules;
const { COMBAT } = CB;
const COMBAT_DEFAULTS = { ...COMBAT };
const GIVE = P.STEPS.give;
const GIVE_MS = GIVE.confirmMs;
const FOLLOW = 'action:followPlayer';
const agents = [];
const stops = [];
let onTick = null;
afterEach(() => {
    stops.splice(0).forEach(stop => stop());
    F.cleanup(agents.splice(0));
    Object.assign(COMBAT, COMBAT_DEFAULTS);
    GIVE.confirmMs = GIVE_MS;
    onTick = null;
    F.useSettings();
});

const at = (x, y, z) => new F.Vec3(x, y, z);
function flat(r = 40) {
    const world = new F.World();
    world.fill(-r, 63, -r, r, 63, r, 'stone');
    return world;
}

let n = 0;
// The real fight (combat.js) on short ticks; `onTick` runs after each fight tick.
function setup({ world = flat(), position = [0.5, 64, 0.5], modes = { self_defense: true }, work = {}, replies = [], drive = false } = {}) {
    COMBAT.tickMs = 20;
    const bot = F.makeBot({ world, position });
    bot.entity.velocity = new F.Vec3(0, 0, 0);
    bot.controlState = {};
    require('mineflayer-pvp').plugin(bot);
    const agent = F.makeAgent({ bot, modes, work, replies, name: `travel${n++}` });
    F.clearRecord(agent);
    F.startWork(agent);
    agent.work.lineGapMs = 0;
    agent.work.combat.wait = async ms => { await F.sleep(ms); if (onTick) await onTick(); };
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return { agent, bot };
}

// A walk's goto blocks until `release()` or an interrupt; each walk (a goto
// toward x=`toX`) is counted; other gotos (moveAway, the climb) run `others`.
function walker(bot, { toX = 20, others = null } = {}) {
    const w = { starts: 0, released: false, release() { w.released = true; } };
    bot.hooks.goto = async goal => {
        if (goal.x !== toX || goal.constructor.name !== 'GoalNear') return others ? others(goal) : undefined;
        w.starts++;
        await F.until(() => w.released || bot.interrupt_code, { timeout: 60000 });
    };
    return w;
}
const autoMessages = agent => agent.turns.filter(t => /AUTO MESSAGE/.test(t.content));
const typedWalk = agent => F.ownerSays(agent, '!goToCoordinates(20, 64, 0, 1)');
const reached = agent => agent.chats.filter(c => /You have reached at 20, 64, 0/.test(c));

// A mode action the test ends (or an interrupt does): the keeper sees only its label.
function cutBy(agent, label) {
    let ended = false;
    const done = agent.actions.runAction(label, async () => {
        await F.until(() => ended || agent.bot.interrupt_code, { timeout: 60000 });
    });
    return { done, end() { ended = true; return done; } };
}
async function cutAndEnd(agent, label = 'mode:self_defense') {
    const cut = cutBy(agent, label);
    await F.until(() => agent.actions.currentActionLabel === label);
    await cut.end();
}
// The console.log lines until the test ends.
function logs() {
    const lines = [];
    const log = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    stops.push(() => { console.log = log; });
    return lines;
}
const floored = bot => bot.entity.position.floored().toArray();

// A zombie that self_defense fights; it dies at the fight's first tick.
function zombie(bot) {
    const z = F.hostile(bot, 'zombie', [3, 0, 0]);
    onTick = () => { delete bot.entities[z.id]; };
    return z;
}

// --- REQ-TRV-1: the keeper ---------------------------------------------------------------

test('REQ-TRV-1: a typed !goToCoordinates cut by a real self_defense fight restarts: no model call, no AUTO MESSAGE, one reply with the count', async () => {
    const { agent, bot } = setup({ drive: true });
    const w = walker(bot);
    const typed = F.ownerSays(agent, '!goToCoordinates(20, 64, 0, 1)');
    await F.until(() => w.starts === 1);
    zombie(bot);
    await F.until(() => w.starts === 2 || agent.modelCalls > 0, { timeout: 4000 });
    assert.equal(agent.modelCalls, 0, 'the AUTO MESSAGE made a model call');
    assert.equal(w.starts, 2, 'the walk restarted');
    assert.equal(agent.work.lastStart.voice, 'owner', 'the restart runs inside his turn (residual R4)');
    w.release();
    await typed;
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(autoMessages(agent), []);
    const replies = agent.chats.filter(c => /You have reached at 20, 64, 0/.test(c));
    assert.equal(replies.length, 1);
    assert.match(replies[0], /Resumed after 1 interruption\.$/);
});

test('REQ-TRV-1: a model-run walk: the result returns into the same turn, with no extra call', async () => {
    const { agent, bot } = setup({ drive: true, replies: ['!goToCoordinates(20, 64, 0, 1)', 'I am there.'] });
    const w = walker(bot);
    const turn = F.ownerSays(agent, 'go to 20 64 0');
    await F.until(() => w.starts === 1);
    zombie(bot);
    await F.until(() => w.starts === 2 || agent.modelCalls > 1, { timeout: 4000 });
    assert.equal(agent.modelCalls, 1);
    w.release();
    await turn;
    assert.equal(agent.modelCalls, 2, 'one to start, one after arrival: as for an uncut walk');
    assert.deepEqual(autoMessages(agent), []);
    assert.ok(agent.turns.some(t => t.source === 'system' && /You have reached at 20, 64, 0\.\nResumed after 1 interruption\.$/.test(t.content)));
    assert.ok(agent.chats.includes('I am there.'));
});

test('REQ-TRV-1: a goal\'s walk: no call for the cut; after arrival the goal\'s next turn is the one it makes anyway', async () => {
    const { agent, bot } = setup({ drive: true, replies: ['!goToCoordinates(20, 64, 0, 1)', '!endGoal'] });
    const sp = agent.self_prompter;
    sp.cooldown = 20;
    const w = walker(bot);
    sp.start('walk to 20 64 0');
    await F.until(() => w.starts === 1);
    zombie(bot);
    await F.until(() => w.starts === 2);
    w.release();
    await F.until(() => !sp.loop_active && !sp.interrupt, { timeout: 4000 });
    assert.equal(agent.modelCalls, 1, 'no call for the cut, none after the result in the cut turn');
    assert.ok(agent.turns.some(t => t.source === 'system' && /Resumed after 1 interruption\./.test(t.content)));
    sp.update(100);   // agent.js's update loop: the goal restarts with its next turn
    await F.until(() => sp.isStopped());
    await F.sleep(30);
    // Two goal turns in all: the one that started the walk, the one after it
    // (its reply !endGoal is followed by upstream's own continuation call).
    assert.equal(agent.turns.filter(t => /^You are self-prompting with the goal/.test(t.content)).length, 2);
    assert.deepEqual(autoMessages(agent), []);
});

test('REQ-TRV-2: no restart after !stop, a newer command, death or another dimension; a re-sent walk returns the old command at once', async () => {
    for (const how of ['stop', 'newer', 'death', 'dimension']) {
        const { agent, bot } = setup({ modes: {} });
        const w = walker(bot);
        const typed = typedWalk(agent);
        await F.until(() => w.starts === 1);
        const fight = cutBy(agent, 'mode:self_defense');
        await F.until(() => agent.actions.currentActionLabel === 'mode:self_defense');
        if (how === 'stop') await F.ownerSays(agent, '!stop');
        if (how === 'newer') void F.ownerSays(agent, '!moveAway(3)');
        if (how === 'death') bot.emit('death');
        if (how === 'dimension') { bot.game.dimension = 'the_nether'; await fight.end(); }
        await typed;
        await F.sleep(20);
        assert.equal(w.starts, 1, how);
        assert.equal(agent.modelCalls, 0, how);
        assert.equal(agent.work.travel.walk, null, how);
        F.cleanup([agent]);
    }
    // A re-sent walk: the old command returns while the new walk still runs; only the newest runs.
    const { agent, bot } = setup({ modes: {} });
    const w = walker(bot);
    let oldDone = false;
    const old = typedWalk(agent).then(() => { oldDone = true; });
    await F.until(() => w.starts === 1);
    void cutBy(agent, 'mode:self_defense');
    await F.until(() => agent.actions.currentActionLabel === 'mode:self_defense');
    const again = typedWalk(agent);
    await F.until(() => oldDone);   // before the new walk ends (it waits for release)
    await F.until(() => w.starts === 2);
    assert.equal(agent.actions.currentActionLabel, 'action:goToCoordinates');
    await F.sleep(30);
    assert.equal(w.starts, 2, 'only the newest runs');
    w.release();
    await Promise.all([old, again]);
    assert.equal(reached(agent).length, 1, 'one reply, the new command\'s');
    assert.doesNotMatch(reached(agent)[0], /Resumed/);
});

test('REQ-TRV-2 (build r1 F1): a newer indefinite action while the cut walk still unwinds: the old command returns, the follow keeps running', async () => {
    const { agent, bot } = setup({ modes: {} });
    F.player(bot, F.OWNER, [0.5, 64, 3.5]);
    let walks = 0;
    bot.hooks.goto = async goal => {
        if (goal.x !== 20 || goal.constructor.name !== 'GoalNear') return undefined;
        walks++;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
        await F.sleep(300);   // the pathfinder rejects a cancelled goto on a later timer turn
    };
    let oldDone = false;
    const old = typedWalk(agent).then(() => { oldDone = true; });
    await F.until(() => walks === 1);
    void cutBy(agent, 'mode:self_defense').end();   // the cutter (a short fight), while the walk still unwinds
    await F.sleep(20);
    // Both queued starts wait for the same stop and then run side by side (the
    // ActionManager's own race), so the follow is watched through its command.
    let followDone = false;
    stops.push(() => { bot.interrupt_code = true; });   // the follow never ends by itself
    void F.ownerSays(agent, `!followPlayer("${F.OWNER}", 3)`).then(() => { followDone = true; });   // indefinite, queued meanwhile
    await F.until(() => bot.pathfinder.goal?.constructor.name === 'GoalFollow', { timeout: 3000 });
    await F.until(() => oldDone, { timeout: 3000 });   // before: it waited on the follow's promise
    await old;
    await F.sleep(600);
    assert.equal(followDone, false, 'the follow keeps running');
    assert.equal(walks, 1, 'no restart');
    assert.equal(agent.work.travel.walk, null);
});

test('REQ-TRV-1 (build r1 M7): an upkeep action started while the walk waits is not newer: the walk restarts after it', async () => {
    const { agent, bot } = setup({ modes: {} });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    void cutBy(agent, 'mode:self_defense');
    await F.until(() => agent.actions.currentActionLabel === 'mode:self_defense');
    await agent.actions.runAction('action:tidy', async () => { await F.sleep(30); });   // upkeep cuts the fight
    await F.until(() => w.starts === 2);
    assert.equal(agent.work.travel.walk.newer, false);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

test('REQ-TRV-1: a chained cut (self_preservation cuts the fight): one restart, no AUTO MESSAGE', async () => {
    // The flee makes the restart wait until it is safe (DECISIONS 2026-11-14, Q2): here at once (no quiet time).
    const { agent, bot } = setup({ drive: true, modes: { self_defense: true, self_preservation: true }, work: { travel: { safe_quiet_s: 0 } } });
    let z = null;
    const order = [];
    const w = walker(bot, { others: async goal => {
        if (!goal.goal) return undefined;
        order.push('moveAway');   // moveAway(20): out of danger, in 100 ms
        bot.health = 20;
        delete bot.entities[z.id];
        await F.sleep(100);
        if (bot.interrupt_code) order.push('moveAway cut');
        return undefined;
    } });
    const walk = bot.hooks.goto;
    bot.hooks.goto = goal => { if (goal.x === 20) order.push(`walk ${w.starts + 1}`); return walk(goal); };
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    z = F.hostile(bot, 'zombie', [3, 0, 0]);   // fought, alive
    await F.until(() => agent.actions.currentActionLabel === 'mode:self_defense');
    Object.assign(bot, { health: 3, lastDamageTime: Date.now(), lastDamageTaken: 1 });   // "I'm dying!"
    await F.until(() => w.starts === 2 || agent.modelCalls > 0, { timeout: 4000 });
    assert.equal(agent.modelCalls, 0);
    w.release();
    await typed;
    assert.equal(w.starts, 2);
    assert.deepEqual(order, ['walk 1', 'moveAway', 'walk 2'], 'the restart waits for the mode chained after the fight');
    assert.deepEqual(autoMessages(agent), []);
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

test('REQ-TRV-1: a cutter outside the set (cowardice) keeps the AUTO MESSAGE and no restart', async () => {
    const { agent, bot } = setup({ drive: true, modes: { cowardice: true } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    const z = F.hostile(bot, 'zombie', [10, 0, 0]);
    await F.until(() => agent.actions.currentActionLabel === 'mode:cowardice');
    delete bot.entities[z.id];
    await typed;
    await F.until(() => agent.modelCalls === 1, { timeout: 4000 });
    assert.equal(autoMessages(agent).length, 1);
    assert.equal(w.starts, 1);
});

test('REQ-TRV-1: resume_max 0 is today\'s behaviour: the AUTO MESSAGE, no restart', async () => {
    const { agent, bot } = setup({ drive: true, work: { travel: { resume_max: 0 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    zombie(bot);
    await typed;
    await F.until(() => agent.modelCalls === 1, { timeout: 4000 });
    assert.equal(autoMessages(agent).length, 1);
    assert.equal(w.starts, 1);
});

test('REQ-TRV-2: the cap: at resume_max restarts one alert line, into history, no model call, no reply', async () => {
    const { agent, bot } = setup({ modes: {}, work: { travel: { resume_max: 2 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    for (let k = 1; k <= 2; k++) {
        await F.until(() => w.starts === k);
        await cutAndEnd(agent);
    }
    await F.until(() => w.starts === 3);
    bot.modes.behavior_log += 'Fighting zombie!\n';   // the last fight's line (build r1 F2)
    await cutAndEnd(agent);
    await typed;
    assert.equal(bot.modes.behavior_log, '', 'the behaviour log is flushed on the cap exit too');
    const line = 'I stopped walking at 0,64,0: interrupted 3 times on the way.';
    await F.until(() => agent.chats.includes(line));
    assert.equal(agent.chats.filter(c => c === line).length, 1);
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content === line));
    assert.equal(w.starts, 3);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(reached(agent), []);
});

test('REQ-TRV-1: an active task stays the pending resume (ours) throughout; the walk finishes, then the task resumes', async () => {
    const world = flat();
    F.tree(world, 5, 64, 3, 4);
    F.tree(world, 8, 64, 3, 4);
    const { agent, bot } = setup({ world, modes: {} });
    let first = true;
    bot.hooks.collect = async () => {
        if (!first) return;
        first = false;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
    };
    const w = walker(bot);
    agent.work.startTask('2 oak logs', 'obtain item=oak_log count=2');
    await F.until(() => bot.calls.some(c => c[0] === 'collect'));
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    assert.ok(agent.work.ours());
    await cutAndEnd(agent);
    await F.until(() => w.starts === 2);
    assert.ok(agent.work.ours(), 'the task is still the pending resume');
    assert.equal(agent.work.record.status, 'active');
    w.release();
    await typed;
    await F.until(() => agent.work.record.status === 'done', { timeout: 6000 });
    assert.equal(agent.modelCalls, 0);
});

test('REQ-TRV-1: a pending follow resumes after the kept walk', async () => {
    const { agent, bot } = setup({ modes: {} });
    F.player(bot, F.OWNER, [0.5, 64, 3.5]);
    const w = walker(bot);
    void F.ownerSays(agent, `!followPlayer("${F.OWNER}", 3)`);
    await F.until(() => agent.actions.currentActionLabel === FOLLOW);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    await cutAndEnd(agent);
    await F.until(() => w.starts === 2);
    assert.equal(agent.actions.resume_name, FOLLOW);
    w.release();
    await typed;
    await F.until(() => agent.actions.currentActionLabel === FOLLOW, { timeout: 4000 });
    agent.actions.cancelResume();
});

test('REQ-TRV-2: !endGoal while a goal\'s walk is held: no restart', async () => {
    const { agent, bot } = setup({ modes: {}, replies: ['!goToCoordinates(20, 64, 0, 1)'] });
    const w = walker(bot);
    agent.self_prompter.start('walk to 20 64 0');
    await F.until(() => w.starts === 1);
    void cutBy(agent, 'mode:self_defense');
    await F.until(() => agent.actions.currentActionLabel === 'mode:self_defense');
    await F.ownerSays(agent, '!endGoal');
    await F.until(() => !agent.self_prompter.loop_active, { timeout: 4000 });
    await F.sleep(30);
    assert.equal(w.starts, 1);
    assert.equal(agent.work.travel.walk, null);
    assert.equal(agent.modelCalls, 1);
});

// --- DECISIONS 2026-11-14: Q2 (after a near-death flee) and Q3 (!goToRememberedPlace) -----------

const { TRAVEL } = await import('../src/agent/work/travel.js');
// The safety wait looks every 20 ms (500 live).
function fastSafety() {
    const poll = TRAVEL.safePollMs;
    TRAVEL.safePollMs = 20;
    stops.push(() => { TRAVEL.safePollMs = poll; });
}
// The near-death flee as the modes.js carry starts it: onNearDeath, then the mode's action.
function nearDeathCut(agent) {
    agent.work.travel.onNearDeath?.();
    return cutAndEnd(agent, 'mode:self_preservation');
}

test('Q2: a self_preservation cut with her hurt and a hostile near waits; once her health is above half and no hostile has been near for safe_quiet_s, the walk restarts, with no call', async () => {
    fastSafety();
    const { agent, bot } = setup({ modes: {}, work: { travel: { safe_quiet_s: 1 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    bot.health = 4;
    const z = F.hostile(bot, 'zombie', [10, 0, 0]);
    await nearDeathCut(agent);
    await F.until(() => agent.actions.currentActionLabel === 'action:goToCoordinates');   // the wait runs as the restarted walk
    await F.sleep(150);
    assert.equal(w.starts, 1, 'hurt: she waits');
    bot.health = 11;
    await F.sleep(150);
    assert.equal(w.starts, 1, 'a hostile within 16: she waits');
    delete bot.entities[z.id];
    const gone = Date.now();
    await F.until(() => w.starts === 2, { timeout: 4000 });
    assert.ok(Date.now() - gone >= 900, `quiet for safe_quiet_s first: ${Date.now() - gone} ms`);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(autoMessages(agent), []);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

test('Q2: not safe within safe_wait_s: one alert line, into history, no restart, no model call, no reply', async () => {
    fastSafety();
    const { agent, bot } = setup({ modes: {}, work: { travel: { safe_wait_s: 1 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    bot.health = 4;
    const started = Date.now();
    await nearDeathCut(agent);
    await typed;
    assert.ok(Date.now() - started >= 900, 'she waited the minute (here 1 s)');
    const line = 'I stopped walking at 0,64,0: it wasn\'t safe after I got away.';
    await F.until(() => agent.chats.includes(line));
    assert.equal(agent.chats.filter(c => c === line).length, 1);
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content === line));
    assert.equal(w.starts, 1);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(reached(agent), []);
    assert.equal(agent.work.travel.walk, null);
});

test('Q2 (fix wave 1, D-B2): a fire cut (the real self_preservation) restarts at once, even hurt: only the near-death flee waits', async () => {
    const world = flat();
    const { agent, bot } = setup({ world, drive: true, modes: { self_preservation: true } });   // the default 5 s quiet
    bot.health = 8;   // hurt (DECISIONS 2026-11-14: after the fire, lava and falling-sand moves "the walk restarts at once")
    let fled = 0;
    const w = walker(bot, { others: goal => {
        if (!goal.goal) return undefined;   // moveAway(5): off the fire
        fled++;
        world.set(0, 64, 0, 'air');
        return undefined;
    } });
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    world.set(0, 64, 0, 'fire');
    const lit = Date.now();
    await F.until(() => w.starts === 2, { timeout: 4000 });
    assert.ok(Date.now() - lit < 2000, `restarted at once: ${Date.now() - lit} ms`);
    assert.equal(fled, 1);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(autoMessages(agent), []);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

test('Q2: while she waits a newer command or !stop ends the wait at once, and another dimension drops it: no restart, no call', async () => {
    fastSafety();
    for (const how of ['newer', 'stop', 'dimension']) {
        const { agent, bot } = setup({ modes: {} });
        const w = walker(bot);
        const typed = typedWalk(agent);
        await F.until(() => w.starts === 1);
        bot.health = 4;   // not safe
        await nearDeathCut(agent);
        await F.until(() => agent.actions.currentActionLabel === 'action:goToCoordinates');
        const t = Date.now();
        if (how === 'newer') void F.ownerSays(agent, '!moveAway(3)');
        if (how === 'stop') await F.ownerSays(agent, '!stop');
        if (how === 'dimension') bot.game.dimension = 'the_nether';
        await typed;
        assert.ok(Date.now() - t < 1000, `${how}: ${Date.now() - t} ms`);
        await F.sleep(30);
        assert.equal(w.starts, 1, how);
        assert.equal(agent.modelCalls, 0, how);
        assert.equal(agent.work.travel.walk, null, how);
        F.cleanup([agent]);
    }
});

test('Q2: a fight during the wait is fought; the wait goes on after it and the walk restarts once quiet', async () => {
    fastSafety();
    const { agent, bot } = setup({ modes: {}, work: { travel: { safe_quiet_s: 1 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    bot.health = 4;
    await nearDeathCut(agent);
    await F.until(() => agent.actions.currentActionLabel === 'action:goToCoordinates');
    await cutAndEnd(agent, 'mode:self_defense');   // a fight cuts the wait
    bot.health = 20;
    const fought = Date.now();
    await F.until(() => w.starts === 2, { timeout: 4000 });
    assert.ok(Date.now() - fought >= 900, 'a fight counts as a hostile near: quiet for safe_quiet_s after it');
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(autoMessages(agent), []);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 2 interruptions\.$/, 'the restart after the fight counts toward resume_max');
});

test('fix wave 1, S1 and D-B1: a hostile that chases her through a real near-death flee holds the restart for safe_quiet_s after it leaves', async () => {
    fastSafety();
    const { agent, bot } = setup({ drive: true, modes: { self_preservation: true }, work: { travel: { safe_quiet_s: 1 } } });
    let gone = null;
    const w = walker(bot, { others: async goal => {
        if (!goal.goal) return undefined;   // moveAway(20), the near-death flee
        bot.health = 20;
        const z = F.hostile(bot, 'zombie', [6, 0, 0]);   // it chases her, then falls behind
        await F.sleep(200);
        delete bot.entities[z.id];
        gone = Date.now();
        return undefined;
    } });
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    Object.assign(bot, { health: 3, lastDamageTime: Date.now(), lastDamageTaken: 1 });   // "I'm dying!"
    await F.until(() => w.starts === 2, { timeout: 4000 });
    assert.ok(Date.now() - gone >= 900, `quiet after the flee first: ${Date.now() - gone} ms`);
    assert.equal(agent.modelCalls, 0);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

test('fix wave 1, S3: with safe_quiet_s 0 a hostile near at the look still holds the restart', async () => {
    fastSafety();
    const { agent, bot } = setup({ modes: {}, work: { travel: { safe_quiet_s: 0 } } });
    const w = walker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    const z = F.hostile(bot, 'zombie', [10, 0, 0]);
    await nearDeathCut(agent);   // her health is full
    await F.sleep(200);
    assert.equal(w.starts, 1, 'a hostile within 16 now');
    delete bot.entities[z.id];
    await F.until(() => w.starts === 2, { timeout: 2000 });
    w.release();
    await typed;
    assert.equal(agent.modelCalls, 0);
});

test('Q3: !goToRememberedPlace is kept: a fight cut restarts it, no model call, no AUTO MESSAGE', async () => {
    const { agent, bot } = setup({ drive: true });
    agent.memory_bank = { recallPlace: name => (name === 'home' ? [20, 64, 0] : null) };
    const w = walker(bot);
    const typed = F.ownerSays(agent, '!goToRememberedPlace("home")');
    await F.until(() => w.starts === 1);
    assert.equal(agent.actions.currentActionLabel, 'action:goToRememberedPlace');
    zombie(bot);
    await F.until(() => w.starts === 2 || agent.modelCalls > 0, { timeout: 4000 });
    assert.equal(agent.modelCalls, 0, 'the AUTO MESSAGE made a model call');
    assert.equal(w.starts, 2);
    w.release();
    await typed;
    assert.deepEqual(autoMessages(agent), []);
    assert.match(reached(agent)[0], /Resumed after 1 interruption\.$/);
});

// --- REQ-TRV-3: the stuck fallback --------------------------------------------------------------

// A low cave: a stone roof two above her feet over the area (`r` from the origin).
function cave(r = 30) {
    const world = flat(40);
    world.fill(-r, 66, -r, r, 66, r, 'stone');
    return world;
}
// moveAway (GoalInvert) moves her 3 east; the climb's goal is recorded and,
// unless `climb` says otherwise, the fixture moves her to its cell.
function stuckWalker(bot, { climb = () => undefined } = {}) {
    const climbs = [];
    const w = walker(bot, { others: goal => {
        if (goal.goal) { bot.entity.position = bot.entity.position.offset(3, 0, 0); return 'moved'; }
        climbs.push([goal.constructor.name, goal.x, goal.y, goal.z]);
        return climb(goal, climbs.length);
    } });
    w.climbs = climbs;
    return w;
}

test('REQ-TRV-3: the first unstuck cut climbs out, then walks on; a second within 8 tells him and stops, with no call', async () => {
    const { agent, bot } = setup({ world: cave(), modes: { unstuck: true } });
    const clock = fastClock();
    const w = stuckWalker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => w.starts === 2);
    assert.deepEqual(w.climbs, [['GoalBlock', 3, 67, 0]], 'up through the roof from where moveAway left her');
    assert.deepEqual(floored(bot), [3, 67, 0]);
    await clock.stuck(agent);
    await typed;
    assert.equal(bot.modes.behavior_log, '', 'the stuck give-up flushes unstuck\'s lines (build r1 F2)');
    const line = 'I\'m stuck near 3,67,0 and couldn\'t get out, so I stopped walking.';
    await F.until(() => agent.chats.includes(line));
    assert.equal(w.starts, 2);
    assert.equal(w.climbs.length, 1);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(autoMessages(agent), []);
    assert.deepEqual(reached(agent), []);
});

test('REQ-TRV-3: an unstuck cut farther than 8 from a stored spot gets its own climb', async () => {
    const { agent, bot } = setup({ world: cave(), modes: { unstuck: true } });
    const clock = fastClock();
    const lines = logs();
    const w = stuckWalker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => w.starts === 2);
    bot.entity.position = at(15.5, 64, 0.5);   // walked on, under the roof again
    await clock.stuck(agent);
    await F.until(() => w.starts === 3);
    assert.deepEqual(w.climbs, [['GoalBlock', 3, 67, 0], ['GoalBlock', 18, 67, 0]]);
    assert.equal(lines.filter(l => /climbing out first/.test(l)).length, 2);
    assert.equal(agent.work.travel.walk.stuck.length, 2);
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 2 interruptions\.$/);
    assert.equal(agent.modelCalls, 0);
});

test('REQ-TRV-3: with nothing to climb (open ground) the fallback is a plain restart; the next unstuck cut within 8 tells him', async () => {
    const { agent, bot } = setup({ modes: { unstuck: true } });
    const clock = fastClock();
    const w = stuckWalker(bot);
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => w.starts === 2);
    assert.deepEqual(w.climbs, [], 'no climb goal');
    await clock.stuck(agent);
    await typed;
    await F.until(() => agent.chats.some(c => /^I'm stuck near 3,64,0 and couldn't get out/.test(c)));
    assert.equal(w.starts, 2);
    assert.equal(agent.modelCalls, 0);
});

test('REQ-TRV-3 (§0b S5): a failed climb tells him and gives the walk up: no walk, no model call, typed or model-run', async () => {
    for (const how of ['typed', 'model']) {
        const { agent, bot } = setup({ world: cave(), modes: { unstuck: true }, replies: ['!goToCoordinates(20, 64, 0, 1)', 'never asked'] });
        const clock = fastClock();
        const w = stuckWalker(bot, { climb: () => { bot.modes.behavior_log += 'Fighting zombie!\n'; return 'moved'; } });   // the climb gets nowhere
        const turn = how === 'typed' ? typedWalk(agent) : F.ownerSays(agent, 'go to 20 64 0');
        await F.until(() => w.starts === 1);
        await clock.stuck(agent);
        await turn;
        assert.equal(bot.modes.behavior_log, '', `the failed climb's exit flushes the behaviour log (build r1 F2): ${how}`);
        await F.until(() => agent.chats.some(c => /^I'm stuck near 3,64,0 and couldn't get out, so I stopped walking\.$/.test(c)));
        assert.equal(w.starts, 1, how);
        assert.equal(w.climbs.length, 1, how);
        assert.equal(agent.modelCalls, how === 'typed' ? 0 : 1, how);
        assert.deepEqual(reached(agent), [], how);
        assert.ok(agent.turns.some(t => t.source === 'system' && /Could not climb out to the surface at 3, 67, 0\./.test(t.content)), how);
        stops.splice(0).forEach(stop => stop());
        F.cleanup([agent]);
    }
});

test('REQ-TRV-3 (§0c N1, §0d): a fight that cuts the climb climbs again (no new stuck spot); an unstuck cut of the climb within 8 tells him', async () => {
    const { agent, bot } = setup({ world: cave(), modes: { unstuck: true } });
    const clock = fastClock();
    const w = stuckWalker(bot, { climb: async (goal, k) => {
        if (k === 1) await F.until(() => bot.interrupt_code, { timeout: 60000 });   // the first climb is cut
        return undefined;
    } });
    const typed = typedWalk(agent);
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => w.climbs.length === 1);
    await cutAndEnd(agent);
    await F.until(() => w.starts === 2);
    assert.equal(w.climbs.length, 2, 'climbed again after the fight');
    assert.equal(agent.work.travel.walk.stuck.length, 1, 'no new stuck spot');
    w.release();
    await typed;
    assert.match(reached(agent)[0], /Resumed after 2 interruptions\.$/);
    // unstuck cuts the climb itself: the stuck rule, not another climb.
    const two = setup({ world: cave(), modes: { unstuck: true } });
    const w2 = stuckWalker(two.bot, { climb: () => F.until(() => two.bot.interrupt_code, { timeout: 60000 }) });
    const typed2 = typedWalk(two.agent);
    await F.until(() => w2.starts === 1);
    await clock.stuck(two.agent);
    await F.until(() => w2.climbs.length === 1);
    await clock.stuck(two.agent);
    await typed2;
    await F.until(() => two.agent.chats.some(c => /^I'm stuck near 3,64,0/.test(c)));
    assert.equal(w2.climbs.length, 1);
    assert.equal(w2.starts, 1);
});

// --- REQ-TRV-4: the planning retry ----------------------------------------------------------

const timeout = () => Object.assign(new Error('Took to long to decide path to goal!'), { name: 'Timeout' });
test('REQ-TRV-4: goToGoal retries a planning Timeout once; a second throws; none when interrupted; no other error is retried; moveAway never retries', async () => {
    const { bot } = setup({ modes: {} });
    const lines = logs();
    const goal = new F.modules.pf.goals.GoalNear(5, 64, 0, 1);
    let errors = [timeout()];
    bot.hooks.goto = () => { const err = errors.shift(); if (err) throw err; };
    const gotos = () => bot.calls.filter(c => c[0] === 'goto').length;
    assert.equal(await skills.goToGoal(bot, goal), true);
    assert.equal(gotos(), 2);
    assert.equal(lines.filter(l => l === '[travel] path planning ran out of think time; one retry').length, 1);
    errors = [timeout(), timeout()];
    await assert.rejects(skills.goToGoal(bot, goal), { name: 'Timeout' });
    assert.equal(gotos(), 4);
    errors = [timeout()];
    bot.hooks.goto = () => { bot.interrupt_code = true; const err = errors.shift(); if (err) throw err; };
    await assert.rejects(skills.goToGoal(bot, goal), { name: 'Timeout' });
    assert.equal(gotos(), 5, 'interrupted: no retry');
    bot.interrupt_code = false;
    bot.hooks.goto = () => { const err = errors.shift(); if (err) throw err; };
    errors = [Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })];
    await assert.rejects(skills.goToGoal(bot, goal), { name: 'NoPath' });
    assert.equal(gotos(), 6);
    errors = [timeout()];
    await assert.rejects(skills.goToGoal(bot, goal, null, { retry: false }), { name: 'Timeout' });
    assert.equal(gotos(), 7);
    errors = [timeout()];
    await assert.rejects(skills.moveAway(bot, 5), { name: 'Timeout' });
    assert.equal(gotos(), 8, 'moveAway is not retried (unstuck\'s 10 s timer)');
});

// --- REQ-TRV-5: the climb target --------------------------------------------------------------

test('REQ-TRV-5: climbTarget: a roof gives the top of her column + 1; an open 1-wide shaft its rim; open ground nothing; unloaded data nothing', async () => {
    const { climbTarget, CLIMB } = await import('../src/agent/work/climb.js');
    const target = bot => { const t = climbTarget(bot); return t && [...t.pos.toArray(), t.rim]; };
    const make = world => F.makeBot({ world, position: [0.5, 64, 0.5] });
    // A cave roof under a forest: the leaves above the ground are skipped, the ground is the roof (build r1 F5).
    const leaves = (world, x, y, z) => world.set(x, y, z, 'oak_leaves', { persistent: false, distance: '1', waterlogged: false });
    const roofed = flat();
    roofed.fill(-3, 67, -3, 3, 70, 3, 'stone');
    for (let y = 71; y <= 73; y++) leaves(roofed, 0, y, 0);
    leaves(roofed, 0, 75, 0);
    assert.deepEqual(target(make(roofed)), [0, 71, 0, false]);
    // A canopy over open ground is not a roof: nothing to climb (build r1 F5, PROBE-B).
    const canopy = flat();
    for (let y = 67; y <= 70; y++) leaves(canopy, 0, y, 0);
    assert.equal(target(make(canopy)), null, 'under a tree on open ground: a plain restart');
    // A 2-high cave under 98 stone: solid to the scan's limit, no target inside the rock (build r1 F4, PROBE-B).
    const deepCave = flat();
    deepCave.fill(-1, 66, -1, 1, 66 + 97, 1, 'stone');
    assert.equal(target(make(deepCave)), null, 'a deep cave: no target inside the rock');
    // The same with one air cell at the old scan limit (y + 64): the roof above it is still out of reach (build r2 F7).
    const pocket = flat();
    pocket.fill(-1, 66, -1, 1, 66 + 97, 1, 'stone');
    pocket.set(0, 64 + CLIMB.maxRise, 0, 'air');
    assert.equal(target(make(pocket)), null, 'a deep cave with an air pocket at y + 64: no target');
    // A roof exactly maxRise above her feet is within reach: its top + 1 (build r2 F7: the single-cell rule is gone).
    const high = flat();
    high.set(0, 64 + CLIMB.maxRise, 0, 'stone');
    assert.deepEqual(target(make(high)), [0, 64 + CLIMB.maxRise + 1, 0, false]);
    // An open 1-wide shaft 6 deep: its lowest rim.
    const shaft = flat();
    shaft.fill(-3, 64, -3, 3, 69, 3, 'stone');
    for (let y = 64; y <= 69; y++) shaft.set(0, y, 0, 'air');
    shaft.set(1, 70, 0, 'stone');   // one side a block higher: the lowest rim counts
    assert.deepEqual(target(make(shaft)), [0, 70, 0, true]);
    assert.equal(target(make(flat())), null, 'open ground: nothing to climb');
    // Unloaded: a null cell in her column stops the scan; null rim cells are not passable.
    const unloaded = make(roofed);
    const blockAt = unloaded.blockAt;
    unloaded.blockAt = pos => (pos.x === 0 && pos.z === 0 && pos.y === 80 ? null : blockAt(pos));
    assert.equal(target(unloaded), null);
    const dark = make(shaft);
    dark.blockAt = pos => (pos.x === 0 && pos.z === 0) || pos.y < 70 ? shaft.block(pos) : null;   // the walls known, above them not
    assert.equal(target(dark), null, 'no rim from unknown data');
    // A roof beyond maxRise is not seen.
    const deep = flat();
    deep.set(0, 64 + CLIMB.maxRise + 1, 0, 'stone');
    assert.equal(target(make(deep)), null);
});

test('REQ-TRV-5 (build r1 M5): climbOut clears its own goal at the end: after a second planning Timeout, and after a partial walk', async () => {
    const { climbOut } = await import('../src/agent/work/climb.js');
    for (const how of ['timeout', 'partial']) {
        const { bot } = setup({ world: cave(), modes: {} });
        bot.hooks.goto = goal => {
            bot.pathfinder.goal = goal;   // the real goto sets its goal, and leaves it when it throws or ends short
            if (how === 'timeout') throw timeout();
            return 'moved';   // ends where she stands, short of the roof
        };
        const { outcome } = await climbOut(bot, { ms: 5000 });
        assert.equal(outcome, 'failed', how);
        assert.equal(bot.pathfinder.goal, null, `no climb goal left running: ${how}`);
    }
});

// --- config ------------------------------------------------------------------------------------

test('§7: work.travel.resume_max defaults to 20, merges, and a bad value keeps the default', () => {
    const { loadWorkConfig } = F.modules.config;
    assert.equal(loadWorkConfig({}).travel.resume_max, 20);
    assert.equal(loadWorkConfig({ travel: { resume_max: 0 } }).travel.resume_max, 0);
    for (const bad of [-1, 1.5, '20', null]) assert.equal(loadWorkConfig({ travel: { resume_max: bad } }).travel.resume_max, 20, String(bad));
});

test('§14 (DECISIONS 2026-11-14): the safety keys default to health above 10, no hostile within 16 for 5 s, within 60 s; they merge, a bad value keeps the default', () => {
    const { loadWorkConfig } = F.modules.config;
    assert.deepEqual(loadWorkConfig({}).travel, { resume_max: 20, safe_health: 10, safe_radius: 16, safe_quiet_s: 5, safe_wait_s: 60 });
    assert.deepEqual(loadWorkConfig({ travel: { safe_quiet_s: 0 } }).travel, { resume_max: 20, safe_health: 10, safe_radius: 16, safe_quiet_s: 0, safe_wait_s: 60 });
    for (const [key, bad] of [['safe_health', -1], ['safe_radius', 0], ['safe_quiet_s', 1.5], ['safe_wait_s', 0], ['safe_wait_s', '60']])
        assert.equal(loadWorkConfig({ travel: { [key]: bad } }).travel[key], loadWorkConfig({}).travel[key], `${key} ${JSON.stringify(bad)}`);
});

// --- the fixes in the blast radius (design §3) ---------------------------------------------

test('§3: a cut !goToPlayer no longer cancels a pending resume slot (it returns false instead of throwing)', async () => {
    const { agent, bot } = setup({ modes: {} });
    F.player(bot, F.OWNER, [10.5, 64, 0.5]);
    const follow = async () => {};
    agent.actions.resume_func = follow;
    agent.actions.resume_name = FOLLOW;
    let walking = false;
    bot.hooks.goto = async goal => {
        if (!goal.entity) return;
        walking = true;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
    };
    const typed = F.ownerSays(agent, `!goToPlayer("${F.OWNER}", 3)`);
    await F.until(() => walking);
    await agent.actions.runAction('mode:cowardice', async () => {});
    await typed;
    assert.equal(agent.actions.resume_func, follow, 'the follow stays pending');
    assert.match(agent.turns.map(t => t.content).join('\n'), /Pathfinding stopped: Path was stopped/);
    agent.actions.cancelResume();
});

test('§3 (REQ-TRV-1, S4): an interrupted mode action keeps a pending follow: kept walk, unstuck, self_preservation cuts its moveAway', async () => {
    const { agent, bot } = setup({ modes: { unstuck: true } });
    const clock = fastClock();
    const follow = async () => {};
    agent.actions.resume_func = follow;
    agent.actions.resume_name = FOLLOW;
    let away = false;
    const w = walker(bot, { others: async goal => {
        if (!goal.goal) return undefined;   // GoalInvert: moveAway
        away = true;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
        return undefined;
    } });
    const typed = F.ownerSays(agent, '!goToCoordinates(20, 64, 0, 1)');
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => away);
    await agent.actions.runAction('mode:self_preservation', async () => {});
    await F.sleep(30);
    assert.equal(agent.actions.resume_func, follow, 'the follow stays pending');
    w.release();
    bot.interrupt_code = true;
    await typed;
    agent.actions.cancelResume();
});

test('§3 (S4, build r1 M8): the execute() catch covers every mode: self_preservation\'s own moveAway, cut, keeps a pending follow', async () => {
    const world = flat();
    world.set(0, 65, 0, 'sand');   // falling sand at her head: the real self_preservation moves away
    const { agent, bot } = setup({ world, modes: { self_preservation: true } });
    const follow = async () => {};
    agent.actions.resume_func = follow;
    agent.actions.resume_name = FOLLOW;
    let away = false;
    bot.hooks.goto = async goal => {
        if (!goal.goal) return undefined;   // GoalInvert: moveAway
        world.set(0, 65, 0, 'air');
        away = true;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
        return undefined;   // the fixture's goto then throws PathStopped, as the real one does
    };
    void bot.modes.update();
    await F.until(() => away);
    await agent.actions.runAction('mode:self_defense', async () => {});   // cuts self_preservation's moveAway
    await F.sleep(30);
    assert.equal(agent.actions.resume_func, follow, 'the follow stays pending');
    agent.actions.cancelResume();
});

// I1-9 (DECISIONS 2026-11-14) as narrowed by fix wave 1 (build2 r1 rulings):
// only a cut task run keeps its resume over a mode's own error; any other cut
// keeps upstream's cancel-and-ask (the only stop for a failing unstuck on a follow).
async function failingUnstuck(t, label) {
    const { agent, bot } = setup({ modes: { unstuck: true } });
    const clock = fastClock();
    const lines = logs();
    const errors = t.mock.method(console, 'error', () => {});
    const resume = async () => {};
    agent.actions.resume_func = resume;
    agent.actions.resume_name = label;
    bot.hooks.goto = async goal => {
        if (goal.goal) throw new Error('no path');   // GoalInvert: unstuck's moveAway fails at once
    };
    const cut = cutBy(agent, label);   // the follow or the task run, standing still
    await F.until(() => agent.actions.currentActionLabel === label);
    await clock.stuck(agent);
    await F.until(() => lines.some(l => l.startsWith('Mode unstuck finished')));
    await F.sleep(20);
    const kept = agent.actions.resume_func === resume;
    agent.actions.cancelResume();
    await cut.end();
    return { kept, lines, errors };
}

test('I1-9 fix wave 1: unstuck failing on a follow is thrown as upstream: the follow\'s resume is cancelled', async t => {
    const { kept, lines } = await failingUnstuck(t, FOLLOW);
    assert.equal(kept, false, `the follow is not resumed into the same failure\n${lines.join('\n')}`);
    assert.ok(lines.some(l => /Mode unstuck finished executing, code_return: Action output:[\s\S]*!!Code threw exception!![\s\S]*no path/.test(l)), lines.join('\n'));
});

test('I1-9: unstuck failing on a task run is logged and keeps the task\'s resume (the stall rule bounds it)', async t => {
    const { kept, lines, errors } = await failingUnstuck(t, 'action:task');
    assert.equal(kept, true, 'the task resume stays');
    assert.ok(errors.mock.calls.some(c => c.arguments[0] === 'Mode unstuck failed:' && /no path/.test(String(c.arguments[1]))));
    assert.ok(!lines.some(l => /!!Code threw exception!!/.test(l)), lines.join('\n'));
});

test('§3 (REQ-TRV-3, G1): an interrupted moveAway in unstuck clears its 10 s kill timer', async () => {
    const { agent, bot } = setup({ modes: { unstuck: true } });
    const clock = fastClock();
    const timers = killTimers();
    let away = false;
    const w = walker(bot, { others: async goal => {
        if (!goal.goal) return undefined;
        away = true;
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
        return undefined;
    } });
    void F.ownerSays(agent, '!goToCoordinates(20, 64, 0, 1)');
    await F.until(() => w.starts === 1);
    await clock.stuck(agent);
    await F.until(() => away);
    await agent.actions.runAction('action:stay', async () => {});
    await F.sleep(30);
    assert.equal(timers.live(), 0, 'every 10 s kill timer is cleared');
    assert.equal(agent.killed, null);
});

test('§3 (S2): giveToPlayer with an unreachable player tosses nothing and returns false, on either approach', async () => {
    const { bot } = setup({ modes: {}, position: [0.5, 64, 0.5] });
    bot.give('stick', 4);
    const him = F.player(bot, F.OWNER, [12.5, 64, 0.5]);
    bot.hooks.goto = () => { throw new Error('No path to the goal!'); };
    assert.equal(await skills.giveToPlayer(bot, 'stick', F.OWNER, 2), false);
    assert.equal(bot.calls.filter(c => c[0] === 'toss').length, 0);
    assert.match(bot.output, /Failed to give stick to steve: could not reach them\./);
    // The second approach (he stands 2 above her): the first reaches, the second fails.
    him.position = at(3.5, 67, 0.5);
    bot.output = '';
    let gotos = 0;
    bot.hooks.goto = () => { if (++gotos === 2) throw new Error('No path to the goal!'); bot.entity.position = at(1.5, 64, 0.5); return 'moved'; };
    assert.equal(await skills.giveToPlayer(bot, 'stick', F.OWNER, 2), false);
    assert.equal(gotos, 2);
    assert.equal(bot.calls.filter(c => c[0] === 'toss').length, 0);
    assert.match(bot.output, /could not reach them/);
});

test('§3 (N2): the give step fails at once when giveToPlayer returns false with nothing tossed (no confirm wait); unreachable too', async () => {
    GIVE.confirmMs = 3000;
    const { bot } = setup({ modes: {} });
    bot.give('stick', 4);
    F.player(bot, F.OWNER, [3.5, 64, 0.5]);
    const ctx = { bot, call: (label, fn) => fn(), checkpoint: () => {} };
    const step = () => ({ args: { player: F.OWNER, item: 'stick', count: 2 }, progress: {} });
    bot.currentWindow = { id: 1 };   // a container open: giveToPlayer gives nothing and returns false
    let t = Date.now();
    assert.deepEqual(await GIVE.unit(ctx, step()), { failed: `could not give stick to ${F.OWNER}` });
    assert.ok(Date.now() - t < 1000, `failed after ${Date.now() - t} ms`);
    bot.currentWindow = null;
    bot.hooks.goto = () => { throw new Error('No path to the goal!'); };
    t = Date.now();
    const unreachable = await GIVE.unit(ctx, step()).catch(err => ({ threw: err.message }));
    assert.deepEqual(unreachable, { failed: `could not give stick to ${F.OWNER}` });
    assert.ok(Date.now() - t < 1000, `failed after ${Date.now() - t} ms`);
    assert.equal(bot.count('stick'), 4, 'nothing tossed');
});

// --- helpers that need the module above ------------------------------------------------------

// Date.now, moved forward monotonically: unstuck's 20 s stuck window in one
// update. Only ever forward, so every elapsed time stays consistent; restored after the test.
function fastClock() {
    const real = Date.now;
    let offset = 0;
    Date.now = () => real() + offset;
    stops.push(() => { Date.now = real; });
    return {
        // unstuck notes where she is, then 21 s later fires (modes.js unstuck).
        // The modes are module state: a pause and unpause clears what an
        // earlier test left in unstuck (its unpause resets the window).
        async stuck(agent) {
            agent.bot.modes.pause('unstuck');
            agent.bot.modes.unpause('unstuck');
            await agent.bot.modes.update();
            offset += 21000;
            await agent.bot.modes.update();
        },
    };
}

// The 10 s timers (unstuck's cleanKill, ActionManager.stop's) that are still set.
function killTimers() {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const live = new Set();
    globalThis.setTimeout = (fn, ms, ...rest) => {
        const t = realSet(fn, ms, ...rest);
        if (ms === 10000) live.add(t);
        return t;
    };
    globalThis.clearTimeout = t => { live.delete(t); return realClear(t); };
    stops.push(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; for (const t of live) realClear(t); });
    return { live: () => live.size };
}
