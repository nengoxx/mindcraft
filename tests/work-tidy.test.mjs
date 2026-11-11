import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// S2c, D6: tidying the bot's own scaffold (SPEC §11.10, REQ-OWN-7 … 11,
// REQ-TRN-13 `!tidy`) on the real ActionManager, modes, handleMessage, ledger
// and dig seam. The live acceptance items of PLAN S2c item 4 each have a
// fixture here.
const { tidy: T, report: R, commands: C } = F.modules;
const TIDY = T.TIDY;
const DEFAULTS = { ...TIDY };
const FAST = { landMs: 200, pollMs: 5, taskEndMs: 2000, recheckMs: 30, recheckForMs: 400 };
const agents = [];
const stops = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); F.cleanup(agents.splice(0)); });
beforeEach(() => { F.useSettings(); Object.assign(TIDY, DEFAULTS, FAST); });

const at = (x, y, z) => new F.Vec3(x, y, z);
const OWNER_AT = [6, 64, 6];

// Stone ground with its top at y 63: the bot stands at y 64.
function ground() {
    const world = new F.World();
    world.fill(-8, 59, -8, 8, 63, 8, 'stone');
    return world;
}

let n = 0;
function setup({ world = ground(), position = [0.5, 64, 0.5], modes, work = {}, inventory = {}, drive = false, now, name } = {}) {
    const bot = F.makeBot({ world, position, inventory });
    F.player(bot, F.OWNER, OWNER_AT);
    const agent = F.makeAgent({ bot, modes, work, name: name ?? `tidy${n++}` });
    F.clearRecord(agent);
    // The MindServer path: agent.js:161-187 keeps respondFunc on the agent.
    agent.respondFunc = async (username, message) => agent.handleMessage(username, message);
    F.startWork(agent, { now });
    agent.work.lineGapMs = 5;
    agent.logs = [];
    const log = agent.work.log.bind(agent.work);
    agent.work.log = message => { agent.logs.push(message); log(message); };
    agent.work.ledger.log = message => { agent.logs.push(`[ledger] ${message}`); };
    agents.push(agent);
    if (drive) stops.push(F.drive(agent));
    return agent;
}

// A ledger entry the bot placed, with its block in the world.
function placed(agent, x, y, z, { block = 'cobblestone', by = 'mode:self_defense', kind = 'scaffold' } = {}) {
    agent.bot.world.set(x, y, z, block);
    agent.work.ledger.add({ pos: { x, y, z }, block, kind, by, dim: 'overworld', at: Date.now() });
}

// The pathfinder's pillar step (index.js:571-575, as in work-ledger): the
// predicted stone, the jump, then bot.placeBlock under the bot.
async function pillar(bot, levels, item = 'cobblestone') {
    for (let i = 0; i < levels; i++) {
        const p = bot.entity.position.floored();
        bot.heldItem = bot.inventory.findInventoryItem(item);
        bot.setBlock(p.x, p.y, p.z, 'stone');
        bot.entity.position.y += 1;
        await bot.placeBlock(bot.blockAt(at(p.x, p.y - 1, p.z)), at(0, 1, 0));
    }
}

// The bot falls when the cell under its feet becomes air.
function gravity(bot) {
    bot.on('blockUpdate', (old, now) => {
        const p = bot.entity.position;
        const c = now.position;
        if (now.name !== 'air' || c.x !== Math.floor(p.x) || c.z !== Math.floor(p.z) || c.y !== Math.floor(p.y - 0.01)) return;
        let y = c.y;
        while (bot.blockAt(at(c.x, y - 1, c.z)).name === 'air') y--;
        p.y = y;
    });
}

// Another action takes over (a mode's execute, or a command), interrupting the running one.
function interruptBy(agent, label, ms = 20) {
    void agent.actions.runAction(label, () => F.sleep(ms));
    return F.until(() => agent.bot.interrupt_code);
}

const digs = bot => bot.calls.filter(c => c[0] === 'dig').map(c => c[2]);
const live = agent => agent.work.ledger.list().filter(e => !e.removed_at && !e.removing);
const kindAt = (agent, x, y, z) => agent.work.ledger.get({ x, y, z })?.kind ?? null;
const tidyNow = agent => F.ownerSays(agent, '!tidy');
const said = (agent, line) => F.until(() => agent.chats.includes(line), { timeout: 4000 });
const idle = agent => F.until(() => !agent.actions.executing, { timeout: 4000 });

// --- the tidy line (REQ-OWN-10) --------------------------------------------------

test('the tidy line is rendered from the sweep: removed, and what was left grouped by reason', () => {
    const pos = { x: 0, y: 0, z: 0 };
    assert.equal(R.tidyLine({ removed: [pos, pos, pos, pos, pos], left: [] }), 'Removed 5 of my scaffold blocks here.');
    assert.equal(R.tidyLine({ removed: [pos], left: [] }), 'Removed 1 of my scaffold block here.');
    assert.equal(R.tidyLine({ removed: [pos, pos, pos], left: [{ pos, reason: 'next to water' }, { pos, reason: 'next to water' }] }),
        'Removed 3 of my scaffold blocks; left 2 (next to water).');
    assert.equal(R.tidyLine({ removed: [], left: [{ pos, reason: 'next to water' }, { pos, reason: 'part of what I stand on' }, { pos, reason: 'next to water' }] }),
        'Removed 0 of my scaffold blocks; left 3 (2 next to water, 1 part of what I stand on).');
});

// --- live acceptance items as fixtures (PLAN S2c item 4) ---------------------------

test('a fight pillar with no task is removed after the fight: the mode-end sweep pillars down, with no model call', async () => {
    const agent = setup({ modes: { self_defense: true }, inventory: { cobblestone: 8 }, drive: true });
    const { bot } = agent;
    agent.work.ledger.settleMs = 20;
    gravity(bot);
    const attack = bot.pvp.attack;
    let fought = false;
    bot.pvp.attack = entity => {
        if (!fought) { fought = true; void pillar(bot, 2); }
        attack.call(bot.pvp, entity);
    };
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => digs(bot).length === 2, { timeout: 8000 });
    await idle(agent);
    assert.deepEqual(digs(bot), ['(0, 65, 0)', '(0, 64, 0)']);   // top first, standing on it
    assert.equal(bot.entity.position.y, 64);
    assert.ok(live(agent).every(e => e.kind !== 'scaffold'));
    await said(agent, 'Removed 2 of my scaffold blocks here.');
    assert.equal(agent.modelCalls, 0);
    assert.ok(!agent.turns.some(t => /AUTO MESSAGE/.test(t.content)));
});

test('a task ending on its own pillar pillars down once its run is over (the task-end sweep, as action:tidy)', async () => {
    const agent = setup({ position: [0.5, 66, 0.5], inventory: { dirt: 1 }, drive: true });
    gravity(agent.bot);
    placed(agent, 0, 64, 0, { by: 'action:task' });
    placed(agent, 0, 65, 0, { by: 'action:task' });
    const labels = [];
    agent.bot.hooks.dig = () => { labels.push(agent.actions.currentActionLabel); };
    assert.equal(agent.work.startTask('one dirt', 'obtain item=dirt count=1').ok, true);
    await F.until(() => digs(agent.bot).length === 2, { timeout: 6000 });
    assert.equal(agent.work.record.status, 'done');
    assert.deepEqual(labels, ['action:tidy', 'action:tidy']);
    assert.equal(agent.bot.entity.position.y, 64);
    assert.equal(agent.modelCalls, 0);
    // A later run that finds the task already done schedules nothing.
    placed(agent, 2, 64, 0, { by: 'action:task' });
    await idle(agent);
    await agent.work.runner.run();
    await F.sleep(100);
    assert.equal(digs(agent.bot).length, 2);
});

test('a bridge over water is recorded; a scaffold block next to water is left and reported, the rest removed and logged', async () => {
    const world = ground();
    world.set(2, 63, 0, 'water');
    world.set(3, 63, 0, 'water');
    const agent = setup({ world, inventory: { cobblestone: 4 } });
    const { bot } = agent;
    agent.work.ledger.settleMs = 20;
    // The pathfinder bridges the water cell at 2,63,0: predicted stone, then the place.
    bot.heldItem = bot.inventory.findInventoryItem('cobblestone');
    bot.setBlock(2, 63, 0, 'stone');
    await bot.placeBlock(bot.blockAt(at(1, 63, 0)), at(1, 0, 0));
    await F.until(() => kindAt(agent, 2, 63, 0) === 'scaffold');
    placed(agent, -2, 64, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(bot), ['(-2, 64, 0)']);
    assert.equal(kindAt(agent, 2, 63, 0), 'scaffold');                       // left, still live
    await said(agent, 'Removed 1 of my scaffold block; left 1 (next to water).');
    assert.ok(agent.logs.some(l => /tidy .*removed 1: -2,64,0; left 1: 2,63,0 next to water/.test(l)), agent.logs.join('\n'));
});

test('an owner !stop mid-sweep keeps the rest for good, at once from chat (before any translation): the dig in progress is cancelled, protected afterwards', async () => {
    const agent = setup();
    const { bot } = agent;
    for (const x of [-2, 2, 3]) placed(agent, x, 64, 0);
    let seen = null;
    bot.hooks.dig = async () => {
        if (seen) return;
        bot.emit('chat', F.OWNER, '!stop');                  // the observer runs synchronously here
        seen = [kindAt(agent, -2, 64, 0), kindAt(agent, 2, 64, 0), kindAt(agent, 3, 64, 0)];
        seen.persisted = F.readLedger(agent).entries.filter(e => e.kind === 'own').length;   // written at once
        await F.sleep(30);                                   // the command comes later (translation)
    };
    await tidyNow(agent);
    await idle(agent);
    assert.equal(digs(bot).length, 1);
    await F.ownerSays(agent, '!stop');
    // The one being dug is a candidate not yet removed: kept too, its dig cancelled.
    for (const x of [-2, 2, 3]) assert.equal(bot.blockAt(at(x, 64, 0)).name, 'cobblestone');
    assert.deepEqual([...seen], ['own', 'own', 'own']);
    assert.equal(seen.persisted, 3);
    for (const x of [-2, 2, 3]) {
        assert.equal(kindAt(agent, x, 64, 0), 'own');
        assert.equal(agent.work.protector.isProtected(bot.blockAt(at(x, 64, 0))), true);
    }
    assert.equal(F.readLedger(agent).entries.filter(e => e.kind === 'own').length, 3);   // persisted at once
    assert.ok(agent.logs.some(l => /kept scaffold cobblestone at 3,64,0 as own: owner !stop/.test(l)), agent.logs.join('\n'));
});

test('the owner keep also comes from whispers and from MindServer as the owner (the operator helper), synchronously; MindServer\'s ADMIN and other players keep nothing', async () => {
    for (const via of ['whisper', 'mindserver', 'admin', 'stranger']) {
        const agent = setup();
        const { bot } = agent;
        placed(agent, 2, 64, 0);
        placed(agent, 3, 64, 0);
        let seen = null;
        bot.hooks.dig = async () => {
            if (seen) return;
            if (via === 'whisper') bot.emit('whisper', F.OWNER, '!stop');
            else if (via === 'mindserver') void agent.respondFunc(F.OWNER, '!stop');
            else if (via === 'admin') void agent.respondFunc('ADMIN', '!stop');   // the MindServer web UI's sender
            else bot.emit('chat', 'alex', '!stop');
            seen = kindAt(agent, 3, 64, 0);
            bot.interrupt_code = true;                           // the stop that follows
        };
        await tidyNow(agent);
        await idle(agent);
        assert.equal(seen, via === 'whisper' || via === 'mindserver' ? 'own' : 'scaffold', via);
        // The MindServer wrap applies only the keep: it is not the last owner message.
        if (via === 'mindserver') assert.equal(agent.work.lastOwnerMessage, null);
    }
});

test('only a mode interruption keeps a remainder (adversary probe P2), and it expires after 5 minutes', async () => {
    const clock = F.clock();
    let agent = setup({ now: clock.now });
    let { bot } = agent;
    const stop = F.modules.commands.getCommand('!stop');
    placed(agent, 2, 64, 0, { by: 'action:task' });
    placed(agent, 3, 64, 0, { by: 'action:task' });
    // A command (not a mode) interrupts the sweep: no remainder.
    bot.hooks.dig = async () => { await interruptBy(agent, 'action:goToPlayer'); };
    await tidyNow(agent);
    assert.equal(agent.work.tidy.remainder, null);
    bot.hooks.dig = null;
    clock.advance(600);
    bot.emit('chat', F.OWNER, 'ok stop following me');
    clock.advance(30);
    await stop.perform(agent);
    assert.equal(kindAt(agent, 2, 64, 0), 'scaffold');
    assert.equal(kindAt(agent, 3, 64, 0), 'scaffold');

    // A mode's remainder is kept by a stop within 5 minutes, not after.
    agent = setup({ now: clock.now });
    ({ bot } = agent);
    placed(agent, 2, 64, 0);
    placed(agent, 3, 64, 0);
    bot.hooks.dig = async () => { await interruptBy(agent, 'mode:self_defense'); };
    await tidyNow(agent);
    assert.ok(agent.work.tidy.remainder);
    bot.hooks.dig = null;
    clock.advance(301);
    bot.emit('chat', F.OWNER, '!stop');
    assert.equal(kindAt(agent, 2, 64, 0), 'scaffold');
    assert.equal(agent.work.tidy.remainder, null);

    // A sweep started outside runAction (a resumed run) does not inherit an
    // older mode label: a stop's interruption keeps no remainder.
    agent = setup({ now: clock.now });
    ({ bot } = agent);
    placed(agent, 2, 64, 0);
    agent.work.tidy.onActionStart('mode:self_defense');
    bot.hooks.dig = async () => { bot.interrupt_code = true; };
    await T.tidyNear(bot);
    assert.equal(agent.work.tidy.remainder, null);
});

test('disposing the work layer restores respondFunc and runAction only while its own wraps are still installed', () => {
    const agent = setup();
    const later = async () => 'a later wrapper';
    agent.respondFunc = later;
    const run = agent.actions.runAction;
    const laterRun = async () => {};
    agent.actions.runAction = laterRun;
    agent.work.dispose();
    assert.equal(agent.respondFunc, later);
    assert.equal(agent.actions.runAction, laterRun);
    assert.notEqual(run, laterRun);
});

test('a model !stop within 60 s of an owner message counts as the owner\'s; later, or with no sweep or remainder, it keeps nothing', async () => {
    const clock = F.clock();
    const agent = setup({ now: clock.now });
    const { bot } = agent;
    const stop = F.modules.commands.getCommand('!stop');
    placed(agent, 2, 64, 0);
    placed(agent, 3, 64, 0);
    // A sweep a mode interrupted leaves its remainder.
    bot.hooks.dig = async () => { await interruptBy(agent, 'mode:self_defense'); };
    await tidyNow(agent);
    assert.ok(agent.work.tidy.remainder);
    bot.hooks.dig = null;
    bot.emit('chat', F.OWNER, 'stop tidying');
    clock.advance(61);
    await stop.perform(agent);                                 // the model's !stop, too late
    assert.equal(kindAt(agent, 2, 64, 0), 'scaffold');
    bot.emit('chat', F.OWNER, 'stop tidying');
    clock.advance(59);
    await stop.perform(agent);                                 // within 60 s: the owner's
    assert.equal(kindAt(agent, 2, 64, 0), 'own');
    assert.equal(kindAt(agent, 3, 64, 0), 'own');
});

test('after a restart, old scaffold is not tidied (forgotten at process start); owner-kept entries stay own', async () => {
    const name = `tidy-restart${n++}`;
    let agent = setup({ name });
    placed(agent, 2, 64, 0);
    placed(agent, 3, 64, 0, { kind: 'own' });
    agent.work.ledger.flush();
    agent.work.dispose();
    const bot = agent.bot;
    agent = F.makeAgent({ bot, name });
    F.startWork(agent);
    agents.push(agent);
    await tidyNow(agent);
    assert.deepEqual(digs(bot), []);
    assert.equal(kindAt(agent, 3, 64, 0), 'own');
    assert.ok(agent.chats.includes('No scaffold of mine within reach.'), agent.chats.join('\n'));
});

test('!tidy works with no task, also with the automatic triggers off, and is refused while a task is live', async () => {
    const agent = setup({ work: { tidy: { enabled: false } } });
    placed(agent, 2, 64, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(2, 64, 0)']);
    await said(agent, 'Removed 1 of my scaffold block here.');
    placed(agent, 3, 64, 0);
    agent.work.startTask('one dirt', 'obtain item=dirt count=1');
    agent.work.pause('command');
    await tidyNow(agent);
    assert.ok(agent.chats.includes('A task is running; I tidy when it ends.'));
    assert.equal(digs(agent.bot).length, 1);
    assert.equal(F.modules.commands.getCommand('!tidy').name, '!tidy');
});

test('a bridge the bot stands on is left whole; the blocks under its hitbox count, and so does connectivity through any kind of its blocks', async () => {
    // A bridge over a gap: the bot on its middle.
    const world = ground();
    world.fill(-3, 63, -1, 3, 63, 1, 'air');
    const agent = setup({ world, position: [0.5, 65, 0.5] });
    for (const x of [-1, 0, 1, 2]) placed(agent, x, 64, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);
    await said(agent, 'Removed 0 of my scaffold blocks; left 4 (part of what I stand on).');

    // On natural stone at x 0, but the hitbox reaches over x 1: the scaffold
    // there, its neighbour and one joined to it through an own block stay.
    const other = setup({ position: [0.8, 64, 0.5] });
    placed(other, 1, 63, 0);
    placed(other, 2, 63, 0);
    placed(other, 3, 63, 0, { kind: 'own' });
    placed(other, 4, 63, 0);
    placed(other, -2, 64, 0);
    await tidyNow(other);
    assert.deepEqual(digs(other.bot), ['(-2, 64, 0)']);
});

test('the footprint is recomputed before each dig: knocked onto its own bridge, the bot leaves it', async () => {
    const agent = setup();
    placed(agent, -1, 64, 1);
    placed(agent, 2, 63, 0);
    placed(agent, 3, 63, 0);
    agent.bot.hooks.dig = async block => {
        if (block.position.x === -1) agent.bot.entity.position = at(2.5, 64, 0.5);   // knockback onto 2,63,0
    };
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(-1, 64, 1)']);
    assert.equal(kindAt(agent, 2, 63, 0), 'scaffold');
    assert.equal(kindAt(agent, 3, 63, 0), 'scaffold');
});

test('pillar-down only for a plain column of live scaffold on a full solid block, never past a block that does not land the bot', async () => {
    // A recorded block beside the column: it is a structure, left whole.
    let agent = setup({ position: [0.5, 66, 0.5] });
    gravity(agent.bot);
    placed(agent, 0, 64, 0);
    placed(agent, 0, 65, 0);
    placed(agent, 1, 64, 0, { kind: 'own' });
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);

    // A column with a block of another kind in it: not live scaffold all through.
    agent = setup({ position: [0.5, 66, 0.5] });
    gravity(agent.bot);
    placed(agent, 0, 64, 0, { kind: 'own' });
    placed(agent, 0, 65, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);

    // A column over air, a slab or a fence (no full-cube support): left whole.
    for (const support of ['air', 'stone_slab', 'oak_fence']) {
        const world = ground();
        world.set(0, 63, 0, support);
        agent = setup({ world, position: [0.5, 66, 0.5] });
        gravity(agent.bot);
        placed(agent, 0, 64, 0);
        placed(agent, 0, 65, 0);
        await tidyNow(agent);
        assert.deepEqual(digs(agent.bot), [], support);
    }

    // Another player on the pillar top with the bot: not dug (A1).
    agent = setup({ position: [0.5, 66, 0.5] });
    gravity(agent.bot);
    placed(agent, 0, 64, 0);
    placed(agent, 0, 65, 0);
    agent.bot.players[F.OWNER].entity.position = at(0.6, 66, 0.4);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);

    // Water beside the block under the bot: not dug.
    const wet = ground();
    wet.set(1, 65, 0, 'water');
    agent = setup({ world: wet, position: [0.5, 66, 0.5] });
    placed(agent, 0, 64, 0);
    placed(agent, 0, 65, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);

    // No landing one block lower within the wait: the sweep ends there.
    agent = setup({ position: [0.5, 66, 0.5] });
    placed(agent, 0, 64, 0);
    placed(agent, 0, 65, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(0, 65, 0)']);
    assert.equal(kindAt(agent, 0, 64, 0), 'scaffold');

    // Not on the ground: no candidates are chosen.
    agent = setup();
    placed(agent, 2, 64, 0);
    agent.bot.entity.onGround = false;
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);
    assert.ok(agent.chats.includes('Nothing tidied (not on the ground).'), agent.chats.join('\n'));

    // only_by limits the column too: a task's pillar is not pillared down by a mode sweep.
    agent = setup({ position: [0.5, 66, 0.5] });
    gravity(agent.bot);
    placed(agent, 0, 64, 0, { by: 'action:task' });
    placed(agent, 0, 65, 0, { by: 'action:task' });
    const result = await T.tidyNear(agent.bot, { only_by: new Set(['mode:self_defense']) });
    assert.deepEqual(result.removed, []);
    assert.deepEqual(digs(agent.bot), []);
});

test('top-down with no floating block: a column whose top is out of reach or fails stays whole; a plant on top is no obstacle, sand is', async () => {
    const agent = setup();
    for (let y = 64; y <= 69; y++) placed(agent, 3, y, 0);                 // its top, 3,69,0, is out of reach
    for (let y = 64; y <= 66; y++) placed(agent, -3, y, 0);
    agent.bot.world.set(-4, 66, 0, 'water');                               // beside the top only
    placed(agent, 0, 64, 3);
    agent.bot.world.set(0, 65, 3, 'short_grass');
    placed(agent, 0, 64, -3);
    agent.bot.world.set(0, 65, -3, 'sand');
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(0, 64, 3)']);
    await said(agent, 'Removed 1 of my scaffold block; left 9 (8 under a block that stays, 1 next to water).');
});

test('before each dig: a changed block is not dug, a player on a cell keeps it, a hostile within 16 ends the sweep', async () => {
    let agent = setup();
    placed(agent, -2, 64, 0);
    placed(agent, 2, 64, 0);
    agent.bot.hooks.dig = async block => {
        if (block.position.x === -2) agent.bot.world.set(2, 64, 0, 'stone');   // replaced meanwhile
    };
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(-2, 64, 0)']);

    agent = setup();
    placed(agent, 2, 64, 0);
    agent.bot.players[F.OWNER].entity.position = at(2.5, 65, 0.5);         // standing on it
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);
    await said(agent, 'Removed 0 of my scaffold blocks; left 1 (a player is on it).');

    // A hostile ends the sweep: no line, only the command's answer; the rest stays live.
    agent = setup();
    placed(agent, 2, 64, 0);
    placed(agent, -2, 64, 0);
    F.hostile(agent.bot, 'zombie', [12, 0, 0]);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), []);
    await said(agent, 'Nothing tidied (a hostile is near).');
    assert.ok(!agent.chats.some(c => c.startsWith('Removed')), agent.chats.join('\n'));
    assert.equal(kindAt(agent, 2, 64, 0), 'scaffold');

    // Off the ground after the first dig: no second dig (A2).
    agent = setup();
    placed(agent, 2, 64, 0);
    placed(agent, -2, 64, 0);
    agent.bot.hooks.dig = async () => { agent.bot.entity.onGround = false; };
    await tidyNow(agent);
    assert.equal(digs(agent.bot).length, 1);
});

test('the sweep\'s own checks run again after tool selection, right before the dig packet, which is sent without a look', async () => {
    const changes = {
        // knocked onto the bridge the candidate belongs to
        knocked: agent => { agent.bot.entity.position = at(3.5, 64, 0.5); },
        airborne: agent => { agent.bot.entity.onGround = false; },
        hostile: agent => { F.hostile(agent.bot, 'zombie', [12, 0, 0]); },
        retired: agent => { agent.work.ledger.retire({ x: 2, y: 63, z: 0 }, 'test'); },
        kept: agent => { agent.bot.emit('chat', F.OWNER, '!stop'); },
    };
    for (const [name, change] of Object.entries(changes)) {
        const agent = setup();
        placed(agent, 2, 63, 0, { block: 'dirt' });           // dirt: unrecorded, it is natural, so only the sweep's checks stop it
        placed(agent, 3, 63, 0, { block: 'dirt' });
        agent.bot.world.set(3, 64, 0, 'air');
        let once = false;
        agent.bot.tool.equipForBlock = async () => { if (!once) { once = true; change(agent); } };
        await tidyNow(agent);
        assert.ok(!digs(agent.bot).includes('(2, 63, 0)'), name);
    }
    const agent = setup();
    placed(agent, 2, 64, 0);
    await tidyNow(agent);
    const calls = agent.bot.calls.filter(c => c[0] === 'lookAt' || c[0] === 'dig');
    assert.deepEqual(calls.map(c => c[0]), ['lookAt', 'dig']);
    assert.equal(calls[1][3], 'ignore');
});

test('a sweep digs at most 32 blocks and runs at most 60 s; what is left stays live', async () => {
    const world = ground();
    world.fill(-2, 62, -2, 2, 63, 2, 'air');
    world.set(0, 63, 0, 'stone');
    world.set(0, 62, 0, 'stone');
    let agent = setup({ world });
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (const y of [62, 63])
        if (x || z) placed(agent, x, y, z);
    await tidyNow(agent);
    assert.equal(digs(agent.bot).length, 32);
    assert.equal(live(agent).filter(e => e.kind === 'scaffold').length, 16);
    // Only cells left for a cell reason are reported; those the bound did not reach are not.
    await said(agent, 'Removed 32 of my scaffold blocks here.');

    const clock = F.clock();
    agent = setup({ now: clock.now });
    placed(agent, 2, 64, 0);
    placed(agent, -2, 64, 0);
    agent.bot.hooks.dig = async () => { clock.advance(61); };
    await tidyNow(agent);
    assert.equal(digs(agent.bot).length, 1);
    assert.equal(live(agent).filter(e => e.kind === 'scaffold').length, 1);
});

test('the sweep waits for pending scaffold attempts within reach to settle, so the top of a pillar just built is removed', async () => {
    const agent = setup({ inventory: { cobblestone: 4 }, position: [0.5, 64, 0.5] });
    const { bot } = agent;
    agent.work.ledger.settleMs = 150;
    bot.heldItem = bot.inventory.findInventoryItem('cobblestone');
    bot.setBlock(2, 64, 0, 'stone');
    await bot.placeBlock(bot.blockAt(at(2, 63, 0)), at(0, 1, 0));
    assert.equal(agent.work.ledger.attempts.size, 1);
    await tidyNow(agent);
    assert.deepEqual(digs(bot), ['(2, 64, 0)']);
});

test('an interrupted sweep keeps its remainder until the next sweep supersedes it; a stop while it waits keeps the live blocks too; kept attempts stay kept', async () => {
    const world = ground();
    world.set(4, 64, 0, 'water');
    const agent = setup({ world, inventory: { cobblestone: 4 } });
    const { bot } = agent;
    placed(agent, 3, 64, 0);                                   // next to water: never removable
    placed(agent, -2, 64, 0);
    bot.hooks.dig = async () => { await interruptBy(agent, 'mode:self_defense'); };
    await tidyNow(agent);
    const remainder = agent.work.tidy.remainder;
    assert.ok(remainder && remainder.candidates.size === 2);
    await F.sleep(50);
    assert.ok(!agent.chats.some(c => c.startsWith('Removed')), 'an interrupted sweep says nothing');
    bot.hooks.dig = null;
    await tidyNow(agent);                                      // supersedes it
    assert.equal(agent.work.tidy.remainder, null);
    bot.emit('chat', F.OWNER, '!stop');
    assert.equal(kindAt(agent, 3, 64, 0), 'scaffold');         // the superseded remainder is not kept

    // A kept pending attempt settles as own, also after a newer sweep starts.
    agent.work.ledger.settleMs = 200;
    bot.heldItem = bot.inventory.findInventoryItem('cobblestone');
    bot.setBlock(-2, 64, 1, 'stone');
    await bot.placeBlock(bot.blockAt(at(-2, 63, 1)), at(0, 1, 0));
    bot.hooks.dig = null;
    const sweep = tidyNow(agent);
    await F.until(() => agent.work.tidy.sweep);
    bot.emit('chat', F.OWNER, '!stop');
    assert.equal([...agent.work.ledger.attempts.values()][0].keep, true);
    // The live block within reach is kept as well, and written at once (P1).
    assert.equal(kindAt(agent, 3, 64, 0), 'own');
    assert.equal(F.readLedger(agent).entries.find(e => e.pos.x === 3).kind, 'own');
    bot.interrupt_code = true;
    await sweep;
    await tidyNow(agent);
    await F.until(() => kindAt(agent, -2, 64, 1) != null);
    assert.equal(kindAt(agent, -2, 64, 1), 'own');
    assert.ok(!digs(bot).includes('(-2, 64, 1)'));
});

test('stations, building and own entries are never tidied: !craftRecipe still takes back its table', async () => {
    const agent = setup();
    placed(agent, 2, 64, 0, { block: 'crafting_table', kind: 'station', by: 'action:craftRecipe' });
    placed(agent, 2, 64, 1, { kind: 'own' });
    placed(agent, 2, 64, -1, { kind: 'building' });
    placed(agent, -2, 64, 0);
    await tidyNow(agent);
    assert.deepEqual(digs(agent.bot), ['(-2, 64, 0)']);
    assert.equal(kindAt(agent, 2, 64, 0), 'station');
});

// --- triggers (REQ-OWN-8) ----------------------------------------------------------

test('the task-end launch: only for done or failed, the same record, unchanged stop_epoch and last action, idle, within the window', async () => {
    const make = () => {
        const agent = setup();
        placed(agent, 2, 64, 0);
        const record = { id: 't1', status: 'done', plan: [], cursor: 0 };
        agent.work.adopt(record);
        return { agent, record };
    };
    const ran = async (agent, ms = 150) => { await F.sleep(ms); await idle(agent); return digs(agent.bot).length > 0; };

    let { agent, record } = make();
    agent.work.tidy.scheduleTaskEnd(record);
    assert.equal(await ran(agent), true);

    ({ agent, record } = make());
    agent.work.tidy.scheduleTaskEnd(record);
    agent.work.adopt({ ...record, id: 't2' });                 // a newer task
    assert.equal(await ran(agent), false);

    ({ agent, record } = make());
    agent.work.tidy.scheduleTaskEnd(record);
    agent.stop_epoch++;
    assert.equal(await ran(agent), false);

    ({ agent, record } = make());
    agent.work.tidy.scheduleTaskEnd(record);
    agent.bot.emit('chat', F.OWNER, '!stop');                 // the raw keep, before the check (Q1)
    assert.equal(await ran(agent), false);

    ({ agent, record } = make());
    agent.work.tidy.scheduleTaskEnd(record);
    agent.actions.last_action_time = Date.now() + 1;           // another action ran meanwhile
    assert.equal(await ran(agent), false);

    ({ agent, record } = make());
    record.status = 'cancelled';
    agent.work.tidy.scheduleTaskEnd(record);
    assert.equal(await ran(agent), false);

    ({ agent, record } = make());
    agent.work.tidy.scheduleTaskEnd(record);
    record.status = 'cancelled';                               // changed before the launch
    assert.equal(await ran(agent), false);

    // Scheduled from inside the run's action, it waits for that action to end,
    // within the window only.
    ({ agent, record } = make());
    await agent.actions.runAction('action:task', async () => { agent.work.tidy.scheduleTaskEnd(record); await F.sleep(60); });
    assert.equal(await ran(agent), true);
    ({ agent, record } = make());
    TIDY.taskEndMs = 40;
    await agent.actions.runAction('action:task', async () => { agent.work.tidy.scheduleTaskEnd(record); await F.sleep(120); });
    assert.equal(await ran(agent), false);

    // A check that polled while the action ran and finds it ended after the window does not launch (P5).
    ({ agent, record } = make());
    Object.assign(TIDY, { taskEndMs: 40, pollMs: 30 });
    await agent.actions.runAction('action:task', async () => { agent.work.tidy.scheduleTaskEnd(record); await F.sleep(50); });
    assert.equal(await ran(agent), false);
    Object.assign(TIDY, FAST);

    ({ agent, record } = make());
    agent.work.config.tidy = { enabled: false, announce: true };
    agent.work.tidy.scheduleTaskEnd(record);
    assert.equal(await ran(agent), false);
});

test('the mode-end trigger: uninterrupted only, on the next tick, no stop in flight, mode scaffold in reach, no resumable action', async () => {
    const ok = { interrupted: false, message: '' };
    const check = async (prepare, expected, code = ok) => {
        const agent = setup();
        placed(agent, 2, 64, 0);
        prepare?.(agent);
        agent.work.onModeEnd('self_defense', code);
        assert.equal(agent.actions.executing, false);           // never in the same tick
        await F.sleep(60);
        await idle(agent);
        assert.equal(digs(agent.bot).length > 0, expected);
        return agent;
    };
    await check(null, true);
    await check(null, false, { interrupted: true, message: '' });
    await check(agent => { agent.actions.stopPromise = Promise.resolve(); setTimeout(() => { agent.actions.stopPromise = null; }, 100); }, false);
    await check(agent => { agent.work.ledger.get({ x: 2, y: 64, z: 0 }).by = 'action:task'; }, false);
    await check(agent => { agent.actions.resume_func = async () => {}; agent.actions.resume_name = 'action:followPlayer'; }, false);
    await check(agent => { agent.work.config.tidy = { enabled: false, announce: true }; }, false);
});

test('after a mode, a hostile within 16 defers the sweep: re-checked until it is gone, cancelled by a stop, by activity or after the window', async () => {
    const start = () => {
        const agent = setup();
        placed(agent, 2, 64, 0);
        const zombie = F.hostile(agent.bot, 'zombie', [12, 0, 0]);
        agent.work.onModeEnd('self_defense', { interrupted: false });
        return { agent, zombie };
    };
    let { agent, zombie } = start();
    await F.sleep(80);
    assert.deepEqual(digs(agent.bot), []);
    delete agent.bot.entities[zombie.id];
    await F.until(() => digs(agent.bot).length === 1);

    ({ agent, zombie } = start());
    await F.sleep(40);
    agent.stop_epoch++;
    delete agent.bot.entities[zombie.id];
    await F.sleep(100);
    assert.deepEqual(digs(agent.bot), []);

    ({ agent, zombie } = start());
    await F.sleep(40);
    const busy = agent.actions.runAction('action:other', () => F.sleep(80));
    delete agent.bot.entities[zombie.id];
    await busy;
    await F.sleep(100);
    assert.deepEqual(digs(agent.bot), []);

    ({ agent, zombie } = start());
    await F.sleep(40);
    agent.bot.emit('chat', F.OWNER, '!stop');                 // the owner keep cancels deferred requests
    delete agent.bot.entities[zombie.id];
    await F.sleep(100);
    assert.deepEqual(digs(agent.bot), []);

    ({ agent, zombie } = start());
    await F.sleep(TIDY.recheckForMs + 80);
    delete agent.bot.entities[zombie.id];
    await F.sleep(100);
    assert.deepEqual(digs(agent.bot), []);
});

test('a deferred mode-end sweep: an action that started and ended between two polls, a stop in the first tick, or a passed deadline cancels it (P5)', async () => {
    const start = (hostile = true) => {
        const agent = setup();
        placed(agent, 2, 64, 0);
        const zombie = hostile ? F.hostile(agent.bot, 'zombie', [12, 0, 0]) : null;
        agent.work.onModeEnd('self_defense', { interrupted: false });
        return { agent, zombie };
    };
    // Production-like spacing: the action fits between two polls.
    TIDY.recheckMs = 200;
    let { agent, zombie } = start();
    await F.sleep(50);
    await agent.actions.runAction('action:other', () => F.sleep(30));
    delete agent.bot.entities[zombie.id];
    await F.sleep(300);
    assert.deepEqual(digs(agent.bot), []);

    // A stop between the mode's end and the first check.
    ({ agent } = start(false));
    agent.stop_epoch++;
    await F.sleep(80);
    assert.deepEqual(digs(agent.bot), []);

    // The owner's raw !stop before the first callback (its command still translating): no sweep (Q1).
    ({ agent } = start(false));
    agent.bot.emit('chat', F.OWNER, '!stop');
    await F.sleep(80);
    assert.deepEqual(digs(agent.bot), []);

    // The deadline counts from the mode's end, not from the first callback (Q2).
    Object.assign(TIDY, { recheckForMs: 0 });
    ({ agent } = start(false));
    await F.sleep(80);
    assert.deepEqual(digs(agent.bot), []);

    // The next poll comes after the deadline: no launch even with the hostile gone.
    Object.assign(TIDY, { recheckMs: 150, recheckForMs: 100 });
    ({ agent, zombie } = start());
    await F.sleep(50);
    delete agent.bot.entities[zombie.id];
    await F.sleep(250);
    assert.deepEqual(digs(agent.bot), []);
});

test('after a mode during a live (here paused) task: the runner\'s tidy_after_mode flag is set and no action:tidy starts', async () => {
    const agent = setup();
    placed(agent, 2, 64, 0);
    agent.work.startTask('one dirt', 'obtain item=dirt count=1');
    agent.work.pause('command');
    agent.work.onModeEnd('self_defense', { interrupted: false });
    await F.sleep(60);
    assert.deepEqual([...agent.work.runner.tidyAfterMode], ['mode:self_defense']);
    assert.deepEqual(digs(agent.bot), []);
    assert.equal(agent.actions.executing, false);
    agent.bot.emit('chat', F.OWNER, '!stop');                 // the owner keep cancels it too
    assert.equal(agent.work.runner.tidyAfterMode, null);
    // A raw keep before the first callback: the flag is not set (Q1).
    agent.work.onModeEnd('self_defense', { interrupted: false });
    agent.bot.emit('chat', F.OWNER, '!stop');
    await F.sleep(30);
    assert.equal(agent.work.runner.tidyAfterMode, null);
    // A mode that ends while another action is in flight sets nothing.
    const busy = agent.actions.runAction('action:other', () => F.sleep(80));
    agent.work.onModeEnd('self_defense', { interrupted: false });
    await F.sleep(30);
    assert.equal(agent.work.runner.tidyAfterMode, null);
    await busy;
});

test('the in-task sweep removes only mode-placed scaffold at the start of the next unit, keeps the flag (silently) until it completes, and the flag ends with the task (P8)', async () => {
    let agent = setup({ inventory: { dirt: 1 }, work: { tidy: { enabled: false } } });
    placed(agent, 2, 64, 0);                                   // by mode:self_defense
    placed(agent, -2, 64, 0, { by: 'action:task' });           // the task's own access block
    let zombie = F.hostile(agent.bot, 'zombie', [12, 0, 0]);   // within 16, outside the resume check's 8
    const log = agent.work.log;
    let sweeps = 0;
    agent.work.log = message => {
        log(message);
        if (!/^tidy \(after a mode, in the task\)/.test(message)) return;
        sweeps++;
        if (/ended: a hostile is near/.test(message)) delete agent.bot.entities[zombie.id];   // it goes away during step 1
    };
    agent.work.startTask('two dirt steps', 'obtain item=dirt count=1; obtain item=dirt count=1');
    agent.work.runner.tidyAfterMode = new Set(['mode:self_defense']);   // a mode ended in it (a new task clears the flag)
    await F.until(() => agent.work.record.status === 'done');
    await idle(agent);
    assert.equal(sweeps, 2);                                   // ended by the hostile, then complete
    assert.deepEqual(digs(agent.bot), ['(2, 64, 0)']);
    assert.equal(agent.work.runner.tidyAfterMode, null);
    assert.equal(kindAt(agent, -2, 64, 0), 'scaffold');
    await F.sleep(30);
    assert.deepEqual(agent.chats.filter(c => c.startsWith('Removed')), ['Removed 1 of my scaffold block here.']);

    // A hostile that stays: no line in any unit, and the flag ends with the task.
    agent = setup({ inventory: { dirt: 1 }, work: { tidy: { enabled: false } } });
    placed(agent, 2, 64, 0);
    zombie = F.hostile(agent.bot, 'zombie', [12, 0, 0]);
    agent.work.startTask('two dirt steps', 'obtain item=dirt count=1; obtain item=dirt count=1');
    agent.work.runner.tidyAfterMode = new Set(['mode:self_defense']);
    await F.until(() => agent.work.record.status === 'done');
    await idle(agent);
    await F.sleep(30);
    assert.deepEqual(digs(agent.bot), []);
    assert.equal(agent.work.runner.tidyAfterMode, null);
    assert.ok(!agent.chats.some(c => c.startsWith('Removed')), agent.chats.join('\n'));
});

test('a fight that interrupts a sweep prompts no model call; the sweep after it supersedes the remainder and finishes', async () => {
    const agent = setup({ modes: { self_defense: true }, drive: true });
    const { bot } = agent;
    for (const x of [-2, 2, 3]) placed(agent, x, 64, 0);
    let first = true;
    bot.hooks.dig = async () => {
        if (!first) return;
        first = false;
        F.hostile(bot, 'zombie', [3, 0, 2]);
        await F.until(() => bot.interrupt_code, { timeout: 2000 });
    };
    void tidyNow(agent);
    await F.until(() => live(agent).every(e => e.kind !== 'scaffold'), { timeout: 8000 });
    await idle(agent);
    assert.equal(agent.modelCalls, 0);
    assert.ok(!agent.turns.some(t => /AUTO MESSAGE/.test(t.content)));
    assert.equal(agent.work.tidy.remainder, null);
});

test('control: a fight that interrupts another action does prompt the model (the upstream rule the carry narrows)', async () => {
    const agent = setup({ modes: { self_defense: true }, drive: true });
    const { bot } = agent;
    void agent.actions.runAction('action:other', async () => {
        F.hostile(bot, 'zombie', [3, 0, 2]);
        await F.until(() => bot.interrupt_code, { timeout: 2000 });
    });
    await F.until(() => agent.turns.some(t => /AUTO MESSAGE/.test(t.content)), { timeout: 6000 });
});

test('a fight during !followPlayer resumes following before any tidy', async () => {
    const agent = setup({ modes: { self_defense: true }, inventory: { cobblestone: 4 }, drive: true });
    const { bot } = agent;
    agent.work.ledger.settleMs = 20;
    let follows = 0;
    const follow = async () => {
        follows++;
        while (!bot.interrupt_code) await F.sleep(10);
    };
    const attack = bot.pvp.attack;
    let fought = false;
    bot.pvp.attack = entity => {
        if (!fought) { fought = true; void pillar(bot, 1); }
        attack.call(bot.pvp, entity);
    };
    void agent.actions.runAction('action:followPlayer', follow, { resume: true });
    await F.until(() => follows === 1);
    F.hostile(bot, 'zombie', [3, 0, 0]);
    await F.until(() => follows === 2, { timeout: 6000 });
    await F.sleep(150);
    assert.deepEqual(digs(bot), []);
    assert.equal(agent.actions.currentActionLabel, 'action:followPlayer');
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('work.tidy.announce off: an automatic sweep says nothing; work.tidy merges one level deep', async () => {
    const agent = setup({ work: { tidy: { announce: false } } });
    assert.deepEqual(agent.work.config.tidy, { enabled: true, announce: false });
    placed(agent, 2, 64, 0);
    agent.work.onModeEnd('self_defense', { interrupted: false });
    await F.until(() => digs(agent.bot).length === 1);
    await idle(agent);
    await F.sleep(50);
    assert.ok(!agent.chats.some(c => c.startsWith('Removed')), agent.chats.join('\n'));
});
