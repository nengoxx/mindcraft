// Probe P11 (PLAN §4, SPEC OQ-17): which registry entity types the fork's
// mc.isHostile classifies as hostile. Offline: no bot, server or model.
//   node tests/probes/hostiles.mjs [path/to/runtime/config/settings.json]
// Prints JSON to stdout and writes nothing else.
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import forkSettings from '../../settings.js';
import { isHostile } from '../../src/utils/mcdata.js';

const settingsFile = process.argv[2];
const configured = settingsFile
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')).minecraft_version
    : forkSettings.minecraft_version;
// "auto" negotiates with the server, which an offline probe cannot do; it then
// uses the newest Java version minecraft-data knows.
const version = configured && configured !== 'auto'
    ? configured
    : minecraftData.supportedVersions.pc.at(-1);
const data = minecraftData(version);
if (!data)
    throw new Error(`minecraft-data has no data for version ${version}`);

// The fields Mineflayer gives a tracked entity (lib/plugins/entities.js setEntityData).
const entities = data.entitiesArray.map(e => {
    const entity = { name: e.name, type: e.type || 'object', kind: e.category };
    return { ...entity, isHostile: isHostile(entity) };
});
const byType = {};
for (const e of entities)
    byType[e.type] = (byType[e.type] ?? 0) + 1;

console.log(JSON.stringify({
    settings_file: settingsFile ?? null,
    configured_version: configured ?? null,
    version: data.version.minecraftVersion,
    total: entities.length,
    by_type: byType,
    hostile: entities.filter(e => e.isHostile).map(e => e.name),
    entities,
}, null, 2));
