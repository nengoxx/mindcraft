import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Vec3 } from 'vec3';
import { BuildGoal, checkStructureSite, findStructureSite } from '../src/agent/npc/build_goal.js';

const goal = JSON.parse(fs.readFileSync(new URL('../src/agent/npc/construction/small_wood_house.json', import.meta.url)));

function terrain({ clearFrom = 10, loaded = true } = {}) {
    return {
        entity: { position: new Vec3(0, 1, 0) },
        blockAt(position) {
            if (!loaded) return null;
            const name = position.y <= 0 ? 'grass_block' :
                position.y === 1 && position.x < clearFrom ? 'short_grass' : 'air';
            return {
                name, position, boundingBox: name === 'grass_block' ? 'block' : 'empty',
                drops: name === 'air' ? [] : [1], diggable: true,
            };
        },
        // Mineflayer applies matching/useExtraInfo before sorting and count.
        // This fixture models that contract without creating a game connection.
        findBlocks({ matching, useExtraInfo, maxDistance, count }) {
            const candidates = [];
            for (let x = -maxDistance; x <= maxDistance; x++) {
                for (let y = 1 - maxDistance; y <= 1 + maxDistance; y++) {
                    for (let z = -maxDistance; z <= maxDistance; z++) {
                        const pos = new Vec3(x, y, z);
                        if (pos.distanceTo(this.entity.position) > maxDistance) continue;
                        const block = this.blockAt(pos);
                        if (matching(block) && (typeof useExtraInfo !== 'function' || useExtraInfo(block))) candidates.push(pos);
                    }
                }
            }
            return candidates.sort((a, b) => a.distanceTo(this.entity.position) - b.distanceTo(this.entity.position)).slice(0, count);
        },
    };
}

test('nearby airborne cells cannot hide a valid supported site within search distance', () => {
    const bot = terrain();
    assert.equal(checkStructureSite(bot, goal, new Vec3(10, 1, 0), 0, false).valid, true);
    const result = findStructureSite(bot, goal, false, 0, 16);
    assert.deepEqual(result.position, new Vec3(10, 1, 0));
    assert.equal(result.valid, true);
});

test('clear ground returns the nearest valid origin', () => {
    const result = findStructureSite(terrain({ clearFrom: -Infinity }), goal, false);
    assert.deepEqual(result.position, new Vec3(0, 1, 0));
});

test('obstructed and unloaded terrain do not yield guessed origins', () => {
    assert.equal(findStructureSite(terrain({ clearFrom: Infinity }), goal, false).position, null);
    assert.equal(findStructureSite(terrain({ loaded: false }), goal, false).position, null);
});

// NPCContoller.init pads rectangular templates to a square for rotation.
const paddedGoal = structuredClone(goal);
for (const layer of paddedGoal.blocks) for (const row of layer) while (row.length < 7) row.push('');

function withBlock(position, name, loaded=true) {
    const bot = terrain({ clearFrom: -Infinity });
    const base = bot.blockAt.bind(bot);
    bot.blockAt = pos => pos.equals(position) ? (loaded ? {
        name, position: pos, boundingBox: name === 'air' ? 'empty' : 'block',
    } : null) : base(pos);
    return bot;
}

test('square rotation padding neither blocks sites nor requires ground', () => {
    const origin = new Vec3(0, 1, 0);
    // The same padded cell (5, 0) through clockwise rotations in a 7x7 array.
    for (const [orientation, [x, z]] of [[5, 0], [6, 5], [1, 6], [0, 1]].entries()) {
        for (const [y, name, loaded] of [[1, 'stone', true], [0, 'air', true], [-1, 'air', false]]) {
            const bot = withBlock(new Vec3(x, y, z), name, loaded);
            assert.equal(checkStructureSite(bot, paddedGoal, origin, orientation, false).valid, true,
                `unused padding must be ignored: rotation ${orientation}, y ${y}`);
        }
    }
});

test('empty cells in an occupied column remain untouched; explicit air must stay clear', () => {
    const origin = new Vec3(0, 1, 0);
    // A declared air cell above an untouched empty-string cell.
    const template = {offset: 0, blocks: [[['']], [['air']]]};
    const bot = withBlock(origin, 'stone');
    assert.equal(checkStructureSite(bot, template, origin).valid, true);
    const blocked = withBlock(origin.offset(0, 1, 0), 'stone');
    const result = checkStructureSite(blocked, template, origin);
    assert.equal(result.valid, false);
    assert.deepEqual(result.issue, {
        kind: 'obstruction', position: {x: 0, y: 2, z: 0}, observed: 'stone', required: 'air',
    });
});

test('rejections distinguish unloaded volume, missing ground and missing support at exact coordinates', () => {
    const origin = new Vec3(0, 1, 0);
    for (const [position, name, loaded, kind, required] of [
        [new Vec3(0, 1, 0), 'air', false, 'unloaded', 'air'],
        [new Vec3(0, 0, 0), 'air', true, 'ground', 'solid ground'],
        [new Vec3(0, -1, 0), 'air', true, 'support', 'solid support'],
    ]) {
        const result = checkStructureSite(withBlock(position, name, loaded), paddedGoal, origin, 0, false);
        assert.equal(result.valid, false);
        assert.deepEqual(result.issue, {kind, position: {x: position.x, y: position.y, z: position.z},
            observed: loaded ? name : null, required});
    }
});

test('builder returns the observed blocker without running an action', async () => {
    const origin = new Vec3(0, 1, 0);
    const bot = withBlock(origin, 'chest');
    const builder = new BuildGoal({bot, actions: {runAction() { assert.fail('invalid site must not be changed'); }}});
    const result = await builder.executeNext(paddedGoal, origin, 0, {managed: true, furnished: false});
    assert.equal(result.acted, false);
    assert.equal(result.complete, false);
    assert.deepEqual(result.issue, {
        kind: 'obstruction', position: {x: 0, y: 1, z: 0}, observed: 'chest', required: 'air or log',
    });
});

test('resume permits matching house cells and missing floor, but never an unrelated obstruction', () => {
    const origin = new Vec3(0, 1, 0);
    assert.equal(checkStructureSite(withBlock(origin, 'oak_log'), paddedGoal, origin, 0, false, true).valid, true);
    assert.equal(checkStructureSite(withBlock(origin, 'oak_log'), paddedGoal, origin, 0, false, false).valid, false);
    const missingFloor = withBlock(new Vec3(1, 0, 1), 'air');
    assert.equal(checkStructureSite(missingFloor, paddedGoal, origin, 0, false, true).valid, true);
    assert.equal(checkStructureSite(missingFloor, paddedGoal, origin, 0, false, false).valid, false);
    assert.equal(checkStructureSite(withBlock(origin, 'chest'), paddedGoal, origin, 0, false, true).valid, false);
});
