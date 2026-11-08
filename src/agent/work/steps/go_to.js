import * as skills from '../../library/skills.js';

// go_to{target}: arrive within 2 blocks of a position frozen at validation
// (SPEC §8.2, REQ-PLAN-8). Place names arrive with I4.
const ARRIVE = 2;
// goToPosition counts a GoalNear(2) arrival as success up to one block further.
const ARRIVED_WITHIN = ARRIVE + 1;

function distance(bot, target) {
    const p = bot.entity.position;
    return Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z);
}

export default {
    keys: {
        target: { type: 'position', required: true },
    },
    needsFreeSlots: false,

    // score: minus the distance in whole blocks, so jitter is not progress.
    measure(ctx, step) {
        const d = distance(ctx.bot, step.args.target);
        return { now: Math.round(d), target: 0, score: -Math.floor(d) };
    },

    neededItems() {
        return new Set();
    },

    async unit(ctx, step) {
        const { bot } = ctx;
        const { x, y, z } = step.args.target;
        if (distance(bot, step.args.target) <= ARRIVED_WITHIN) return { done: true };
        await ctx.call('go_to', () => skills.goToPosition(bot, x, y, z, ARRIVE));
        if (distance(bot, step.args.target) <= ARRIVED_WITHIN) return { done: true };
        return { failed: `could not reach ${x}, ${y}, ${z}; ${Math.round(distance(bot, step.args.target))} blocks away` };
    },
};
