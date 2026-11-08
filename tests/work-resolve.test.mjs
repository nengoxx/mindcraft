import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: the obtain resolver (SPEC §9.1, REQ-OBT-1..5) and the inventory rules
// (§9.4, REQ-OBT-11): junk drop and the pickupNearbyItems re-pickup guard.
const { resolve, skills, work: W } = F.modules;
const agents = [];
const stops = [];
after(() => { stops.forEach(stop => stop()); F.cleanup(agents); });
beforeEach(() => F.useSettings());

function landscape({ table = false } = {}) {
    const world = new F.World();
    F.tree(world, 4, 64, 0, 5);
    F.tree(world, 7, 64, 2, 5);
    world.fill(-6, 60, -6, -2, 63, -2, 'stone');
    if (table) world.set(1, 64, 1, 'crafting_table');
    return world;
}
const show = nodes => nodes.map(n => `${n.method} ${n.have} ${n.n}${n.method === 'craft' ? ` x${n.runs}${n.table ? ' table' : ''}` : ` from ${n.via}${n.tier_req ? ` with ${n.tier_req}` : ''}`}`);

test('from an empty inventory: planks from logs, sticks, a wooden pickaxe and a stone pickaxe, via bot.recipesAll and requiresTable', () => {
    const bot = F.makeBot({ world: landscape() });
    let recipesAll = 0;
    const all = bot.recipesAll;
    bot.recipesAll = (...args) => { recipesAll++; assert.equal(args[2], true); return all(...args); };
    assert.deepEqual(show(resolve.resolveObtain(bot, 'oak_planks', 8).nodes), ['collect oak_log 2 from oak_log', 'craft oak_planks 8 x2']);
    assert.deepEqual(show(resolve.resolveObtain(bot, 'stick', 4).nodes), ['collect oak_log 1 from oak_log', 'craft oak_planks 2 x1', 'craft stick 4 x1']);
    assert.deepEqual(show(resolve.resolveObtain(bot, 'wooden_pickaxe', 1).nodes), [
        'collect oak_log 3 from oak_log', 'craft oak_planks 8 x3', 'craft crafting_table 1 x1', 'craft stick 2 x1', 'craft wooden_pickaxe 1 x1 table']);
    const stone = resolve.resolveObtain(bot, 'stone_pickaxe', 1);
    assert.equal(stone.error, null);
    assert.deepEqual(show(stone.nodes), [
        'collect oak_log 3 from oak_log', 'craft oak_planks 8 x3', 'craft crafting_table 1 x1', 'craft stick 2 x1',
        'craft wooden_pickaxe 1 x1 table', 'collect cobblestone 3 from stone with wooden_pickaxe', 'craft stone_pickaxe 1 x1 table']);
    assert.ok(recipesAll > 0);
    // A crafting table in reach (craftRecipe's 16 blocks) needs no new one.
    const near = F.makeBot({ world: landscape({ table: true }) });
    assert.equal(resolve.resolveObtain(near, 'wooden_pickaxe', 1).nodes.some(n => n.have === 'crafting_table'), false);
});

test('the first recipe the inventory allows wins; otherwise the wood in view', () => {
    const bot = F.makeBot({ world: landscape(), inventory: { birch_planks: 3, stick: 2 } });
    const plan = resolve.resolveObtain(bot, 'wooden_pickaxe', 1);
    assert.deepEqual(show(plan.nodes).slice(-1), ['craft wooden_pickaxe 1 x1 table']);
    assert.match(plan.nodes.at(-1).via, /birch_planks\*3/);
    const spruce = F.makeBot({ world: landscape(), inventory: { spruce_log: 1 } });
    assert.match(resolve.resolveObtain(spruce, 'stick', 4).nodes.at(-1).via, /spruce_planks/);
    // Nothing in the inventory: the recipe whose wood is in view (oak), not the first listed (cherry).
    const empty = F.makeBot({ world: landscape() });
    assert.match(resolve.resolveObtain(empty, 'stick', 4).nodes.at(-1).via, /oak_planks/);
});

test("leftovers follow mcdata's batch arithmetic (runs = ceil(need / yield), the excess carried)", () => {
    const bot = F.makeBot({ world: landscape() });
    assert.deepEqual(show(resolve.resolveObtain(bot, 'stick', 5).nodes), ['collect oak_log 1 from oak_log', 'craft oak_planks 4 x1', 'craft stick 5 x2']);
    assert.deepEqual(show(resolve.resolveObtain(bot, 'oak_planks', 5).nodes), ['collect oak_log 2 from oak_log', 'craft oak_planks 5 x2']);
    assert.deepEqual(show(resolve.resolveObtain(bot, 'oak_planks', 5, { inventory: { oak_planks: 1 } }).nodes), ['collect oak_log 1 from oak_log', 'craft oak_planks 4 x1']);
});

test('the graph recomputed after partial progress gives the right shortfall', () => {
    const bot = F.makeBot({ world: landscape() });
    const logs = inventory => resolve.resolveObtain(bot, 'wooden_pickaxe', 1, { inventory }).nodes.find(n => n.have === 'oak_log')?.n ?? 0;
    assert.equal(logs({}), 3);
    assert.equal(logs({ oak_log: 1 }), 2);
    assert.equal(logs({ oak_planks: 5 }), 1);
    assert.equal(logs({ oak_planks: 4, crafting_table: 1 }), 1);
    assert.equal(logs({ oak_planks: 5, crafting_table: 1 }), 0);
    assert.deepEqual(show(resolve.resolveObtain(bot, 'wooden_pickaxe', 1, { inventory: { wooden_pickaxe: 1 } }).nodes), []);
});

test('an item with no method gives "no method for X in this version"', () => {
    const bot = F.makeBot({ world: landscape() });
    assert.equal(resolve.resolveObtain(bot, 'iron_ingot', 1).error, 'no method for iron_ingot in this version');
    assert.equal(resolve.resolveObtain(bot, 'stone', 1).error, 'no method for stone in this version'); // smelting is I5
    assert.match(resolve.resolveObtain(bot, 'diamond', 1).error, /^no method for diamond in this version \(no method for /);
    assert.equal(resolve.resolveObtain(bot, 'wooden_pickaxe', 1, { static: true }).error, null);
});

test('"make me a stone pickaxe" from an empty inventory completes through the runner', async () => {
    const world = landscape({ table: true });
    const bot = F.makeBot({ world });
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'pickaxe' });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('a stone pickaxe', 'obtain item=stone_pickaxe count=1');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'done');
    assert.equal(bot.count('stone_pickaxe'), 1);
    assert.equal(world.block({ x: 1, y: 64, z: 1 }).name, 'crafting_table'); // the owner's table was used, not taken
    assert.equal(agent.modelCalls, 0);
});

// --- junk drop -------------------------------------------------------------

const config = { min_free_slots: 4, junk_items: ['dirt', 'cobblestone', 'gravel', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'netherrack', 'wheat_seeds', 'rotten_flesh'], junk_keep: { dirt: 64, cobblestone: 64 } };

test('planJunkDrop tosses only junk-list items beyond junk_keep, never what the task needs', () => {
    const bot = F.makeBot({ inventory: { dirt: 200, cobblestone: 100, gravel: 30, andesite: 64, diamond: 3, oak_sapling: 20, rotten_flesh: 5 } });
    assert.deepEqual(resolve.planJunkDrop(bot, config, new Set()), [
        { name: 'dirt', count: 136 }, { name: 'cobblestone', count: 36 }, { name: 'gravel', count: 30 }, { name: 'andesite', count: 64 }, { name: 'rotten_flesh', count: 5 }]);
    assert.deepEqual(resolve.planJunkDrop(bot, config, new Set(['cobblestone', 'gravel'])).map(d => d.name), ['dirt', 'andesite', 'rotten_flesh']);
});

function fullBot(extra = {}) {
    // 33 stacks: 3 free slots, one short of work.min_free_slots.
    const inventory = { dirt: 64 * 10, cobblestone: 64 * 8, gravel: 64 * 3, andesite: 64 * 2, diamond: 5, oak_sapling: 16, iron_ingot: 9, ...extra };
    const bot = F.makeBot({ world: landscape(), inventory });
    for (let i = 0; bot.inventory.emptySlotCount() > 3; i++) bot.give(['torch', 'bread', 'apple', 'arrow', 'bone', 'string', 'feather', 'flint', 'clay_ball', 'leather', 'paper', 'book'][i], 1);
    return bot;
}

test('junk drop: below min_free_slots, toss junk where it stands facing away from the work, then go back to the work', async () => {
    const bot = F.makeBot({ world: landscape() });
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'junker', work: { stall_s: 0.05 } });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    stops.push(F.drive(agent));
    let first = true;
    bot.hooks.collect = async () => {
        if (!first) return;
        first = false;
        // Fled from a fight: away from the work, and the inventory filled up.
        bot.entity.position = new F.Vec3(20.5, 64, 0.5);
        const full = fullBot();
        bot.inventory.slots.splice(0, 46, ...full.inventory.slots);
        agent.requestInterrupt();
    };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'done');
    const tosses = bot.calls.filter(c => c[0] === 'toss');
    assert.ok(tosses.length > 0);
    assert.ok(tosses.every(([, name]) => config.junk_items.includes(name)), JSON.stringify(tosses)); // nothing off the list
    assert.equal(bot.count('dirt'), 64);
    assert.equal(bot.count('cobblestone'), 64);
    for (const [name, count] of [['diamond', 5], ['oak_sapling', 16], ['iron_ingot', 9]]) assert.equal(bot.count(name), count);
    const firstToss = bot.calls.findIndex(c => c[0] === 'toss');
    const look = bot.calls.slice(0, firstToss).reverse().find(c => c[0] === 'lookAt')[1];
    const workPos = agent.work.record.plan[0].work_pos;
    assert.ok(look.x > 20.5, `faces away from the work at x=${workPos.x}`);
    const returnTrip = bot.calls.findIndex((c, i) => i > firstToss && c[0] === 'goto');
    assert.ok(returnTrip > firstToss, 'drops before moving to the work');
    assert.equal(bot.junk_guard.drops.length, 1);
    assert.deepEqual(bot.junk_guard.drops[0].pos, { x: 20.5, y: 64, z: 0.5 });
});

function dropped(bot, name, offset) {
    const id = Math.floor(Math.random() * 1e9);
    bot.entities[id] = { id, name: 'item', type: 'object', position: bot.entity.position.offset(...offset), getDroppedItem: () => ({ name, count: 1 }) };
    return bot.entities[id];
}

test('pickupNearbyItems skips junk near a drop point, still picks up other items there, and junk again after 5 minutes', async () => {
    const bot = F.makeBot();
    const agent = F.makeAgent({ bot, name: 'picker' });
    bot.hooks.goto = goal => { if (goal.entity) delete bot.entities[goal.entity.id]; }; // contact pickup
    resolve.recordJunkDrop(bot, config, bot.entity.position.clone());
    const junk = dropped(bot, 'cobblestone', [2, 0, 0]);
    const far = dropped(bot, 'cobblestone', [6, 0, 0]);  // a junk type, but beyond 3 blocks of the drop point
    const gem = dropped(bot, 'diamond', [1, 0, 1]);
    await skills.pickupNearbyItems(bot);
    assert.ok(bot.entities[junk.id], 'junk next to the drop point stays');
    assert.equal(bot.entities[gem.id], undefined);
    assert.equal(bot.entities[far.id], undefined);
    bot.junk_guard.drops[0].at -= 5 * 60 * 1000;
    await skills.pickupNearbyItems(bot);
    assert.equal(bot.entities[junk.id], undefined);
    assert.ok(agent);
});

test('the item_collecting mode, which calls pickupNearbyItems, skips the junk too', async () => {
    const bot = F.makeBot();
    const agent = F.makeAgent({ bot, name: 'collector', modes: { item_collecting: true } });
    bot.hooks.goto = goal => { if (goal.entity) delete bot.entities[goal.entity.id]; };
    resolve.recordJunkDrop(bot, config, bot.entity.position.clone());
    const junk = dropped(bot, 'dirt', [1, 0, 0]);
    const gem = dropped(bot, 'diamond', [2, 0, 0]);
    const stop = F.drive(agent, 50);
    try {
        await F.until(() => !bot.entities[gem.id], { timeout: 6000 });
        await F.until(() => agent.isIdle());
    } finally {
        stop();
    }
    assert.ok(bot.entities[junk.id]);
});

test('a refill re-runs the drop at most twice; then the step blocks with the five largest stacks', async () => {
    const bot = fullBot();
    for (let i = 0; i < 7; i++) F.tree(bot.world, 10 + i * 3, 64, 5, 5);
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'refill', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    // Junk keeps coming back during each collect call: 2 free slots left.
    bot.hooks.collect = async () => { while (bot.inventory.emptySlotCount() > 2) bot.give('gravel', 64); };
    agent.work.startTask('30 oak logs', 'obtain item=oak_log count=30');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'blocked');
    assert.equal(agent.work.record.plan[0].progress.junk_drops, 3); // the first drop and two re-runs
    assert.match(agent.work.record.reason, /^inventory full: \d free slots, 4 needed; largest stacks: (\w+ \d+, ){4}\w+ \d+$/);
});

test('when the minimum cannot be reached the step blocks; nothing off the list is discarded', async () => {
    const inventory = {};
    const names = ['diamond', 'iron_ingot', 'oak_sapling', 'bread', 'apple', 'torch', 'bone', 'string', 'feather', 'flint', 'leather', 'paper', 'book', 'arrow', 'stick', 'oak_planks', 'birch_planks', 'spruce_planks', 'coal', 'charcoal', 'egg', 'wheat', 'sugar', 'gold_ingot', 'copper_ingot', 'emerald', 'lapis_lazuli', 'redstone', 'glass', 'sand', 'clay_ball', 'brick', 'bowl'];
    for (const name of names) inventory[name] = name === 'diamond' ? 64 : 3;
    const bot = F.makeBot({ world: landscape(), inventory });
    F.player(bot);
    assert.equal(bot.inventory.emptySlotCount(), 3);
    const agent = F.makeAgent({ bot, name: 'nojunk', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status !== 'active');
    assert.equal(agent.work.record.status, 'blocked');
    assert.match(agent.work.record.reason, /largest stacks: diamond 64, /);
    assert.equal(bot.calls.some(c => c[0] === 'toss'), false);
    assert.equal(W.TASK_ACTIVE.length > 0, true);
});

// --- fix wave 1 ------------------------------------------------------------

test('with no log of any kind in view the wood falls back to oak, not the first recipe (cherry) (F18)', async () => {
    const bot = F.makeBot();
    assert.match(resolve.resolveObtain(bot, 'stick', 4).nodes.at(-1).via, /^oak_planks\*/);
    assert.equal(resolve.resolveObtain(bot, 'crafting_table', 1).nodes[0].via, 'oak_log');
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'nowood', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('sticks', 'obtain item=stick count=4');
    await F.until(() => agent.work.record.status === 'blocked');
    assert.match(agent.work.record.reason, /no oak_log within 64 blocks/);
});

test('junk drop: the drop point and the attempt are recorded before the first toss; an interruption stops between stacks (F14)', async () => {
    const bot = fullBot();
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'junkstop', idleDelay: 5000 });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    let tosses = 0;
    bot.hooks.toss = () => { if (++tosses === 1) agent.requestInterrupt(); };
    agent.work.startTask('9 oak logs', 'obtain item=oak_log count=9');
    await F.until(() => tosses >= 1 && !agent.work.runner.executing);
    assert.equal(tosses, 1);
    assert.equal(bot.junk_guard.drops.length, 1);
    assert.equal(F.readRecord(agent).plan[0].progress.junk_drops, 1);
});

test('junk drop tosses one observed inventory stack per call: an interruption stops it between any two stacks (G5)', async () => {
    const bot = fullBot();
    // The same full inventory, but dirt in 32-item stacks is the only junk:
    // 64 to keep, the rest to drop, so one stack-size quantity spans two stacks.
    for (const s of bot.inventory.slots) {
        if (s?.name === 'dirt') s.count = 32;
        else if (s && config.junk_items.includes(s.name)) Object.assign(s, { name: 'stone', type: F.registry.itemsByName.stone.id });
    }
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'stacks', idleDelay: 5000 });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    let tosses = 0;
    bot.hooks.toss = () => { if (++tosses === 1) agent.requestInterrupt(); };
    agent.work.startTask('9 oak logs', 'obtain item=oak_log count=9');
    await F.until(() => tosses >= 1 && !agent.work.runner.executing);
    assert.equal(tosses, 1);
});
