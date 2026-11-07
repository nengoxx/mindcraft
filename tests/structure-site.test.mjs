import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Vec3 } from 'vec3';
import { checkStructureSite, findStructureSite } from '../src/agent/npc/build_goal.js';

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
