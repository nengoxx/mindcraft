import * as skills from '../../library/skills.js';
import * as world from '../../library/world.js';

// give{player, item, count}: hand items to a player (SPEC §8.2, §6.3). One unit
// is one bounded attempt: a playerCollect listener is armed right before
// giveToPlayer and kept until the outstanding count is credited or
// GIVE_CONFIRM_S pass. Credit = min(the target player's pickups of the step's
// item, summed by stack count; the bot's inventory decrease of that item since
// the unit started), so neither a stack the player picks up elsewhere nor the
// bot's own re-pickup counts. Short of the count the step blocks with what
// happened, and is never tossed again by itself; !taskResume re-gives only the
// outstanding count from what is still in the inventory. A crash between toss
// and pickup blocks "not confirmed picked up" (inv_start is checkpointed).

export const GIVE_CONFIRM_S = 30;

function inventory(ctx, item) {
    return world.getInventoryCounts(ctx.bot)[item] || 0;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
    keys: {
        player: { type: 'token', required: true },
        item: { type: 'item', required: true },
        count: { type: 'count', required: true },
    },
    needsFreeSlots: true,

    measure(ctx, step) {
        const given = step.progress?.confirmed ?? 0;
        return { now: given, target: step.args.count, score: given };
    },

    met(ctx, step) {
        return (step.progress?.confirmed ?? 0) >= step.args.count;
    },

    neededItems(ctx, step) {
        return new Set([step.args.item]);
    },

    confirmMs: GIVE_CONFIRM_S * 1000,

    async unit(ctx, step) {
        const { bot } = ctx;
        const { player, item, count } = step.args;
        const p = step.progress;
        p.confirmed ??= 0;
        if (p.inv_start == null) {
            // Persisted before the first toss: a crash after it must not give again.
            p.inv_start = inventory(ctx, item) + p.confirmed;
            ctx.checkpoint();
        }
        const unconfirmed = p.inv_start - p.confirmed - inventory(ctx, item);
        if (unconfirmed > 0) return { blocked: `dropped ${unconfirmed} ${item} near ${player}, not confirmed picked up` };
        const remaining = count - p.confirmed;
        if (remaining <= 0) return { done: true };
        const start = inventory(ctx, item);
        if (start < remaining) return { blocked: `have ${start} ${item}, ${remaining} still to give to ${player}` };
        if (!bot.players[player]?.entity) return { failed: `${player} is not in view` };

        let picked = 0;   // the target's pickups of the item
        let own = 0;      // the bot's own re-pickups of it
        const onCollect = (collector, entity) => {
            const stack = entity?.getDroppedItem?.();
            if (stack?.name !== item) return;
            if (collector?.username === player) picked += stack.count;
            else if (collector === bot.entity || collector?.username === bot.username) own += stack.count;
        };
        const credit = () => Math.min(picked, Math.max(0, start - inventory(ctx, item)));
        let error = null;
        let ok;
        bot.on('playerCollect', onCollect);
        try {
            try {
                ok = await ctx.call(`give ${item}`, () => skills.giveToPlayer(bot, item, player, remaining));
            } catch (err) {
                error = err;
            }
            const deadline = Date.now() + this.confirmMs;
            // Also after an error or a false once items have left the
            // inventory: their pickup must still count. A false with nothing
            // tossed (he could not be reached) fails at once, as an error does
            // (design travel r4 §0c N2: a 30 s wait standing still let unstuck
            // cut the task, and the attempt was never counted).
            const waiting = () => (!error && ok !== false) || inventory(ctx, item) < start;
            // I1-10 (DECISIONS 2026-11-14): the wait is stationary by design, so
            // unstuck (20 s) is paused for it, as for obtain's craft.
            bot.modes.pause('unstuck');
            try {
                while (waiting() && credit() < remaining && Date.now() < deadline && !bot.interrupt_code) await sleep(100);
            } finally {
                bot.modes.unpause('unstuck');
            }
        } finally {
            bot.removeListener('playerCollect', onCollect);
        }
        const got = credit();
        p.confirmed += got;
        const tossed = start - inventory(ctx, item) + own;
        if (p.confirmed >= count) return { done: true };
        if (tossed > got) {
            const lost = tossed - got;
            return { blocked: p.confirmed > 0
                ? `${player} picked up ${p.confirmed} of ${count} ${item}; ${lost} dropped near ${player}, not picked up`
                : `dropped ${lost} ${item} near ${player}, not picked up` };
        }
        if (error) throw error;
        return { failed: `could not give ${item} to ${player}` };
    },
};
