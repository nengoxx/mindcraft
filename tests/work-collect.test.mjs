import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// The truthful collect count (REQ-SAFE-12) and the owner's grant
// (REQ-SAFE-13): design ownblocks r4 §2, §3, §6; DECISIONS 2026-11-13.
const { skills, protect, commands, work: W } = F.modules;
const OBTAIN = F.modules.plan.STEPS.obtain;
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const at = (x, y, z) => new F.Vec3(x, y, z);
let n = 0;
function setup({ world = new F.World(), name = `collect${n++}`, inventory = { diamond_pickaxe: 1 }, position, replies, work, now } = {}) {
    const bot = F.makeBot({ world, inventory, position });
    F.player(bot, F.OWNER, [0, 64, 5]);
    const agent = F.makeAgent({ bot, name, replies, work });
    F.clearRecord(agent);
    F.startWork(agent, { now });
    agent.work.lineGapMs = 0;
    agents.push(agent);
    return agent;
}
const dug = bot => bot.calls.filter(c => c[0] === 'collect').map(c => c[2]);
const obsidian = (world, xs, y = 64, z = 0) => { for (const x of xs) world.set(x, y, z, 'obsidian'); };
const own = (agent, x, y, z, block) => agent.work.ledger.add({ pos: { x, y, z }, block, kind: 'own', by: 'action:newAction', dim: 'overworld', at: 1 });
const told = (agent, re) => agent.turns.some(t => t.source === 'system' && re.test(t.content));
const QUESTION_2 = 'May I mine 2 protected obsidian at 2,64,0 and 3,64,0? 1 more is nearby. Answer yes or no.';

// --- the count (§2) -----------------------------------------------------------------------

test('the defect: 3 unrecorded obsidian, collectBlock(obsidian, 2) collects 0, says they are protected, digs nothing', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world });
    const bot = agent.bot;
    assert.equal(await skills.collectBlock(bot, 'obsidian', 2), false);
    assert.match(bot.output, /^Collected 0 of 2 obsidian\. 3 obsidian within 8 are protected \(not natural\); I mine those only if the owner asks me to \(!collectPlaced\)\. Inventory net change: none\.$/m);
    assert.doesNotMatch(bot.output, /Completed|operations|No obsidian nearby/);
    assert.equal(bot.calls.filter(c => c[0] === 'dig' || c[0] === 'collect').length, 0, 'no dig');
    for (const x of [2, 3, 4]) assert.equal(world.block(at(x, 64, 0)).name, 'obsidian', 'world unchanged');
});

test('the palette pass (position null) neither throws nor hides a section; an exclude list works', async () => {
    const world = new F.World();
    for (const x of [2, 3, 4]) world.set(x, 64, 0, 'dirt');
    const agent = setup({ world });
    let palette = 0;
    const real = agent.bot.findBlocks;
    agent.bot.findBlocks = options => real({ ...options, matching: b => { if (!b.position) palette++; return options.matching(b); } });
    assert.equal(await skills.collectBlock(agent.bot, 'dirt', 2, [at(2, 64, 0)]), true);
    assert.ok(palette > 0, 'the matcher saw palette blocks');
    assert.deepEqual(dug(agent.bot), ['(3, 64, 0)', '(4, 64, 0)']);
    assert.match(agent.bot.output, /^Collected 2 of 2 dirt\. Inventory net change: \+2 dirt\.$/m);
});

test('a block the collect plugin refuses is not counted, not tried again, and its reason is told', async () => {
    const world = new F.World();
    obsidian(world, [2, 5]);
    world.set(2, 65, 0, 'lava');   // above the nearer one
    const agent = setup({ world });
    const bot = agent.bot;
    // Her own obsidian (exempt): the obsidian allowance admits the one beside lava to the search.
    for (const x of [2, 5]) agent.work.ledger.add({ pos: { x, y: 64, z: 0 }, block: 'obsidian', kind: 'station', by: null, dim: 'overworld', at: 1 });
    // In a task run the patched safeToBreak forces dontCreateFlow: the plugin skips it silently (CollectBlock.js:70).
    protect.guardBot(bot, agent.work.protector, () => true);
    assert.equal(await skills.collectBlock(bot, 'obsidian', 2), true);
    assert.deepEqual(dug(bot), ['(2, 64, 0)', '(5, 64, 0)'], 'the refused block is never picked again');
    assert.match(bot.output, /^Collected 1 of 2 obsidian\. 1 could not be dug: next to water or lava\. Inventory net change: \+1 obsidian\.$/m);
    assert.equal(world.block(at(2, 64, 0)).name, 'obsidian');
});

test('an error and a dig by someone else are reasons, not counts', async () => {
    const world = new F.World();
    for (const x of [2, 3, 4]) world.set(x, 64, 0, 'dirt');
    const agent = setup({ world });
    const bot = agent.bot;
    let calls = 0;
    bot.hooks.collect = async block => {
        calls++;
        if (calls === 1) throw new Error('No path to the block');
        if (calls === 2) {
            world.set(block.position.x, block.position.y, block.position.z, 'air');   // someone else broke it,
            bot.emit('diggingCompleted', world.block(at(0, 63, 0)));                  // while she dug another cell (a path dig)
        }
    };
    assert.equal(await skills.collectBlock(bot, 'dirt', 3), true);
    assert.deepEqual(dug(bot), ['(2, 64, 0)', '(3, 64, 0)', '(4, 64, 0)']);
    assert.match(bot.output, /^Collected 1 of 3 dirt\. 2 could not be dug: No path to the block; changed\. Inventory net change: \+1 dirt\.$/m);
});

test('her completed dig counts only when the cell no longer holds the block (a server correction)', async () => {
    const world = new F.World();
    world.set(2, 64, 0, 'dirt');
    const agent = setup({ world });
    const bot = agent.bot;
    bot.once('diggingCompleted', done => world.set(done.position.x, done.position.y, done.position.z, 'dirt'));
    await skills.collectBlock(bot, 'dirt', 1);
    assert.match(bot.output, /^Collected 0 of 1 dirt\. 1 could not be dug: still there\. /m);
});

test('an interrupt counts only what was really removed (the plugin swallows PathStopped)', async () => {
    const world = new F.World();
    for (const x of [2, 3, 4]) world.set(x, 64, 0, 'dirt');
    const agent = setup({ world });
    const bot = agent.bot;
    bot.hooks.collect = async () => { bot.interrupt_code = true; };
    assert.equal(await skills.collectBlock(bot, 'dirt', 3), false);
    assert.match(bot.output, /^Collected 0 of 3 dirt before interruption\. Inventory net change: none\.$/m);
    bot.interrupt_code = false;
});

test('the summary also ends an early exit (no bucket), and "No … nearby" only when nothing of the type stands near', async () => {
    const world = new F.World();
    world.set(2, 64, 0, 'water');
    const agent = setup({ world });
    const bot = agent.bot;
    assert.equal(await skills.collectBlock(bot, 'water', 1), false);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: no bucket\. Inventory net change: none\.$/m);
    bot.output = '';
    assert.equal(await skills.collectBlock(bot, 'sand', 1), false);
    assert.equal(bot.output, 'No sand nearby to collect.\nCollected 0 of 1 sand. Inventory net change: none.\n');
});

test('the protected count splits grantable (G) and kept (K): her records, a building, a kept cell; ores of a run are in neither', async () => {
    const world = new F.World();
    obsidian(world, [2, 3]);
    obsidian(world, [4]);
    world.set(0, 64, 3, 'oak_planks');
    world.set(9, 64, 0, 'obsidian');   // beyond 8 of the start
    const agent = setup({ world });
    own(agent, 4, 64, 0, 'obsidian');
    own(agent, 0, 64, 3, 'oak_planks');
    const bot = agent.bot;
    await skills.collectBlock(bot, 'obsidian', 1);
    assert.match(bot.output, /^Collected 0 of 1 obsidian\. 2 obsidian within 8 are protected \(not natural\); I mine those only if the owner asks me to \(!collectPlaced\)\. 1 obsidian within 8 are kept \(my own builds, containers or a kept area\); I do not mine those\. Inventory net change: none\.$/m);
    bot.output = '';
    // Only her own planks (adversary r3 gap 2): the kept sentence, never an unexplained 0.
    await skills.collectBlock(bot, 'oak_planks', 4);
    assert.match(bot.output, /^Collected 0 of 4 oak_planks\. 1 oak_planks within 8 are kept /m);
    assert.doesNotMatch(bot.output, /No oak_planks nearby|are protected/);
    // A buried ore inside a run is the harvest policy, not his: no sentence.
    world.fill(-3, 58, -3, 3, 62, 3, 'stone');
    world.set(0, 60, 0, 'coal_ore');
    protect.guardBot(bot, agent.work.protector, () => true);
    agent.work.protector.newRun();
    bot.output = '';
    await skills.collectBlock(bot, 'coal_ore', 1);
    // It is there, so not "No coal_ore nearby" (rulings r1 S7).
    assert.match(bot.output, /^The coal_ore nearby are ones I may not mine \(protected or next to water or lava\)\.\nCollected 0 of 1 coal_ore\. Inventory net change: none\.$/m);
    agent.work.protector.endRun();
});

test('work.collect.placed_radius renders and bounds the count; bad values keep the defaults', async () => {
    const world = new F.World();
    obsidian(world, [2, 5]);
    const agent = setup({ world, work: { collect: { placed_radius: 3 } } });
    await skills.collectBlock(agent.bot, 'obsidian', 1);
    assert.match(agent.bot.output, /1 obsidian within 3 are protected/);
    const config = F.modules.config.loadWorkConfig({ collect: { placed_radius: 0, question_s: 'soon' } });
    assert.deepEqual(config.collect, { placed_radius: 8, question_s: 120 });
    assert.deepEqual(F.modules.config.loadWorkConfig({ collect: { question_s: 30 } }).collect, { placed_radius: 8, question_s: 30 });
});

test('both command forms run through executeCommand; outside his turn !collectPlaced is refused', async () => {
    const world = new F.World();
    obsidian(world, [2]);
    const agent = setup({ world });
    const result = await commands.executeCommand(agent, '!collectBlocks("obsidian", 1)');
    assert.match(result, /Collected 0 of 1 obsidian\. 1 obsidian within 8 are protected/);
    assert.equal(await commands.executeCommand(agent, '!collectPlaced("obsidian", 1)'), W.PLACED_NOT_OWNER);
    assert.equal(world.block(at(2, 64, 0)).name, 'obsidian');
    assert.match(commands.getCommandDocs(agent), /!collectPlaced: Mine protected blocks \(placed or not natural\) only when the owner asked you to\. He may be asked to confirm\./);
});

// --- obtain (§2) --------------------------------------------------------------------------

test('obtain: only protected or kept blocks near blocks with their count; a real failure wins', async () => {
    const world = new F.World();
    world.fill(2, 64, -1, 2, 66, 1, 'oak_log', { axis: 'y' });   // a log cabin wall: protected
    const agent = setup({ world, inventory: {} });
    const bot = agent.bot;
    const ctx = { bot, call: (label, fn) => fn() };
    const step = { args: { item: 'oak_log', count: 2 }, progress: null };
    assert.deepEqual(await OBTAIN.unit(ctx, step), { blocked: 'none reachable: no oak_log within 64 blocks that is safe to break (9 protected within 8)' });
    F.tree(world, 6, 64, 0, 3);
    bot.hooks.collect = async () => { throw new Error('No path to the block'); };
    assert.deepEqual(await OBTAIN.unit(ctx, step), { failed: 'could not collect oak_log (No path to the block)' });
    // The summary is never the why.
    bot.hooks.collect = async () => { bot.interrupt_code = true; };
    assert.deepEqual(await OBTAIN.unit(ctx, step), { failed: 'could not collect oak_log' });
    bot.interrupt_code = false;
});

// --- the owner's grant (§3) ---------------------------------------------------------------

test('the grant: exact cell, same block, this dimension, after the clear scope and her records; withGrant clears it', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world });
    const bot = agent.bot;
    const p = agent.work.protector;
    own(agent, 3, 64, 0, 'obsidian');
    const cell = x => ({ x, y: 64, z: 0, name: 'obsidian', dim: 'overworld' });
    const blocked = x => p.isProtected(bot.blockAt(at(x, 64, 0)));
    assert.equal(p.grantable(bot.blockAt(at(2, 64, 0))), true);
    assert.equal(p.grantable(bot.blockAt(at(3, 64, 0))), false, 'her record');
    let seen;
    const cells = [cell(2), cell(3), { ...cell(4), dim: 'the_nether' }];
    await p.withGrant(cells, async () => {
        seen = [blocked(2)];   // no cell focused yet: nothing lifted
        seen.push(...cells.map((c, i) => { p.focusGrant(c); return blocked(2 + i); }));
        p.focusGrant({ ...cell(2) });   // not a cell of the list: lifts nothing
        seen.push(blocked(2));
    });
    assert.deepEqual(seen, [true, false, true, true, true], 'focused only; her record stays protected; another dimension; outside the list');
    assert.equal(p.grant, null);
    assert.equal(blocked(2), true);
    await assert.rejects(p.withGrant([cell(2)], async () => { throw new Error('dig failed'); }));
    assert.equal(p.grant, null, 'cleared on a throw too');
    // A kept clear layer stays protected under a grant.
    const scope = { inShell: pos => pos.x === 4, inBox: () => false, neverRemove: new Set(), containers: new Set(), granted: () => false };
    const scoped = new protect.Protector(bot, { scope: () => scope });
    scoped.grant = { cells: [], current: cell(4) };
    assert.equal(scoped.isProtected(bot.blockAt(at(4, 64, 0))), true);
    world.set(2, 64, 0, 'crying_obsidian');
    scoped.grant = { cells: [], current: cell(2) };
    assert.equal(scoped.isProtected(bot.blockAt(at(2, 64, 0))), true, 'a changed block is not granted');
});

test('typed !collectPlaced mines at once the nearest grantable cells within 8 of the start only (never her records), 0 model calls, the grant only during its action', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 5, 9]);
    obsidian(world, [1], 65);
    const agent = setup({ world, replies: ['should never be asked'] });
    own(agent, 1, 65, 0, 'obsidian');   // her own: kept
    const bot = agent.bot;
    const grants = [];
    bot.hooks.collect = async () => { grants.push(agent.work.protector.grant?.cells.length ?? null); };
    await F.ownerSays(agent, '!collectPlaced("obsidian", 4)');
    // She moves to each block; the cell at x 9 is within 8 of her later positions, never of the start.
    assert.deepEqual(dug(bot), ['(2, 64, 0)', '(3, 64, 0)', '(5, 64, 0)']);
    assert.equal(world.block(at(9, 64, 0)).name, 'obsidian');
    assert.equal(world.block(at(1, 65, 0)).name, 'obsidian');
    assert.equal(bot.count('obsidian'), 3);
    assert.deepEqual(grants, [3, 3, 3]);
    assert.equal(agent.work.protector.grant, null, 'the grant ends with its action');
    assert.equal(agent.modelCalls, 0);
    assert.ok(agent.chats.some(c => /Collected 3 of 4 obsidian\. Inventory net change: \+3 obsidian\./.test(c)));
    // Containers and beds are never grantable; nothing left within 8.
    world.set(1, 64, 1, 'chest');
    await F.ownerSays(agent, '!collectPlaced("chest", 1)');
    assert.ok(agent.chats.includes('No protected chest within 8 that I may mine.'));
    assert.equal(world.block(at(1, 64, 1)).name, 'chest');
});

test('a grant digs its frozen cells only: a nearer natural block of the type is no substitute', async () => {
    const world = new F.World();
    F.tree(world, 2, 64, 0, 3);                                   // natural, nearer
    world.fill(6, 64, -1, 6, 66, 1, 'oak_log', { axis: 'y' });   // his log wall: protected
    const agent = setup({ world, inventory: {} });
    await F.ownerSays(agent, '!collectPlaced("oak_log", 1)');
    assert.deepEqual(dug(agent.bot), ['(6, 64, 0)']);
    assert.equal(world.block(at(2, 64, 0)).name, 'oak_log');
});

test('the model in his turn asks once, digs nothing and ends the loop (1 call); yes digs exactly the listed cells and hands back once (1 call)', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', 'never', 'I have the obsidian now.', 'never'] });
    const bot = agent.bot;
    await F.ownerSays(agent, 'mine two of the obsidian I placed');
    assert.equal(agent.modelCalls, 1);
    assert.deepEqual(dug(bot), []);
    assert.ok(agent.chats.includes(QUESTION_2));
    assert.ok(told(agent, /^May I mine 2 protected obsidian/));
    assert.equal(agent.work.blockAsk.armed, true);
    world.set(5, 64, 0, 'obsidian');   // a new nearer-than-nothing substitute is never taken
    await F.ownerSays(agent, 'yes');
    await F.until(() => agent.modelCalls === 2);
    assert.deepEqual(dug(bot), ['(2, 64, 0)', '(3, 64, 0)']);
    assert.equal(world.block(at(4, 64, 0)).name, 'obsidian');
    assert.ok(agent.chats.includes('Collected 2 of 2 obsidian. Inventory net change: +2 obsidian.'));
    assert.ok(told(agent, /The owner answered: yes\./));
    // The hand-back is the model's input once, not the owner's voice.
    assert.equal(agent.turns.filter(t => t.source === 'system' && /^Action output:\nCollected 2 of 2 obsidian/.test(t.content)).length, 1);
    await F.sleep(30);
    assert.equal(agent.modelCalls, 2);
    assert.equal(agent.work.blockAsk, null);
    assert.equal(agent.work.protector.grant, null);
});

test('a !collectPlaced in the hand-back turn is refused (no chained grant)', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4, 5]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 1)', '!collectPlaced("obsidian", 2)', 'ok.'] });
    await F.ownerSays(agent, 'mine one obsidian I placed');
    await F.ownerSays(agent, 'yes');
    await F.until(() => agent.modelCalls === 3);
    assert.ok(told(agent, new RegExp(`^${W.PLACED_NOT_OWNER.replace('.', '\\.')}$`)));
    assert.deepEqual(dug(agent.bot), ['(2, 64, 0)']);
    assert.equal(agent.work.blockAsk, null);
});

test('no grants nothing; a non-owner yes and a model "yes" grant nothing', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', '!collectPlaced("obsidian", 2)', 'yes', 'yes'] });
    await F.ownerSays(agent, 'mine my obsidian');
    await F.ownerSays(agent, 'no');
    assert.equal(agent.modelCalls, 1);
    assert.ok(told(agent, /The owner answered: no\./));
    assert.equal(agent.work.blockAsk, null);
    await F.ownerSays(agent, 'mine my obsidian');
    await F.ownerSays(agent, 'yes', 'alex');     // not the owner: goes to the model, which says "yes"
    assert.equal(agent.modelCalls, 3);
    await agent.handleMessage('system', 'Recent behaviors log: nothing');   // her own turn: the model says "yes"
    await F.sleep(20);
    assert.deepEqual(dug(agent.bot), []);
});

test('bot chat disarms the question: a yes before its one re-post grants nothing; a second disarm lapses it', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)'] });
    await F.ownerSays(agent, 'mine my obsidian');
    agent.openChat('Something else.', 'reply');
    assert.equal(agent.work.answerQuestion(F.OWNER, 'yes'), false, 'disarmed: not an answer');
    await F.until(() => agent.work.blockAsk?.armed);
    assert.equal(agent.chats.filter(c => c === QUESTION_2).length, 2, 're-posted once');
    agent.openChat('And another thing.', 'reply');
    assert.equal(agent.work.blockAsk, null);
    assert.ok(told(agent, /^The mining question lapsed\.$/));
    await F.sleep(20);
    assert.equal(agent.chats.filter(c => c === QUESTION_2).length, 2);
    assert.deepEqual(dug(agent.bot), []);
});

test('a raw command or a non-answer disarms it; after the re-post the next one clears it', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', 'Okay.'] });
    await F.ownerSays(agent, 'mine my obsidian');
    const turn = F.ownerSays(agent, '!inventory');
    assert.equal(agent.work.blockAsk.armed, false, 'disarmed at the raw turn\'s entry');
    await turn;
    await F.until(() => agent.work.blockAsk?.armed);
    assert.equal(agent.work.blockAsk.reposted, true);
    await F.ownerSays(agent, 'what are you doing?');   // a non-answer after the re-post
    assert.equal(agent.work.blockAsk, null);
    await F.ownerSays(agent, 'yes');
    await F.sleep(20);
    assert.deepEqual(dug(agent.bot), []);
});

test('it lapses after work.collect.question_s, on !stop, on a task question and on a newer ask', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const c = F.clock();
    const agent = setup({ world, now: c.now, replies: ['!collectPlaced("obsidian", 2)', 'What?', '!collectPlaced("obsidian", 2)', '!collectPlaced("obsidian", 1)',
        '!collectPlaced("obsidian", 1)'] });
    await F.ownerSays(agent, 'mine my obsidian');
    c.advance(121);
    await F.ownerSays(agent, 'yes');   // too late: the model gets it
    assert.equal(agent.modelCalls, 2);
    assert.ok(told(agent, /^The mining question lapsed\.$/));
    // A newer ask replaces it.
    await F.ownerSays(agent, 'mine my obsidian');
    const first = agent.work.blockAsk;
    await F.ownerSays(agent, 'mine one');
    assert.notEqual(agent.work.blockAsk, first);
    assert.match(agent.work.blockAsk.text, /^May I mine 1 protected obsidian at 2,64,0\? 2 more are nearby\./);
    // !stop ends it.
    await F.ownerSays(agent, '!stop');
    assert.equal(agent.work.blockAsk, null);
    // A task question ends it; with a task question open no ask is made.
    await F.ownerSays(agent, 'mine one');
    assert.ok(agent.work.blockAsk);
    agent.work.startTask('a stick', 'obtain item=stick count=1');
    agent.work.askOwner(agent.work.record.plan[0], { kind: 'test', text: 'Shall I?', options: ['yes', 'no'] });
    assert.equal(agent.work.blockAsk, null);
    assert.equal(await commands.executeCommand(agent, '!collectPlaced("obsidian", 1)'), W.PLACED_NOT_OWNER);
    const asked = agent.work.turnVoice;
    agent.work.turnVoice = () => 'owner';
    assert.equal(await agent.work.collectPlaced('obsidian', 1), W.PLACED_TASK_QUESTION);
    agent.work.turnVoice = asked;
    agent.work.cancel('test');
    assert.deepEqual(dug(agent.bot), []);
});

test('in an alert (blocked-report) or system turn !collectPlaced is refused, with no question', async () => {
    const world = new F.World();
    obsidian(world, [2]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 1)', '', '!collectPlaced("obsidian", 1)', ''] });
    await agent.handleMessage('system', 'You are idle.');
    agent.work.handoff = { message: 'The task is blocked.', ownerTask: true };
    await agent.handleMessage('system', 'The task is blocked.');
    assert.equal(agent.turns.filter(t => t.content === W.PLACED_NOT_OWNER).length, 2);
    assert.equal(agent.work.blockAsk, null);
    assert.deepEqual(dug(agent.bot), []);
});

test('a !stop or a newer action during the granted dig drops the hand-back (no model call)', async () => {
    for (const cut of ['stop', 'action']) {
        const world = new F.World();
        obsidian(world, [2, 3]);
        const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', 'never'] });
        const bot = agent.bot;
        await F.ownerSays(agent, 'mine my obsidian');
        let started = false;
        bot.hooks.collect = async () => { started = true; await F.until(() => bot.interrupt_code, { timeout: 4000 }); };
        await F.ownerSays(agent, 'yes');
        await F.until(() => started);
        if (cut === 'stop') await F.ownerSays(agent, '!stop');
        else await agent.actions.runAction('action:other', async () => {});
        await F.until(() => !agent.actions.executing);
        await F.sleep(30);
        assert.equal(agent.modelCalls, 1, cut);
        assert.equal(agent.work.protector.grant, null, cut);
        assert.ok(told(agent, /^Action interrupted\.\nAction output:\nCollected 0 of 2 obsidian before interruption\./), cut);
        bot.interrupt_code = false;
    }
    // A !stop or a newer action after the dig ended, while its summary is told: still no hand-back.
    for (const cut of ['stop', 'action']) {
        const world = new F.World();
        obsidian(world, [2, 3]);
        const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', 'never'] });
        await F.ownerSays(agent, 'mine my obsidian');
        const say = agent.openChat;
        agent.openChat = (message, ...rest) => {
            if (/^Collected /.test(message)) {
                if (cut === 'stop') agent.stop_epoch++;
                else agent.actions.runAction('action:other', async () => {});
            }
            return say(message, ...rest);
        };
        await F.ownerSays(agent, 'yes');
        await F.until(() => told(agent, /^Action output:\nCollected 2 of 2 obsidian/));
        await F.sleep(30);
        assert.equal(agent.modelCalls, 1, `${cut} after the dig`);
        assert.deepEqual(dug(agent.bot), ['(2, 64, 0)', '(3, 64, 0)']);
    }
});

test('the grant authority is the typed command of that turn only: a !newAction turn asks, generated code alone digs nothing', async () => {
    F.useSettings({ allow_insecure_coding: true });
    const world = new F.World();
    obsidian(world, [2, 3]);
    const agent = setup({ world });
    let output = null;
    agent.coder.generateCode = async () => {
        await skills.collectGrantedCells(agent.bot, 'obsidian', 1, [{ x: 2, y: 64, z: 0, name: 'obsidian', dim: 'overworld' }]);
        output = agent.bot.output;
        await agent.work.collectPlaced('obsidian', 1);
        return 'generated code ran';
    };
    await F.ownerSays(agent, '!newAction("mine the obsidian")');
    assert.deepEqual(dug(agent.bot), []);
    assert.ok(agent.work.blockAsk, 'not his typed !collectPlaced: code asks');
    assert.match(output, /^Collected 0 of 1 obsidian\. 1 could not be dug: protected\. /m);
});

// --- fix wave 1 (rulings-r1) --------------------------------------------------------------

test('S1: a !stop while the older action is still stopping: the queued grant never starts, nothing dug', async () => {
    const world = new F.World();
    obsidian(world, [2, 3]);
    const agent = setup({ world });
    const bot = agent.bot;
    let grants = 0;
    const withGrant = agent.work.protector.withGrant.bind(agent.work.protector);
    agent.work.protector.withGrant = (...args) => { grants++; return withGrant(...args); };
    // An older action that takes a while to stop.
    agent.actions.runAction('action:old', async () => { await F.until(() => bot.interrupt_code, { timeout: 4000 }); await F.sleep(150); });
    await F.until(() => agent.actions.executing);
    const typed = F.ownerSays(agent, '!collectPlaced("obsidian", 2)');
    await F.sleep(20);
    await F.ownerSays(agent, '!stop');
    await typed;
    await F.until(() => !agent.actions.executing);
    assert.equal(grants, 0, 'no grant installed');
    assert.deepEqual(dug(bot), []);
    assert.equal(agent.work.protector.grant, null);
});

test('S2: a cell changed during the approach is not dug: a granted lantern replaced by glass', async () => {
    const world = new F.World();
    world.set(6, 64, 0, 'lantern');   // collected by hand (mustCollectManually): approach, then bot.dig
    const agent = setup({ world, inventory: {} });
    const bot = agent.bot;
    bot.hooks.goto = async () => { world.set(6, 64, 0, 'glass'); };
    await F.ownerSays(agent, '!collectPlaced("lantern", 1)');
    assert.equal(world.block(at(6, 64, 0)).name, 'glass', 'the glass is not dug');
    assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
    assert.ok(agent.chats.some(c => /Collected 0 of 1 lantern\. 1 could not be dug: changed\./.test(c)), agent.chats.join(' | '));
    // Protected meanwhile (it became her record), or she changed dimension: not dug either.
    for (const [x, meanwhile, reason] of [[6, () => own(agent, 6, 64, 0, 'lantern'), 'protected'], [5, () => { bot.game.dimension = 'the_nether'; }, 'changed']]) {
        world.set(x, 64, 0, 'lantern');
        bot.hooks.goto = async () => { meanwhile(); };
        const before = agent.chats.length;
        await F.ownerSays(agent, `!collectPlaced("lantern", 1)`);
        bot.game.dimension = 'overworld';
        assert.equal(world.block(at(x, 64, 0)).name, 'lantern', reason);
        assert.ok(agent.chats.slice(before).some(c => new RegExp(`Collected 0 of 1 lantern\\. 1 could not be dug: ${reason}\\.`).test(c)), reason);
    }
    assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0);
});

test('S4: the grant lifts protection only for the cell being dug now', async () => {
    const world = new F.World();
    obsidian(world, [2, 3]);
    const agent = setup({ world });
    const bot = agent.bot;
    const p = agent.work.protector;
    const seen = [];
    bot.hooks.collect = async block => {
        seen.push([block.position.x, p.isProtected(bot.blockAt(at(2, 64, 0))), p.isProtected(bot.blockAt(at(3, 64, 0)))]);
    };
    await F.ownerSays(agent, '!collectPlaced("obsidian", 2)');
    assert.deepEqual(seen, [[2, false, true], [3, true, false]]);
    assert.deepEqual(dug(bot), ['(2, 64, 0)', '(3, 64, 0)']);
});

test('S5: the complete summary reaches him and the model even when the action output is shortened', async () => {
    const world = new F.World();
    obsidian(world, [2, 3]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', 'Got them.'] });
    const bot = agent.bot;
    await F.ownerSays(agent, 'mine my obsidian');
    const long = `No path to the block: ${'the way is blocked by a long wall of things '.repeat(5)}`.trim();
    let calls = 0;
    bot.hooks.collect = async () => {
        bot.output += 'Picked up 1 items.\n'.repeat(40);
        if (++calls === 1) throw new Error(long);
    };
    await F.ownerSays(agent, 'yes');
    await F.until(() => agent.modelCalls === 2);
    const summary = `Collected 1 of 2 obsidian. 1 could not be dug: ${long}. Inventory net change: +1 obsidian.`;
    assert.ok(summary.length > 250);
    assert.ok(agent.chats.join('\n').includes(summary.slice(0, 120)), 'told to him from its start');
    assert.ok(agent.turns.some(t => t.source === 'system' && t.content.includes(summary)), 'handed back whole');
});

test('S6: a rejecting equip is a reason, and the summary still ends the call', async () => {
    const world = new F.World();
    for (const x of [2, 3]) world.set(x, 64, 0, 'dirt');
    const agent = setup({ world });
    const bot = agent.bot;
    bot.tool.equipForBlock = async () => { throw new Error('NoItem: no tool'); };
    assert.equal(await skills.collectBlock(bot, 'dirt', 2), false);
    assert.match(bot.output, /^Collected 0 of 2 dirt\. 2 could not be dug: NoItem: no tool\. Inventory net change: none\.$/m);
});

test('S7: blocks of the type she may not mine are not "nothing nearby" (beside water; protected beyond 8)', async () => {
    const world = new F.World();
    world.set(3, 64, 0, 'dirt');
    world.set(3, 65, 0, 'water');
    world.set(12, 64, 0, 'obsidian');
    const agent = setup({ world });
    const bot = agent.bot;
    for (const type of ['dirt', 'obsidian']) {
        bot.output = '';
        await skills.collectBlock(bot, type, 1);
        assert.doesNotMatch(bot.output, /No \S+ nearby/, type);
        assert.match(bot.output, new RegExp(`^The ${type} nearby are ones I may not mine \\(protected or next to water or lava\\)\\.$`, 'm'), type);
    }
    bot.output = '';
    await skills.collectBlock(bot, 'sand', 1);
    assert.match(bot.output, /^No sand nearby to collect\.$/m);
    // obtain blocks on it as on "No … nearby" (the natural dirt under water).
    const step = { args: { item: 'dirt', count: 1 }, progress: null };
    const result = await OBTAIN.unit({ bot, call: (label, fn) => fn() }, step);
    assert.deepEqual(result, { blocked: 'none reachable: no dirt within 64 blocks that is safe to break' });
});

test('A1: a bucket fill is counted when the server fills it later; no fill in time is a reason', async () => {
    const world = new F.World();
    world.set(3, 64, 0, 'water');
    const agent = setup({ world, inventory: { bucket: 2 } });
    const bot = agent.bot;
    assert.equal(await skills.collectBlock(bot, 'water', 1), true);
    assert.match(bot.output, /^Collected 1 of 1 water\. Inventory net change: -1 bucket, \+1 water_bucket\.$/m);
    // An infinite source refills its cell: counted by the filled bucket.
    world.set(3, 64, 0, 'water');
    bot.hooks.infinite = true;
    bot.output = '';
    assert.equal(await skills.collectBlock(bot, 'water', 1), true);
    assert.match(bot.output, /^Collected 1 of 1 water\. /m);
    bot.give('bucket', 1);
    delete bot.hooks.infinite;
    bot.hooks.fill = null;   // the server never answers
    bot.output = '';
    assert.equal(await skills.collectBlock(bot, 'water', 1), false);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: the bucket did not fill\. Inventory net change: none\.$/m);
});

test('A2: a falling block landing in the cell she dug still counts (sand on sand, gravel on sand, gravel on gravel)', async () => {
    const FALLS = ['sand', 'gravel'];
    for (const [type, top] of [['sand', 'sand'], ['sand', 'gravel'], ['gravel', 'gravel']]) {
        const world = new F.World();
        world.set(3, 64, 0, type);
        world.set(3, 65, 0, type);
        world.set(3, 66, 0, top);
        const agent = setup({ world, inventory: { diamond_shovel: 1 } });
        const bot = agent.bot;
        bot.on('diggingCompleted', done => {   // the column falls into the dug cell
            for (let y = done.position.y; FALLS.includes(world.block(at(3, y + 1, 0)).name); y++) {
                world.set(3, y, 0, world.block(at(3, y + 1, 0)).name);
                world.set(3, y + 1, 0, 'air');
            }
        });
        await skills.collectBlock(bot, type, 2);
        assert.match(bot.output, new RegExp(`^Collected 2 of 2 ${type}\\. Inventory net change: \\+2 ${type}\\.$`, 'm'), `${type} under ${top}`);
    }
});

test('A4: a counted dig whose drop was lost is a failure, not a protected-only block', async () => {
    const world = new F.World();
    F.tree(world, 6, 64, 0, 1);
    world.fill(2, 64, -1, 2, 66, 1, 'oak_log', { axis: 'y' });   // his log wall
    const agent = setup({ world, inventory: {} });
    const bot = agent.bot;
    bot.give = () => {};   // the drop is lost (in lava, out of reach)
    const result = await OBTAIN.unit({ bot, call: (label, fn) => fn() }, { args: { item: 'oak_log', count: 2 }, progress: null });
    assert.equal(result.blocked, undefined);
    assert.match(result.failed, /^could not collect oak_log/);
});

test('A7: the question arms only if nothing disarmed it during its delivery; re-validation narrows the grant; !stop clears it at once; raw is one-shot; the hand-back is his', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)', '!taskStart("come here", "go_to target=here")'] });
    const w = agent.work;
    const bot = agent.bot;
    // Arming: a turn still in flight that spoke during the post keeps it disarmed.
    const cells = [{ x: 2, y: 64, z: 0, name: 'obsidian', dim: 'overworld' }];
    const asking = w.askBlocks('obsidian', cells, 0);
    const token = { done: false, chats: 0 };
    w.disarming.add(token);
    await asking;
    assert.equal(w.blockAsk.armed, false);
    token.done = true;
    w.settle(token);
    await F.until(() => w.blockAsk?.armed);
    w.dropBlockAsk('test');
    // Re-validation: a cell that became her record is left out of the grant.
    await F.ownerSays(agent, 'mine my obsidian');
    own(agent, 3, 64, 0, 'obsidian');
    const granted = [];
    bot.hooks.collect = async () => { granted.push(w.protector.grant?.cells.length); };
    await F.ownerSays(agent, 'yes');
    await F.until(() => agent.modelCalls === 2);
    assert.deepEqual(granted, [1]);
    // The hand-back turn is his: a task started there tells him when done.
    await F.until(() => w.record);
    assert.equal(w.record.notify_done, true);
    // !stop clears the grant at once, before the action ends; raw is read once.
    let cleared = null, again = null;
    bot.hooks.collect = async () => {
        again = w.rawOwnerCommand('!collectPlaced');
        F.modules.commands.getCommand('!stop').perform(agent);
        cleared = w.protector.grant;
    };
    await F.ownerSays(agent, '!collectPlaced("obsidian", 1)');
    assert.equal(again, false, 'one-shot');
    assert.equal(cleared, null);
});

test('A8: his typed !collectPlaced while a model question is open clears the question', async () => {
    const world = new F.World();
    obsidian(world, [2, 3, 4]);
    const agent = setup({ world, replies: ['!collectPlaced("obsidian", 2)'] });
    await F.ownerSays(agent, 'mine my obsidian');
    assert.ok(agent.work.blockAsk);
    await F.ownerSays(agent, '!collectPlaced("obsidian", 2)');
    assert.equal(agent.work.blockAsk, null);
    assert.ok(told(agent, /^The mining question lapsed\.$/));
    await F.sleep(30);
    assert.equal(agent.chats.filter(c => c === QUESTION_2).length, 1, 'never re-posted');
});

// --- fix wave 2 (rulings-r2) --------------------------------------------------------------

test('C1: a falling block the server puts back after a refused dig is not counted; a real fall still is', async () => {
    for (const above of ['air', 'sand', 'gravel']) {
        const world = new F.World();
        world.set(3, 64, 0, 'sand');
        world.set(3, 65, 0, above);
        const agent = setup({ world, inventory: { diamond_shovel: 1 } });
        const bot = agent.bot;
        bot.on('diggingCompleted', done => {   // the server refuses: the block comes back, no drop
            world.set(done.position.x, done.position.y, done.position.z, 'sand');
            bot.take('sand', 1);
        });
        assert.equal(await skills.collectBlock(bot, 'sand', 1), false, above);
        assert.match(bot.output, /^Collected 0 of 1 sand\. 1 could not be dug: still there\. Inventory net change: none\.$/m, above);
        assert.equal(world.block(at(3, 65, 0)).name, above);
    }
});

test('C2: a bucket picked up while the use was refused is not a fill', async () => {
    const world = new F.World();
    world.set(3, 64, 0, 'water');
    world.set(2, 65, 0, 'stone');
    const agent = setup({ world, inventory: { bucket: 1 } });
    const bot = agent.bot;
    let dropped = 1;
    bot.hooks.goto = async () => { if (dropped-- > 0) bot.give('water_bucket', 1); };   // a dropped one, picked up on the way
    bot.blockAtCursor = () => world.block(at(2, 65, 0));           // in the way: useToolOnBlock refuses
    assert.equal(await skills.collectBlock(bot, 'water', 1), true, 'the inventory did gain an item');
    assert.equal(bot.calls.filter(c => c[0] === 'activateItem').length, 0);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: the bucket did not fill\. Inventory net change: \+1 water_bucket\.$/m);
    assert.equal(world.block(at(3, 64, 0)).name, 'water');
    // Each guard alone. The use is sent but never filled, and a filled bucket is picked up: no empty spent.
    bot.blockAtCursor = () => null;
    bot.hooks.fill = null;
    dropped = 1;
    bot.output = '';
    await skills.collectBlock(bot, 'water', 1);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: the bucket did not fill\./m, 'sent, no empty spent');
    // The use is refused while an earlier use's fill lands on the way (an empty spent, a filled gained).
    bot.blockAtCursor = () => world.block(at(2, 65, 0));
    let late = 1;
    bot.hooks.goto = async () => { if (late-- > 0) { bot.take('bucket', 1); bot.give('water_bucket', 1); } };
    bot.give('bucket', 1);
    bot.output = '';
    await skills.collectBlock(bot, 'water', 1);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: the bucket did not fill\./m, 'refused, an earlier fill');
    // A thrown use is its own reason, never a fill.
    bot.hooks.goto = null;
    bot.lookAt = async () => { throw new Error('look failed'); };
    bot.output = '';
    await skills.collectBlock(bot, 'water', 1);
    assert.match(bot.output, /^Collected 0 of 1 water\. 1 could not be dug: look failed\./m, 'thrown');
});

// Live trial 2026-11-13: `!collectBlocks("copper_ore", 1)` dug the ore (+4
// raw_copper) after 3 dirt on the path, yet reported "Collected 0 of 1 …
// changed". The pathfinder's detectDiggingStopped called
// removeAllListeners('diggingCompleted', fn): Node ignores the second argument,
// so every listener went, the attempt's included. The carried patch makes it
// remove only its own (patches/mineflayer-pathfinder+2.4.5.patch).
test('the pathfinder carry: detectDiggingStopped removes only its own dig listeners', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../node_modules/mineflayer-pathfinder/index.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function detectDiggingStopped'), src.indexOf('function resetPath'));
    assert.ok(body.includes('detectDiggingStopped'), 'found');
    assert.doesNotMatch(body, /removeAllListeners/);
    assert.match(body, /removeListener\('diggingCompleted', detectDiggingStopped\)/);
    assert.match(body, /removeListener\('diggingAborted', detectDiggingStopped\)/);
});
