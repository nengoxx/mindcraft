import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2c, D1 and D3: the clear step (SPEC §11.9, REQ-CLR-1 … 9, REQ-PLAN-4,
// REQ-TRN-14/15) and the owner question (REQ-REC-12) on the real runner,
// ActionManager, modes and handleMessage.
const { plan, config: K, clear: C, skills, pf, work: W } = F.modules;
const CLEAR = C.default;
const agents = [];
const stops = [];
after(() => { stops.forEach(stop => stop()); F.cleanup(agents); });
beforeEach(() => { F.useSettings(); CLEAR.settleMs = 20; CLEAR.waitMs = 20; });

const at = (x, y, z) => new F.Vec3(x, y, z);
const MARKER = 'stripped_spruce_wood';
const WORK = { clear: { marker_radius: 12 } };   // a smaller complete search, for speed
const OWNER_AT = [6, 64, 6];

// A 3x3x3 stone box at x 2..4, y 64..66, z 0..2 on a dirt floor; with markers,
// 8 marker blocks at the corners of the 5x5x5 box around it (x 1..5, y 63..67,
// z -1..3). The bot stands at 0.5,64,1.5, within reach of every cell.
function site({ markers = true, fill = 'stone' } = {}) {
    const world = new F.World();
    world.fill(-6, 62, -6, 10, 63, 8, 'dirt');
    world.fill(2, 64, 0, 4, 66, 2, fill);
    if (markers) for (const x of [1, 5]) for (const y of [63, 67]) for (const z of [-1, 3]) world.set(x, y, z, MARKER);
    return world;
}
const BOX = { x1: 2, y1: 64, z1: 0, x2: 4, y2: 66, z2: 2 };
const BOUNDS = { x1: 1, y1: 63, z1: -1, x2: 5, y2: 67, z2: 3 };

let n = 0;
function setup({ world = site(), inventory = { wooden_pickaxe: 1 }, modes, work = WORK, replies, name, keep = false, init_message = null, drive = true, position = [0.5, 64, 1.5] } = {}) {
    const bot = F.makeBot({ world, inventory, position });
    F.player(bot, F.OWNER, OWNER_AT);
    const agent = F.makeAgent({ bot, modes, work, replies, name: name ?? `clear${n++}` });
    if (!keep) F.clearRecord(agent);
    F.startWork(agent, { init_message });
    agent.work.lineGapMs = 5;    // paced chat lines, faster
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}
function planCtx(world = site(), anchor = { x: OWNER_AT[0], y: OWNER_AT[1], z: OWNER_AT[2], dim: 'overworld' }) {
    const bot = F.makeBot({ world });
    return { bot, owner: F.OWNER, config: K.loadWorkConfig(WORK), anchor };
}
const status = agent => agent.work.record?.status;
// Blocked on an owner question means: asked, and armed (every line posted).
const asking = agent => agent.work.record?.reason !== 'awaiting_owner' || agent.work.armed === agent.work.record.pending_question?.id;
const until = (agent, s) => F.until(() => status(agent) === s && (s !== 'blocked' || asking(agent)), { timeout: 10000 });
const digs = bot => bot.calls.filter(c => c[0] === 'dig');
const cellsLeft = (world, box = BOX) => {
    let left = 0;
    for (let x = box.x1; x <= box.x2; x++) for (let y = box.y1; y <= box.y2; y++) for (let z = box.z1; z <= box.z2; z++)
        if (world.block(at(x, y, z)).name !== 'air') left++;
    return left;
};
const step = agent => agent.work.record.plan[agent.work.record.cursor];

// --- validation (REQ-CLR-1 … 3) ------------------------------------------------

test('both DSL forms validate and freeze box, bounds, shell, markers and cells', () => {
    const ctx = planCtx();
    const keep = plan.planFromText(ctx, `clear markers=${MARKER}`);
    assert.deepEqual(keep.errors, []);
    assert.deepEqual(keep.steps[0].args, { markers: MARKER, box: BOX, bounds: BOUNDS, shell: 'keep', cells: 27 });
    const whole = plan.planFromText(ctx, `clear markers=${MARKER} shell=clear`);
    assert.deepEqual(whole.steps[0].args, { markers: MARKER, box: BOUNDS, bounds: BOUNDS, shell: 'clear', cells: 125 });
    const box = plan.planFromText(ctx, 'clear box=4,66,2:2,64,0');           // corners in any order
    assert.deepEqual(box.steps[0].args, { box: BOX, bounds: BOX, shell: null, markers: null, cells: 27 });
});

test('every clear validation error (REQ-CLR-3), each naming its step', () => {
    const world = site();
    for (const p of [[7, 64, 10], [9, 64, 10], [7, 66, 12]]) world.set(...p, 'emerald_block');                         // 3 markers
    for (const [x, z] of [[8, -4], [8, -2], [9, -4], [9, -2]]) world.set(x, 64, z, 'gold_block');                       // 4 on a plane
    for (const p of [[-5, 64, 4], [-3, 64, 4], [-5, 66, 6], [-3, 66, 6], [-4, 64, 6]]) world.set(...p, 'diamond_block'); // one off a corner
    for (const x of [7, 8]) for (const y of [64, 66]) for (const z of [4, 6]) world.set(x, y, z, 'lapis_block');        // 2x3x3: no inside
    const ctx = planCtx(world);
    const cases = [
        ['clear box=1,2,3:4,5,6 markers=stone', 'step 1: give box=… or markers=…, not both'],
        ['clear', "step 1: missing key 'box' or 'markers'"],
        ['clear box=1,2:3,4,5', "step 1: bad box '1,2:3,4,5' (use x1,y1,z1:x2,y2,z2)"],
        ['clear box=1,2,3', "step 1: bad box '1,2,3' (use x1,y1,z1:x2,y2,z2)"],
        ['clear box=1.5,2,3:4,5,6', "step 1: bad box '1.5,2,3:4,5,6' (use x1,y1,z1:x2,y2,z2)"],
        ['clear box=-10,40,-10:30,80,30', 'step 1: the box has 68921 cells; at most 32768'],
        ['clear box=200,64,0:201,65,1', 'step 1: the box is 194 blocks away; at most 64'],
        ['clear markers=netherite_block', 'step 1: no netherite_block within 12 blocks to mark the box (name the marker block, or give the box as x1,y1,z1:x2,y2,z2)'],
        ['clear markers=emerald_block', 'step 1: found 3 emerald_block within 12 blocks; a marked box needs at least 4, on three axes; give the box as x1,y1,z1:x2,y2,z2'],
        ['clear markers=gold_block', 'step 1: found 4 gold_block within 12 blocks; a marked box needs at least 4, on three axes; give the box as x1,y1,z1:x2,y2,z2'],
        ['clear markers=diamond_block', 'step 1: 5 diamond_block within 12 blocks do not mark the corners of one box (-4,64,6 is not a corner); give the box as x1,y1,z1:x2,y2,z2'],
        ['clear markers=lapis_block', 'step 1: the marked box has no inside (2×3×3); use shell=clear'],
        ['clear markers=unobtainium', "step 1: unknown item or block 'unobtainium'"],
        ['clear markers=stick', "step 1: unknown item or block 'stick'"],
        ['clear box=1,2,3:4,5,6 shell=keep', 'step 1: shell= goes with markers=, not box='],
        [`clear markers=${MARKER} shell=half`, "step 1: unknown shell 'half' (use keep or clear)"],
        ['clear box=1,2,3:4,5,6 colour=red', "step 1: unknown key 'colour' for clear"],
    ];
    for (const [text, expected] of cases) {
        const { steps, errors } = plan.planFromText(ctx, text);
        assert.equal(steps.length, 0, text);
        assert.ok(errors.some(e => e.startsWith(expected)), `${JSON.stringify(text)} -> ${JSON.stringify(errors)}`);
    }
    // A marked box with shell=clear needs no inside; caps apply to the cells to clear.
    assert.deepEqual(plan.planFromText(ctx, 'clear markers=lapis_block shell=clear').errors, []);
    // The marker errors say when part of the search was not loaded.
    const partial = planCtx(world);
    const blockAt = partial.bot.blockAt;
    partial.bot.blockAt = pos => pos.y > 74 ? null : blockAt(pos);
    assert.match(plan.planFromText(partial, 'clear markers=netherite_block').errors[0], /\(part of the range is not loaded\)$/);
});

test('the corner test passes 4 markers on three axes that leave an inside, and the search is complete (never findBlocks)', () => {
    const world = new F.World();
    for (const p of [[1, 63, -1], [5, 63, 3], [1, 67, 3], [5, 67, -1]]) world.set(...p, MARKER);
    const ctx = planCtx(world);
    ctx.bot.findBlocks = () => [];   // findBlocks misses blocks inside its radius (SPEC §4.1)
    const { steps, errors } = plan.planFromText(ctx, `clear markers=${MARKER}`);
    assert.deepEqual(errors, []);
    assert.deepEqual([steps[0].args.bounds, steps[0].args.box], [BOUNDS, BOX]);
});

test('work.clear merges one level deep: one sub-key keeps the other defaults; the retired junk keys are ignored', () => {
    const config = K.loadWorkConfig({ clear: { max_cells: 1000, colour: 'red' }, junk_keep: { dirt: 8 }, junk_items: ['dirt'], ledger_max: 50 });
    assert.equal(config.clear.max_cells, 1000);
    assert.equal(config.clear.max_distance, 64);
    assert.equal(config.clear.marker_radius, 32);
    assert.ok(config.clear.containers.includes('chest') && config.clear.containers.includes('lime_shulker_box'));
    assert.deepEqual(config.clear.never_remove, ['spawner']);
    assert.equal('colour' in config.clear, false);
    assert.equal('junk_keep' in config, false);   // S2e: replaced by work.inventory
    assert.equal('junk_items' in config, false);
    assert.equal(config.ledger_max, 50);
    assert.equal(K.loadWorkConfig().ledger_max, 2000);
});

// --- running (REQ-CLR-4 … 8) -----------------------------------------------------

test('a markers= box is stated and cleared at once: top-down, nearest first, at most 16 digs a unit, no model call; the markers stay', async () => {
    const agent = setup();
    const { bot } = agent;
    const perUnit = [];
    const unit = CLEAR.unit;
    CLEAR.unit = async function (ctx, s) { const before = digs(bot).length; const r = await unit.call(this, ctx, s); perUnit.push(digs(bot).length - before); return r; };
    try {
        const started = agent.work.startTask('clear the cube', `clear markers=${MARKER}`);
        // REQ-CHAT-1: a markers= box statement is its own part of the result (an `alert` line).
        assert.deepEqual([started.message, started.statement], ['Task started: "clear the cube" (1 step).',
            'Clearing x 2..4, y 64..66, z 0..2: 27 cells inside the marked box; its outer layer stays.']);
        await until(agent, 'done');
    } finally {
        CLEAR.unit = unit;
    }
    assert.equal(cellsLeft(bot.world), 0);
    const ys = digs(bot).map(c => Number(c[2].split(', ')[1]));
    assert.deepEqual(ys, [...ys].sort((a, b) => b - a));                 // never a lower layer before a higher one
    assert.equal(digs(bot)[0][2], '(2, 66, 1)');                         // the nearest cell of the top layer first
    assert.equal(Math.max(...perUnit), 16);
    assert.equal(bot.world.block(at(1, 63, -1)).name, MARKER);
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.work.record.plan[0].result, '27/27 cells empty');
    await F.until(() => agent.chats.some(c => /Task done: "clear the cube"\. 1\. clear stripped_spruce_wood markers \(x 2\.\.4, y 64\.\.66, z 0\.\.2\): 27\/27 cells empty/.test(c)));
});

test('a box= box is stated and waits for the owner\'s yes with no dig before it; a no cancels it as owner_declined with nothing dug', async () => {
    for (const answer of ['yes', 'no']) {
        const agent = setup({ world: site({ markers: false }) });
        const { bot } = agent;
        const started = agent.work.startTask('clear the box', 'clear box=2,64,0:4,66,2');
        assert.match(started.message, /Clearing x 2\.\.4, y 64\.\.66, z 0\.\.2: 27 cells\.$/);
        await until(agent, 'blocked');
        const record = agent.work.record;
        assert.equal(record.reason, 'awaiting_owner');
        assert.deepEqual([record.pending_question.kind, record.pending_question.text, record.pending_question.options],
            ['clear_start', 'Clearing x 2..4, y 64..66, z 0..2: 27 cells. Clear it? yes / no', ['yes', 'no']]);
        await F.sleep(50);
        assert.deepEqual(digs(bot), []);
        assert.ok(agent.chats.includes('Clearing x 2..4, y 64..66, z 0..2: 27 cells. Clear it? yes / no'));
        await F.ownerSays(agent, answer);
        if (answer === 'no') {
            assert.deepEqual([status(agent), agent.work.record.reason], ['cancelled', 'owner_declined']);
            await F.sleep(50);
            assert.deepEqual(digs(bot), []);
        } else {
            await until(agent, 'done');
            assert.equal(cellsLeft(bot.world), 0);
        }
        assert.equal(agent.modelCalls, 0);
    }
});

// I1-16 (DECISIONS 2026-11-14): task-command lines go through the one owner-output queue (REQ-REC-12).
test('I1-16: the owner\'s !taskStart line and the box question after it are paced by the one queue', async () => {
    const agent = setup({ world: site({ markers: false }) });
    agent.work.lineGapMs = 150;
    const sent = [];
    agent.openChat = message => { sent.push({ message, at: Date.now() }); agent.chats.push(message); };
    await F.ownerSays(agent, '!taskStart("clear the box", "clear box=2,64,0:4,66,2")');
    await until(agent, 'blocked');
    const start = sent.find(s => /^Task started/.test(s.message));
    const question = sent.find(s => /Clear it\? yes \/ no$/.test(s.message));
    assert.ok(start && question, sent.map(s => s.message).join('\n'));
    assert.ok(question.at - start.at >= 140, `${question.at - start.at} ms apart`);
});

test('ungranted containers and the spawner are never candidates; a buried ore inside the box is dug', async () => {
    const world = site();
    world.set(3, 65, 1, 'coal_ore');      // buried in the middle of the stone
    world.set(2, 64, 0, 'chest');
    world.set(4, 64, 2, 'furnace');       // a station furnace is a container like any other
    world.set(4, 64, 0, 'spawner');
    const agent = setup({ world });
    agent.work.ledger.add({ pos: { x: 4, y: 64, z: 2 }, block: 'furnace', kind: 'station', by: null, dim: 'overworld', at: 1 });
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    const dug = digs(agent.bot).map(c => c[1]);
    assert.ok(dug.includes('coal_ore'));
    assert.equal(dug.some(name => ['chest', 'furnace', 'spawner'].includes(name)), false);
    const q = agent.work.record.pending_question;
    assert.equal(q.kind, 'clear_leftovers');
    assert.deepEqual(q.containers.map(c => c.block).sort(), ['chest', 'furnace']);
    assert.doesNotMatch(q.text, /spawner/);
    await F.ownerSays(agent, 'no');
    await until(agent, 'done');
    assert.equal(agent.work.record.plan[0].result, '24/27 cells empty; left: 1 spawner (never removed), 1 chest (a container, kept), 1 furnace (a container, kept)');
});

test('the kept outer layer is protected for every caller while the clear step runs, and the clear movements exclude it', async () => {
    const agent = setup({ position: [-6.5, 64, 1.5] });   // out of reach: the first dig approaches
    const { bot } = agent;
    let movements = null;
    let release = null;
    bot.hooks.goto = async () => {
        movements = bot.pathfinder.movements;
        await new Promise(resolve => { release = resolve; });
        bot.entity.position = new F.Vec3(0.5, 64, 1.5);
        return 'moved';
    };
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await F.until(() => movements);
    const shell = bot.blockAt(at(3, 63, 1));               // the dirt floor is part of the kept layer
    const inside = bot.blockAt(at(3, 64, 1));
    const outside = bot.blockAt(at(-2, 63, 1));
    const fresh = new pf.Movements(bot);
    assert.equal(fresh.safeToBreak(shell), false);         // modes and collection never dig it either
    assert.equal(fresh.safeToBreak(inside), true);
    assert.equal(await skills.breakBlockAt(bot, 3, 63, 1), false);
    assert.equal(movements.exclusionBreak(shell), 100);
    assert.equal(movements.exclusionBreak(outside), 100);  // non-destructive outside the box
    assert.equal(movements.exclusionBreak(inside), 0);
    assert.notEqual(movements.getNeighbors, pf.Movements.prototype.getNeighbors);   // the placement filter (next test)
    release();
    await until(agent, 'done');
    assert.equal(bot.world.block(at(3, 63, 1)).name, 'dirt');
    assert.equal(new pf.Movements(bot).safeToBreak(bot.blockAt(at(3, 63, 1))), true);  // outside the step it is plain dirt
});

test('no move the installed pathfinder generates places into the kept layer: a forward bridge is filtered by its real destination', () => {
    const world = new F.World();
    world.fill(-6, 62, -6, 10, 63, 8, 'dirt');
    world.set(3, 63, 1, 'air');                            // a hole in the kept floor, beside the bot's cell
    const bot = F.makeBot({ world, position: [2.5, 64, 1.5] });
    const step = { args: { box: BOX, bounds: BOUNDS, shell: 'keep' }, progress: {} };
    const scope = C.clearScope(step, K.loadWorkConfig(WORK));
    const node = { x: 2, y: 64, z: 1, remainingBlocks: 10 };
    const dests = moves => moves.flatMap(m => m.toPlace.filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`));
    const plain = new pf.Movements(bot);
    assert.ok(dests(plain.getNeighbors(node)).includes('3,63,1'));   // the bridge exists: getMoveForward places below the feet cell
    assert.equal(plain.exclusionAreasPlace.length, 0);
    const m = new pf.Movements(bot);
    C.clearMovements(scope)(m);
    const placed = dests(m.getNeighbors(node));
    assert.equal(placed.some(d => scope.inShell(at(...d.split(',').map(Number)))), false);
    assert.ok(placed.includes('2,64,1'));                  // a pillar inside the box stays allowed
});

test('when only cells under the bot are left, it moves to a cleared cell first; a player on a cell is never dug from under him', async () => {
    const world = site({ markers: false });
    world.fill(2, 65, 0, 4, 66, 2, 'air');                 // one layer, y 64
    const agent = setup({ world, position: [3.5, 65, 1.5] });   // standing on 3,64,1
    const { bot } = agent;
    bot.players[F.OWNER].entity.position = new F.Vec3(2.5, 65, 0.5);   // the owner stands on 2,64,0
    agent.work.startTask('clear', 'clear box=2,64,0:4,64,2');
    await until(agent, 'blocked');
    await F.ownerSays(agent, 'yes');
    await F.until(() => cellsLeft(bot.world, { ...BOX, y2: 64 }) === 1, { timeout: 5000 });
    assert.ok(bot.calls.some(c => c[0] === 'goto' && c[1] === 'GoalBlock'));
    await F.sleep(100);
    assert.equal(bot.world.block(at(2, 64, 0)).name, 'stone');   // still under the owner
    assert.equal(status(agent), 'active');
    bot.players[F.OWNER].entity.position = new F.Vec3(...OWNER_AT);
    await until(agent, 'done');
    assert.equal(cellsLeft(bot.world, { ...BOX, y2: 64 }), 0);
});

// I1-4 (DECISIONS 2026-11-14): one empty-block test (air, cave air, void air) for every module.
test('I1-4: a box in a cave (cave_air above it) steps off and completes', async () => {
    const world = site({ markers: false });
    world.fill(2, 65, 0, 4, 66, 2, 'air');                 // one layer, y 64
    world.fill(-6, 65, -6, 10, 67, 8, 'cave_air');         // in a cave: cave air above the layer
    const agent = setup({ world, position: [3.5, 65, 1.5] });   // standing on 3,64,1
    const { bot } = agent;
    agent.work.startTask('clear', 'clear box=2,64,0:4,64,2');
    await until(agent, 'blocked');
    await F.ownerSays(agent, 'yes');
    await until(agent, 'done');
    assert.ok(bot.calls.some(c => c[0] === 'goto' && c[1] === 'GoalBlock'));
    assert.equal(cellsLeft(bot.world, { ...BOX, y2: 64 }), 0);
});

test('I1-4: the soft refusal (only the cell under her is left, none cleared to stand in) records its cause', async () => {
    const world = site({ markers: false });
    world.fill(2, 65, 0, 4, 66, 2, 'air');
    const agent = setup({ world, position: [3.5, 65, 1.5] });
    agent.work.startTask('clear', 'clear box=3,64,1:3,64,1');   // the one cell she stands on
    await until(agent, 'blocked');
    await F.ownerSays(agent, 'yes');
    await F.until(() => step(agent).progress.last_cause === 'only cells under me are left and no cleared cell of the box to stand in', { timeout: 5000 });
    assert.equal(agent.bot.world.block(at(3, 64, 1)).name, 'stone');
});

test('a tool is obtained inline when nothing held can harvest the next cell', async () => {
    const agent = setup({ inventory: { crafting_table: 1, oak_planks: 3, stick: 2 } });
    const { bot } = agent;
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'done');
    assert.ok(bot.calls.some(c => c[0] === 'craft' && c[1] === 'wooden_pickaxe'));
    assert.equal(bot.count('wooden_pickaxe'), 1);
    assert.equal(cellsLeft(bot.world), 0);
    assert.equal(agent.work.record.plan[0].progress.tool, null);
});

test('done only after a settled second scan agrees; the report comes from the final scan', async () => {
    const world = site();
    world.set(2, 64, 0, 'water');                          // a liquid counts as empty
    const agent = setup({ world });
    const { bot } = agent;
    CLEAR.settleMs = 100;
    let count = 0;
    bot.hooks.dig = () => { if (++count === 24) setTimeout(() => bot.world.set(4, 64, 2, 'gravel'), 30); };   // falls in after the last dig
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'done');
    assert.ok(digs(bot).some(c => c[1] === 'gravel' && c[2] === '(4, 64, 2)'));
    // Beside the water: refused twice, then left (dontCreateFlow).
    assert.equal(agent.work.record.plan[0].result, '25/27 cells empty; left: 2 next to water');
    assert.deepEqual(Object.values(agent.work.record.plan[0].progress.failures).map(f => f.n), [2, 2]);
});

test('a clear resumes with no model call after a mode interrupt and after a crash restart', async () => {
    const agent = setup({ modes: { self_defense: true } });
    const { bot } = agent;
    let count = 0;
    bot.hooks.dig = async () => {
        if (++count !== 5) return;
        F.hostile(bot, 'zombie', [-3, 0, 0]);
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
    };
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'done');
    assert.equal(agent.modelCalls, 0);
    assert.equal(agent.work.record.interruptions.last.by, 'mode:self_defense');
    assert.equal(cellsLeft(bot.world), 0);

    const world = site();
    const name = `clearcrash${n++}`;
    const first = setup({ world, name });
    let dug = 0;
    first.bot.hooks.dig = async () => { if (++dug === 5) await F.until(() => first.bot.interrupt_code, { timeout: 60000 }); };
    first.work.startTask('clear', `clear markers=${MARKER}`);
    await F.until(() => dug === 5);
    first.work.dispose();                                   // the process dies mid-dig
    first.bot.interrupt_code = true;
    const restarted = setup({ world, name, keep: true, init_message: W.RESTART_MESSAGE });
    await until(restarted, 'done');
    assert.equal(restarted.modelCalls, 0);
    assert.equal(cellsLeft(world), 0);
});

// --- the owner question (REQ-REC-12, REQ-CLR-9) -----------------------------------

test('one question: for leftovers, for containers, or both; asked with no model call', async () => {
    const variants = {
        leftovers: [['cobblestone', 3, 65, 1], ['cobblestone', 2, 66, 0], ['oak_planks', 4, 64, 2]],
        containers: [['chest', 3, 64, 1]],
        both: [['cobblestone', 3, 65, 1], ['barrel', 3, 64, 1]],
    };
    const texts = {};
    for (const [variant, blocks] of Object.entries(variants)) {
        const world = site();
        for (const [name, ...p] of blocks) world.set(...p, name);
        const agent = setup({ world });
        agent.work.startTask('clear', `clear markers=${MARKER}`);
        await until(agent, 'blocked');
        const q = agent.work.record.pending_question;
        texts[variant] = q.text;
        assert.equal(agent.work.record.reason, 'awaiting_owner');
        assert.equal(q.kind, 'clear_leftovers');
        assert.equal(agent.modelCalls, 0);
        await F.until(() => q.text.split('\n').every(line => agent.chats.includes(line)));   // to the owner directly, a line a message
    }
    assert.equal(texts.leftovers, '24 of 27 cells are empty. 3 blocks are left that are not natural and not in my records: ' +
        'cobblestone 2 (one at 2,66,0), oak_planks 1 (at 4,64,2). Remove them too? Answer yes or no.');
    assert.equal(texts.containers, "26 of 27 cells are empty.\nAlso inside: chest at 3,64,1; their contents would drop; say 'yes, chests too' to remove them, or no to keep them.");
    assert.equal(texts.both, '25 of 27 cells are empty. 1 block is left that is not natural and not in my records: cobblestone 1 (at 3,65,1). Remove it too? Answer yes or no.' +
        "\nAlso inside: barrel at 3,64,1; their contents would drop; say 'yes, chests too' to remove them.");
});

async function asked(blocks, extra = {}) {
    const world = site();
    for (const [name, ...p] of blocks) world.set(...p, name);
    const agent = setup({ world, ...extra });
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    return agent;
}

test('the answer is consumed before the model; other owner chat goes to the model and the question stays; no timeout; !taskResume is refused while it is open', async () => {
    const c = F.clock();
    const agent = await asked([['cobblestone', 3, 65, 1]], { replies: ['I am waiting for your answer.', '!taskResume'] });
    await F.ownerSays(agent, 'what are you doing?');
    assert.equal(agent.modelCalls, 1);
    assert.ok(agent.work.record.pending_question);
    // The model's !taskResume and the owner's alike.
    await F.ownerSays(agent, 'go on then');
    assert.equal(agent.modelCalls, 3);   // the refusal goes back to the model, as any command result does
    assert.ok(agent.turns.some(t => /!taskResume refused: waiting for the owner's yes or no; only the owner can answer/.test(t.content)));
    await F.ownerSays(agent, '!taskResume');
    assert.ok(agent.chats.some(m => /!taskResume refused: waiting for the owner's yes or no/.test(m)));
    // Someone else's yes does not answer it.
    await F.ownerSays(agent, 'yes', 'alex');
    assert.equal(status(agent), 'blocked');
    // No timeout: an hour of ticks changes nothing.
    agent.work.now = c.now;
    for (let i = 0; i < 4; i++) { c.advance(900); agent.work.tick(); }
    assert.deepEqual([status(agent), agent.work.record.reason], ['blocked', 'awaiting_owner']);
    // The view tells the model only the owner can answer.
    assert.match(agent.work.view(), /Waiting for the owner's answer; only the owner can answer, so do not answer it or use !taskResume\. The question: "26 of 27/);
    agent.work.now = Date.now;
    await F.until(() => asking(agent));    // posted again after the bot's other words
    const calls = agent.modelCalls;
    const turns = agent.turns.length;
    await F.ownerSays(agent, 'Yes.');
    assert.equal(agent.modelCalls, calls);
    assert.equal(agent.turns.some((t, i) => i >= turns && t.content === 'Yes.'), false);   // never in history as a chat turn
    await F.until(() => agent.turns.some(t => /^Asked the owner: "26 of 27 cells are empty\..*" The owner answered: yes\.$/s.test(t.content)));
    await until(agent, 'done');
    assert.equal(agent.modelCalls, calls);
});

test('a revision that keeps the asking step leaves the question open; one that replaces it drops the question', async () => {
    const agent = setup({ world: site({ markers: false }) });
    agent.work.startTask('clear, then come back', 'clear box=2,64,0:4,66,2; go_to target=0,64,1');
    await until(agent, 'blocked');
    const kept = await agent.work.reviseTask(2, 'go_to target=0,64,2');
    assert.match(kept.message, /Still waiting for the owner's yes or no/);
    assert.deepEqual([status(agent), agent.work.record.pending_question?.kind], ['blocked', 'clear_start']);
    await F.sleep(50);
    assert.deepEqual(digs(agent.bot), []);
    await agent.work.reviseTask(1, 'clear box=2,64,0:4,64,2');
    await until(agent, 'blocked');                               // the new box= step asks its own question
    assert.match(agent.work.record.pending_question.text, /: 9 cells\. Clear it\? yes \/ no$/);
    assert.deepEqual(digs(agent.bot), []);
});

test('a plain yes removes the listed blocks but no container; a no keeps them and the step ends', async () => {
    const yes = await asked([['cobblestone', 3, 65, 1], ['oak_planks', 2, 66, 0], ['chest', 3, 64, 1]]);
    await F.ownerSays(yes, 'yes');
    await until(yes, 'done');
    assert.equal(yes.bot.world.block(at(3, 65, 1)).name, 'air');
    assert.equal(yes.bot.world.block(at(2, 66, 0)).name, 'air');
    assert.equal(yes.bot.world.block(at(3, 64, 1)).name, 'chest');
    assert.equal(yes.work.record.plan[0].result, '26/27 cells empty; left: 1 chest (a container, kept)');

    const no = await asked([['cobblestone', 3, 65, 1], ['chest', 3, 64, 1]]);
    await F.ownerSays(no, 'no');
    await until(no, 'done');
    assert.equal(no.bot.world.block(at(3, 65, 1)).name, 'cobblestone');
    assert.equal(no.work.record.plan[0].result, '25/27 cells empty; left: 1 not natural and not in my records (kept, as you said), 1 chest (a container, kept)');
});

test('"yes, chests too" removes the listed containers through the position-scoped exception; the liquid, falling-block and occupancy checks still refuse', async () => {
    const world = site();
    world.set(4, 64, 1, 'water');                 // inside the box: counts as empty
    world.set(2, 65, 1, 'chest');                 // a plain chest (blocksCantBreak without the exception)
    world.set(4, 64, 0, 'chest');                 // beside the water
    world.set(2, 66, 0, 'chest');                 // under sand
    world.set(2, 67, 0, 'sand');                  // above the box: the kept layer
    world.set(4, 66, 2, 'trapped_chest');         // the owner stands on it
    const agent = setup({ world });
    agent.bot.players[F.OWNER].entity.position = new F.Vec3(4.5, 67, 2.5);
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    assert.equal(agent.work.record.pending_question.containers.length, 4);
    await F.ownerSays(agent, 'yes, chests too');
    await F.until(() => world.block(at(2, 65, 1)).name === 'air', { timeout: 5000 });
    await F.sleep(150);
    assert.equal(world.block(at(4, 66, 2)).name, 'trapped_chest');   // not from under the owner
    agent.bot.players[F.OWNER].entity.position = new F.Vec3(...OWNER_AT);
    await until(agent, 'done');
    assert.equal(world.block(at(4, 66, 2)).name, 'air');
    assert.equal(world.block(at(4, 64, 0)).name, 'chest');
    assert.equal(world.block(at(2, 66, 0)).name, 'chest');
    // The chest and the two stone cells beside the water, and the chest under the sand.
    assert.equal(agent.work.record.plan[0].result, '23/27 cells empty; left: 3 next to water, 1 under a falling block');
});

test('a grant resets the failure counts of its positions; a block changed since the question is not dug', async () => {
    const agent = await asked([['cobblestone', 3, 65, 1], ['cobblestone', 2, 66, 0]]);
    const s = step(agent);
    // A cell refused earlier (once) counts again from zero after the grant.
    s.progress.failures['3,65,1'] = { n: 1, reason: 'protected' };
    agent.bot.world.set(2, 66, 0, 'oak_planks');  // changed since the question
    await F.ownerSays(agent, 'yes');
    assert.equal(step(agent).progress.failures['3,65,1'], undefined);
    await until(agent, 'done');
    assert.equal(agent.bot.world.block(at(3, 65, 1)).name, 'air');
    assert.equal(agent.bot.world.block(at(2, 66, 0)).name, 'oak_planks');
    assert.equal(agent.work.record.plan[0].result, '26/27 cells empty; left: 1 not natural and not in my records');
});

test('inside an active clear box the bot\'s own and scaffold entries are ordinary cells (REQ-OWN-11)', async () => {
    const world = site();
    world.set(3, 65, 1, 'oak_planks');
    world.set(2, 64, 0, 'cobblestone');
    const agent = setup({ world });
    agent.work.ledger.add({ pos: { x: 3, y: 65, z: 1 }, block: 'oak_planks', kind: 'own', by: 'action:newAction', dim: 'overworld', at: 1 });
    agent.work.ledger.add({ pos: { x: 2, y: 64, z: 0 }, block: 'cobblestone', kind: 'scaffold', by: 'action:task', dim: 'overworld', at: 1 });
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'done');
    assert.equal(cellsLeft(world), 0);
    assert.equal(agent.work.ledger.get(at(3, 65, 1)), null);
    assert.equal(agent.work.ledger.get(at(2, 64, 0)), null);
});

// --- review round 1 (fix wave 1) ---------------------------------------------------

test('the container default covers every item-holding family of the 26.1 registry; unrecorded and own ones alike are asked about, never dug', async () => {
    const containers = new Set(K.loadWorkConfig().clear.containers);
    const family = /^(?:(?:waxed_)?(?:exposed_|weathered_|oxidized_)?copper_chest|(?:trapped_)?chest|barrel|(?:\w+_)?shulker_box|hopper|dropper|dispenser|(?:blast_)?furnace|smoker|brewing_stand|crafter|lectern|chiseled_bookshelf|\w+_shelf|decorated_pot|jukebox|(?:soul_)?campfire|suspicious_(?:sand|gravel))$/;
    const inRegistry = Object.keys(F.registry.blocksByName).filter(name => family.test(name));
    assert.equal(inRegistry.length, 56);
    assert.deepEqual(inRegistry.filter(name => !containers.has(name)), []);
    assert.deepEqual([...containers].filter(name => !F.registry.blocksByName[name]), []);   // no misspelt name
    const world = site();
    world.set(3, 64, 1, 'copper_chest');           // unrecorded
    world.set(2, 64, 0, 'waxed_oxidized_copper_chest');
    world.set(4, 64, 2, 'oak_shelf');
    world.set(2, 64, 2, 'soul_campfire');
    world.set(4, 64, 0, 'chest');                  // the bot's own, inside the box
    const agent = setup({ world });
    agent.work.ledger.add({ pos: { x: 4, y: 64, z: 0 }, block: 'chest', kind: 'own', by: 'action:newAction', dim: 'overworld', at: 1 });
    agent.work.ledger.add({ pos: { x: 2, y: 64, z: 0 }, block: 'waxed_oxidized_copper_chest', kind: 'own', by: 'action:newAction', dim: 'overworld', at: 1 });
    let checked = null;
    agent.bot.hooks.dig = () => {
        // While the clear runs, a kept container is protected for every caller,
        // the bot's own (ledger-exempt in the box) and not in blocksCantBreak included (M03).
        checked ??= new pf.Movements(agent.bot).safeToBreak(agent.bot.blockAt(at(2, 64, 0)));
    };
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    assert.equal(checked, false);
    assert.deepEqual(agent.work.record.pending_question.containers.map(c => c.block).sort(),
        ['chest', 'copper_chest', 'oak_shelf', 'soul_campfire', 'waxed_oxidized_copper_chest']);
    assert.equal(digs(agent.bot).some(c => containers.has(c[1])), false);
    await F.ownerSays(agent, 'yes');
    await until(agent, 'done');
    assert.equal(digs(agent.bot).some(c => containers.has(c[1])), false);
});

test('right before the dig every check runs again: a replacement, a stop or a dimension change during a slow equip gets no dig', async () => {
    for (const change of ['replaced', 'stopped', 'dimension']) {
        const world = new F.World();
        world.set(1, 64, 0, 'dirt');
        const bot = F.makeBot({ world });
        const agent = F.makeAgent({ bot, name: `equip${n++}` });
        F.clearRecord(agent);
        F.startWork(agent);
        agents.push(agent);
        bot.tool.equipForBlock = async () => {
            await F.sleep(10);
            if (change === 'replaced') world.set(1, 64, 0, 'chest');
            if (change === 'stopped') bot.interrupt_code = true;
            if (change === 'dimension') bot.game.dimension = 'the_nether';
        };
        const result = await F.modules.dig.digCell(bot, bot.blockAt(at(1, 64, 0)), { move: false, hand: true, dim: 'overworld' });
        assert.deepEqual([result.ok, result.reason, result.soft], [false, { replaced: 'changed', stopped: 'interrupted', dimension: 'in another dimension' }[change], true]);
        assert.deepEqual(digs(bot), [], change);
    }
});

test('safeToBreak keeps blocksCantBreak for every block but a granted container (M04)', () => {
    const world = new F.World();
    world.set(1, 64, 0, 'bedrock');                // natural, so only blocksCantBreak refuses it
    world.set(2, 64, 0, 'chest');
    const bot = F.makeBot({ world });
    assert.equal(F.modules.dig.safetyReason(bot, bot.blockAt(at(1, 64, 0))), 'cannot be broken');
    assert.equal(F.modules.dig.safetyReason(bot, bot.blockAt(at(2, 64, 0)), { container: true }), null);
    assert.equal(F.modules.dig.safetyReason(bot, bot.blockAt(at(1, 64, 0))), 'cannot be broken');   // the lift was undone
});

test('inside an active box a buried ore is no protected block, outside it one is (M23)', () => {
    const world = new F.World();
    world.fill(0, 60, 0, 12, 68, 4, 'stone');
    world.set(3, 65, 1, 'coal_ore');               // inside BOX, stone on every face
    world.set(9, 65, 1, 'coal_ore');               // outside it
    const bot = F.makeBot({ world });
    const step = { args: { box: BOX, bounds: BOUNDS, shell: 'keep' }, progress: {} };
    const p = new F.modules.protect.Protector(bot, { scope: () => C.clearScope(step, K.loadWorkConfig()) });
    p.newRun();
    assert.equal(p.isProtected(bot.blockAt(at(3, 65, 1))), false);
    assert.equal(p.isProtected(bot.blockAt(at(9, 65, 1))), true);
});

test('a completed build\'s block stays protected in the box even at a granted position', () => {
    const world = new F.World();
    world.set(2, 64, 0, 'oak_planks');
    const bot = F.makeBot({ world });
    const step = { args: { box: BOX, bounds: BOUNDS, shell: 'keep' }, progress: { granted: { '2,64,0': 'oak_planks' } } };
    const ledger = { building: null, get: () => ({ pos: { x: 2, y: 64, z: 0 }, block: 'oak_planks', kind: 'building', build_id: 'b1', dim: 'overworld' }), retire() {} };
    const p = new F.modules.protect.Protector(bot, { ledger, scope: () => C.clearScope(step, K.loadWorkConfig()) });
    assert.equal(p.isProtected(bot.blockAt(at(2, 64, 0))), true);
    ledger.building = 'b1';                         // while its own build runs it is exempt
    assert.equal(p.isProtected(bot.blockAt(at(2, 64, 0))), false);
});

test('the box is bound to the task\'s dimension: in another one nothing is dug and the step waits with no model call; back home it finishes', async () => {
    const agent = setup();
    const { bot } = agent;
    let count = 0;
    const blockAt = bot.blockAt;
    let best = null;
    bot.hooks.dig = () => {
        if (++count !== 3) return;
        best = agent.work.record.plan[0].progress.best;
        bot.game.dimension = 'the_nether';
        const nether = new F.World();
        bot.blockAt = pos => nether.block(pos);  // another place: the same coordinates are air there
    };
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await F.until(() => agent.work.record.plan[0].progress?.last_cause === 'the box is in overworld; I am in the_nether');
    await F.sleep(300);                        // it keeps waiting: several idle retries
    assert.deepEqual([status(agent), agent.modelCalls, digs(bot).length], ['active', 0, 3]);
    assert.equal(agent.work.clearScope(), null);   // the kept layer and the grants are not this place's
    assert.equal(agent.work.record.plan[0].progress.best, best);   // no false progress measured there
    bot.blockAt = blockAt;
    bot.game.dimension = 'overworld';
    assert.notEqual(agent.work.clearScope(), null);
    await until(agent, 'done');
    assert.equal(cellsLeft(bot.world), 0);
    assert.equal(agent.modelCalls, 0);
});

test('a completed build\'s blocks in the box, a furnished chest included, are never asked about or granted', async () => {
    const world = site();
    world.set(3, 64, 1, 'chest');
    world.set(2, 64, 0, 'oak_planks');
    world.set(4, 64, 2, 'chest');                  // the owner's, unrecorded
    const agent = setup({ world });
    const ledger = agent.work.ledger;
    const id = ledger.beginBuild();
    for (const [x, z, block] of [[3, 1, 'chest'], [2, 0, 'oak_planks']]) ledger.add({ pos: { x, y: 64, z }, block, kind: 'building', by: 'action:buildStructure', dim: 'overworld', at: 1, build_id: id });
    ledger.endBuild(id);
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    const q = agent.work.record.pending_question;
    assert.deepEqual(q.containers.map(c => [c.x, c.z]), [[4, 2]]);
    assert.deepEqual(q.cells, []);
    await F.ownerSays(agent, 'yes, chests too');
    await until(agent, 'done');
    assert.equal(world.block(at(3, 64, 1)).name, 'chest');
    assert.equal(world.block(at(2, 64, 0)).name, 'oak_planks');
    assert.equal(world.block(at(4, 64, 2)).name, 'air');
    assert.equal(agent.work.record.plan[0].result, '25/27 cells empty; left: 2 part of my build');
});

test('the question lists every leftover type and every container, over several chat lines; a yes grants exactly those; the whole report goes to the owner', async () => {
    const containers = ['chest', 'barrel', 'hopper', 'dropper', 'dispenser', 'smoker', 'lectern', 'jukebox', 'trapped_chest', 'oak_shelf'];
    const types = ['cobblestone', 'oak_planks', 'glass', 'bricks', 'white_wool', 'polished_granite', 'red_wool'];
    const { chatLines } = await import('../src/agent/work/report.js');   // after the fixture's module mocks
    for (const answer of ['yes, chests too', 'no']) {
        const world = site();
        const cells = [];
        for (let x = 2; x <= 4; x++) for (let z = 0; z <= 2; z++) for (const y of [64, 65]) cells.push([x, y, z]);
        containers.forEach((name, i) => world.set(...cells[i], name));
        types.forEach((name, i) => world.set(...cells[containers.length + i], name));
        const agent = setup({ world });
        agent.work.startTask('clear', `clear markers=${MARKER}`);
        await until(agent, 'blocked');
        const q = agent.work.record.pending_question;
        for (const [i, name] of containers.entries()) assert.ok(q.text.includes(`${name} at ${cells[i].join(',')}`), name);
        for (const name of types) assert.ok(q.text.includes(`${name} 1 (at `), name);
        const lines = chatLines(q.text);
        assert.ok(lines.length >= 3 && lines.every(l => l.length <= 200));
        await F.until(() => lines.every(l => agent.chats.includes(l)));
        assert.deepEqual([q.cells.length, q.containers.length], [types.length, containers.length]);
        await F.ownerSays(agent, answer);
        await until(agent, 'done');
        const step0 = agent.work.record.plan[0];
        if (answer === 'no') {
            assert.ok(step0.progress.report.length > 160 && step0.result.length <= 160);
            assert.match(step0.progress.report, /oak_shelf \(a container, kept\)/);
            // The direct report carries the whole final report, in lines.
            await F.until(() => agent.chats.some(c => c.startsWith('Task done: "clear"')));
            const from = agent.chats.findIndex(c => c.startsWith('Task done: "clear"'));
            await F.until(() => agent.chats.slice(from).join(' ').includes(step0.progress.report));   // paced lines
            assert.ok(agent.chats.slice(from).every(l => l.length <= 200));
        } else {
            assert.equal(cellsLeft(world), 0);
            assert.equal(step0.result, '27/27 cells empty');
        }
    }
});

test('a full inventory never blocks a clear: junk is dropped where there is junk, else it digs on (M40)', async () => {
    for (const filler of ['oak_planks', 'dirt']) {
        const agent = setup({ inventory: { wooden_pickaxe: 1, [filler]: 64 * 33 } });
        const { bot } = agent;
        assert.ok(bot.inventory.emptySlotCount() < 4);
        agent.work.startTask('clear', `clear markers=${MARKER}`);
        await until(agent, 'done');
        assert.equal(cellsLeft(bot.world), 0);
        assert.equal(agent.modelCalls, 0);
        assert.equal(bot.calls.some(c => c[0] === 'toss' && c[1] === 'dirt'), filler === 'dirt');
    }
});

test('a deep box under the bot is cleared whole: a cell under it waits, uncounted, until a cleared cell to stand in exists (PROBE A)', async () => {
    const agent = setup({ world: site({ markers: false, fill: 'dirt' }), position: [3.5, 67, 1.5] });   // on 3,66,1
    agent.work.startTask('clear', 'clear box=2,64,0:4,66,2');
    await until(agent, 'blocked');
    await F.ownerSays(agent, 'yes');
    await until(agent, 'done');
    assert.equal(cellsLeft(agent.bot.world), 0);
    assert.equal(agent.work.record.plan[0].result, '27/27 cells empty');
});

test('an owner message that goes to the model disarms the question until code posts it again after that turn', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const agent = await asked([['cobblestone', 3, 65, 1]], { replies: [async () => { await gate; return 'Want me to follow you after this?'; }, 'Okay.'] });
    const q = agent.work.record.pending_question;
    await F.until(() => agent.chats.includes(q.text));
    const posts = () => agent.chats.filter(c => c === q.text).length;
    const turn = F.ownerSays(agent, 'what are you doing?');          // goes to the model, which takes a while
    await F.until(() => agent.modelCalls === 1);
    await F.ownerSays(agent, 'yes');                                  // before the re-post: the model's, not the question's
    assert.equal(agent.modelCalls, 2);
    assert.deepEqual([status(agent), agent.work.record.pending_question?.id], ['blocked', q.id]);
    release();
    await turn;
    await F.until(() => posts() === 2 && asking(agent));               // posted again after that turn: armed
    await F.ownerSays(agent, 'yes');
    assert.equal(agent.modelCalls, 2);
    await until(agent, 'done');
    assert.equal(agent.bot.world.block(at(3, 65, 1)).name, 'air');
});

test('answer parsing: only short exact answers count; "keep going" or "no problem, go ahead" go to the model', () => {
    const { parseAnswer } = F.modules.ask;
    const options = ['yes', 'yes, chests too', 'no'];
    const cases = {
        'no': 'no', 'Nope!': 'no', 'no thanks': 'no', 'no keep them': 'no', 'No, keep them.': 'no', 'keep them': 'no', "don't": 'no', 'dont': 'no', 'n': 'no', 'nah': 'no',
        'yes': 'yes', 'Yes.': 'yes', 'ok': 'yes', 'yes, chests too': 'yes, chests too',
        // NG1: these are not refusals.
        'no problem': null, 'no problem, go ahead': null, 'no worries, do it': null, 'keep going': null, 'keep digging': null, "don't stop": null,
        "don't do it": null, 'Keep': null, 'not now': null, 'nothing': null, 'know what': null, 'yes go ahead': null, 'yes?': null,
    };
    for (const [message, expected] of Object.entries(cases)) assert.equal(parseAnswer(message, options), expected, message);
});

test('a question is armed only once its last line is out: a yes while it is still being posted goes to the model', async () => {
    const world = site();
    for (let x = 2; x <= 4; x++) for (let z = 0; z <= 2; z++) world.set(x, 64, z, 'barrel');   // 9 containers: a question of several lines
    const agent = setup({ world, replies: [async () => { await F.sleep(120); return 'Okay.'; }] });
    agent.work.lineGapMs = 150;
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await F.until(() => agent.work.record.pending_question);
    const q = agent.work.record.pending_question;
    const { chatLines } = await import('../src/agent/work/report.js');
    const lines = chatLines(q.text);
    assert.ok(lines.length >= 2);
    await F.until(() => agent.chats.includes(lines[0]));
    assert.equal(agent.work.armed, null);
    await F.ownerSays(agent, 'yes, chests too');                       // the rest is not out yet
    assert.equal(agent.modelCalls, 1);
    assert.equal(agent.work.record.pending_question?.id, q.id);
    // The model's reply disarmed it, so it is posted again; the first post is
    // dropped where it stands, and only the whole second post arms it.
    await F.until(() => asking(agent), { timeout: 10000 });
    assert.equal(agent.chats.filter(c => c === lines[0]).length, 2);
    assert.equal(agent.chats.filter(c => c === lines.at(-1)).length, 1);
    assert.ok(agent.chats.lastIndexOf(lines.at(-1)) > agent.chats.lastIndexOf(lines[0]));
});

// A bare Work around an agent whose openChat records each send (Sol r3 probes).
function outbox() {
    const sent = [];
    const agent = {
        name: 'outbox', history: { add: async () => {}, save: async () => {} },
        handleMessage: async () => {}, openChat: async text => { sent.push({ text, at: Date.now() }); },
        prompter: { work_config: { chat: 'debug' } },   // the fixture default (REQ-CHAT-1)
    };
    const w = new W.Work(agent, { timers: false });
    w.log = () => {};
    w.lineGapMs = 80;
    w.guardTurns();
    return { w, sent };
}

test('a superseded question sends no more lines once replaced (X1)', async () => {
    const { w, sent } = outbox();
    try {
        w.record = { id: 'old-task', status: 'blocked', pending_question: { id: 'old-q', text: 'OLD container list\nOLD approval instruction' } };
        const oldPost = w.postQuestion();
        await F.until(() => sent.some(s => s.text === 'OLD container list'));
        w.record = { id: 'new-task', status: 'blocked', pending_question: { id: 'new-q', text: 'NEW proposal' } };
        await w.postQuestion();
        await oldPost;
        assert.equal(w.armed, 'new-q');
        assert.deepEqual(sent.map(s => s.text), ['OLD container list', 'NEW proposal']);
    } finally {
        w.dispose();
    }
});

test('all owner output shares one pacing clock; a superseded post of the same question is dropped, not sent twice (X2)', async () => {
    const { w, sent } = outbox();
    try {
        await Promise.all([w.deliver('A first\nA second'), w.deliver('B first\nB second')]);
        assert.equal(sent.length, 4);
        for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 75, `${sent[i].at - sent[i - 1].at} ms`);
        sent.length = 0;
        w.record = { id: 't', status: 'blocked', pending_question: { id: 'q', text: 'L1\nL2\nL3' } };
        const first = w.postQuestion();
        await F.until(() => sent.length === 1);
        const again = w.postQuestion();                    // a re-post while the first is going out
        await Promise.all([first, again]);
        assert.deepEqual(sent.map(s => s.text), ['L1', 'L1', 'L2', 'L3']);
        for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 75, `${sent[i].at - sent[i - 1].at} ms`);
        assert.equal(w.armed, 'q');
    } finally {
        w.dispose();
    }
});

test('report lines are paced at least a gap apart', async () => {
    const agent = setup({ drive: false });
    const sent = [];
    agent.chats.push = (...m) => { sent.push(Date.now()); return Array.prototype.push.apply(agent.chats, m); };
    agent.work.lineGapMs = 80;
    await agent.work.deliver(`${'word '.repeat(60)}\nsecond line\nthird line`);
    assert.equal(sent.length, 4);
    for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= 75, `${sent[i] - sent[i - 1]} ms`);
});

test('an unrelated turn that ends first does not re-arm the question an owner turn disarmed', async () => {
    let releaseSystem, releaseOwner;
    const systemGate = new Promise(resolve => { releaseSystem = resolve; });
    const ownerGate = new Promise(resolve => { releaseOwner = resolve; });
    const agent = await asked([['cobblestone', 3, 65, 1]], { replies: [async () => { await systemGate; return ''; }, async () => { await ownerGate; return 'Shall I follow you?'; }] });
    const q = agent.work.record.pending_question;
    const system = agent.handleMessage('system', 'You are near a creeper.');      // starts while the question is armed
    await F.until(() => agent.modelCalls === 1);
    const owner = F.ownerSays(agent, 'what are you doing?');                       // disarms it
    await F.until(() => agent.modelCalls === 2);
    assert.equal(agent.work.armed, null);
    releaseSystem();
    await system;
    await F.sleep(50);
    assert.equal(agent.work.armed, null);                                          // the system turn is not the one that disarmed it
    releaseOwner();
    await owner;
    await F.until(() => asking(agent));
    assert.ok(agent.chats.lastIndexOf(q.text) > agent.chats.lastIndexOf('Shall I follow you?'));
    await F.ownerSays(agent, 'yes');
    await until(agent, 'done');
});

test('a turn code started that asks its own question disarms the open one until that turn ends; a restart posts it again', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const name = `clearturn${n++}`;
    const agent = await asked([['cobblestone', 3, 65, 1]], { name, replies: ['Shall I follow you? !modes', async () => { await gate; return ''; }] });
    const q = agent.work.record.pending_question;
    const turn = agent.handleMessage('system', W.RESTART_MESSAGE);
    await F.until(() => agent.chats.includes('Shall I follow you?') && agent.modelCalls === 2);
    await F.ownerSays(agent, 'yes');                                               // meant for the model's question
    assert.deepEqual([status(agent), agent.work.record.pending_question?.id, agent.modelCalls], ['blocked', q.id, 3]);
    release();
    await turn;
    await F.until(() => asking(agent));
    // After a restart the question is posted again before it takes an answer.
    agent.work.dispose();
    const posted = agent.chats.filter(c => c === q.text).length;
    const restarted = setup({ world: agent.bot.world, name, keep: true });
    assert.equal(restarted.work.armed, null);
    await F.until(() => asking(restarted) && restarted.chats.includes(q.text));
    assert.ok(posted >= 2);
    await F.ownerSays(restarted, 'yes');
    await until(restarted, 'done');
});

test('the support of a kept suspicious sand or gravel is not dug (a falling block for the dig and the pathfinder alike)', async () => {
    for (const name of ['suspicious_sand', 'suspicious_gravel']) {
        const world = new F.World();
        world.set(1, 64, 0, 'stone');
        world.set(1, 65, 0, name);
        const bot = F.makeBot({ world });
        assert.equal(F.modules.dig.safetyReason(bot, bot.blockAt(at(1, 64, 0))), 'under a falling block', name);
    }
    const world = site();
    world.set(3, 66, 1, 'suspicious_sand');      // on the top layer, over a stone cell
    const agent = setup({ world });
    let checked = null;
    agent.bot.hooks.dig = () => { checked ??= new pf.Movements(agent.bot).safeToBreak(agent.bot.blockAt(at(3, 65, 1))); };
    agent.work.startTask('clear', `clear markers=${MARKER}`);
    await until(agent, 'blocked');
    assert.equal(checked, false);                // the pathfinder's own check, during the clear
    assert.equal(world.block(at(3, 65, 1)).name, 'stone');
    assert.equal(world.block(at(3, 66, 1)).name, 'suspicious_sand');
});
