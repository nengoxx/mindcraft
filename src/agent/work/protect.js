import { readFileSync } from 'fs';
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';

// Protection (SPEC §13): one predicate for paths, collection and (from S3)
// building, applied through Movements.prototype.safeToBreak (REQ-SAFE-3).

const natural = JSON.parse(readFileSync(new URL('./data/natural_blocks.json', import.meta.url), 'utf8'));
const NATURAL_NAMES = new Set(natural.names);
const NATURAL_SUFFIXES = natural.suffixes;
const TREE_MAX_LOGS = 40;        // REQ-SAFE-4: the upward search bound
const TREE_COMPONENT_MAX = 64;   // REQ-SAFE-4: the component cap (dark oaks reach about 50)

export function isLogName(name) {
    return name.endsWith('_log') && !name.startsWith('stripped_');
}

function isLeavesName(name) {
    return name.endsWith('_leaves');
}

// By name only: logs and leaves count here; the block-level tests below decide.
export function isNaturalBlockName(name) {
    return NATURAL_NAMES.has(name) || NATURAL_SUFFIXES.some(suffix => name.endsWith(suffix))
        || isLogName(name) || isLeavesName(name);
}

export function posKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function naturalLeaves(block) {
    return block && isLeavesName(block.name) && block.getProperties?.().persistent === false;
}

const OPEN = ['air', 'cave_air', 'void_air', 'water'];
// Blocks world generation puts against a natural trunk besides terrain and
// leaves, including the farmed plants left off the natural list (REQ-SAFE-1):
// accepted beside a tree, never collectable themselves.
const BESIDE_TRUNKS = ['cocoa', 'bee_nest', 'beehive', 'creaking_heart',
    'sugar_cane', 'bamboo', 'bamboo_sapling', 'cactus', 'cactus_flower', 'sweet_berry_bush', 'kelp', 'kelp_plant', 'melon', 'pumpkin'];
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// One step up a trunk: straight first, then the eight diagonals (bent acacia
// trunks, branches).
const UP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// The protection predicate for one bot. `ledger` is the placements ledger
// (ledger.js: get, retire and the !buildStructure run in progress); `scope()`
// returns the active clear step's box scope or null (REQ-CLR-5; steps/clear.js).
export class Protector {
    constructor(bot, { ledger = null, scope = () => null } = {}) {
        this.bot = bot;
        this.ledger = ledger;
        this.scope = scope;
        this.treeMemo = null;
        this.componentMemo = null;
        this.running = false;
    }

    // The tree test is memoized per position inside a run only (REQ-SAFE-3),
    // because the pathfinder asks about the same blocks many times; outside a
    // run every answer is computed fresh.
    newRun() {
        this.treeMemo = new Map();
        this.componentMemo = new Map();
        this.running = true;
    }

    endRun() {
        this.treeMemo = null;
        this.componentMemo = null;
        this.running = false;
    }

    isProtected(block) {
        if (!block?.name || !block.position) return false;
        const name = block.name;
        // REQ-CLR-5: while a clear step is current, its kept outer layer is
        // protected for every caller; inside its box the spawner never goes,
        // a container only on the owner's explicit grant, and a granted
        // position is exempt while its block still matches (REQ-CLR-9).
        const scope = this.scope();
        if (scope?.inShell(block.position)) return true;
        const inBox = Boolean(scope?.inBox(block.position));
        // REQ-SAFE-2, REQ-OWN-2: the bot's own placement, by kind, while the
        // recorded block is still the one there; a different block retires it.
        const entry = this.ledger?.get(block.position);
        const recorded = entry?.block === name ? entry : null;
        if (entry && !recorded) this.ledger.retire(block.position, `now ${name}`);
        if (inBox) {
            if (scope.neverRemove.has(name)) return true;
            // A completed build's block stays before any grant or container
            // rule: a box exempts only scaffold and own entries.
            if (recorded?.kind === 'building' && !this.exempt(recorded, true)) return true;
            if (scope.granted(block.position, name)) return false;
            if (scope.containers.has(name)) return true;
        }
        if (recorded) return !this.exempt(recorded, inBox);
        if (isLeavesName(name)) return !naturalLeaves(block);
        if (isLogName(name)) return !this.isNaturalTree(block);
        // A task-layer harvesting policy, not owner property: inside a task run
        // I1 collects only ores with an open face (air or water); buried ores
        // are tunnelled to only from I5. Outside runs ores are natural, and a
        // clear step digs buried ores inside its box (REQ-SAFE-1, REQ-CLR-5).
        if (name.endsWith('_ore')) return this.running && !inBox ? !this.isExposed(block) : false;
        return !isNaturalBlockName(name);
    }

    // REQ-OWN-2, the kinds stated once: `station` and live `scaffold` are exempt
    // everywhere; `own` (code, commands, task-time placements, owner-kept
    // scaffold) is protected outside an active clear box whatever its
    // material, exempt inside one; `building` is exempt only while its build
    // runs (a !buildStructure build ends when that action returns).
    exempt(entry, inBox) {
        switch (entry.kind) {
            case 'station':
            case 'scaffold': return true;
            case 'own': return inBox;
            case 'building': return entry.build_id != null && entry.build_id === this.ledger.building;
            default: return false;
        }
    }

    isExposed(block) {
        return FACES.some(([dx, dy, dz]) => OPEN.includes(this.bot.blockAt(block.position.offset(dx, dy, dz))?.name));
    }

    // REQ-SAFE-4: a log is a natural tree when (1) a path of same-type logs
    // going up (one block up per step, straight or diagonal, at most
    // TREE_MAX_LOGS logs) reaches a log with non-persistent leaves directly
    // above it: a trunk ends under its canopy; and (2) its component, the
    // 26-connected same-type logs containing it, is a bare tree: at most
    // TREE_COMPONENT_MAX logs, none touching a block world generation would not
    // put there (besideTree; a log of another type counts as foreign). An all-log cabin has no such path, even where a tree's
    // leaves touch its side; a log build under a canopy touches its planks,
    // door, glass or torches. There is no ground condition: a felled trunk
    // stays a tree.
    isNaturalTree(block) {
        const memo = this.treeMemo ?? new Map();
        const budget = { left: TREE_MAX_LOGS, exhausted: false };
        const start = block.position.floored ? block.position.floored() : new Vec3(block.position.x, block.position.y, block.position.z);
        return this.reachesCanopy(start, block.name, memo, budget) && this.isBareTree(start, block.name);
    }

    isBareTree(start, name) {
        const memo = this.componentMemo;
        const startKey = posKey(start);
        if (memo?.has(startKey)) return memo.get(startKey);
        const logs = new Map([[startKey, start]]);
        let bare = true;
        for (let i = 0, queue = [start]; i < queue.length && bare; i++) {
            for (const next of around(queue[i])) {
                const key = posKey(next);
                if (logs.has(key)) continue;
                const neighbour = this.bot.blockAt(next);
                if (!neighbour) continue;
                if (neighbour.name === name) {
                    if (logs.size >= TREE_COMPONENT_MAX) { bare = false; break; }   // over the cap
                    logs.set(key, next);
                    queue.push(next);
                } else if (!this.besideTree(neighbour)) { bare = false; break; }
            }
        }
        // Every log found belongs to the one component, so the verdict is theirs.
        if (memo) for (const key of logs.keys()) memo.set(key, bare);
        return bare;
    }

    besideTree(block) {
        const name = block.name;
        if (this.ledger?.get(block.position)?.block === name) return true;
        if (isLogName(name)) return false; // another wood type: a mixed-wood build
        return OPEN.includes(name) || isLeavesName(name) || BESIDE_TRUNKS.includes(name) || isNaturalBlockName(name);
    }

    reachesCanopy(pos, name, memo, budget) {
        const key = posKey(pos);
        if (memo.has(key)) return memo.get(key);
        if (budget.left-- <= 0) { budget.exhausted = true; return false; }
        let found = naturalLeaves(this.bot.blockAt(pos.offset(0, 1, 0)));
        for (const [dx, dz] of UP) {
            if (found) break;
            const next = pos.offset(dx, 1, dz);
            if (this.bot.blockAt(next)?.name === name) found = this.reachesCanopy(next, name, memo, budget);
        }
        if (found || !budget.exhausted) memo.set(key, found);
        return found;
    }
}

function* around(pos) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        if (dx || dy || dz) yield pos.offset(dx, dy, dz);
}

// The predicate for one bot, for callers that dig without the pathfinder
// (placeBlock's break-in-the-way, skills.js). False when no work layer runs.
export function isProtectedForBot(bot, block) {
    const guard = guards.get(bot);
    return Boolean(guard && block && guard.protector.isProtected(block));
}

// --- the Movements.prototype.safeToBreak patch ---------------------------------

const guards = new WeakMap(); // bot -> {protector, taskRunning}
let original = null;

// The pathfinder's falling blocks are sand and gravel only (movements.js:64-66);
// suspicious sand and gravel fall too and lose their loot, and a clear keeps
// them as containers, so their support is not dug either.
const FALLING = ['suspicious_sand', 'suspicious_gravel'];
export function knowFallingBlocks(m) {
    if (m.workFalling) return;
    m.workFalling = true;
    for (const name of FALLING) {
        const id = m.bot.registry.blocksByName[name]?.id;
        if (id != null) m.gravityBlocks.add(id);
    }
}

// Installed once per process (REQ-SAFE-3). Because it is the prototype, it also
// covers Movements instances that never reach setMovements: collectBlock's own
// (skills.js) and the collect plugin's (CollectBlock.js:70).
export function installSafeToBreakPatch() {
    if (original) return;
    original = pf.Movements.prototype.safeToBreak;
    const base = original;
    pf.Movements.prototype.safeToBreak = function (block) {
        const guard = guards.get(this.bot);
        if (!guard) return base.call(this, block);
        knowFallingBlocks(this);
        if (guard.protector.isProtected(block)) return false;
        if (!guard.taskRunning()) return base.call(this, block);
        // REQ-FIND-16: both flags are read only inside safeToBreak, and
        // collectBlock / the collect plugin set them false; force them back.
        const flow = this.dontCreateFlow;
        const falling = this.dontMineUnderFallingBlock;
        this.dontCreateFlow = true;
        this.dontMineUnderFallingBlock = true;
        try {
            return base.call(this, block);
        } finally {
            this.dontCreateFlow = flow;
            this.dontMineUnderFallingBlock = falling;
        }
    };
}

export function uninstallSafeToBreakPatch() {
    if (!original) return;
    pf.Movements.prototype.safeToBreak = original;
    original = null;
}

export function guardBot(bot, protector, taskRunning) {
    guards.set(bot, { protector, taskRunning });
}

export function unguardBot(bot) {
    guards.delete(bot);
}

// --- SIGINT clean_stop (REQ-REC-7) -------------------------------------------

// MindServer's "stop agent" sends SIGINT. Write clean_stop synchronously, remove
// the handler and re-raise, so the parent still sees the signal and does not
// restart the process.
export function installCleanStop(writeCleanStop) {
    const handler = () => {
        try {
            writeCleanStop();
        } catch (err) {
            console.error('[work] could not write clean_stop:', err);
        }
        process.removeListener('SIGINT', handler);
        process.kill(process.pid, 'SIGINT');
    };
    process.on('SIGINT', handler);
    return () => process.removeListener('SIGINT', handler);
}
