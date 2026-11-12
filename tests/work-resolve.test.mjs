import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: the obtain resolver (SPEC §9.1, REQ-OBT-1..5) and the inventory rules
// (§9.4, REQ-OBT-11): junk drop and the pickupNearbyItems re-pickup guard.
const { resolve, skills, work: W, inventory: I } = F.modules;
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

// S2e: the item list (work.inventory) replaces junk_items and junk_keep; the
// planner, dropper and guard are work/inventory.js (work-inventory.test.mjs).
const policy = F.modules.config.loadWorkConfig().inventory;
const disposable = name => Number.isFinite(I.keepOf(F.makeBot(), policy, name));

// One drop through the shared dropper: `name` given and dropped where she stands.
async function dropHere(bot, name, count = 1) {
    bot.give(name, count);
    const slot = bot.inventory.slots.findIndex(s => s?.name === name);
    const result = await I.dropItems(bot, [{ slot, name, count, have: count, whole: true }]);
    assert.equal(result.outcome, 'done');
    return Object.values(bot.entities).find(e => e.name === 'item' && e.getDroppedItem().name === name);
}

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
    assert.ok(tosses.every(([, name]) => disposable(name)), JSON.stringify(tosses)); // nothing off the list
    assert.equal(bot.count('dirt'), 64);
    assert.equal(bot.count('cobblestone'), 64);
    assert.equal(bot.count('gravel'), 0);
    for (const [name, count] of [['diamond', 5], ['oak_sapling', 16], ['iron_ingot', 9]]) assert.equal(bot.count(name), count);
    const firstToss = bot.calls.findIndex(c => c[0] === 'toss');
    const [, look, force] = bot.calls.slice(0, firstToss).reverse().find(c => c[0] === 'lookAt');
    const workPos = agent.work.record.plan[0].work_pos;
    // A level look along a cardinal away from the work, 3 blocks out at eye height (S2e).
    assert.deepEqual([look.x, look.y, look.z, force], [23.5, 64 + 1.62, 0.5, true], `faces away from the work at x=${workPos.x}`);
    const returnTrip = bot.calls.findIndex((c, i) => i > firstToss && c[0] === 'goto');
    assert.ok(returnTrip > firstToss, 'drops before moving to the work');
    assert.equal(bot.junk_guard.drops.length, 1);
    assert.deepEqual(bot.junk_guard.drops[0].pos, { x: 23.5, y: 64, z: 0.5 });   // the landing spot
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
    const junk = await dropHere(bot, 'cobblestone');           // lands 3 blocks out, at the drop point
    const far = dropped(bot, 'cobblestone', [0, 0, 7]);        // a dropped name, but 4 blocks past the drop point
    const other = dropped(bot, 'gravel', [0, 0, 3]);           // at the drop point, but not a name dropped there
    const gem = dropped(bot, 'diamond', [1, 0, 3]);
    await skills.pickupNearbyItems(bot);
    assert.ok(bot.entities[junk.id], 'junk next to the drop point stays');
    assert.equal(bot.entities[gem.id], undefined);
    assert.equal(bot.entities[far.id], undefined);
    assert.equal(bot.entities[other.id], undefined, 'the guard is per name dropped, not a global junk type');
    bot.junk_guard.drops[0].at -= 5 * 60 * 1000;
    await skills.pickupNearbyItems(bot);
    assert.equal(bot.entities[junk.id], undefined);
    assert.ok(agent);
});

test('the item_collecting mode, which calls pickupNearbyItems, skips the junk too', async () => {
    const bot = F.makeBot();
    const agent = F.makeAgent({ bot, name: 'collector', modes: { item_collecting: true } });
    bot.hooks.goto = goal => { if (goal.entity) delete bot.entities[goal.entity.id]; };
    const junk = await dropHere(bot, 'dirt');
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

// S2e-fu §3 (DECISIONS 2026-11-12, trials F3; S2e-fu r1, adversary D1): the
// blocked report tells the model this; the reason itself does not.
const KEPT_ASK = 'Tell the owner your bag is full of things you keep or need for this task; do not discard kept items unless he names them.';
const NO_DISCARD = 'Do not discard kept items unless the owner names them.';
const blockedTurn = agent => agent.turns.find(t => /is blocked/.test(t.content))?.content ?? '';

test('a refill re-runs the drop at most twice; then the step blocks with the five largest items', async () => {
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
    assert.match(agent.work.record.reason, /^inventory full: \d free slots, 4 needed; largest: (\w+ \d+, ){4}\w+ \d+$/);
});

test('when nothing on the list may go the step blocks naming what she keeps, and the report asks for the owner; nothing off the list is discarded (S2e-fu §3)', async () => {
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
    // S2e-fu r1 (adversary D10): the totals may hold the task's needed items too.
    const reason = 'inventory full of things I keep: 3 free slots, 4 needed; kept or needed by this task: diamond 64, iron_ingot 3, oak_sapling 3, bread 3, apple 3';
    assert.equal(agent.work.record.reason, reason, 'the reason carries only the facts');
    assert.equal(agent.work.record.plan[0].result, reason.slice(0, 160));
    await F.until(() => blockedTurn(agent));
    assert.ok(blockedTurn(agent).includes(`${reason}. ${KEPT_ASK} `), 'the blocked report, for the model, says to tell the owner');
    // The owner's line for a step blocked again keeps the facts only.
    assert.equal(F.modules.report.blockedAgainLine(1, reason), `Step 1 blocked again: ${reason}.`);
    // Any other block's report does not ask.
    const other = { objective: 'logs', plan: agent.work.record.plan, reason: 'no oak_log within 64 blocks', goal: null };
    assert.equal(F.modules.report.blockedReport(other, null, bot).includes('Ask the owner'), false);
    assert.equal(bot.calls.some(c => c[0] === 'toss'), false);
    assert.equal(W.TASK_ACTIVE.length > 0, true);
});

// A pit `depth` deep at her cell (0, 64, 0), stone from y 63 to 63 + depth within 3; two trees further out.
function pitWorld(depth) {
    const world = new F.World();
    world.fill(-3, 63, -3, 3, 63 + depth, 3, 'stone');
    for (let y = 64; y <= 63 + depth; y++) world.set(0, y, 0, 'air');
    F.tree(world, 10, 64, 0, 5);
    F.tree(world, 13, 64, 2, 5);
    return world;
}

test('S2e-fu §2: in a task in a pit two deep she walks to the nearest drop spot (never digging), drops there, and the step goes on', async () => {
    const bot = F.makeBot({ world: pitWorld(2), position: [0.5, 64, 0.5] });
    bot.inventory.slots.splice(0, 46, ...fullBot().inventory.slots);
    F.player(bot, F.OWNER, [20, 64, 0]);
    const agent = F.makeAgent({ bot, name: 'pitwalk', work: { stall_s: 0.05 } });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    stops.push(F.drive(agent));
    const walks = [];
    bot.hooks.goto = goal => {
        const m = bot.pathfinder.movements;
        walks.push({ at: bot.calls.length, goal: [goal.x, goal.y, goal.z], canDig: m.canDig, towers: m.allow1by1towers, scaffold: m.scafoldingBlocks.length > 0 });
    };
    agent.work.startTask('2 oak logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'done', agent.work.record.reason);
    const firstToss = bot.calls.findIndex(c => c[0] === 'toss');
    assert.ok(firstToss >= 0);
    assert.deepEqual(walks[0], { at: walks[0].at, goal: [0, 66, 1], canDig: false, towers: true, scaffold: true }, 'a task walk: no digging, towers and scaffold (task-end tidy)');
    assert.ok(walks[0].at < firstToss, 'the walk before the drop');
    assert.equal(bot.count('gravel'), 0);
});

test('S2e-fu §2, §3: in a task with no drop spot within reach the step blocks with the drop\'s reason', async () => {
    const bot = F.makeBot({ world: pitWorld(6), position: [0.5, 64, 0.5] });
    bot.inventory.slots.splice(0, 46, ...fullBot().inventory.slots);
    F.player(bot, F.OWNER, [20, 64, 0]);
    const agent = F.makeAgent({ bot, name: 'pitstuck', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('2 oak logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'blocked');
    const reason = 'inventory full: 3 free slots, 4 needed (no free direction nearby); largest: dirt 640, cobblestone 512, gravel 192, andesite 128, oak_sapling 16';
    assert.equal(agent.work.record.reason, reason);
    await F.until(() => blockedTurn(agent));
    assert.ok(blockedTurn(agent).includes(`${reason}. ${NO_DISCARD} `), 'junk left, only the place failed: no "tell the owner"');
    assert.equal(bot.calls.some(c => c[0] === 'toss' || c[0] === 'goto'), false);
});

test('S2e-fu r1 (Sol 3): a bad item list blocks with the list error under the ordinary prefix, never as "things I keep"', async () => {
    const bot = fullBot();
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'badlist', replies: [''], work: { inventory: { items: { rotten_flesh: 'none' } } } });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status !== 'active');
    const reason = 'inventory full: 3 free slots, 4 needed; my item list has an error (rotten_flesh: "none"); largest: dirt 640, cobblestone 512, gravel 192, andesite 128, oak_sapling 16';
    assert.equal(agent.work.record.reason, reason);
    await F.until(() => blockedTurn(agent));
    assert.ok(blockedTurn(agent).includes(`${reason}. ${NO_DISCARD} `));
    assert.equal(bot.calls.some(c => c[0] === 'toss'), false);
});

test('S2e-fu r1 (Sol 1): in a task the drop re-plans after its walk: scaffold taken from the kept stack is not tossed again', async () => {
    const bot = F.makeBot({ world: pitWorld(2), position: [0.5, 64, 0.5] });
    const dirt = F.registry.itemsByName.dirt;
    bot.inventory.slots[9] = { name: 'dirt', count: 64, type: dirt.id, stackSize: 64 };
    bot.inventory.slots[10] = { name: 'dirt', count: 20, type: dirt.id, stackSize: 64 };
    while (bot.inventory.emptySlotCount() > 3) bot.give('oak_planks', 64);
    F.player(bot, F.OWNER, [20, 64, 0]);
    const agent = F.makeAgent({ bot, name: 'pitreplan', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    bot.hooks.goto = () => { bot.inventory.slots[9].count -= 2; };   // the pathfinder towers with the first dirt stack
    agent.work.startTask('2 oak logs', 'obtain item=oak_log count=2');
    await F.until(() => bot.calls.some(c => c[0] === 'toss') && agent.work.record.status !== 'active', { timeout: 8000 });
    assert.deepEqual(bot.calls.filter(c => c[0] === 'toss').map(c => [c[1], c[2]]), [['dirt', 18]]);
    assert.equal(bot.count('dirt'), 64);
});

test('a step whose target is already met finishes on a nearly full bag; it does not block on slots (S2e trials F1)', async () => {
    const inventory = {};
    const names = ['diamond', 'iron_ingot', 'oak_sapling', 'bread', 'apple', 'torch', 'bone', 'string', 'feather', 'flint', 'leather', 'paper', 'book', 'arrow', 'stick', 'oak_planks', 'birch_planks', 'spruce_planks', 'coal', 'charcoal', 'egg', 'wheat', 'sugar', 'gold_ingot', 'copper_ingot', 'emerald', 'lapis_lazuli', 'redstone', 'glass', 'sand', 'clay_ball', 'brick', 'oak_log'];
    for (const name of names) inventory[name] = name === 'diamond' ? 64 : 3;
    const bot = F.makeBot({ world: landscape(), inventory });
    F.player(bot);
    assert.equal(bot.inventory.emptySlotCount(), 3);
    const agent = F.makeAgent({ bot, name: 'metfull', replies: [''] });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    agent.work.startTask('logs', 'obtain item=oak_log count=2');
    await F.until(() => agent.work.record.status !== 'active');
    assert.equal(agent.work.record.status, 'done', agent.work.record.reason);
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

test('S2e R1-11: an in-task drop interrupted before its first toss returns to the step; it does not block "inventory full"', async () => {
    const bot = F.makeBot({ world: landscape() });
    F.player(bot);
    const agent = F.makeAgent({ bot, name: 'junkwait', work: { stall_s: 0.05 } });
    F.clearRecord(agent);
    F.startWork(agent);
    agents.push(agent);
    stops.push(F.drive(agent));
    const full = fullBot();
    bot.inventory.slots.splice(0, 46, ...full.inventory.slots);
    const wait = bot.waitForTicks;
    let waits = 0;
    bot.waitForTicks = async t => { await wait(t); if (++waits === 1) agent.requestInterrupt(); };
    agent.work.startTask('3 oak logs', 'obtain item=oak_log count=3');
    await F.until(() => agent.work.record.status !== 'active', { timeout: 8000 });
    assert.equal(agent.work.record.status, 'done', agent.work.record.reason);
    assert.equal(agent.work.record.plan[0].progress.junk_drops, 2, 'the interrupted drop, then the one that ran');
});

test('junk drop tosses one observed inventory stack per call: an interruption stops it between any two stacks (G5)', async () => {
    const bot = fullBot();
    // The same full inventory, but dirt in 32-item stacks is the only junk:
    // 64 to keep, the rest to drop, so one stack-size quantity spans two stacks.
    for (const s of bot.inventory.slots) {
        if (s?.name === 'dirt') s.count = 32;
        else if (s && disposable(s.name)) Object.assign(s, { name: 'stone', type: F.registry.itemsByName.stone.id });
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
