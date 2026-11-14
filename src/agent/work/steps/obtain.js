import * as skills from '../../library/skills.js';
import * as world from '../../library/world.js';
import { resolveObtain, remainingWork, collectTarget } from '../resolve.js';
import { ledgerFor } from '../ledger.js';

// obtain{item, count}: have at least `count` of `item` (SPEC §8.2, §9).
// Each unit is one bounded actuator call (REQ-RES-7); the graph is recomputed
// from the inventory before every unit (REQ-OBT-3).
const COLLECT_CHUNK = 8;
// Recipe runs per craft unit: Mineflayer's craft loop ignores interrupt_code,
// so a unit stays short and the runner re-observes between units.
const CRAFT_RUNS = 4;

// I1-11 (DECISIONS 2026-11-14, SPEC REQ-OBT-2/4): the resolver's automatic
// recipe choices are never persisted, so every unit takes the first recipe her
// bag allows; progress.choices holds only explicit material choices.
function graph(ctx, step) {
    return resolveObtain(ctx.bot, step.args.item, step.args.count, { choices: step.progress?.choices });
}

export default {
    keys: {
        item: { type: 'item', required: true },
        count: { type: 'count', required: true },
    },
    needsFreeSlots: true,

    // Against the current inventory with no world lookups: a production method
    // is required only for a real shortfall.
    validate(ctx, args) {
        const plan = resolveObtain(ctx.bot, args.item, args.count, { static: true });
        return plan.error ? [plan.error] : [];
    },

    // now: the item count (shown); score: higher is better (the stall rule).
    // Score is minus the outstanding work, so gathering an ingredient counts as
    // progress even before the item itself appears.
    measure(ctx, step) {
        const now = world.getInventoryCounts(ctx.bot)[step.args.item] || 0;
        if (now >= step.args.count) return { now, target: step.args.count, score: 0 };
        const plan = resolveObtain(ctx.bot, step.args.item, step.args.count, { choices: step.progress?.choices });
        return { now, target: step.args.count, score: plan.error ? -Number.MAX_SAFE_INTEGER : -remainingWork(plan.nodes) }; // finite: the record is JSON
    },

    // The target is in the bag (the unit's own first check).
    met(ctx, step) {
        return (world.getInventoryCounts(ctx.bot)[step.args.item] || 0) >= step.args.count;
    },

    // Items this step must keep (the junk drop never tosses them).
    neededItems(ctx, step) {
        const items = new Set([step.args.item]);
        const plan = resolveObtain(ctx.bot, step.args.item, step.args.count, { choices: step.progress?.choices });
        for (const node of plan.nodes) {
            items.add(node.have);
            if (node.tier_req) items.add(node.tier_req);
            if (node.method === 'craft') for (const part of node.via.split('+')) items.add(part.split('*')[0]);
        }
        return items;
    },

    async unit(ctx, step) {
        const { bot } = ctx;
        const have = world.getInventoryCounts(bot)[step.args.item] || 0;
        if (have >= step.args.count) return { done: true };
        const plan = graph(ctx, step);
        if (plan.error) return { blocked: plan.error };
        const node = plan.nodes[0];
        if (!node) return { done: true };
        if (node.method === 'craft') {
            // REQ-RES-11: crafting is stationary, so unstuck is paused for the call.
            bot.modes.pause('unstuck');
            try {
                const ok = await ctx.call(`craft ${node.have}`, () => skills.craftRecipe(bot, node.have, Math.min(node.runs, CRAFT_RUNS)));
                return ok ? {} : { failed: `could not craft ${node.have}` };
            } finally {
                bot.modes.unpause('unstuck');
            }
        }
        const target = collectTarget(node);
        const chunk = Math.min(node.n, COLLECT_CHUNK);
        const before = bot.output.length;
        const held = world.getInventoryCounts(bot)[node.have] || 0;
        const ledger = ledgerFor(bot);
        const since = ledger?.now() ?? 0;
        const ok = await ctx.call(`collect ${target}`, () => skills.collectBlock(bot, target, chunk));
        // I1-6 (DECISIONS 2026-11-14): the target items she placed during the
        // call (dirt and cobblestone are the pathfinder's scaffold) count as gained.
        const gained = (world.getInventoryCounts(bot)[node.have] || 0) + (ledger?.placedSince(node.have, since) ?? 0) > held;
        // Digging that brings in none of the wanted item fails at once (a silk-touch tool once dug 195 stone for cobblestone).
        if (gained) return {};
        if (ok) return { failed: `collected ${target} but got no ${node.have}` };
        const output = bot.output.slice(before);
        // Also the blocks of the type that she may not mine (rulings r1 S7): not reachable either.
        if (/No (more )?\S+ nearby to collect|^The \S+ nearby are ones I may not mine/m.test(output))
            return { blocked: `none reachable: no ${node.via} within 64 blocks that is safe to break` };
        // REQ-SAFE-12 (DECISIONS 2026-11-13): the collect summary (skills.js collectBlocksOf).
        // Nothing dug and nothing failed: only protected or kept blocks of the
        // type stand near, so the step blocks with their count; otherwise the
        // real failure reason wins.
        const lines = output.trim().split('\n');
        const summary = lines.find(l => /^Collected \d+ of /.test(l)) ?? '';
        const dug = Number(summary.match(/^Collected (\d+) of /)?.[1] ?? 0);
        const failures = summary.match(/ (\d+) could not be dug: (.*?)\. Inventory net change:/);
        const standing = [[/ (\d+) \S+ within (\d+) are protected /, 'protected'], [/ (\d+) \S+ within (\d+) are kept /, 'kept']]
            .map(([re, label]) => [summary.match(re), label]).filter(([m]) => m);
        if (dug === 0 && !failures && standing.length)
            return { blocked: `none reachable: no ${node.via} within 64 blocks that is safe to break (${standing.map(([m, label]) => `${m[1]} ${label}`).join(', ')} within ${standing[0][0][2]})` };
        const why = failures?.[2] ?? lines.filter(l => l && !/^Collected \d+ of /.test(l)).pop(); // the cause, not the summary
        return { failed: `could not collect ${node.via}${why ? ` (${why.slice(0, 160)})` : ''}` };
    },
};
