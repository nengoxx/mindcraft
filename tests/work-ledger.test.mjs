import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2c, D2: the placements ledger (SPEC §11.10, REQ-OWN-1 … 6, REQ-SAFE-2,
// REQ-OBS-4): recording from the placement attempt, the kinds, the file, old
// scaffold kept with its gap mark, the cap and retirement, tidy-dig removal;
// S2c-fu: worlds (file version 2), hygiene, the exit flush, the component guard.
const require = createRequire(import.meta.url);
const { protect, ledger: L, clear: C, config: K, skills, pf, work: W, dig } = F.modules;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const at = (x, y, z) => new F.Vec3(x, y, z);
const air = pos => { const b = F.registry.blocksByName.air; const block = require('prismarine-block')(F.registry).fromStateId(b.defaultState, 0); block.position = pos; return block; };
let n = 0;

// The real pathfinder's placement (index.js:579-583): the predicted stone first,
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

// I1-6 / fix wave 2 (adversary mutant M9): placedSince counts only the
// placements from `since` on, entries and pending attempts alike.
test('I1-6 fix wave 2: placedSince counts only placements from its start time; an earlier scaffold still standing is not counted', async () => {
    const c = F.clock();
    const bot = pathfinderBot();
    const agent = setup({ bot, now: c.now });
    await pillarStep(bot, 0, 64, 0);
    bot.setBlock(0, 64, 0, 'cobblestone');   // an earlier collect's scaffold, settled and standing
    assert.deepEqual(entries(agent), [[0, 64, 0, 'cobblestone', 'scaffold']]);
    c.advance(10);
    const since = c.now();
    assert.equal(agent.work.ledger.placedSince('cobblestone', since), 0);
    await pillarStep(bot, 0, 65, 0);         // this call's: still a pending attempt
    assert.equal(agent.work.ledger.placedSince('cobblestone', since), 1);
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
    assert.equal(F.ledgerEntries(agent).length, 2);
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
    assert.equal(first.version, 2);
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1]);
    ledger.add(entry(2, 'oak_planks', 'own'));
    ledger.add(entry(3, 'oak_planks', 'own'));
    await F.sleep(30);
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1]);      // held back by the throttle
    await F.until(() => F.ledgerEntries(agent).length === 3, { timeout: 1000 });
    const dir = path.dirname(F.ledgerFile(agent));
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes('.tmp')), []); // temp file plus rename
    // A task change flushes at once.
    ledger.throttleMs = 600000;
    ledger.lastWrite = Date.now();
    ledger.add(entry(4, 'oak_planks', 'own'));
    agent.bot.hooks.goto = () => F.until(() => agent.bot.interrupt_code, { timeout: 60000 });
    agent.work.startTask('walk', 'go_to target=40,64,0');
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1, 2, 3, 4]);
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
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1, 2]);
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
        assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1]);
    }
});

test('scaffold records survive a restart, marked gap_at at process start (not at the runner\'s reload); an unload keeps and marks its column; "kept N" is logged', async () => {
    const name = `keep${n++}`;
    const world = new F.World();
    for (const x of [11, 12, 13, 20]) world.set(x, 64, 0, 'cobblestone');   // out of the bot's reach
    const first = setup({ name, world, now: () => 500 });
    first.work.ledger.add(entry(11, 'cobblestone', 'scaffold'));
    first.work.ledger.add(entry(12, 'cobblestone', 'own'));   // re-kinded own by an owner !stop
    first.work.dispose();
    const agent = setup({ name, world, keep: true, now: () => 777 });
    assert.deepEqual(entries(agent), [[11, 64, 0, 'cobblestone', 'scaffold'], [12, 64, 0, 'cobblestone', 'own']]);
    assert.equal(agent.work.ledger.get(at(11, 64, 0)).gap_at, 777);
    assert.equal(agent.work.ledger.get(at(12, 64, 0)).gap_at, undefined);   // only scaffold is marked
    assert.ok(agent.logs.some(l => /\[ledger\] kept 1 scaffold entries from before/.test(l)), agent.logs.join('\n'));
    // The runner's per-run reload marks nothing.
    agent.work.ledger.add(entry(13, 'cobblestone', 'scaffold'));
    agent.work.startTask('here', 'go_to target=0,64,0');
    await F.until(() => agent.work.record.status === 'done');
    agent.work.reload();
    assert.equal(agent.work.ledger.get(at(13, 64, 0)).gap_at, undefined);
    // A chunk the client unloads keeps its scaffold, marked as from before (the first gap stays).
    agent.work.ledger.add(entry(20, 'cobblestone', 'scaffold'));
    agent.work.ledger.now = () => 999;
    agent.bot.emit('chunkColumnUnload', at(0, 0, 0));
    assert.deepEqual(entries(agent).map(e => e[0]), [11, 12, 13, 20]);
    assert.deepEqual([11, 13, 20].map(x => agent.work.ledger.get(at(x, 64, 0)).gap_at), [777, 999, undefined]);
    agent.work.ledger.flush();
    assert.equal(F.ledgerEntries(agent).find(e => e.pos.x === 13).gap_at, 999);   // persisted
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

// --- worlds (REQ-OWN-1, S2c-fu) ------------------------------------------------

const MINE = 'seed:123456789abcdef0';   // the fixture bot's hashed seed
const OTHER = 'seed:00000000000000aa';
function writeLedger(name, data) {
    const file = L.ledgerPath(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
}

test('the world id is seed:<hex> of the login packet\'s hashed seed (protodef\'s i64); missing is an unknown world', () => {
    assert.equal(L.worldId({ game: { hashedSeed: F.i64(-5n) } }), 'seed:fffffffffffffffb');
    assert.equal(L.worldId({ game: { hashedSeed: F.i64(0x1234567f9abcdef0n) } }), 'seed:1234567f9abcdef0');   // a negative low word
    assert.equal(L.worldId({ game: { hashedSeed: 0xabn } }), 'seed:00000000000000ab');
    assert.equal(L.worldId({ game: {} }), null);
    assert.equal(L.worldId({ game: { hashedSeed: null } }), null);
    assert.equal(L.worldId({ game: { hashedSeed: 'x' } }), null);
    assert.equal(L.worldId(F.makeBot()), MINE);
    // The utils/mcdata.js carry keeps it from the login and respawn packets
    // (a text check, like the tell A guard: initBot needs a server).
    const source = fs.readFileSync(new URL('../src/utils/mcdata.js', import.meta.url), 'utf8');
    assert.match(source, /bot\.game\.hashedSeed = \(packet\.worldState \?\? packet\)\.hashedSeed \?\? null/);
    assert.match(source, /bot\._client\.on\('login', keepSeed\);\s*bot\._client\.on\('respawn', keepSeed\);/);
});

test('a version-1 file is folded once into the current world and written back as version 2 (no v1 keys); its scaffold is from before', () => {
    const name = `fold${n++}`;
    writeLedger(name, { version: 1, updated_at: 1, entries: [entry(1, 'cobblestone', 'scaffold'), entry(2, 'oak_planks', 'own')] });
    const world = new F.World();
    world.set(1, 64, 0, 'cobblestone');
    world.set(2, 64, 0, 'oak_planks');
    const agent = setup({ name, world, keep: true, now: () => 4321 });
    assert.deepEqual(entries(agent), [[1, 64, 0, 'cobblestone', 'scaffold'], [2, 64, 0, 'oak_planks', 'own']]);
    const file = F.readLedger(agent);
    assert.equal(file.version, 2);
    assert.equal('entries' in file, false);
    assert.deepEqual(Object.keys(file.worlds), [MINE]);
    agent.work.ledger.flush();                                                  // the process-start mark (a throttled write)
    assert.deepEqual(F.ledgerEntries(agent).map(e => [e.pos.x, e.gap_at]), [[1, 4321], [2, undefined]]);
    assert.ok(agent.logs.some(l => /version 1 folded into world seed:123456789abcdef0 \(2 entries\)/.test(l)), agent.logs.join('\n'));
});

test('per world: only the current world\'s entries load; a write keeps the other worlds untouched; the cap is per world and applies once after load', () => {
    const name = `worlds${n++}`;
    const theirs = [0, 1, 2, 3, 4].map(x => entry(x, 'cobblestone', 'scaffold', { at: x }));
    writeLedger(name, { version: 2, updated_at: 1, worlds: {
        [OTHER]: { entries: theirs },
        [MINE]: { entries: [...[10, 11, 12, 13, 14].map(x => entry(x, 'cobblestone', 'scaffold', { at: x })), entry(20, 'oak_planks', 'own')] },
    } });
    const world = new F.World();
    for (const x of [10, 11, 12, 13, 14]) world.set(x, 64, 0, 'cobblestone');
    world.set(20, 64, 0, 'oak_planks');
    const agent = setup({ name, world, keep: true, work: { ledger_max: 3 } });
    assert.deepEqual(entries(agent).map(e => e[0]), [12, 13, 14, 20]);                // the oldest two of this world evicted
    assert.ok(agent.logs.some(l => /evicted scaffold cobblestone at 10,64,0: over work.ledger_max 3/.test(l)));
    assert.equal(agent.work.ledger.dirty, true);
    agent.work.ledger.add(entry(21, 'oak_planks', 'own'));
    agent.work.ledger.flush();
    const file = F.readLedger(agent);
    assert.deepEqual(file.worlds[OTHER], { entries: theirs });                          // untouched, also over the cap
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [12, 13, 14, 20, 21]);
});

test('an unknown world (no hashed seed): nothing is loaded or written, one log line; placements live in memory; a version-1 file is left as it is', () => {
    for (const content of [
        { version: 2, updated_at: 1, worlds: { [MINE]: { entries: [entry(1, 'oak_planks', 'own')] } } },
        { version: 1, updated_at: 1, entries: [entry(1, 'oak_planks', 'own')] },
    ]) {
        const name = `unknown${n++}`;
        const file = writeLedger(name, content);
        const before = fs.readFileSync(file, 'utf8');
        const bot = F.makeBot();
        bot.game.hashedSeed = null;
        const agent = setup({ name, bot, keep: true });
        assert.deepEqual(entries(agent), []);
        assert.equal(agent.logs.filter(l => /unknown world \(no hashed seed\)/.test(l)).length, 1, agent.logs.join('\n'));
        agent.work.ledger.add(entry(5, 'oak_planks', 'own'));
        agent.work.ledger.add(entry(6, 'cobblestone', 'scaffold'));
        assert.deepEqual(entries(agent).map(e => e[0]), [5, 6]);                         // kept in memory
        agent.work.ledger.flush();
        agent.work.dispose();
        assert.equal(fs.readFileSync(file, 'utf8'), before);
    }
});

test('hygiene: at start and on chunk load, a current-dimension scaffold entry whose cell shows another block is retired; other kinds, dimensions and a dig in progress are not', () => {
    const name = `hygiene${n++}`;
    const world = new F.World();
    for (const x of [1, 2, 3, 4]) world.set(x, 64, 0, 'cobblestone');
    const first = setup({ name, world });
    first.work.ledger.add(entry(1, 'cobblestone', 'scaffold'));
    first.work.ledger.add(entry(2, 'cobblestone', 'scaffold'));
    first.work.ledger.add(entry(3, 'cobblestone', 'own'));
    first.work.ledger.add(entry(4, 'cobblestone', 'scaffold', { dim: 'the_nether' }));
    first.work.dispose();
    for (const x of [1, 3, 4]) world.set(x, 64, 0, 'dirt');                    // changed while she was away
    const agent = setup({ name, world, keep: true });
    assert.deepEqual(entries(agent).map(e => e[0]), [2, 3, 4]);
    assert.ok(agent.logs.some(l => /retired scaffold cobblestone at 1,64,0: at start: now dirt/.test(l)), agent.logs.join('\n'));
    const ledger = agent.work.ledger;
    ledger.add(entry(5, 'cobblestone', 'scaffold'));
    world.set(5, 64, 0, 'cobblestone');
    ledger.beginRemove(at(5, 64, 0));
    world.set(2, 64, 0, 'stone');                                               // no blockUpdate: the column was unloaded
    world.set(5, 64, 0, 'air');
    agent.bot.emit('chunkColumnLoad', at(0, 0, 0));
    assert.deepEqual(entries(agent).map(e => e[0]), [3, 4, 5]);
    assert.ok(agent.logs.some(l => /retired scaffold cobblestone at 2,64,0: chunk loaded: now stone/.test(l)));
});

test('durability: an exit flushes what is dirty, a successful tidy dig included; dispose removes the exit handler', async () => {
    const before = new Set(process.listeners('exit'));
    const world = new F.World();
    world.fill(-3, 63, -3, 6, 63, 3, 'dirt');
    world.set(1, 64, 0, 'cobblestone');
    const agent = setup({ world });
    const [onExit] = process.listeners('exit').filter(l => !before.has(l));
    assert.equal(typeof onExit, 'function');
    const ledger = agent.work.ledger;
    ledger.add(entry(1, 'cobblestone', 'scaffold'));
    ledger.flush();
    assert.deepEqual(F.ledgerEntries(agent).map(e => e.pos.x), [1]);
    agent.bot.entity.position = new F.Vec3(2.5, 64, 2.5);
    assert.equal((await dig.digCell(agent.bot, agent.bot.blockAt(at(1, 64, 0)), { move: false, hand: true })).ok, true);
    assert.equal(ledger.dirty, true);                                          // dirty at once, inside the revert window
    onExit();
    assert.deepEqual(F.ledgerEntries(agent), []);
    agent.work.dispose();
    assert.equal(process.listeners('exit').includes(onExit), false);
});

// --- the component guard (REQ-OWN-4, S2c-fu) -----------------------------------

// Stone ground at y 63; a 2-high pillar of old (gap) cobblestone scaffold at 0,64..65,0.
function oldPillar({ block = 'cobblestone' } = {}) {
    const world = new F.World();
    world.fill(-8, 59, -8, 8, 63, 8, 'stone');
    const agent = setup({ world });
    for (const y of [64, 65]) {
        world.set(0, y, 0, block);
        agent.work.ledger.add({ pos: { x: 0, y, z: 0 }, block, kind: 'scaffold', by: null, dim: 'overworld', at: 1, gap_at: 2 });
    }
    const guarded = (x, y, z) => agent.work.protector.isProtected(agent.bot.blockAt(at(x, y, z)));
    return { agent, world, bot: agent.bot, guarded };
}

test('old scaffold is hers while its component stands free (air, natural terrain, a natural tree, her same-session scaffold); one foreign neighbour lapses the whole component, and it stands free again once that goes', () => {
    const { agent, bot, guarded } = oldPillar();
    assert.deepEqual([guarded(0, 64, 0), guarded(0, 65, 0)], [false, false]);
    F.tree(bot.world, 1, 64, 1, 4);                                              // not a face neighbour
    bot.world.set(-1, 65, 0, 'short_grass');                                     // natural by name
    agent.work.ledger.add(entry(1, 'cobblestone', 'scaffold', { pos: { x: 1, y: 65, z: 0 } }));
    bot.setBlock(1, 65, 0, 'cobblestone');                                       // her scaffold, placed this session
    assert.deepEqual([guarded(0, 64, 0), guarded(0, 65, 0)], [false, false]);
    // D3: an own, building or station neighbour lapses it (owner-kept scaffold is own).
    for (const kind of ['own', 'building', 'station']) {
        agent.work.ledger.add(entry(1, 'oak_planks', kind, { pos: { x: 1, y: 64, z: 0 } }));
        bot.setBlock(1, 64, 0, 'oak_planks');
        assert.deepEqual([kind, guarded(0, 64, 0), guarded(0, 65, 0)], [kind, true, true]);
        bot.setBlock(1, 64, 0, 'air');
        assert.equal(guarded(0, 64, 0), false);
    }
    // S4: whatever its material: kept dirt and stone are not terrain.
    const ledger = agent.work.ledger;
    const eligible = pos => ledger.scaffoldEligible(ledger.get(pos), { gap: e => agent.work.protector.gapHers(e) });
    for (const block of ['dirt', 'stone']) {
        ledger.add(entry(1, block, 'own', { pos: { x: 1, y: 64, z: 0 } }));
        bot.setBlock(1, 64, 0, block);
        assert.deepEqual([block, guarded(0, 64, 0), eligible(at(0, 64, 0))], [block, true, false]);
        bot.setBlock(1, 64, 0, 'air');
    }
    assert.deepEqual([guarded(0, 64, 0), eligible(at(0, 64, 0))], [false, true]);   // her same-session scaffold at 1,65,0 still free
    bot.setBlock(0, 65, 1, 'oak_planks');                                        // the owner's block on the top member
    assert.deepEqual([guarded(0, 64, 0), guarded(0, 65, 0)], [true, true]);      // both lapse: cobblestone is protected
    assert.equal(agent.work.ledger.list().filter(e => e.kind === 'scaffold' && e.gap_at != null).length, 2);   // the records are kept
    bot.setBlock(0, 65, 1, 'air');
    assert.deepEqual([guarded(0, 64, 0), guarded(0, 65, 0)], [false, false]);
});

test('the guard: logs count only through the tree test (a log build lapses it); an unloaded neighbour lapses it; inside an active clear box it is hers; same-session scaffold is not guarded', () => {
    const { agent, bot, guarded } = oldPillar();
    F.tree(bot.world, 1, 64, 0, 4);                                              // a natural trunk beside it
    bot.setBlock(1, 64, 0, 'oak_log', { axis: 'y' });
    assert.equal(guarded(0, 64, 0), false);
    bot.setBlock(-1, 64, 0, 'oak_log', { axis: 'y' });                           // a lone log with no canopy: a build
    assert.equal(guarded(0, 64, 0), true);
    bot.setBlock(-1, 64, 0, 'air');
    assert.equal(guarded(0, 64, 0), false);
    const blockAt = bot.blockAt;
    bot.blockAt = pos => pos.x === 0 && pos.y === 66 && pos.z === 0 ? null : blockAt(pos);
    agent.work.protector.guardMemo = null;
    assert.equal(guarded(0, 64, 0), true);                                       // above the top is not loaded
    bot.blockAt = blockAt;
    bot.setBlock(0, 66, 1, 'oak_planks');
    bot.setBlock(0, 66, 0, 'oak_planks');                                        // foreign, on top
    assert.equal(guarded(0, 65, 0), true);
    const box = { x1: 0, y1: 64, z1: 0, x2: 0, y2: 65, z2: 0 };
    const step = { args: { box, bounds: box, shell: null }, progress: {} };
    const scoped = new protect.Protector(bot, { ledger: agent.work.ledger, scope: () => C.clearScope(step, K.loadWorkConfig()) });
    assert.equal(scoped.isProtected(bot.blockAt(at(0, 65, 0))), false);         // hers inside the box
    assert.equal(scoped.gapHers(agent.work.ledger.get(at(0, 65, 0))), true);
    // Scaffold placed this session (no gap_at) keeps today's rule.
    bot.world.set(3, 64, 3, 'cobblestone');
    bot.setBlock(3, 64, 4, 'oak_planks');
    agent.work.ledger.add(entry(3, 'cobblestone', 'scaffold', { pos: { x: 3, y: 64, z: 3 } }));
    assert.equal(guarded(3, 64, 3), false);
});

test('inside a run the guard does not reuse the run\'s tree memos: planks attached to the tree beside old scaffold lapse it at once (S1)', () => {
    const { agent, bot, guarded } = oldPillar();
    for (let y = 64; y <= 67; y++) bot.world.set(1, y, 0, 'oak_log');
    bot.world.set(1, 68, 0, 'oak_leaves');                                       // a natural canopy (persistent false)
    const protector = agent.work.protector;
    protector.newRun();
    try {
        assert.equal(guarded(0, 64, 0), false);
        assert.equal(protector.isProtected(bot.blockAt(at(1, 65, 0))), false);   // the run memoizes the tree as natural
        bot.setBlock(2, 65, 0, 'oak_planks');                                    // the owner builds onto the tree
        assert.equal(guarded(0, 64, 0), true);
        assert.equal(guarded(0, 65, 0), true);
    } finally {
        protector.endRun();
    }
});

test('the guard memo is dropped on a chunk load and an unload (the ledger generation), not only on a block change', () => {
    const { bot, guarded } = oldPillar();
    const later = Date.now() + 60_000;    // the 50 ms bound out of play: only the generation can drop the memo
    const now = Date.now;
    Date.now = () => later - 59_990;
    try {
        assert.equal(guarded(0, 64, 0), false);
        bot.world.set(1, 64, 0, 'oak_planks');                                   // no blockUpdate: arrives with a column
        assert.equal(guarded(0, 64, 0), false);                                  // memoized
        bot.emit('chunkColumnLoad', at(0, 0, 0));
        assert.equal(guarded(0, 64, 0), true);
        bot.world.set(1, 64, 0, 'air');
        assert.equal(guarded(0, 64, 0), true);                                   // memoized
        bot.emit('chunkColumnUnload', at(16, 0, 16));                            // another column
        assert.equal(guarded(0, 64, 0), false);
    } finally {
        Date.now = now;
    }
});

test('a lapsed dirt pillar is natural (diggable as any dirt) yet not hers to tidy; a component of more than 64 is lapsed; verdicts are memoized until a block change', () => {
    const { agent, bot, guarded } = oldPillar({ block: 'dirt' });
    const ledger = agent.work.ledger;
    const protector = agent.work.protector;
    const eligible = pos => ledger.scaffoldEligible(ledger.get(pos), { gap: e => protector.gapHers(e) });
    assert.equal(eligible(at(0, 64, 0)), true);
    bot.setBlock(1, 64, 0, 'oak_planks');
    assert.deepEqual([guarded(0, 64, 0), eligible(at(0, 64, 0)), eligible(at(0, 65, 0))], [false, false, false]);
    // 64 members stand free, 65 are lapsed.
    for (let x = -32; x < 32; x++) {
        bot.world.set(x, 75, 5, 'cobblestone');
        ledger.add({ pos: { x, y: 75, z: 5 }, block: 'cobblestone', kind: 'scaffold', by: null, dim: 'overworld', at: 1, gap_at: 2 });
    }
    assert.equal(guarded(0, 75, 5), false);
    bot.world.set(32, 75, 5, 'cobblestone');
    ledger.add({ pos: { x: 32, y: 75, z: 5 }, block: 'cobblestone', kind: 'scaffold', by: null, dim: 'overworld', at: 1, gap_at: 2 });
    assert.equal(guarded(0, 75, 5), true);
    // Memo: a second question about the same component reads no block until something changes.
    bot.setBlock(32, 75, 5, 'air');                                              // the 65th goes (retired)
    assert.equal(guarded(-32, 75, 5), false);
    let reads = 0;
    const blockAt = bot.blockAt;
    bot.blockAt = pos => { reads++; return blockAt(pos); };
    assert.equal(protector.standsFree(ledger.get(at(10, 75, 5))), true);
    assert.equal(reads, 0);
    bot.setBlock(-40, 63, -40, 'stone');                                         // any block change
    assert.equal(protector.standsFree(ledger.get(at(10, 75, 5))), true);
    assert.ok(reads > 64, `${reads} reads`);
    bot.blockAt = blockAt;
});
