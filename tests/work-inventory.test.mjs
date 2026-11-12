import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2e: inventory upkeep, part A (SPEC §9.4 REQ-OBT-11, REQ-SAFE-7; design
// junk-council/recommended-design.md r7 §2–§6): the item list, the planner,
// the dropper and its guard, the idle cleanup (action:items) with its two
// admissions, its currency and holds, !itemList and the owner lines.
const { inventory: I, config: C } = F.modules;
const INV = I.INVENTORY;
const DEFAULTS = { ...INV };
const FAST = { cooldownMs: 60, hostileQuietMs: 60, resumeGapMs: 120, retryMs: 300 };
const agents = [];
const stops = [];
let n = 0;
after(() => { Object.assign(INV, DEFAULTS); stops.forEach(stop => stop()); F.cleanup(agents); });
beforeEach(() => { F.useSettings(); Object.assign(INV, DEFAULTS, FAST); });

const tosses = bot => bot.calls.filter(c => c[0] === 'toss');
const policyOf = (work = {}) => C.loadWorkConfig(work).inventory;
const FILLER = 'oak_planks';   // not on the list: always kept

// Fills the bag with kept planks until `free` slots are left.
function fill(bot, free) {
    while (bot.inventory.emptySlotCount() > free) bot.give(FILLER, 64);
}

function setup({ inventory = { rotten_flesh: 128, gravel: 41 }, free = 2, work = {}, modes = {}, drive = true, ownerAt = [8, 64, 0], name, idleDelay } = {}) {
    const bot = F.makeBot({ inventory });
    if (ownerAt) F.player(bot, F.OWNER, ownerAt);
    if (free != null) fill(bot, free);
    const agent = F.makeAgent({ bot, modes, work, name: name ?? `items${n++}`, ...(idleDelay ? { idleDelay } : {}) });
    F.clearRecord(agent);
    agent.respondFunc = async (username, message) => agent.handleMessage(username, message);
    F.startWork(agent);
    agent.work.lineGapMs = 5;
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}

const passed = agent => F.until(() => tosses(agent.bot).length > 0 && !agent.work.items.latch, { timeout: 4000 });
const quiet = agent => F.until(() => !agent.actions.executing && !agent.work.items.latch, { timeout: 4000 });

// --- the item list (design §2) -----------------------------------------------------------

test('work.inventory merges by item name over the defaults; "all" overrides a default; the defaults are never mutated', () => {
    const base = policyOf();
    assert.equal(base.error, null);
    assert.equal(base.idle, true);
    assert.equal(base.items.rotten_flesh, 0);
    assert.equal(base.items.dirt, 'stack');
    assert.equal(base.items.gunpowder, 'all');
    const merged = policyOf({ inventory: { items: { dirt: 'all', bone: 10, oak_planks: 0 }, idle: false } });
    assert.equal(merged.error, null);
    assert.equal(merged.idle, false);
    assert.deepEqual([merged.items.dirt, merged.items.bone, merged.items.oak_planks, merged.items.gravel], ['all', 10, 0, 0]);
    merged.items.gravel = 'all';
    assert.equal(C.WORK_DEFAULTS.inventory.items.gravel, 0, 'defaults untouched');
    assert.equal(policyOf().items.gravel, 0, 'a fresh map per load');
    assert.notEqual(policyOf().items, policyOf().items);
    const bot = F.makeBot();
    assert.equal(I.keepOf(bot, merged, 'dirt'), Infinity);
    assert.equal(I.keepOf(bot, base, 'dirt'), 64);
    assert.equal(I.keepOf(bot, base, 'ender_pearl'), undefined, 'not listed: kept');
    assert.equal(I.keepOf(bot, base, 'gunpowder'), Infinity);
});

test('a bad structure or entry turns automatic removal off (fail safe), never widens it', () => {
    for (const inventory of [null, [], 'all', 5]) assert.equal(policyOf({ inventory }).error, 'inventory is not an object', JSON.stringify(inventory));
    for (const items of [null, [], 'x']) assert.equal(policyOf({ inventory: { items } }).error, 'items is not an object', JSON.stringify(items));
    for (const keep of [-1, 1.5, '5', 'lots', null, true, Number.MAX_SAFE_INTEGER + 1, {}]) {
        const p = policyOf({ inventory: { items: { bone: keep } } });
        assert.equal(p.error, `bone: ${JSON.stringify(keep)}`, JSON.stringify(keep));
        assert.equal(p.items.bone, 'stack', 'a bad entry is not merged');
    }
    assert.equal(policyOf({ inventory: { idle: 'yes' } }).error, 'idle: "yes"');
    assert.equal(policyOf({ inventory: { items: { bone: 0 }, chest: 'x' } }).error, null, 'an unknown sub-key is only logged');
    assert.equal(I.removalEnabled(policyOf({ inventory: { items: { bone: -1 } } })), false);
    const bot = F.makeBot({ inventory: { rotten_flesh: 64 } });
    assert.deepEqual([...I.planRemoval(bot, policyOf({ inventory: { items: [] } }))], [], 'a bad list plans nothing');
});

test('a bad item list: tasks block on slots as before and idle does nothing; told once', async () => {
    const agent = setup({ work: { inventory: { items: { rotten_flesh: 'none' } } } });
    const line = 'My item list has an error (rotten_flesh: "none"); I won\'t drop anything until it\'s fixed.';
    await F.until(() => agent.chats.includes(line));
    await F.sleep(200);
    assert.equal(tosses(agent.bot).length, 0, 'no idle pass');
    agent.work.startTask('logs', 'obtain item=oak_log count=1');
    await F.until(() => agent.work.record.status !== 'active');
    assert.equal(agent.work.record.status, 'blocked');
    assert.match(agent.work.record.reason, /^inventory full/);
    assert.equal(tosses(agent.bot).length, 0);
    assert.equal(agent.chats.filter(c => c === line).length, 1);
});

test('item names are checked against the registry in Work.init: an unknown name turns removal off, told once', async () => {
    const agent = setup({ work: { inventory: { items: { rotten_fleshh: 0 } } } });
    await F.until(() => agent.chats.includes('My item list has an error (rotten_fleshh); I won\'t drop anything until it\'s fixed.'));
    assert.equal(agent.work.config.inventory.error, 'rotten_fleshh');
    await F.sleep(200);
    assert.equal(tosses(agent.bot).length, 0);
});

test('every default name is an item of the 26.1 registry (stack 64 for the "stack" ones)', () => {
    for (const [name, keep] of Object.entries(C.WORK_DEFAULTS.inventory.items)) {
        assert.ok(F.registry.itemsByName[name], name);
        if (keep === 'stack') assert.equal(F.registry.itemsByName[name].stackSize, 64, name);
    }
    assert.equal(I.unknownItemName(F.makeBot(), policyOf()), null);
});

// --- the planner (design §3) -------------------------------------------------------------------

// Puts stacks into exact slots: [[slot, name, count], ...].
function slotted(stacks) {
    const bot = F.makeBot();
    for (const [slot, name, count] of stacks) bot.inventory.slots[slot] = { name, count, type: F.registry.itemsByName[name].id, stackSize: F.registry.itemsByName[name].stackSize };
    return bot;
}
const ops = plan => plan.map(o => [o.slot, o.name, o.count]);

test('the planner: every tier-0 stack whole and first, then limited surplus as whole stacks smallest first, a remainder from the smallest stack left', () => {
    const bot = slotted([[9, 'phantom_membrane', 64], [10, 'phantom_membrane', 55], [11, 'rotten_flesh', 30], [12, 'gravel', 64], [13, 'rotten_flesh', 64]]);
    const keep64 = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(keep64), [[11, 'rotten_flesh', 30], [13, 'rotten_flesh', 64], [12, 'gravel', 64], [10, 'phantom_membrane', 55]]);
    assert.equal(keep64.freed, 4);
    // keep 100: 19 from the 55 stack, which frees no slot (not counted toward minFree).
    const membrane100 = policyOf({ inventory: { items: { phantom_membrane: 100 } } });
    const keep100 = I.planRemoval(bot, membrane100, { minFree: 35 });
    assert.deepEqual(ops(keep100).slice(-1), [[10, 'phantom_membrane', 19]]);
    assert.equal(keep100.freed, 3);
    assert.equal(keep100.reaches, false, `${bot.inventory.emptySlotCount()} free + 3 freed < 35`);
    assert.equal(I.planRemoval(bot, membrane100, { minFree: 34 }).reaches, true);
    // dirt 200 in 64, 64, 64, 8 (keep 64): the 8, then two 64s; 64 stay.
    const dirt = slotted([[9, 'dirt', 64], [10, 'dirt', 64], [11, 'dirt', 64], [12, 'dirt', 8]]);
    assert.deepEqual(ops(I.planRemoval(dirt, policyOf())), [[12, 'dirt', 8], [9, 'dirt', 64], [10, 'dirt', 64]]);
});

test('the planner never takes the selected hotbar slot, a needed item, an unlisted or an "all" item', () => {
    const bot = slotted([[36, 'rotten_flesh', 10], [9, 'rotten_flesh', 5], [37, 'gravel', 3], [10, 'gunpowder', 64], [11, 'gunpowder', 64],
        [12, 'diamond', 64], [13, 'dirt', 64], [14, 'dirt', 64], [15, 'cobblestone', 64], [16, 'cobblestone', 20]]);
    const plan = I.planRemoval(bot, policyOf(), { needed: new Set(['cobblestone']) });
    assert.deepEqual(ops(plan), [[9, 'rotten_flesh', 5], [37, 'gravel', 3], [13, 'dirt', 64]]);
    // The held slot counts toward the keep: 40 dirt in hand, 64 + 30 more, keep 64.
    const held = slotted([[36, 'dirt', 40], [9, 'dirt', 64], [10, 'dirt', 30]]);
    assert.deepEqual(ops(I.planRemoval(held, policyOf())), [[10, 'dirt', 30], [9, 'dirt', 40]]);
    held.quickBarSlot = 1;   // now slot 37 is held: slot 36 may go
    assert.deepEqual(ops(I.planRemoval(held, policyOf())).map(o => o[0]), [10, 36]);
});

// --- the dropper (design §3) -------------------------------------------------------------------

const op = (bot, slot) => { const s = bot.inventory.slots[slot]; return { slot, name: s.name, count: s.count, have: s.count, whole: true }; };

test('the dropper re-checks each slot before its toss: a grown tier-0 stack goes whole, a changed limited stack or another item is skipped', async () => {
    const bot = slotted([[9, 'rotten_flesh', 55], [10, 'dirt', 64], [11, 'dirt', 30], [12, 'gravel', 10]]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[9, 'rotten_flesh', 55], [12, 'gravel', 10], [11, 'dirt', 30]]);
    bot.inventory.slots[9].count = 57;   // a contact pickup merged in
    bot.inventory.slots[11].count = 31;  // the limited stack changed
    bot.inventory.slots[12] = { name: 'diamond', count: 10, type: F.registry.itemsByName.diamond.id };   // another item now
    const result = await I.dropItems(bot, plan);
    assert.equal(result.outcome, 'done');
    assert.deepEqual(result.removed, { rotten_flesh: 57 });
    assert.deepEqual(tosses(bot).map(c => [c[1], c[2], c[3]]), [['rotten_flesh', 57, 9]]);
    assert.equal(bot.count('diamond'), 10);
    assert.equal(bot.count('dirt'), 95);
});

test('the facing: a cardinal free at foot and eye level for 3 blocks, away from awayFrom; grass and leaf litter are free; none free: unavailable, nothing tossed', async () => {
    const world = new F.World();
    const bot = F.makeBot({ world, inventory: { rotten_flesh: 5 } });
    const away = { x: -5, y: 64, z: 0 };   // to her west: east is preferred
    assert.deepEqual(I.chooseFacing(bot, away), { dx: 1, dz: 0 });
    world.set(2, 65, 0, 'stone');          // east blocked at eye level, 2 out
    assert.deepEqual(I.chooseFacing(bot, away), { dx: 0, dz: 1 });
    world.set(0, 64, 3, 'short_grass');
    world.set(0, 64, 1, 'leaf_litter', { facing: 'north', segment_amount: '1' });
    assert.deepEqual(I.chooseFacing(bot, away), { dx: 0, dz: 1 }, 'grass and leaf litter have no collision box');
    world.set(0, 64, 2, 'water', { level: '0' });
    world.set(0, 64, -3, 'oak_planks');
    world.set(-1, 64, 0, 'stone');
    assert.equal(I.chooseFacing(bot, away), null, 'water, a block 3 out and one at her side');
    const result = await I.dropItems(bot, [op(bot, 9)], { awayFrom: away });
    assert.equal(result.outcome, 'unavailable');
    assert.equal(tosses(bot).length, 0);
    assert.equal(bot.calls.some(c => c[0] === 'lookAt'), false);
});

test('the look, then 2 ticks, then the first toss; the look is level at eye height 3 blocks out; an interruption during the wait tosses nothing', async () => {
    const bot = F.makeBot({ position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5, gravel: 3 } });
    const plan = I.planRemoval(bot, policyOf());
    await I.dropItems(bot, plan, { awayFrom: { x: 0.5, y: 64, z: -9 } });
    const kinds = bot.calls.map(c => c[0]);
    assert.deepEqual(kinds, ['lookAt', 'waitForTicks', 'toss', 'toss']);
    const [, look, force] = bot.calls[0];
    assert.deepEqual([look.x, look.y, look.z, force], [0.5, 64 + 1.62, 3.5, true]);
    assert.equal(bot.calls[1][1], 2);
    // Interrupted during the wait.
    const second = F.makeBot({ inventory: { rotten_flesh: 5 } });
    const wait = second.waitForTicks;
    second.waitForTicks = async t => { await wait(t); second.interrupt_code = true; };
    const result = await I.dropItems(second, I.planRemoval(second, policyOf()));
    assert.equal(result.outcome, 'interrupted');
    assert.equal(tosses(second).length, 0);
    assert.equal(second.junk_guard, undefined, 'no drop point without a toss');
    // The caller's currency is checked after the wait too.
    const third = F.makeBot({ inventory: { rotten_flesh: 5 } });
    assert.equal((await I.dropItems(third, I.planRemoval(third, policyOf()), { current: () => false })).outcome, 'interrupted');
    assert.equal(tosses(third).length, 0);
});

test('the guard: one drop point at the landing spot per pass, each name added just before its first toss; at most 32 points; per dimension', async () => {
    const bot = F.makeBot({ position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5, gravel: 3 } });
    const names = [];
    bot.hooks.toss = () => names.push([...bot.junk_guard.drops[0].names]);
    await I.dropItems(bot, I.planRemoval(bot, policyOf()));
    assert.equal(bot.junk_guard.drops.length, 1);
    const point = bot.junk_guard.drops[0];
    assert.deepEqual([point.pos, point.dim], [{ x: 0.5, y: 64, z: 3.5 }, 'overworld']);
    assert.deepEqual(names, [['rotten_flesh'], ['rotten_flesh', 'gravel']], 'added before each first toss');
    const item = Object.values(bot.entities).find(e => e.getDroppedItem?.().name === 'gravel');
    assert.equal(I.isGuardedJunk(bot, item), true);
    assert.equal(I.isGuardedJunk(bot, { ...item, getDroppedItem: () => ({ name: 'dirt' }) }), false, 'a name not dropped there');
    bot.game.dimension = 'the_nether';
    assert.equal(I.isGuardedJunk(bot, item), false);
    bot.game.dimension = 'overworld';
    assert.equal(I.isGuardedJunk(bot, item, Date.now() + INV.guardMs), false, 'after 5 minutes');
    // A skipped operation adds no name.
    const skip = F.makeBot({ inventory: { rotten_flesh: 5, gravel: 3 } });
    const plan = I.planRemoval(skip, policyOf());
    skip.inventory.slots[plan[0].slot] = null;
    await I.dropItems(skip, plan);
    assert.deepEqual(skip.junk_guard.drops[0].names, ['gravel']);
    for (let i = 0; i < 40; i++) { bot.give('gravel', 1); await I.dropItems(bot, I.planRemoval(bot, policyOf())); }
    assert.equal(bot.junk_guard.drops.length, INV.guardMax);
});

test('a toss that throws is a failed outcome with what was removed, never a throw', async () => {
    const bot = F.makeBot({ inventory: { rotten_flesh: 5, gravel: 3 } });
    const transfer = bot.transfer;
    let calls = 0;
    bot.transfer = async options => { if (++calls === 2) throw new Error('window closed'); return transfer(options); };
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()));
    assert.deepEqual([result.outcome, result.reason, result.removed], ['failed', 'window closed', { rotten_flesh: 5 }]);
});

// --- the idle cleanup (design §4) ----------------------------------------------------------------

test('idle cleanup: below 4 free slots and idle, she drops the surplus by herself, standing still, with no model call and no chat', async () => {
    const agent = setup({ inventory: { rotten_flesh: 128, gravel: 41, dirt: 100, diamond: 3 } });
    const { bot } = agent;
    const start = bot.entity.position.clone();
    await passed(agent);
    assert.equal(bot.count('rotten_flesh'), 0);
    assert.equal(bot.count('gravel'), 0);
    assert.equal(bot.count('dirt'), 64);
    assert.equal(bot.count('diamond'), 3);
    assert.equal(bot.count(FILLER) > 0, true);
    assert.ok(bot.entity.position.equals(start), 'she stands still');
    assert.equal(bot.calls.some(c => c[0] === 'goto'), false);
    assert.equal(agent.modelCalls, 0);
    assert.deepEqual(agent.chats, []);
    assert.match(bot.modes.behavior_log, /Dropped junk\./);
    // Faces away from the owner (8 blocks east): west.
    const [, look] = bot.calls.find(c => c[0] === 'lookAt');
    assert.ok(look.x < start.x, `looked at ${look}`);
    assert.deepEqual(agent.work.items.last.removed, { rotten_flesh: 128, gravel: 41, dirt: 36 });
});

test('the idle admission: each condition holds the pass', async () => {
    const agent = setup({ drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    const work = agent.work;
    const ok = () => items.admit() !== null;
    assert.equal(ok(), true, 'the base case admits');
    const cases = [
        ['an item list error', () => { work.config.inventory.error = 'x'; }, () => { work.config.inventory.error = null; }],
        ['idle cleanup off', () => { work.config.inventory.idle = false; }, () => { work.config.inventory.idle = true; }],
        ['4 free slots', () => { bot.take(FILLER, 128); }, () => { bot.give(FILLER, 128); }],
        ['a running task', () => { work.record = { status: 'active', plan: [], cursor: 0 }; }, () => { work.record = null; }],
        ['an open owner question', () => { work.record = { status: 'blocked', pending_question: { id: 1 }, plan: [], cursor: 0 }; }, () => { work.record = null; }],
        ['an active goal', () => { agent.self_prompter.state = 1; }, () => { agent.self_prompter.state = 0; }],
        ['a paused goal', () => { agent.self_prompter.state = 2; }, () => { agent.self_prompter.state = 0; }],
        ['a message turn in flight', () => { work.liveTurns.add({}); }, () => { work.liveTurns.clear(); }],
        ['a stop in progress', () => { agent.actions.stopPromise = Promise.resolve(); }, () => { agent.actions.stopPromise = null; }],
        ['a hostile within 16 in the last 5 s', () => { items.lastHostileAt = Date.now(); }, () => { items.lastHostileAt = -Infinity; }],
        ['30 s since the last pass', () => { items.lastPassAt = Date.now(); }, () => { items.lastPassAt = -Infinity; }],
        ['the !stop hold', () => { items.stopUntil = Date.now() + 1000; }, () => { items.stopUntil = 0; }],
        ['the pass cap hold', () => { items.capUntil = Date.now() + 1000; }, () => { items.capUntil = 0; }],
        ['a pass in flight', () => { items.latch = true; }, () => { items.latch = false; }],
        ['the bed pickup in flight', () => { work.sleeper.latch = true; }, () => { work.sleeper.latch = false; }],
        ['the sleep routine', () => { work.sleeper.running = true; }, () => { work.sleeper.running = false; }],
        ['a tidy waiting out a hostile', () => { work.tidy.deferred = {}; }, () => { work.tidy.deferred = null; }],
        ['nothing to drop', () => { bot.take('rotten_flesh', 128); bot.take('gravel', 41); }, () => { bot.give('rotten_flesh', 128); bot.give('gravel', 41); }],
    ];
    for (const [why, set, reset] of cases) {
        set();
        assert.equal(ok(), false, why);
        reset();
        assert.equal(ok(), true, `${why}: admits again`);
    }
    // A paused or blocked task does not exclude the pass; its needed items stay.
    work.record = { status: 'paused', plan: [], cursor: 0 };
    assert.equal(ok(), true);
    work.record = null;
    // Anything executing holds the idle admission (only the follow may be cut).
    let release;
    void agent.actions.runAction('action:other', () => new Promise(resolve => { release = resolve; }));
    await F.until(() => agent.actions.executing);
    assert.equal(ok(), false, 'an action executing');
    release();
    await F.until(() => !agent.actions.executing);
    // The hostile sample: tick sees one within 16 and holds for 5 s.
    INV.hostileQuietMs = 5000;
    F.hostile(bot, 'zombie', [12, 0, 0]);
    items.tick();
    assert.equal(tosses(bot).length, 0);
    assert.ok(Date.now() - items.lastHostileAt < 100);
});

test('the turn wrapper counts every handleMessage call in flight, and records the action a turn starts', async () => {
    const agent = setup({ drive: false });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    agent.prompter.promptConvo = async () => { await gate; return ''; };
    const turn = agent.handleMessage(F.OWNER, 'hello there');
    assert.equal(agent.work.liveTurns.size, 1, 'counted synchronously on entry');
    assert.equal(agent.work.items.admit(), null);
    release();
    await turn;
    assert.equal(agent.work.liveTurns.size, 0);
    assert.notEqual(agent.work.items.admit(), null);
});

test('a pending resume holds the idle pass within 3 s of an action ending normally, except a follow whose target is not visible', async () => {
    INV.resumeGapMs = 3000;
    const agent = setup({ drive: false, idleDelay: 2000 });
    const { actions, bot } = agent;
    const items = agent.work.items;
    bot.emit('idle');   // an action ended normally: a pending resume is due in 1 s
    assert.ok(Date.now() - items.lastIdleAt < 100);
    actions.resume_func = async () => {};
    actions.resume_name = 'action:followPlayer';
    assert.equal(items.admit(), null, 'the follow resumes first');
    items.lastIdleAt = Date.now() - 3001;
    assert.notEqual(items.admit(), null, 'a follow that did not resume (timed out) does not starve the cleanup');
    items.lastIdleAt = Date.now();
    delete bot.players[F.OWNER];   // the target out of sight: the dead follow re-runs every second
    assert.notEqual(items.admit(), null);
    F.player(bot, F.OWNER, [8, 64, 0]);
    actions.resume_name = 'action:other';
    assert.equal(items.admit(), null, 'any other pending resume');
    actions.cancelResume();
});

test('following: an owner-typed !followPlayer with a full bag gets a pass that cuts the follow, faces away from him, and the follow resumes with no timeout', async () => {
    const agent = setup({ drive: false, ownerAt: [6.5, 64, 0.5] });
    const { bot } = agent;
    const seen = [];
    const run = agent.actions._executeAction;
    agent.actions._executeAction = function (label, fn, timeout) { seen.push([label, timeout]); return run.call(this, label, fn, timeout); };
    bot.hooks.goto = () => new Promise(() => {});   // a follow's pathfinder never arrives
    void F.ownerSays(agent, `!followPlayer("${F.OWNER}", 3)`);
    await F.until(() => agent.actions.currentActionLabel === 'action:followPlayer' && bot.pathfinder.goal?.entity);
    assert.equal(agent.work.liveTurns.size, 1, 'the turn that started the follow stays open');
    stops.push(F.drive(agent));
    await passed(agent);
    await F.until(() => agent.actions.currentActionLabel === 'action:followPlayer', { timeout: 4000 });
    assert.equal(bot.count('rotten_flesh'), 0);
    const [, look] = bot.calls.find(c => c[0] === 'lookAt');
    assert.ok(look.x < bot.entity.position.x, 'away from the follow target (east of her)');
    assert.deepEqual(seen.filter(([l]) => l === 'action:followPlayer').map(([, t]) => t), [-1, -1], 'resumed with no timeout');
    assert.deepEqual(seen.map(([l]) => l), ['action:followPlayer', 'action:items', 'action:followPlayer']);
    assert.equal(agent.modelCalls, 0);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('the follow admission: not while a goal is active or paused, nor with the target out of sight, nor another turn; only the pending follow is cut', async () => {
    const agent = setup({ drive: false });
    const { bot, actions } = agent;
    const items = agent.work.items;
    let follows = 0;
    const follow = async () => {
        follows++;
        bot.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(bot.players[F.OWNER].entity, 3), true);
        while (!bot.interrupt_code) await F.sleep(10);
    };
    void actions.runAction('action:followPlayer', follow, { resume: true, timeout: -1 });
    await F.until(() => follows === 1);
    const admitted = items.admit();
    assert.equal(admitted?.follow, true);
    assert.equal(admitted.awayFrom, bot.players[F.OWNER].entity.position);
    agent.self_prompter.state = 1;
    assert.equal(items.admit(), null, 'an active goal');
    agent.self_prompter.state = 2;
    assert.equal(items.admit(), null, 'a paused goal');
    agent.self_prompter.state = 0;
    agent.work.liveTurns.add({ action: { label: 'action:other' } });
    assert.equal(items.admit(), null, 'a turn not parked on the follow');
    agent.work.liveTurns.clear();
    const entity = bot.players[F.OWNER].entity;
    bot.players[F.OWNER].entity = null;
    assert.equal(items.admit(), null, 'the target out of sight');
    bot.players[F.OWNER].entity = entity;
    assert.notEqual(items.admit(), null);
    const goal = bot.pathfinder.goal;
    bot.pathfinder.setGoal(null);
    assert.equal(items.admit(), null, 'the follow is not following its target right now');
    bot.pathfinder.setGoal(goal, true);
    assert.notEqual(items.admit(), null);
    actions.cancelResume();   // no longer the pending resumable owner action
    assert.equal(items.admit(), null);
    bot.interrupt_code = true;
    await F.until(() => !actions.executing);
    bot.interrupt_code = false;
    // Another running action is never cut.
    let release;
    void actions.runAction('action:goToPlayer', () => new Promise(resolve => { release = resolve; }));
    await F.until(() => actions.executing);
    assert.equal(items.admit(), null);
    release();
    await F.until(() => !actions.executing);
    // Nor another resumable owner action, even one following the owner's entity.
    const other = async () => {
        bot.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(bot.players[F.OWNER].entity, 3), true);
        while (!bot.interrupt_code) await F.sleep(10);
    };
    void actions.runAction('action:other', other, { resume: true, timeout: -1 });
    await F.until(() => actions.currentActionLabel === 'action:other');
    assert.equal(items.admit(), null, 'only action:followPlayer is cut');
    actions.cancelResume();
    bot.interrupt_code = true;
    await F.until(() => !actions.executing);
    bot.interrupt_code = false;
});

// --- currency, holds, quiet (design §4) ----------------------------------------------------------

test('currency: a stop, an owner message or another action started before the pass starts, or a stop or message between its tosses, ends it', async () => {
    for (const cut of ['stop', 'message', 'start']) {
        // Pending: the launch's callback re-checks at entry.
        const agent = setup({ drive: false });
        const items = agent.work.items;
        const admitted = items.admit();
        assert.ok(admitted);
        const run = agent.actions.runAction;
        agent.actions.runAction = function (...args) {
            if (cut === 'start') {
                // Another action (a mode) recorded after this launch, before its entry.
                const started = run.apply(this, args);
                agent.work.onActionStart('mode:self_defense', async () => {}, {});
                return started;
            }
            if (cut === 'stop') agent.stop_epoch++; else agent.work.onOwnerMessage(F.OWNER, 'hi');
            return run.apply(this, args);
        };
        items.launch(admitted);
        await quiet(agent);
        assert.equal(tosses(agent.bot).length, 0, `${cut} before entry`);
        agent.actions.runAction = run;
        if (cut === 'start') continue;
        // Running: between tosses.
        const second = setup({ drive: false });
        second.bot.hooks.toss = () => { if (cut === 'stop') second.stop_epoch++; else second.work.onOwnerMessage(F.OWNER, 'hi'); };
        second.work.items.launch(second.work.items.admit());
        await quiet(second);
        assert.equal(tosses(second.bot).length, 1, `${cut} between tosses`);
        assert.equal(second.bot.count('gravel'), 41);
    }
});

test('holds: 30 s between passes; a pass that removed nothing waits for a change; an owner !stop during a pass holds 10 minutes', async () => {
    INV.cooldownMs = 30000;
    const agent = setup({ drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    items.launch(items.admit());
    await quiet(agent);
    fill(bot, 2);
    bot.give('rotten_flesh', 10);
    assert.equal(items.admit(), null, 'cooling down');
    assert.match(items.held(), /cooling down/);
    INV.cooldownMs = 0;
    // Nothing removed (a container open; R1-8 keeps a walled-in bag from
    // launching at all): held until the bag or her place changes.
    bot.currentWindow = { type: 'minecraft:chest' };
    items.launch(items.admit());
    await quiet(agent);
    bot.currentWindow = null;
    assert.equal(bot.count('rotten_flesh'), 10);
    const hold = items.idleHold;
    assert.ok(hold);
    assert.equal(items.admit(), null);
    assert.match(items.held(), /nothing to drop from here/);
    assert.equal(items.passes.length, 1, 'a pass that removed nothing does not count toward the cap');
    bot.give('rotten_flesh', 1);   // the bag changed
    assert.notEqual(items.admit(), null);
    items.idleHold = { ...hold, inv: items.signature(), at: Date.now() };
    assert.equal(items.admit(), null);
    bot.entity.position = bot.entity.position.offset(9, 0, 0);   // moved beyond 8
    assert.notEqual(items.admit(), null);
    bot.entity.position = bot.entity.position.offset(-9, 0, 0);
    items.idleHold = { ...hold, inv: items.signature(), at: Date.now() - INV.retryMs };   // 5 minutes
    assert.notEqual(items.admit(), null);
    // An owner !stop during a pass: the pass ends and the cleanup is held.
    const second = setup({ drive: false });
    second.bot.hooks.toss = () => second.work.keepOnStop(F.OWNER, '!stop');
    second.work.items.launch(second.work.items.admit());
    await quiet(second);
    assert.ok(second.work.items.stopUntil - Date.now() > INV.stopHoldMs - 1000);
    assert.equal(second.work.items.admit(), null);
    assert.match(second.work.items.held(), /held 10 min after a !stop/);
    // A !stop outside a pass holds nothing.
    const third = setup({ drive: false });
    third.work.keepOnStop(F.OWNER, '!stop');
    assert.equal(third.work.items.stopUntil, 0);
});

test('the pass cap: a 4th pass within 10 minutes holds the cleanup 10 minutes and tells the owner once', async () => {
    INV.cooldownMs = 0;
    const agent = setup({ drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    const line = "I've cleaned my bag 4 times in 10 minutes, so I'm pausing that for 10 minutes.";
    const onePass = async i => {
        fill(bot, 2);
        bot.give('rotten_flesh', 5);
        const admitted = items.admit();
        assert.ok(admitted, `pass ${i + 1}`);
        items.launch(admitted);
        await quiet(agent);
        await F.sleep(25);   // upstream's fast-loop guard counts actions under 20 ms apart
    };
    for (let i = 0; i < 4; i++) await onePass(i);
    fill(bot, 2);
    bot.give('rotten_flesh', 5);
    assert.equal(items.admit(), null);
    assert.ok(items.capUntil - Date.now() > INV.capHoldMs - 1000);
    assert.match(items.held(), /held 10 min after 4 passes in 10 min/);
    await F.until(() => agent.chats.includes(line));
    // Another cap later in the session is not told again.
    items.capUntil = 0;
    for (let i = 0; i < 4; i++) await onePass(i);
    assert.ok(items.capUntil > Date.now());
    await F.sleep(50);
    assert.equal(agent.chats.filter(c => c === line).length, 1);
    // Only passes within the 10-minute window count.
    items.capUntil = 0;
    items.passes = [Date.now() - INV.capWindowMs - 1000, Date.now() - INV.capWindowMs - 500, Date.now() - INV.capWindowMs - 100];
    await onePass(0);
    assert.equal(items.capUntil, 0, 'three passes older than the window do not count');
    assert.equal(items.passes.length, 1);
    // Passes that removed nothing (no free direction) do not count.
    const second = setup({ drive: false });
    second.bot.world.fill(-3, 64, -3, 3, 65, 3, 'stone');
    second.bot.world.set(0, 64, 0, 'air');
    second.bot.world.set(0, 65, 0, 'air');
    for (let i = 0; i < 4; i++) {
        second.work.items.launch({ follow: false, awayFrom: null });
        await quiet(second);
    }
    assert.equal(second.work.items.passes.length, 0);
    assert.equal(second.work.items.capUntil, 0);
});

test('a fight that cuts a pass prompts no model call (action:items is quiet), and sleep may cut it', async () => {
    const agent = setup({ modes: { self_defense: true }, inventory: { rotten_flesh: 64 * 6 } });
    const { bot } = agent;
    bot.hooks.toss = () => { if (tosses(bot).length === 2) F.hostile(bot, 'zombie', [3, 0, 0]); };
    await F.until(() => tosses(bot).length >= 2 && !agent.work.items.latch);
    await F.until(() => !agent.actions.executing, { timeout: 4000 });
    await F.sleep(100);
    assert.equal(agent.work.isQuietAction('action:items'), true);
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), false);
    // Sleep's cut rule (REQ-SLP-2, always): the pass is cut like the task's run.
    let release;
    void agent.actions.runAction('action:items', () => new Promise(resolve => { release = resolve; }));
    await F.until(() => agent.actions.currentActionLabel === 'action:items');
    assert.equal(agent.work.sleeper.mayCut('always'), true);
    release();
});

test('a throw inside the pass is caught: the latch is released and a pending resume survives', async () => {
    const agent = setup({ drive: false, idleDelay: 2000 });
    const items = agent.work.items;
    const admitted = items.admit();
    agent.actions.resume_func = async () => {};
    agent.actions.resume_name = 'action:followPlayer';
    agent.work.neededItems = () => { throw new Error('boom'); };   // inside the pass's re-plan
    items.launch(admitted);
    await quiet(agent);
    assert.equal(items.latch, false);
    assert.equal(agent.actions.resume_name, 'action:followPlayer', 'the ActionManager catch never ran');
    agent.actions.cancelResume();
});

test('a bag full of kept items: no pass, and one note naming the five largest kept items, totalled by name', async () => {
    const agent = setup({ inventory: { arrow: 64, gunpowder: 64 * 3, ender_pearl: 16, bone: 10, string: 64, diamond: 5, emerald: 7 } });
    const line = `My bag is full of things I keep: ${FILLER} ${agent.bot.count(FILLER)}, gunpowder 192, arrow 64, string 64, ender_pearl 16; add some to my item list?`;
    await F.until(() => agent.chats.includes(line));
    await F.sleep(150);
    assert.equal(tosses(agent.bot).length, 0);
    assert.equal(agent.chats.filter(c => c === line).length, 1);
    assert.equal(agent.actions.executing, false);
    // The empty plan is remembered per inventory: junk picked up later goes.
    agent.bot.give('rotten_flesh', 3);
    await F.until(() => agent.bot.count('rotten_flesh') === 0);
});

test('!itemList shows the list by tier with what she holds, her free slots, the state and the last pass', async () => {
    const agent = setup({ drive: false });
    const items = agent.work.items;
    const before = await F.modules.commands.executeCommand(agent, '!itemList');
    assert.match(before, /^Item list \(anything not listed I keep\): Drop all: rotten_flesh 128, spider_eye, gravel 41, /);
    assert.match(before, /Keep 64: dirt, cobblestone, bone, string, phantom_membrane, arrow, flint, coal\. Keep all: gunpowder\./);
    assert.match(before, /2 free slots; I clean up below 4\. Idle cleanup: on\. No pass yet\.$/);
    items.launch(items.admit());
    await quiet(agent);
    const after = await F.modules.commands.executeCommand(agent, '!itemList');
    assert.match(after, /Drop all: rotten_flesh, spider_eye, gravel, /);
    assert.match(after, /Last pass: dropped 128 rotten_flesh, 41 gravel, 0 min ago\.$/);
    agent.work.config.inventory.idle = false;
    assert.match(items.render(), /Idle cleanup: off \(work\.inventory\.idle\)\./);
});

// --- in a task (design §5) -----------------------------------------------------------------------

test('in a task the shared dropper drops what the old junk drop did with the old defaults, tier-0 first', async () => {
    // The old defaults' drop for this bag: dirt 136, cobblestone 36, gravel 30, andesite 64, rotten_flesh 5.
    const bot = F.makeBot({ inventory: { dirt: 200, cobblestone: 100, gravel: 30, andesite: 64, diamond: 3, oak_sapling: 20, rotten_flesh: 5 } });
    bot.quickBarSlot = 8;   // a slot she does not use here
    const plan = I.planRemoval(bot, policyOf());
    const by = {};
    for (const o of plan) by[o.name] = (by[o.name] ?? 0) + o.count;
    assert.deepEqual(by, { dirt: 136, cobblestone: 36, gravel: 30, andesite: 64, rotten_flesh: 5 });
    const tier0 = plan.findIndex(o => policyOf().items[o.name] !== 0);
    assert.ok(plan.slice(tier0).every(o => policyOf().items[o.name] !== 0), 'every tier-0 stack first (the intended ordering change)');
});

// --- fix wave 1 (review round 1: s2e-rulings-r1.md) ---------------------------------------------

test('R1-1: an item on the cursor: no transfer (a one-slot transfer would toss it as a leftover), unavailable', async () => {
    const bot = F.makeBot({ inventory: { rotten_flesh: 5, gravel: 3 } });
    bot.inventory.selectedItem = { name: 'diamond', count: 3, type: F.registry.itemsByName.diamond.id };
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()));
    assert.equal(result.outcome, 'unavailable');
    assert.equal(tosses(bot).length, 0);
    // Set between two tosses: the second is not clicked.
    const second = F.makeBot({ inventory: { rotten_flesh: 5, gravel: 3 } });
    second.hooks.toss = () => { second.inventory.selectedItem = { name: 'diamond', count: 3 }; };
    const r2 = await I.dropItems(second, I.planRemoval(second, policyOf()));
    assert.deepEqual([r2.outcome, r2.removed], ['unavailable', { rotten_flesh: 5 }]);
    assert.equal(tosses(second).length, 1);
});

test('R1-2: an open container window: no transfer (it would click the container), unavailable', async () => {
    const bot = F.makeBot({ inventory: { rotten_flesh: 5 } });
    bot.currentWindow = { type: 'minecraft:furnace', slots: [] };
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()));
    assert.equal(result.outcome, 'unavailable');
    assert.equal(tosses(bot).length, 0);
    bot.currentWindow = bot.inventory;   // her own inventory window is fine
    assert.equal((await I.dropItems(bot, I.planRemoval(bot, policyOf()))).outcome, 'done');
    assert.equal(bot.count('rotten_flesh'), 0);
});

test('R1-3: the live selected hotbar slot is never tossed, even when the selection changed after the plan', async () => {
    const bot = slotted([[37, 'gravel', 10], [38, 'rotten_flesh', 5]]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[37, 'gravel', 10], [38, 'rotten_flesh', 5]]);
    const wait = bot.waitForTicks;
    bot.waitForTicks = async t => { await wait(t); bot.quickBarSlot = 1; };   // the server selects slot 37
    const result = await I.dropItems(bot, plan);
    assert.deepEqual(result.removed, { rotten_flesh: 5 });
    assert.equal(bot.count('gravel'), 10);
});

test('R1-4: the empty-plan memory includes the selected slot and expires after 5 minutes', async () => {
    const agent = setup({ inventory: {}, free: 0, drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    bot.take(FILLER, 64 * 2);
    bot.inventory.slots[36] = { name: 'gravel', count: 10, type: F.registry.itemsByName.gravel.id, stackSize: 64 };   // held
    assert.equal(items.admit(), null, 'only the held gravel is disposable');
    bot.quickBarSlot = 1;   // a filler is held now: the gravel may go
    assert.notEqual(items.admit(), null, 'the selection is part of the key');
    bot.quickBarSlot = 0;
    assert.equal(items.admit(), null);
    agent.work.config.inventory.items[FILLER] = 0;   // a change the key does not see
    assert.equal(items.admit(), null);
    items.emptyKey.at -= INV.retryMs;
    assert.notEqual(items.admit(), null, 'expired after 5 minutes');
});

test('R1-5: a hostile or a message turn arriving during the wait or between tosses ends the pass', async () => {
    INV.hostileQuietMs = 5000;
    for (const cut of ['hostile', 'turn']) {
        const agent = setup({ drive: false });
        const { bot } = agent;
        const make = () => { if (cut === 'hostile') F.hostile(bot, 'zombie', [10, 0, 0]); else agent.work.liveTurns.add({}); };
        const wait = bot.waitForTicks;
        bot.waitForTicks = async t => { await wait(t); make(); };
        agent.work.items.launch(agent.work.items.admit());
        await quiet(agent);
        assert.equal(tosses(bot).length, 0, `${cut} during the wait`);
        const second = setup({ drive: false });
        second.bot.hooks.toss = () => { if (cut === 'hostile') F.hostile(second.bot, 'zombie', [10, 0, 0]); else second.work.liveTurns.add({}); };
        second.work.items.launch(second.work.items.admit());
        await quiet(second);
        assert.equal(tosses(second.bot).length, 1, `${cut} between tosses`);
    }
});

test('R1-6: prototype names in the item list fail it (registry membership is an own key; the merge keeps every raw key)', () => {
    const bot = F.makeBot();
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(I.unknownItemName(bot, policyOf({ inventory: { items: { [name]: 0 } } })), name, name);
    }
    const proto = policyOf({ inventory: { items: JSON.parse('{"__proto__": 0}') } });
    assert.equal(Object.hasOwn(proto.items, '__proto__'), true, 'kept as an entry, not a prototype');
    assert.equal(I.unknownItemName(bot, proto), '__proto__');
    assert.equal(proto.items.gravel, 0, 'the defaults are still there');
});

test('R1-7: a floor lower than a full block (path, farmland, soul sand, mud, a bottom slab, a carpet) leaves the directions free; a wall still blocks', () => {
    const floors = [
        ['dirt_path', null, 0.9375], ['farmland', { moisture: '0' }, 0.9375], ['soul_sand', null, 0.875], ['mud', null, 0.875],
        ['oak_slab', { type: 'bottom', waterlogged: 'false' }, 0.5],
    ];
    for (const [name, props, top] of floors) {
        const world = new F.World();
        world.fill(-4, 63, -4, 4, 63, 4, name, props);
        const bot = F.makeBot({ world, position: [0.5, 63 + top, 0.5] });
        assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: 1 }, name);
        world.set(0, 64, 1, 'stone');   // her body row: a wall
        world.set(1, 65, 0, 'stone');   // her eye row
        world.set(-1, 64, 0, 'stone');
        assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: -1 }, `${name}: walls block`);
    }
    // A carpet on a full floor: she stands 1/16 up, in the carpet's cell.
    const carpet = new F.World();
    carpet.fill(-4, 63, -4, 4, 63, 4, 'grass_block', { snowy: 'false' });
    carpet.fill(-4, 64, -4, 4, 64, 4, 'white_carpet');
    assert.deepEqual(I.chooseFacing(F.makeBot({ world: carpet, position: [0.5, 64.0625, 0.5] })), { dx: 0, dz: 1 }, 'carpet');
    // A full floor is unchanged.
    const grass = new F.World();
    grass.fill(-4, 63, -4, 4, 63, 4, 'grass_block', { snowy: 'false' });
    const bot = F.makeBot({ world: grass, position: [0.5, 64, 0.5] });
    assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: 1 });
    grass.set(0, 64, 2, 'stone');
    assert.deepEqual(I.chooseFacing(bot), { dx: -1, dz: 0 }, 'a block at her feet row blocks');
    // Up to half a block above her feet does not block the throw (it leaves 1.32 up):
    // a path between grass, a slab ahead on a full floor.
    const path = new F.World();
    path.fill(-4, 63, -4, 4, 63, 4, 'grass_block', { snowy: 'false' });
    path.set(0, 63, 0, 'dirt_path');
    assert.deepEqual(I.chooseFacing(F.makeBot({ world: path, position: [0.5, 63.9375, 0.5] })), { dx: 0, dz: 1 }, 'grass beside a path');
    grass.set(0, 64, 2, 'oak_slab', { type: 'bottom', waterlogged: 'false' });
    assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: 1 }, 'a bottom slab ahead');
});

// Walls her in except the cardinals listed ([dx, dz]).
function wallIn(bot, open) {
    const p = bot.entity.position.floored();
    for (const [dx, dz] of [[0, 1], [-1, 0], [0, -1], [1, 0]]) {
        if (open.some(([x, z]) => x === dx && z === dz)) continue;
        bot.world.set(p.x + dx, p.y, p.z + dz, 'stone');
    }
}

test('R1-8: with no free direction the cleanup does not launch, and never cuts a follow', async () => {
    const agent = setup({ drive: false });
    wallIn(agent.bot, []);
    assert.equal(agent.work.items.admit(), null, 'idle');
    // Walled in, it holds like a pass that removed nothing: no re-plan every second (S2e r2 adversary N1).
    assert.equal(agent.work.items.held(), 'waiting: nothing to drop from here');
    const follow = setup({ drive: false });
    const { bot, actions } = follow;
    wallIn(bot, []);
    void actions.runAction('action:followPlayer', async () => {
        bot.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(bot.players[F.OWNER].entity, 3), true);
        while (!bot.interrupt_code) await F.sleep(10);
    }, { resume: true, timeout: -1 });
    await F.until(() => bot.pathfinder.goal?.entity);
    assert.equal(follow.work.items.admit(), null, 'no cut');
    actions.cancelResume();
    bot.interrupt_code = true;
    await F.until(() => !actions.executing);
});

test('R1-9: in a follow she never drops toward the target; with only that direction free there is no pass', async () => {
    const bot = F.makeBot({ position: [0.5, 64, 0.5] });
    const target = { x: 6.5, y: 64, z: 0.5 };   // east
    wallIn(bot, [[1, 0], [0, 1]]);              // east (toward) and south (across) free
    assert.deepEqual(I.chooseFacing(bot, target, { never: target }), { dx: 0, dz: 1 }, 'across, not toward');
    bot.world.set(0, 64, 1, 'stone');
    assert.equal(I.chooseFacing(bot, target, { never: target }), null);
    assert.deepEqual(I.chooseFacing(bot, target), { dx: 1, dz: 0 }, 'without the rule east would be taken');
    // A target within half a block (standing on her): no direction is away from him, so no pass (Sol r2 N1).
    const open = F.makeBot({ position: [0.5, 64, 0.5] });
    assert.equal(I.chooseFacing(open, { x: 0.9, y: 64, z: 0.5 }, { never: { x: 0.9, y: 64, z: 0.5 } }), null);
    assert.notEqual(I.chooseFacing(open, null, { avoid: { x: 0.9, y: 64, z: 0.5 } }), null, 'a task owner that close is only a preference');
    // Through the admission: the follow is not cut.
    const agent = setup({ drive: false, ownerAt: [6.5, 64, 0.5] });
    agent.bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    wallIn(agent.bot, [[1, 0]]);
    const { actions } = agent;
    void actions.runAction('action:followPlayer', async () => {
        agent.bot.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(agent.bot.players[F.OWNER].entity, 3), true);
        while (!agent.bot.interrupt_code) await F.sleep(10);
    }, { resume: true, timeout: -1 });
    await F.until(() => agent.bot.pathfinder.goal?.entity);
    assert.equal(agent.work.items.admit(), null);
    actions.cancelResume();
    agent.bot.interrupt_code = true;
    await F.until(() => !actions.executing);
});

test('R1-10: in a task, away from the work first, then a direction not toward the owner within 16', () => {
    const bot = F.makeBot({ position: [0.5, 64, 0.5] });
    const work = { x: 10.5, y: 64, z: 0.5 };    // east: west is preferred
    const owner = { x: -5.5, y: 64, z: 0.5 };   // west, within 16
    assert.deepEqual(I.chooseFacing(bot, work), { dx: -1, dz: 0 });
    const facing = I.chooseFacing(bot, work, { avoid: owner });
    assert.equal(facing.dx, 0, `not toward the owner: ${JSON.stringify(facing)}`);
    wallIn(bot, [[-1, 0], [1, 0]]);
    assert.deepEqual(I.chooseFacing(bot, work, { avoid: owner }), { dx: -1, dz: 0 }, 'a preference: the only way off the work still goes');
});

test('R1-11: the idle pass faces away from the owner only within 16 blocks', async () => {
    const near = setup({ drive: false, ownerAt: [10.5, 64, 0.5] });
    assert.deepEqual(near.work.items.admit().awayFrom, near.bot.players[F.OWNER].entity.position);
    const far = setup({ drive: false, ownerAt: [17.5, 64, 0.5] });
    assert.equal(far.work.items.admit().awayFrom, null);
});

test('R1-11: a follow pass re-reads the target at entry and faces away from where it is now', async () => {
    const agent = setup({ drive: false, ownerAt: [6.5, 64, 0.5] });
    const { bot, actions } = agent;
    void actions.runAction('action:followPlayer', async () => {
        bot.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(bot.players[F.OWNER].entity, 3), true);
        while (!bot.interrupt_code) await F.sleep(10);
    }, { resume: true, timeout: -1 });
    await F.until(() => bot.pathfinder.goal?.entity);
    const admitted = agent.work.items.admit();
    assert.equal(admitted?.follow, true);
    bot.players[F.OWNER].entity.position = new F.Vec3(-6.5, 64, 0.5);   // he walked to her west
    agent.work.items.launch(admitted);
    await F.until(() => tosses(bot).length > 0);
    const [, look] = bot.calls.find(c => c[0] === 'lookAt');
    assert.ok(look.x > bot.entity.position.x, `away from where he is now: ${look}`);
    actions.cancelResume();
    bot.interrupt_code = true;
    await F.until(() => !actions.executing);
    bot.interrupt_code = false;
});

test('R1-11: a task that starts, or a question that opens, between tosses ends the pass; an interrupted pass sets no hold', async () => {
    for (const cut of ['task', 'question']) {
        const agent = setup({ drive: false });
        agent.bot.hooks.toss = () => {
            agent.work.record = cut === 'task' ? { status: 'active', plan: [], cursor: 0 } : { status: 'blocked', pending_question: { id: 1 }, plan: [], cursor: 0 };
        };
        agent.work.items.launch(agent.work.items.admit());
        await quiet(agent);
        assert.equal(tosses(agent.bot).length, 1, cut);
        agent.work.record = null;
    }
    const agent = setup({ drive: false });
    const wait = agent.bot.waitForTicks;
    agent.bot.waitForTicks = async t => { await wait(t); agent.stop_epoch++; };
    agent.work.items.launch(agent.work.items.admit());
    await quiet(agent);
    assert.equal(tosses(agent.bot).length, 0);
    assert.equal(agent.work.items.idleHold, null, 'interrupted before removing anything: not held');
});
