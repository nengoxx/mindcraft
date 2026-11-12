import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2d: sleeping through the night (SPEC §7.9 REQ-SLP-1 … 10, REQ-RES-16's
// hold, REQ-OWN-2's own bed) on the real ActionManager, modes, handleMessage,
// ledger, Protector and dig seam; the bed, sleep and wake are the fixture's.
const { sleep: S, config: C, pf } = F.modules;
const SLEEP = S.SLEEP;
const DEFAULTS = { ...SLEEP };
const FAST = { cooldownMs: 150, skipWaitMs: 250, wakeMs: 150, walkMs: 400, pollMs: 10, dropWaitMs: 80, receiptMs: 60000 };
const agents = [];
const stops = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); F.cleanup(agents.splice(0)); Object.assign(SLEEP, DEFAULTS); });
beforeEach(() => { F.useSettings(); Object.assign(SLEEP, DEFAULTS, FAST); });

const at = (x, y, z) => new F.Vec3(x, y, z);
const NIGHT = { timeOfDay: 13000, day: 5 };
const DAY = { timeOfDay: 6000, day: 5 };
const DIRS = { south: [0, 1], west: [-1, 0], north: [0, -1], east: [1, 0] };

// Stone ground with its top at y 63: the bot stands at y 64.
function ground() {
    const world = new F.World();
    world.fill(-12, 59, -12, 12, 63, 12, 'stone');
    return world;
}

// A server's bed, sleep and wake, simplified. A bed placed by clicking the
// top of F's support goes foot at F, head one further the way she looks
// (from her cell to F) unless `bot.hooks.bedFacing` says otherwise; the
// placement resolves on the foot, and the head arrives `headMs` later in its
// own update (live 2026-11-12: 1 ms after the foot's);
// `bot.hooks.placeBed` may throw (a refusal). bot.sleep lies her down (its
// hook may throw first); with `skip`, the night skips `skipMs` later: the
// time jumps to the next morning and the server wakes her. bot.wake gets her
// up 5 ms later (`wakes: false`: never). Digging either half removes both
// and drops one bed at the foot (`drops: false`: none); a walk ending within
// 1.5 blocks of a dropped item takes it (contact pickup).
function bedServer(bot, { time = NIGHT, skip = true, skipMs = 30, wakes = true, drops = true, headMs = 5 } = {}) {
    bot.time = { ...time };
    bot.isSleeping = false;
    const place = bot.placeBlock;
    bot.placeBlock = async (reference, face) => {
        const name = bot.heldItem?.name;
        if (!name?.endsWith('_bed')) return place(reference, face);
        const foot = reference.position.plus(face);
        const me = bot.entity.position.floored();
        let facing = Object.entries(DIRS).find(([, [x, z]]) => x === Math.sign(foot.x - me.x) && z === Math.sign(foot.z - me.z))?.[0] ?? 'south';
        facing = bot.hooks.bedFacing ?? facing;
        if (bot.hooks.placeBed) await bot.hooks.placeBed(foot);
        const [x, z] = DIRS[facing];
        const old = bot.world.block(foot);
        bot.world.set(foot.x, foot.y, foot.z, name, { facing, part: 'foot', occupied: false });
        setTimeout(() => bot.world.set(foot.x + x, foot.y, foot.z + z, name, { facing, part: 'head', occupied: false }), headMs);
        bot.take(name, 1);
        if (!bot.count(name)) bot.heldItem = null;
        bot.calls.push(['place', name, foot.toString(), facing]);
        bot.emit('blockPlaced', old, bot.world.block(foot));
    };
    bot.sleep = async bed => {
        bot.calls.push(['sleep', bed.position.toString()]);
        if (bot.hooks.sleep) await bot.hooks.sleep(bed);
        bot.isSleeping = true;
        bot.emit('sleep');
        if (skip) setTimeout(() => {
            if (!bot.isSleeping) return;
            bot.time = { timeOfDay: 23, day: bot.time.day + 1 };
            bot.isSleeping = false;
            bot.emit('wake');
        }, skipMs);
    };
    bot.wake = async () => {
        if (!bot.isSleeping) throw new Error('already awake');
        bot.calls.push(['wake']);
        if (wakes) setTimeout(() => { bot.isSleeping = false; bot.emit('wake'); }, 5);
    };
    bot.hooks.dig = async block => {
        if (!block.name.endsWith('_bed')) return;
        const p = block.getProperties();
        const [x, z] = DIRS[p.facing];
        const s = p.part === 'foot' ? 1 : -1;
        const other = block.position.offset(x * s, 0, z * s);
        if (bot.world.block(other).name === block.name) bot.setBlock(other.x, other.y, other.z, 'air');
        if (drops) {
            const foot = p.part === 'foot' ? block.position : other;
            const id = 9000 + bot.calls.length;
            bot.entities[id] = { id, name: 'item', type: 'object', position: foot.offset(0.5, 0.2, 0.5), getDroppedItem: () => ({ name: block.name, count: 1 }) };
        }
    };
    bot.hooks.goto = async goal => {
        if (goal.x === undefined) return null;
        bot.entity.position = new F.Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
        for (const e of Object.values(bot.entities)) {
            if (e.name !== 'item' || e.position.distanceTo(bot.entity.position) > 1.5) continue;
            const { name, count } = e.getDroppedItem();
            bot.give(name, count);
            delete bot.entities[e.id];
        }
        return 'moved';
    };
}

let n = 0;
function setup({ world = ground(), position = [0.5, 64, 0.5], inventory = { black_bed: 1 }, modes = { sleeping: true }, work = {},
    drive = true, server = {}, ownerAt = [8, 64, 8], now, name, keep = false, init_message = null } = {}) {
    const bot = F.makeBot({ world, position, inventory });
    if (ownerAt) F.player(bot, F.OWNER, ownerAt);
    bedServer(bot, server);
    const agent = F.makeAgent({ bot, modes, work, name: name ?? `sleep${n++}` });
    if (!keep) F.clearRecord(agent);
    agent.respondFunc = async (username, message) => agent.handleMessage(username, message);
    F.startWork(agent, { now, init_message });
    agent.work.lineGapMs = 5;
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}

const calls = (bot, kind) => bot.calls.filter(c => c[0] === kind);
const myBeds = agent => agent.work.ledger.list().filter(e => e.kind === 'own' && e.by === 'mode:sleeping' && !e.removed_at);
// The record of one night (by default the test's first, day 5), read without creating it.
const night = (agent, id = 5) => agent.work.sleeper.nights.get(id) ?? {};
const idle = agent => F.until(() => !agent.actions.executing && !agent.work.sleeper.running && !agent.work.sleeper.latch, { timeout: 4000 });

// A bed of hers already placed (as the routine records it): foot at F, facing.
function placedBed(agent, x, y, z, facing = 'south', block = 'black_bed') {
    const [dx, dz] = DIRS[facing];
    agent.bot.world.set(x, y, z, block, { facing, part: 'foot', occupied: false });
    agent.bot.world.set(x + dx, y, z + dz, block, { facing, part: 'head', occupied: false });
    const entry = { pos: { x, y, z }, block, kind: 'own', by: 'mode:sleeping', dim: 'overworld', at: Date.now() };
    agent.work.ledger.add(entry);
    return entry;
}

// --- the resume-timeout carry (junk design r7 §5, amendment 2) -------------------

// The timeout each _executeAction run got, by label.
function timeouts(agent) {
    const seen = [];
    const run = agent.actions._executeAction;
    agent.actions._executeAction = function (label, fn, timeout) {
        seen.push([label, timeout]);
        return run.call(this, label, fn, timeout);
    };
    return seen;
}

test('a cut follow resumes with timeout -1 (the ActionManager keeps a resumable action\'s timeout); one started with none resumes with the default', async () => {
    const bot = F.makeBot();
    const agent = F.makeAgent({ bot, modes: { self_defense: true }, name: 'sleep-resume' });
    agents.push(agent);
    stops.push(F.drive(agent));
    const seen = timeouts(agent);
    let follows = 0;
    const follow = async () => {
        follows++;
        while (!bot.interrupt_code) await F.sleep(10);
    };
    // !followPlayer: runAsAction(fn, resume = true, timeout = -1) (actions.js:6, :147).
    void agent.actions.runAction('action:followPlayer', follow, { resume: true, timeout: -1 });
    await F.until(() => follows === 1);
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => follows === 2, { timeout: 6000 });
    assert.deepEqual(seen.filter(([label]) => label === 'action:followPlayer'), [['action:followPlayer', -1], ['action:followPlayer', -1]]);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
    await F.until(() => !agent.actions.executing);
    // Control: a resumable action started with no timeout resumes with upstream's default (10 minutes).
    bot.interrupt_code = false;
    seen.length = 0;
    let runs = 0;
    void agent.actions.runAction('action:other', async () => { runs++; while (!bot.interrupt_code) await F.sleep(10); }, { resume: true });
    await F.until(() => runs === 1);
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => runs === 2, { timeout: 6000 });
    assert.deepEqual(seen.filter(([label]) => label === 'action:other'), [['action:other', 10], ['action:other', 10]]);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

// --- config (SPEC §14) ----------------------------------------------------------------

test('work.sleep merges one level deep (when: always, max_mode_cuts: 6 by default; no announce key); an unknown when is logged once and means always', () => {
    assert.deepEqual(C.loadWorkConfig({}).sleep, { when: 'always', max_mode_cuts: 6 });
    assert.deepEqual(C.loadWorkConfig({ sleep: { when: 'idle' } }).sleep, { when: 'idle', max_mode_cuts: 6 });
    assert.deepEqual(C.loadWorkConfig({ sleep: { max_mode_cuts: 2 } }).sleep, { when: 'always', max_mode_cuts: 2 });
    assert.deepEqual(C.loadWorkConfig({ sleep: { announce: false } }).sleep, { when: 'always', max_mode_cuts: 6 });   // no such key
    assert.equal(C.WORK_DEFAULTS.sleep.when, 'always');
    const agent = setup({ drive: false, work: { sleep: { when: 'sometimes', max_mode_cuts: 0 } } });
    assert.equal(agent.work.sleeper.when(), 'always');
    assert.equal(agent.work.sleeper.when(), 'always');
    assert.equal(agent.work.sleeper.maxModeCuts(), 6, 'not a positive integer: the default');
});

// --- when she sleeps (REQ-SLP-2) -----------------------------------------------------------

test('next(): night in the overworld with a bed (or my bed within 16), the night not done, no cooldown, no hostile in the bed box, under work.sleep.when', () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    const sleeper = agent.work.sleeper;
    const fires = () => typeof sleeper.next() === 'function';
    assert.equal(fires(), true);
    bot.time = { ...DAY };
    assert.equal(fires(), false, 'day');
    bot.time = { timeOfDay: 12540, day: 5 };
    assert.equal(fires(), false, 'before the window');
    bot.time = { timeOfDay: 23001, day: 5 };
    assert.equal(fires(), false, 'too late to be worth a bed');
    bot.time = { timeOfDay: 12541, day: 5 };
    assert.equal(fires(), true, 'the window starts at 12541');
    bot.game.dimension = 'the_nether';
    assert.equal(fires(), false, 'not the overworld');
    bot.game.dimension = 'overworld';
    bot.take('black_bed', 1);
    assert.equal(fires(), false, 'no bed');
    const entry = placedBed(agent, 3, 64, 0);
    assert.equal(fires(), true, 'my bed within 16');
    agent.work.ledger.retire(entry.pos, 'test');
    placedBed(agent, 0, 64, 12);
    assert.equal(fires(), true, 'my bed 11.5 away');
    agent.work.ledger.retire({ x: 0, y: 64, z: 12 }, 'test');
    bot.world.fill(0, 64, 12, 0, 64, 13, 'air');
    bot.world.fill(-12, 59, 20, 12, 63, 21, 'stone');
    placedBed(agent, 0, 64, 20);
    assert.equal(fires(), false, 'my bed beyond 16');
    bot.give('black_bed', 1);
    assert.equal(fires(), true);
    const zombie = F.hostile(bot, 'zombie', [7, 0, 0]);
    assert.equal(fires(), false, 'a hostile in the bed box');
    delete bot.entities[zombie.id];
    sleeper.cooldownUntil = Date.now() + 1000;
    assert.equal(fires(), false, 'cooldown after a failed try');
    sleeper.cooldownUntil = 0;
    sleeper.markDone(5, 'test');
    assert.equal(fires(), false, 'the night is done');
    bot.time = { timeOfDay: 13000, day: 6 };
    assert.equal(fires(), true, 'the next night');
    agent.work.config.sleep = { when: 'off' };
    assert.equal(fires(), false, 'work.sleep.when off');
    agent.work.config.sleep = { when: 'always' };
    bot.modes.setOn('sleeping', false);
    assert.equal(fires(), false, '!setMode sleeping off');
    bot.modes.setOn('sleeping', true);
});

test('next(): what sleep may cut, under always and idle (never a mode, tidy, the bed pickup, a one-off action; a follow not while a goal is ACTIVE; a goal\'s action not while its model call is in flight)', () => {
    const agent = setup({ drive: false });
    const sleeper = agent.work.sleeper;
    const actions = agent.actions;
    const sp = agent.self_prompter;
    const fires = () => typeof sleeper.next() === 'function';
    const running = (label, { resume = false, start = null } = {}) => {
        actions.executing = Boolean(label);
        actions.currentActionLabel = label ?? '';
        actions.resume_func = resume ? () => {} : null;
        actions.resume_name = resume ? label : null;
        agent.work.lastStart = start ?? { label, voice: 'owner', goal: false };
    };
    const goal = (on, loop = on) => { sp.state = on ? 1 : 0; sp.loop_active = loop; };
    try {
        running(null);
        assert.equal(fires(), true, 'idle');
        running('action:task', { resume: true });
        assert.equal(fires(), true, 'the task run');
        running('action:followPlayer', { resume: true });
        assert.equal(fires(), true, 'the pending resumable owner action');
        for (const label of ['mode:self_defense', 'mode:unstuck', 'action:tidy', 'action:bed', 'action:goToPlayer', 'action:collectBlocks'])
            { running(label); assert.equal(fires(), false, label); }
        actions.stopPromise = Promise.resolve();
        running(null);
        assert.equal(fires(), false, 'a stop in progress');
        actions.stopPromise = null;
        goal(true);
        running('action:followPlayer', { resume: true });
        assert.equal(fires(), false, 'a resumable action while a goal is ACTIVE is waited out');
        running(null);
        assert.equal(fires(), false, 'the goal\'s model call is in flight');
        goal(true, false);
        assert.equal(fires(), true, 'a goal between turns');
        goal(true);
        running('action:collectBlocks', { start: { label: 'action:collectBlocks', voice: 'own', goal: true } });
        assert.equal(fires(), true, 'a goal\'s own action');
        for (const label of ['mode:self_defense', 'action:tidy', 'action:bed'])
            { running(label, { start: { label, voice: 'own', goal: true } }); assert.equal(fires(), false, `${label} during a goal`); }
        running('mode:self_defense', { resume: true });
        assert.equal(fires(), false, 'a mode is never cut, whatever resume slot it shows');
        running('action:collectBlocks', { start: { label: 'action:collectBlocks', voice: 'owner', goal: true } });
        assert.equal(fires(), false, 'an owner\'s one-off action during a goal');
        goal(false);
        running('action:collectBlocks', { start: { label: 'action:collectBlocks', voice: 'own', goal: false } });
        assert.equal(fires(), false, 'a one-off action with no goal');
        // work.sleep.when idle: nothing to do at all.
        agent.work.config.sleep = { when: 'idle' };
        running(null);
        assert.equal(fires(), true, 'idle, nothing to do');
        running('action:task', { resume: true });
        assert.equal(fires(), false, 'idle: the task run is not cut');
        running(null);
        actions.resume_func = () => {};
        assert.equal(fires(), false, 'idle: a resume pending');
        actions.resume_func = null;
        goal(true, false);
        assert.equal(fires(), false, 'idle: a goal active');
        goal(false);
        agent.work.record = { status: 'active' };
        assert.equal(fires(), false, 'idle: a task active');
    } finally {
        agent.work.record = null;
        goal(false);
        running(null);
    }
});

// --- the spot (REQ-SLP-3) ------------------------------------------------------------------

test('the spot: nearest first, F and H air with air above and a full floor, no liquid beside, nobody in B, F or H, not in a clear box or shell, no hostile near the head; up to 3', () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    const sleeper = agent.work.sleeper;
    const first = () => { const s = sleeper.spots()[0]; return s && [s.B.toString(), s.facing]; };
    assert.deepEqual(first(), [at(0, 64, 0).toString(), 'south']);
    assert.equal(sleeper.spots().length, 3);
    bot.world.set(0, 64, 2, 'short_grass');
    assert.deepEqual(first(), [at(0, 64, 0).toString(), 'west'], 'grass in H: not air');
    bot.world.set(0, 64, 2, 'air');
    bot.world.set(0, 65, 1, 'stone');
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'no room above');
    bot.world.set(0, 65, 1, 'air');
    bot.world.set(1, 64, 1, 'water');
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'next to water');
    bot.world.set(1, 64, 1, 'air');
    bot.world.set(0, 63, 2, 'oak_slab', { type: 'bottom', waterlogged: false });
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'no full floor');
    bot.world.set(0, 63, 2, 'stone');
    F.player(bot, 'alex', [0.5, 64, 1.5]);
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'someone is there');
    delete bot.players.alex;
    for (const id of Object.keys(bot.entities)) if (bot.entities[id].username === 'alex') delete bot.entities[id];
    agent.work.clearScope = () => ({ inBox: p => p.z === 2, inShell: () => false });
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'in a clear box');
    agent.work.clearScope = () => ({ inBox: () => false, inShell: p => p.y === 63 && p.z === 1 });
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'in a clear box', 'a support in the kept shell');
    delete agent.work.clearScope;
    const zombie = F.hostile(bot, 'zombie', [0, 0, 9]);
    assert.equal(sleeper.spotProblem(at(0, 64, 0), at(0, 0, 1)), 'a hostile is near');
    delete bot.entities[zombie.id];
    // A tunnel 1 high: nowhere.
    const tunnel = new F.World();
    tunnel.fill(-12, 59, -12, 12, 63, 12, 'stone');
    tunnel.fill(-12, 65, -12, 12, 70, 12, 'stone');
    bot.world.blocks = tunnel.blocks;
    assert.deepEqual(sleeper.spots(), []);
    // A step up: standing in a pit, the nearest spot is one higher.
    const pit = new F.World();
    pit.fill(-12, 59, -12, 12, 64, 12, 'stone');
    pit.set(0, 64, 0, 'air');
    bot.world.blocks = pit.blocks;
    const spot = sleeper.spots()[0];
    assert.equal(spot.B.y, 65);
});

// --- the routine (REQ-SLP-3 … 5) ---------------------------------------------------------------

test('idle at night: she places the bed from her cell (foot, then head the way she looks), sleeps, the night skips, she digs the foot under the ownBed exemption and walks to the drop; 0 model calls', async () => {
    const agent = setup();
    const { bot } = agent;
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.deepEqual(calls(bot, 'place'), [['place', 'black_bed', at(0, 64, 1).toString(), 'south']]);
    assert.deepEqual(calls(bot, 'sleep'), [['sleep', at(0, 64, 1).toString()]]);
    assert.deepEqual(calls(bot, 'dig').map(c => c[2]), [at(0, 64, 1).toString()]);
    assert.equal(calls(bot, 'wake').length, 0, 'never wake() when the server woke her');
    assert.equal(bot.count('black_bed'), 1);
    assert.equal(bot.world.block(at(0, 64, 1)).name, 'air');
    assert.equal(bot.world.block(at(0, 64, 2)).name, 'air');
    assert.equal(night(agent).why, 'slept');
    assert.equal(agent.work.sleeper.receipt, null);
    assert.equal(agent.modelCalls, 0);
    assert.match(bot.modes.behavior_log, /Sleeping\.\nTook my bed back\./);
    assert.equal(agent.chats.length, 0, 'nothing said');
    agent.work.ledger.flush();
    assert.equal(F.ledgerEntries(agent).some(e => e.block === 'black_bed'), false, 'gone from the file after the pickup');
});

test('the head half arriving after the placement resolves (its own update) is waited for: the first try sleeps', async () => {
    const agent = setup({ server: { headMs: 40 } });
    const { bot } = agent;
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(night(agent).why, 'slept');
    assert.equal(night(agent).tries ?? 0, 0, 'no failed try');
    assert.deepEqual(calls(bot, 'dig').map(c => c[2]), [at(0, 64, 1).toString()], 'dug once, after the sleep');
    assert.equal(bot.count('black_bed'), 1);
});

test('the bed entry is own by mode:sleeping and is in the file before bot.sleep (the synchronous flush)', async () => {
    const agent = setup({ server: { skip: false } });
    const { bot } = agent;
    let written = null;
    bot.hooks.sleep = async () => { written = F.ledgerEntries(agent).filter(e => e.block === 'black_bed'); };
    await F.until(() => bot.isSleeping, { timeout: 4000 });
    assert.deepEqual(written.map(({ pos, kind, by, dim }) => ({ pos, kind, by, dim })), [{ pos: { x: 0, y: 64, z: 1 }, kind: 'own', by: 'mode:sleeping', dim: 'overworld' }]);
    assert.ok(agent.work.ledger.get({ x: 0, y: 64, z: 1 }));
});

test('the night does not skip: after the skip wait she gets up (guarded wake), tells the owner once per session, picks the bed up, and the night is done', async () => {
    const agent = setup({ server: { skip: false } });
    const { bot } = agent;
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(bot, 'wake').length, 1);
    assert.equal(bot.count('black_bed'), 1);
    assert.equal(night(agent).why, 'the night did not skip');
    await F.until(() => agent.chats.includes('The night did not skip, so I got up.'));
    // The next night: the same, said no more.
    bot.time = { timeOfDay: 13000, day: 6 };
    await F.until(() => night(agent, 6).done && !agent.work.sleeper.running, { timeout: 4000 });
    await F.sleep(50);
    assert.equal(agent.chats.filter(c => /did not skip/.test(c)).length, 1);
    assert.equal(bot.count('black_bed'), 1);
});

test('a refused placement and a refused sleep are failed tries (the bed picked up before the routine returns); 3 failed tries end the night, with the cooldown between them', async () => {
    const agent = setup();
    const { bot } = agent;
    let refusals = 0;
    bot.hooks.sleep = async () => { refusals++; throw new Error('there are monsters nearby'); };
    const starts = [];
    const routine = agent.work.sleeper.routine.bind(agent.work.sleeper);
    agent.work.sleeper.routine = id => { starts.push(Date.now()); return routine(id); };
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 6000 });
    assert.equal(refusals, 3);
    assert.equal(night(agent).tries, 3);
    assert.equal(night(agent).why, '3 failed tries');
    assert.equal(bot.count('black_bed'), 1, 'each try picked its bed up');
    assert.equal(myBeds(agent).length, 0);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= SLEEP.cooldownMs - 5, 'the cooldown');
    await F.sleep(200);
    assert.equal(refusals, 3, 'no fourth try');
    // A refused placement: nothing placed, a failed try.
    SLEEP.cooldownMs = 5000;
    const second = setup({ name: 'sleep-refused' });
    second.bot.hooks.placeBed = async () => { throw new Error('Server refused to place black_bed'); };
    await F.until(() => night(second).tries >= 1, { timeout: 4000 });
    assert.equal(second.bot.count('black_bed'), 1);
    assert.equal(calls(second.bot, 'sleep').length, 0);
});

test('a bed placed facing elsewhere (head not where planned) is picked up and the try fails', async () => {
    SLEEP.cooldownMs = 5000;
    const agent = setup();
    const { bot } = agent;
    bot.hooks.bedFacing = 'east';
    await F.until(() => night(agent).tries >= 1 && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(bot, 'sleep').length, 0);
    assert.deepEqual(calls(bot, 'dig').map(c => c[2]), [at(0, 64, 1).toString()]);
    assert.equal(bot.count('black_bed'), 1);
    assert.equal(bot.world.block(at(1, 64, 1)).name, 'air', 'both halves gone');
});

test('my bed within 16 is reused at night (no second bed placed); a crash restart finds it in the ledger', async () => {
    const first = setup({ drive: false, inventory: {}, name: 'sleep-reuse', server: { time: DAY } });
    placedBed(first, 4, 64, 4);
    first.work.ledger.flush();
    first.work.dispose();
    // The restart: same bot data, the bed still in the world.
    const agent = setup({ inventory: {}, name: 'sleep-reuse', keep: true, init_message: 'Agent process restarted.', world: first.bot.world, server: { time: NIGHT } });
    const { bot } = agent;
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(bot, 'place').length, 0);
    assert.deepEqual(calls(bot, 'sleep'), [['sleep', at(4, 64, 4).toString()]]);
    assert.equal(bot.count('black_bed'), 1, 'and taken back after the night');
});

test('my bed that no longer validates (water beside its head) is not slept in: a failed try, no second bed', async () => {
    SLEEP.cooldownMs = 5000;
    const agent = setup({ drive: false, inventory: { black_bed: 1 } });
    const { bot } = agent;
    placedBed(agent, 4, 64, 4);
    bot.world.set(5, 64, 5, 'water');   // beside the head (4 64 5) only
    stops.push(F.drive(agent));
    await F.until(() => night(agent).tries >= 1 && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(bot, 'sleep').length, 0);
    assert.equal(calls(bot, 'place').length, 0);
});

test('a walk that does not arrive in the stand cell places nothing; with no spot reached the try fails', async () => {
    SLEEP.cooldownMs = 5000;
    const agent = setup({ drive: false });
    const { bot } = agent;
    F.player(bot, 'alex', [0.5, 64, 0.5]);   // in her own cell: the nearest spot is not hers
    bot.hooks.goto = async () => 'moved';    // every walk "ends" where she stands
    stops.push(F.drive(agent));
    await F.until(() => night(agent).tries >= 1 && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(bot, 'place').length, 0);
    assert.equal(bot.count('black_bed'), 1);
});

test('the guarded wake: never wake() when awake; an unconfirmed wake returns within the bound, is logged and is a detail line', async () => {
    const agent = setup({ drive: false, server: { wakes: false } });
    const { bot } = agent;
    const sleeper = agent.work.sleeper;
    let threw = false;
    bot.wake = async () => { bot.calls.push(['wake']); if (!bot.isSleeping) { threw = true; throw new Error('already awake'); } };
    assert.equal(await sleeper.wakeUp(), true);
    assert.equal(calls(bot, 'wake').length, 0, 'awake: no wake()');
    bot.isSleeping = true;
    const t = Date.now();
    assert.equal(await sleeper.wakeUp(), false);
    assert.ok(Date.now() - t < SLEEP.wakeMs + 100);
    assert.equal(threw, false);
    await F.until(() => agent.turns.some(turn => turn.content === 'I could not get out of bed; I am still asleep.'));
    bot.isSleeping = false;
});

// --- owner control (REQ-SLP-7) ------------------------------------------------------------------

test('!stop in bed: the guarded wake under the stop watchdog, the night is done, and the bed is taken back once she is idle (action:bed)', async () => {
    const agent = setup({ server: { skip: false } });
    const { bot } = agent;
    await F.until(() => bot.isSleeping, { timeout: 4000 });
    const t = Date.now();
    await F.ownerSays(agent, '!stop');
    assert.ok(Date.now() - t < SLEEP.wakeMs + 1000, 'the stop returned well inside its 10 s watchdog');
    assert.equal(agent.killed, null);
    assert.equal(bot.isSleeping, false);
    assert.equal(night(agent).done, true);
    assert.equal(night(agent).why, 'a !stop');
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    assert.equal(myBeds(agent).length, 0);
    assert.equal(agent.modelCalls, 0);
});

test('!stop in bed with a wake the server never confirms: one guarded wake, the stop returns after one wake bound, not two', async () => {
    SLEEP.wakeMs = 400;
    const agent = setup({ server: { skip: false, wakes: false } });
    const { bot } = agent;
    await F.until(() => bot.isSleeping, { timeout: 4000 });
    const t = Date.now();
    await F.ownerSays(agent, '!stop');
    const took = Date.now() - t;
    assert.ok(took >= 400 && took < 750, `the stop took ${took} ms`);
    assert.equal(calls(bot, 'wake').length, 1);
    assert.equal(agent.killed, null);
    assert.equal(night(agent).why, 'a !stop');
    bot.isSleeping = false;
});

test('a non-mode action that cuts the sleep marks the night done; a new resumable action during the night does too; the task runner\'s runs and resumes and action:bed do not', async () => {
    const agent = setup({ server: { skip: false } });
    const { bot } = agent;
    await F.until(() => bot.isSleeping, { timeout: 4000 });
    void agent.actions.runAction('action:goToPlayer', async () => {});
    await F.until(() => night(agent).done, { timeout: 2000 });
    assert.match(night(agent).why, /action:goToPlayer cut the sleep/);
    await idle(agent);
    // The next night, sleeping off for the session: actions that start, not cut.
    bot.modes.setOn('sleeping', false);
    bot.time = { timeOfDay: 13000, day: 6 };
    agent.work.onActionStart('action:task', agent.work.runner.runFn, { resume: true, timeout: -1 });
    agent.work.onActionStart('action:bed', async () => {}, { timeout: -1 });
    agent.work.onActionStart('mode:self_defense', async () => {}, { timeout: -1 });
    assert.equal(night(agent, 6).done, undefined, 'no night record was even needed');
    // Each exclusion holds on its own, also as if the routine were running: the
    // task label with another function, the runner's function under another
    // label, and the bed pickup.
    agent.work.sleeper.running = true;
    try {
        agent.work.onActionStart('action:task', async () => {}, { resume: true, timeout: -1 });
        agent.work.onActionStart('action:taskResume', agent.work.runner.runFn, { resume: true, timeout: -1 });
        agent.work.onActionStart('action:bed', async () => {}, { timeout: -1 });
    } finally {
        agent.work.sleeper.running = false;
    }
    assert.equal(night(agent, 6).done, undefined, 'the task label, the runner\'s function and action:bed never mark');
    await agent.actions.runAction('action:followPlayer', async () => {}, { resume: true, timeout: -1 });
    agent.actions.cancelResume();
    assert.equal(night(agent, 6).done, true);
    assert.match(night(agent, 6).why, /action:followPlayer started during the night/);
    // By day nothing is marked.
    bot.time = { timeOfDay: 6000, day: 7 };
    await agent.actions.runAction('action:followPlayer', async () => {}, { resume: true, timeout: -1 });
    agent.actions.cancelResume();
    assert.equal(night(agent, 7).done, undefined);
    bot.modes.setOn('sleeping', true);
});

test('a task started at dusk does not cancel the night (its run is the runner\'s own); the self-heal restart neither', async () => {
    const world = ground();
    F.tree(world, 4, 64, -4, 4);
    const agent = setup({ world, modes: { sleeping: false }, drive: false });
    const { bot } = agent;
    bot.hooks.collect = async () => { await F.until(() => bot.interrupt_code, { timeout: 4000 }).catch(() => {}); };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.actions.currentActionLabel === 'action:task');
    assert.notEqual(night(agent).done, true);
    agent.work.startRun();   // the self-heal restart's call
    await F.until(() => agent.actions.currentActionLabel === 'action:task' && !agent.actions.stopPromise);
    assert.notEqual(night(agent).done, true);
    bot.modes.setOn('sleeping', true);   // not driven: nothing fires by itself
    assert.equal(typeof agent.work.sleeper.next(), 'function', 'she still sleeps tonight');
    bot.interrupt_code = true;
});

// --- resume is not hurt (REQ-RES-16, REQ-SLP-9) --------------------------------------------------

test('mid-obtain at dusk: sleep cuts the run, the hold keeps the 9-minute night out of the stall clock and the cause, and the same step resumes with 0 model calls', async () => {
    const c = F.clock();
    const world = ground();
    for (const x of [4, 7, 10]) F.tree(world, x, 64, -4, 4);
    const agent = setup({ world, now: c.now, server: { time: DAY, skip: false } });
    const { bot } = agent;
    let collects = 0;
    let causeBefore = 'unset';
    let stalledAtResume = null;
    let heldAtResume = null;
    let chargedAfter = null;
    bot.hooks.collect = async () => {
        collects++;
        if (collects === 1) {
            causeBefore = agent.work.record.plan[0].progress.last_cause;
            bot.time = { ...NIGHT };   // dusk: the sleeping mode cuts the run
            await F.until(() => bot.interrupt_code, { timeout: 4000 });
        } else if (collects === 2) {
            stalledAtResume = agent.work.record.plan[0].progress.stalled_s;
            // The hold was released: work time charges again after the night.
            heldAtResume = agent.work.stallHeld;
            c.advance(30);
            agent.work.save();
            chargedAfter = agent.work.record.plan[0].progress.stalled_s - stalledAtResume;
        }
    };
    bot.hooks.sleep = async () => {
        // A 9-minute night, sampled by the self-heal timer's periodic save meanwhile.
        setTimeout(async () => {
            c.advance(540);
            const writes = agent.work.lastWrite;
            await F.until(() => agent.work.lastWrite !== writes, { timeout: 2000 });
            c.advance(60);   // the night's last minute, after the last save: the release restarts the clock
            bot.time = { timeOfDay: 23, day: 6 };
            bot.isSleeping = false;
            bot.emit('wake');
        }, 20);
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.work.record?.status === 'done', { timeout: 8000 });
    assert.equal(bot.count('oak_log'), 3);
    assert.ok(stalledAtResume < 5, `stalled_s at the resume: ${stalledAtResume}`);
    assert.equal(heldAtResume, false, 'the hold is released before the task resumes');
    assert.ok(chargedAfter >= 30, `charged after the night: ${chargedAfter}`);
    assert.equal(agent.work.record.plan[0].progress.last_cause, causeBefore);
    assert.equal(agent.work.record.interruptions.count, 1);
    assert.equal(agent.work.record.interruptions.last.by, 'mode:sleeping');
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), false);
    assert.equal(bot.count('black_bed'), 1);
});

test('a fight that cuts the sleep prompts no model call (no AUTO MESSAGE); the bed stays and she sleeps in it again; mode cuts are not tries but have their own cap (work.sleep.max_mode_cuts)', async () => {
    SLEEP.skipWaitMs = 60000;
    const agent = setup({ modes: { sleeping: true, self_defense: true }, server: { skip: false }, work: { sleep: { max_mode_cuts: 2 } } });
    const { bot } = agent;
    // The end of each mode's execute(), after its reprompt decision.
    const ended = [];
    const onModeEnd = agent.work.onModeEnd.bind(agent.work);
    agent.work.onModeEnd = (name, result) => { ended.push(name); return onModeEnd(name, result); };
    await F.until(() => bot.isSleeping, { timeout: 4000 });
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => night(agent).modeCuts === 1, { timeout: 4000 });
    assert.ok(agent.work.sleeper.cooldownUntil > Date.now(), 'the same cooldown as a failed try');
    assert.equal(night(agent).tries, 0, 'not a failed try');
    assert.equal(night(agent).done, false);
    assert.equal(calls(bot, 'wake').length, 1);
    assert.equal(myBeds(agent).length, 1, 'the bed stays (wanted tonight)');
    await F.until(() => ended.includes('self_defense'), { timeout: 6000 });
    await F.sleep(100);
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), false);
    // After the cooldown she lies down in the same bed; a second fight reaches the cap.
    await F.until(() => calls(bot, 'sleep').length === 2 && bot.isSleeping, { timeout: 4000 });
    assert.equal(calls(bot, 'place').length, 1, 'the same bed');
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => night(agent).done, { timeout: 4000 });
    assert.equal(night(agent).why, '2 mode cuts');
    assert.equal(night(agent).tries, 0);
});

test('following at dusk: sleep cuts the follow and it resumes afterwards with no timeout and no model call', async () => {
    const agent = setup({ server: { time: DAY } });
    const { bot } = agent;
    const seen = timeouts(agent);
    let follows = 0;
    void agent.actions.runAction('action:followPlayer', async () => { follows++; while (!bot.interrupt_code) await F.sleep(10); }, { resume: true, timeout: -1 });
    await F.until(() => follows === 1);
    bot.time = { ...NIGHT };
    await F.until(() => follows === 2, { timeout: 6000 });
    assert.equal(night(agent).done, true);
    assert.equal(night(agent).why, 'slept');
    assert.equal(bot.count('black_bed'), 1);
    assert.deepEqual(seen.filter(([l]) => l === 'action:followPlayer').map(([, t]) => t), [-1, -1]);
    assert.equal(agent.modelCalls, 0);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('the task view says she sleeps', async () => {
    const world = ground();
    F.tree(world, 4, 64, -4, 4);
    const agent = setup({ world, server: { skip: false }, modes: { sleeping: false }, drive: false });
    agent.bot.hooks.collect = async () => { await F.until(() => agent.bot.interrupt_code, { timeout: 4000 }).catch(() => {}); };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    agent.work.sleeper.running = true;
    agent.bot.isSleeping = true;
    assert.match(agent.work.view(), /Sleeping now: the task resumes by itself after the night\./);
    agent.work.sleeper.running = false;
    assert.doesNotMatch(agent.work.view(), /Sleeping now/);
    agent.bot.isSleeping = false;
    agent.bot.interrupt_code = true;
});

// --- the pickup (REQ-SLP-5, 6) -----------------------------------------------------------------

test('by day, Work.tick takes my bed back as action:bed (also with no task, after a restart); it cuts a running task, which resumes', async () => {
    const c = F.clock();
    const world = ground();
    for (const x of [4, 7, 10]) F.tree(world, x, 64, -4, 4);
    const agent = setup({ world, inventory: {}, server: { time: DAY }, drive: false, now: c.now });
    const { bot } = agent;
    placedBed(agent, 2, 64, 3);
    const dig = bot.hooks.dig;
    bot.hooks.dig = async block => { await F.sleep(100); c.advance(120); return dig(block); };   // a slow pickup: held time
    let collects = 0;
    let heldAtResume = null;
    let charged = null;
    bot.hooks.collect = async () => {
        if (++collects === 1) await F.until(() => bot.interrupt_code, { timeout: 4000 });
        else if (collects === 2) {
            // The pickup's hold was released: work time charges again.
            const progress = agent.work.record.plan[0].progress;
            heldAtResume = agent.work.stallHeld;
            const before = progress.stalled_s;
            c.advance(30);
            agent.work.save();
            charged = { before, after: progress.stalled_s };
        }
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.actions.currentActionLabel === 'action:task');
    stops.push(F.drive(agent));
    await F.until(() => agent.work.record.status === 'done', { timeout: 8000 });
    assert.equal(heldAtResume, false);
    assert.ok(charged.before < 5, `the pickup's 120 s were not charged: ${charged.before}`);
    assert.ok(charged.after - charged.before >= 30, `charged after the pickup: ${JSON.stringify(charged)}`);
    assert.equal(bot.count('black_bed'), 1);
    assert.equal(myBeds(agent).length, 0);
    assert.equal(agent.work.record.interruptions.last.by, 'action:bed');
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), false);
});

test('by day the pickup waits out an owner\'s one-off action and follows once it ends', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const runs = timeouts(agent);
    placedBed(agent, 2, 64, 3);
    let release = false;
    const errand = agent.actions.runAction('action:goToPlayer', async () => { while (!release && !bot.interrupt_code) await F.sleep(10); });
    await F.until(() => agent.actions.currentActionLabel === 'action:goToPlayer');
    stops.push(F.drive(agent));
    await F.sleep(200);
    assert.equal(runs.some(([label]) => label === 'action:bed'), false, 'not cut');
    assert.equal(bot.interrupt_code, false);
    release = true;
    await errand;
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
});

test('no pickup while the bed is wanted tonight; the pickup re-validates when it starts (night fell while it waited for the task to stop)', async () => {
    // Work.tick at night with my bed near: nothing is launched (it is for sleeping).
    const first = setup({ inventory: {}, drive: false, modes: { sleeping: true } });
    const firstRuns = timeouts(first);
    placedBed(first, 2, 64, 3);
    first.work.tick();
    await F.sleep(30);
    assert.deepEqual(firstRuns.filter(([label]) => label === 'action:bed'), []);
    // By day it launches, cutting a task; the task's run stops slowly, and dusk
    // falls meanwhile: the started pickup sees the bed wanted and does nothing,
    // so she sleeps in it as it stands.
    const world = ground();
    for (const x of [4, 7, 10]) F.tree(world, x, 64, -4, 4);
    const agent = setup({ world, inventory: {}, server: { time: DAY, skip: true }, drive: false });
    const { bot } = agent;
    placedBed(agent, 2, 64, 3);
    let collects = 0;
    bot.hooks.collect = async () => {
        if (++collects !== 1) return;
        await F.until(() => bot.interrupt_code, { timeout: 4000 });
        bot.time = { ...NIGHT };
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.actions.currentActionLabel === 'action:task');
    stops.push(F.drive(agent));
    await F.until(() => calls(bot, 'sleep').length === 1, { timeout: 6000 });
    assert.equal(calls(bot, 'place').length, 0, 'the bed was not dug and placed again');
    assert.deepEqual(calls(bot, 'sleep'), [['sleep', at(2, 64, 3).toString()]]);
    const sleepAt = bot.calls.findIndex(c => c[0] === 'sleep');
    assert.equal(bot.calls.slice(0, sleepAt).some(c => c[0] === 'dig'), false);
});

test('the pickup is launched only with 2 free slots: fewer, the bed stays placed and recorded and the owner is told once; with room it follows', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const runs = timeouts(agent);
    placedBed(agent, 2, 64, 3);
    for (let i = 0; i < 35; i++) bot.give('dirt', 64);   // 1 free slot
    stops.push(F.drive(agent));
    const line = 'My bag is too full to take my bed back (2 free slots needed); it stays at 2, 64, 3.';
    await F.until(() => agent.chats.includes(line));
    await F.sleep(150);
    assert.equal(runs.some(([label]) => label === 'action:bed'), false, 'checked before the launch: nothing is cut');
    assert.equal(calls(bot, 'dig').length, 0);
    assert.equal(myBeds(agent).length, 1);
    assert.equal(agent.actions.currentActionLabel, '');
    assert.equal(agent.chats.filter(c => c === line).length, 1);
    bot.take('dirt', 64);   // 2 free slots
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    assert.equal(myBeds(agent).length, 0);
});

test('the routine\'s own pickup needs only the bed\'s own slot: a full bag (P14\'s 36/36) still sleeps and takes the bed back; with that slot filled meanwhile the bed stays, told once', async () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    for (let i = 0; i < 35; i++) bot.give('dirt', 64);   // 0 free; placing the bed frees its slot
    stops.push(F.drive(agent));
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(night(agent).why, 'slept');
    assert.equal(bot.count('black_bed'), 1, 'back in the bag');
    assert.equal(myBeds(agent).length, 0);
    assert.equal(agent.chats.some(c => /too full/.test(c)), false);
    // The freed slot fills while she sleeps (an item picked up): the bed stays.
    const second = setup({ drive: false });
    for (let i = 0; i < 35; i++) second.bot.give('dirt', 64);
    second.bot.hooks.sleep = async () => { second.bot.give('cobblestone', 64); };
    stops.push(F.drive(second));
    await F.until(() => night(second).done && !second.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(second.bot, 'dig').length, 0);
    assert.equal(myBeds(second).length, 1, 'placed and recorded');
    const line = 'My bag is too full to take my bed back (1 free slot needed); it stays at 0, 64, 1.';
    await F.until(() => second.chats.includes(line));
    // By day the launch needs 2: its own line too, once, beside the night's (N2).
    const day = 'My bag is too full to take my bed back (2 free slots needed); it stays at 0, 64, 1.';
    await F.until(() => second.chats.includes(day));
    await F.sleep(100);
    assert.equal(second.chats.filter(c => c === line).length, 1);
    assert.equal(second.chats.filter(c => c === day).length, 1);
    assert.equal(myBeds(second).length, 1);
});

test('the pickup refusals: next to water (hard) leaves it, told once and no longer hers; a lost drop is told; beyond 16 the owner is told once and the obligation stays', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY, drops: false }, drive: false });
    const { bot } = agent;
    placedBed(agent, 2, 64, 3);
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('I lost my bed at 2, 64, 3.'), { timeout: 4000 });
    assert.equal(agent.work.sleeper.receipt, null);
    // Next to water (beside the head only: the dig seam checks the foot's own cells).
    const wet = placedBed(agent, -3, 64, -3);
    bot.world.set(-4, 64, -2, 'water');
    await F.until(() => agent.chats.includes('I left my bed at -3, 64, -3.'), { timeout: 4000 });
    assert.equal(agent.work.ledger.get(wet.pos), null, 'no longer hers');
    assert.equal(bot.world.block(at(-3, 64, -3)).name, 'black_bed');
    assert.equal(F.modules.protect.isProtectedForBot(bot, bot.blockAt(at(-3, 64, -3))), true);
    await F.sleep(100);   // the owner lines go out one by one
    assert.equal(agent.chats.includes('I lost my bed at -3, 64, -3.'), false, 'her own leave is not a loss');
    // Beyond 16.
    bot.world.fill(-12, 59, 20, 12, 63, 21, 'stone');
    const far = placedBed(agent, 0, 64, 20);
    await F.until(() => agent.chats.includes('I left my bed at 0, 64, 20.'), { timeout: 4000 });
    assert.equal(agent.work.ledger.get(far.pos)?.kind, 'own', 'the obligation is kept');
    await F.sleep(100);
    assert.equal(agent.chats.filter(c => c === 'I left my bed at 0, 64, 20.').length, 1);
});

test('a soft refusal (someone on the bed) retries later; a receipt is closed when the bed comes back by any pickup and is lost after the item\'s life', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    placedBed(agent, 2, 64, 3);
    F.player(bot, 'alex', [2.5, 64.6, 4.5]);   // on the head: the dig seam checks only the foot's cell
    stops.push(F.drive(agent));
    await F.until(() => agent.work.sleeper.retryAt > 0, { timeout: 4000 });
    assert.equal(calls(bot, 'dig').length, 0);
    for (const id of Object.keys(bot.entities)) if (bot.entities[id].username === 'alex') delete bot.entities[id];
    delete bot.players.alex;
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    // Receipts, directly.
    const sleeper = agent.work.sleeper;
    sleeper.receipt = { pos: { x: 9, y: 64, z: 9 }, dim: 'overworld', item: 'black_bed', at: Date.now(), count: 0 };
    agent.work.tick();
    assert.equal(sleeper.receipt, null, 'the bed is back (count 1 > 0)');
    sleeper.receipt = { pos: { x: 9, y: 64, z: 9 }, dim: 'overworld', item: 'black_bed', at: Date.now() - SLEEP.receiptMs, count: 1 };
    agent.work.tick();
    assert.equal(sleeper.receipt, null);
    await F.until(() => agent.chats.includes('I lost my bed at 9, 64, 9.'));
});

// --- fix wave 1 (Sol r1 S1–S5, adversary r1 gaps 1 and 3, rulings #3, #5, #8) -----------------------

// A dropped bed item, as the fixture's dig leaves one.
function droppedBed(bot, x, y, z, name = 'black_bed') {
    const id = 8000 + Object.keys(bot.entities).length;
    bot.entities[id] = { id, name: 'item', type: 'object', position: new F.Vec3(x + 0.5, y + 0.2, z + 0.5), getDroppedItem: () => ({ name, count: 1 }) };
    return bot.entities[id];
}

test('a pending receipt is collected at night as action:bed (under the cut rules), and no new sleep starts before it is settled', async () => {
    const agent = setup({ inventory: { white_bed: 1 }, drive: false });
    const { bot } = agent;
    const runs = timeouts(agent);
    const sleeper = agent.work.sleeper;
    droppedBed(bot, 3, 64, 3);
    sleeper.receipt = { pos: { x: 3, y: 64, z: 3 }, dim: 'overworld', item: 'black_bed', at: Date.now(), count: 1, ob: 'overworld:3 64 3:1' };   // the white bed she holds
    assert.equal(sleeper.next(), null, 'the receipt is settled first');
    stops.push(F.drive(agent));
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    assert.equal(sleeper.receipt, null);
    assert.equal(runs[0]?.[0], 'action:bed', 'collected before any sleep');
    assert.equal(agent.chats.some(c => /lost/.test(c)), false);
    await F.until(() => calls(bot, 'sleep').length === 1, { timeout: 4000 });   // then she sleeps
});

test('a bed of hers broken by someone else is told lost once (a block update); one that changed before a restart is told when its loaded cell shows it', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const entry = placedBed(agent, 2, 64, 3);
    bot.setBlock(2, 64, 4, 'air');   // the server removes both halves
    bot.setBlock(2, 64, 3, 'air');
    assert.equal(agent.work.ledger.get(entry.pos), null);
    await F.until(() => agent.chats.includes('I lost my bed at 2, 64, 3.'));
    // A pickup that finds another block (its update missed): lost, not retried.
    const missed = placedBed(agent, 5, 64, -5);
    bot.world.set(5, 64, -5, 'cobblestone');
    bot.world.set(5, 64, -4, 'air');
    assert.equal(await agent.work.sleeper.pickup(missed), 'lost');
    assert.equal(agent.work.ledger.get(missed.pos), null);
    await F.until(() => agent.chats.includes('I lost my bed at 5, 64, -5.'));
    // Before a restart: the ledger has the entry, the loaded cell shows dirt.
    const old = placedBed(agent, -3, 64, -3);
    bot.world.set(-3, 64, -3, 'dirt');
    bot.world.set(-3, 64, -2, 'air');
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('I lost my bed at -3, 64, -3.'));
    assert.equal(agent.work.ledger.get(old.pos), null);
    await F.sleep(100);
    assert.equal(agent.chats.filter(c => /I lost my bed/.test(c)).length, 3, 'once each');
    // Her own pickup dig is not a loss.
    placedBed(agent, 4, 64, 0);
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    await F.sleep(50);
    assert.equal(agent.chats.filter(c => /I lost my bed/.test(c)).length, 3);
});

test('a bed beyond 16 in an unloaded chunk is told once by day and kept', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const blockAt = bot.blockAt.bind(bot);
    bot.blockAt = p => (p.z >= 30 ? null : blockAt(p));
    const far = { pos: { x: 0, y: 64, z: 40 }, block: 'black_bed', kind: 'own', by: 'mode:sleeping', dim: 'overworld', at: Date.now() };
    agent.work.ledger.add(far);
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('I left my bed at 0, 64, 40.'));
    await F.sleep(100);
    assert.equal(agent.chats.filter(c => /I left my bed/.test(c)).length, 1);
    assert.equal(agent.work.ledger.get(far.pos), far, 'the obligation is kept');
});

test('the final veto before the dig packet: someone stepping onto the head, or water appearing beside it, while she equips is not dug', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const sleeper = agent.work.sleeper;
    const entry = placedBed(agent, 1, 64, 0);
    const equip = bot.tool.equipForBlock;
    bot.tool.equipForBlock = async block => { F.player(bot, 'alex', [1.5, 64.6, 1.5]); return equip?.call(bot.tool, block); };
    assert.equal(await sleeper.pickup(entry), 'soft');
    assert.equal(calls(bot, 'dig').length, 0);
    for (const id of Object.keys(bot.entities)) if (bot.entities[id].username === 'alex') delete bot.entities[id];
    delete bot.players.alex;
    bot.tool.equipForBlock = async block => { bot.world.set(2, 64, 1, 'water'); return equip?.call(bot.tool, block); };
    assert.equal(await sleeper.pickup(entry), 'soft', 'vetoed at the packet');
    assert.equal(calls(bot, 'dig').length, 0);
    assert.equal(await sleeper.pickup(entry), 'left', 'the next try sees the water first: hard');
    assert.equal(calls(bot, 'dig').length, 0);
    // The head half gone while she equips (the foot not yet updated): not whole, not dug.
    bot.world.set(2, 64, 1, 'air');
    const whole = placedBed(agent, -2, 64, -2);
    bot.tool.equipForBlock = async block => { bot.world.set(-2, 64, -1, 'air'); return equip?.call(bot.tool, block); };
    assert.equal(await sleeper.pickup(whole), 'soft');
    assert.equal(calls(bot, 'dig').length, 0);
});

test('alerts are per obligation: a second bed lost at the same cell is told again', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    for (let i = 0; i < 2; i++) {
        placedBed(agent, 2, 64, 3).at = 1;   // the same cell and time: only the resolve tells them apart
        bot.setBlock(2, 64, 3, 'air');
        await F.until(() => agent.chats.filter(c => c === 'I lost my bed at 2, 64, 3.').length === i + 1);
    }
});

// The patched placement throws "Server did not answer" after 5 s with no
// update for the cell; the server's bed (and the item's removal) may come
// `lateMs` later. Without blockPlaced, nothing records it.
function lateServer(bot, lateMs = 100) {
    const place = bot.placeBlock;
    bot.placeBlock = async (reference, face) => {
        if (!bot.heldItem?.name?.endsWith('_bed')) return place(reference, face);
        setTimeout(async () => {
            const emit = bot.emit;
            bot.emit = (event, ...args) => (event === 'blockPlaced' ? false : emit.call(bot, event, ...args));
            try {
                await place(reference, face);
            } finally {
                bot.emit = emit;
            }
        }, lateMs);
        throw new Error(`Server did not answer the placement at ${reference.position.offset(0, 1, 0)}: timed out`);
    };
}

test('a placement the server answers late (the bed and the item\'s removal arrive after the throw) makes the bed hers: recorded, slept in and taken back', async () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    lateServer(bot, 100);
    stops.push(F.drive(agent));
    await F.until(() => calls(bot, 'sleep').length === 1, { timeout: 4000 });
    assert.deepEqual(calls(bot, 'sleep'), [['sleep', at(0, 64, 1).toString()]]);
    await F.until(() => night(agent).done && !agent.work.sleeper.running, { timeout: 4000 });
    assert.equal(night(agent).why, 'slept');
    assert.equal(bot.count('black_bed'), 1, 'taken back');
    assert.equal(agent.chats.some(c => /left my bed/.test(c)), false);
});

test('not adopted: an equip error with someone else\'s bed in the cell; a timed-out placement with a bed there but no bed gone from her bag; a later arrival than the watch', async () => {
    SLEEP.cooldownMs = 5000;
    SLEEP.lateMs = 300;
    // The equip fails; meanwhile another player's black bed fills F.
    const first = setup({ drive: false });
    first.bot.equip = async () => {
        first.bot.world.set(0, 64, 1, 'black_bed', { facing: 'south', part: 'foot', occupied: false });
        first.bot.world.set(0, 64, 2, 'black_bed', { facing: 'south', part: 'head', occupied: false });
        throw new Error('could not equip');
    };
    stops.push(F.drive(first));
    await F.until(() => night(first).tries >= 1 && !first.work.sleeper.running, { timeout: 4000 });
    assert.equal(myBeds(first).length, 0);
    assert.equal(calls(first.bot, 'sleep').length, 0);
    assert.equal(first.bot.count('black_bed'), 1);
    // The placement times out; another player's bed is there, hers is still in the bag.
    const second = setup({ drive: false });
    second.bot.placeBlock = async () => {
        second.bot.world.set(0, 64, 1, 'black_bed', { facing: 'south', part: 'foot', occupied: false });
        second.bot.world.set(0, 64, 2, 'black_bed', { facing: 'south', part: 'head', occupied: false });
        throw new Error('Server did not answer the placement at (0, 64, 1): timed out');
    };
    stops.push(F.drive(second));
    await F.until(() => night(second).tries >= 1 && !second.work.sleeper.running, { timeout: 4000 });
    assert.equal(myBeds(second).length, 0);
    assert.equal(calls(second.bot, 'sleep').length, 0);
    // The equip succeeds but someone's bed filled F meanwhile: the cells are re-checked, nothing is placed.
    const fourth = setup({ drive: false });
    const equip = fourth.bot.equip;
    fourth.bot.equip = async item => {
        fourth.bot.world.set(0, 64, 1, 'white_bed', { facing: 'south', part: 'foot', occupied: false });
        fourth.bot.world.set(0, 64, 2, 'white_bed', { facing: 'south', part: 'head', occupied: false });
        fourth.bot.equip = equip;
        return equip(item);
    };
    stops.push(F.drive(fourth));
    await F.until(() => night(fourth).tries >= 1 && !fourth.work.sleeper.running, { timeout: 4000 });
    assert.equal(calls(fourth.bot, 'place').length, 0);
    assert.equal(myBeds(fourth).length, 0);
    // Her own bed, but later than the watch: nothing new (it stays protected, unrecorded).
    const third = setup({ drive: false });
    lateServer(third.bot, 600);
    stops.push(F.drive(third));
    await F.until(() => night(third).tries >= 1 && !third.work.sleeper.running, { timeout: 4000 });
    await F.sleep(400);
    assert.equal(myBeds(third).length, 0);
    assert.equal(third.bot.world.block(at(0, 64, 1)).name, 'black_bed');
    assert.equal(calls(third.bot, 'sleep').length, 0);
});

test('a receipt needs the launch\'s 2 free slots too; a collection with no room keeps the receipt (not lost) until there is room', async () => {
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const runs = timeouts(agent);
    const sleeper = agent.work.sleeper;
    for (let i = 0; i < 35; i++) bot.give('dirt', 64);   // 1 free
    droppedBed(bot, 3, 64, 3);
    const receipt = { pos: { x: 3, y: 64, z: 3 }, dim: 'overworld', item: 'black_bed', at: Date.now(), count: 0, ob: 'overworld:3 64 3:7' };
    sleeper.receipt = receipt;
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('My bag is too full to take my bed back (2 free slots needed); it stays at 3, 64, 3.'));
    await F.sleep(100);
    assert.equal(runs.some(([label]) => label === 'action:bed'), false, 'not launched');
    assert.equal(sleeper.receipt, receipt);
    // A collection that runs out of room (the bag fills meanwhile) keeps it.
    bot.give('cobblestone', 64);   // 0 free
    assert.equal(await sleeper.collect(), 'soft');
    assert.equal(sleeper.receipt, receipt);
    assert.equal(agent.chats.some(c => /lost/.test(c)), false);
    bot.take('dirt', 128);   // 2 free
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
    assert.equal(sleeper.receipt, null);
});

test('an unreachable bed\'s retries wait until she is idle: a running task is not cut by them; at night it is a try', async () => {
    SLEEP.cooldownMs = 100;
    const world = ground();
    for (const x of [4, 7, 10]) F.tree(world, x, 64, -4, 4);
    const agent = setup({ world, inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const runs = timeouts(agent);
    placedBed(agent, -7, 64, 7);
    const goto = bot.hooks.goto;
    bot.hooks.goto = async goal => (goal.x === -7 ? 'moved' : goto(goal));   // the bed cannot be reached
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('I left my bed at -7, 64, 7.'), { timeout: 4000 });
    // A task now: its collect waits long enough for several back-offs. Every
    // pickup start is recorded with the task's state at that moment.
    const starts = [];
    const execute = agent.actions._executeAction;
    agent.actions._executeAction = function (label, fn, timeout) {
        if (label === 'action:bed') starts.push(agent.work.record?.status ?? null);
        return execute.call(this, label, fn, timeout);
    };
    let collects = 0;
    bot.hooks.collect = async () => { if (++collects === 1) await F.sleep(800); };
    const before = runs.filter(([label]) => label === 'action:bed').length;
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.work.record.status === 'done', { timeout: 8000 });
    assert.equal(starts.includes('active'), false, 'no retry started while the task ran');
    assert.equal(agent.work.record.interruptions?.count ?? 0, 0);
    // Idle again: the retries go on.
    await F.until(() => runs.filter(([label]) => label === 'action:bed').length > before, { timeout: 4000 });
    // At night she tries to reach it to sleep, and that counts as a try.
    await idle(agent);
    bot.entity.position = new F.Vec3(0.5, 64, 0.5);   // within 16 of it, no bed in the bag
    bot.time = { ...NIGHT };
    await F.until(() => night(agent).tries >= 1, { timeout: 4000 });
    assert.equal(calls(bot, 'sleep').length, 0);
    assert.equal(agent.work.ledger.list().some(e => e.pos.x === -7 && e.pos.z === 7), true, 'still hers');
});

test('an unreachable bed (the walk does not arrive) keeps its obligation: told once, retried after the back-off, taken once reachable', async () => {
    SLEEP.cooldownMs = 300;
    const agent = setup({ inventory: {}, server: { time: DAY }, drive: false });
    const { bot } = agent;
    const entry = placedBed(agent, -7, 64, 7);
    const goto = bot.hooks.goto;
    bot.hooks.goto = async () => 'moved';   // she never gets there
    stops.push(F.drive(agent));
    await F.until(() => agent.chats.includes('I left my bed at -7, 64, 7.'), { timeout: 4000 });
    assert.equal(agent.work.ledger.get(entry.pos), entry, 'still hers');
    assert.ok(agent.work.sleeper.retryAt > Date.now() - 50, 'the back-off');
    await F.sleep(400);
    assert.equal(agent.chats.filter(c => /left my bed/.test(c)).length, 1, 'told once');
    bot.hooks.goto = goto;
    await F.until(() => bot.count('black_bed') === 1, { timeout: 4000 });
});

test('every walk is no-dig, no-tower, no-scaffold, and bounded (the pathfinder is stopped at the bound)', async () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    const seen = [];
    const ends = [];
    F.player(bot, 'alex', [0.5, 64, 0.5]);   // her own cell is taken: she must walk
    bot.hooks.goto = async goal => {
        const m = bot.pathfinder.movements;
        seen.push({ canDig: m.canDig, towers: m.allow1by1towers, scaffold: m.scafoldingBlocks.length });
        bot.pathfinder.goal = goal;
        const t = Date.now();
        await F.until(() => bot.pathfinder.goal === null, { timeout: 3000 });
        ends.push(Date.now() - t);
        return 'moved';   // stopped where she stands
    };
    stops.push(F.drive(agent));
    await F.until(() => night(agent).tries >= 1 && !agent.work.sleeper.running, { timeout: 8000 });
    assert.ok(seen.length >= 1);
    assert.deepEqual(seen[0], { canDig: false, towers: false, scaffold: 0 });
    assert.ok(seen.every(s => s.canDig === false && s.towers === false && s.scaffold === 0));
    assert.ok(ends.every(ms => ms >= SLEEP.walkMs - 20 && ms < SLEEP.walkMs + 300), `walks ended after ${ends.join(', ')} ms (bound ${SLEEP.walkMs})`);
    assert.equal(calls(bot, 'place').length, 0);
});

// --- the bed's protection (REQ-OWN-2) --------------------------------------------------------------

test('my bed is own: protected from the pathfinder (the patched safeToBreak), collection and the tidy sweep; exempt only for the pickup\'s exact live entry', async () => {
    const agent = setup({ drive: false, server: { time: DAY } });
    const { bot } = agent;
    const entry = placedBed(agent, 2, 64, 3);
    const foot = bot.blockAt(at(2, 64, 3));
    const protector = F.modules.protect.protectorFor(bot);
    assert.equal(protector.isProtected(foot), true);
    const m = new pf.Movements(bot);
    assert.equal(m.safeToBreak(foot), false, 'the pathfinder may not dig it');
    assert.equal(protector.withOwnBed(entry, () => protector.isProtected(foot) || !m.safeToBreak(foot)), false, 'exempt inside the pickup, both checks');
    assert.equal(protector.isProtected(foot), true, 'and protected again after it');
    // Another own entry is not the routine's: no exemption.
    bot.world.set(-2, 64, -2, 'white_bed', { facing: 'south', part: 'foot', occupied: false });
    const other = { pos: { x: -2, y: 64, z: -2 }, block: 'white_bed', kind: 'own', by: 'action:placeHere', dim: 'overworld', at: Date.now() };
    agent.work.ledger.add(other);
    assert.equal(protector.withOwnBed(other, () => protector.isProtected(bot.blockAt(at(-2, 64, -2)))), true);
    // A stale entry object (a newer entry in its cell) is not exempt.
    const copy = { ...entry };
    assert.equal(protector.withOwnBed(copy, () => protector.isProtected(foot)), true);
    // The dig seam without the exemption refuses it.
    const refused = await F.modules.dig.digCell(bot, foot, { move: false, hand: true });
    assert.equal(refused.reason, 'protected');
    // The tidy sweep never takes it.
    const swept = await F.modules.tidy.tidyNear(bot);
    assert.deepEqual(swept.removed, []);
    assert.equal(bot.world.block(at(2, 64, 3)).name, 'black_bed');
});
