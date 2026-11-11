import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2c, D2: the placements ledger (SPEC §11.10, REQ-OWN-1 … 6, REQ-SAFE-2,
// REQ-OBS-4): recording from the placement attempt, the kinds, the file, old
// scaffold forgotten, the cap and retirement, tidy-dig removal.
const require = createRequire(import.meta.url);
const { protect, ledger: L, clear: C, config: K, skills, pf, work: W, dig } = F.modules;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const at = (x, y, z) => new F.Vec3(x, y, z);
const air = pos => { const b = F.registry.blocksByName.air; const block = require('prismarine-block')(F.registry).fromStateId(b.defaultState, 0); block.position = pos; return block; };
let n = 0;

// The real pathfinder's placement (index.js:571-575): the predicted stone first,
// then bot.placeBlock, which Mineflayer settles on the server's stale air
// (blockPlaced(stone, air), probe P13); the real block arrives later as a plain
// blockUpdate (`server`).
function pathfinderBot(world) {
    const bot = F.makeBot({ world, inventory: { cobblestone: 16, dirt: 16 } });
    bot.placeBlock = async (reference, face) => {
        const dest = reference.position.plus(face);
        bot.emit('blockPlaced', bot.blockAt(dest), air(dest));
    };
    return bot;
}
async function pillarStep(bot, x, y, z, item = 'cobblestone') {
    bot.heldItem = bot.inventory.findInventoryItem(item);
    bot.setBlock(x, y, z, 'stone');                           // setBlockStateId(dest, 1)
    await bot.placeBlock(bot.blockAt(at(x, y - 1, z)), at(0, 1, 0));
}

function setup({ world = new F.World(), bot = null, name = `ledger${n++}`, keep = false, work = {}, init_message = null, now } = {}) {
    bot ??= F.makeBot({ world });
    F.player(bot, F.OWNER, [20, 64, 20]);
    const agent = F.makeAgent({ bot, name, work });
    if (!keep) F.clearRecord(agent);
    const logs = [];
    const original = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
        F.startWork(agent, { init_message, now });
    } finally {
        console.log = original;
    }
    agent.work.ledger.log = message => logs.push(`[ledger] ${message}`);
    agent.logs = logs;
    agents.push(agent);
    return agent;
}
const entries = agent => agent.work.ledger.list().map(e => [e.pos.x, e.pos.y, e.pos.z, e.block, e.kind]);
const entry = (x, block, kind, extra = {}) => ({ pos: { x, y: 64, z: 0 }, block, kind, by: null, dim: 'overworld', at: x, ...extra });

// --- recording ---------------------------------------------------------------

test('a pathfinder placement is recorded as scaffold once the cell shows the expected block, its repeated attempts merged into one entry; never as air (ISSUES cube item 17)', async () => {
    const bot = pathfinderBot();
    const agent = setup({ bot });
    for (let i = 0; i < 3; i++) await pillarStep(bot, 0, 64, 0);   // about three attempts per cell (P13)
    assert.deepEqual(entries(agent), []);                            // blockPlaced(stone, air) writes nothing
    bot.setBlock(0, 64, 0, 'cobblestone');                           // the server's real update
    assert.deepEqual(entries(agent), [[0, 64, 0, 'cobblestone', 'scaffold']]);
    assert.ok(agent.logs.some(l => /placement scaffold by - at 0,64,0 \(3 attempts\): recorded cobblestone as scaffold/.test(l)), agent.logs.join('\n'));
    // Settling by blockAt after the window works too.
    agent.work.ledger.settleMs = 30;
    await pillarStep(bot, 0, 65, 0);
    bot.world.set(0, 65, 0, 'cobblestone');                          // no blockUpdate seen
    await F.until(() => entries(agent).length === 2);
    assert.deepEqual(entries(agent)[1], [0, 65, 0, 'cobblestone', 'scaffold']);
});

test('a scaffold attempt that settles to air, a liquid, predicted stone or another block writes nothing; a changed held item matches nothing', async () => {
    const bot = pathfinderBot();
    const agent = setup({ bot });
    agent.work.ledger.settleMs = 30;
    await pillarStep(bot, 0, 64, 0); bot.setBlock(0, 64, 0, 'air');           // refused: air
    await pillarStep(bot, 1, 64, 0); bot.setBlock(1, 64, 0, 'water');         // the old liquid of a water crossing
    await pillarStep(bot, 2, 64, 0);                                          // stays predicted stone
    await pillarStep(bot, 3, 64, 0); bot.setBlock(3, 64, 0, 'oak_planks');    // another block
    await pillarStep(bot, 4, 64, 0); bot.setBlock(4, 64, 0, 'dirt');          // auto-eat swapped the held item before the packet
    await F.sleep(80);
    assert.deepEqual(entries(agent), []);
    assert.equal(agent.work.ledger.attempts.size, 0);
    assert.ok(agent.logs.some(l => /at 2,64,0 .*no entry \(the cell shows predicted stone\)/.test(l)), agent.logs.join('\n'));
});

test('an attempt is dropped when its column unloads or the world changes', async () => {
    const bot = pathfinderBot();
    const agent = setup({ bot });
    await pillarStep(bot, 0, 64, 0);
    await pillarStep(bot, 20, 64, 0);
    bot.emit('chunkColumnUnload', at(0, 0, 0));                 // the column of 0,64,0
    assert.deepEqual([...agent.work.ledger.attempts.values()].map(a => a.pos.x), [20]);
    bot.setBlock(0, 64, 0, 'cobblestone');
    // A dimension change unloads every column (blocks.js switchWorld).
    bot.emit('chunkColumnUnload', at(16, 0, 0));
    bot.setBlock(20, 64, 0, 'cobblestone');
    assert.deepEqual(entries(agent), []);
    assert.ok(agent.logs.some(l => /at 0,64,0 .*no entry \(chunk unloaded\)/.test(l)));
});

test('a non-scaffold placement is written at once from newBlock: real stone placed by code is recorded own; by and dim come from the attempt', async () => {
    const world = new F.World();
    world.fill(-8, 63, -8, 8, 63, 8, 'dirt');
    const bot = F.makeBot({ world, inventory: { stone: 2 } });
    const agent = setup({ bot });
    await agent.actions.runAction('action:newAction', async () => { await skills.placeBlock(bot, 'stone', 2, 64, 0); });
    assert.deepEqual(agent.work.ledger.list().map(e => [e.block, e.kind, e.by, e.dim]), [['stone', 'own', 'action:newAction', 'overworld']]);
    assert.ok(agent.logs.some(l => /placement own by action:newAction at 2,64,0: recorded stone/.test(l)));
    // An entry matches only in its own dimension.
    bot.game.dimension = 'the_nether';
    assert.equal(agent.work.ledger.get(at(2, 64, 0)), null);
    await skills.placeBlock(bot, 'stone', 3, 64, 0);
    assert.deepEqual(agent.work.ledger.list().map(e => [e.pos.x, e.dim, e.by]), [[2, 'overworld', 'action:newAction'], [3, 'the_nether', null]]);
    bot.game.dimension = 'overworld';
    assert.equal(agent.work.ledger.get(at(2, 64, 0)).block, 'stone');
    assert.equal(agent.work.ledger.get(at(3, 64, 0)), null);
});

test('the installed pathfinder writes the predicted stone before it calls bot.placeBlock (tell A guard, REQ-OWN-6)', () => {
    const source = fs.readFileSync(require.resolve('mineflayer-pathfinder'), 'utf8');
    const write = source.indexOf('bot.world.setBlockStateId(refBlock.position.offset(placingBlock.dx, placingBlock.dy, placingBlock.dz), 1)');
    const call = source.indexOf('bot.placeBlock(refBlock, new Vec3(placingBlock.dx, placingBlock.dy, placingBlock.dz))');
    assert.ok(write > 0, 'the predicted stone write is gone: tell A no longer holds (see SPEC REQ-OWN-6 for the fallback)');
    assert.ok(call > write, 'bot.placeBlock is no longer called after the predicted write');
    // Synchronously: nothing awaits between the write and the call.
    assert.doesNotMatch(source.slice(write, call), /await|\.then\(/);
});

// --- kinds -------------------------------------------------------------------

test('kinds: scaffold and station exempt everywhere; own protected outside an active clear box whatever its material, exempt inside; building only during its build', () => {
    const world = new F.World();
    for (const [x, name] of [[0, 'cobblestone'], [1, 'crafting_table'], [2, 'dirt'], [3, 'oak_planks'], [4, 'oak_planks'], [5, 'dirt']]) world.set(x, 64, 0, name);
    const agent = setup({ world });
    const ledger = agent.work.ledger;
    ledger.add(entry(0, 'cobblestone', 'scaffold'));
    ledger.add(entry(1, 'crafting_table', 'station'));
    ledger.add(entry(2, 'dirt', 'own'));
    ledger.add(entry(3, 'oak_planks', 'own'));
    const build = ledger.beginBuild();
    ledger.add(entry(4, 'oak_planks', 'building', { build_id: build }));
    const p = agent.work.protector;
    const guarded = x => p.isProtected(agent.bot.blockAt(at(x, 64, 0)));
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(guarded), [false, false, true, true, false, false]); // a dirt house the bot built is not natural; plain dirt is
    ledger.endBuild(build);
    assert.equal(guarded(4), true);                                  // protected after its build
    // Inside an active clear box own entries are ordinary cells; building stays.
    const step = { args: { box: { x1: 2, y1: 64, z1: 0, x2: 4, y2: 64, z2: 0 }, bounds: { x1: 2, y1: 64, z1: 0, x2: 4, y2: 64, z2: 0 }, shell: null }, progress: {} };
    const scoped = new protect.Protector(agent.bot, { ledger, scope: () => C.clearScope(step, K.loadWorkConfig()) });
    assert.deepEqual([2, 3, 4].map(x => scoped.isProtected(agent.bot.blockAt(at(x, 64, 0)))), [false, false, true]);
});

test('a placement during a !buildStructure run is a building entry of that run, through the real command; its perform is untouched', async () => {
    const world = new F.World();
    world.fill(-8, 63, -8, 8, 63, 8, 'dirt');
    const bot = F.makeBot({ world, inventory: { oak_planks: 2 } });
    const probe = F.makeAgent({ bot, name: `build${n++}` });
    const build = F.modules.commands.getCommand('!buildStructure');
    const perform = build.perform;
    let calls = 0;
    let during = null;
    probe.npc = { constructions: { hut: {} }, build_goal: { executeNext: async () => {
        calls++;
        await skills.placeBlock(bot, 'oak_planks', 1 + calls, 64, 0);
        during = probe.work.protector.isProtected(bot.blockAt(at(1 + calls, 64, 0)));
        return { complete: true };
    } } };
    F.clearRecord(probe);
    F.startWork(probe);
    agents.push(probe);
    assert.equal(build.perform, perform);
    await F.modules.commands.executeCommand(probe, '!buildStructure("hut", 0, 64, 0, 0, false)');
    assert.equal(calls, 1);
    assert.equal(during, false);                                                  // exempt while its build runs
    const [e] = probe.work.ledger.list();
    assert.deepEqual([e.kind, e.by, typeof e.build_id], ['building', 'action:buildStructure', 'string']);
    assert.equal(probe.work.ledger.building, null);
    assert.equal(probe.work.protector.isProtected(bot.blockAt(at(2, 64, 0))), true); // protected once it returns
    // The same builder outside the command (the NPC controller) records own.
    await probe.npc.build_goal.executeNext();
    assert.equal(probe.work.ledger.get(at(3, 64, 0)).kind, 'own');
});

test('stations migrate from task.json once; the record loses its placements key', () => {
    const name = `migrate${n++}`;
    const probe = F.makeAgent({ bot: F.makeBot(), name });
    F.clearRecord(probe);
    const record = F.modules.record.newRecord({ objective: 'old', request_text: null, requested_by: F.OWNER, anchor: null, steps: [] });
    record.status = 'done';
    record.structures = [{ id: 'b1' }];
    record.placements = [
        { pos: { x: 3, y: 64, z: 0 }, block: 'crafting_table', build_id: 't1', kind: 'permanent', at: 5 },
        { pos: { x: 4, y: 64, z: 0 }, block: 'furnace', build_id: null, kind: 'station', at: 6 },
        { pos: { x: 5, y: 64, z: 0 }, block: 'air', build_id: 't1', at: 7 },                        // S2's pillar defect
        { pos: { x: 6, y: 64, z: 0 }, block: 'oak_planks', build_id: 't1', at: 8 },
        { pos: { x: 7, y: 64, z: 0 }, block: 'crafting_table', build_id: 'b1', kind: 'permanent', at: 9 }, // a blueprint cell
    ];
    F.modules.record.saveRecord(F.recordFile(probe), record);
    const agent = setup({ name, keep: true });
    assert.deepEqual(entries(agent), [[3, 64, 0, 'crafting_table', 'station'], [4, 64, 0, 'furnace', 'station']]);
    assert.equal('placements' in F.readRecord(agent), false);
    assert.equal(F.readLedger(agent).entries.length, 2);
    agent.work.dispose();
    // Once: a placements key that comes back is not migrated again.
    const again = F.readRecord(agent);
    again.placements = [{ pos: { x: 9, y: 64, z: 0 }, block: 'furnace', build_id: null, kind: 'station', at: 1 }];
    F.modules.record.saveRecord(F.recordFile(agent), again);
    const later = setup({ name, keep: true });
    assert.deepEqual(entries(later).map(e => e[0]), [3, 4]);
    assert.equal('placements' in F.readRecord(later), false);
});

// --- the file ----------------------------------------------------------------

test('the ledger file: atomic and throttled; flushed at task changes', async () => {
    const agent = setup();
    const ledger = agent.work.ledger;
    ledger.throttleMs = 150;
    ledger.add(entry(1, 'oak_planks', 'own'));
    await F.until(() => fs.existsSync(F.ledgerFile(agent)));
    const first = F.readLedger(agent);
    assert.equal(first.version, 1);
    assert.deepEqual(first.entries.map(e => e.pos.x), [1]);
    ledger.add(entry(2, 'oak_planks', 'own'));
    ledger.add(entry(3, 'oak_planks', 'own'));
    await F.sleep(30);
    assert.deepEqual(F.readLedger(agent).entries.map(e => e.pos.x), [1]);      // held back by the throttle
    await F.until(() => F.readLedger(agent).entries.length === 3, { timeout: 1000 });
    const dir = path.dirname(F.ledgerFile(agent));
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes('.tmp')), []); // temp file plus rename
    // A task change flushes at once.
    ledger.throttleMs = 600000;
    ledger.lastWrite = Date.now();
    ledger.add(entry(4, 'oak_planks', 'own'));
    agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 });
    agent.work.startTask('walk', 'go_to target=40,64,0');
    assert.deepEqual(F.readLedger(agent).entries.map(e => e.pos.x), [1, 2, 3, 4]);
    await agent.work.cancelTask();
});

test('the ledger write replaces the file by rename, never writing into it: a read-only file is still replaced', () => {
    const agent = setup();
    const ledger = agent.work.ledger;
    ledger.add(entry(1, 'oak_planks', 'own'));
    ledger.flush();
    fs.chmodSync(F.ledgerFile(agent), 0o444);         // a direct write would fail (EACCES)
    ledger.add(entry(2, 'oak_planks', 'own'));
    ledger.flush();
    assert.deepEqual(F.readLedger(agent).entries.map(e => e.pos.x), [1, 2]);
});

test('an unreadable or unknown-version ledger file is renamed aside, so the next write does not overwrite its entries', () => {
    for (const content of ['{"version":1,"entries":[{"pos":', JSON.stringify({ version: 9, entries: [] })]) {
        const name = `bad${n++}`;
        const probe = F.makeAgent({ name });
        F.clearRecord(probe);
        fs.mkdirSync(path.dirname(F.ledgerFile(probe)), { recursive: true });
        fs.writeFileSync(F.ledgerFile(probe), content);
        const agent = setup({ name, keep: true, now: () => 1234 });
        assert.ok(agent.logs.some(l => /\[ledger\] .*placements\.json: (unreadable|unknown_version); renamed to .*placements\.json\.bad-1234/.test(l)), agent.logs.join('\n'));
        assert.equal(fs.readFileSync(`${F.ledgerFile(agent)}.bad-1234`, 'utf8'), content);
        agent.work.ledger.add(entry(1, 'oak_planks', 'own'));
        agent.work.ledger.flush();
        assert.equal(fs.readFileSync(`${F.ledgerFile(agent)}.bad-1234`, 'utf8'), content);
        assert.deepEqual(F.readLedger(agent).entries.map(e => e.pos.x), [1]);
    }
});

test('old scaffold is forgotten at process start (not at the runner\'s reload) and on chunk unload; owner-kept own entries stay', async () => {
    const name = `forget${n++}`;
    const first = setup({ name });
    first.work.ledger.add(entry(1, 'cobblestone', 'scaffold'));
    first.work.ledger.add(entry(2, 'cobblestone', 'own'));   // re-kinded own by an owner !stop
    first.work.dispose();
    const agent = setup({ name, keep: true });
    assert.deepEqual(entries(agent), [[2, 64, 0, 'cobblestone', 'own']]);
    assert.ok(agent.logs.some(l => /forgot scaffold cobblestone at 1,64,0: process start/.test(l)), agent.logs.join('\n'));
    // The runner's per-run reload does not forget scaffold.
    agent.work.ledger.add(entry(3, 'cobblestone', 'scaffold'));
    agent.work.startTask('here', 'go_to target=0,64,0');
    await F.until(() => agent.work.record.status === 'done');
    agent.work.reload();
    assert.deepEqual(entries(agent).map(e => e[0]), [2, 3]);
    // A chunk the client unloads deletes its scaffold, keeps the rest.
    agent.work.ledger.add(entry(20, 'cobblestone', 'scaffold'));
    agent.bot.emit('chunkColumnUnload', at(0, 0, 0));
    assert.deepEqual(entries(agent).map(e => e[0]), [2, 20]);
    assert.ok(agent.logs.some(l => /deleted scaffold cobblestone at 3,64,0: chunk unloaded/.test(l)));
});

test('the cap evicts only the oldest live scaffold; the warning above 10 000 kept entries', () => {
    const agent = setup({ work: { ledger_max: 3 } });
    const ledger = agent.work.ledger;
    ledger.add(entry(0, 'oak_planks', 'own', { at: 0 }));
    for (const x of [1, 2, 3, 4]) ledger.add(entry(x, 'cobblestone', 'scaffold', { at: x }));
    assert.deepEqual(entries(agent).map(e => e[0]), [0, 2, 3, 4]);
    assert.ok(agent.logs.some(l => /evicted scaffold cobblestone at 1,64,0: over work.ledger_max 3/.test(l)));
    for (let i = 0; i < 10000; i++) ledger.entries.set(`overworld|${i},0,0`, { pos: { x: i, y: 0, z: 0 }, block: 'stone', kind: 'own', dim: 'overworld', at: 1 });
    ledger.add(entry(5, 'oak_planks', 'building', { build_id: 'b' }));
    assert.equal(agent.logs.filter(l => /warning: \d+ own, building and station entries/.test(l)).length, 1);
    ledger.add(entry(6, 'oak_planks', 'own'));
    assert.equal(agent.logs.filter(l => /warning:/.test(l)).length, 1);  // once
});

test('retirement: on a changed block and on blockUpdate, only for loaded cells', () => {
    const world = new F.World();
    world.set(1, 64, 0, 'oak_planks');
    const agent = setup({ world });
    const ledger = agent.work.ledger;
    ledger.add(entry(1, 'oak_planks', 'own'));
    // An unloaded cell is unknown, not gone.
    agent.bot.emit('chunkColumnUnload', at(0, 0, 0));
    const blockAt = agent.bot.blockAt;
    agent.bot.blockAt = () => null;
    assert.equal(protect.isProtectedForBot(agent.bot, agent.bot.blockAt(at(1, 64, 0))), false);
    agent.bot.blockAt = blockAt;
    assert.deepEqual(entries(agent).map(e => e[0]), [1]);
    agent.bot.setBlock(1, 64, 0, 'glass');
    assert.deepEqual(entries(agent), []);
    assert.ok(agent.logs.some(l => /retired own oak_planks at 1,64,0: now glass/.test(l)));
});

test('a tidy dig: removing is exempt during the dig, a same-block update within 3 s revives it, else it is deleted; an aborted dig clears removing', async () => {
    const world = new F.World();
    world.fill(-3, 63, -3, 6, 63, 3, 'dirt');
    for (const x of [1, 2, 3]) world.set(x, 64, 0, 'cobblestone');
    const agent = setup({ world });
    const { bot } = agent;
    bot.entity.position = new F.Vec3(2.5, 64, 2.5);
    const ledger = agent.work.ledger;
    ledger.revertMs = 60;
    for (const x of [1, 2, 3]) ledger.add(entry(x, 'cobblestone', 'scaffold'));
    let removing = null;
    bot.hooks.dig = block => { removing = ledger.list().find(e => e.pos.x === block.position.x).removing; };
    assert.equal((await dig.digCell(bot, bot.blockAt(at(1, 64, 0)), { move: false, hand: true })).ok, true);
    assert.equal(removing, true);
    assert.equal(ledger.get(at(1, 64, 0)), null);                   // dug: removed_at, not live
    assert.equal(ledger.list().length, 3);                          // the predicted air did not retire it
    bot.setBlock(1, 64, 0, 'cobblestone');                          // the server reverted the dig
    assert.equal(ledger.get(at(1, 64, 0)).kind, 'scaffold');
    assert.ok(agent.logs.some(l => /revived scaffold cobblestone at 1,64,0/.test(l)));
    assert.equal((await dig.digCell(bot, bot.blockAt(at(2, 64, 0)), { move: false, hand: true })).ok, true);
    await F.until(() => ledger.list().length === 2, { timeout: 1000 });
    assert.ok(agent.logs.some(l => /removed scaffold cobblestone at 2,64,0/.test(l)));
    bot.hooks.dig = () => { bot.interrupt_code = true; };
    const aborted = await dig.digCell(bot, bot.blockAt(at(3, 64, 0)), { move: false, hand: true });
    bot.interrupt_code = false;
    assert.deepEqual([aborted.ok, aborted.reason], [false, 'interrupted']);
    const third = ledger.get(at(3, 64, 0));
    assert.equal(third.removing, undefined);
    assert.equal(third.removed_at, undefined);
});
