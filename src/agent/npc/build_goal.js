import { Vec3 } from 'vec3';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { blockSatisfied, getTypeOfGeneric } from './utils.js';
import { MATCHING_WOOD_BLOCKS, WOOD_TYPES } from '../../utils/mcdata.js';

function matchesBlock(name, block) {
    if (name === 'air') return ['air', 'cave_air', 'void_air'].includes(block.name);
    if (MATCHING_WOOD_BLOCKS.includes(name)) return WOOD_TYPES.some(wood => block.name === `${wood}_${name}`);
    if (name === 'bed') return block.name.endsWith('_bed');
    return blockSatisfied(name, block);
}

function cellsOf(goal, orientation, furnished) {
    const width = goal.blocks[0][0].length;
    const depth = goal.blocks[0].length;
    const cells = [];
    for (let y = 0; y < goal.blocks.length; y++) {
        for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
                let name = goal.blocks[y][z][x];
                if (!name) continue;
                if (!furnished && (name === 'bed' || name.endsWith('_bed') || name === 'chest' || name.includes('torch'))) name = 'air';
                const [rx, rz] = orientation === 0 ? [x, z] : orientation === 1 ? [depth-z-1, x] : orientation === 2 ? [width-x-1, depth-z-1] : [z, width-x-1];
                cells.push({name, x: rx, y: y + goal.offset, z: rz});
            }
        }
    }
    return cells;
}

// A door's two vertical cells and a bed's two horizontal cells consume one item.
function itemGroups(cells) {
    const groups = [];
    const used = new Set();
    for (const cell of cells) {
        if (cell.name === 'air' || used.has(cell)) continue;
        const group = [cell];
        if (cell.name.endsWith('door')) {
            const upper = cells.find(c => c.name === cell.name && c.x === cell.x && c.z === cell.z && c.y === cell.y+1);
            if (upper) group.push(upper);
        } else if (cell.name.endsWith('bed')) {
            const other = cells.find(c => !used.has(c) && c.name === cell.name && c.y === cell.y && Math.abs(c.x-cell.x)+Math.abs(c.z-cell.z) === 1);
            if (other) group.push(other);
        }
        group.forEach(c => used.add(c));
        groups.push(group);
    }
    return groups;
}

export function getStructureInfo(goal, furnished=true, orientation=0) {
    const cells = cellsOf(goal, orientation, furnished);
    const materials = {};
    for (const group of itemGroups(cells)) materials[group[0].name] = (materials[group[0].name] || 0)+1;
    const width = goal.blocks[0][0].length;
    const depth = goal.blocks[0].length;
    return {
        dimensions: {x: orientation % 2 ? depth : width, y: goal.blocks.length, z: orientation % 2 ? width : depth},
        floorOffset: goal.offset, furnished, materials,
        coordinates: 'Origin is minimum x/z corner at standing-level y; template floor is y+floorOffset. Rotation 0 unchanged, 1/2/3 clockwise quarter-turns viewed from above. Dimensions include rotation padding. Empty-string cells untouched and excluded from clearance checks; wholly empty columns need no support. Air cells cleared. Unfurnished replaces bed/chest/torch cells with air; door remains required.'
    };
}

export function checkStructureSite(bot, goal, position, orientation=0, furnished=true, resume=false) {
    const cells = cellsOf(goal, orientation, furnished);
    const columns = new Map();
    for (const cell of cells) {
        const key = `${cell.x},${cell.z}`;
        if (!columns.has(key)) columns.set(key, []);
        columns.get(key).push(cell);
    }
    const reject = (reason, kind, at, block, required) => ({
        valid: false, reason,
        issue: {kind, position: {x: at.x, y: at.y, z: at.z}, observed: block?.name ?? null, required},
    });
    const surface = new Set();
    // The controller pads templates to a square for rotation. Only declared
    // cells belong to the build; empty strings are explicitly left untouched.
    for (const column of columns.values()) {
        const {x, z} = column[0];
        const supportAt = position.offset(x, Math.min(goal.offset, 0)-1, z);
        const groundAt = position.offset(x, -1, z);
        const support = bot.blockAt(supportAt);
        const ground = bot.blockAt(groundAt);
        const floor = column.find(c => c.y === -1 && c.name !== 'air');
        const missingFloor = resume && floor && ground && matchesBlock('air', ground);
        if (!support || support.boundingBox !== 'block') return reject(
            'Footprint needs loaded solid floor support.', 'support', supportAt, support, 'solid support');
        if (!ground || (ground.boundingBox !== 'block' && !missingFloor)) return reject(
            'Footprint needs loaded solid ground.', 'ground', groundAt, ground, 'solid ground');
        surface.add(ground.name);
        for (const cell of column) {
            if (cell.y < 0) continue;
            const at = position.offset(cell.x, cell.y, cell.z);
            const block = bot.blockAt(at);
            const required = resume && cell.name !== 'air' ? `air or ${cell.name}` : 'air';
            if (!block) return reject('Build volume is not fully loaded.', 'unloaded', at, block, required);
            if (matchesBlock('air', block)) continue;
            if (!resume || !matchesBlock(cell.name, block)) return reject(
                'Build volume is obstructed. First issue shown; other issues may remain. Observation is not permission to remove existing builds.',
                'obstruction', at, block, required);
        }
    }
    return {valid: true, surface: [...surface]};
}

export function findStructureSite(bot, goal, furnished=true, orientation=0, distance=16) {
    // Filter complete sites before Mineflayer applies its result count. Limiting
    // raw air cells lets nearby airborne cells hide valid ground farther away.
    const candidates = bot.findBlocks({
        matching: block => block && block.name === 'air',
        useExtraInfo: block => {
            const ground = bot.blockAt(block.position.offset(0, -1, 0));
            return ground?.boundingBox === 'block' &&
                checkStructureSite(bot, goal, block.position, orientation, furnished).valid;
        },
        maxDistance: distance,
        count: 1,
    });
    for (const position of candidates) {
        const site = checkStructureSite(bot, goal, position, orientation, furnished);
        if (site.valid) return {position, orientation, ...site};
    }
    return {position: null, orientation, reason: 'No loaded clear supported footprint found nearby. Move to the owner-requested ground-level site and query again.'};
}

export class BuildGoal {
    constructor(agent) {
        this.agent = agent;
    }

    async wrapSkill(func, managed=false) {
        if (managed) {
            if (this.agent.bot.interrupt_code) return false;
            try { await func(); }
            catch (err) {
                if (this.agent.bot.interrupt_code) return false;
                skills.log(this.agent.bot, `Build step failed: ${err.message}`);
            }
            return !this.agent.bot.interrupt_code;
        }
        if (!this.agent.isIdle()) return false;
        const res = await this.agent.actions.runAction('BuildGoal', func);
        return !res.interrupted;
    }

    async executeNext(goal, position=null, orientation=null, {managed=false, furnished=true}={}) {
        const bot = this.agent.bot;
        if (orientation === null) orientation = Math.floor(Math.random()*4);
        if (![0, 1, 2, 3].includes(orientation)) throw new Error('Orientation must be 0, 1, 2 or 3.');
        const info = getStructureInfo(goal, furnished, orientation);
        if (!position) position = findStructureSite(bot, goal, furnished, orientation).position;
        if (!position) return {missing: {}, acted: false, position: null, orientation, complete: false, remaining: null, reason: 'No free build origin found.'};
        position = new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
        const site = checkStructureSite(bot, goal, position, orientation, furnished, true);
        if (!site.valid) return {missing: {}, acted: false, position, orientation, furnished, complete: false, remaining: null, reason: site.reason, issue: site.issue};
        const cells = cellsOf(goal, orientation, furnished);
        const groups = itemGroups(cells);
        const at = cell => position.offset(cell.x, cell.y, cell.z);
        const satisfied = cell => {
            const block = bot.blockAt(at(cell));
            return block !== null && matchesBlock(cell.name, block);
        };
        const itemType = name => {
            const inventory = world.getInventoryCounts(bot);
            const matching = Object.keys(inventory).filter(item => inventory[item] > 0 && matchesBlock(name, {name: item}));
            matching.sort((a, b) => inventory[b]-inventory[a]);
            return matching[0] || getTypeOfGeneric(bot, name);
        };
        let acted = false;
        for (const cell of cells) {
            if (managed && bot.interrupt_code) break;
            if (satisfied(cell)) continue;
            if (bot.blockAt(at(cell)) === null) continue;
            if (cell.name !== 'air') {
                const group = groups.find(g => g.includes(cell));
                if (cell !== group[0]) continue;
                const type = itemType(cell.name);
                if (!(world.getInventoryCounts(bot)[type] > 0)) continue;
                acted = true;
                if (!await this.wrapSkill(async () => { await skills.placeBlock(bot, type, ...at(cell).toArray(), 'bottom', true); }, managed)) break;
            } else {
                acted = true;
                if (!await this.wrapSkill(async () => { await skills.breakBlockAt(bot, ...at(cell).toArray()); }, managed)) break;
            }
        }
        // Completion is an observation of the selected template, not a skill return value.
        const remaining = cells.filter(cell => !satisfied(cell)).length;
        const needed = {};
        for (const group of groups) {
            if (group.every(satisfied)) continue;
            const name = group[0].name;
            needed[name] = (needed[name] || 0)+1;
        }
        const inventory = world.getInventoryCounts(bot);
        const missing = {};
        for (const [name, count] of Object.entries(needed)) {
            const available = Object.entries(inventory).filter(([item]) => matchesBlock(name, {name: item})).reduce((sum, [, quantity]) => sum+quantity, 0);
            if (count > available) missing[itemType(name)] = count-available;
        }
        return {missing, acted, position, orientation, furnished, complete: remaining === 0, remaining, interrupted: bot.interrupt_code};
    }
}
