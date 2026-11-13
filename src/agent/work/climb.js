import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../library/skills.js';

// Climbing out (SPEC §7.11, REQ-TRV-5; design travel/recommended-design.md r4
// §2): one helper for the walk keeper's stuck fallback (REQ-TRV-3) and the
// task's climb to drop (REQ-TRV-6). DECISIONS 2026-11-13 (evening): "climbing
// out as goToSurface does", "the cleanup climbs to the surface (or back up
// her shaft)". Each caller passes its own movements and time bound.

// Constants, not keys (SPEC §14).
export const CLIMB = {
    maxRise: 64,       // the highest roof or rim she climbs to, above her feet
    walkMs: 90000,     // the walk keeper's climb bound (seen: a 24-block climb took 28 s)
};

const AIR = new Set(['air', 'cave_air', 'void_air']);
export const LIQUIDS = ['water', 'lava', 'bubble_column'];
// The four cardinals, in the order used when nothing is preferred.
const CARDINALS = Object.freeze([[0, 1], [-1, 0], [0, -1], [1, 0]]);

// Where she can be: no collision box and not a liquid; an unloaded cell is not.
export const passable = block => Boolean(block) && block.boundingBox === 'empty' && !LIQUIDS.includes(block.name);

// The world's top block row (the login's dimension data; 319 in the overworld).
const worldTop = bot => (bot.game?.minY ?? -64) + (bot.game?.height ?? 384) - 1;

// What to climb to from her own column, or null (nothing to climb). Her column
// as goToSurface sees it: the highest non-air block above her head up to the
// world's top (liquids count as non-air; leaves do not: a tree over open
// ground is no roof, build r1 F5); with one within CLIMB.maxRise of her feet,
// `{pos: top + 1, rim: false}` (a roof: she digs up through it); one higher is
// nothing to climb (a deep cave: she would dig up into a pocket in the rock,
// build r2 F7).
// Open above: the rim of her own shaft, the lowest of the four cardinals'
// lowest y at or above her feet where the neighbour's feet and head cells are
// both passable; `{pos: rim, rim: true}` when it is above her feet and within
// maxRise. An unloaded cell stops the column scan with no target and counts as
// not passable for the rim (no target from unknown data).
export function climbTarget(bot) {
    const p = bot.entity.position.floored();
    const limit = worldTop(bot);
    let top = null;
    for (let y = p.y + 2; y <= limit; y++) {
        const block = bot.blockAt(new Vec3(p.x, y, p.z));
        if (!block) return null;
        if (!AIR.has(block.name) && !block.name.endsWith('_leaves')) top = y;
    }
    if (top != null) return top - p.y <= CLIMB.maxRise ? { pos: new Vec3(p.x, top + 1, p.z), rim: false } : null;
    let rim = Infinity;
    for (const [dx, dz] of CARDINALS) {
        for (let y = p.y; y - p.y <= CLIMB.maxRise; y++) {
            if (passable(bot.blockAt(new Vec3(p.x + dx, y, p.z + dz))) && passable(bot.blockAt(new Vec3(p.x + dx, y + 1, p.z + dz)))) {
                rim = Math.min(rim, y);
                break;
            }
        }
    }
    return rim > p.y && rim - p.y <= CLIMB.maxRise ? { pos: new Vec3(p.x, rim, p.z), rim: true } : null;
}

// Climbs to climbTarget: a roof to its cell (GoalBlock), a rim to within one
// of it (GoalNear 1: she may step off onto the rim), with the caller's
// movements (`configure`, through skills.goToGoal) and bounded by `ms` (the
// pathfinder is stopped then, as inventory.js walkTo). Its own goal is cleared
// at the end while still set. Never throws: {outcome: 'up' (her feet at or
// above the target's y − 1) | 'failed' | 'nothing' (no target), target}; an
// error is 'failed' unless she was interrupted (the caller checks that first).
// One skills.log line.
export async function climbOut(bot, { configure = null, ms = null } = {}) {
    const found = climbTarget(bot);
    if (!found) {
        skills.log(bot, 'Nothing to climb out of here.');
        return { outcome: 'nothing', target: null };
    }
    const { pos, rim } = found;
    const goal = rim ? new pf.goals.GoalNear(pos.x, pos.y, pos.z, 1) : new pf.goals.GoalBlock(pos.x, pos.y, pos.z);
    let bounded = false;
    let failed = false;
    const timer = ms ? setTimeout(() => { bounded = true; bot.pathfinder?.setGoal?.(null); }, ms) : null;
    try {
        await skills.goToGoal(bot, goal, configure);
    } catch {
        failed = !bot.interrupt_code;
    } finally {
        clearTimeout(timer);
        if (bot.pathfinder?.goal === goal) bot.pathfinder.setGoal(null);
    }
    const outcome = !failed && Math.floor(bot.entity.position.y) >= pos.y - 1 ? 'up' : 'failed';
    const where = `${rim ? 'the rim' : 'the surface'} at ${pos.x}, ${pos.y}, ${pos.z}`;
    skills.log(bot, outcome === 'up' ? `Climbed out to ${where}.` : `Could not climb out to ${where}${bounded ? ` within ${Math.round(ms / 1000)} s` : ''}.`);
    return { outcome, target: pos };
}
