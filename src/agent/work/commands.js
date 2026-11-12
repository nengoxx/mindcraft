// The I1 work commands (SPEC §12.0, REQ-TRN-13), registered through the
// commands/index.js carry so they appear in $COMMAND_DOCS. The model's text
// command and the owner's forced command reach the same perform.
//
// On success each task command shows its one-line result to the owner, saves it
// to history and returns nothing: a falsy result ends the command loop with no
// follow-up inference and skips its history.save() (agent.js:379-382, :390), so
// the save is explicit here (REQ-PLAN-2). !blockPositions is a query: it returns
// its listing like Mindcraft's own queries.

import Vec3 from 'vec3';
import { turnCategory } from './chat.js';

const POSITIONS_MAX_RANGE = 64; // REQ-TRN-16: range 1–64, clamped (OQ-22)
const POSITIONS_LISTED = 10;    // display cap

// The complete search (REQ-TRN-16, REQ-CLR-2): every cell of the cube of
// `range` around `center`, filtered by distance, never findBlocks (it misses
// blocks inside its radius, SPEC §4.1). `positions` are nearest first;
// `unloaded` says whether any cell in the radius was not loaded (blockAt null),
// so the search was not complete. The clear step's marker search reuses it (S2c).
export function findAllBlocks(bot, name, range, center = bot.entity.position.floored()) {
    const positions = [];
    let unloaded = false;
    const cell = Vec3(0, 0, 0);
    for (let x = center.x - range; x <= center.x + range; x++)
        for (let y = center.y - range; y <= center.y + range; y++)
            for (let z = center.z - range; z <= center.z + range; z++) {
                cell.set(x, y, z);
                if (cell.distanceTo(center) > range) continue;
                const block = bot.blockAt(cell);
                if (!block) unloaded = true;
                else if (block.name === name) positions.push(cell.clone());
            }
    positions.sort((a, b) => a.distanceTo(center) - b.distanceTo(center));
    return { positions, unloaded };
}

function span(found, axis) {
    let min = Infinity, max = -Infinity;
    for (const pos of found) {
        min = Math.min(min, pos[axis]);
        max = Math.max(max, pos[axis]);
    }
    return `${min}..${max}`;
}

export function blockPositions(bot, name, range) {
    range = Math.min(Math.max(range, 1), POSITIONS_MAX_RANGE);
    const { positions: found, unloaded } = findAllBlocks(bot, name, range);
    const note = unloaded ? ' (part of the range is not loaded)' : '';
    if (!found.length) return `No ${name} within ${range}${note}.`;
    const listed = found.slice(0, POSITIONS_LISTED).map(p => `${p.x},${p.y},${p.z}`).join('; ');
    const label = found.length > POSITIONS_LISTED ? `nearest ${POSITIONS_LISTED}` : 'nearest';
    return `${found.length} ${name} within ${range}: bounds x ${span(found, 'x')}, y ${span(found, 'y')}, z ${span(found, 'z')}; ${label}: ${listed}${note}.`;
}

const DSL_HELP = 'Steps: one string, steps separated by ";", each "skill key=value ...": ' +
    'obtain item=<item> count=<1-256>; go_to target=here|owner|<x>,<y>,<z>; give player=<name> item=<item> count=<n>; ' +
    'clear box=<x1>,<y1>,<z1>:<x2>,<y2>,<z2> (exactly those cells) or clear markers=<exact block name> [shell=keep|clear] ' +
    '(the box marked by those blocks; keep, the default, clears only the inside). ' +
    "Free text goes in single quotes; never put a double quote inside an argument (that gives an argument-count error). " +
    'At most 8 steps. Example: !taskStart("40 oak planks", "obtain item=oak_planks count=40")';

// REQ-CHAT-1: the line follows the turn (shown in the owner's turns, a raw
// owner command included, and in blocked-report turns; `detail` in her own);
// a markers= clear's box statement is an `alert` line of its own.
async function report(agent, result) {
    agent.openChat(result.message, turnCategory(agent));
    if (result.statement) agent.openChat(result.statement, 'alert');
    const line = result.statement ? `${result.message} ${result.statement}` : result.message;
    await agent.history.add('system', line);
    await agent.history.save();
}

function taskCommand(name, description, params, run) {
    return {
        name,
        description,
        ...(params ? { params } : {}),
        perform: async function (agent, ...args) {
            if (!agent.work) return 'The task layer is not ready yet.';
            const result = await run(agent.work, ...args);
            // A refusal is returned, so the model sees every error in one system
            // result and may correct the plan (REQ-PLAN-5); the owner sees it too.
            if (!result.ok) return result.message;
            await report(agent, result);
        },
    };
}

export const workCommands = [
    taskCommand('!taskStart',
        'Start a task that runs by itself and survives interruptions and restarts: gathering, crafting, going somewhere, giving items, clearing an area. ' +
        'Prefer it over single commands for any request that takes more than one action. ' + DSL_HELP,
        {
            objective: { type: 'string', description: "The owner's request, restated briefly." },
            steps: { type: 'string', description: 'The steps in the step language above.' },
        },
        (work, objective, steps) => work.startTask(objective, steps)),
    taskCommand('!taskRevise',
        'Replace the unfinished steps of the current task from step from_step on (done steps are kept). Same step language as !taskStart.',
        {
            from_step: { type: 'int', description: 'The first step to replace (1 = the first step).', domain: [1, 100] },
            steps: { type: 'string', description: 'The new steps.' },
        },
        (work, fromStep, steps) => work.reviseTask(fromStep, steps)),
    taskCommand('!taskPause', 'Pause the current task (for example when the owner says to wait or stay).', null,
        work => work.pauseTask()),
    taskCommand('!taskResume', 'Continue a paused or blocked task.', null,
        work => work.resumeTask()),
    taskCommand('!taskCancel', 'Cancel the current task for good.', null,
        work => work.cancelTask()),
    {
        name: '!blockPositions',
        description: 'List where the blocks of one type are within a range, without moving: their count, their bounds and up to ' +
            `${POSITIONS_LISTED} positions, nearest first. Use it to find marker blocks or to check what is left, instead of searching or writing code.`,
        params: {
            type: { type: 'BlockName', description: 'The exact block name.' },
            range: { type: 'int', description: `The search radius in blocks, 1 to ${POSITIONS_MAX_RANGE}.` },
        },
        perform: (agent, type, range) => blockPositions(agent.bot, type, range),
    },
    {
        // REQ-OWN-8: the tidy sweep on request; refused while a task is live.
        name: '!tidy',
        description: 'Remove my own scaffold blocks (pillars, bridges and blocks I put down to move or fight) that I can reach from where I stand, without moving. ' +
            'Refused while a task is running: a task tidies when it ends.',
        perform: async agent => agent.work ? agent.work.tidy.command() : 'The task layer is not ready yet.',
    },
    {
        // REQ-OBT-11 (design r7 §6): a query, rendered by code.
        name: '!itemList',
        description: 'Show my item list: how many of each item I keep (the rest I drop by myself when my bag is nearly full; anything not listed I keep), ' +
            'what I hold of them, my free slots, whether that cleanup is on, and the last time I dropped things. The list is edited in my profile.',
        perform: agent => agent.work ? agent.work.items.render() : 'The task layer is not ready yet.',
    },
];
