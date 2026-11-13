// Gear (SPEC §9.5 REQ-GEAR-1; design runtime/diagnostics/i1-build/gear/
// recommended-design.md r5 §1–§4; DECISIONS 2026-11-12 (night) "The owner's
// gear and a one-stack cap", 2026-11-13). Pure readers and rankers with no
// model call: the item's own data decides (its 26.1 components, then vanilla
// values), so she uses the best gear she has, which is the owner's. Every
// reader is guarded: an item it cannot read is `unreadable`, ranked by vanilla
// values and never a spare. `install` is the Mineflayer plugin that puts the
// rankers behind the members upstream code calls (mcdata.js initBot, loaded
// last): bot.tool's equip and dig time, the pathfinder's tool, the PVP swing
// timer and our own armour controller in place of mineflayer-armor-manager.

// Mineflayer's equipment slots (simple_inventory.js armorSlots) and the
// destinations bot.equip takes for them.
const ARMOUR = Object.freeze([
    { kind: 'head', dest: 'head', slot: 5 },
    { kind: 'chest', dest: 'torso', slot: 6 },
    { kind: 'legs', dest: 'legs', slot: 7 },
    { kind: 'feet', dest: 'feet', slot: 8 },
]);
const OFFHAND_SLOT = 45;
const OFFHAND_RANK = ['shield', 'totem_of_undying'];   // upstream's order: a totem over a shield
const ARMOUR_SUFFIX = { head: '_helmet', chest: '_chestplate', legs: '_leggings', feet: '_boots' };
export const TOOL_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe']);
// The planner's kinds (design §5): the four tools, one melee weapon over swords
// and axes (an axe is a candidate in both), one piece per armour slot.
export const KINDS = Object.freeze([...TOOL_KINDS, 'weapon', 'head', 'chest', 'legs', 'feet']);
// The block a tool kind's speed is read on (design §3).
const REFERENCE = Object.freeze({ pickaxe: 'stone', axe: 'oak_log', shovel: 'dirt', hoe: 'hay_block' });
// A fight's fallback when she has no sword or axe; never a spear (its reach rules differ).
const OTHER_WEAPONS = new Set(['pickaxe', 'shovel', 'hoe', 'trident', 'mace']);

// Game facts, not config (design §2). The player's bases: attack damage 1,
// attack speed 4, armour and toughness 0 (P17: the vanilla speed modifiers
// matched, his axe +0 = speed 4, a diamond axe −3 = speed 1).
const BASE = Object.freeze({ damage: 1, speed: 4 });
const HURT_TICKS = 10;   // a hit within 10 ticks of the last lands nothing (P17)
const TIERS = ['wooden', 'stone', 'copper', 'golden', 'iron', 'diamond', 'netherite'];
// Vanilla attack values, damage including the base 1, per tier in TIERS order
// (Opus proposal §2). The copper rows are vanilla knowledge: P17 had no copper item.
const VANILLA_ATTACK = Object.freeze({
    sword: { damage: [4, 5, 5, 4, 6, 7, 8], speed: 1.6 },
    axe: { damage: [7, 9, 9, 7, 9, 9, 10], speed: [0.8, 0.8, 0.8, 1.0, 0.9, 1.0, 1.0] },
    pickaxe: { damage: [2, 3, 3, 2, 4, 5, 6], speed: 1.2 },
    shovel: { damage: [2.5, 3.5, 3.5, 2.5, 4.5, 5.5, 6.5], speed: 1.0 },
    hoe: { damage: 1, speed: [1, 2, 2, 1, 3, 4, 4] },
});
const VANILLA_SINGLE = Object.freeze({ trident: { damage: 9, speed: 1.1 }, mace: { damage: 6, speed: 0.6 } });
// Armour per piece [head, chest, legs, feet] and toughness; copper flagged as above.
const VANILLA_ARMOUR = Object.freeze({
    leather: { armour: [1, 3, 2, 1], toughness: 0 },
    copper: { armour: [2, 4, 3, 1], toughness: 0 },
    golden: { armour: [2, 5, 3, 1], toughness: 0 },
    chainmail: { armour: [2, 5, 4, 1], toughness: 0 },
    iron: { armour: [2, 6, 5, 2], toughness: 0 },
    diamond: { armour: [3, 8, 6, 3], toughness: 2 },
    netherite: { armour: [3, 8, 6, 3], toughness: 3 },
    turtle: { armour: [2, 0, 0, 0], toughness: 0 },
});
const ARMOUR_INDEX = { head: 0, chest: 1, legs: 2, feet: 3 };
// The attribute_modifiers slot groups that apply where an item is used.
const GROUPS = { hand: ['any', 'main_hand', 'hand'], head: ['any', 'head', 'armor'], chest: ['any', 'chest', 'armor'],
    legs: ['any', 'legs', 'armor'], feet: ['any', 'feet', 'armor'] };
// The incorrect_for_<tier>_tool tags derived from the registry: a tier's
// pickaxe item name per tag name.
const INCORRECT = Object.freeze({ wooden: 'wooden_pickaxe', stone: 'stone_pickaxe', copper: 'copper_pickaxe', gold: 'golden_pickaxe',
    iron: 'iron_pickaxe', diamond: 'diamond_pickaxe', netherite: 'netherite_pickaxe' });

// --- reading an item (design §2) -----------------------------------------------------

const removed = (item, type) => (item.removedComponents ?? []).some(c => (c?.type ?? c) === type);
const component = (item, type) => (removed(item, type) ? undefined : item.componentMap?.get?.(type));
const tierOf = name => TIERS.findIndex(t => name.startsWith(`${t}_`));
const pick = (value, tier) => (Array.isArray(value) ? value[tier] : value);

// The kind of an item by its name: a tool kind, 'sword', an armour slot, or null.
export function kindOf(name) {
    if (typeof name !== 'string') return null;
    for (const kind of TOOL_KINDS) if (name.endsWith(`_${kind}`)) return kind;
    if (name.endsWith('_sword')) return 'sword';
    for (const [slot, suffix] of Object.entries(ARMOUR_SUFFIX)) if (name.endsWith(suffix)) return slot;
    if (name === 'trident' || name === 'mace') return name;
    return null;
}
const isMelee = kind => kind === 'sword' || kind === 'axe';

function vanillaAttack(name) {
    const kind = kindOf(name);
    if (VANILLA_SINGLE[name]) return VANILLA_SINGLE[name];
    const row = VANILLA_ATTACK[kind];
    const tier = tierOf(name);
    if (!row || tier < 0) return { damage: BASE.damage, speed: BASE.speed };
    return { damage: pick(row.damage, tier), speed: pick(row.speed, tier) };
}

function vanillaArmour(name, slot) {
    const row = VANILLA_ARMOUR[Object.keys(VANILLA_ARMOUR).find(m => name.startsWith(`${m}_`))];
    return row ? { armour: row.armour[ARMOUR_INDEX[slot]], toughness: row.toughness } : { armour: 0, toughness: 0 };
}

// An attribute as the item gives it where it is used: a present
// `attribute_modifiers` component replaces the vanilla modifiers entirely, a
// removed one means none, an absent one the vanilla value. Entries count by
// `typeId` (bot.registry.attributesArray[typeId].resource) and slot group.
function attribute(bot, item, resource, groups, base, vanilla) {
    if (removed(item, 'attribute_modifiers')) return base;
    const modifiers = item.componentMap?.get?.('attribute_modifiers')?.data;
    if (!modifiers) return vanilla;
    let add = base;
    let multiplyBase = 0;
    let multiplyTotal = 1;
    for (const m of modifiers) {
        if (bot.registry.attributesArray?.[m.typeId]?.resource !== resource || !groups.includes(m.slot)) continue;
        const value = Number(m.value);
        if (m.operation === 'add') add += value;
        else if (m.operation === 'multiply_base') multiplyBase += value;
        else if (m.operation === 'multiply_total') multiplyTotal *= 1 + value;
    }
    return add * (1 + multiplyBase) * multiplyTotal;
}

// The `tool` component as rules {matches(type), speed, drop}, or null (vanilla
// mining from the registry). A rule naming a tag we cannot derive throws: the
// item is then unreadable and mines by its vanilla values.
function toolRules(bot, item) {
    if (removed(item, 'tool')) return { rules: [], defaultSpeed: 1, signature: 'removed' };
    const data = item.componentMap?.get?.('tool')?.data;
    if (!data) return null;
    const rules = (data.rules ?? []).map(rule => {
        const set = rule.blocks ?? {};
        let matches;
        if (typeof set.name === 'string') {
            const tag = set.name.replace(/^#?minecraft:/, '');
            if (!knownTag(tag)) throw new Error(`unknown tag ${set.name}`);
            matches = type => blockTags(bot, type).has(tag);
        } else if (Array.isArray(set.ids)) {
            const ids = new Set(set.ids);
            matches = type => ids.has(type);
        } else throw new Error('unreadable block set');
        return { matches, speed: rule.speed ?? null, drop: rule.correctDropForBlocks ?? null };
    });
    return { rules, defaultSpeed: Number(data.defaultMiningSpeed ?? 1), signature: JSON.stringify(data) };
}

function enchantLevels(bot, item) {
    const levels = {};
    for (const e of item.enchants ?? []) {
        const name = e?.name ?? bot.registry.enchantments?.[e?.id]?.name;
        if (name) levels[name] = Math.max(levels[name] ?? 0, Number(e.lvl) || 0);
    }
    return levels;
}

const sharpness = level => (level > 0 ? 0.5 * level + 0.5 : 0);

// Swing spacing in ticks for an attack speed: the solver's ticks (20 / speed,
// at least the 10-tick hurt cooldown) plus 1, because PVP fires one tick after
// its counter reaches 0 (PVP.js update). Every swing at 11 ticks or more lands
// in full. Null for a speed that is not a positive finite number.
export function ticksFor(speed) {
    if (!(speed > 0) || !Number.isFinite(speed)) return null;
    return Math.max(HURT_TICKS, Math.ceil(20 / speed - 1e-9)) + 1;
}

const readings = new WeakMap();
const HAND_READING = Object.freeze({ name: null, kind: null, unreadable: false, unbreakable: false, levels: {}, silk: false,
    efficiency: 0, tool: null, damage: BASE.damage, speed: BASE.speed, interval: ticksFor(BASE.speed),
    score: BASE.damage * 20 / ticksFor(BASE.speed), durability: 0, armour: 0, toughness: 0, protection: 0 });

// Everything ranking needs from one item, cached per item object (Mineflayer
// makes a new object on every slot update, so the cache is never stale).
// Never throws: a part it cannot read falls back to vanilla and marks the item
// unreadable.
export function read(bot, item) {
    if (!item) return HAND_READING;
    let r = readings.get(item);
    if (r) return r;
    r = { name: item.name, kind: kindOf(item.name), unreadable: false };
    const guard = (fn, fallback) => {
        try {
            return fn();
        } catch {
            r.unreadable = true;
            return fallback;
        }
    };
    r.unbreakable = guard(() => Boolean(component(item, 'unbreakable')), false);
    r.levels = guard(() => enchantLevels(bot, item), {});
    r.silk = (r.levels.silk_touch ?? 0) > 0;
    r.efficiency = r.levels.efficiency ?? 0;
    r.tool = guard(() => toolRules(bot, item), null);
    const vanilla = guard(() => vanillaAttack(item.name), { damage: BASE.damage, speed: BASE.speed });
    r.damage = guard(() => attribute(bot, item, 'minecraft:attack_damage', GROUPS.hand, BASE.damage, vanilla.damage), vanilla.damage)
        + sharpness(r.levels.sharpness ?? 0);
    r.speed = guard(() => attribute(bot, item, 'minecraft:attack_speed', GROUPS.hand, BASE.speed, vanilla.speed), vanilla.speed);
    r.interval = ticksFor(r.speed);
    r.score = r.interval ? r.damage * 20 / r.interval : -Infinity;
    if (ARMOUR_SUFFIX[r.kind]) {
        const plain = guard(() => vanillaArmour(item.name, r.kind), { armour: 0, toughness: 0 });
        r.armour = guard(() => attribute(bot, item, 'minecraft:armor', GROUPS[r.kind], 0, plain.armour), plain.armour);
        r.toughness = guard(() => attribute(bot, item, 'minecraft:armor_toughness', GROUPS[r.kind], 0, plain.toughness), plain.toughness);
    } else {
        r.armour = 0;
        r.toughness = 0;
    }
    r.protection = r.levels.protection ?? 0;
    r.durability = guard(() => {
        if (r.unbreakable) return Infinity;
        const max = Number(component(item, 'max_damage')?.data ?? item.maxDurability ?? bot.registry.itemsByName?.[item.name]?.maxDurability ?? 0);
        return max ? max - (Number(item.durabilityUsed) || 0) : 0;
    }, 0);
    readings.set(item, r);
    return r;
}

// The swing spacing of the held item (the bare hand counts as speed 4); always
// a finite integer: an item with an unusable speed swings as the bare hand.
export function interval(bot, item) {
    return read(bot, item).interval ?? HAND_READING.interval;
}

// The item's component signature (design §5): what tells two items of one name
// apart. Without `damage`, so wear does not change it.
export function signature(item) {
    if (!item) return '';
    try {
        const list = item.componentMap ? [...item.componentMap.values()] : (item.components ?? []);
        return JSON.stringify([list.filter(c => c?.type !== 'damage'), item.removedComponents ?? []],
            (key, value) => (typeof value === 'bigint' ? String(value) : value));
    } catch {
        return '?';
    }
}

// --- mining (design §2) ------------------------------------------------------------------

const typeOf = block => block?.type ?? block?.id;
const tagCache = new WeakMap();   // registry → Map(block type → Set of tags)

// A block's tags, derived from the registry and cached per block type: its
// material split on ';', plus mineable/pickaxe when a part starts
// `incorrect_for_` (the 26.1 bridge: 108 blocks, ores and obsidian among them,
// carry that material instead), plus the derived incorrect_for_<tier>_tool tags
// (a pickaxe block that needs a tool and whose harvest tools lack that tier's pickaxe).
export function blockTags(bot, type) {
    const registry = bot.registry;
    let cache = tagCache.get(registry);
    if (!cache) tagCache.set(registry, cache = new Map());
    let tags = cache.get(type);
    if (tags) return tags;
    const block = registry.blocks[type];
    tags = new Set();
    for (const part of String(block?.material ?? 'default').split(';')) {
        if (part.startsWith('incorrect_for_')) tags.add('mineable/pickaxe');
        else tags.add(part);
    }
    if (tags.has('mineable/pickaxe') && block?.harvestTools)
        for (const [tier, pickaxe] of Object.entries(INCORRECT))
            if (!block.harvestTools[registry.itemsByName[pickaxe]?.id]) tags.add(`incorrect_for_${tier}_tool`);
    cache.set(type, tags);
    return tags;
}
// The tags a tool rule may name: the vanilla mining tags we derive.
const knownTag = tag => /^mineable\/(pickaxe|axe|shovel|hoe)$/.test(tag) || Object.keys(INCORRECT).some(t => tag === `incorrect_for_${t}_tool`);

// Mining speed of an item (null: the bare hand) on a block: a `tool`
// component's first matching rule with a speed, else its default; without one
// the highest registry material speed over the block's material and tags, else
// 1; Efficiency adds level² + 1 when the speed is above 1.
export function toolSpeed(bot, item, block) {
    if (!item) return 1;
    const type = typeOf(block);
    const r = read(bot, item);
    let speed;
    if (r.tool) {
        const rule = r.tool.rules.find(rule => rule.speed != null && rule.matches(type));
        speed = rule ? Number(rule.speed) : r.tool.defaultSpeed;
    } else {
        // The incorrect_for_* tables hold a tier's speed for every tool kind, not mining speeds of this block.
        const material = bot.registry.blocks[type]?.material ?? 'default';
        speed = 1;
        for (const key of [material, ...blockTags(bot, type)])
            if (!key.startsWith('incorrect_for_')) speed = Math.max(speed, bot.registry.materials?.[key]?.[item.type] ?? 1);
    }
    if (speed > 1 && r.efficiency > 0) speed += r.efficiency * r.efficiency + 1;
    return speed;
}

// Whether the item (null: the bare hand) gets the block's drop: true when the
// block needs no tool; with a `tool` component its first matching rule that
// says so; else the registry's harvest tools.
export function canHarvest(bot, block, item) {
    const type = typeOf(block);
    const tools = bot.registry.blocks[type]?.harvestTools;
    if (!tools) return true;
    if (!item) return false;
    const r = read(bot, item);
    if (r.tool) return Boolean(r.tool.rules.find(rule => rule.drop != null && rule.matches(type))?.drop);
    return Boolean(tools[item.type]);
}

// Ticks to break the block with the item, prismarine-block's formula with the
// speed and harvest above (no effects: the ranking is relative).
export function digTicks(bot, block, item) {
    const hardness = bot.registry.blocks[typeOf(block)]?.hardness;
    if (hardness == null || hardness < 0) return Infinity;
    const delta = toolSpeed(bot, item, block) / hardness / (canHarvest(bot, block, item) ? 30 : 100);
    if (!(delta > 0)) return Infinity;
    return delta >= 1 ? 0 : Math.ceil(1 / delta);
}

const reachCache = new WeakMap();   // registry → Map(type|tool signature → count)

// How many tool-requiring blocks the item harvests, cached per item type and
// tool component: the owner's copy 403 = a diamond pickaxe 403; iron 398.
export function reach(bot, item) {
    if (!item) return 0;
    const registry = bot.registry;
    let cache = reachCache.get(registry);
    if (!cache) reachCache.set(registry, cache = new Map());
    const key = `${item.type}|${read(bot, item).tool?.signature ?? ''}`;
    if (!cache.has(key)) cache.set(key, registry.blocksArray.filter(b => b.harvestTools && canHarvest(bot, b, item)).length);
    return cache.get(key);
}

// The silk rule (the S2 collectBlock predicate, moved here): a silk-touch item
// changes this block's drop (it drops something, and not itself, without
// silk), unless the block itself is what is wanted.
export function silkChangesDrop(bot, block, item, wanted = null) {
    if (!item || !read(bot, item).silk) return false;
    const entry = bot.registry.blocks[typeOf(block)];
    if (!entry || entry.name === wanted) return false;
    const drops = entry.drops ?? [];
    return drops.length > 0 && !drops.includes(bot.registry.itemsByName[entry.name]?.id);
}

// A collection's target block object answers `canHarvest` with the
// component-aware check for the held item instance (design §4): skills'
// check, collectblock's own (CollectBlock.js mineBlock) and the dig wait
// (prismarine-block digTime) all ask this object. Only for the held item's
// type, never a lookup by type; any other type asks the registry as before.
export function bindHarvest(bot, block) {
    const native = Object.getPrototypeOf(block)?.canHarvest;
    block.canHarvest = type => {
        const held = bot.heldItem;
        if (type == null) return canHarvest(bot, block, null);
        if (held && held.type === type) return canHarvest(bot, block, held);
        return native ? native.call(block, type) : false;
    };
    return block;
}

// --- ranking (design §3) -----------------------------------------------------------------

// Keys compared one by one, highest first.
export function compare(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
}

const flag = value => (value ? 1 : 0);
export const weaponKey = (bot, item) => { const r = read(bot, item); return [flag(r.unbreakable), r.score, r.damage, r.durability]; };
export const armourKey = (bot, item) => { const r = read(bot, item); return [flag(r.unbreakable), r.armour, r.toughness, r.protection, r.durability]; };
// Owner ruling 2026-11-12 (night), "capability first": reach, then no silk
// touch (silk loses cobblestone, coal and raw ore), then unbreakable, then speed.
export function toolKey(bot, item, kind) {
    const r = read(bot, item);
    const ref = bot.registry.blocksByName[REFERENCE[kind]];
    return [reach(bot, item), flag(!r.silk), flag(r.unbreakable), ref ? toolSpeed(bot, item, ref) : 1, r.durability];
}

function keyFor(bot, item, kind) {
    if (kind === 'weapon') return weaponKey(bot, item);
    if (ARMOUR_SUFFIX[kind]) return armourKey(bot, item);
    return toolKey(bot, item, kind);
}

// Whether an item is a candidate of a planner kind. A sword or axe with an
// unusable attack speed is never wielded, so it is no weapon candidate.
function inKind(bot, item, kind) {
    const r = read(bot, item);
    if (kind === 'weapon') return isMelee(r.kind) && r.interval != null;
    return r.kind === kind;
}

// Entries {item, slot} of the 36 slots (the hotbar included).
function bag(bot) {
    const start = bot.inventory.inventoryStart ?? 9;
    const end = bot.inventory.inventoryEnd ?? 45;
    const out = [];
    for (let slot = start; slot < end; slot++) if (bot.inventory.slots[slot]) out.push({ item: bot.inventory.slots[slot], slot });
    return out;
}

// Best first: by key, then the held or worn item, then the lowest slot (no equip churn).
function ranked(entries, key, current) {
    return entries.map(e => ({ ...e, key: key(e.item) }))
        .sort((a, b) => compare(b.key, a.key) || flag(current(b)) - flag(current(a)) || a.slot - b.slot);
}

// Per kind (design §5): the winner (the held or worn one on a tie) and the
// spares, lowest rank first. The worn piece is an armour slot's candidate,
// never a spare. `kept` holds the slots that stay whatever the policy says:
// the winners, every unreadable item, a melee item that can never be wielded.
export function assess(bot) {
    const items = bag(bot);
    const kinds = new Map();
    const kept = new Set();
    for (const e of items) {
        const r = read(bot, e.item);
        if (r.unreadable || (isMelee(r.kind) && r.interval == null)) kept.add(e.slot);
    }
    for (const kind of KINDS) {
        const armour = ARMOUR.find(a => a.kind === kind);
        const worn = armour && bot.inventory.slots[armour.slot] ? [{ item: bot.inventory.slots[armour.slot], slot: armour.slot, worn: true }] : [];
        const candidates = [...worn, ...items.filter(e => inKind(bot, e.item, kind))];
        if (!candidates.length) continue;
        const order = ranked(candidates, item => keyFor(bot, item, kind), e => e.worn || e.item === bot.heldItem);
        const [winner, ...rest] = order;
        if (!winner.worn) kept.add(winner.slot);
        kinds.set(kind, { winner, spares: rest.filter(e => !e.worn).reverse() });
    }
    return { kinds, kept };
}

// The gear spares (design §5), lowest rank first per kind, each slot once.
export function spares(bot) {
    const { kinds, kept } = assess(bot);
    const out = [];
    const seen = new Set();
    for (const { spares: list } of kinds.values())
        for (const e of list) if (!kept.has(e.slot) && !seen.has(e.slot)) { seen.add(e.slot); out.push(e); }
    return out;
}

// Why a kind's winner is kept, for !itemList ("iron_axe: unbreakable, score 23.6").
export function why(bot, kind, item) {
    const r = read(bot, item);
    const round = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : n);
    const parts = [];
    if (TOOL_KINDS.includes(kind)) {
        const key = toolKey(bot, item, kind);
        if (key[0]) parts.push(`reaches ${key[0]} blocks`);
        if (r.silk) parts.push('silk touch');
        if (r.unbreakable) parts.push('unbreakable');
        parts.push(`speed ${round(key[3])}`);
    } else if (kind === 'weapon') {
        if (r.unbreakable) parts.push('unbreakable');
        parts.push(`score ${round(r.score)}`);
    } else {
        if (r.unbreakable) parts.push('unbreakable');
        parts.push(`armour ${round(r.armour)}`);
        if (r.toughness) parts.push(`toughness ${round(r.toughness)}`);
    }
    if (r.unreadable) parts.push('partly unreadable');
    return parts.join(', ');
}

// One instance's rank among the items of its name, for giving and for the
// item list's counted and "slot" paths (gear rulings r1, 4: adversary G2, his
// axe never loses to an enchantment count): a sword by the weapon key, any
// other gear kind by its own kind's key (an axe by the axe's tool key; an
// unreadable item by its vanilla values, design §2). Null for a name that is
// no ranked gear.
export function gearRank(bot, item) {
    const kind = kindOf(item?.name);
    if (!kind || kind === 'trident' || kind === 'mace') return null;
    return keyFor(bot, item, kind === 'sword' ? 'weapon' : kind);
}

// The order to give instances of a name in (design §5, owner 2026-11-13: "she
// would just give me the one she has"): spares first, lowest rank first
// (gearRank), the kept best last. Null for a name that is no gear (given by
// type as today).
export function giveOrder(bot, name) {
    const kind = kindOf(name);
    if (!kind || kind === 'trident' || kind === 'mace') return null;
    const { kept } = assess(bot);
    const key = e => gearRank(bot, e.item);
    return bag(bot).filter(e => e.item.name === name)
        .sort((a, b) => flag(kept.has(a.slot)) - flag(kept.has(b.slot)) || compare(key(a), key(b)) || a.slot - b.slot)
        .map(e => e.slot);
}

// --- using the best (design §4) ------------------------------------------------------------

const states = new WeakMap();
function state(bot) {
    let s = states.get(bot);
    if (!s) states.set(bot, s = { intent: null, holds: 0, pending: false, running: false, installed: false });
    return s;
}

// The held slot's object is bot.heldItem (Mineflayer updateHeldItem).
const isHeld = (bot, item) => (item ? item === bot.heldItem : bot.heldItem == null);

// Why no slot may be clicked now, or null: an item on the cursor (a one-slot
// transfer swaps it in and tosses it as a leftover), or a container window
// open (the click would act on it). Shared with the dropper (inventory.js).
export function busy(bot) {
    if (bot.inventory.selectedItem) return 'an item on the cursor';
    if (bot.currentWindow && bot.currentWindow !== bot.inventory) return 'a container is open';
    return null;
}

// Fights: the best melee weapon; with none, the highest-scoring other item
// (never a spear); no equip when it is already held.
export async function equipWeapon(bot) {
    const items = bag(bot);
    const held = e => isHeld(bot, e.item);
    let best = ranked(items.filter(e => inKind(bot, e.item, 'weapon')), item => weaponKey(bot, item), held)[0];
    if (!best) best = ranked(items.filter(e => OTHER_WEAPONS.has(read(bot, e.item).kind) && read(bot, e.item).interval != null),
        item => [read(bot, item).score], held)[0];
    if (!best || isHeld(bot, best.item)) return;
    await bot.equip(best.item, 'hand');
}

// The intent of the collection running now ({ wanted: block name }), set by
// skills.collectBlock around it so collectblock's nested re-equip honours the
// silk rule. Returns the function that restores the previous one.
export function intend(bot, intent) {
    const s = state(bot);
    const previous = s.intent;
    s.intent = intent;
    return () => { s.intent = previous; };
}

// The tool for one block (design §3): harvests it (when any candidate does),
// silk avoided where it changes the drop unless the block itself is wanted,
// dig ticks, unbreakable, already held, lowest slot. The bare hand is a
// candidate only while an empty slot exists (unequipping with a full bag tosses
// the held stack, simple_inventory.js:67). Null when nothing qualifies.
export function chooseFor(bot, block, { requireHarvest = false, hand = true, intent = state(bot).intent } = {}) {
    let entries = bag(bot);
    if (hand && bot.inventory.emptySlotCount() >= 1) entries.unshift({ item: null, slot: -1 });
    if (requireHarvest) entries = entries.filter(e => canHarvest(bot, block, e.item));
    if (!entries.length) return null;
    const wanted = intent?.wanted ?? null;
    const key = item => [flag(canHarvest(bot, block, item)), flag(!silkChangesDrop(bot, block, item, wanted)),
        -digTicks(bot, block, item), flag(read(bot, item).unbreakable), flag(isHeld(bot, item))];
    return ranked(entries, key, () => false)[0];
}

function noItem() {
    const err = new Error('Bot does not have a harvestable tool!');   // mineflayer-tool's own error
    err.name = 'NoItem';
    return err;
}

// bot.tool.equipForBlock (upstream's signature without the callback; no chest
// fetch: no chest locations are configured). `requireHarvest` keeps only
// harvesting items and refuses with upstream's NoItem error when none does.
export async function equipForBlock(bot, block, options = {}) {
    const requireHarvest = Boolean(options.requireHarvest);
    let best = chooseFor(bot, block, { requireHarvest });
    if (best && best.item === null) {
        if (isHeld(bot, null)) return;
        // Re-checked right before unequipping: the bag may have filled meanwhile.
        if (bot.inventory.emptySlotCount() >= 1) {
            await bot.unequip('hand');
            return;
        }
        best = chooseFor(bot, block, { requireHarvest, hand: false });
    }
    if (!best) {
        if (requireHarvest) throw noItem();
        return;
    }
    if (isHeld(bot, best.item)) return;
    await bot.equip(best.item, 'hand');
}

// bot.pathfinder.bestHarvestTool: the fastest harvesting item by dig ticks
// when any harvests the block (gear rulings r1, 2: Sol 2, a faster golden
// pickaxe would destroy iron ore), else the fastest item, as upstream; no silk
// rule, no intent, no bare hand (on null the pathfinder digs with whatever she
// holds); a loop over the live items as upstream's.
export function fastestTool(bot, block) {
    let best = null;
    let rank = [-1, -Infinity];
    for (const item of bot.inventory.items()) {
        const key = [flag(canHarvest(bot, block, item)), -digTicks(bot, block, item)];
        if (compare(key, rank) > 0) {
            rank = key;
            best = item;
        }
    }
    return best;
}

// The armour controller (design §4), in place of mineflayer-armor-manager:
// per slot the best of the worn piece and the bag pieces, equipped only when a
// bag piece ranks strictly higher, the very instance ranked; the off-hand by
// upstream's rule. Nothing while a window is open, the cursor holds an item,
// or an item pass or the runner's drop holds the slots (re-checked before each
// equip: the clicks would act on the open window); it runs again on
// windowClose and when that hold ends. Never rejects: no unhandledRejection
// handler exists, so a rejection would end the process.
export async function equipAll(bot) {
    const s = state(bot);
    const blocked = () => s.holds > 0 || Boolean(busy(bot));
    if (s.running || blocked()) {
        s.pending = true;
        return false;
    }
    s.running = true;
    s.pending = false;
    try {
        const items = bag(bot);
        for (const { kind, dest, slot } of ARMOUR) {
            const worn = bot.inventory.slots[slot];
            const best = ranked(items.filter(e => read(bot, e.item).kind === kind), item => armourKey(bot, item), () => false)[0];
            if (!best || (worn && compare(armourKey(bot, best.item), armourKey(bot, worn)) <= 0)) continue;
            if (blocked()) { s.pending = true; return false; }
            await bot.equip(best.item, dest);
        }
        const rank = item => (item ? OFFHAND_RANK.indexOf(item.name) : -1);
        const shield = items.filter(e => rank(e.item) >= 0).sort((a, b) => rank(b.item) - rank(a.item) || a.slot - b.slot)[0];
        if (shield && rank(shield.item) > rank(bot.inventory.slots[OFFHAND_SLOT])) {
            if (blocked()) { s.pending = true; return false; }
            await bot.equip(shield.item, 'off-hand');
        }
        return true;
    } catch (err) {
        console.error('[gear] equipping armour failed:', err?.message ?? err);
        return false;
    } finally {
        s.running = false;
        if (s.pending && !blocked()) void equipAll(bot);
    }
}

// The dropper holds the slots while it runs (an item pass or the runner's
// drop); the returned function releases them once, and the armour controller
// runs again if it waited.
export function holdSlots(bot) {
    const s = state(bot);
    s.holds++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        s.holds--;
        if (!s.holds && s.pending && s.installed) void equipAll(bot);
    };
}

const isArmourPiece = item => Boolean(item && (ARMOUR_SUFFIX[kindOf(item.name)] || OFFHAND_RANK.includes(item.name)));

// The Mineflayer plugin, loaded last in initBot (design §1: pathfinder, pvp,
// tool, collectblock, autoEat, gear): plugins inject in load order, so every
// member it replaces exists when it runs. A missing member is a startup error
// logged loudly; the rest is still installed.
export function install(bot) {
    const s = state(bot);
    s.installed = true;
    const missing = what => console.error(`[gear] STARTUP ERROR: ${what} is missing; that part of the gear slice is not installed`);
    // Each member is checked before it is replaced (gear rulings r1, 3: Sol 4):
    // a plugin update that drops or renames one is a loud error, and that
    // member stays as it was.
    const has = (owner, name, member) => {
        if (typeof owner?.[member] === 'function') return true;
        missing(`${name}.${member}`);
        return false;
    };
    if (has(bot.tool, 'bot.tool', 'equipForBlock')) bot.tool.equipForBlock = (block, options) => equipForBlock(bot, block, options);
    if (has(bot.tool, 'bot.tool', 'getDigTime')) bot.tool.getDigTime = (block, item) => digTicks(bot, block, item) * 50;   // upstream's unit: ms
    if (has(bot.pathfinder, 'bot.pathfinder', 'bestHarvestTool')) {
        const native = bot.pathfinder.bestHarvestTool;
        bot.pathfinder.bestHarvestTool = block => {
            try {
                return fastestTool(bot, block);
            } catch (err) {
                return native(block);
            }
        };
    }
    if (has(bot.pvp?.meleeAttackRate, 'bot.pvp.meleeAttackRate', 'getTicks'))
        bot.pvp.meleeAttackRate = { getTicks: b => interval(b, b.heldItem) - 1 };
    if (!bot.collectBlock) missing('bot.collectBlock');
    // The craft call site (skills.craftRecipe) keeps calling bot.armorManager.equipAll().
    bot.armorManager = { equipAll: () => equipAll(bot) };
    bot.on('playerCollect', (collector, collected) => {
        if (collector?.username !== bot.username) return;
        let item = null;
        try {
            item = collected?.getDroppedItem?.();
        } catch {
            return;
        }
        // A little delay to receive the inventory update (as upstream).
        if (isArmourPiece(item)) setTimeout(() => void equipAll(bot), 100);
    });
    bot.on('windowClose', () => { if (s.pending) void equipAll(bot); });
}
