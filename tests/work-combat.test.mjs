import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createRequire } from 'node:module';
import * as F from './work-fixture.mjs';

// Combat (SPEC §7.10, REQ-CMB-1 … 9; design combat/recommended-design.md r10
// §9): whom she fights, the easy path, the fight, the leash, the walk back,
// following and travelling. A fixture bot with a fake clock; the real
// mineflayer-pvp plugin, and the real pathfinder where the design says so.
// Metadata and damage come in the shapes probe P18 logged.
const require = createRequire(import.meta.url);
const { pf, world: W, combat: CB, config: K } = F.modules;
const { COMBAT, fightMovements } = CB;
const DEFAULTS = { ...COMBAT };
const FOLLOW = 'action:followPlayer';
const agents = [];
const stops = [];
let onTick = null;
afterEach(() => {
    stops.splice(0).forEach(stop => stop());
    F.cleanup(agents.splice(0));
    Object.assign(COMBAT, DEFAULTS);
    onTick = null;
});

// The owner's profile (design §7).
const PROFILE = { ranged: ['skeleton', 'stray', 'bogged', 'parched'], ranged_radius: 16, path_digs: 3, give_up_s: 15, leash: 16, travel_speed: 2 };

// P18 (runtime/diagnostics/i1-build/combat/p18-lines.txt), as logged.
const P18 = {
    aggro: [{ key: 8, type: 'byte', value: 1 }, { key: 15, type: 'byte', value: 4 }],       // t17013 skeleton#119078@14.6
    health: [{ key: 9, type: 'float', value: 8 }],                                          // t16967 skeleton#119078@11.8
    draw: [{ key: 8, type: 'byte', value: 0 }],                                             // t17033: the bow released; the bit stays
    dying: [{ key: 6, type: 'pose', value: 7 }, { key: 9, type: 'float', value: 0 }, { key: 15, type: 'byte', value: 0 }], // t17476
    arrow: { entityId: 118244, sourceTypeId: 0, sourceCauseId: 119079, sourceDirectId: 119260 }, // t17099, skeleton#119078's arrow
    me: 118244,
};
// mineflayer entities.js:980-988 (parseMetadata): each entry sets metadata[key] = value.
const meta = (e, entries) => { for (const { key, value } of entries) e.metadata[key] = value; };
// entities.js:425-429: damage_event's source is the entity sourceCauseId - 1.
const damage = (bot, raw) => bot.emit('entityHurt', raw.entityId === bot.entity.id ? bot.entity : bot.entities[raw.entityId], bot.entities[raw.sourceCauseId - 1]);

function mob(bot, name, offset, id = null) {
    const e = F.hostile(bot, name, offset);
    if (id != null) {
        delete bot.entities[e.id];
        e.id = id;
        bot.entities[id] = e;
    }
    return e;
}
const at = (x, y, z) => new F.Vec3(x, y, z);

function flat(r = 40) {
    const world = new F.World();
    world.fill(-r, 63, -r, r, 63, r, 'stone');
    return world;
}

// Records pvp's attacks and force stops, the goals and the mode pauses, in order.
function spy(bot) {
    const trace = [];
    const wrap = (obj, name, record) => {
        const fn = obj[name];
        obj[name] = function (...args) { trace.push(record(...args)); return fn.apply(this, args); };
    };
    wrap(bot.pvp, 'attack', e => ['attack', e?.id]);
    wrap(bot.pvp, 'forceStop', () => ['forceStop']);
    wrap(bot.pathfinder, 'setGoal', g => ['goal', g ? g.constructor.name : null, g]);
    wrap(bot.modes, 'pause', m => ['pause', m]);
    wrap(bot.modes, 'unpause', m => ['unpause', m]);
    return trace;
}
// Collects the console.log lines (the [combat] log) until the test ends.
function logs() {
    const lines = [];
    const log = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    stops.push(() => { console.log = log; });
    return lines;
}
const kinds = (trace, ...names) => trace.filter(t => names.includes(t[0])).map(t => (t[0] === 'goal' ? `goal:${t[1]}` : t[0]));

let n = 0;
// fake: the fight's waits advance the fake clock (and run onTick) at once.
function setup({ world = flat(), position = [0.5, 64, 0.5], combat = PROFILE, modes = { self_defense: true }, realPath = false, fake = true, inventory } = {}) {
    const bot = F.makeBot({ world, position, inventory });
    bot.entity.id = P18.me;
    bot.entity.velocity = new F.Vec3(0, 0, 0);
    bot.controlState = {};
    if (realPath) pf.pathfinder(bot);
    require('mineflayer-pvp').plugin(bot);
    const clock = F.clock();
    const agent = F.makeAgent({ bot, modes, work: { combat }, name: `combat${n++}` });
    F.clearRecord(agent);
    F.startWork(agent, fake ? { now: clock.now } : {});
    agents.push(agent);
    const c = agent.work.combat;
    const trace = spy(bot);
    c.wait = async ms => {
        if (fake) clock.advance(ms / 1000); else await F.sleep(ms);
        if (onTick) await onTick();
        await F.sleep(0);
    };
    return { agent, bot, clock, c, trace };
}
const fight = (c, target, opts = {}) => c.fight(target, { epoch: c.agent.stop_epoch, ...opts });
// The follow pending, as ActionManager leaves it while a fight cut it.
function following(agent) {
    agent.actions.resume_func = async () => {};
    agent.actions.resume_name = FOLLOW;
}
function owner(bot, pos = [0.5, 64, 0.5]) {
    return F.player(bot, F.OWNER, pos);
}

// --- §2: whom she fights -------------------------------------------------------

test('§2: the mob_flags index comes from the registry; the aggressive bit (P18) engages, a missing index or a non-number does not', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0], 119078);
    assert.equal(c.indexOf('skeleton').flags, F.registry.entitiesByName.skeleton.metadataKeys.indexOf('mob_flags'));
    assert.equal(c.indexOf('skeleton').flags, 15);
    meta(s, P18.health);
    assert.equal(c.engaged(s, clock.now()), null, 'health alone is no aggro');
    meta(s, P18.aggro);
    assert.equal(c.engaged(s, clock.now()), 'aggressive');
    meta(s, P18.draw);
    assert.equal(c.engaged(s, clock.now()), 'aggressive', 'the bow released, the bit stays');
    meta(s, P18.dying);
    assert.equal(c.engaged(s, clock.now()), null);
    s.metadata[15] = 2;   // left-handed, no target
    assert.equal(c.engaged(s, clock.now()), null, 'only the aggressive bit');
    s.metadata[15] = 6;
    assert.equal(c.engaged(s, clock.now()), 'aggressive');
    const unknown = { id: 7, name: 'no_such_mob', type: 'hostile', position: at(5, 64, 0), metadata: { 15: 4 } };
    assert.equal(c.engaged(unknown, clock.now()), null, 'a missing index reads as not aggressive');
    s.metadata[15] = { value: 4 };
    assert.equal(c.engaged(s, clock.now()), null, 'a non-number reads as not aggressive');
    assert.equal(c.indexes.size, 2, 'one lookup per name');
});

test('§2: a hit on her (P18 damage_event) engages its source for 5 s; another entity\'s hurt or a hurt with no source does not', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [11.5, 0, 0], 119078);
    const other = mob(bot, 'zombie', [20, 0, 0]);
    bot.emit('entityHurt', other, s);
    bot.emit('entityHurt', bot.entity, undefined);
    assert.equal(c.engaged(s, clock.now()), null);
    damage(bot, P18.arrow);
    assert.equal(c.engaged(s, clock.now()), 'hit her');
    clock.advance(4.9);
    assert.equal(c.engaged(s, clock.now()), 'hit her');
    clock.advance(0.1);
    assert.equal(c.engaged(s, clock.now()), null, 'forgotten at 5 s');
});

test('§2: melee first: a zombie within 8 wins over an aggroed skeleton; an aggroed skeleton at 12 is picked; one not aggroed is not', async () => {
    const { bot, c } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    assert.equal(await c.pick(), null, 'not aggroed');
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);
    const z = mob(bot, 'zombie', [6, 0, 0]);
    assert.equal(await c.pick(), z);
    assert.equal(await c.pick({ fight: { target: s } }), z, 'also in a fight');
});

test('§2: the public default fights no ranged mob early: an aggroed skeleton at 12 is not picked', async () => {
    const { bot, c } = setup({ combat: {} });
    meta(mob(bot, 'skeleton', [12, 0, 0]), P18.aggro);
    assert.equal(await c.pick(), null);
    assert.deepEqual(K.loadWorkConfig({}).combat, { ranged: [], ranged_radius: 16, path_digs: 3, give_up_s: 15, leash: 16, travel_speed: 0 });
    assert.deepEqual(K.loadWorkConfig({ combat: { leash: 12 } }).combat.ranged_radius, 16, 'merged one level');
});

test('§7: unknown mob names in work.combat.ranged are logged and dropped at Work.init; a bad number keeps its default', async () => {
    const { c } = setup({ combat: { ranged: ['skeleton', 'parched', 'skelly', 7], leash: -1, path_digs: 2.5, travel_speed: 2 } });
    assert.deepEqual([...c.ranged], ['skeleton', 'parched']);
    assert.deepEqual(c.config, { ranged_radius: 16, path_digs: 3, give_up_s: 15, leash: 16, travel_speed: 2 });
    const { c: none } = setup({ combat: { ranged: 'skeleton' } });
    assert.equal(none.ranged.size, 0);
});

test('§2: at most one path search per update; a verdict is cached 3 s per entity, or until the target moved more than 4', async () => {
    const { bot, c, clock } = setup();
    const searches = [];
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function (m, start, goal, opts) { if (opts.timeout === COMBAT.searchMs) searches.push(goal.x); return get.call(this, m, start, goal, opts); };
    bot.hooks.noPath = true;   // neither is easy
    const a = mob(bot, 'skeleton', [10, 0, 0]);
    const b = mob(bot, 'skeleton', [12, 0, 0]);
    meta(a, P18.aggro);
    meta(b, P18.aggro);
    assert.equal(await c.pick(), null);
    assert.equal(searches.length, 1, 'the nearest only');
    assert.equal(await c.pick(), null);
    assert.equal(searches.length, 2, 'the next update searches the other');
    assert.equal(await c.pick(), null);
    assert.equal(searches.length, 2, 'both cached');
    a.position = a.position.offset(3, 0, 0);
    assert.equal(await c.pick(), null);
    assert.equal(searches.length, 2, 'moved 3: still cached');
    a.position = a.position.offset(2, 0, 0);
    await c.pick();
    assert.equal(searches.length, 3, 'moved 5: searched again');
    clock.advance(3);
    await c.pick();
    await c.pick();
    assert.equal(searches.length, 5, 'lapsed after 3 s: one search per update');
    bot.hooks.noPath = false;
    clock.advance(3);
    assert.equal(await c.pick(), b, 'b is nearer now and easy');
});

// --- §3: an easy path, on the real pathfinder -----------------------------------------

const corridor = thick => {
    const world = new F.World();
    world.fill(-3, 63, -3, 16, 63, 3, 'stone');
    world.fill(5, 64, -3, 4 + thick, 66, 3, 'stone');
    return world;
};

test('§3 on the real pathfinder: open ground and a 2-dig wall are easy; a 4-dig wall, a long detour and a pillar are not', async () => {
    const check = (world, pos, inventory) => {
        const { bot, c } = setup({ world, realPath: true, inventory });
        return c.easyPath({ position: at(...pos) });
    };
    const open = check(flat(), [12.5, 64, 0.5]);
    assert.deepEqual([open.easy, open.digs], [true, 0]);
    const one = check(corridor(1), [10.5, 64, 0.5]);
    assert.deepEqual([one.easy, one.digs], [true, 2]);
    const two = check(corridor(2), [10.5, 64, 0.5]);
    assert.deepEqual([two.easy, two.why], [false, '4 digs']);
    const wall = gap => {
        const world = flat(30);
        world.fill(5, 64, -30, 5, 66, 30, 'bedrock');
        world.fill(5, 64, gap, 5, 65, gap, 'air');
        return world;
    };
    const near = check(wall(3), [10.5, 64, 0.5]);
    assert.equal(near.easy, true, 'a short way around');
    COMBAT.searchMs = 500;   // the long way around takes about 45 ms alone: room for a loaded test run (the bound is what is tested)
    const far = check(wall(20), [10.5, 64, 0.5]);
    assert.equal(far.easy, false);
    assert.match(far.why, /detour/);
    const pillar = flat(20);
    pillar.fill(8, 64, 0, 8, 66, 0, 'bedrock');
    const up = check(pillar, [8.5, 67, 0.5], { cobblestone: 64 });
    assert.equal(up.easy, false, 'no towering in a fight');
    const m = fightMovements(F.makeBot());
    assert.deepEqual([m.canOpenDoors, m.scafoldingBlocks, m.allow1by1towers, m.digCost], [false, [], false, new pf.Movements(F.makeBot()).digCost]);
});

test('§1 (REQ-CMB-2): isClearPath places nothing: a zombie on a pillar she could tower to with cobblestone has no clear path', async () => {
    const world = flat(20);
    world.fill(3, 64, 0, 3, 65, 0, 'bedrock');
    const { bot } = setup({ world, realPath: true, inventory: { cobblestone: 64 } });
    const z = mob(bot, 'zombie', [3, 2, 0]);   // standing on the pillar, at y 66
    assert.equal(await W.isClearPath(bot, z), false);
    const ground = mob(bot, 'zombie', [5, 0, 0]);
    assert.equal(await W.isClearPath(bot, ground), true);
});

test('§1 (REQ-CMB-2): isClearPath leaves the path she is walking alone (getPathTo replaced its search, so her next tick walked to the mob)', async () => {
    const { bot } = setup({ world: flat(40), realPath: true });
    const updates = [];
    bot.on('path_update', r => updates.push(r.context?.goal));
    const mine = new pf.goals.GoalNear(35, 64, 0, 1);
    bot.pathfinder.tickTimeout = -1;   // her search stays partial: the pathfinder continues it on later ticks
    bot.pathfinder.setGoal(mine);
    bot.emit('physicsTick');
    bot.pathfinder.tickTimeout = 40;
    assert.equal(updates.at(-1), mine);
    const z = mob(bot, 'zombie', [5, 0, 5]);
    await W.isClearPath(bot, z);
    try { bot.emit('physicsTick'); } catch { /* the fixture lacks the physics for her step; the update came first */ }
    assert.equal(updates.at(-1), mine, 'her next tick continues her own search');
});

// --- §4: the fight -------------------------------------------------------------

test('§4: a fight on a zombie: modes paused, forceStop before every attack and before the walk back, unpaused in finally; no pending attack overwrites the walk back', async () => {
    const { bot, c, trace } = setup();
    const a = mob(bot, 'zombie', [3, 0, 0]);
    let tick = 0;
    let b = null;
    onTick = () => {
        tick++;
        if (tick === 1) { bot.entity.position = at(5.5, 64, 0.5); delete bot.entities[a.id]; b = mob(bot, 'zombie', [2, 0, 0]); }
        if (tick === 2) assert.deepEqual(c.anchor.pos, at(0.5, 64, 0.5), 'kept across fights');
        if (tick === 3) delete bot.entities[b.id];
        if (tick === 5) bot.entity.position = at(1, 64, 0.5);
    };
    await fight(c, a);
    // pvp's forceStop clears the goal itself when it had a target (PVP.js forceStop).
    assert.deepEqual(kinds(trace, 'attack', 'forceStop', 'goal').filter(k => k !== 'goal:GoalFollow'),
        ['forceStop', 'attack', 'forceStop', 'goal:null', 'attack', 'forceStop', 'goal:null', 'goal:null', 'goal:GoalNear', 'forceStop', 'goal:null']);
    assert.equal(trace.filter(t => t[1] === 'GoalFollow').length, 2, 'one chase goal per attack');
    const near = trace.find(t => t[1] === 'GoalNear')[2];
    assert.deepEqual([near.x, near.y, near.z, near.rangeSq], [0, 64, 0, 1]);
    assert.deepEqual(trace.filter(t => t[0] === 'pause' || t[0] === 'unpause').map(t => t.join(' ')),
        ['pause self_defense', 'pause cowardice', 'unpause self_defense', 'unpause cowardice']);
    assert.equal(c.anchor, null);
    assert.equal(bot.pvp.target, undefined);
    assert.equal(bot.pathfinder.goal, null);
});

test('§4: !stop mid-switch: an attack that resolves after the interrupt leaves no pvp target or goal', async () => {
    const { bot, c } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    const attack = bot.pvp.attack;
    // requestInterrupt lands in the switch, and the attack settles later (its stop() can wait for path_stop)
    bot.pvp.attack = async function (e) { bot.interrupt_code = true; await F.sleep(5); return attack.call(this, e); };
    await fight(c, z);
    await F.sleep(20);
    assert.equal(bot.pvp.target, undefined);
    assert.equal(bot.pathfinder.goal, null);
    assert.equal(c.anchor, null);
});

test('§4: !stop mid-fight and mid-walk exits at once, with no walk back and no stale pvp target or goal', async () => {
    for (const when of ['fight', 'walk']) {
        const { bot, c, trace } = setup();
        const z = mob(bot, 'zombie', [3, 0, 0]);
        let tick = 0;
        onTick = () => {
            tick++;
            if (when === 'fight' && tick === 2) bot.interrupt_code = true;
            if (when === 'walk' && tick === 1) { bot.entity.position = at(6.5, 64, 0.5); delete bot.entities[z.id]; }
            if (when === 'walk' && tick === 3) bot.interrupt_code = true;
        };
        await fight(c, z);
        assert.equal(tick, when === 'fight' ? 2 : 3, when);
        assert.equal(bot.pvp.target, undefined, when);
        assert.equal(bot.pathfinder.goal, null, when);
        assert.equal(c.anchor, null, when);
        assert.equal(trace.filter(t => t[1] === 'GoalNear').length, when === 'walk' ? 1 : 0, when);
        assert.ok(trace.some(t => t.join(' ') === 'unpause self_defense'), when);
    }
});

test('§4: give up a target whose health has not dropped for give_up_s: ignored 60 s; a drop restarts the clock', async () => {
    const { bot, c, clock } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    let t0 = clock.now();
    onTick = () => { if (clock.now() - t0 === 10000) meta(z, P18.health); };   // her hit at 10 s
    await fight(c, z);
    assert.equal(clock.now() - t0, 25000, 'given up 15 s after the last drop');
    assert.equal(c.isIgnored(z, clock.now()), true);
    clock.advance(59);
    assert.equal(await c.pick(), null);
    clock.advance(1);
    assert.equal(await c.pick(), z, 'ignored 60 s');
});

test('§4: digs during a chase are counted through the bot.dig wrapper across a path reset; an aborted dig is not; more than path_digs gives the target up', async () => {
    const { bot, c, clock } = setup();
    const z = mob(bot, 'zombie', [5, 0, 0]);
    const dig = bot.dig;
    let tick = 0;
    onTick = async () => {
        tick++;
        if (tick > 4) return;
        if (tick === 2) {
            bot.hooks.dig = async () => { bot.digStopped = true; };   // stopDigging: the dig rejects
            await bot.dig(bot.blockAt(at(9, 63, 9))).catch(() => {});
            bot.hooks.dig = null;
        }
        await bot.dig(bot.blockAt(at(tick, 63, 9)));
        bot.removeAllListeners('diggingCompleted');   // pathfinder index.js:126-130 on every path reset mid-dig
    };
    await fight(c, z);
    assert.equal(tick, 4, 'given up after the fourth counted dig (the aborted one not counted)');
    assert.equal(c.isIgnored(z, clock.now()), true);
    assert.equal(bot.dig, dig, 'restored');
});

test('§4: the dig count lives on the fight: a dig that completes after its fight ended never counts into the next one', async () => {
    const { bot, c, clock } = setup();
    const z = mob(bot, 'zombie', [5, 0, 0]);
    let release = null;
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 1) {
            bot.hooks.dig = () => new Promise(resolve => { release = resolve; });
            void bot.dig(bot.blockAt(at(9, 63, 9)));   // still digging when the fight ends
        }
        if (tick === 2) bot.interrupt_code = true;
    };
    await fight(c, z);
    bot.hooks.dig = null;
    bot.interrupt_code = false;   // the next action's clearBotLogs
    tick = 0;
    let given = null;
    onTick = async () => {
        tick++;
        if (tick <= 3) await bot.dig(bot.blockAt(at(tick, 63, 9)));   // three digs: at the bound, not above
        if (tick === 3) { release(); await F.sleep(1); }
        if (tick === 5) { given = c.isIgnored(z, clock.now()); bot.interrupt_code = true; }
    };
    await fight(c, z);
    assert.equal(given, false);
});

test('§4: the chase stays easy: a ranged target whose path is no longer easy is dropped and ignored 10 s', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s, 'the mode\'s pick: the verdict at 0 s');
    let tick = 0;
    onTick = () => { if (++tick === 2) bot.hooks.noPath = true; };
    await fight(c, s);
    assert.equal(tick, 6, 'dropped when the 3 s verdict lapsed');
    assert.equal(c.isIgnored(s, clock.now()), true);
    clock.advance(10);
    assert.equal(c.isIgnored(s, clock.now()), false);
});

test('§4 (P18): a skeleton aggroed at 14.6 is still the target at 1 s and 3 s', async () => {
    const { bot, c } = setup();
    const s = mob(bot, 'skeleton', [14.6, 0, 0], 119078);
    meta(s, P18.aggro);
    const seen = [];
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 2 || tick === 6) seen.push(c.current.target);
        s.position = s.position.offset(-0.3, 0, 0);   // P18: 14.6 → 13.0 in a second
        if (tick === 7) delete bot.entities[s.id];
    };
    assert.equal(await c.pick(), s);
    await fight(c, s);
    assert.deepEqual(seen, [s, s]);
});

test('§4: the leash on her: beyond 16 from the anchor the ranged target is dropped (ignored 10 s) and she walks back, then the fight ends', async () => {
    const { bot, c, clock, trace } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    let tick = 0;
    let walked = false;
    onTick = () => {
        tick++;
        const goal = bot.pathfinder.goal;
        if (goal?.constructor.name === 'GoalNear') { walked = true; bot.entity.position = at(1.5, 64, 0.5); return; }
        bot.entity.position = bot.entity.position.offset(3, 0, 0);   // she chases, it backs off
        s.position = s.position.offset(3, 0, 0);
    };
    await fight(c, s);
    assert.equal(walked, true);
    assert.equal(c.isIgnored(s, clock.now()), true);
    assert.ok(trace.some(t => t[1] === 'GoalNear'));
    assert.equal(c.anchor, null);
});

test('§2/§4: a new ranged target beyond 16 of the anchor is not admitted; one within is', async () => {
    const { bot, c } = setup();
    const a = mob(bot, 'zombie', [3, 0, 0]);
    let tick = 0;
    let far = null;
    let near = null;
    let picked = null;
    onTick = async () => {
        tick++;
        if (tick === 1) {
            bot.entity.position = at(6.5, 64, 0.5);
            delete bot.entities[a.id];
            far = mob(bot, 'skeleton', [16, 0, 0]);   // 16 from her, 22 from the anchor
            meta(far, P18.aggro);
        }
        if (tick === 2) picked = c.current.target;
        if (tick === 3) { near = mob(bot, 'skeleton', [-12, 0, 0]); meta(near, P18.aggro); }   // 12 from her, 6 from the anchor
        if (tick === 4) { picked = [picked, c.current.target]; delete bot.entities[near.id]; delete bot.entities[far.id]; bot.entity.position = at(0.5, 64, 0.5); }
    };
    await fight(c, a);
    assert.deepEqual(picked, [null, near]);
});

test('§4: after a leash drop a melee mob at 6 is not chased (never ignored for the leash); one that follows her within 3 is fought', async () => {
    const { bot, c, clock, trace } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick <= 5) {                                    // the chase out to 18
            bot.entity.position = bot.entity.position.offset(3.5, 0, 0);
            z.position = bot.entity.position.offset(6, 0, 0);
        } else if (tick <= 8) {                             // she walks back, it keeps its distance
            bot.entity.position = bot.entity.position.offset(-1, 0, 0);
            z.position = bot.entity.position.offset(6, 0, 0);
        } else if (tick === 9) {
            z.position = bot.entity.position.offset(2, 0, 0);   // it closes in
        } else if (tick === 10) {
            delete bot.entities[z.id];
            bot.entity.position = at(1, 64, 0.5);
        }
    };
    await fight(c, z);
    assert.equal(c.isIgnored(z, clock.now()), false, 'melee is never ignored for the leash');
    const order = kinds(trace, 'attack', 'goal').filter(k => k !== 'goal:GoalFollow' && k !== 'goal:null');
    assert.deepEqual(order, ['attack', 'goal:GoalNear', 'attack'], 'the follower killed beside the anchor: no second walk');
});

test('§4: beyond the leash a melee target within 3 of her is kept (no leash drop, no shuttle); it dies and she walks back', async () => {
    const { bot, c, trace } = setup();
    const z = mob(bot, 'zombie', [2, 0, 0]);
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick <= 8) {                                    // she backs off to 20 with it on her heels
            bot.entity.position = bot.entity.position.offset(2.5, 0, 0);
            z.position = bot.entity.position.offset(2, 0, 0);
        } else if (tick === 9) delete bot.entities[z.id];
        else if (bot.pathfinder.goal?.constructor.name === 'GoalNear') bot.entity.position = at(1, 64, 0.5);
    };
    await fight(c, z);
    const order = kinds(trace, 'attack', 'goal').filter(k => k !== 'goal:GoalFollow' && k !== 'goal:null');
    assert.deepEqual(order, ['attack', 'goal:GoalNear'], 'one attack, then the walk back');
    assert.equal(c.anchor, null);
});

// --- §5: the anchor and the walk back --------------------------------------------------

test('§5: the anchor is cleared on death, a dimension change and a teleport mid-fight; then no walk back', async () => {
    for (const event of ['death', 'dimension', 'teleport']) {
        const { bot, c, trace } = setup();
        const z = mob(bot, 'zombie', [3, 0, 0]);
        let tick = 0;
        onTick = () => {
            tick++;
            if (tick === 1) {
                bot.entity.position = at(6.5, 64, 0.5);
                if (event === 'death') bot.emit('death');
                if (event === 'dimension') bot.game.dimension = 'the_nether';
                if (event === 'teleport') bot.entity.position = at(40.5, 64, 0.5);
            }
            if (tick === 2) delete bot.entities[z.id];
        };
        await fight(c, z);
        assert.equal(c.anchor, null, event);
        assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 0, event);
    }
});

test('§5: a fight cut by another mode clears the anchor and does not walk back', async () => {
    const { agent, bot, c, trace } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    onTick = () => { bot.entity.position = at(6.5, 64, 0.5); };
    const run = agent.actions.runAction('mode:self_defense', () => fight(c, z));
    await F.until(() => c.anchor);
    await agent.actions.runAction('mode:unstuck', async () => {});
    await run;
    assert.equal(c.anchor, null);
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 0);
});

test('§5: the walk back gives up after 30 s or a noPath, clears the anchor and ends', async () => {
    for (const how of ['timeout', 'noPath']) {
        const { bot, c, clock } = setup();
        const z = mob(bot, 'zombie', [3, 0, 0]);
        let tick = 0;
        let started = null;
        onTick = () => {
            tick++;
            if (tick === 1) { bot.entity.position = at(8.5, 64, 0.5); delete bot.entities[z.id]; }
            if (bot.pathfinder.goal?.constructor.name === 'GoalNear') {
                started ??= clock.now();
                if (how === 'noPath') bot.emit('path_update', { status: 'noPath', path: [] });
            }
        };
        await fight(c, z);
        assert.equal(c.anchor, null, how);
        const walked = clock.now() - started;
        if (how === 'timeout') assert.equal(walked, COMBAT.walkBackMs - COMBAT.tickMs, how);   // seen one tick after the goal was set
        else assert.ok(walked <= 500, how);
    }
});

// --- §5, §6 on the real ActionManager (real time, short ticks) ---------------------------

test('§5 in a task: the fight walks back before idle, then the task resumes', async () => {
    COMBAT.tickMs = 20;
    const { agent, bot, c, trace } = setup({ fake: false });
    owner(bot, [0.5, 64, 5]);
    let release = false;
    bot.hooks.goto = async () => {
        trace.push(['goto']);
        await F.until(() => release || bot.interrupt_code, { timeout: 60000 });
    };
    agent.work.startTask('walk', 'go_to target=20,64,0');
    await F.until(() => trace.some(t => t[0] === 'goto'));
    stops.push(F.drive(agent));
    const z = mob(bot, 'zombie', [3, 0, 0]);
    onTick = () => {
        if (bot.entities[z.id]) { bot.entity.position = at(7.5, 64, 0.5); delete bot.entities[z.id]; return; }
        if (bot.pathfinder.goal?.constructor.name === 'GoalNear') { bot.entity.position = at(1, 64, 0.5); release = true; }
    };
    await F.until(() => agent.work.record.status === 'done', { timeout: 8000 });
    const order = trace.map(t => (t[0] === 'goal' ? `goal:${t[1]}` : t[0])).filter(k => k === 'goto' || k === 'goal:GoalNear');
    assert.deepEqual(order, ['goto', 'goal:GoalNear', 'goto']);
    assert.equal(agent.work.record.interruptions.last.by, 'mode:self_defense');
    assert.equal(agent.modelCalls, 0);
});

test('§5 with the walk keeper (design travel r4 §0: "the walk-back applies after any fight"): a fight that cuts a typed walk walks back first, then the walk restarts', async () => {
    COMBAT.tickMs = 20;
    const { agent, bot, trace } = setup({ fake: false });
    let release = false;
    let walks = 0;
    bot.hooks.goto = async goal => {
        if (goal.x !== 20) return;
        walks++;
        trace.push(['goto']);
        await F.until(() => release || bot.interrupt_code, { timeout: 60000 });
    };
    const typed = F.ownerSays(agent, '!goToCoordinates(20, 64, 0, 1)');
    await F.until(() => walks === 1);
    stops.push(F.drive(agent));
    const z = mob(bot, 'zombie', [3, 0, 0]);
    onTick = () => {
        if (bot.entities[z.id]) { bot.entity.position = at(7.5, 64, 0.5); delete bot.entities[z.id]; return; }
        if (bot.pathfinder.goal?.constructor.name === 'GoalNear') bot.entity.position = at(1, 64, 0.5);
    };
    await F.until(() => walks === 2, { timeout: 4000 });
    const order = trace.map(t => (t[0] === 'goal' ? `goal:${t[1]}` : t[0])).filter(k => k === 'goto' || k === 'goal:GoalNear');
    assert.deepEqual(order, ['goto', 'goal:GoalNear', 'goto']);
    release = true;
    await typed;
    assert.equal(agent.modelCalls, 0);
});

test('§5 following: the fight skips the walk back, clears the anchor and the follow resumes', async () => {
    COMBAT.tickMs = 20;
    const { agent, bot, c, trace } = setup({ fake: false });
    owner(bot, [0.5, 64, 3.5]);
    bot.hooks.goto = () => new Promise(() => {});
    void F.ownerSays(agent, `!followPlayer("${F.OWNER}", 3)`);
    await F.until(() => agent.actions.currentActionLabel === FOLLOW && bot.pathfinder.goal?.entity);
    stops.push(F.drive(agent));
    const z = mob(bot, 'zombie', [3, 0, 0]);
    onTick = () => { bot.entity.position = at(6.5, 64, 0.5); delete bot.entities[z.id]; };
    await F.until(() => trace.some(t => t[0] === 'attack'));
    await F.until(() => agent.actions.currentActionLabel === FOLLOW, { timeout: 4000 });
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 0);
    assert.equal(c.anchor, null);
    assert.equal(agent.work.follow?.name, F.OWNER, 'the follow target learnt before the fight');
    assert.equal(agent.modelCalls, 0);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('§4: a !stop during runAction\'s stop wait (the old action still stopping) ends the fight at its start (stop_epoch)', async () => {
    COMBAT.tickMs = 20;
    const { agent, bot, c, trace } = setup({ fake: false });
    owner(bot, [0.5, 64, 3.5]);
    void agent.actions.runAction(FOLLOW, async () => {
        await F.until(() => bot.interrupt_code, { timeout: 60000 });
        await F.sleep(400);   // slow to stop: runAction polls every 300 ms
    }, { resume: true, timeout: -1 });
    await F.until(() => agent.actions.currentActionLabel === FOLLOW);
    mob(bot, 'zombie', [3, 0, 0]);
    await bot.modes.update();   // reads stop_epoch, picks the zombie, the fight's runAction waits for the follow
    await F.sleep(50);
    await F.ownerSays(agent, '!stop');
    await F.until(() => !agent.actions.executing, { timeout: 4000 });
    await F.sleep(50);
    assert.equal(trace.filter(t => t[0] === 'attack').length, 0);
    assert.equal(c.anchor, null);
    assert.equal(agent.actions.resume_func, null);
});

test('§6: the resume check is threat(): an ignored target is ignored by both, and nothing is asked while self_defense is off', async () => {
    const { bot, c } = setup();
    const z = mob(bot, 'zombie', [5, 0, 0]);
    assert.equal(await c.threat(), z);
    c.ignore(z, COMBAT.giveUpIgnoreMs);
    assert.equal(await c.threat(), null);
    c.ignored.clear();
    bot.modes.setOn('self_defense', false);
    assert.equal(await c.threat(), null);
});

// --- §4: following, the leash centre and travelling ------------------------------------------

test('§4: while a follow is pending the centre is the followed player (falling back to the anchor when he is not loaded); no new ranged target beyond 16 of him', async () => {
    const { agent, bot, c } = setup({ position: [6.5, 64, 0.5] });
    const him = owner(bot, [0.5, 64, 0.5]);
    following(agent);
    const far = mob(bot, 'skeleton', [11, 0, 0]);   // 11 from her, 17 from him
    meta(far, P18.aggro);
    assert.equal(await c.pick(), null);
    far.position = at(15.5, 64, 0.5);                 // 9 from her, 15 from him
    c.verdicts.clear();
    assert.equal(await c.pick(), far);
    assert.equal(c.centre().pos, him.position);
    delete bot.players[F.OWNER];
    assert.equal(c.centre(), null, 'no anchor outside a fight');
    c.anchor = { pos: at(0.5, 64, 0.5), dim: 'overworld' };
    assert.deepEqual(c.centre(), { pos: c.anchor.pos, followed: false });
});

test('§4: the follow target is learnt while the follow runs and kept for its pending resume (one helper on Work)', async () => {
    const { agent, bot } = setup();
    const alex = F.player(bot, 'alex', [3.5, 64, 0.5]);
    owner(bot);
    const fn = async () => {};
    Object.assign(agent.actions, { resume_func: fn, resume_name: FOLLOW, currentActionLabel: FOLLOW, currentActionFn: fn });
    bot.pathfinder.goal = new pf.goals.GoalFollow(alex, 3);
    assert.equal(agent.work.followTarget(), alex);
    Object.assign(agent.actions, { currentActionLabel: 'mode:self_defense', currentActionFn: () => {} });
    bot.pathfinder.goal = null;
    assert.equal(agent.work.followTarget(), alex, 'cached for the pending follow');
    agent.actions.resume_func = async () => {};
    assert.equal(agent.work.followTarget(), bot.players[F.OWNER].entity, 'another resume: the owner');
});

test('§4: with him at 25 and a spider idling at 6 she resumes the follow (no fight); a spider at 2 is fought', async () => {
    const { agent, bot, c } = setup();
    owner(bot, [25.5, 64, 0.5]);
    following(agent);
    const spider = mob(bot, 'spider', [6, 0, 0]);
    assert.equal(await c.pick(), null);
    spider.position = at(2.5, 64, 0.5);
    assert.equal(await c.pick(), spider);
    meta(mob(bot, 'skeleton', [-10, 0, 0]), P18.aggro);   // 10 from her, within 16 of him? no: 35. And beyond his leash, none
    spider.position = at(9.5, 64, 0.5);
    assert.equal(await c.pick(), null);
});

test('§4: chained fights while following stay within 16 of him: beyond it the fight ends with no walk back', async () => {
    const { agent, bot, c, trace } = setup({ position: [3.5, 64, 0.5] });
    owner(bot, [0.5, 64, 0.5]);
    following(agent);
    const s = mob(bot, 'skeleton', [9, 0, 0]);   // 12 from him
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);
    onTick = () => {
        bot.entity.position = bot.entity.position.offset(3, 0, 0);
        s.position = s.position.offset(3, 0, 0);
    };
    await fight(c, s);
    assert.ok(bot.entity.position.distanceTo(bot.players[F.OWNER].entity.position) <= 16 + 3);
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 0);
    assert.equal(c.anchor, null);
});

// The followed player walks +x at `speed` while she keeps 3 behind him; one
// pick every 0.3 s (the mode's update).
async function walk(c, clock, bot, seconds, speed, { her = true } = {}) {
    const him = bot.players[F.OWNER].entity;
    for (let t = 0; t < seconds - 1e-9; t += 0.3) {
        clock.advance(0.3);
        him.position = him.position.offset(speed * 0.3, 0, 0);
        if (her) bot.entity.position = him.position.offset(-3, 0, 0);
        await c.pick();
    }
}

test('§4 travelling at 4.3 b/s: a skeleton aggroed at 10 and a zombie at 5 are passed, a zombie at 2 is fought; he stops: normal rules', async () => {
    const { agent, bot, c, clock } = setup();
    owner(bot, [3.5, 64, 0.5]);
    following(agent);
    await walk(c, clock, bot, 3, 4.3);
    assert.equal(c.travel, true);
    const her = () => bot.entity.position;
    const s = mob(bot, 'skeleton', [10, 0, 0]);
    meta(s, P18.aggro);
    const z = mob(bot, 'zombie', [5, 0, 0]);
    await walk(c, clock, bot, 0.3, 4.3, { her: false });
    assert.equal(await c.pick(), null);
    z.position = her().offset(2, 0, 0);
    assert.equal(await c.pick(), z);
    z.position = her().offset(5, 0, 0);
    s.position = her().offset(10, 0, 0);
    await walk(c, clock, bot, 2.4, 0, { her: false });
    assert.equal(c.travel, true, 'still travelling 2.4 s after he stopped');
    await walk(c, clock, bot, 3.6, 0, { her: false });
    assert.equal(c.travel, false);
    assert.equal(await c.pick(), z);
});

test('§4 travelling: a running fight on a ranged target ends when he starts moving; that skeleton is ignored 10 s, a melee mob never', async () => {
    const { agent, bot, c, clock, trace } = setup();
    const him = owner(bot, [0.5, 64, 3.5]);
    following(agent);
    const s = mob(bot, 'skeleton', [10, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);
    let tick = 0;
    onTick = () => {
        if (++tick < 2) return;
        him.position = him.position.offset(4.3 * 0.5, 0, 0);
        bot.entity.position = bot.entity.position.offset(4.3 * 0.5, 0, 0);
        s.position = s.position.offset(4.3 * 0.5, 0, 0);
    };
    await fight(c, s);
    assert.equal(c.travel, true);
    assert.equal(c.isIgnored(s, clock.now()), true);
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 0, 'the follow skip');
    // He moves from 1.0 s; the 2.5 s window reaches 2 b/s at 2.5 s (the window still holds his standing start).
    assert.equal(tick, 5, `ended after ${tick} ticks`);
    // A melee target dropped while he travels is not ignored.
    const z = mob(bot, 'zombie', [2, 0, 0]);
    let t2 = 0;
    onTick = () => {
        t2++;
        him.position = him.position.offset(4.3 * 0.5, 0, 0);
        bot.entity.position = bot.entity.position.offset(4.3 * 0.5, 0, 0);
        z.position = bot.entity.position.offset(t2 >= 2 ? 6 : 2, 0, 0);
    };
    await fight(c, z);
    assert.equal(c.isIgnored(z, clock.now()), false);
    assert.ok(t2 <= 3);
});

test('§4 travelling: samples continue during a fight; an unknown speed (no 2.5–3.5 s sample, none in the last second, after a 20 s pause) is not travelling', async () => {
    const { agent, bot, c, clock } = setup();
    const him = owner(bot, [3.5, 64, 0.5]);
    await walk(c, clock, bot, 3, 4.3);
    assert.deepEqual([c.samples.length, c.travel], [0, false], 'sampled only while the follow check holds');
    following(agent);
    await walk(c, clock, bot, 1.5, 4.3);
    assert.equal(c.travel, false, '1.5 s of samples: no 2.5 s sample yet');
    c.samples = [];
    clock.advance(10);
    const z = mob(bot, 'zombie', [3, 0, 0]);
    const lengths = [];
    let tick = 0;
    onTick = () => { lengths.push(c.samples.length); if (++tick === 4) delete bot.entities[z.id]; };
    await fight(c, z);
    assert.deepEqual(lengths, [0, 1, 2, 3]);
    // A pause of 20 s: he moved 86 blocks meanwhile, but no sample is 2.5–3.5 s old.
    await walk(c, clock, bot, 0.3, 0);
    clock.advance(20);
    him.position = him.position.offset(86, 0, 0);
    await c.pick();
    assert.equal(c.speed(clock.now()), null);
    assert.equal(c.travel, false);
    // None in the last second.
    c.samples = [{ t: clock.now() - 3000, x: 0, y: 64, z: 0 }, { t: clock.now() - 1500, x: 10, y: 64, z: 0 }];
    assert.equal(c.speed(clock.now()), null);
    c.samples.push({ t: clock.now() - 500, x: 12, y: 64, z: 0 });
    assert.equal(Math.round(c.speed(clock.now())), 5);
    // The buffer is cleared when the followed entity changes.
    const other = F.player(bot, F.OWNER, [0.5, 64, 9.5]);
    await c.pick();
    assert.deepEqual(c.samples.map(s => s.x), [other.position.x]);
});

test('§4 travelling: two thresholds: at 1.5 b/s (between half and travel_speed) he stays travelling; below half he stops after 3 s', async () => {
    const { agent, bot, c, clock } = setup();
    owner(bot, [3.5, 64, 0.5]);
    following(agent);
    await walk(c, clock, bot, 3, 4.3);
    assert.equal(c.travel, true);
    await walk(c, clock, bot, 9, 1.5);
    assert.equal(c.travel, true, 'not below half');
    await walk(c, clock, bot, 3.6, 0.5);   // the window falls below 1 within about 2.5 s of the slow-down
    assert.equal(c.travel, true, 'not yet 3 s below half');
    await walk(c, clock, bot, 3, 0.5);
    assert.equal(c.travel, false);
});

test('§4/§5: a leash drop while the follow is pending ends the fight at once (the follow skip), even with a zombie within 3', async () => {
    const { agent, bot, c, trace } = setup({ position: [3.5, 64, 0.5] });
    owner(bot, [0.5, 64, 0.5]);
    following(agent);
    const s = mob(bot, 'skeleton', [9, 0, 0]);
    meta(s, P18.aggro);
    let tick = 0;
    onTick = () => {
        tick++;
        bot.entity.position = at(17.5, 64, 0.5);   // 17 from him
        s.position = at(25.5, 64, 0.5);
        if (tick === 1) mob(bot, 'zombie', [2, 0, 0]);
    };
    await fight(c, s);
    assert.equal(tick, 1);
    assert.equal(trace.filter(t => t[0] === 'attack').length, 1, 'the zombie is the next fight\'s');
    assert.equal(c.anchor, null);
});

test('§4 travelling: the rule holds only while the follow is pending: once it is cancelled the normal rules apply at once', async () => {
    const { agent, bot, c, clock } = setup();
    owner(bot, [3.5, 64, 0.5]);
    following(agent);
    await walk(c, clock, bot, 3, 4.3);
    assert.equal(c.travel, true);
    const z = mob(bot, 'zombie', [5, 0, 0]);
    agent.actions.cancelResume();   // !stop
    assert.equal(await c.pick(), z);
    assert.equal(c.travel, false);
});

test('§4 travelling: walking 2 s and stopping 2 s for a minute changes the state at most a few times', async () => {
    const { agent, bot, c, clock } = setup();
    owner(bot, [3.5, 64, 0.5]);
    following(agent);
    let changes = 0;
    let last = c.travel;
    for (let i = 0; i < 15; i++) {
        for (const speed of [4.3, 0]) {
            const him = bot.players[F.OWNER].entity;
            for (let t = 0; t < 2 - 1e-9; t += 0.3) {
                clock.advance(0.3);
                him.position = him.position.offset(speed * 0.3, 0, 0);
                await c.pick();
                if (c.travel !== last) { changes++; last = c.travel; }
            }
        }
    }
    assert.ok(changes >= 1 && changes <= 3, `${changes} changes`);
});

test('§4: travel_speed 0 keeps the r7 rules: a moving owner is never travelling; an aggroed skeleton within 16 of him is fought', async () => {
    const { agent, bot, c, clock } = setup({ combat: { ...PROFILE, travel_speed: 0 } });
    owner(bot, [3.5, 64, 0.5]);
    following(agent);
    await walk(c, clock, bot, 4, 4.3);
    assert.equal(c.travel, false);
    const s = mob(bot, 'skeleton', [10, 0, 0]);
    meta(s, P18.aggro);
    const z = mob(bot, 'zombie', [5, 0, 0]);
    assert.equal(await c.pick(), z);
    delete bot.entities[z.id];
    assert.equal(await c.pick(), s);
});

// --- code review round 1 (rulings-build-r1 F1–F7) ---------------------------------------------

test('§2/§4 (F1): a ranged target that closes within 8 keeps the ranged rules: its lapsed verdict is re-checked and an unreachable one dropped (10 s)', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 1) s.position = at(6.5, 64, 0.5);   // within 8 of her
        if (tick === 2) bot.hooks.noPath = true;
    };
    await fight(c, s);
    assert.ok(tick <= 8, `dropped after ${tick} ticks`);
    assert.equal(c.isIgnored(s, clock.now()), true);
    assert.ok(c.ignored.get(s.id).until - clock.now() <= COMBAT.dropIgnoreMs, 'the drop, not a give-up');
});

test('§4 (F1): beyond the leash a skeleton within 3 of her is kept and not ignored, like a zombie; it dies and she walks back', async () => {
    const { bot, c, clock, trace } = setup();
    const s = mob(bot, 'skeleton', [2, 0, 0]);
    meta(s, P18.aggro);
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick <= 8) {                                    // she backs off to 20 with it on her heels
            bot.entity.position = bot.entity.position.offset(2.5, 0, 0);
            s.position = bot.entity.position.offset(2, 0, 0);
        } else if (tick === 9) delete bot.entities[s.id];
        else if (bot.pathfinder.goal?.constructor.name === 'GoalNear') bot.entity.position = at(1, 64, 0.5);
    };
    await fight(c, s);
    assert.equal(c.isIgnored(s, clock.now()), false);
    const order = kinds(trace, 'attack', 'goal').filter(k => k !== 'goal:GoalFollow' && k !== 'goal:null');
    assert.deepEqual(order, ['attack', 'goal:GoalNear'], 'one attack, then the walk back');
});

test('§4 (F1): travelling admits a skeleton within 3 only; replaced there by a nearer zombie it is not ignored', async () => {
    const { agent, bot, c, clock } = setup();
    const him = owner(bot, [3.5, 64, 0.5]);
    following(agent);
    await walk(c, clock, bot, 3, 4.3);
    assert.equal(c.travel, true);
    const s = mob(bot, 'skeleton', [5, 0, 0]);
    meta(s, P18.aggro);
    await walk(c, clock, bot, 0.3, 4.3, { her: false });
    assert.equal(await c.pick(), null, 'a skeleton at 5 is passed');
    s.position = bot.entity.position.offset(2.5, 0, 0);
    assert.equal(await c.pick(), s, 'one at 2.5 is fought');
    let tick = 0;
    let z = null;
    const seen = [];
    onTick = () => {
        tick++;
        him.position = him.position.offset(4.3 * 0.5, 0, 0);
        bot.entity.position = bot.entity.position.offset(4.3 * 0.5, 0, 0);
        s.position = bot.entity.position.offset(2.5, 0, 0);
        if (tick === 2) z = mob(bot, 'zombie', [-1.5, 0, 0]);
        if (z) z.position = bot.entity.position.offset(-1.5, 0, 0);
        seen.push(c.current.target);
        if (tick === 4) { delete bot.entities[s.id]; delete bot.entities[z.id]; }
    };
    await fight(c, s);
    assert.deepEqual(seen.slice(0, 3), [s, s, z]);
    assert.equal(c.isIgnored(s, clock.now()), false, 'within 3: no travel drop');
});

test('§4 (F2): no weapon swap while the pathfinder digs: a dig pending across a fight tick keeps its tool', async () => {
    const { bot, c } = setup({ inventory: { iron_sword: 1, iron_pickaxe: 1 } });
    const z = mob(bot, 'zombie', [3, 0, 0]);
    const equips = [];
    const equip = bot.equip;
    bot.equip = async (item, dest) => { equips.push(item.name); return equip(item, dest); };
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick <= 2) { bot.heldItem = bot.inventory.items().find(i => i.name === 'iron_pickaxe'); bot.hooks.mining = true; }   // the pathfinder's tool
        if (tick === 3) bot.hooks.mining = false;
        if (tick === 4) delete bot.entities[z.id];
    };
    await fight(c, z);
    assert.deepEqual(equips, ['iron_sword', 'iron_sword'], 'at the start and after the dig');
});

test('§2/§4 (F3): a dying mob (health 0, loaded about 1.5 s more, P18) is neither re-picked nor counted twice; the next attacker is fought', async () => {
    const { bot, c, trace } = setup();
    const lines = logs();
    const a = mob(bot, 'zombie', [2, 0, 0]);
    let b = null;
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 1) { meta(a, P18.dying); b = mob(bot, 'zombie', [5, 0, 0]); }
        if (tick === 4) delete bot.entities[a.id];
        if (tick === 5) delete bot.entities[b.id];
    };
    await fight(c, a);
    assert.deepEqual(trace.filter(t => t[0] === 'attack').map(t => t[1]), [a.id, b.id]);
    assert.match(lines.find(l => l.includes('fight over')), /: 2 kills/);
    const dead = mob(bot, 'zombie', [2, 0, 0]);
    meta(dead, P18.dying);
    const gone = mob(bot, 'zombie', [3, 0, 0]);
    gone.isValid = false;
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    meta(s, P18.dying);
    s.metadata[15] = 4;
    assert.equal(await c.pick(), null, 'health 0 or invalid: neither rule');
});

test('§2 (F4): in a fight a new melee target needs a clear path too: a zombie behind a wall does not replace the skeleton; its verdict is cached 3 s', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);
    const searches = [];
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function* (m, start, goal, opts) {
        const zombie = goal.z > 3;
        searches.push(`${zombie ? 'zombie' : 'skeleton'}@${clock.now() / 1000}`);
        if (zombie) yield { result: { status: 'noPath', path: [] } };
        else yield* get.call(this, m, start, goal, opts);
    };
    let tick = 0;
    let z = null;
    const seen = [];
    onTick = () => {
        tick++;
        if (tick === 1) z = mob(bot, 'zombie', [0, 0, 6]);   // behind his wall
        else seen.push(c.current.target);
        if (tick === 8) delete bot.entities[s.id];
    };
    const t0 = clock.now() / 1000;
    await fight(c, s);
    assert.ok(seen.every(t => t === s), 'never the zombie');
    assert.deepEqual(searches.slice(0, 3), [`zombie@${t0 + 0.5}`, `skeleton@${t0 + 3}`, `zombie@${t0 + 3.5}`], 'one search per update, each verdict 3 s');
    searches.length = 0;
    clock.advance(5);
    const s2 = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s2, P18.aggro);
    assert.equal(await c.pick(), null, 'the zombie\'s search is the update\'s one');
    assert.equal(await c.pick(), s2);
    assert.equal(await c.pick(), s2);
    assert.deepEqual(searches.map(s => s.split('@')[0]), ['zombie', 'skeleton'], 'outside a fight too: no search while both verdicts hold');
    void z;
});

test('§2 (F4): the current melee target needs no clear path: the chase may dig (counted, path_digs)', async () => {
    const { bot, c } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    const seen = [];
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 1) bot.hooks.noPath = true;
        else seen.push(c.current.target);
        if (tick === 3) delete bot.entities[z.id];
    };
    await fight(c, z);
    assert.deepEqual(seen, [z, z]);
});

test('§6 (F5): an error in the fight ends it quietly: the cut follow stays pending and no model call is made', async () => {
    const { agent, bot, c } = setup({ inventory: { iron_sword: 1 } });
    const lines = logs();
    owner(bot, [0.5, 64, 3.5]);
    bot.equip = async () => { throw new Error('equip timed out'); };
    const follow = async () => { await F.until(() => bot.interrupt_code, { timeout: 60000 }); };
    void agent.actions.runAction(FOLLOW, follow, { resume: true, timeout: -1 });
    await F.until(() => agent.actions.currentActionLabel === FOLLOW);
    mob(bot, 'zombie', [3, 0, 0]);
    await bot.modes.update();
    await F.until(() => lines.some(l => l.includes('Mode self_defense finished')), { timeout: 4000 });
    await F.sleep(50);
    assert.equal(agent.actions.resume_func, follow);
    assert.equal(agent.modelCalls, 0);
    assert.ok(lines.some(l => l.startsWith('[combat] fight error: ') && l.includes('equip timed out')));
    assert.equal(c.anchor, null);
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('§4/§5 (F6): the follow rules apply only when the fight cut the follow: the model\'s !goToCoordinates while following keeps the anchor rules and the walk back', async () => {
    const { agent, bot, c, trace } = setup();
    owner(bot, [30.5, 64, 0.5]);   // far behind her: beyond his leash
    following(agent);
    void agent.actions.runAction('action:goToCoordinates', async () => { await F.until(() => bot.interrupt_code, { timeout: 60000 }); });
    await F.until(() => agent.actions.currentActionLabel === 'action:goToCoordinates');
    const s = mob(bot, 'skeleton', [10, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s, 'not his leash: the command is not the follow');
    delete bot.entities[s.id];
    const z = mob(bot, 'zombie', [3, 0, 0]);
    onTick = () => {
        if (bot.entities[z.id]) { bot.entity.position = at(6.5, 64, 0.5); delete bot.entities[z.id]; return; }
        if (bot.pathfinder.goal?.constructor.name === 'GoalNear') bot.entity.position = at(1, 64, 0.5);
    };
    await bot.modes.update();
    await F.until(() => trace.some(t => t[0] === 'unpause'), { timeout: 4000 });
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 1, 'she walks back');
    agent.actions.cancelResume();
    bot.interrupt_code = true;
});

test('§2 (F7): ranged_radius bounds the ranged rule', async () => {
    const { bot, c } = setup({ combat: { ...PROFILE, ranged_radius: 10 } });
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), null);
    s.position = at(9.5, 64, 0.5);
    assert.equal(await c.pick(), s);
});

test('§5 (F7, decision 4): a fight on the way back re-issues the walk goal after it', async () => {
    const { bot, c, trace } = setup();
    const a = mob(bot, 'zombie', [3, 0, 0]);
    let tick = 0;
    let b = null;
    onTick = () => {
        tick++;
        if (tick === 1) { bot.entity.position = at(8.5, 64, 0.5); delete bot.entities[a.id]; }
        if (tick === 2) b = mob(bot, 'zombie', [2, 0, 0]);
        if (tick === 3) delete bot.entities[b.id];
        if (tick >= 4 && bot.pathfinder.goal?.constructor.name === 'GoalNear') bot.entity.position = at(1, 64, 0.5);
    };
    await fight(c, a);
    assert.equal(trace.filter(t => t[1] === 'GoalNear').length, 2);
    assert.ok(tick <= 6, `${tick} ticks`);
});

test('§2 (F7, decision 6): the current ranged target keeps its stale verdict when a nearer candidate took the update\'s search', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);   // its verdict at 0 s
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function* (m, start, goal, opts) {
        if (goal.x === 9) yield { result: { status: 'noPath', path: [] } };
        else yield* get.call(this, m, start, goal, opts);
    };
    let tick = 0;
    let seen = null;
    const t0 = clock.now();
    onTick = () => {
        tick++;
        if (clock.now() - t0 === 3000) { const t = mob(bot, 'skeleton', [9, 0, 0]); meta(t, P18.aggro); }   // as s's verdict lapses
        if (tick === 7) { seen = c.current.target; bot.interrupt_code = true; }
    };
    await fight(c, s);
    assert.equal(seen, s);
});

test('§4 (F7): after a leash drop the ranged rule still admits a target within the leash of the anchor', async () => {
    const { bot, c } = setup();
    const z = mob(bot, 'zombie', [3, 0, 0]);
    let tick = 0;
    let s = null;
    let seen = null;
    onTick = () => {
        tick++;
        if (tick <= 5) {                                    // the chase out to 18
            bot.entity.position = bot.entity.position.offset(3.5, 0, 0);
            z.position = bot.entity.position.offset(6, 0, 0);
        } else if (tick <= 8) {                             // she walks back to 15, it keeps its distance
            bot.entity.position = bot.entity.position.offset(-1, 0, 0);
            z.position = bot.entity.position.offset(6, 0, 0);
        } else if (tick === 9) {
            s = mob(bot, 'skeleton', [0, 0, 0]);
            s.position = at(6.5, 64, 0.5);                 // 8.5 from her, 6 from the anchor
            meta(s, P18.aggro);
        } else if (tick === 10) {
            seen = c.current.target;
            delete bot.entities[z.id];
            delete bot.entities[s.id];
            bot.entity.position = at(1, 64, 0.5);
        }
    };
    await fight(c, z);
    assert.equal(seen, s);
});

// --- code review round 2 (rulings-build-r2 W1–W3) ---------------------------------------------

// Mobs with goal z ≥ 2 (behind his wall) have no path; the rest the fixture's.
function wallAtZ(bot) {
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function* (m, start, goal, opts) {
        if (goal.z >= 2) yield { result: { status: 'noPath', path: [] } };
        else yield* get.call(this, m, start, goal, opts);
    };
}

test('§2 (W1): a blocked nearer mob never drops the reachable current melee target; an ineligible current one is not kept', async () => {
    const { bot, c } = setup();
    wallAtZ(bot);
    const a = mob(bot, 'zombie', [5, 0, 0]);
    const seen = [];
    let tick = 0;
    onTick = () => {
        tick++;
        if (tick === 1) mob(bot, 'zombie', [0, 0, 4]);   // nearer, behind the wall
        else seen.push(c.current.target);
        if (tick === 5) delete bot.entities[a.id];
    };
    await fight(c, a);
    assert.deepEqual(seen, [a, a, a, a]);
    const far = mob(bot, 'zombie', [5, 0, 0]);
    mob(bot, 'zombie', [0, 0, 2]);                           // within 3, blocked
    assert.equal(await c.pick({ fight: { target: far, leashDropped: true } }), null, 'after a leash drop the current one at 5 is not kept');
});

test('§2 (W1): a current ranged target beyond 3 is not kept by the melee rule: its lapsed verdict is still re-checked', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [6, 0, 0]);
    meta(s, P18.aggro);
    assert.equal(await c.pick(), s);                         // easy at 0 s
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function* (m, start, goal, opts) {
        if (goal.z >= 2 || goal.x === 6) yield { result: { status: 'noPath', path: [] } };
        else yield* get.call(this, m, start, goal, opts);
    };
    mob(bot, 'zombie', [0, 0, 4]);                           // nearer, behind the wall
    clock.advance(3);
    const fight = { target: s };
    assert.equal(await c.pick({ fight }), s, 'the zombie took the search: the stale verdict');
    assert.equal(await c.pick({ fight }), null);
    assert.equal(c.isIgnored(s, clock.now()), true, 'dropped: no easy path');
});

test('§2 (W2): within 3 a leash-dropped skeleton (10 s) is fought; beyond 3 it stays ignored', async () => {
    const { bot, c, clock } = setup();
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    meta(s, P18.aggro);
    let tick = 0;
    let dropped = null;
    let seen = null;
    onTick = () => {
        tick++;
        if (tick <= 5) {                                    // she chases out to 20.5, it keeps 5 ahead
            bot.entity.position = bot.entity.position.offset(4, 0, 0);
            s.position = bot.entity.position.offset(5, 0, 0);
        } else if (tick === 6) {
            dropped = c.isIgnored(s, clock.now());
            s.position = bot.entity.position.offset(2, 0, 0);   // it closes in
        } else if (tick === 7) {
            seen = c.current.target;
            delete bot.entities[s.id];
            bot.entity.position = at(1, 64, 0.5);
        }
    };
    await fight(c, s);
    assert.equal(dropped, true, 'leash-dropped and ignored');
    assert.equal(seen, s);
});

test('§2 (W2): a given-up zombie is fought within 3 while it hurt her in the last 5 s; otherwise, or beyond 3, it stays ignored', async () => {
    const { bot, c, clock } = setup();
    const z = mob(bot, 'zombie', [2, 0, 0]);
    await fight(c, z);                                       // no damage for 15 s: given up, ignored 60 s
    assert.equal(c.isIgnored(z, clock.now()), true);
    assert.equal(await c.pick(), null, 'has not hurt her');
    bot.emit('entityHurt', bot.entity, z);
    assert.equal(await c.pick(), z, 'it hit her at 2');
    z.position = at(5.5, 64, 0.5);
    assert.equal(await c.pick(), null, 'beyond 3 the give-up holds');
    z.position = at(2.5, 64, 0.5);
    clock.advance(5);
    assert.equal(await c.pick(), null, 'the hit is 5 s old');
});

test('§6 (W3): a fight that ends by an error ignores its target 10 s: one fight, not a loop', async () => {
    const { bot, c, clock } = setup({ inventory: { iron_sword: 1 } });
    bot.equip = async () => { throw new Error('equip timed out'); };
    const z = mob(bot, 'zombie', [2, 0, 0]);
    assert.equal(await c.pick(), z);
    await fight(c, z);
    assert.equal(await c.pick(), null, 'within 3 too');
    clock.advance(9.9);
    assert.equal(await c.pick(), null);
    clock.advance(0.1);
    assert.equal(await c.pick(), z);
});

// --- the mode carry --------------------------------------------------------------------------

test('the self_defense carry: with the task layer the mode runs combat.fight on its pick, the stop epoch read first', async () => {
    const { agent, bot, c } = setup();
    const calls = [];
    c.fight = async (target, opts) => { calls.push([target, opts]); };
    const s = mob(bot, 'skeleton', [12, 0, 0]);
    await bot.modes.update();
    assert.equal(calls.length, 0);
    meta(s, P18.aggro);
    agent.stop_epoch = 4;
    const get = bot.pathfinder.getPathFromTo;
    bot.pathfinder.getPathFromTo = function (...args) { agent.stop_epoch++; return get.apply(this, args); };   // a !stop lands during pick's search
    await bot.modes.update();
    await F.until(() => calls.length === 1);
    assert.equal(calls[0][0], s);
    assert.deepEqual(calls[0][1], { epoch: 4, cut: '', following: false }, 'the epoch read before the search');
    await F.until(() => !agent.actions.executing);
    await F.sleep(10);   // execute's tail: the mode inactive again
    following(agent);   // nothing runs, the follow is the pending resume (F6)
    c.verdicts.clear();
    await bot.modes.update();
    await F.until(() => calls.length === 2);
    assert.equal(calls[1][1].following, true);
    agent.actions.cancelResume();
});
