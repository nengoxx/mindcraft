import * as mc from '../../utils/mcdata.js';
import * as world from '../library/world.js';
import { isNaturalBlockName } from './protect.js';

// The obtain resolver (SPEC §9): count-target nodes, prerequisites first,
// recomputed from the current inventory on every run (REQ-OBT-2/3). It reuses
// Mineflayer's recipe objects (bot.recipesAll, requiresTable, result.count) and
// mcdata's helpers instead of hand-written recipe rules (REQ-OBT-1).

const TOOL_TIERS = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
const TABLE_RANGE = 16;      // craftRecipe's own crafting-table search range
const VISIBLE_RANGE = 64;    // collectBlock's search range
const INVISIBLE_PENALTY = 1000;

// Items that collectBlock aliases to another block (skills.js collectBlock).
const COLLECT_ALIASES = ['cobblestone', 'dirt', 'coal', 'diamond', 'emerald', 'iron', 'gold', 'lapis_lazuli', 'redstone'];

function recipeKey(bot, recipe) {
    return Object.entries(mc.ingredientsFromPrismarineRecipe(recipe))
        .map(([name, count]) => `${name}*${count}`).sort().join('+');
}

function naturalSources(item) {
    return mc.getItemBlockSources(item).filter(isNaturalBlockName);
}

function snapshot(ctx) {
    return { inv: { ...ctx.inv }, left: { ...ctx.left }, nodes: ctx.nodes.length, chosen: { ...ctx.chosen } };
}

function restore(ctx, snap) {
    ctx.inv = snap.inv;
    ctx.left = snap.left;
    ctx.nodes.length = snap.nodes;
    ctx.chosen = snap.chosen;
}

// Work still to do in the graph: collected units count, and a source that is
// not in view costs much more (so the wood variant follows the nearby trees).
function cost(ctx, fromNode) {
    let total = 0;
    for (const node of ctx.nodes.slice(fromNode)) {
        if (node.method !== 'collect') continue;
        total += node.n + (ctx.visible(node.via) ? 0 : INVISIBLE_PENALTY);
    }
    return total;
}

function addNode(ctx, node) {
    ctx.nodes.push(node);
}

// Use leftovers first, then inventory, as mcdata's craftItem does.
function need(ctx, item, n) {
    const fromLeft = Math.min(ctx.left[item] || 0, n);
    ctx.left[item] = (ctx.left[item] || 0) - fromLeft;
    n -= fromLeft;
    const fromInv = Math.min(ctx.inv[item] || 0, n);
    ctx.inv[item] = (ctx.inv[item] || 0) - fromInv;
    n -= fromInv;
    if (n <= 0) return null;
    if (ctx.stack.includes(item)) return `no method for ${item}`;
    ctx.stack.push(item);
    try {
        const sources = naturalSources(item);
        const recipes = ctx.bot.recipesAll(ctx.bot.registry.itemsByName[item]?.id, null, true) || [];
        // A natural block that drops itself (logs, dirt, sand) is collected; other
        // items are crafted when they have a recipe, collected otherwise.
        const methods = sources.includes(item) || !recipes.length ? ['collect', 'craft'] : ['craft', 'collect'];
        let lastError = null;
        for (const method of methods) {
            const snap = snapshot(ctx);
            const error = method === 'craft' ? craft(ctx, item, n, recipes) : collect(ctx, item, n, sources);
            if (!error) return null;
            restore(ctx, snap);
            if (!lastError || error !== `no method for ${item}`) lastError = error;
        }
        return lastError;
    } finally {
        ctx.stack.pop();
    }
}

// A tool or table: needed once, not consumed.
function ensure(ctx, item) {
    if ((ctx.inv[item] || 0) + (ctx.left[item] || 0) > 0) return null;
    const error = need(ctx, item, 1);
    if (!error) ctx.left[item] = (ctx.left[item] || 0) + 1;
    return error;
}

// The tools that harvest a block, cheapest tier first; null when none is needed.
// Also the dig seam's tool choice (dig.js).
export function harvestToolNames(bot, blockName) {
    const tools = bot.registry.blocksByName[blockName]?.harvestTools;
    if (!tools) return null;
    const names = Object.keys(tools).map(id => bot.registry.items[id]?.name).filter(Boolean);
    const tier = name => { const i = TOOL_TIERS.findIndex(t => name.startsWith(t + '_')); return i < 0 ? TOOL_TIERS.length : i; };
    return names.sort((a, b) => tier(a) - tier(b));
}

function collect(ctx, item, n, sources) {
    if (!sources.length) return `no method for ${item}`;
    const via = sources.includes(item) ? item : (sources.find(s => ctx.visible(s)) ?? sources[0]);
    let tier_req = null;
    const tools = harvestToolNames(ctx.bot, via);
    if (tools && !tools.some(tool => (ctx.inv[tool] || 0) + (ctx.left[tool] || 0) > 0)) {
        let error = null;
        for (const tool of tools) {
            const snap = snapshot(ctx);
            error = ensure(ctx, tool);
            if (!error) { tier_req = tool; break; }
            restore(ctx, snap);
        }
        if (!tier_req) return error;
    } else if (tools) {
        tier_req = tools.find(tool => (ctx.inv[tool] || 0) + (ctx.left[tool] || 0) > 0);
    }
    addNode(ctx, { have: item, n, method: 'collect', via, tier_req });
    return null;
}

function craftWith(ctx, item, n, recipe) {
    // Runs and leftovers follow mcdata's craftItem (utils/mcdata.js:458-503):
    // runs = ceil(need / yield), the excess goes to leftovers (REQ-OBT-4).
    const runs = Math.ceil(n / recipe.result.count);
    if (recipe.requiresTable && !ctx.tableNearby) {
        const error = ensure(ctx, 'crafting_table');
        if (error) return error;
    }
    for (const [ingredient, count] of Object.entries(mc.ingredientsFromPrismarineRecipe(recipe))) {
        const error = need(ctx, ingredient, count * runs);
        if (error) return error;
    }
    ctx.left[item] = (ctx.left[item] || 0) + runs * recipe.result.count - n;
    addNode(ctx, { have: item, n, method: 'craft', via: recipeKey(ctx.bot, recipe), runs, table: recipe.requiresTable });
    return null;
}

const isOak = key => /(^|\+)oak_/.test(key);

// The first recipe the inventory (plus earlier nodes) allows wins; otherwise
// the cheapest by remaining collect work, ties by recipe order. A choice made
// for an item is kept for the rest of the step (persisted in step progress).
function craft(ctx, item, n, recipes) {
    if (!recipes.length) return `no method for ${item}`;
    const keyed = recipes.map(recipe => ({ recipe, key: recipeKey(ctx.bot, recipe) }));
    const fixed = ctx.chosen[item] ?? ctx.choices[item];
    const preferred = fixed && keyed.find(r => r.key === fixed);
    if (preferred) {
        const snap = snapshot(ctx);
        const error = craftWith(ctx, item, n, preferred.recipe);
        if (!error) return null;
        restore(ctx, snap);
    }
    let best = null;
    let lastError = null;
    for (const candidate of keyed) {
        const snap = snapshot(ctx);
        const error = craftWith(ctx, item, n, candidate.recipe);
        if (!error) {
            const c = cost(ctx, snap.nodes);
            // On a tie (no wood of any kind in view, or validation) oak wins over
            // the registry's recipe order, which starts with cherry.
            if (!best || c < best.cost || (c === best.cost && isOak(candidate.key) && !isOak(best.candidate.key))) best = { candidate, cost: c };
            if (c === 0) { restore(ctx, snap); break; }
        } else {
            lastError = error;
        }
        restore(ctx, snap);
    }
    if (!best) return lastError ?? `no method for ${item}`;
    if (keyed.length > 1) ctx.chosen[item] = best.candidate.key;
    return craftWith(ctx, item, n, best.candidate.recipe);
}

// Merge nodes of the same item and method, keeping the first position, so the
// list stays prerequisites-first.
function mergeNodes(nodes) {
    const out = [];
    const byKey = new Map();
    for (const node of nodes) {
        const key = `${node.method}:${node.have}:${node.via}`;
        const seen = byKey.get(key);
        if (seen) {
            seen.n += node.n;
            if (node.runs) seen.runs += node.runs;
        } else {
            const copy = { ...node };
            byKey.set(key, copy);
            out.push(copy);
        }
    }
    return out;
}

// Resolve `obtain{item, count}` against an inventory. Options: inventory
// (counts; default the bot's), choices (persisted recipe choices), static
// (validation: no world lookups, every source counts as visible, no table nearby).
export function resolveObtain(bot, item, count, { inventory = null, choices = {}, static: isStatic = false } = {}) {
    const memo = new Map();
    const visible = isStatic ? () => true : name => {
        if (!memo.has(name)) memo.set(name, Boolean(world.getNearestBlock(bot, name, VISIBLE_RANGE)));
        return memo.get(name);
    };
    const ctx = {
        bot,
        inv: { ...(inventory ?? world.getInventoryCounts(bot)) },
        left: {},
        nodes: [],
        stack: [],
        choices: choices || {},
        chosen: {},
        visible,
        tableNearby: !isStatic && Boolean(world.getNearestBlock(bot, 'crafting_table', TABLE_RANGE)),
    };
    const error = need(ctx, item, count);
    if (error) {
        const own = `no method for ${item}`;
        return { nodes: [], error: `${own} in this version${error === own ? '' : ` (${error})`}`, choices: {} };
    }
    return { nodes: mergeNodes(ctx.nodes), error: null, choices: ctx.chosen };
}

// Units of work still outstanding (the obtain step's stall metric).
export function remainingWork(nodes) {
    return nodes.reduce((sum, node) => sum + (node.method === 'craft' ? node.runs : node.n), 0);
}

// The block name collectBlock is called with for a collect node.
export function collectTarget(node) {
    return node.via === node.have || COLLECT_ALIASES.includes(node.have) ? node.have : node.via;
}
