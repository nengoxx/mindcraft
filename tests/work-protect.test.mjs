import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2: protection (SPEC §13): the predicate, the tree test, the placement ledger
// and stations, and the Movements.prototype.safeToBreak patch (REQ-SAFE-1..5,
// REQ-FIND-16, REQ-BLD-22).
const require = createRequire(import.meta.url);
const { protect, skills, pf, work: W } = F.modules;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const at = (x, y, z) => new F.Vec3(x, y, z);
let n = 0;
function setup({ world = new F.World(), name = `protect${n++}`, keep = false, init_message = null, inventory } = {}) {
    const bot = F.makeBot({ world, inventory });
    F.player(bot, F.OWNER, [0, 64, 0]);
    const agent = F.makeAgent({ bot, name });
    if (!keep) F.clearRecord(agent);
    F.startWork(agent, { init_message });
    agents.push(agent);
    return agent;
}
// A cabin wall of logs: no natural leaves anywhere near.
function cabin(world, x = -3) {
    world.fill(x, 64, -1, x, 66, 1, 'oak_log', { axis: 'y' });
}
const hang = agent => { agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 }); };

test('the predicate: natural terrain and natural trees are free; a log cabin, player leaves and crafted blocks are protected', () => {
    const world = new F.World();
    F.tree(world, 4, 64, 0);
    cabin(world);
    world.set(10, 64, 0, 'oak_leaves', { persistent: true, distance: '1', waterlogged: false });
    for (const [x, name] of [[20, 'stone'], [21, 'dirt'], [22, 'grass_block'], [23, 'sand'], [24, 'iron_ore'], [25, 'short_grass'],
        [30, 'oak_planks'], [31, 'cobblestone'], [32, 'chest'], [33, 'glass'], [34, 'white_wool'], [35, 'stripped_oak_log']]) world.set(x, 64, 0, name);
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    const blocked = (x, y = 64, z = 0) => p.isProtected(bot.blockAt(at(x, y, z)));
    assert.equal(blocked(4, 64, 0), false);   // natural tree trunk
    assert.equal(blocked(4, 67, 0), false);
    assert.equal(blocked(5, 68, 0), false);   // its non-persistent leaves
    assert.equal(blocked(-3, 65, 0), true);   // all-log cabin
    assert.equal(blocked(10), true);          // leaves a player placed
    for (const x of [20, 21, 22, 23, 24, 25]) assert.equal(blocked(x), false, `natural at ${x}`);
    for (const x of [30, 31, 32, 33, 34, 35]) assert.equal(blocked(x), true, `protected at ${x}`);
    // The ledger exempts the bot's own placements.
    const own = new protect.Protector(bot, { ledgerGet: pos => pos.x === 30 ? { block: 'oak_planks' } : null });
    assert.equal(own.isProtected(bot.blockAt(at(30, 64, 0))), false);
});

test('collection never re-selects a protected block', async () => {
    const world = new F.World();
    cabin(world, 2);            // nearer
    F.tree(world, 8, 64, 0, 3); // further
    const agent = setup({ world });
    const collected = await skills.collectBlock(agent.bot, 'oak_log', 6);
    assert.equal(collected, true);
    const targets = agent.bot.calls.filter(c => c[0] === 'collect').map(c => c[2]);
    assert.deepEqual(targets.sort(), ['(8, 64, 0)', '(8, 65, 0)', '(8, 66, 0)']);
    assert.equal(world.block(at(2, 65, 0)).name, 'oak_log'); // the cabin is untouched
});

test('the prototype patch covers a Movements never passed to setMovements, and the collect plugin\'s own', () => {
    const world = new F.World();
    cabin(world);
    F.tree(world, 4, 64, 0);
    const agent = setup({ world });
    const { bot } = agent;
    const fresh = new pf.Movements(bot);
    assert.equal(fresh.safeToBreak(bot.blockAt(at(-3, 65, 0))), false);
    assert.equal(fresh.safeToBreak(bot.blockAt(at(4, 65, 0))), true);
    require('mineflayer-collectblock').plugin(bot); // its constructor makes its own Movements
    assert.equal(bot.collectBlock.movements.safeToBreak(bot.blockAt(at(-3, 65, 0))), false);
    assert.equal(bot.collectBlock.movements.safeToBreak(bot.blockAt(at(4, 65, 0))), true);
});

test('while a task runs, safeToBreak forces dontCreateFlow and dontMineUnderFallingBlock for every block, even after collect set them false', async () => {
    const world = new F.World();
    world.set(0, 60, 0, 'stone'); world.set(1, 60, 0, 'water');   // next to water
    world.set(5, 60, 0, 'stone'); world.set(5, 61, 0, 'sand');    // under a falling block
    world.set(9, 60, 0, 'oak_log', { axis: 'y' }); world.set(9, 61, 0, 'gravel'); F.tree(world, 9, 62, 0, 2); // a target type too
    const agent = setup({ world });
    const { bot } = agent;
    const m = new pf.Movements(bot);
    m.dontCreateFlow = false;          // what collectBlock and the collect plugin do
    m.dontMineUnderFallingBlock = false;
    const wet = bot.blockAt(at(0, 60, 0));
    const under = bot.blockAt(at(5, 60, 0));
    assert.equal(m.safeToBreak(wet), true);   // no task: upstream behaviour
    assert.equal(m.safeToBreak(under), true);
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    assert.equal(m.safeToBreak(wet), false);
    assert.equal(m.safeToBreak(under), false);
    assert.equal(m.safeToBreak(bot.blockAt(at(9, 60, 0))), false); // the obtain-target exception is I5
    assert.deepEqual([m.dontCreateFlow, m.dontMineUnderFallingBlock], [false, false]); // restored after each check
    await agent.work.cancelTask();
    assert.equal(m.safeToBreak(wet), true);
});

test('the tree test runs once per position per run (memoized)', () => {
    const world = new F.World();
    F.tree(world, 4, 64, 0, 6);
    const bot = F.makeBot({ world });
    let reads = 0;
    const blockAt = bot.blockAt;
    bot.blockAt = pos => { reads++; return blockAt(pos); };
    const p = new protect.Protector(bot);
    p.newRun();
    const log = y => blockAt(at(4, y, 0));
    assert.equal(p.isProtected(log(64)), false);
    const first = reads;
    assert.ok(first > 0);
    for (let y = 64; y < 70; y++) assert.equal(p.isProtected(log(y)), false);
    assert.equal(reads, first); // the whole trunk was cached by the first test
    p.newRun();
    p.isProtected(log(66));
    assert.ok(reads > first);
});

test('outside a run the tree test is computed fresh every time (F4)', () => {
    const world = new F.World();
    F.tree(world, 4, 64, 0, 3);
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    p.newRun();
    p.endRun();
    assert.equal(p.isProtected(bot.blockAt(at(4, 64, 0))), false);
    world.fill(3, 67, -1, 5, 67, 1, 'air'); // the leaves are gone: no longer a tree
    assert.equal(p.isProtected(bot.blockAt(at(4, 64, 0))), true);
});

test('a log cabin touching a tree\'s natural leaves stays protected; every tree shape stays collectable (F3)', () => {
    const world = new F.World();
    cabin(world);                        // wall x=-3, y 64..66, z -1..1
    F.tree(world, -1, 63, 0, 3);         // leaves at y=66 over x -2..0 touch the wall's side
    const leaves = { persistent: false, distance: '1', waterlogged: false };
    // 2x2 dark oak
    for (const [x, z] of [[10, 0], [11, 0], [10, 1], [11, 1]]) for (let y = 64; y < 70; y++) world.set(x, y, z, 'dark_oak_log', { axis: 'y' });
    world.fill(9, 70, -1, 12, 70, 2, 'dark_oak_leaves', leaves);
    // bent acacia: a straight trunk, then diagonal steps up to the canopy
    for (let y = 64; y < 67; y++) world.set(20, y, 0, 'acacia_log', { axis: 'y' });
    world.set(21, 67, 0, 'acacia_log', { axis: 'y' });
    world.set(22, 68, 1, 'acacia_log', { axis: 'y' });
    world.fill(21, 69, 0, 23, 69, 2, 'acacia_leaves', leaves);
    // a branching oak: the branch log sits beside the trunk, below the canopy
    F.tree(world, 30, 64, 0, 5);
    world.set(31, 66, 0, 'oak_log', { axis: 'x' });
    // a tall spruce and a birch
    F.tree(world, 40, 64, 0, 30, 'spruce_log');
    F.tree(world, 50, 64, 0, 5, 'birch_log');
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (const y of [64, 65, 66]) for (const z of [-1, 0, 1]) assert.equal(p.isProtected(bot.blockAt(at(-3, y, z))), true, `cabin -3,${y},${z}`);
    assert.equal(p.isProtected(bot.blockAt(at(-1, 63, 0))), false, 'the tree beside the cabin');
    for (const [x, y, z] of [[10, 64, 0], [11, 64, 1], [20, 64, 0], [21, 67, 0], [22, 68, 1], [30, 64, 0], [31, 66, 0], [40, 64, 0], [50, 64, 0]])
        assert.equal(p.isProtected(bot.blockAt(at(x, y, z))), false, `tree log ${x},${y},${z}`);
});

test('the tree test is capped: the upward search at 40 logs, the component at 64 (H7)', () => {
    const world = new F.World();
    F.tree(world, 0, 64, 0, 45);   // 45 logs: under the component cap
    F.tree(world, 10, 64, 0, 70);  // 70 logs: over it
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    assert.equal(p.isProtected(bot.blockAt(at(0, 64, 0))), true);   // more than 40 logs below the canopy
    assert.equal(p.isProtected(bot.blockAt(at(0, 108, 0))), false);
    assert.equal(p.isProtected(bot.blockAt(at(10, 64, 0))), true);
    assert.equal(p.isProtected(bot.blockAt(at(10, 133, 0))), true);  // even right under its canopy
});

test('ores: collectable only with a face open to air or water; buried ores are protected (F5)', () => {
    const world = new F.World();
    world.fill(-3, 57, -3, 3, 63, 3, 'stone');
    world.set(0, 60, 0, 'coal_ore');                 // buried
    world.set(3, 61, 0, 'iron_ore');                 // on the side of the stone: open to air
    world.set(0, 63, 0, 'coal_ore');                 // top face open
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    p.newRun(); // inside a task run (G8)
    assert.equal(p.isProtected(bot.blockAt(at(0, 60, 0))), true);
    assert.equal(p.isProtected(bot.blockAt(at(3, 61, 0))), false);
    assert.equal(p.isProtected(bot.blockAt(at(0, 63, 0))), false);
    p.endRun();  // outside a run ores are natural, buried or not, as before S2
    assert.equal(p.isProtected(bot.blockAt(at(0, 60, 0))), false);
});

test('outside a task native collection still mines a buried ore (G8)', async () => {
    const world = new F.World();
    world.fill(-2, 60, -2, 2, 63, 2, 'stone');
    world.set(0, 61, 0, 'coal_ore');
    const agent = setup({ world, inventory: { wooden_pickaxe: 1 } });
    assert.equal(await skills.collectBlock(agent.bot, 'coal_ore', 1), true);
    assert.equal(world.block(at(0, 61, 0)).name, 'air');
});

test('commonly farmed plants are not natural (F6)', () => {
    for (const name of ['sugar_cane', 'bamboo', 'cactus', 'sweet_berry_bush', 'kelp', 'kelp_plant', 'bamboo_sapling'])
        assert.equal(protect.isNaturalBlockName(name), false, name);
    for (const name of ['short_grass', 'stone', 'dandelion']) assert.equal(protect.isNaturalBlockName(name), true, name);
});

test('a ledger entry exempts only the block it recorded; a replaced or vanished block retires it, on restore too (F2)', () => {
    const world = new F.World();
    world.set(3, 64, 0, 'furnace');            // the owner put a furnace where the bot's table was
    world.set(4, 64, 0, 'crafting_table');     // the bot's own table, still there
    const agent = setup({ world, name: 'ledgername' });
    const w = agent.work;
    const earlier = F.modules.record.newRecord({ objective: 'earlier', request_text: null, requested_by: null, anchor: null, steps: [], placements: [
        { pos: { x: 3, y: 64, z: 0 }, block: 'crafting_table', build_id: null, kind: 'permanent', at: 1 },
        { pos: { x: 4, y: 64, z: 0 }, block: 'crafting_table', build_id: null, kind: 'permanent', at: 1 },
    ] });
    earlier.status = 'done';
    w.adopt(earlier);
    w.write();
    agent.work.dispose();
    const again = setup({ world, name: 'ledgername', keep: true });
    const m = new pf.Movements(again.bot);
    assert.equal(m.safeToBreak(again.bot.blockAt(at(3, 64, 0))), false);  // the owner's furnace
    assert.equal(m.safeToBreak(again.bot.blockAt(at(4, 64, 0))), true);   // the bot's table
    assert.deepEqual(again.work.record.placements.map(e => e.pos.x), [4]); // the stale entry is retired
});

test('outside a task the bot can take back the crafting table a one-off !craftRecipe placed (F7)', async () => {
    const world = new F.World();
    world.fill(-8, 63, -8, 8, 63, 8, 'dirt');
    const agent = setup({ world, inventory: { crafting_table: 1, oak_planks: 6, stick: 4 }, name: 'oneoff' });
    assert.equal(agent.work.record, null);
    const ok = await skills.craftRecipe(agent.bot, 'wooden_pickaxe', 1);
    assert.equal(ok, true);
    assert.equal(agent.bot.count('wooden_pickaxe'), 1);
    assert.equal(agent.bot.count('crafting_table'), 1);  // placed, used and collected again
    assert.ok(agent.bot.calls.some(c => c[0] === 'place' && c[1] === 'crafting_table'));
    // After a finished task the entry goes into that record (persisted).
    agent.work.startTask('here', 'go_to target=0,64,0');
    await F.until(() => agent.work.record.status === 'done');
    await skills.craftRecipe(agent.bot, 'wooden_pickaxe', 1);
    assert.equal(agent.bot.count('crafting_table'), 1);
});

test('placeBlock never breaks a protected block in its way, nor removes one as air (F1)', async () => {
    const world = new F.World();
    world.set(2, 64, 0, 'furnace');
    world.set(3, 64, 0, 'chest');
    world.set(4, 64, 0, 'dirt');
    world.fill(0, 63, -2, 8, 63, 2, 'dirt');
    const agent = setup({ world, inventory: { torch: 4, cobblestone: 4 } });
    const { bot } = agent;
    assert.equal(await skills.placeBlock(bot, 'cobblestone', 2, 64, 0), false);
    assert.equal(world.block(at(2, 64, 0)).name, 'furnace');
    assert.match(bot.output, /furnace there is protected/);
    assert.equal(await skills.placeBlock(bot, 'air', 3, 64, 0), false);
    assert.equal(world.block(at(3, 64, 0)).name, 'chest');
    assert.match(bot.output, /Cannot remove chest/);
    assert.equal(await skills.placeBlock(bot, 'air', 4, 64, 0), true); // natural terrain still goes
    assert.equal(world.block(at(4, 64, 0)).name, 'air');
});

test("the bot's own crafting table, in the persisted ledger, is collectable after a restart", () => {
    const world = new F.World();
    world.set(3, 64, 0, 'crafting_table');
    world.set(-3, 64, 0, 'crafting_table'); // the owner's
    const agent = setup({ world, name: 'ledger' });
    hang(agent);
    agent.work.startTask('walk', 'go_to target=40,64,0');
    agent.bot.emit('blockPlaced', agent.bot.blockAt(at(3, 64, 0)).constructor.fromStateId(0, 0), agent.bot.blockAt(at(3, 64, 0)));
    const entry = F.readRecord(agent).placements[0];
    assert.deepEqual({ ...entry, at: 0 }, { pos: { x: 3, y: 64, z: 0 }, block: 'crafting_table', build_id: agent.work.record.id, kind: 'permanent', at: 0 });
    agent.work.dispose();
    agent.bot.interrupt_code = true;
    const again = setup({ world, name: 'ledger', keep: true, init_message: W.RESTART_MESSAGE });
    hang(again);
    const m = new pf.Movements(again.bot);
    assert.equal(m.safeToBreak(again.bot.blockAt(at(3, 64, 0))), true);
    assert.equal(m.safeToBreak(again.bot.blockAt(at(-3, 64, 0))), false);
});

test('after a task replacement, a still-present permanent table or furnace outside any blueprint carries over as a station; other entries drop', async () => {
    const world = new F.World();
    world.set(3, 64, 0, 'crafting_table');
    world.set(4, 64, 0, 'furnace');
    world.set(5, 64, 0, 'dirt');
    world.set(7, 64, 0, 'crafting_table');
    const agent = setup({ world, name: 'stations' });
    const w = agent.work;
    for (const outcome of ['done', 'cancelled', 'superseded']) {
        if (outcome === 'superseded') { hang(agent); w.startTask('walk', 'go_to target=40,64,0'); await w.pauseTask(); }
        else w.startTask('here', 'go_to target=0,64,0');
        if (outcome === 'done') await F.until(() => w.record.status === 'done');
        if (outcome === 'cancelled') await w.cancelTask();
        const id = w.record.id;
        w.record.structures = [{ id: 'b1' }];
        w.record.placements = [
            { pos: { x: 3, y: 64, z: 0 }, block: 'crafting_table', build_id: id, kind: 'permanent', at: 1 },
            { pos: { x: 4, y: 64, z: 0 }, block: 'furnace', build_id: id, kind: 'permanent', at: 1 },
            { pos: { x: 5, y: 64, z: 0 }, block: 'dirt', build_id: id, at: 1 },
            { pos: { x: 6, y: 64, z: 0 }, block: 'crafting_table', build_id: id, kind: 'permanent', at: 1 }, // picked up since
            { pos: { x: 7, y: 64, z: 0 }, block: 'crafting_table', build_id: 'b1', kind: 'permanent', at: 1 }, // a blueprint cell
        ];
        w.write();
        agent.bot.hooks.goto = null;
        assert.equal(w.startTask('next', 'go_to target=0,64,0').ok, true, outcome);
        assert.deepEqual(w.record.placements.map(e => [e.pos.x, e.block, e.kind]), [[3, 'crafting_table', 'station'], [4, 'furnace', 'station']], outcome);
        const m = new pf.Movements(agent.bot);
        assert.equal(m.safeToBreak(agent.bot.blockAt(at(3, 64, 0))), true, outcome);
        assert.equal(m.safeToBreak(agent.bot.blockAt(at(7, 64, 0))), false, outcome);
        await F.until(() => w.record.status === 'done');
    }
    // A station survives the next replacement too, while its block is there.
    world.set(4, 64, 0, 'air');
    w.startTask('again', 'go_to target=0,64,0');
    assert.deepEqual(w.record.placements.map(e => [e.pos.x, e.kind]), [[3, 'station']]);
});

test('digDown is not used by the task layer (REQ-FIND-15)', () => {
    const dir = new URL('../src/agent/work/', import.meta.url);
    const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js'));
    assert.ok(files.length >= 10);
    for (const file of files) assert.doesNotMatch(fs.readFileSync(new URL(file, dir), 'utf8'), /digDown/, file);
});

// --- fix wave 2 ------------------------------------------------------------

test('outside a task only stations the bot places are its own: a bot-built plank wall stays protected (G7)', async () => {
    const world = new F.World();
    world.fill(-8, 63, -8, 8, 63, 8, 'dirt');
    const agent = setup({ world, inventory: { oak_planks: 3, crafting_table: 1 }, name: 'wallbuilder' });
    for (const z of [2, 3, 4]) assert.equal(await skills.placeBlock(agent.bot, 'oak_planks', 3, 64, z), true);
    const m = new pf.Movements(agent.bot);
    for (const z of [2, 3, 4]) assert.equal(m.safeToBreak(agent.bot.blockAt(at(3, 64, z))), false, `plank at z=${z}`);
    assert.equal(await skills.placeBlock(agent.bot, 'crafting_table', -3, 64, 0), true);
    assert.equal(m.safeToBreak(agent.bot.blockAt(at(-3, 64, 0))), true);
});

test('tillAndSow never breaks a protected block above the soil (G11)', async () => {
    const world = new F.World();
    world.fill(-3, 63, -3, 3, 63, 3, 'dirt');
    world.set(1, 64, 0, 'oak_slab');
    const agent = setup({ world, inventory: { wooden_hoe: 1 } });
    assert.equal(await skills.tillAndSow(agent.bot, 1, 63, 0), false);
    assert.equal(world.block(at(1, 64, 0)).name, 'oak_slab');
    assert.match(agent.bot.output, /oak_slab above is protected/);
});

// --- final tree ruling: the upward rule AND a bare component ------------------

const LEAVES = { persistent: false, distance: '1', waterlogged: false };
const canopy = (world, x1, y, z1, x2, z2, leaves = 'oak_leaves') => world.fill(x1, y, z1, x2, y, z2, leaves, LEAVES);

test('a log build under a natural canopy that touches a door, planks, glass or a torch stays protected', () => {
    for (const [name, props] of [['oak_door', { half: 'lower' }], ['oak_planks'], ['glass'], ['torch']]) {
        const world = new F.World();
        world.fill(0, 64, 0, 8, 67, 0, 'oak_log', { axis: 'y' });   // a 9x4 log wall…
        canopy(world, -1, 68, -1, 9, 1);                             // …right under a tree's canopy
        world.set(4, 64, 1, name, props);                            // with a block of the build against it
        const bot = F.makeBot({ world });
        const p = new protect.Protector(bot);
        for (let x = 0; x <= 8; x++) for (let y = 64; y <= 67; y++)
            assert.equal(p.isProtected(bot.blockAt(at(x, y, 0))), true, `${name}: log ${x},${y}`);
    }
});

test('a 7x7x4 log cabin under a natural canopy is protected by the cap', () => {
    const world = new F.World();
    for (let y = 64; y < 68; y++) for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++)
        if (x === 0 || x === 6 || z === 0 || z === 6) world.set(x, y, z, 'oak_log', { axis: 'y' });
    canopy(world, -1, 68, -1, 7, 7);
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (const [x, y, z] of [[0, 64, 0], [3, 67, 0], [6, 67, 6], [0, 65, 3]])
        assert.equal(p.isProtected(bot.blockAt(at(x, y, z))), true, `cabin ${x},${y},${z}`);
});

test('a felled 4-log oak: with its bottom log cut, the remaining 3 stay collectable', async () => {
    const world = new F.World();
    world.fill(-6, 63, -6, 8, 63, 6, 'grass_block');
    F.tree(world, 3, 64, 0, 4);
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    world.set(3, 64, 0, 'air');
    for (const y of [65, 66, 67]) assert.equal(p.isProtected(bot.blockAt(at(3, y, 0))), false, `log at ${y}`);
    // and through native collection, outside a task
    world.set(3, 64, 0, 'oak_log', { axis: 'y' });
    const agent = setup({ world });
    assert.equal(await skills.collectBlock(agent.bot, 'oak_log', 4), true);
    assert.equal(agent.bot.count('oak_log'), 4);
});

test('a jungle trunk with cocoa and an oak with a bee nest are collectable', () => {
    const world = new F.World();
    F.tree(world, 0, 64, 0, 6, 'jungle_log');
    world.set(1, 65, 0, 'cocoa', { facing: 'west', age: '2' });
    F.tree(world, 10, 64, 0, 5);
    world.set(10, 66, 1, 'bee_nest', { facing: 'south', honey_level: '0' });
    world.set(11, 64, 0, 'beehive', { facing: 'east', honey_level: '0' });
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (const y of [64, 66, 69]) assert.equal(p.isProtected(bot.blockAt(at(0, y, 0))), false, `jungle ${y}`);
    for (const y of [64, 66, 68]) assert.equal(p.isProtected(bot.blockAt(at(10, y, 0))), false, `oak ${y}`);
});

test('a 2x2 dark oak and a bent acacia are collectable under the component check', () => {
    const world = new F.World();
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (let y = 64; y < 70; y++) world.set(x, y, z, 'dark_oak_log', { axis: 'y' });
    canopy(world, -1, 70, -1, 2, 2, 'dark_oak_leaves');
    for (let y = 64; y < 67; y++) world.set(20, y, 0, 'acacia_log', { axis: 'y' });
    world.set(21, 67, 0, 'acacia_log', { axis: 'y' });
    world.set(22, 68, 1, 'acacia_log', { axis: 'y' });
    canopy(world, 21, 69, 0, 23, 2, 'acacia_leaves');
    world.fill(-2, 63, -2, 24, 63, 3, 'grass_block');
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (const [x, y, z] of [[0, 64, 0], [1, 69, 1], [20, 64, 0], [21, 67, 0], [22, 68, 1]])
        assert.equal(p.isProtected(bot.blockAt(at(x, y, z))), false, `tree log ${x},${y},${z}`);
});

// --- final main-seat rulings (H1, H3, H4, H7) -------------------------------

test('an oak roof on spruce posts under a natural canopy, planks on the posts, stays protected (H1)', () => {
    const world = new F.World();
    for (const x of [0, 3]) for (let y = 64; y < 67; y++) world.set(x, y, 0, 'spruce_log', { axis: 'y' });
    for (let x = 0; x <= 3; x++) world.set(x, 67, 0, 'oak_log', { axis: 'x' });
    world.set(1, 64, 0, 'oak_planks');
    canopy(world, -1, 68, -1, 4, 1);
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (let x = 0; x <= 3; x++) assert.equal(p.isProtected(bot.blockAt(at(x, 67, 0))), true, `roof ${x}`);
    assert.equal(p.isProtected(bot.blockAt(at(0, 65, 0))), true, 'post');
});

test('trees beside farmed plants and a pale oak with a creaking heart are collectable; the plants stay protected (H3)', () => {
    const world = new F.World();
    const cases = [['spruce_log', 'sweet_berry_bush', { age: '2' }], ['jungle_log', 'bamboo', {}], ['jungle_log', 'melon', {}],
        ['oak_log', 'pumpkin', {}], ['oak_log', 'sugar_cane', {}], ['oak_log', 'cactus', {}]];
    cases.forEach(([log, plant, props], i) => {
        F.tree(world, i * 10, 64, 0, 5, log);
        world.set(i * 10 + 1, 64, 1, plant, props);
    });
    // a pale oak: a 2x2 trunk with a natural creaking heart in it
    for (const [x, z] of [[80, 0], [81, 0], [80, 1], [81, 1]]) for (let y = 64; y < 68; y++) world.set(x, y, z, 'pale_oak_log', { axis: 'y' });
    world.set(80, 66, 0, 'creaking_heart', { axis: 'y' });
    canopy(world, 79, 68, -1, 82, 2, 'pale_oak_leaves');
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    cases.forEach(([log, plant], i) => {
        for (const y of [64, 68]) assert.equal(p.isProtected(bot.blockAt(at(i * 10, y, 0))), false, `${log} beside ${plant}, y=${y}`);
        assert.equal(p.isProtected(bot.blockAt(at(i * 10 + 1, 64, 1))), true, `${plant} itself`);
    });
    for (const [x, y, z] of [[80, 64, 0], [81, 67, 1]]) assert.equal(p.isProtected(bot.blockAt(at(x, y, z))), false, `pale oak ${x},${y},${z}`);
    assert.equal(p.isProtected(bot.blockAt(at(80, 66, 0))), true, 'the creaking heart itself');
});

test('a 44-log dark oak is under the component cap and collectable (H7)', () => {
    const world = new F.World();
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (let y = 64; y < 75; y++) world.set(x, y, z, 'dark_oak_log', { axis: 'y' });
    canopy(world, -2, 75, -2, 3, 3, 'dark_oak_leaves');
    const bot = F.makeBot({ world });
    const p = new protect.Protector(bot);
    for (const [x, y, z] of [[0, 64, 0], [1, 74, 1]]) assert.equal(p.isProtected(bot.blockAt(at(x, y, z))), false, `dark oak ${x},${y},${z}`);
});

test('while a task is paused or blocked only stations the bot places are its own (H4)', async () => {
    const world = new F.World();
    world.fill(-8, 63, -8, 8, 63, 8, 'dirt');
    const agent = setup({ world, inventory: { oak_planks: 3, crafting_table: 1 }, name: 'blockedbuilder' });
    agent.work.startTask('logs', 'obtain item=oak_log count=2'); // no trees: it blocks
    await F.until(() => agent.work.record.status === 'blocked');
    for (const z of [2, 3, 4]) assert.equal(await skills.placeBlock(agent.bot, 'oak_planks', 3, 64, z), true);
    assert.equal(await skills.placeBlock(agent.bot, 'crafting_table', -3, 64, 0), true);
    const m = new pf.Movements(agent.bot);
    for (const z of [2, 3, 4]) assert.equal(m.safeToBreak(agent.bot.blockAt(at(3, 64, z))), false, `plank at z=${z}`);
    assert.equal(m.safeToBreak(agent.bot.blockAt(at(-3, 64, 0))), true);
});
