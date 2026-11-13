import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { after, beforeEach, test } from 'node:test';
import * as F from './work-fixture.mjs';

// The gear slice (SPEC §9.5 REQ-GEAR-1; design runtime/diagnostics/i1-build/
// gear/recommended-design.md r5 §1–§4): reading items from their 26.1
// components (the owner's gear as the probes logged it), the rankers, the
// chooser and its silk rule, the members the gear plugin replaces, the armour
// controller and giving.
const require = createRequire(import.meta.url);
const { gear: G, skills } = F.modules;
const R = F.registry;
const GEAR = F.OWNER_GEAR;
const B = name => R.blocksByName[name];
const agents = [];
after(() => F.cleanup(agents));
beforeEach(() => F.useSettings());

const DEST = { head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 };
// A fixture bot with items in exact slots and Mineflayer's equip semantics:
// bot.equip moves that very instance (item.slot) into the destination,
// swapping, and bot.heldItem is the selected hotbar slot's object.
function bagOf(entries, { held = 36, world } = {}) {
    const bot = F.makeBot({ world });
    const slots = bot.inventory.slots;
    for (const [slot, item] of entries) slots[slot] = item;
    bot.quickBarSlot = held - 36;
    const update = () => { bot.heldItem = slots[36 + bot.quickBarSlot] ?? null; };
    update();
    bot.equip = async (item, dest) => {
        bot.calls.push(['equip', item.name, dest]);
        const from = slots.indexOf(item);
        if (from < 0) throw new Error('equip: not in the inventory');
        const to = dest === 'hand' ? 36 + bot.quickBarSlot : DEST[dest];
        [slots[from], slots[to]] = [slots[to] ?? null, item];
        update();
    };
    bot.unequip = async dest => {
        bot.calls.push(['unequip', dest]);
        const to = slots.findIndex((s, i) => i >= 9 && i < 45 && !s);
        if (to < 0) throw new Error('unequip with a full bag tosses the held stack');
        slots[to] = slots[36 + bot.quickBarSlot];
        slots[36 + bot.quickBarSlot] = null;
        update();
    };
    return bot;
}
const equips = bot => bot.calls.filter(c => c[0] === 'equip' || c[0] === 'unequip');
const fillBag = bot => { for (let i = 9; i < 45; i++) bot.inventory.slots[i] ??= F.realItem('oak_planks', [], { count: 64 }); };
const withSpeed = (name, speed) => F.realItem(name, [{ type: 'attribute_modifiers', data: [
    { typeId: 4, name: 'minecraft:base_attack_speed', value: speed - 4, operation: 'add', slot: 'main_hand', display: { type: 'default' } }] }]);
const silky = name => F.realItem(name, [{ type: 'enchantments', data: { enchantments: [{ id: 34, level: 1 }] } }]);

// --- reading an item (design §2) -----------------------------------------------------------

test('the owner\'s items read as the probes logged them: damage, speed, swing spacing and score (design §2, §3)', () => {
    const bot = F.makeBot();
    const read = item => { const r = G.read(bot, item); return [r.damage, r.speed, r.interval, Math.round(r.score * 10) / 10]; };
    assert.deepEqual(read(GEAR.axe()), [13, 4, 11, 23.6], 'his axe: 1 + 8, Sharpness VII +4; speed 4 + 0');
    assert.deepEqual(read(GEAR.herAxe()), [12, 1, 21, 11.4], 'her diamond axe: vanilla 9, Sharpness V +3; speed 1');
    const sword5 = F.realItem('diamond_sword', [{ type: 'enchantments', data: { enchantments: [{ id: 33, level: 5 }] } }]);
    assert.deepEqual(read(sword5), [10, 1.6, 14, 14.3]);
    assert.deepEqual(read(F.realItem('diamond_sword')), [7, 1.6, 14, 10]);
    assert.deepEqual(read(null), [1, 4, 11, 1.8], 'the bare hand');
    assert.equal(G.read(bot, GEAR.axe()).unbreakable, true);
    assert.equal(G.read(bot, GEAR.herAxe()).unbreakable, false, 'Unbreaking III is no unbreakable component');
    assert.equal(G.read(bot, GEAR.herPickaxe()).unbreakable, true, 'P17: her placeholder carries the component');
    assert.deepEqual([G.read(bot, GEAR.copy()).efficiency, G.read(bot, GEAR.copy()).silk, G.read(bot, GEAR.silkPickaxe()).silk], [5, false, true]);
    for (const piece of [GEAR.chest(), GEAR.legs(), GEAR.feet()]) {
        const r = G.read(bot, piece);
        assert.deepEqual([r.unbreakable, r.toughness, r.protection], [true, 2, 5], piece.name);
    }
    assert.deepEqual([GEAR.chest(), GEAR.legs(), GEAR.feet()].map(p => G.read(bot, p).armour), [8, 6, 3]);
});

test('the vanilla table: values with the base 1, the copper rows, trident and mace; a component replaces it, a removed one leaves the bases', () => {
    const bot = F.makeBot();
    const attack = name => { const r = G.read(bot, F.realItem(name)); return [r.damage, r.speed]; };
    assert.deepEqual(attack('iron_sword'), [6, 1.6]);
    assert.deepEqual(attack('netherite_axe'), [10, 1]);
    assert.deepEqual(attack('copper_axe'), [9, 0.8]);
    assert.deepEqual(attack('copper_sword'), [5, 1.6]);
    assert.deepEqual(attack('golden_hoe'), [1, 1]);
    assert.deepEqual(attack('iron_shovel'), [4.5, 1]);
    assert.deepEqual(attack('trident'), [9, 1.1]);
    assert.deepEqual(attack('mace'), [6, 0.6]);
    assert.deepEqual(attack('stick'), [1, 4], 'no table row: the player bases');
    const armour = name => { const r = G.read(bot, F.realItem(name)); return [r.armour, r.toughness]; };
    assert.deepEqual(armour('diamond_chestplate'), [8, 2]);
    assert.deepEqual(armour('netherite_helmet'), [3, 3]);
    assert.deepEqual(armour('leather_boots'), [1, 0]);
    assert.deepEqual(armour('copper_chestplate'), [4, 0]);
    assert.deepEqual(armour('turtle_helmet'), [2, 0]);
    const gone = F.realItem('diamond_sword', [], { removed: ['attribute_modifiers'] });
    assert.deepEqual([G.read(bot, gone).damage, G.read(bot, gone).speed], [1, 4], 'removed: no modifiers at all');
    const mods = F.realItem('iron_sword', [{ type: 'attribute_modifiers', data: [
        { typeId: 2, name: 'a', value: 4, operation: 'add', slot: 'main_hand', display: { type: 'default' } },
        { typeId: 2, name: 'b', value: 0.5, operation: 'multiply_base', slot: 'hand', display: { type: 'default' } },
        { typeId: 2, name: 'c', value: 1, operation: 'multiply_total', slot: 'any', display: { type: 'default' } },
        { typeId: 2, name: 'd', value: 100, operation: 'add', slot: 'off_hand', display: { type: 'default' } },
        { typeId: 999, name: 'e', value: 100, operation: 'add', slot: 'main_hand', display: { type: 'default' } }] }]);
    assert.equal(G.read(bot, mods).damage, (1 + 4) * 1.5 * 2, 'base 1; the off hand and an unknown attribute ignored');
    assert.equal(G.read(bot, mods).speed, 4, 'a present component replaces the vanilla speed too');
});

test('interval: the solver\'s ticks with the 10-tick floor, plus one; an unusable speed is never wielded, swings as the hand and is kept', async () => {
    assert.equal(G.ticksFor(4), 11, 'the floor: 5 ticks would land every other swing (P17)');
    assert.equal(G.ticksFor(2), 11);
    assert.equal(G.ticksFor(1.9), 12);
    assert.equal(G.ticksFor(1.6), 14);
    assert.equal(G.ticksFor(1), 21);
    assert.equal(G.ticksFor(4 + -3.2), 26, 'no floating-point tick: an axe\'s 4 + (−3.2) is 0.7999999999999998, 20 / it 25.000000000000007');
    assert.equal(G.read(F.makeBot(), withSpeed('stone_axe', 0.8)).interval, 26, 'as a component gives it');
    for (const speed of [0, -1, Infinity, NaN, null, undefined]) assert.equal(G.ticksFor(speed), null, String(speed));
    const bot = bagOf([[9, withSpeed('netherite_sword', 0)], [10, F.realItem('wooden_sword')]], { held: 40 });
    const frozen = bot.inventory.slots[9];
    assert.equal(G.read(bot, frozen).interval, null);
    assert.equal(G.interval(bot, frozen), 11, 'a finite timer: as the bare hand');
    await G.equipWeapon(bot);
    assert.deepEqual(equips(bot), [['equip', 'wooden_sword', 'hand']], 'the unusable sword is never wielded');
    assert.ok(G.assess(bot).kept.has(9), 'and kept: never a spare');
    assert.ok(!G.spares(bot).some(e => e.slot === 9));
});

// --- ranking (design §3) -----------------------------------------------------------------

test('tools: capability first, then no silk touch, then unbreakable, then speed (owner ruling 2026-11-12 night)', () => {
    const bot = F.makeBot();
    const better = (a, b, kind) => G.compare(G.toolKey(bot, a, kind), G.toolKey(bot, b, kind)) > 0;
    assert.deepEqual(G.toolKey(bot, GEAR.copy(), 'pickaxe'), [403, 1, 1, 35, Infinity]);
    assert.deepEqual(G.toolKey(bot, GEAR.herPickaxe(), 'pickaxe'), [403, 1, 1, 8, Infinity]);
    assert.ok(better(GEAR.copy(), GEAR.herPickaxe(), 'pickaxe'), 'P17: both unbreakable, the copy faster (35 against 8)');
    assert.ok(better(GEAR.copy(), GEAR.silkPickaxe(), 'pickaxe'), 'silk touch loses cobblestone, coal and raw ore');
    assert.ok(better(F.realItem('diamond_pickaxe'), F.realItem('wooden_pickaxe', [{ type: 'unbreakable' }]), 'pickaxe'),
        'an unbreakable wooden pickaxe cannot mine diamonds: reach first');
    const golden = F.realItem('golden_pickaxe', [{ type: 'enchantments', data: { enchantments: [{ id: 8, level: 5 }] } }]);
    assert.ok(better(F.realItem('stone_pickaxe'), golden, 'pickaxe'), 'golden is fast but harvests less');
    assert.ok(better(GEAR.axe(), GEAR.herAxe(), 'axe'), 'axes tie on reach: unbreakable then');
    assert.deepEqual(G.toolKey(bot, GEAR.axe(), 'axe').slice(0, 4), [0, 1, 1, 32]);
});

test('weapons and armour: unbreakable first, then the score or the armour values', () => {
    const bot = F.makeBot();
    const sharp = F.realItem('netherite_sword', [{ type: 'enchantments', data: { enchantments: [{ id: 33, level: 5 }] } }]);
    const tough = F.realItem('wooden_sword', [{ type: 'unbreakable' }]);
    assert.ok(G.compare(G.weaponKey(bot, tough), G.weaponKey(bot, sharp)) > 0, 'the owner: an unbreakable item takes priority');
    assert.ok(G.compare(G.weaponKey(bot, GEAR.axe()), G.weaponKey(bot, GEAR.herAxe())) > 0);
    assert.ok(G.compare(G.weaponKey(bot, sharp), G.weaponKey(bot, F.realItem('netherite_sword'))) > 0, 'then the score');
    for (const name of ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate'])
        assert.ok(G.compare(G.armourKey(bot, GEAR.chest()), G.armourKey(bot, F.realItem(name))) > 0, name);
    assert.ok(G.compare(G.armourKey(bot, F.realItem('netherite_chestplate')), G.armourKey(bot, F.realItem('diamond_chestplate'))) > 0, 'toughness');
});

// --- mining (design §2) --------------------------------------------------------------------

test('mining: tags with the 26.1 bridge, speed, harvest, dig ticks and reach', () => {
    const bot = F.makeBot();
    const tags = name => G.blockTags(bot, B(name).id);
    for (const name of ['obsidian', 'iron_ore', 'crafter', 'stone']) assert.ok(tags(name).has('mineable/pickaxe'), name);
    assert.equal(B('obsidian').material, 'incorrect_for_wooden_tool', 'the registry data the bridge covers');
    assert.ok(tags('obsidian').has('incorrect_for_iron_tool') && !tags('iron_ore').has('incorrect_for_iron_tool'));
    assert.ok(tags('iron_ore').has('incorrect_for_wooden_tool') && tags('iron_ore').has('incorrect_for_gold_tool'));
    assert.equal(G.toolSpeed(bot, GEAR.copy(), B('stone')), 35, 'tool rule 9 + Efficiency V (25 + 1)');
    assert.equal(G.toolSpeed(bot, GEAR.herPickaxe(), B('stone')), 8);
    assert.equal(G.toolSpeed(bot, F.realItem('iron_pickaxe'), B('iron_ore')), 6, 'the bridge gives the pickaxe speed on ores');
    assert.equal(G.toolSpeed(bot, F.realItem('wooden_shovel'), B('iron_ore')), 1, 'not the incorrect_for tables');
    assert.equal(G.toolSpeed(bot, null, B('stone')), 1);
    assert.deepEqual([G.digTicks(bot, B('stone'), GEAR.copy()), G.digTicks(bot, B('stone'), GEAR.herPickaxe()), G.digTicks(bot, B('obsidian'), GEAR.copy())], [2, 6, 43]);
    assert.equal(G.digTicks(bot, B('bedrock'), GEAR.copy()), Infinity);
    assert.equal(G.canHarvest(bot, B('obsidian'), GEAR.copy()), true, 'the copy\'s rule covers mineable/pickaxe');
    assert.equal(G.canHarvest(bot, B('obsidian'), F.realItem('iron_pickaxe')), false);
    assert.equal(G.canHarvest(bot, B('obsidian'), GEAR.herPickaxe()), true);
    assert.equal(G.canHarvest(bot, B('dirt'), null), true);
    assert.equal(G.canHarvest(bot, B('stone'), null), false);
    const reach = item => G.reach(bot, item);
    assert.deepEqual([reach(GEAR.copy()), reach(F.realItem('diamond_pickaxe')), reach(F.realItem('iron_pickaxe')), reach(F.realItem('golden_pickaxe')), reach(F.realItem('wooden_pickaxe'))],
        [403, 403, 398, 296, 296]);
    // A rule naming a tag we cannot derive: unreadable, mined by its vanilla values.
    const odd = F.realItem('iron_pickaxe', [{ type: 'tool', data: { rules: [{ blocks: { name: 'minecraft:needs_magic' }, speed: 50, correctDropForBlocks: true }],
        defaultMiningSpeed: 1, damagePerBlock: 1, canDestroyBlocksInCreative: true } }]);
    assert.equal(G.read(bot, odd).unreadable, true);
    assert.equal(G.toolSpeed(bot, odd, B('stone')), 6);
    // A rule by block ids; a removed tool component mines like nothing.
    const ids = F.realItem('wooden_shovel', [{ type: 'tool', data: { rules: [{ blocks: { ids: [B('obsidian').id] }, speed: 20, correctDropForBlocks: true }],
        defaultMiningSpeed: 1, damagePerBlock: 1, canDestroyBlocksInCreative: true } }]);
    assert.deepEqual([G.toolSpeed(bot, ids, B('obsidian')), G.canHarvest(bot, B('obsidian'), ids), G.canHarvest(bot, B('stone'), ids)], [20, true, false]);
    const bare = F.realItem('diamond_pickaxe', [], { removed: ['tool'] });
    assert.deepEqual([G.toolSpeed(bot, bare, B('stone')), G.canHarvest(bot, B('stone'), bare)], [1, false]);
});

// --- the block chooser (design §3, §4) -------------------------------------------------------

test('the block chooser: harvest first, the silk rule in its four cases, then dig ticks, unbreakable, the held item', () => {
    const golden = F.realItem('golden_pickaxe', [{ type: 'enchantments', data: { enchantments: [{ id: 8, level: 5 }] } }]);
    const ore = bagOf([[9, golden], [10, F.realItem('stone_pickaxe')]]);
    assert.equal(G.chooseFor(ore, B('iron_ore')).item.name, 'stone_pickaxe', 'the golden one is faster but gets no drop');
    const silk = silky('diamond_pickaxe');
    const bot = bagOf([[9, silk], [10, F.realItem('iron_pickaxe')]]);
    const choose = (name, wanted) => G.chooseFor(bot, B(name), { intent: wanted === undefined ? null : { wanted } }).item;
    assert.equal(choose('stone', 'cobblestone').name, 'iron_pickaxe', '1: cobblestone from stone: the plain tool');
    assert.equal(choose('stone', 'stone'), silk, '2: the block itself is wanted: silk, the faster');
    assert.equal(G.silkChangesDrop(bot, B('ice'), silk, 'ice'), false);
    assert.equal(choose('ice', null), silk, '3: ice drops nothing without silk: silk stays');
    assert.equal(choose('stone'), bot.inventory.slots[10], 'no intent (dig.js): silk avoided where it changes the drop');
    const only = bagOf([[9, silky('diamond_pickaxe')]]);
    assert.equal(G.chooseFor(only, B('stone'), { intent: { wanted: 'cobblestone' } }).item.name, 'diamond_pickaxe', '4: only silk harvests');
    assert.equal(G.silkChangesDrop(only, B('stone'), only.inventory.slots[9], 'cobblestone'), true, 'so collectBlock refuses');
    // Ties: unbreakable, then the held item (no equip churn), then the lowest slot.
    const tie = bagOf([[9, F.realItem('diamond_pickaxe')], [10, F.realItem('diamond_pickaxe', [{ type: 'unbreakable' }])]]);
    assert.equal(G.chooseFor(tie, B('stone')).slot, 10);
    const held = bagOf([[9, F.realItem('diamond_pickaxe')], [36, F.realItem('diamond_pickaxe')]]);
    assert.equal(G.chooseFor(held, B('stone')).slot, 36);
    held.quickBarSlot = 1;
    held.heldItem = null;
    assert.equal(G.chooseFor(held, B('stone')).slot, 9);
});

test('the bare hand only while a slot is free, re-checked right before unequipping; requireHarvest refuses with NoItem', async () => {
    const shovel = silky('diamond_shovel');
    const bot = bagOf([[36, shovel]]);
    assert.equal(G.chooseFor(bot, B('grass_block'), { intent: { wanted: 'dirt' } }).item, null, 'grass by hand: the silk shovel drops grass');
    const restore = G.intend(bot, { wanted: 'dirt' });
    await G.equipForBlock(bot, B('grass_block'));
    restore();
    assert.deepEqual(equips(bot), [['unequip', 'hand']]);
    // Full bag: no hand (unequipping would toss the held stack).
    const full = bagOf([[36, silky('diamond_shovel')]]);
    fillBag(full);
    assert.equal(G.chooseFor(full, B('grass_block'), { intent: { wanted: 'dirt' } }).item.name, 'oak_planks', 'any plain item digs grass for dirt; never the hand');
    full.inventory.slots.fill(silky('diamond_shovel'), 9, 45);
    assert.equal(G.chooseFor(full, B('grass_block'), { intent: { wanted: 'dirt' } }).item.name, 'diamond_shovel', 'only silk left: collectBlock refuses');
    // The bag fills between the choice and the unequip: the best allowed item
    // instead (here the held shovel: no unequip).
    const racing = bagOf([[36, silky('diamond_shovel')]]);
    let calls = 0;
    const count = racing.inventory.emptySlotCount;
    racing.inventory.emptySlotCount = () => (calls++ === 0 ? count() : 0);
    const back = G.intend(racing, { wanted: 'dirt' });
    await G.equipForBlock(racing, B('grass_block'), {});
    back();
    assert.equal(calls, 2, 'chosen with a free slot, re-checked before unequipping');
    assert.deepEqual(equips(racing), []);
    // requireHarvest (collectblock's re-equip): only harvesting items; none is upstream's NoItem error.
    const none = bagOf([[9, F.realItem('stick')]]);
    await assert.rejects(G.equipForBlock(none, B('obsidian'), { requireHarvest: true }), { name: 'NoItem' });
    await G.equipForBlock(none, B('obsidian'));
    assert.deepEqual(equips(none), [], 'without it nothing qualifies better than what she holds');
});

test('collectBlock: the silk rule shrinks to the refusal; with the copy the obsidian block answers for the held item, also in the dig wait (47 ticks)', async () => {
    const world = new F.World();
    world.set(2, 64, 0, 'obsidian');
    world.set(4, 64, 0, 'stone');
    const bot = bagOf([[36, GEAR.copy()]], { world });
    const agent = F.makeAgent({ bot, name: 'gear-collect' });
    agents.push(agent);
    bot.tool.equipForBlock = (block, options) => G.equipForBlock(bot, block, options);
    const target = world.block(new F.Vec3(2, 64, 0));
    G.bindHarvest(bot, target);
    const copy = bot.heldItem;
    assert.equal(target.canHarvest(copy.type), true, 'the held copy, by its components');
    bot.heldItem = F.realItem('iron_pickaxe');
    assert.equal(Boolean(target.canHarvest(bot.heldItem.type)), false, 'a plain iron pickaxe held: no drop');
    bot.heldItem = copy;
    assert.equal(Boolean(target.canHarvest(R.itemsByName.diamond_pickaxe.id)), true, 'another type asks the registry');
    assert.equal(Boolean(target.canHarvest(null)), false);
    // bot.digTime as the Mineflayer carry calls it (digging.js:250 bridges the material on the object first).
    const wait = b => { b.material = 'mineable/pickaxe'; return b.digTime(copy.type, false, false, false, copy.enchants) / 50; };
    assert.equal(wait(target), 47, 'the registry speed with the harvest granted (real time 43)');
    assert.equal(wait(world.block(new F.Vec3(2, 64, 0))), 157, 'without the override: 157 ticks (P17)');
    // End to end: !collectBlocks obsidian with the copy.
    assert.equal(await skills.collectBlock(bot, 'obsidian', 1), true);
    assert.equal(bot.count('obsidian'), 1);
    assert.equal(bot.calls.filter(c => c[0] === 'collect').length, 1);
    // A plain iron pickaxe: the refusal, nothing dug.
    world.set(2, 64, 0, 'obsidian');
    bot.inventory.slots[36] = F.realItem('iron_pickaxe');
    bot.heldItem = bot.inventory.slots[36];
    bot.output = '';
    assert.equal(await skills.collectBlock(bot, 'obsidian', 1), false);
    assert.match(bot.output, /^Collected 0 of 1 obsidian\. 1 could not be dug: cannot harvest with iron_pickaxe\. /m);
    // Only a silk pickaxe for cobblestone: the refusal.
    bot.inventory.slots[36] = silky('diamond_pickaxe');
    bot.heldItem = bot.inventory.slots[36];
    bot.output = '';
    assert.equal(await skills.collectBlock(bot, 'cobblestone', 1), false);
    assert.match(bot.output, /^Collected 0 of 1 cobblestone\. 1 could not be dug: only a silk-touch tool, which drops stone, not cobblestone\. /m);
    assert.equal(bot.calls.filter(c => c[0] === 'collect').length, 1, 'nothing more dug');
});

// --- fights (design §4) --------------------------------------------------------------------

test('equipWeapon: his axe over her diamond axe and the sword; with no sword or axe a pickaxe, never a spear; no equip when held', async () => {
    const bot = bagOf([[9, F.realItem('diamond_sword')], [10, GEAR.herAxe()], [11, GEAR.axe()], [40, F.realItem('stick')]], { held: 40 });
    await G.equipWeapon(bot);
    assert.deepEqual(equips(bot), [['equip', 'iron_axe', 'hand']]);
    assert.equal(bot.heldItem.name, 'iron_axe');
    await G.equipWeapon(bot);
    assert.equal(equips(bot).length, 1, 'already held');
    const tools = bagOf([[9, F.realItem('netherite_spear')], [10, F.realItem('wooden_shovel')], [11, F.realItem('iron_pickaxe')]]);
    await G.equipWeapon(tools);
    assert.deepEqual(equips(tools), [['equip', 'iron_pickaxe', 'hand']]);
    const spear = bagOf([[9, F.realItem('netherite_spear')]]);
    await G.equipWeapon(spear);
    assert.deepEqual(equips(spear), []);
});

test('the swing timer: PVP\'s counter gets interval − 1 (11 ticks with his axe or the hand, 14 with a sword); always a finite integer', () => {
    const bot = bagOf([[36, GEAR.axe()]]);
    Object.assign(bot, { pvp: { meleeAttackRate: { getTicks: () => 0 } }, collectBlock: {} });
    G.install(bot);
    const ticks = () => bot.pvp.meleeAttackRate.getTicks(bot);
    assert.equal(ticks(), 10);
    bot.heldItem = F.realItem('diamond_sword');
    assert.equal(ticks(), 13);
    bot.heldItem = null;
    assert.equal(ticks(), 10);
    bot.heldItem = withSpeed('iron_sword', 0);
    assert.equal(ticks(), 10);
    bot.heldItem = GEAR.herAxe();
    assert.equal(ticks(), 20);
});

// --- the plugin (design §1, §4) ------------------------------------------------------------

test('initBot loads pathfinder, pvp, tool, collectblock, autoEat, then gear, and the members gear replaces exist when it installs', async () => {
    const source = fs.readFileSync(new URL('../src/utils/mcdata.js', import.meta.url), 'utf8');
    const order = [...source.matchAll(/bot\.loadPlugin\((\w+)\)/g)].map(m => m[1]);
    assert.deepEqual(order, ['pathfinder', 'pvp', 'tool', 'collectblock', 'autoEat', 'gear']);
    assert.doesNotMatch(source, /from 'mineflayer-armor-manager'|armorManager/);
    // Mineflayer's own loader with the real tool and collectblock plugins.
    const bot = F.makeBot();
    for (const member of ['tool', 'pvp', 'pathfinder', 'collectBlock', 'armorManager']) delete bot[member];
    require('mineflayer/lib/plugin_loader.js')(bot, {});
    const native = () => 'native';
    bot.loadPlugin(b => { b.pathfinder = { bestHarvestTool: native }; });
    bot.loadPlugin(b => { b.pvp = { meleeAttackRate: { getTicks: () => 0 } }; });   // PVP's MaxDamageOffset solver
    bot.loadPlugin(require('mineflayer-tool').plugin);
    bot.loadPlugin(require('mineflayer-collectblock').plugin);
    bot.loadPlugin(() => {});
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        bot.loadPlugin(G.install);
        bot.emit('inject_allowed');
        const tool = bot.tool;
        await F.sleep(5);   // collectblock's deferred loadToolPlugin
        assert.equal(bot.tool, tool, 'collectblock skipped its own tool load');
    } finally {
        console.error = error;
    }
    assert.deepEqual(errors, []);
    assert.equal(bot.tool.constructor.name, 'Tool');
    assert.notEqual(bot.tool.equipForBlock, Object.getPrototypeOf(bot.tool).equipForBlock, 'gear\'s chooser');
    assert.notEqual(bot.pathfinder.bestHarvestTool, native);
    assert.equal(typeof bot.pvp.meleeAttackRate.getTicks, 'function');
    assert.equal(typeof bot.armorManager.equipAll, 'function');
    assert.equal(bot.tool.getDigTime(B('stone'), GEAR.copy()), 100, 'ms, upstream\'s unit');
});

test('install: a missing member is a loud startup error; bestHarvestTool is the fastest live item and falls back to the original on an error', () => {
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    const lonely = F.makeBot();
    delete lonely.tool;
    delete lonely.pvp;
    try {
        G.install(lonely);
    } finally {
        console.error = error;
    }
    assert.equal(errors.length, 3, 'tool.equipForBlock, tool.getDigTime, pvp.meleeAttackRate.getTicks');
    assert.ok(errors.every(e => /STARTUP ERROR/.test(e)));
    const bot = bagOf([[9, GEAR.herPickaxe()], [10, GEAR.copy()], [11, F.realItem('oak_planks', [], { count: 64 })]]);
    bot.pathfinder.bestHarvestTool = () => 'native';
    G.install(bot);
    assert.equal(bot.pathfinder.bestHarvestTool(B('stone')), bot.inventory.slots[10]);
    assert.equal(bot.pathfinder.bestHarvestTool(B('dirt')).name, 'diamond_pickaxe', 'equal ticks: the first, as upstream');
    bot.inventory.items = () => { throw new Error('broken'); };
    assert.equal(bot.pathfinder.bestHarvestTool(B('stone')), 'native');
});

// --- armour (design §4) ------------------------------------------------------------------

test('armour: his pieces stay worn; an empty slot is filled; a breakable piece gives way to a better one, that very instance; the off-hand by upstream\'s rule', async () => {
    const netherite = F.realItem('netherite_chestplate');
    const bot = bagOf([[6, GEAR.chest()], [7, GEAR.legs()], [8, GEAR.feet()], [5, F.realItem('leather_helmet')],
        [9, netherite], [10, F.realItem('iron_leggings')], [11, F.realItem('diamond_boots')], [12, F.realItem('iron_helmet')],
        [13, F.realItem('iron_helmet')], [14, F.realItem('shield')]]);
    G.install(bot);
    assert.equal(await bot.armorManager.equipAll(), true);
    assert.deepEqual(equips(bot), [['equip', 'iron_helmet', 'head'], ['equip', 'shield', 'off-hand']]);
    assert.equal(bot.inventory.slots[5].name, 'iron_helmet');
    assert.equal(bot.inventory.slots[12].name, 'leather_helmet', 'the instance in slot 12 went up, the leather one came down');
    assert.equal(bot.inventory.slots[13].name, 'iron_helmet');
    assert.equal(bot.inventory.slots[6].name, 'leather_chestplate', 'his unbreakable chestplate stays');
    assert.equal(bot.inventory.slots[9], netherite);
    // Equal rank: no swap. A totem beats the shield; nothing beats the totem.
    bot.calls.length = 0;
    bot.inventory.slots[15] = F.realItem('totem_of_undying');
    await bot.armorManager.equipAll();
    assert.deepEqual(equips(bot), [['equip', 'totem_of_undying', 'off-hand']]);
    bot.calls.length = 0;
    await bot.armorManager.equipAll();
    assert.deepEqual(equips(bot), []);
    // Her own pickup of a piece runs it 100 ms later; someone else's does not.
    const empty = bagOf([[9, F.realItem('golden_boots')]]);
    G.install(empty);
    empty.emit('playerCollect', { username: 'alex' }, { getDroppedItem: () => ({ name: 'golden_boots' }) });
    empty.emit('playerCollect', empty.entity, { getDroppedItem: () => ({ name: 'dirt' }) });
    await F.sleep(150);
    assert.deepEqual(equips(empty), []);
    empty.emit('playerCollect', empty.entity, { getDroppedItem: () => ({ name: 'golden_boots' }) });
    await F.until(() => empty.inventory.slots[8]);
    assert.equal(empty.inventory.slots[8].name, 'golden_boots', 'an empty slot is filled');
});

test('armour guards: nothing while a window is open, the cursor holds an item or a drop holds the slots; again on windowClose and when the hold ends; never rejects', async () => {
    const bot = bagOf([[9, F.realItem('iron_helmet')]]);
    G.install(bot);
    bot.currentWindow = { id: 3 };
    assert.equal(await bot.armorManager.equipAll(), false);
    assert.deepEqual(equips(bot), []);
    bot.currentWindow = null;
    bot.emit('windowClose');
    await F.until(() => bot.inventory.slots[5]);
    assert.equal(bot.inventory.slots[5].name, 'iron_helmet');
    const cursor = bagOf([[9, F.realItem('iron_helmet')]]);
    G.install(cursor);
    cursor.inventory.selectedItem = F.realItem('dirt');
    assert.equal(await cursor.armorManager.equipAll(), false);
    assert.equal(cursor.inventory.slots[5], null);
    // A drop holds the slots: skipped, then run when the hold ends.
    const held = bagOf([[9, F.realItem('iron_boots')]]);
    G.install(held);
    const release = G.holdSlots(held);
    assert.equal(await held.armorManager.equipAll(), false);
    assert.deepEqual(equips(held), []);
    release();
    release();   // once only
    await F.until(() => held.inventory.slots[8]);
    assert.equal(equips(held).length, 1);
    // Re-checked before each equip: a window that opens after the first piece stops the rest.
    const two = bagOf([[9, F.realItem('iron_boots')], [10, F.realItem('iron_helmet')]]);
    G.install(two);
    const equip = two.equip;
    two.equip = async (item, dest) => { await equip(item, dest); two.currentWindow = { id: 4 }; };
    await two.armorManager.equipAll();
    assert.equal(equips(two).length, 1);
    // An equip that throws is logged, never a rejection.
    const broken = bagOf([[9, F.realItem('iron_boots')]]);
    G.install(broken);
    broken.equip = async () => { throw new Error('server said no'); };
    const error = console.error;
    console.error = () => {};
    try {
        assert.equal(await broken.armorManager.equipAll(), false);
    } finally {
        console.error = error;
    }
});

// --- identity and giving (design §5) --------------------------------------------------------

test('the component signature tells his axe from a plain one and leaves out wear', () => {
    const worn = F.realItem('diamond_sword', [{ type: 'damage', data: 30 }]);
    assert.equal(G.signature(worn), G.signature(F.realItem('diamond_sword')));
    assert.notEqual(G.signature(GEAR.axe()), G.signature(F.realItem('iron_axe')));
    assert.notEqual(G.signature(F.realItem('iron_axe', [], { removed: ['attribute_modifiers'] })), G.signature(F.realItem('iron_axe')));
});

test('giving: of a gear name her spares go first, the kept best last; any other item by type, as before', async () => {
    const bot = bagOf([[9, GEAR.copy()], [10, F.realItem('iron_pickaxe', [{ type: 'damage', data: 200 }])], [11, F.realItem('iron_pickaxe')]]);
    assert.deepEqual(G.giveOrder(bot, 'iron_pickaxe'), [10, 11, 9], 'the most worn spare first, the copy last');
    assert.equal(G.giveOrder(bot, 'oak_log'), null);
    const odd = F.realItem('iron_pickaxe', [{ type: 'tool', data: { rules: [{ blocks: { name: 'minecraft:needs_magic' }, speed: 50 }],
        defaultMiningSpeed: 1, damagePerBlock: 1, canDestroyBlocksInCreative: true } }]);
    assert.deepEqual(G.giveOrder(bagOf([[9, odd], [10, F.realItem('iron_pickaxe')]]), 'iron_pickaxe'), [10, 9], 'an unreadable one is kept: it goes last');
    // The work give step and !givePlayer share skills.giveToPlayer.
    const agent = F.makeAgent({ bot, name: 'gear-give' });
    agents.push(agent);
    F.clearRecord(agent);
    F.player(bot, F.OWNER, [3, 64, 0]);
    F.startWork(agent);
    bot.hooks.toss = (name, count, entity) => setTimeout(() => bot.collect(F.OWNER, entity), 5);
    const stop = F.drive(agent);
    try {
        agent.work.startTask('a pickaxe', `give player=${F.OWNER} item=iron_pickaxe count=1`);
        await F.until(() => agent.work.record.status === 'done', { timeout: 8000 });
    } finally {
        stop();
    }
    assert.deepEqual(bot.calls.filter(c => c[0] === 'toss').map(c => c[3]), [10], 'that very slot');
    assert.equal(bot.inventory.slots[9].name, 'iron_pickaxe', 'the copy stays');
});

// --- fix wave 1 (rulings r1) ---------------------------------------------------------------

test('fix wave 1, 1 (Sol 1): giving gives nothing with an item on the cursor or a container open, and says so; it stops between slots when that starts', async () => {
    let n = 0;
    const make = () => {
        const bot = bagOf([[9, GEAR.copy()], [10, F.realItem('iron_pickaxe', [{ type: 'damage', data: 200 }])], [11, F.realItem('iron_pickaxe')]]);
        const agent = F.makeAgent({ bot, name: `gear-busy${n++}` });   // bot.modes for goToPlayer
        agents.push(agent);
        F.clearRecord(agent);
        F.player(bot, F.OWNER, [3, 64, 0]);
        return bot;
    };
    const tosses = bot => bot.calls.filter(c => c[0] === 'toss');
    const cursor = make();
    cursor.inventory.selectedItem = GEAR.axe();
    assert.equal(await skills.giveToPlayer(cursor, 'iron_pickaxe', F.OWNER, 1), false);
    assert.deepEqual(tosses(cursor), [], 'his axe on the cursor is never tossed');
    assert.match(cursor.output, /an item on the cursor/);
    const open = make();
    open.currentWindow = { id: 1 };
    assert.equal(await skills.giveToPlayer(open, 'iron_pickaxe', F.OWNER, 1), false);
    assert.deepEqual(tosses(open), []);
    assert.match(open.output, /a container is open/);
    // Any other item too: the same clicks.
    const logs = make();
    logs.give('oak_log', 5);
    logs.inventory.selectedItem = GEAR.axe();
    assert.equal(await skills.giveToPlayer(logs, 'oak_log', F.OWNER, 1), false);
    assert.deepEqual(tosses(logs), []);
    // Between slots: a cursor item that appears after the first toss stops the rest.
    const mid = make();
    mid.hooks.toss = () => { mid.inventory.selectedItem = GEAR.axe(); };
    await skills.giveToPlayer(mid, 'iron_pickaxe', F.OWNER, 2);
    assert.deepEqual(tosses(mid).map(c => c[3]), [10]);
    // A slot whose instance changed after the order was made is skipped.
    const swap = make();
    swap.hooks.toss = (name, count) => { if (count) swap.inventory.slots[11] = GEAR.copy(); };
    await skills.giveToPlayer(swap, 'iron_pickaxe', F.OWNER, 2);
    assert.deepEqual(tosses(swap).map(c => c[3]), [10, 9], 'slot 11 now holds another copy: skipped');
});

test('fix wave 1, 2 (Sol 2): the pathfinder\'s tool is the fastest harvesting item when any harvests; the fastest item otherwise', () => {
    const golden = F.realItem('golden_pickaxe', [{ type: 'enchantments', data: { enchantments: [{ id: 8, level: 5 }] } }]);
    const stone = F.realItem('stone_pickaxe');
    const bot = bagOf([[9, golden], [10, stone]]);
    assert.ok(G.digTicks(bot, B('iron_ore'), golden) < G.digTicks(bot, B('iron_ore'), stone), 'the golden one is faster');
    assert.equal(G.fastestTool(bot, B('iron_ore')), bot.inventory.slots[10], 'but only the stone one gets raw iron');
    const none = bagOf([[9, golden], [10, F.realItem('oak_planks', [], { count: 64 })]]);
    assert.equal(G.fastestTool(none, B('iron_ore')), none.inventory.slots[9], 'no harvester: the fastest, as upstream');
    assert.equal(G.fastestTool(bot, B('stone')), bot.inventory.slots[9], 'both harvest stone: the fastest');
});

test('fix wave 1, 3 (Sol 4): each member gear replaces is checked first; a missing one is a startup error naming it and stays as it was', () => {
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    const bot = F.makeBot();
    const equipForBlock = bot.tool.equipForBlock;
    delete bot.tool.getDigTime;
    delete bot.pathfinder.bestHarvestTool;
    bot.pvp.meleeAttackRate = {};
    try {
        G.install(bot);
    } finally {
        console.error = error;
    }
    assert.equal(errors.length, 3, errors.join('\n'));
    assert.match(errors[0], /STARTUP ERROR: bot\.tool\.getDigTime/);
    assert.match(errors[1], /STARTUP ERROR: bot\.pathfinder\.bestHarvestTool/);
    assert.match(errors[2], /STARTUP ERROR: bot\.pvp\.meleeAttackRate\.getTicks/);
    assert.equal(bot.tool.getDigTime, undefined);
    assert.equal(bot.pathfinder.bestHarvestTool, undefined);
    assert.deepEqual(bot.pvp.meleeAttackRate, {});
    assert.notEqual(bot.tool.equipForBlock, equipForBlock, 'a present member is still replaced');
    // The fixture's plugins carry every member: no error.
    const full = F.makeBot();
    console.error = (...args) => errors.push(args.join(' '));
    try {
        G.install(full);
    } finally {
        console.error = error;
    }
    assert.equal(errors.length, 3);
});

test('fix wave 1, 5 (adversary G3, Mb): each kind\'s winner is kept when another kind\'s item outranks it', () => {
    // An unbreakable sword dealing 30 outranks his axe as a weapon; his axe still wins the axe kind and stays.
    const sword = F.realItem('netherite_sword', [{ type: 'unbreakable', data: null }, { type: 'attribute_modifiers', data: [
        { typeId: 2, name: 'minecraft:base_attack_damage', value: 29, operation: 'add', slot: 'main_hand', display: { type: 'default' } }] }]);
    const bot = bagOf([[9, GEAR.axe()], [10, sword], [11, GEAR.herAxe()]]);
    const { kinds, kept } = G.assess(bot);
    assert.equal(kinds.get('weapon').winner.slot, 10, 'the sword is her weapon');
    assert.equal(kinds.get('axe').winner.slot, 9, 'his axe her axe');
    assert.ok(kept.has(9), 'his axe is kept');
    assert.deepEqual(G.spares(bot).map(e => e.slot ?? e), [11]);
});
