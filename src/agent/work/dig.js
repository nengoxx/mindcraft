import pf from 'mineflayer-pathfinder';
import * as skills from '../library/skills.js';
import { isProtectedForBot, knowFallingBlocks } from './protect.js';
import { ledgerFor } from './ledger.js';
import { harvestToolNames } from './resolve.js';

// The dig seam (REQ-CLR-6), shared by the clear step, the tidy sweep and S3's
// builder. digCell runs, in order: approach → occupancy check → the patched
// safeToBreak with the hazard flags forced → tool → the same checks again →
// dig, and returns a reason, never just a boolean. Neither breakBlockAt nor the skills' dig-down helper is
// used: they refuse without a harvest tool (skills.js:651-655).

export const REACH = 4.5;   // from the eyes (SPEC §14 constants)
const EYE_HEIGHT = 1.62;
const APPROACH = 3;         // GoalNear range; the reach check after it decides
const HALF_WIDTH = 0.3;     // a player's hitbox half width
const ON_TOP = 0.5;         // feet this close above a cell's top stand on it
const EMPTY = ['air', 'cave_air', 'void_air'];
const LIQUIDS = ['water', 'lava', 'bubble_column'];
const BESIDE = [[0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]]; // safeToBreak's dontCreateFlow cells

// Air or a liquid: nothing to dig (REQ-CLR-7).
export function isCleared(block) {
    return Boolean(block) && (EMPTY.includes(block.name) || LIQUIDS.includes(block.name));
}

export function eyeDistance(bot, pos) {
    const p = bot.entity.position;
    return Math.hypot(p.x - (pos.x + 0.5), p.y + EYE_HEIGHT - (pos.y + 0.5), p.z - (pos.z + 0.5));
}

// Who is in the cell or standing on it: 'me' for the bot, a username for a
// player, else null. The pathfinder's own entity check is empty outside a path
// search (SPEC §4.2), so a dig needs this one.
export function occupant(bot, pos) {
    const entities = [bot.entity, ...Object.values(bot.players ?? {}).map(p => p.entity)];
    for (const e of new Set(entities)) {
        if (!e?.position) continue;
        const p = e.position;
        if (p.x + HALF_WIDTH <= pos.x || p.x - HALF_WIDTH >= pos.x + 1 || p.z + HALF_WIDTH <= pos.z || p.z - HALF_WIDTH >= pos.z + 1) continue;
        const inside = p.y < pos.y + 1 && p.y + (e.height ?? 1.8) > pos.y;
        const onTop = p.y >= pos.y + 1 && p.y < pos.y + 1 + ON_TOP;
        if (inside || onTop) return e === bot.entity ? 'me' : e.username ?? 'a player';
    }
    return null;
}

// One Movements instance per bot that only checks (nothing navigates with it),
// with safeToBreak's hazard flags forced on.
const checkers = new WeakMap();
function checker(bot) {
    let m = checkers.get(bot);
    if (!m) {
        m = new pf.Movements(bot);
        knowFallingBlocks(m);
        checkers.set(bot, m);
    }
    m.dontCreateFlow = true;
    m.dontMineUnderFallingBlock = true;
    return m;
}

// The safety check, with its reason. `container` lifts blocksCantBreak for this
// one block only (a granted container, REQ-CLR-9); the liquid, falling-block and
// every other check stay. The patched safeToBreak (protect.js) has the last word.
export function safetyReason(bot, block, { container = false } = {}) {
    const m = checker(bot);
    const pos = block.position;
    const liquid = BESIDE.map(([dx, dy, dz]) => m.getBlock(pos, dx, dy, dz)).find(b => b.liquid);
    if (liquid) return `next to ${liquid.name === 'lava' ? 'lava' : 'water'}`;
    if (m.getBlock(pos, 0, 1, 0).canFall) return 'under a falling block';
    if (isProtectedForBot(bot, block)) return 'protected';
    const lifted = container && m.blocksCantBreak.delete(block.type);
    try {
        if (!m.safeToBreak(block)) return 'cannot be broken';
    } finally {
        if (lifted) m.blocksCantBreak.add(block.type);
    }
    return null;
}

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// Every check a dig needs, on the cell as it is now: {block} or a refusal.
// Run again after each await, since the world, the task and the bot's place
// can change meanwhile (Mineflayer's dig checks none of them).
function ready(bot, pos, name, { container, dim }) {
    if (bot.interrupt_code) return refuse('interrupted', { soft: true });
    if (dim && (bot.game?.dimension ?? 'overworld') !== dim) return refuse('in another dimension', { soft: true });
    if (eyeDistance(bot, pos) > REACH) return refuse('out of reach');
    const block = bot.blockAt(pos);
    if (!block || block.name !== name) return refuse('changed', { soft: true });
    const by = occupant(bot, pos);
    if (by) return refuse('occupied', { soft: true, by });
    const unsafe = safetyReason(bot, block, { container });
    if (unsafe) return refuse(unsafe);
    return { block };
}

// Options: `move` approaches the block when it is out of reach (through
// goToGoal with `configure`, so the caller's movement settings survive);
// `obtain` reports the tools that would harvest it, cheapest first, when none
// held does (the caller obtains one); `hand` digs by hand then instead
// (removal is the goal);
// `container` is the granted-container exception; `dim` the dimension the
// caller's cell is in. A `soft` refusal (occupied, interrupted, changed
// meanwhile, another dimension) says nothing about the cell itself.
export async function digCell(bot, block, { move = true, obtain = false, hand = false, configure = null, container = false, dim = null } = {}) {
    const pos = block.position;
    const name = block.name;
    if (eyeDistance(bot, pos) > REACH) {
        if (!move) return refuse('out of reach');
        try {
            await skills.goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, APPROACH), configure);
        } catch (err) {
            if (bot.interrupt_code) return refuse('interrupted', { soft: true });
        }
    }
    let check = ready(bot, pos, name, { container, dim });
    if (!check.block) return check;
    if (bot.game?.gameMode !== 'creative') {
        await bot.tool.equipForBlock(check.block);
        check = ready(bot, pos, name, { container, dim });
        if (!check.block) return check;
        if (!check.block.canHarvest(bot.heldItem?.type ?? null) && !hand)
            return refuse('needs a tool', { tools: obtain ? harvestToolNames(bot, name) ?? [] : [] });
    }
    block = check.block;
    // REQ-OWN-5: a ledger entry is marked `removing` for the dig.
    const ledger = ledgerFor(bot);
    ledger?.beginRemove(pos);
    try {
        await bot.dig(block, true);
    } catch (err) {
        ledger?.endRemove(pos, false);
        if (bot.interrupt_code) return refuse('interrupted', { soft: true });
        return refuse(`dig failed (${err?.message ?? err})`);
    }
    ledger?.endRemove(pos, true);
    return { ok: true, reason: null };
}
