// Shared offline fixture for the work-*.test.mjs suites (no game, model or
// network). Only game data is substituted: mcdata's module-level registry is
// set at login in the real bot, so its lookups are re-implemented here on the
// real 26.1 registry. The bot is a fixture; ActionManager, modes, skills,
// world, the pathfinder's Movements and the work module are the real code.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mock } from 'node:test';

const require = createRequire(import.meta.url);
const Vec3 = require('vec3').Vec3;
export const registry = require('prismarine-registry')('26.1');
const Block = require('prismarine-block')(registry);
const { Recipe } = require('prismarine-recipe')(registry);
export { Vec3 };

// A child process (the SIGINT test) shares its parent's runtime folder.
export const runtime = process.env.WORK_TEST_RUNTIME || fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'work-test-'));
process.env.MINDCRAFT_RUNTIME_DIR = runtime;
if (!process.env.WORK_TEST_RUNTIME) process.on('exit', () => fs.rmSync(runtime, { recursive: true, force: true }));

const realMc = await import('../src/utils/mcdata.js');
const itemName = id => registry.items[id]?.name ?? null;
mock.module('../src/utils/mcdata.js', {
    namedExports: {
        ...realMc,
        getItemId: name => registry.itemsByName[name]?.id ?? null,
        getItemName: itemName,
        getBlockId: name => registry.blocksByName[name]?.id ?? null,
        getBlockName: id => registry.blocks[id]?.name ?? null,
        getAllBlocks: (ignore = []) => registry.blocksArray.filter(b => !ignore.includes(b.name)),
        getAllBlockIds: (ignore = []) => registry.blocksArray.filter(b => !ignore.includes(b.name)).map(b => b.id),
        getItemBlockSources: name => {
            const id = registry.itemsByName[name]?.id;
            return registry.blocksArray.filter(b => b.drops.includes(id)).map(b => b.name);
        },
        getItemCraftingRecipes: name => (Recipe.find(registry.itemsByName[name]?.id) || []).length ? [[{}, { craftedCount: 1 }]] : [],
        ingredientsFromPrismarineRecipe: recipe => {
            const out = {};
            for (const i of recipe.inShape ? recipe.inShape.flat() : []) if (i.id >= 0) out[itemName(i.id)] = (out[itemName(i.id)] || 0) + i.count;
            for (const i of recipe.ingredients || []) if (i.id >= 0) out[itemName(i.id)] = (out[itemName(i.id)] || 0) - i.count;
            return out;
        },
        calculateLimitingResource: realMc.calculateLimitingResource,
    },
});

export const modules = {
    settingsModule: await import('../src/agent/settings.js'),
    commands: await import('../src/agent/commands/index.js'),
    skills: await import('../src/agent/library/skills.js'),
    world: await import('../src/agent/library/world.js'),
    mc: await import('../src/utils/mcdata.js'),
    ActionManager: (await import('../src/agent/action_manager.js')).ActionManager,
    Agent: (await import('../src/agent/agent.js')).Agent,
    SelfPrompter: (await import('../src/agent/self_prompter.js')).SelfPrompter,
    initModes: (await import('../src/agent/modes.js')).initModes,
    work: await import('../src/agent/work/index.js'),
    record: await import('../src/agent/work/record.js'),
    plan: await import('../src/agent/work/plan.js'),
    resolve: await import('../src/agent/work/resolve.js'),
    protect: await import('../src/agent/work/protect.js'),
    runner: await import('../src/agent/work/runner.js'),
    view: await import('../src/agent/work/view.js'),
    pf: (await import('mineflayer-pathfinder')).default,
};

export const OWNER = 'steve';
export function useSettings(extra = {}) {
    modules.settingsModule.setSettings({ language: 'en', max_commands: -1, only_chat_with: [OWNER], blocked_actions: [],
        allow_insecure_coding: false, code_timeout_mins: -1, show_command_syntax: 'none', ...extra });
}
useSettings();

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(predicate, { timeout = 4000, step = 5 } = {}) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeout) throw new Error('until: timed out');
        await sleep(step);
    }
}

// --- world and bot ---------------------------------------------------------

export class World {
    constructor() { this.blocks = new Map(); }
    key(x, y, z) { return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`; }
    set(x, y, z, name, props = null) {
        if (name === 'air') this.blocks.delete(this.key(x, y, z));
        else this.blocks.set(this.key(x, y, z), { name, props });
    }
    fill(x1, y1, z1, x2, y2, z2, name, props) {
        for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) this.set(x, y, z, name, props);
    }
    block(pos) {
        const entry = this.blocks.get(this.key(pos.x, pos.y, pos.z));
        const b = entry
            ? (entry.props ? Block.fromProperties(entry.name, entry.props, 0) : Block.fromStateId(registry.blocksByName[entry.name].defaultState, 0))
            : Block.fromStateId(registry.blocksByName.air.defaultState, 0);
        b.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        return b;
    }
}

// A natural tree: a log column with non-persistent leaves on top.
export function tree(world, x, y, z, height = 4, log = 'oak_log') {
    for (let i = 0; i < height; i++) world.set(x, y + i, z, log, { axis: 'y' });
    const leaves = log.replace('_log', '_leaves');
    world.fill(x - 1, y + height, z - 1, x + 1, y + height, z + 1, leaves, { persistent: false, distance: '1', waterlogged: false });
}

let entityIds = 100;
export function makeBot({ world = new World(), position = [0, 64, 0], inventory = {} } = {}) {
    const bot = new EventEmitter();
    bot.setMaxListeners(100);
    bot.registry = registry;
    bot.version = '26.1';
    bot.username = 'fixture';
    bot.world = world;
    bot.game = { dimension: 'overworld', gameMode: 'survival' };
    bot.output = '';
    bot.interrupt_code = false;
    bot.entity = { id: 1, position: new Vec3(...position), height: 1.8, isInLava: false, type: 'player', username: 'fixture' };
    bot.players = {};
    bot.entities = {};
    bot.heldItem = null;
    bot.calls = [];
    bot.hooks = {}; // per-test behaviour: craft, goto, collect

    const slots = new Array(46).fill(null);
    const stackSize = name => registry.itemsByName[name]?.stackSize ?? 64;
    bot.inventory = {
        slots,
        items: () => slots.filter(Boolean),
        emptySlotCount: () => slots.slice(9, 45).filter(s => !s).length,
        findInventoryItem: nameOrId => slots.find(s => s && (s.name === nameOrId || s.type === nameOrId)) || null,
    };
    bot.give = (name, count) => {
        for (const s of slots) if (s && s.name === name && s.count < stackSize(name) && count > 0) {
            const add = Math.min(count, stackSize(name) - s.count); s.count += add; count -= add;
        }
        for (let i = 9; i < 45 && count > 0; i++) if (!slots[i]) {
            const add = Math.min(count, stackSize(name));
            slots[i] = { name, count: add, type: registry.itemsByName[name].id, stackSize: stackSize(name) };
            count -= add;
        }
        if (count > 0) throw new Error(`fixture inventory full (${name} ${count} left)`);
    };
    bot.take = (name, count) => {
        for (let i = 44; i >= 0 && count > 0; i--) {
            const s = slots[i];
            if (!s || s.name !== name) continue;
            const take = Math.min(count, s.count); s.count -= take; count -= take;
            if (!s.count) slots[i] = null;
        }
    };
    bot.count = name => slots.reduce((n, s) => n + (s && s.name === name ? s.count : 0), 0);
    for (const [name, count] of Object.entries(inventory)) bot.give(name, count);

    bot.blockAt = pos => world.block(pos);
    bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
        const origin = point ?? bot.entity.position;
        const test = typeof matching === 'function' ? matching
            : Array.isArray(matching) ? b => matching.includes(b.type) : b => b.type === matching;
        const found = [];
        // Stored blocks; a short search (getNearestFreeSpace) also sees air.
        const keys = new Set(world.blocks.keys());
        if (maxDistance <= 8) {
            const o = origin.floored();
            for (let x = -maxDistance; x <= maxDistance; x++) for (let y = -maxDistance; y <= maxDistance; y++) for (let z = -maxDistance; z <= maxDistance; z++)
                keys.add(world.key(o.x + x, o.y + y, o.z + z));
        }
        for (const key of keys) {
            const [x, y, z] = key.split(',').map(Number);
            const pos = new Vec3(x, y, z);
            if (pos.distanceTo(origin) > maxDistance) continue;
            const b = world.block(pos);
            if (test(b)) found.push(pos);
        }
        found.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin));
        return found.slice(0, count);
    };
    bot.nearestEntity = (filter = () => true) => {
        let best = null;
        for (const e of Object.values(bot.entities)) {
            if (!filter(e)) continue;
            if (!best || e.position.distanceTo(bot.entity.position) < best.position.distanceTo(bot.entity.position)) best = e;
        }
        return best;
    };

    bot.recipesAll = (id, meta, table) => Recipe.find(id, meta).filter(r => !r.requiresTable || table);
    const affordable = (recipe, runs = 1) => recipe.delta.every(d => d.count >= 0 || bot.count(registry.items[d.id].name) >= -d.count * runs);
    bot.recipesFor = (id, meta, min, table) => bot.recipesAll(id, meta, table).filter(r => affordable(r));
    bot.craft = async (recipe, runs) => {
        bot.calls.push(['craft', registry.items[recipe.result.id].name, runs]);
        if (bot.hooks.craft) await bot.hooks.craft(recipe, runs);
        for (const d of recipe.delta) {
            const name = registry.items[d.id].name;
            if (d.count < 0) bot.take(name, -d.count * runs); else bot.give(name, d.count * runs);
        }
    };
    bot.equip = async item => { bot.heldItem = item; };
    bot.unequip = async () => { bot.heldItem = null; };
    bot.tool = { equipForBlock: async block => {
        bot.heldItem = bot.inventory.items().find(s => block.harvestTools?.[s.type]) || null;
    } };
    bot.armorManager = { equipAll() {} };
    bot.lookAt = async (pos) => { bot.calls.push(['lookAt', pos.clone()]); };
    bot.look = async () => {};
    bot.toss = async (type, meta, count) => {
        const name = registry.items[type].name;
        bot.take(name, count);
        bot.calls.push(['toss', name, count]);
        const id = entityIds++;
        bot.entities[id] = { id, name: 'item', type: 'object', position: bot.entity.position.offset(1, 0, 0), getDroppedItem: () => ({ name, count }) };
        if (bot.hooks.toss) bot.hooks.toss(name, count, bot.entities[id]);
    };
    // Mineflayer's playerCollect for a dropped item entity: (collector, collected).
    bot.collect = (username, entity) => {
        const collector = username === bot.username ? bot.entity : bot.players[username]?.entity ?? { username };
        bot.emit('playerCollect', collector, entity);
        delete bot.entities[entity.id];
    };
    bot.placeBlock = async (reference, face) => { // mineflayer place_block.js:40-44
        const pos = reference.position.plus(face);
        const old = world.block(pos);
        const name = bot.heldItem?.name;
        world.set(pos.x, pos.y, pos.z, name);
        bot.take(name, 1);
        if (!bot.count(name)) bot.heldItem = null;
        bot.calls.push(['place', name, pos.toString()]);
        bot.emit('blockPlaced', old, world.block(pos));
    };
    // mineflayer digging.js:216-219: death drops every diggingCompleted listener.
    bot.on('death', () => bot.removeAllListeners('diggingCompleted'));
    bot.dig = async block => { world.set(block.position.x, block.position.y, block.position.z, 'air'); bot.emit('diggingCompleted', block); };
    bot.stopDigging = () => {};
    bot.clearControlStates = () => {};
    bot.setControlState = () => {};
    bot.chat = msg => bot.calls.push(['chat', msg]);
    bot.whisper = (to, msg) => bot.calls.push(['whisper', to, msg]);
    bot.pvp = { attack(entity) { delete bot.entities[entity.id]; }, stop() {} };
    bot.collectBlock = {
        cancelTask: async () => {},
        collect: async block => {
            bot.calls.push(['collect', block.name, block.position.toString()]);
            if (bot.hooks.collect) await bot.hooks.collect(block);
            if (bot.interrupt_code) { const err = new Error('stopped'); err.name = 'PathStopped'; throw err; }
            const silk = (bot.heldItem?.enchants ?? []).some(e => e.name === 'silk_touch');
            const drop = silk ? registry.itemsByName[block.name].id : registry.blocksByName[block.name].drops[0];
            world.set(block.position.x, block.position.y, block.position.z, 'air');
            bot.entity.position = block.position.offset(0.5, 0, 0.5);
            if (drop != null) bot.give(registry.items[drop].name, 1);
            bot.emit('diggingCompleted', block);
        },
    };
    bot.pathfinder = {
        movements: null, goal: null,
        setMovements(m) { this.movements = m; },
        setGoal(goal) { this.goal = goal; },
        stop() { this.goal = null; },
        getPathTo: () => ({ status: bot.hooks.noPath ? 'noPath' : 'success', path: [] }),
        goto: async goal => {
            bot.calls.push(['goto', goal.constructor.name]);
            if (bot.hooks.goto) await bot.hooks.goto(goal);
            if (bot.interrupt_code) { const err = new Error('Path was stopped'); err.name = 'PathStopped'; throw err; }
            if (goal.entity) bot.entity.position = goal.entity.position.clone();
            else if (goal.goal) bot.entity.position = bot.entity.position.offset(10, 0, 0); // GoalInvert: move away
            else if (goal.x !== undefined) bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
        },
    };
    return bot;
}

export function hostile(bot, name = 'zombie', offset = [3, 0, 0]) {
    const id = entityIds++;
    bot.entities[id] = { id, name, type: 'hostile', position: bot.entity.position.offset(...offset), height: 1.9, metadata: [] };
    return bot.entities[id];
}

export function player(bot, username = OWNER, position = [5, 64, 5]) {
    const entity = { id: entityIds++, name: 'player', type: 'player', username, position: new Vec3(...position), height: 1.8, metadata: [] };
    bot.players[username] = { username, entity };
    bot.entities[entity.id] = entity;
    return entity;
}

// --- agent -----------------------------------------------------------------

const MODES_OFF = { self_preservation: false, unstuck: false, cowardice: false, self_defense: false, hunting: false,
    item_collecting: false, torch_placing: false, elbow_room: false, idle_staring: false, cheat: false };

// The agent around the real ActionManager, modes and handleMessage. The idle
// handler mirrors agent.js:499-508 with a shorter delay (idleDelay).
export function makeAgent({ bot = makeBot(), modes = {}, work = {}, replies = [], idleDelay = 20, name = 'fixture' } = {}) {
    const { Agent, ActionManager, SelfPrompter, initModes } = modules;
    const agent = Object.create(Agent.prototype);
    Object.assign(agent, {
        name, bot, stop_epoch: 0, shut_up: false, last_sender: null, blocked_actions: [],
        task: { data: null }, chats: [], killed: null, modelCalls: 0, turns: [],
    });
    agent.history = {
        turns: agent.turns, saved: 0,
        add: async (source, content) => { agent.turns.push({ source, content }); },
        save: async () => { agent.history.saved++; },
        getHistory: () => agent.turns.map(t => ({ role: t.source === 'system' ? 'system' : 'user', content: t.content })),
    };
    agent.prompter = {
        profile: { work },
        getInitModes: () => ({ ...MODES_OFF, ...modes }),
        promptConvo: async () => { agent.modelCalls++; const r = replies.shift(); return typeof r === 'function' ? r(agent) : (r ?? ''); },
        cancelCoding: () => {},
    };
    agent.openChat = message => agent.chats.push(message);
    agent.routeResponse = (to, message) => agent.chats.push(message);
    agent.checkTaskDone = async () => {};
    agent.cleanKill = msg => { agent.killed = msg; };
    agent.actions = new ActionManager(agent);
    agent.self_prompter = new SelfPrompter(agent);
    agent.coder = { generateCode: async () => 'generated code ran' };
    initModes(agent);
    bot.on('death', () => { // agent.js:476-479
        agent.actions.cancelResume();
        agent.actions.stop();
    });
    bot.on('idle', () => {
        bot.modes.unPauseAll();
        setTimeout(() => { if (agent.isIdle()) agent.actions.resumeAction(); }, idleDelay);
    });
    return agent;
}

// The agent's update loop (agent.js:513-526) and the self-heal timer, faster.
export function drive(agent, ms = 30) {
    let busy = false;
    const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            await agent.bot.modes.update();
            agent.work?.tick();
        } finally {
            busy = false;
        }
    }, ms);
    return () => clearInterval(timer);
}

// A fake clock for the stall rule and the self-heal timer.
export function clock(start = 1_000_000) {
    const c = { t: start, now: () => c.t, advance: s => { c.t += s * 1000; } };
    return c;
}

export function startWork(agent, { init_message = null, now = Date.now, timers = false } = {}) {
    agent.work = new modules.work.Work(agent, { now, timers }).init(init_message);
    return agent.work;
}

export function recordFile(agent) {
    return modules.record.recordPath(agent.name);
}

export function readRecord(agent) {
    return JSON.parse(fs.readFileSync(recordFile(agent), 'utf8'));
}

export function clearRecord(agent) {
    fs.rmSync(recordFile(agent), { force: true });
}

// Run the agent's command parser on an owner-typed (forced) command.
export async function ownerSays(agent, message, source = OWNER) {
    return modules.Agent.prototype.handleMessage.call(agent, source, message);
}

// Dispose every work instance and release hooks that wait for an interrupt.
export function cleanup(agents) {
    for (const agent of agents) {
        agent.work?.dispose();
        agent.actions.cancelResume(); // no idle resume starts a run again
        agent.bot.interrupt_code = true;
    }
}
