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

test('S2e-fu §4: the new defaults: the best bow and crossbow, one slot of ominous bottles and of each banner; arrows stay a stack', () => {
    const items = C.WORK_DEFAULTS.inventory.items;
    assert.deepEqual([items.bow, items.crossbow, items.ominous_bottle, items.arrow], [1, 1, 'slot', 'stack']);
    const banners = Object.keys(items).filter(name => name.endsWith('_banner'));
    assert.equal(banners.length, 16);
    assert.ok(banners.every(name => items[name] === 'slot'));
    assert.deepEqual(banners.filter(name => !F.registry.itemsByName[name]), []);
    assert.equal(F.registry.itemsArray.filter(i => i.name.endsWith('_banner')).length, 16, 'every banner of the registry');
    assert.equal(I.keepOf(F.makeBot(), policyOf(), 'white_banner'), 'slot');
    assert.deepEqual(Object.entries(items).filter(([, keep]) => keep === 'slot').map(([name]) => name).sort(),
        ['ominous_bottle', ...banners].sort(), 'only the bottles and the banners');
    // The list accepts "slot" for any item (amendment C).
    const p = policyOf({ inventory: { items: { arrow: 'slot' } } });
    assert.deepEqual([p.error, p.items.arrow], [null, 'slot']);
    assert.match(policyOf({ inventory: { items: { arrow: 'slots' } } }).error, /^arrow: "slots"$/);
});

test('S2e-fu amendment C: one slot of the best: of ominous bottles of amplifiers 0, 2 and 4 only the amplifier-4 slot stays; of two banner stacks the larger', () => {
    const bottle = (slot, amp, count = 1) => [slot, 'ominous_bottle', count, amp == null ? {} :
        { componentMap: new Map([['ominous_bottle_amplifier', { type: 'ominous_bottle_amplifier', data: amp }]]) }];
    // As Mineflayer holds them (componentMap from the 26.1 component; a bottle without it is amplifier 0).
    const bot = slotted([bottle(9, 4, 1), bottle(10, null, 5), bottle(11, 2, 3), [12, 'white_banner', 2], [13, 'white_banner', 7], [14, 'red_banner', 1]]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[10, 'ominous_bottle', 5], [11, 'ominous_bottle', 3], [12, 'white_banner', 2]], 'the amplifier beats the count; the larger banner stack stays');
    assert.equal(plan.freed, 3);
    // Ties: the existing order (the larger count, then the later slot stays).
    const tie = slotted([[9, 'white_banner', 3], [10, 'white_banner', 3]]);
    assert.deepEqual(ops(I.planRemoval(tie, policyOf())), [[9, 'white_banner', 3]]);
    // A task's needed item is never removed.
    assert.deepEqual(ops(I.planRemoval(bot, policyOf(), { needed: new Set(['ominous_bottle']) })), [[12, 'white_banner', 2]]);
});

// --- the planner (design §3) -------------------------------------------------------------------

// Puts stacks into exact slots: [[slot, name, count, extra item fields], ...].
function slotted(stacks) {
    const bot = F.makeBot();
    for (const [slot, name, count, extra] of stacks) bot.inventory.slots[slot] = { name, count, type: F.registry.itemsByName[name].id, stackSize: F.registry.itemsByName[name].stackSize, ...extra };
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

test('the planner never takes a needed item, an unlisted or an "all" item; the selected hotbar slot is a source like any other (S2e-fu §1)', () => {
    const bot = slotted([[36, 'rotten_flesh', 10], [9, 'rotten_flesh', 5], [37, 'gravel', 3], [10, 'gunpowder', 64], [11, 'gunpowder', 64],
        [12, 'diamond', 64], [13, 'dirt', 64], [14, 'dirt', 64], [15, 'cobblestone', 64], [16, 'cobblestone', 20]]);
    const plan = I.planRemoval(bot, policyOf(), { needed: new Set(['cobblestone']) });
    assert.deepEqual(ops(plan), [[9, 'rotten_flesh', 5], [36, 'rotten_flesh', 10], [37, 'gravel', 3], [13, 'dirt', 64]]);
    // The held slot is planned like the rest: 40 dirt in hand, 64 + 30 more, keep 64.
    const held = slotted([[36, 'dirt', 40], [9, 'dirt', 64], [10, 'dirt', 30]]);
    assert.deepEqual(ops(I.planRemoval(held, policyOf())), [[10, 'dirt', 30], [36, 'dirt', 40]]);
});

// --- the dropper (design §3) -------------------------------------------------------------------

const op = (bot, slot) => { const s = bot.inventory.slots[slot]; return { slot, name: s.name, count: s.count, have: s.count, whole: true, sig: F.modules.gear.signature(s) }; };

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
    world.set(0, 65, -3, 'oak_planks');
    world.set(-1, 65, 0, 'stone');
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
    // Passes that removed nothing (no free direction, no drop spot: the rim is 6 up) do not count.
    const second = setup({ drive: false });
    second.bot.world.fill(-3, 64, -3, 3, 69, 3, 'stone');
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
    assert.match(before, /^Item list \(anything not listed I keep; all my gear, and I use the best\): Drop all: rotten_flesh 128, spider_eye, gravel 41, /);
    assert.match(before, /Keep 1: bow, crossbow\. Keep 1 slot: ominous_bottle, white_banner, orange_banner, (\w+_banner, ){13}black_banner\. /);
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

test('R1-3: the live selected hotbar slot is never tossed: a slot the server selects between tosses is skipped', async () => {
    const bot = slotted([[36, 'diamond', 1], [37, 'gravel', 10], [38, 'rotten_flesh', 5]]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[37, 'gravel', 10], [38, 'rotten_flesh', 5]]);
    bot.hooks.toss = () => { bot.quickBarSlot = 2; };   // the server selects slot 38 after the first toss
    const result = await I.dropItems(bot, plan);
    assert.deepEqual(result.removed, { gravel: 10 });
    assert.equal(bot.count('rotten_flesh'), 5);
    assert.equal(bot.calls.some(c => c[0] === 'hotbar'), false, 'the held diamond was planned for nothing: no switch');
});

test('R1-4: the empty-plan memory keys on the inventory and the task state and expires after 5 minutes', async () => {
    const agent = setup({ inventory: {}, free: 0, drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    bot.take(FILLER, 64 * 2);
    assert.equal(items.admit(), null, 'a bag of kept planks');
    assert.ok(items.emptyKey);
    const first = items.emptyKey.key;
    // The held slot is part of the key (gear design r5 §5; gear Sol review r1, 7): planned again, still empty.
    bot.quickBarSlot = 1;
    assert.equal(items.admit(), null);
    assert.notEqual(items.emptyKey.key, first);
    assert.equal(items.admit(), null, 'remembered');
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
    grass.set(0, 65, 2, 'stone');
    assert.deepEqual(I.chooseFacing(bot), { dx: -1, dz: 0 }, 'a block in her eye row blocks');
    grass.set(0, 65, 2, 'air');
    // Up to half a block above her feet does not block the throw (it leaves 1.32 up):
    // a path between grass, a slab ahead on a full floor.
    const path = new F.World();
    path.fill(-4, 63, -4, 4, 63, 4, 'grass_block', { snowy: 'false' });
    path.set(0, 63, 0, 'dirt_path');
    assert.deepEqual(I.chooseFacing(F.makeBot({ world: path, position: [0.5, 63.9375, 0.5] })), { dx: 0, dz: 1 }, 'grass beside a path');
    grass.set(0, 64, 2, 'oak_slab', { type: 'bottom', waterlogged: 'false' });
    assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: 1 }, 'a bottom slab ahead');
});

// Walls her in, from her feet to her eyes, except the cardinals listed ([dx, dz]).
function wallIn(bot, open) {
    const p = bot.entity.position.floored();
    for (const [dx, dz] of [[0, 1], [-1, 0], [0, -1], [1, 0]]) {
        if (open.some(([x, z]) => x === dx && z === dz)) continue;
        bot.world.set(p.x + dx, p.y, p.z + dz, 'stone');
        bot.world.set(p.x + dx, p.y + 1, p.z + dz, 'stone');
    }
}

test('R1-8: with no free direction the cleanup does not launch, and never cuts a follow', async () => {
    const agent = setup({ drive: false });
    pit(agent.bot.world, 6);
    assert.equal(agent.work.items.admit(), null, 'idle');
    // In a shaft (no drop spot within reach), it holds like a pass that removed nothing:
    // no re-plan every second (S2e r2 adversary N1), and says why (S2e-fu F5).
    assert.equal(agent.work.items.held(), 'waiting: no free direction nearby');
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
    bot.world.set(0, 65, 1, 'stone');
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

// --- S2e-fu (design s2efu/design.md §1–§5; DECISIONS 2026-11-12) ---------------------------------

// A pit `depth` deep at her cell (0, 64, 0): stone from y 63 to 63 + depth within `size`, her column open.
function pit(world, depth, size = 6) {
    world.fill(-size, 63, -size, size, 63 + depth, size, 'stone');
    for (let y = 64; y <= 63 + depth; y++) world.set(0, y, 0, 'air');
}
const goals = bot => bot.calls.filter(c => c[0] === 'goto');

test('S2e-fu §1: junk in her hand: after the look and the wait she selects the first empty hotbar slot, else the first holding no planned operation, then drops it', async () => {
    const bot = slotted([[36, 'wheat_seeds', 1], [37, 'diamond', 1], [9, 'dirt', 64], [10, 'dirt', 3]]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[36, 'wheat_seeds', 1], [10, 'dirt', 3]]);
    const result = await I.dropItems(bot, plan);
    assert.deepEqual(bot.calls.map(c => c[0]), ['lookAt', 'waitForTicks', 'hotbar', 'toss', 'toss']);
    assert.deepEqual(bot.calls[2], ['hotbar', 2], 'slot 38, the first empty one (not the diamond at 37)');
    assert.deepEqual(result.removed, { wheat_seeds: 1, dirt: 3 });
    // No empty hotbar slot: the first one holding no planned operation.
    const full = slotted([[36, 'wheat_seeds', 1], [37, 'gravel', 4], [38, 'diamond', 1], ...[39, 40, 41, 42, 43, 44].map(s => [s, FILLER, 64])]);
    const second = await I.dropItems(full, I.planRemoval(full, policyOf()));
    assert.deepEqual(full.calls.find(c => c[0] === 'hotbar'), ['hotbar', 2]);
    assert.deepEqual(second.removed, { wheat_seeds: 1, gravel: 4 });
    // Every hotbar slot planned: no switch, the held one is skipped, the rest go.
    const junk = slotted([...Array(9).keys()].map(i => [36 + i, 'rotten_flesh', 1]));
    const third = await I.dropItems(junk, I.planRemoval(junk, policyOf()));
    assert.equal(junk.calls.some(c => c[0] === 'hotbar'), false);
    assert.deepEqual(third.removed, { rotten_flesh: 8 });
    assert.deepEqual(junk.inventory.slots[36], { name: 'rotten_flesh', count: 1, type: F.registry.itemsByName.rotten_flesh.id, stackSize: 64 });
});

test('S2e-fu §2: over a one-block lip: walls in her feet row only are a lip she throws over; a fence or a wall (1.5 up) blocks; a pit two deep has no direction', () => {
    const world = new F.World();
    pit(world, 1);
    const bot = F.makeBot({ world, position: [0.5, 64, 0.5] });
    assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: 1 }, 'one deep: over the lip');
    world.set(0, 64, 3, 'oak_fence');
    assert.deepEqual(I.chooseFacing(bot), { dx: -1, dz: 0 }, 'a fence 3 out blocks');
    world.set(-1, 64, 0, 'cobblestone_wall');
    assert.deepEqual(I.chooseFacing(bot), { dx: 0, dz: -1 }, 'a wall at her side blocks');
    const deep = new F.World();
    pit(deep, 2);
    assert.equal(I.chooseFacing(F.makeBot({ world: deep, position: [0.5, 64, 0.5] })), null, 'two deep: her eye row is walled');
    // S2e-fu r1 (adversary D2): a lip only where it starts at distance 1 (what P16 probed); a face
    // 2 or 3 out behind an open cell can bounce the toss back into reach.
    const step = new F.World();
    step.fill(-4, 63, -4, 4, 63, 4, 'stone');
    const flat = F.makeBot({ world: step, position: [0.5, 64, 0.5] });
    step.set(0, 64, 2, 'stone');
    assert.deepEqual(I.chooseFacing(flat), { dx: -1, dz: 0 }, 'a step 2 out blocks');
    step.set(-1, 64, 0, 'stone');
    step.set(-2, 64, 0, 'stone');
    step.set(-3, 64, 0, 'stone');
    assert.deepEqual(I.chooseFacing(flat), { dx: -1, dz: 0 }, 'a lip from distance 1 may go on at 2 and 3 (her own ground)');
    step.set(-2, 64, 0, 'air');
    step.set(-1, 64, 0, 'air');
    assert.deepEqual(I.chooseFacing(flat), { dx: 0, dz: -1 }, 'a step 3 out blocks');
    // Only her feet row may hold a lip: standing on a slab, a full block ahead in that row is
    // one, but a slab above it (a full block above her feet, in the next row) still blocks.
    const slabs = new F.World();
    slabs.fill(-4, 64, -4, 4, 64, 4, 'oak_slab', { type: 'bottom', waterlogged: 'false' });
    const onSlab = F.makeBot({ world: slabs, position: [0.5, 64.5, 0.5] });
    slabs.set(0, 64, 1, 'stone');
    assert.deepEqual(I.chooseFacing(onSlab), { dx: 0, dz: 1 }, 'a lip half a block up');
    slabs.set(0, 65, 1, 'oak_slab', { type: 'bottom', waterlogged: 'false' });
    assert.deepEqual(I.chooseFacing(onSlab), { dx: -1, dz: 0 }, 'the row above keeps the half-block rule');
});

test('S2e-fu §2: findDropSpot: the nearest standable spot with a free direction, horizontally, then vertically, then by the cardinal order; never toward a follow target; none within the radius', () => {
    const world = new F.World();
    pit(world, 2);
    for (let z = 2; z <= 5; z++) { world.set(0, 64, z, 'air'); world.set(0, 65, z, 'air'); }   // a corridor 2 out on her level
    const bot = F.makeBot({ world, position: [0.5, 64, 0.5] });
    assert.equal(I.chooseFacing(bot), null);
    assert.deepEqual(I.findDropSpot(bot).toArray(), [0, 66, 1], 'the rim 1 out, 2 up, south first; before the corridor 2 out');
    const never = { x: 0.5, y: 64, z: 10.5 };   // a follow target to her south
    assert.deepEqual(I.findDropSpot(bot, { never }).toArray(), [-1, 66, 0], 'not toward the target: the rim to her west');
    world.set(0, 66, 1, 'water', { level: '0' });   // the south rim's feet cell
    assert.deepEqual(I.findDropSpot(bot).toArray(), [-1, 66, 0], 'not in water');
    world.set(0, 66, 1, 'air');
    world.set(0, 67, 1, 'stone');   // the south rim's head cell
    assert.deepEqual(I.findDropSpot(bot).toArray(), [-1, 66, 0], 'her head must fit');
    world.set(0, 67, 1, 'air');
    world.set(-1, 65, 0, 'air');    // a step 1 up to her west
    assert.deepEqual(I.findDropSpot(bot).toArray(), [-1, 65, 0], 'vertically nearer than the south rim 2 up');
    // Up to 3 above her feet: the rim of a pit 3 deep, not of one 4 deep.
    for (const [depth, spot] of [[3, [0, 67, 1]], [4, null]]) {
        const w = new F.World();
        pit(w, depth);
        assert.deepEqual(I.findDropSpot(F.makeBot({ world: w, position: [0.5, 64, 0.5] }))?.toArray() ?? null, spot, `${depth} deep`);
    }
    // A shaft whose rim is 7 up: a tunnel 6 out is beyond the radius.
    const shaft = new F.World();
    pit(shaft, 6, 8);
    for (let x = 6; x <= 8; x++) { shaft.set(x, 64, 0, 'air'); shaft.set(x, 65, 0, 'air'); }
    const down = F.makeBot({ world: shaft, position: [0.5, 64, 0.5] });
    assert.equal(I.findDropSpot(down), null);
    INV.walkRadius = 6;
    assert.deepEqual(I.findDropSpot(down).toArray(), [6, 64, 0]);
    assert.equal(I.findDropSpot(F.makeBot({ position: [0.5, 64, 0.5] })), null, 'no floor anywhere');
});

test('S2e-fu §2: with `walk` and no free direction she walks to the drop spot (never digging; towers and scaffold in a task, none idle), then faces again from there; without it, unavailable', async () => {
    const world = new F.World();
    pit(world, 2);
    const walker = () => {
        const bot = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
        bot.seen = [];
        bot.hooks.goto = goal => {
            const m = bot.pathfinder.movements;
            bot.seen.push({ goal: [goal.x, goal.y, goal.z], canDig: m.canDig, towers: m.allow1by1towers, scaffold: m.scafoldingBlocks.length > 0, doors: m.canOpenDoors });
        };
        return bot;
    };
    const bot = walker();
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()), { walk: 'task' });
    assert.equal(result.outcome, 'done');
    assert.deepEqual(bot.seen, [{ goal: [0, 66, 1], canDig: false, towers: true, scaffold: true, doors: false }], 'a task walk may tower and scaffold, never open a door');
    // The idle walk places nothing (DECISIONS 2026-11-11: no pathfinder blocks left behind).
    const idle = walker();
    assert.equal((await I.dropItems(idle, I.planRemoval(idle, policyOf()), { walk: 'idle' })).outcome, 'done');
    assert.deepEqual(idle.seen, [{ goal: [0, 66, 1], canDig: false, towers: false, scaffold: false, doors: false }]);
    // S2e-fu r1 (adversary D3): a walk that ends off the spot drops nothing where she stopped.
    const off = walker();
    off.hooks.goto = () => { off.entity.position = new F.Vec3(0.5, 66, 2.5); return 'moved'; };   // on the rim, one cell past the spot
    const o = await I.dropItems(off, I.planRemoval(off, policyOf()), { walk: 'task' });
    assert.deepEqual([o.outcome, o.reason, tosses(off).length], ['unavailable', 'no free direction nearby', 0]);
    assert.ok(I.chooseFacing(off), 'though a direction is free where she stopped');
    const [, look] = bot.calls.find(c => c[0] === 'lookAt');
    assert.deepEqual([look.x, look.y, look.z], [0.5, 66 + 1.62, 4.5], 'from the rim, south');
    assert.deepEqual(bot.junk_guard.drops[0].pos, { x: 0.5, y: 66, z: 4.5 });
    const still = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    const stay = await I.dropItems(still, I.planRemoval(still, policyOf()));
    assert.deepEqual([stay.outcome, stay.reason], ['unavailable', 'no free direction nearby']);
    assert.equal(goals(still).length, 0);
    // A walk that fails (no path) is no error: still no direction, unavailable.
    const lost = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    lost.hooks.goto = () => { throw new Error('No path to the goal!'); };
    const r = await I.dropItems(lost, I.planRemoval(lost, policyOf()), { walk: 'task' });
    assert.deepEqual([r.outcome, r.reason, tosses(lost).length], ['unavailable', 'no free direction nearby', 0]);
    // The currency is checked after the walk.
    let ok = true;
    const cut = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    cut.hooks.goto = () => { ok = false; };
    const c = await I.dropItems(cut, I.planRemoval(cut, policyOf()), { walk: 'task', current: () => ok });
    assert.equal(c.outcome, 'interrupted');
    assert.equal(cut.calls.some(x => x[0] === 'lookAt'), false);
    // No spot within reach: no walk.
    const shaft = new F.World();
    pit(shaft, 6);
    const none = F.makeBot({ world: shaft, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    const n = await I.dropItems(none, I.planRemoval(none, policyOf()), { walk: 'task' });
    assert.deepEqual([n.outcome, n.reason, goals(none).length], ['unavailable', 'no free direction nearby', 0]);
});

test('REQ-TRV-6: the climb to drop is a task walk\'s only: with `climb` she climbs a deep shaft (digging, no doors) and drops from the rim; idle never climbs', async () => {
    const shaft = new F.World();
    pit(shaft, 6);
    const make = () => F.makeBot({ world: shaft, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    const task = make();
    const seen = [];
    task.hooks.goto = goal => { const m = task.pathfinder.movements; seen.push({ goal: [goal.x, goal.y, goal.z, goal.constructor.name], canDig: m.canDig, doors: m.canOpenDoors }); };
    const climbed = await I.dropItems(task, I.planRemoval(task, policyOf()), { walk: 'task', climb: true, replan: () => I.planRemoval(task, policyOf()) });
    assert.deepEqual([climbed.outcome, climbed.climbed, tosses(task).length], ['done', true, 1]);
    assert.deepEqual(seen, [{ goal: [0, 70, 0, 'GoalNear'], canDig: true, doors: false }], 'to the rim: may dig, opens no door');
    const [, look] = task.calls.find(c => c[0] === 'lookAt');
    assert.equal(look.y, 70 + 1.62);
    for (const opts of [{ walk: 'idle', climb: true }, { walk: false, climb: true }, { walk: 'task' }]) {
        const bot = make();
        const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()), opts);
        assert.deepEqual([result.outcome, result.reason, result.climbed, goals(bot).length], ['unavailable', 'no free direction nearby', undefined, 0], JSON.stringify(opts));
    }
    // An interrupted climb: interrupted, with `climbed`, nothing tossed.
    const cut = make();
    cut.hooks.goto = () => { cut.interrupt_code = true; };
    const c = await I.dropItems(cut, I.planRemoval(cut, policyOf()), { walk: 'task', climb: true });
    assert.deepEqual([c.outcome, c.climbed, tosses(cut).length], ['interrupted', true, 0]);
});

test('S2e-fu §2: the walk is bounded: at INVENTORY.walkMs the pathfinder is stopped and she faces again from where she stands', async () => {
    INV.walkMs = 150;
    const world = new F.World();
    pit(world, 2);
    const bot = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    let ended = null;
    bot.hooks.goto = async goal => {
        bot.pathfinder.goal = goal;
        const t = Date.now();
        await F.until(() => bot.pathfinder.goal === null, { timeout: 3000 });
        ended = Date.now() - t;
        return 'moved';   // stopped where she stands
    };
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()), { walk: 'idle' });
    assert.deepEqual([result.outcome, result.reason], ['unavailable', 'no free direction nearby']);
    assert.ok(ended >= 130 && ended < 600, `the walk ended after ${ended} ms`);
    assert.equal(tosses(bot).length, 0);
});

test('S2e-fu r1 (Sol 2): a walk that rejects while its route goes on leaves no goal behind', async () => {
    const world = new F.World();
    pit(world, 2);
    const bot = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    let walked = null;
    // The installed A* can reject goto with noPath while a partial route keeps the goal set.
    bot.hooks.goto = goal => { walked = goal; bot.pathfinder.goal = goal; throw new Error('No path to the goal!'); };
    const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()), { walk: 'task' });
    assert.equal(result.outcome, 'unavailable');
    assert.ok(walked);
    assert.equal(bot.pathfinder.goal, null, 'the walk\'s goal is cleared');
    // Another goal set meanwhile (not the walk's) is left alone.
    const other = F.makeBot({ world, position: [0.5, 64, 0.5], inventory: { rotten_flesh: 5 } });
    const theirs = { x: 9, y: 64, z: 9 };
    other.hooks.goto = () => { other.pathfinder.goal = theirs; throw new Error('No path to the goal!'); };
    await I.dropItems(other, I.planRemoval(other, policyOf()), { walk: 'task' });
    assert.equal(other.pathfinder.goal, theirs);
});

test('S2e-fu r1 (Sol 1): after a walk the dropper re-plans from the live bag: scaffold taken from a kept stack is not tossed again', async () => {
    const world = new F.World();
    pit(world, 2);
    const bot = F.makeBot({ world, position: [0.5, 64, 0.5] });
    bot.inventory.slots[9] = { name: 'dirt', count: 64, type: F.registry.itemsByName.dirt.id, stackSize: 64 };
    bot.inventory.slots[10] = { name: 'dirt', count: 20, type: F.registry.itemsByName.dirt.id, stackSize: 64 };
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(ops(plan), [[10, 'dirt', 20]]);
    bot.hooks.goto = () => { bot.inventory.slots[9].count -= 2; };   // the pathfinder scaffolds from the first stack
    const result = await I.dropItems(bot, plan, { walk: 'task', replan: () => I.planRemoval(bot, policyOf()) });
    assert.deepEqual(result.removed, { dirt: 18 });
    assert.equal(bot.count('dirt'), 64, 'she keeps her stack');
});

test('S2e-fu §2: the idle admission with no free direction: a drop spot admits and the pass walks there; none holds, saying why; following never walks', async () => {
    const agent = setup({ drive: false, ownerAt: [10.5, 64, 0.5] });
    const { bot } = agent;
    const items = agent.work.items;
    bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(bot.world, 2);
    const seen = [];
    bot.hooks.goto = () => { const m = bot.pathfinder.movements; seen.push([m.canDig, m.allow1by1towers, m.scafoldingBlocks.length]); };
    const admitted = items.admit();
    assert.equal(admitted?.follow, false);
    items.launch(admitted);
    await quiet(agent);
    assert.equal(goals(bot).length, 1, 'she walked');
    assert.deepEqual(seen, [[false, false, 0]], 'the idle walk: no digging, no towers, no scaffold');
    assert.equal(bot.count('rotten_flesh'), 0);
    assert.equal(bot.entity.position.y, 66);
    // An idle walk that cannot reach the spot (it may not tower out of the pit): held, saying why.
    const stuck = setup({ drive: false, ownerAt: [10.5, 64, 0.5] });
    stuck.bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(stuck.bot.world, 2);
    stuck.bot.hooks.goto = () => { throw new Error('No path to the goal!'); };
    stuck.work.items.launch(stuck.work.items.admit());
    await quiet(stuck);
    assert.equal(goals(stuck.bot).length, 1);
    assert.equal(tosses(stuck.bot).length, 0);
    assert.equal(stuck.work.items.held(), 'waiting: no free direction nearby');
    // No spot: held, and !itemList says why (F5).
    const deep = setup({ drive: false });
    deep.bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(deep.bot.world, 6);
    assert.equal(deep.work.items.admit(), null);
    assert.equal(deep.work.items.held(), 'waiting: no free direction nearby');
    assert.match(deep.work.items.render(), /Idle cleanup: waiting: no free direction nearby\./);
    // Following in the two-deep pit: no cut (no walk while following), held.
    const follow = setup({ drive: false, ownerAt: [10.5, 64, 0.5] });
    const fb = follow.bot;
    fb.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(fb.world, 2);
    void follow.actions.runAction('action:followPlayer', async () => {
        fb.pathfinder.setGoal(new F.modules.pf.goals.GoalFollow(fb.players[F.OWNER].entity, 3), true);
        while (!fb.interrupt_code) await F.sleep(10);
    }, { resume: true, timeout: -1 });
    await F.until(() => fb.pathfinder.goal?.entity);
    assert.equal(follow.work.items.admit(), null, 'no cut');
    assert.equal(follow.work.items.held(), 'waiting: no free direction nearby');
    follow.actions.cancelResume();
    fb.interrupt_code = true;
    await F.until(() => !follow.actions.executing);
    // A follow pass itself never walks.
    const cut = setup({ drive: false, ownerAt: [10.5, 64, 0.5] });
    cut.bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(cut.bot.world, 2);
    cut.work.items.launch({ follow: true, awayFrom: cut.bot.players[F.OWNER].entity.position, turns: new Set() });
    await quiet(cut);
    assert.equal(goals(cut.bot).length, 0);
    assert.equal(tosses(cut.bot).length, 0);
    assert.equal(cut.work.items.held(), 'waiting: no free direction nearby');
});

test('S2e-fu r1 (Sol 1): the idle pass re-plans after its walk too', async () => {
    const agent = setup({ drive: false, inventory: { dirt: 84 }, ownerAt: [10.5, 64, 0.5] });
    const { bot } = agent;
    bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(bot.world, 2);
    assert.deepEqual([bot.inventory.slots[9].count, bot.inventory.slots[10].count], [64, 20]);
    bot.hooks.goto = () => { bot.inventory.slots[9].count -= 2; };   // the wiring only: an idle walk places nothing
    agent.work.items.launch(agent.work.items.admit());
    await quiet(agent);
    assert.equal(goals(bot).length, 1);
    assert.equal(bot.count('dirt'), 64);
});

test('S2e-fu §3: largestItems: the five largest items, totalled by name (the kept note and the blocked report)', () => {
    const bot = slotted([[9, 'dirt', 64], [10, 'dirt', 64], [11, 'arrow', 32], [12, 'bone', 28], [13, 'gunpowder', 26], [14, 'coal', 25], [15, 'flint', 3], [16, 'dirt', 2]]);
    assert.equal(I.largestItems(bot), 'dirt 130, arrow 32, bone 28, gunpowder 26, coal 25');
});

test('S2e-fu §4: the best one stays: of five bows the least worn, of four crossbows too; an enchanted worn bow over a fresh plain one', () => {
    const tool = (slot, name, used, enchants = []) => [slot, name, 1, { maxDurability: F.registry.itemsByName[name].maxDurability, durabilityUsed: used, enchants }];
    // The P16 bag: bows 164..379 of 384 used, crossbows 330..461 of 465.
    const bot = slotted([tool(9, 'bow', 300), tool(10, 'bow', 164), tool(11, 'bow', 379), tool(12, 'bow', 200), tool(13, 'bow', 250),
        tool(14, 'crossbow', 461), tool(15, 'crossbow', 330), tool(16, 'crossbow', 400), tool(17, 'crossbow', 350)]);
    const plan = I.planRemoval(bot, policyOf());
    assert.deepEqual(plan.map(o => o.slot), [11, 9, 13, 12, 14, 16, 17], 'the most worn first; bow 10 and crossbow 15 stay');
    assert.equal(plan.freed, 7);
    const enchanted = slotted([tool(9, 'bow', 379, [{ name: 'power', lvl: 1 }]), tool(10, 'bow', 0), tool(11, 'bow', 0, [{ name: 'unbreaking', lvl: 1 }, { name: 'flame', lvl: 1 }])]);
    assert.deepEqual(I.planRemoval(enchanted, policyOf()).map(o => o.slot), [10, 9], 'two levels beat one, one beats none, whatever the wear');
    // An unreadable enchantment list (unprobed on this version) counts as none; the plan never throws.
    const odd = slotted([tool(9, 'bow', 10), tool(10, 'bow', 300)]);
    Object.defineProperty(odd.inventory.slots[9], 'enchants', { get() { throw new Error('bad component'); } });
    assert.deepEqual(I.planRemoval(odd, policyOf()).map(o => o.slot), [10]);
});

// --- the gear slice (gear design r5 §5, §6; DECISIONS 2026-11-12 (night), 2026-11-13) -----------

const G = F.modules.gear;
const GEAR = F.OWNER_GEAR;
// Real items (prismarine-item, as Mineflayer makes them) in exact slots.
function gearBag(entries) {
    const bot = F.makeBot();
    for (const [slot, item] of entries) bot.inventory.slots[slot] = item;
    bot.heldItem = bot.inventory.slots[36] ?? null;
    return bot;
}
const stacks = (name, ...counts) => counts.map(count => F.realItem(name, [], { count }));
// Her bag on 2026-11-13 (P17): his axe and the copy, her placeholder diamond
// pickaxe and axe, her diamond sword; his leather chestplate, leggings and boots worn.
const herBag = () => gearBag([[37, GEAR.axe()], [43, GEAR.copy()], [20, GEAR.herPickaxe()], [21, GEAR.herAxe()], [22, F.realItem('diamond_sword')],
    [6, GEAR.chest()], [7, GEAR.legs()], [8, GEAR.feet()], [9, F.realItem('oak_planks', [], { count: 64 })]]);
const best = (work = {}) => policyOf({ inventory: { gear: 'best', ...work } });

test('gear "best": her bag drops exactly the diamond pickaxe, diamond axe and diamond sword; "all" drops nothing', () => {
    const bot = herBag();
    const plan = I.planRemoval(bot, best());
    assert.deepEqual(ops(plan), [[20, 'diamond_pickaxe', 1], [21, 'diamond_axe', 1], [22, 'diamond_sword', 1]]);
    assert.equal(plan.freed, 3, 'each spare frees its slot');
    assert.ok(plan.every(o => o.sig === G.signature(bot.inventory.slots[o.slot])));
    assert.deepEqual(ops(I.planRemoval(bot, policyOf())), [], 'the public default keeps all gear');
    // After the tier-0 stacks, before the counted items.
    bot.inventory.slots[10] = F.realItem('rotten_flesh', [], { count: 3 });
    bot.inventory.slots[11] = F.realItem('dirt', [], { count: 64 });
    bot.inventory.slots[12] = F.realItem('dirt', [], { count: 5 });
    assert.deepEqual(ops(I.planRemoval(bot, best())).map(o => o[1]), ['rotten_flesh', 'diamond_pickaxe', 'diamond_axe', 'diamond_sword', 'dirt']);
    // Picked-up armour beside his worn pieces is a spare; a worn piece is never a source.
    const armour = gearBag([[6, GEAR.chest()], [9, F.realItem('netherite_chestplate')], [10, F.realItem('iron_boots')]]);
    assert.deepEqual(ops(I.planRemoval(armour, best())), [[9, 'netherite_chestplate', 1]], 'the iron boots are her best feet piece (none worn)');
});

test('gear "best" protects needed names, listed names (the list decides) and unreadable items', () => {
    assert.deepEqual(ops(I.planRemoval(herBag(), best(), { needed: new Set(['diamond_pickaxe']) })).map(o => o[1]), ['diamond_axe', 'diamond_sword']);
    assert.deepEqual(ops(I.planRemoval(herBag(), best({ items: { diamond_sword: 1 } }))).map(o => o[1]), ['diamond_pickaxe', 'diamond_axe']);
    assert.deepEqual(ops(I.planRemoval(herBag(), best({ items: { diamond_sword: 0 } }))).map(o => o[1]), ['diamond_sword', 'diamond_pickaxe', 'diamond_axe'],
        'listed 0: junk, first');
    const odd = herBag();
    odd.inventory.slots[21] = F.realItem('diamond_axe', [{ type: 'tool', data: { rules: [{ blocks: { name: 'minecraft:needs_magic' }, speed: 50 }],
        defaultMiningSpeed: 1, damagePerBlock: 1, canDestroyBlocksInCreative: true } }]);
    assert.deepEqual(ops(I.planRemoval(odd, best())).map(o => o[1]), ['diamond_pickaxe', 'diamond_sword'], 'an unreadable item is kept');
});

test('the cap "stack": every stackable at most one stack, "all" and unlisted included; a lower count, 0 and "slot" stay; non-stackables outside', () => {
    const cap = (work = {}) => policyOf({ inventory: { cap: 'stack', ...work } });
    const bot = F.makeBot();
    assert.equal(I.keepOf(bot, cap(), 'gunpowder'), 64, '"all" becomes one stack (DECISIONS 2026-11-12 night: "gunpowder is also capped")');
    assert.equal(I.keepOf(bot, cap(), 'oak_log'), 64, 'unlisted: one stack');
    assert.equal(I.keepOf(bot, cap(), 'ender_pearl'), 16, 'its own stack size');
    assert.equal(I.keepOf(bot, cap({ items: { bone: 100 } }), 'bone'), 64, 'a count above a stack is capped');
    assert.equal(I.keepOf(bot, cap({ items: { bone: 10 } }), 'bone'), 10);
    assert.equal(I.keepOf(bot, cap(), 'rotten_flesh'), 0);
    assert.equal(I.keepOf(bot, cap(), 'ominous_bottle'), 'slot');
    assert.equal(I.keepOf(bot, cap(), 'diamond_pickaxe'), undefined, 'a non-stackable stays outside');
    assert.equal(I.keepOf(bot, cap(), 'bow'), 1);
    assert.equal(I.keepOf(bot, cap(), 'white_bed'), undefined);
    assert.equal(I.keepOf(bot, policyOf(), 'gunpowder'), Infinity, 'cap "all": the list alone');
    assert.equal(I.keepOf(bot, policyOf(), 'oak_log'), undefined);
    const bag = gearBag([...stacks('gunpowder', 64, 30).map((s, i) => [9 + i, s]), ...stacks('oak_log', 64, 64, 10).map((s, i) => [11 + i, s]),
        [14, F.realItem('ender_pearl', [], { count: 16 })], [15, F.realItem('ender_pearl', [], { count: 5 })], [16, F.realItem('white_bed')], [17, F.realItem('white_bed')]]);
    assert.deepEqual(ops(I.planRemoval(bag, cap())), [[10, 'gunpowder', 30], [13, 'oak_log', 10], [11, 'oak_log', 64], [15, 'ender_pearl', 5]]);
    assert.deepEqual(ops(I.planRemoval(bag, policyOf())), [], 'the public default');
    assert.match(policyOf({ inventory: { cap: 'one' } }).error, /^cap: "one"$/);
});

test('config: gear, cap, surplus_slots and done_keep_min are checked; a bad value turns removal off; the public defaults', () => {
    const base = policyOf();
    assert.deepEqual([base.gear, base.cap, base.surplus_slots, base.done_keep_min], ['all', 'all', null, 30]);
    assert.deepEqual(C.WORK_DEFAULTS.inventory.gear, 'all');
    const set = policyOf({ inventory: { gear: 'best', cap: 'stack', surplus_slots: 2, done_keep_min: 0 } });
    assert.deepEqual([set.error, set.gear, set.cap, set.surplus_slots, set.done_keep_min], [null, 'best', 'stack', 2, 0]);
    assert.equal(policyOf({ inventory: { surplus_slots: null } }).error, null);
    for (const [key, value] of [['gear', 'some'], ['gear', true], ['cap', 'slot'], ['cap', 64], ['surplus_slots', -1], ['surplus_slots', 1.5], ['surplus_slots', '2'],
        ['done_keep_min', null], ['done_keep_min', -5], ['done_keep_min', 2.5]]) {
        const p = policyOf({ inventory: { [key]: value } });
        assert.equal(p.error, `${key}: ${JSON.stringify(value)}`, `${key} ${JSON.stringify(value)}`);
        assert.equal(I.removalEnabled(p), false);
    }
    assert.equal(policyOf({ inventory: { constructor: 'x' } }).error, null, 'an inherited name is an unknown sub-key, only logged');
});

test('fix wave 1, 4 (adversary G2): a listed gear name keeps by its gear rank, counted or "slot", never by enchantment count', () => {
    // A plain iron axe with 17 enchantment levels against his (15 levels, unbreakable).
    const plain = () => F.realItem('iron_axe', [{ type: 'enchantments', data: { enchantments: [
        { id: 33, level: 5 }, { id: 8, level: 5 }, { id: 18, level: 3 }, { id: 23, level: 1 }, { id: 40, level: 3 }] } }]);
    const bag = () => gearBag([[37, GEAR.axe()], [20, plain()]]);
    assert.deepEqual(ops(I.planRemoval(bag(), policyOf({ inventory: { items: { iron_axe: 1 } } }))), [[20, 'iron_axe', 1]], 'counted: his axe stays');
    assert.deepEqual(ops(I.planRemoval(bag(), policyOf({ inventory: { items: { iron_axe: 'slot' } } }))), [[20, 'iron_axe', 1]], '"slot": his axe stays');
    // A swapped bag (his axe in the higher slot) changes nothing.
    const swapped = gearBag([[20, GEAR.axe()], [37, plain()]]);
    assert.deepEqual(ops(I.planRemoval(swapped, policyOf({ inventory: { items: { iron_axe: 1 } } }))), [[37, 'iron_axe', 1]]);
    // Not gear: bows keep the S2e-fu worth (the least worn stays).
    const bows = gearBag([[9, F.realItem('bow', [{ type: 'damage', data: 300 }])], [10, F.realItem('bow', [{ type: 'damage', data: 10 }])]]);
    assert.deepEqual(ops(I.planRemoval(bows, policyOf())), [[9, 'bow', 1]]);
});

test('fix wave 1, 5 (adversary G3, Mq): the dropper holds the slots against armour equips and releases them, also after a failed toss', async () => {
    for (const fail of [false, true]) {
        const bot = gearBag([[9, F.realItem('rotten_flesh', [], { count: 5 })], [10, F.realItem('iron_helmet')]]);
        const equips = [];
        bot.equip = async (item, dest) => { equips.push([item.name, dest]); };
        let during = null;
        const transfer = bot.transfer;
        bot.transfer = async args => {
            during ??= G.equipAll(bot);
            if (fail) throw new Error('fixture: the click failed');
            return transfer(args);
        };
        const result = await I.dropItems(bot, I.planRemoval(bot, policyOf()));
        assert.equal(result.outcome, fail ? 'failed' : 'done');
        assert.equal(await during, false, 'no equip while the drop runs');
        assert.equal(await G.equipAll(bot), true, 'released afterwards');
        assert.deepEqual(equips, [['iron_helmet', 'head']]);
    }
});

test('the dropper skips a slot whose item changed its component signature (no toss of the wrong same-name item after a swap)', async () => {
    const bot = herBag();
    const plan = I.planRemoval(bot, best());
    bot.inventory.slots[20] = F.realItem('diamond_pickaxe');   // another diamond pickaxe now (an equip swap)
    const result = await I.dropItems(bot, plan);
    assert.deepEqual(result.removed, { diamond_axe: 1, diamond_sword: 1 });
    assert.equal(bot.inventory.slots[20].name, 'diamond_pickaxe');
    // Wear alone is no change.
    const worn = herBag();
    const again = I.planRemoval(worn, best());
    worn.inventory.slots[21] = F.realItem('diamond_axe', [...worn.inventory.slots[21].components, { type: 'damage', data: 9 }]);
    assert.deepEqual((await I.dropItems(worn, again)).removed, { diamond_pickaxe: 1, diamond_axe: 1, diamond_sword: 1 });
});

test('due: a plan that is not empty, with free slots below min_free_slots or more slots to free than surplus_slots', () => {
    const agent = setup({ inventory: {}, free: 10, drive: false, work: { inventory: { surplus_slots: 2 } } });
    const items = agent.work.items;
    const plan = freed => Object.assign(new Array(Math.max(1, freed)).fill({}), { freed });
    assert.equal(items.due(Object.assign([], { freed: 5 })), false, 'an empty plan never');
    assert.equal(items.due(plan(2)), false, 'at the allowance');
    assert.equal(items.due(plan(3)), true, 'one more');
    agent.work.config.inventory.surplus_slots = null;
    assert.equal(items.due(plan(30)), false, 'no allowance: only a low bag');
    agent.bot.give(FILLER, 64 * 7);
    assert.equal(agent.bot.inventory.emptySlotCount(), 3);
    assert.equal(items.due(plan(0)), true, 'below 4 free slots: any surplus');
    assert.equal(items.wanted(), true);
});

test('surplus_slots 2: two surplus slots wait above 4 free slots ("not due", no kept tell); the third sends all surplus', async () => {
    const agent = setup({ inventory: { rotten_flesh: 64, dirt: 64 + 30 }, free: 10, drive: false, work: { inventory: { surplus_slots: 2 } } });
    const { bot } = agent;
    const items = agent.work.items;
    assert.equal(items.wanted(), true, 'the cheap check with an allowance set');
    assert.equal(items.admit(), null, '2 slots of surplus: rotten flesh and the 30 dirt');
    assert.ok(items.emptyKey, 'remembered as not due under the inventory key');
    assert.equal(items.told.has('kept'), false, 'no kept tell above min_free_slots (adversary r3, D1)');
    bot.inventory.slots[30] = F.realItem('gravel', [], { count: 5 });
    const admitted = items.admit();
    assert.ok(admitted, 'a third slot');
    items.launch(admitted);
    await quiet(agent);
    assert.deepEqual(agent.work.items.last.removed, { rotten_flesh: 64, gravel: 5, dirt: 30 }, 'the whole plan');
    // Without an allowance and above min_free_slots: nothing is wanted.
    const plain = setup({ inventory: { rotten_flesh: 64 * 5 }, free: 10, drive: false });
    assert.equal(plain.work.items.wanted(), false);
});

test('a pass drops nothing unless still due at entry, and the re-plan after a walk is empty when no longer due', async () => {
    const agent = setup({ inventory: { rotten_flesh: 64 * 3 }, free: 10, drive: false, work: { inventory: { surplus_slots: 2 } } });
    const { bot } = agent;
    const items = agent.work.items;
    const admitted = items.admit();
    assert.ok(admitted);
    bot.take('rotten_flesh', 64);   // two slots left: within the allowance
    items.launch(admitted);
    await quiet(agent);
    assert.equal(tosses(bot).length, 0);
    // The walk out of a pit used one surplus stack: the re-plan is not due.
    const walker = setup({ inventory: { rotten_flesh: 64 * 3 }, free: 10, drive: false, ownerAt: [10.5, 64, 0.5], work: { inventory: { surplus_slots: 2 } } });
    walker.bot.entity.position = new F.Vec3(0.5, 64, 0.5);
    pit(walker.bot.world, 2);
    walker.bot.hooks.goto = () => { walker.bot.take('rotten_flesh', 64); };
    walker.work.items.launch(walker.work.items.admit());
    await quiet(walker);
    assert.equal(goals(walker.bot).length, 1, 'she walked');
    assert.equal(tosses(walker.bot).length, 0, 'and dropped nothing');
});

test('the kept tell only below min_free_slots', async () => {
    const low = setup({ inventory: {}, free: 2, drive: false });
    assert.equal(low.work.items.admit(), null);
    assert.equal(low.work.items.told.has('kept'), true);
    const roomy = setup({ inventory: {}, free: 10, drive: false, work: { inventory: { surplus_slots: 2 } } });
    assert.equal(roomy.work.items.admit(), null);
    assert.equal(roomy.work.items.told.has('kept'), false);
});

test('the Upkeep signature adds the held slot and each slot\'s component signature, without wear', () => {
    const agent = setup({ inventory: {}, free: 10, drive: false });
    const { bot } = agent;
    const items = agent.work.items;
    bot.inventory.slots[20] = F.realItem('diamond_axe');
    const first = items.signature();
    bot.inventory.slots[20] = F.realItem('diamond_axe', [{ type: 'damage', data: 40 }]);
    assert.equal(items.signature(), first, 'wear does not churn it');
    bot.inventory.slots[20] = GEAR.herAxe();
    assert.notEqual(items.signature(), first, 'another diamond axe');
    const second = items.signature();
    bot.quickBarSlot = 3;
    assert.notEqual(items.signature(), second, 'the held slot');
});

test('a finished task\'s goods stay protected for done_keep_min from done_at, stamped once in finishDone, or until the next task', () => {
    const c = F.clock();
    const bot = F.makeBot();
    const agent = F.makeAgent({ bot, name: `items${n++}` });
    F.clearRecord(agent);
    agents.push(agent);
    const work = F.startWork(agent, { now: c.now });
    const record = F.modules.record.newRecord({ objective: 'logs', request_text: 'logs', requested_by: F.OWNER, anchor: null, now: c.now(),
        steps: [{ skill: 'obtain', args: { item: 'oak_log', count: 128 } }, { skill: 'obtain', args: { item: 'stick', count: 4 } }, { skill: 'go_to', args: { target: 'owner' } }] });
    record.cursor = record.plan.length;
    work.adopt(record);
    work.finishDone();
    assert.equal(record.done_at, c.now());
    assert.deepEqual([...work.neededItems()].sort(), ['oak_log', 'stick']);
    const stamped = record.done_at;
    c.advance(29 * 60);
    work.write();
    assert.equal(F.readRecord(agent).done_at, stamped, 'later saves move updated_at, never done_at');
    assert.notEqual(F.readRecord(agent).updated_at, stamped);
    assert.deepEqual([...work.neededItems()].sort(), ['oak_log', 'stick'], 'within 30 minutes');
    c.advance(61);
    assert.deepEqual([...work.neededItems()], [], 'past 30 minutes');
    c.t = stamped + 60000;
    work.config.inventory.done_keep_min = 0;
    assert.deepEqual([...work.neededItems()], [], 'done_keep_min 0: none');
    work.config.inventory.done_keep_min = 30;
    delete record.done_at;
    assert.deepEqual([...work.neededItems()], [], 'a done record saved before the build protects nothing');
    // Over the cap: the logs stay while protected.
    record.done_at = c.now();
    for (const [slot, s] of stacks('oak_log', 64, 64).entries()) bot.inventory.slots[9 + slot] = s;
    const cap = policyOf({ inventory: { cap: 'stack' } });
    assert.deepEqual(ops(I.planRemoval(bot, cap, { needed: work.neededItems() })), []);
    assert.equal(I.planRemoval(bot, cap).length, 1);
});

test('!itemList with the gear rules: the rules, per kind the best and why, the spares that go, the effective counts and the surplus count', async () => {
    const agent = setup({ inventory: { rotten_flesh: 5 }, free: null, drive: false, work: { inventory: { gear: 'best', cap: 'stack', surplus_slots: 2 } } });
    const { bot } = agent;
    for (const [slot, item] of [[37, GEAR.axe()], [43, GEAR.copy()], [20, GEAR.herPickaxe()], [21, GEAR.herAxe()], [22, F.realItem('diamond_sword')], [6, GEAR.chest()]])
        bot.inventory.slots[slot] = item;
    const text = await F.modules.commands.executeCommand(agent, '!itemList');
    assert.match(text, /^Item list \(one stack at most of anything that stacks, listed or not; anything else not listed I keep; of gear only the best of each kind\): Best gear: /);
    assert.match(text, /pickaxe iron_pickaxe: reaches 403 blocks, unbreakable, speed 35; axe iron_axe: unbreakable, speed 32; /);
    assert.match(text, /weapon iron_axe: unbreakable, score 23\.6; chest leather_chestplate \(worn\): unbreakable, armour 8, toughness 2\./);
    assert.match(text, / Spares that go: diamond_pickaxe, diamond_axe, diamond_sword\. Drop all: rotten_flesh 5, /);
    assert.match(text, /Keep 64: dirt, cobblestone, bone, string, phantom_membrane, arrow, flint, coal, gunpowder\./, 'the effective counts: gunpowder capped');
    assert.match(text, /\d+ free slots; I clean up below 4, or when more than 2 slots hold spares, extra stacks or junk \(now 4\)\. Idle cleanup: /, 'the junk slot and the three spares');
    assert.match(F.modules.commands.getCommand('!itemList').description, /the one-stack cap and the gear rule/);
});
