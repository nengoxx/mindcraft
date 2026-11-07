import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import minecraftData from 'minecraft-data';
import registryLoader from 'prismarine-registry';

const staticData = minecraftData('26.1');
const mc = await import('../src/utils/mcdata.js');
mock.module('../src/utils/mcdata.js', {
    namedExports: { ...mc, getAllBiomes: () => staticData.biomes },
});
const { getBiomeName } = await import('../src/agent/library/world.js');

function fixture(id = 0) {
    const registry = registryLoader('26.1');
    // Use the installed registry decoder to model server-assigned biome IDs.
    registry.loadDimensionCodec({
        id: 'minecraft:worldgen/biome',
        entries: ['minecraft:forest', 'example:grove'].map(key => ({
            key, value: { type: 'compound', value: {} },
        })),
    });
    return { registry, entity: { position: {} }, world: { getBiome: () => id }, blockAt: () => ({}) };
}

test('biome observations use server registry IDs instead of static version IDs', () => {
    assert.notEqual(staticData.biomes[0].name, 'forest');
    assert.equal(getBiomeName(fixture()), 'forest');
});

test('server-defined biome names are retained', () => {
    assert.equal(getBiomeName(fixture(1)), 'example:grove');
});

test('unknown IDs and unloaded positions remain unknown', () => {
    assert.equal(getBiomeName(fixture(999)), 'Unknown');
    assert.equal(getBiomeName({ ...fixture(), blockAt: () => null }), 'Unknown');
});
