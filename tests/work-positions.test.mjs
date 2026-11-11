import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2b: !blockPositions (REQ-TRN-16) with the complete search the S2c marker
// search reuses (REQ-CLR-2), and the goToGoal configure carry (SPEC §5.3).
const { blockPositions, findAllBlocks } = await import('../src/agent/work/commands.js');
const { skills, pf } = F.modules;
const agents = [];
after(() => F.cleanup(agents));

// The cube trials' box: 8 stripped spruce wood markers at its corners.
const MARKER = 'stripped_spruce_wood';
const CORNERS = [];
for (const x of [-104, -93]) for (const y of [62, 69]) for (const z of [472, 486]) CORNERS.push([x, y, z]);

function cubeAgent(position = [-100, 64, 476]) {
    const world = new F.World();
    for (const [x, y, z] of CORNERS) world.set(x, y, z, MARKER, { axis: 'y' });
    const bot = F.makeBot({ world, position });
    // Mineflayer's findBlocks misses in-range blocks (SPEC §4.1): this one never
    // sees the farthest marker. The complete search must not depend on it.
    const real = bot.findBlocks;
    bot.findBlocks = options => real(options).filter(p => !(p.x === -93 && p.y === 69 && p.z === 486));
    const agent = F.makeAgent({ bot, name: `positions${agents.length}` });
    agents.push(agent);
    return agent;
}

test('!blockPositions: the complete search finds every marker where findBlocks misses one, without moving', async () => {
    const agent = cubeAgent();
    const { bot } = agent;
    assert.equal(bot.findBlocks({ matching: F.registry.blocksByName[MARKER].id, maxDistance: 32, count: 100 }).length, 7);
    const before = bot.entity.position.clone();
    await F.ownerSays(agent, `!blockPositions("${MARKER}", 32)`);
    const listing = agent.chats.at(-1);
    assert.match(listing, /^8 stripped_spruce_wood within 32: bounds x -104\.\.-93, y 62\.\.69, z 472\.\.486; nearest: /);
    const listed = listing.replace(/^.*nearest: /, '').replace(/\.$/, '').split('; ');
    assert.deepEqual([...listed].sort(), CORNERS.map(c => c.join(',')).sort());
    const center = before.floored();
    const distances = listed.map(s => new F.Vec3(...s.split(',').map(Number)).distanceTo(center));
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b)); // nearest first
    assert.ok(bot.entity.position.equals(before));
    assert.deepEqual(bot.calls.filter(c => c[0] === 'goto'), []);
});

test('!blockPositions: the model path gets the listing as a command result', async () => {
    const agent = cubeAgent();
    agent.prompter.promptConvo = async () => (agent.modelCalls++ ? 'There are 8.' : `!blockPositions("${MARKER}", 32)`);
    await F.ownerSays(agent, 'where are the 8 stripped spruce wood blocks?');
    assert.ok(agent.turns.some(t => t.source === 'system' && /^8 stripped_spruce_wood within 32: bounds/.test(t.content)));
    assert.equal(agent.modelCalls, 2);
});

test('!blockPositions: filtered by distance, at most 10 positions with the count and bounds, range clamped to 1–64', () => {
    const world = new F.World();
    for (let i = 1; i <= 15; i++) world.set(i, 64, 0, 'gold_block');
    world.set(20, 64, 20, 'gold_block'); // inside the cube of 20, outside its radius
    world.set(0, 64, 70, 'gold_block');  // beyond 64
    const bot = F.makeBot({ world, position: [0, 64, 0] });
    assert.equal(blockPositions(bot, 'gold_block', 20),
        '15 gold_block within 20: bounds x 1..15, y 64..64, z 0..0; nearest 10: ' +
        '1,64,0; 2,64,0; 3,64,0; 4,64,0; 5,64,0; 6,64,0; 7,64,0; 8,64,0; 9,64,0; 10,64,0.');
    assert.deepEqual([findAllBlocks(bot, 'gold_block', 30).positions.length, findAllBlocks(bot, 'gold_block', 30).unloaded], [16, false]);
    assert.match(blockPositions(bot, 'gold_block', 200), /^16 gold_block within 64:/);
    assert.equal(blockPositions(bot, 'gold_block', 0), '1 gold_block within 1: bounds x 1..1, y 64..64, z 0..0; nearest: 1,64,0.');
    assert.equal(blockPositions(bot, 'diamond_block', 8), 'No diamond_block within 8.');
});

test('!blockPositions says when part of the range is not loaded, with or without results (R9)', () => {
    const world = new F.World();
    world.set(2, 64, 0, 'gold_block');
    const bot = F.makeBot({ world, position: [0, 64, 0] });
    const blockAt = bot.blockAt;
    bot.blockAt = pos => (pos.x > 5 ? null : blockAt(pos)); // an unloaded chunk beyond x 5
    assert.equal(findAllBlocks(bot, 'gold_block', 8).unloaded, true);
    assert.equal(blockPositions(bot, 'gold_block', 8),
        '1 gold_block within 8: bounds x 2..2, y 64..64, z 0..0; nearest: 2,64,0 (part of the range is not loaded).');
    assert.equal(blockPositions(bot, 'diamond_block', 8), 'No diamond_block within 8 (part of the range is not loaded).');
    assert.equal(blockPositions(bot, 'diamond_block', 5), 'No diamond_block within 5.'); // only loaded cells within 5
});

test('goToGoal applies configure to both of its Movements instances, after its own defaults', async () => {
    const bot = F.makeBot();
    bot.hooks.noPath = true; // both path searches run
    const searched = [];
    const getPathTo = bot.pathfinder.getPathTo;
    bot.pathfinder.getPathTo = (movements, ...rest) => { searched.push(movements); return getPathTo(movements, ...rest); };
    const configured = [];
    await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 5, 1), m => { m.allow1by1towers = false; m.scafoldingBlocks = []; configured.push(m); });
    assert.equal(configured.length, 2);
    assert.notEqual(configured[0], configured[1]);
    assert.deepEqual(searched, configured);
    for (const m of configured) assert.deepEqual([m.allow1by1towers, m.scafoldingBlocks.length], [false, 0]); // no pillars, no scaffolding
    assert.equal(configured[0].digCost, 10); // the non-destructive defaults stay
    assert.equal(configured.includes(bot.pathfinder.movements), true);
    // Without configure, upstream's movements are unchanged.
    searched.length = 0;
    await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 5, 1));
    assert.equal(searched.length, 2);
    for (const m of searched) assert.deepEqual([m.allow1by1towers, m.scafoldingBlocks.length > 0], [true, true]);
});
