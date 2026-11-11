import obtain from './steps/obtain.js';
import go_to from './steps/go_to.js';
import give from './steps/give.js';
import clear, { parseBox } from './steps/clear.js';

// The step DSL of the I1 text commands (SPEC §12.0, REQ-TRN-14/15) and plan
// validation (§8.3). Errors are collected, never thrown, and come back together
// (REQ-PLAN-5).

export const DSL_MAX_CHARS = 1000; // a constant, SPEC §14

// The step registry (REQ-PLAN-3): a new skill is a new entry, the record keeps
// only `skill` + `args`. `build` is known to the grammar so its keys parse, but
// it has no handler until the shelter slice (S3) registers one.
export const STEPS = { obtain, go_to, give, clear };
const BUILD_KEYS = {
    what: { type: 'words', required: true },
    source: { type: 'source' },
    name: { type: 'token' },
    detail: { type: 'detail' },
    at: { type: 'position' },
    size: { type: 'number' },
    material: { type: 'item' },
};
const GRAMMAR = {
    obtain: obtain.keys,
    go_to: go_to.keys,
    give: give.keys,
    clear: clear.keys,
    build: BUILD_KEYS,
};
const SKILL_NAMES = Object.keys(GRAMMAR);
const LATER_SOURCES = { owner: 'I3', mine: 'I3', new: 'I3' };
const TOKEN = /^[A-Za-z0-9_\-.,:]+$/;
const INTEGER = /^-?\d+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
// Own properties only: 'constructor' or '__proto__' must not pass a lookup.
const has = (map, key) => Object.hasOwn(map, key);

// Split into steps and space-separated parts. `;` and spaces inside a
// single-quoted text do not split. Empty steps (a trailing `;`) are skipped.
function scan(text) {
    const steps = [];
    let current = { parts: [], unclosed: false };
    let part = '';
    let quoted = false;
    const flushPart = () => { if (part) current.parts.push(part); part = ''; };
    const flushStep = () => { flushPart(); if (current.parts.length) steps.push(current); current = { parts: [], unclosed: false }; };
    for (const ch of text) {
        if (quoted) {
            part += ch;
            if (ch === "'") quoted = false;
        } else if (ch === "'") {
            quoted = true;
            part += ch;
        } else if (ch === ';') {
            flushStep();
        } else if (/\s/.test(ch)) {
            flushPart();
        } else {
            part += ch;
        }
    }
    if (quoted) current.unclosed = true;
    flushStep();
    return steps;
}

// Parse the DSL into {skill, raw: {key: string}} steps. Grammar errors only;
// types and the registry are checked by validateSteps.
export function parseSteps(text, { maxSteps = 8 } = {}) {
    const errors = [];
    text = String(text ?? '');
    if (text.length > DSL_MAX_CHARS) errors.push(`steps text longer than ${DSL_MAX_CHARS} characters`);
    const scanned = scan(text);
    if (scanned.length === 0) {
        errors.push('no steps given');
        return { steps: [], errors };
    }
    if (scanned.length > maxSteps) errors.push(`more than ${maxSteps} steps`);
    const steps = [];
    scanned.forEach(({ parts, unclosed }, index) => {
        const n = index + 1;
        const [skill, ...args] = parts;
        const step = { n, skill, raw: {}, ok: false };
        steps.push(step);
        if (unclosed) {
            errors.push(`step ${n}: unclosed quote`);
            return;
        }
        if (!has(GRAMMAR, skill)) {
            errors.push(`step ${n}: unknown skill '${skill}' (use ${SKILL_NAMES.join(', ')})`);
            return;
        }
        const keys = GRAMMAR[skill];
        const before = errors.length;
        for (const arg of args) {
            const match = arg.match(/^([A-Za-z_]+)=(.*)$/s);
            if (!match) {
                errors.push(`step ${n}: bad argument '${arg}' (use key=value)`);
                continue;
            }
            const [, key, rawValue] = match;
            if (!has(keys, key)) {
                errors.push(`step ${n}: unknown key '${key}' for ${skill}`);
                continue;
            }
            if (has(step.raw, key)) {
                errors.push(`step ${n}: key '${key}' given twice`);
                continue;
            }
            let value = rawValue;
            if (value.startsWith("'")) {
                if (value.length < 2 || !value.endsWith("'")) {
                    errors.push(`step ${n}: bad value '${value}' for ${key}`);
                    continue;
                }
                value = value.slice(1, -1);
            } else if (!TOKEN.test(value)) {
                errors.push(`step ${n}: bad value '${value}' for ${key}`);
                continue;
            }
            step.raw[key] = value;
        }
        for (const [key, spec] of Object.entries(keys)) {
            if (spec.required && !(key in step.raw)) errors.push(`step ${n}: missing key '${key}'`);
        }
        step.ok = errors.length === before;
    });
    return { steps, errors };
}

function knownName(bot, name) {
    return has(bot.registry.itemsByName, name) || has(bot.registry.blocksByName, name);
}

// Resolve a position to {x, y, z, dim, given} and freeze it (REQ-PLAN-8).
// `here` is the owner's position when the owner's entity is tracked, else the
// bot's own; `owner` needs the owner tracked.
export function resolvePosition(ctx, value) {
    const { bot, owner } = ctx;
    const dim = bot.game?.dimension ?? 'overworld';
    const freeze = (pos, given) => ({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dim, given });
    const ownerPos = owner ? bot.players?.[owner]?.entity?.position : null;
    if (value === 'here') return freeze(ownerPos ?? bot.entity.position, 'here');
    if (value === 'owner') return ownerPos ? freeze(ownerPos, 'owner') : null;
    const parts = value.split(',');
    if (parts.length === 3 && parts.every(p => NUMBER.test(p))) {
        const [x, y, z] = parts.map(Number);
        return freeze({ x, y, z }, value);
    }
    return null;
}

function convert(ctx, n, key, spec, value, errors) {
    switch (spec.type) {
        case 'item':
            if (!knownName(ctx.bot, value)) { errors.push(`step ${n}: unknown item or block '${value}'`); return undefined; }
            return value;
        case 'block':
            if (!has(ctx.bot.registry.blocksByName, value)) { errors.push(`step ${n}: unknown item or block '${value}'`); return undefined; }
            return value;
        case 'box': {
            const box = parseBox(value);
            if (!box) errors.push(`step ${n}: bad box '${value}' (use x1,y1,z1:x2,y2,z2)`);
            return box ?? undefined;
        }
        case 'shell':
            if (value !== 'keep' && value !== 'clear') { errors.push(`step ${n}: unknown shell '${value}' (use keep or clear)`); return undefined; }
            return value;
        case 'count': {
            if (!INTEGER.test(value)) { errors.push(`step ${n}: '${value}' is not a number`); return undefined; }
            const count = Number(value);
            const max = ctx.config.max_obtain_count;
            if (count < 1 || count > max) { errors.push(`step ${n}: count ${count} is outside 1–${max}`); return undefined; }
            return count;
        }
        case 'number':
            if (!NUMBER.test(value)) { errors.push(`step ${n}: '${value}' is not a number`); return undefined; }
            return Number(value);
        case 'position': {
            if (value !== 'here' && value !== 'owner' && !/^[^,]+,[^,]+,[^,]+$/.test(value)) {
                errors.push(`step ${n}: bad position '${value}' (use here, owner or x,y,z)`);
                return undefined;
            }
            const pos = resolvePosition(ctx, value);
            if (!pos) {
                errors.push(value === 'owner'
                    ? `step ${n}: the owner is not in view, so 'owner' has no position (use here or x,y,z)`
                    : `step ${n}: bad position '${value}' (use here, owner or x,y,z)`);
                return undefined;
            }
            return pos;
        }
        case 'source':
            if (has(LATER_SOURCES, value)) { errors.push(`step ${n}: source '${value}' arrives with ${LATER_SOURCES[value]}; use auto or catalog`); return undefined; }
            if (value !== 'auto' && value !== 'catalog') { errors.push(`step ${n}: unknown source '${value}' (use auto or catalog)`); return undefined; }
            return value;
        case 'detail':
            if (value !== 'minimal' && value !== 'basic') { errors.push(`step ${n}: unknown detail '${value}' (use minimal or basic)`); return undefined; }
            return value;
        default: // token, words
            return value;
    }
}

// Typed arguments, frozen positions and each step's own checks (REQ-PLAN-4).
// ctx: {bot, owner, config, anchor}; `anchor` is the task's frozen anchor
// (REQ-PLAN-8), which the clear step's marker search and distance cap use.
export function validateSteps(ctx, parsed) {
    const errors = [];
    const steps = [];
    for (const step of parsed) {
        if (!step.ok) continue;
        const keys = GRAMMAR[step.skill];
        const args = {};
        const before = errors.length;
        for (const [key, value] of Object.entries(step.raw)) {
            args[key] = convert(ctx, step.n, key, keys[key], value, errors);
        }
        if (errors.length !== before) continue;
        const handler = has(STEPS, step.skill) ? STEPS[step.skill] : null;
        if (!handler) {
            errors.push(`step ${step.n}: ${step.skill} is not available yet (it arrives with the shelter slice)`);
            continue;
        }
        const stepErrors = handler.validate ? handler.validate(ctx, args) : [];
        for (const err of stepErrors) errors.push(`step ${step.n}: ${err}`);
        if (!stepErrors.length) steps.push({ skill: step.skill, args });
    }
    return { steps, errors };
}

// Parse and validate one DSL string. `offset` renumbers steps for !taskRevise.
export function planFromText(ctx, text, { offset = 0, maxSteps = ctx.config.max_steps } = {}) {
    const parsed = parseSteps(text, { maxSteps });
    const validated = validateSteps(ctx, parsed.steps);
    // Plan-wide errors first, then by step (the sort is stable within a step).
    const stepOf = err => Number(err.match(/^step (\d+):/)?.[1] ?? 0);
    let errors = [...parsed.errors, ...validated.errors].sort((a, b) => stepOf(a) - stepOf(b));
    if (offset) errors = errors.map(err => err.replace(/^step (\d+):/, (_, n) => `step ${Number(n) + offset}:`));
    return { steps: errors.length ? [] : validated.steps, errors };
}
