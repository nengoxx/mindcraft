import * as world from '../library/world.js';
import { shortArgs, boxText } from './view.js';

// Reports rendered from observed facts only (REQ-PRI-3, REQ-RES-12): the
// inventory and position now, and the progress the runner measured.

function itemsOf(record) {
    return [...new Set(record.plan.filter(s => s.args.item).map(s => s.args.item))];
}

function inventoryFacts(record, bot) {
    const counts = world.getInventoryCounts(bot);
    const items = itemsOf(record);
    return items.length ? `Inventory now: ${items.map(item => `${item} ${counts[item] || 0}`).join(', ')}.` : '';
}

// One step's result line (stored clipped to 160 characters).
export function stepResult(step, bot) {
    const p = step.progress;
    switch (step.skill) {
        case 'obtain':
            return `have ${world.getInventoryCounts(bot)[step.args.item] || 0} ${step.args.item} (target ${step.args.count}, had ${p?.start ?? 0} at the start)`;
        case 'give':
            return `${step.args.player} picked up ${p?.confirmed ?? 0} ${step.args.item}`;
        case 'go_to': {
            const pos = bot.entity.position;
            const t = step.args.target;
            return `arrived ${Math.round(Math.hypot(pos.x - t.x, pos.y - t.y, pos.z - t.z))} blocks from ${t.x}, ${t.y}, ${t.z}`;
        }
        case 'clear':
            return p?.report ?? 'done';
        default:
            return 'done';
    }
}

// --- chat lines -----------------------------------------------------------------

const CHAT_LINE = 200;   // characters per chat message, under Minecraft's 256 with the whisper header

// A report as chat messages: each line of the text, wrapped at spaces, so a
// long report arrives whole instead of cut mid-word by the transport.
export function chatLines(text) {
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
        let line = '';
        for (const word of paragraph.split(' ')) {
            if (line && line.length + 1 + word.length > CHAT_LINE) { lines.push(line); line = word; }
            else line = line ? `${line} ${word}` : word;
        }
        if (line) lines.push(line);
    }
    return lines;
}

// --- the clear step (SPEC §11.9) ----------------------------------------------

const at = c => `${c.x},${c.y},${c.z}`;

// The box and its cell count, as the !taskStart confirmation states them (REQ-CLR-4).
export function clearStatement(args) {
    const where = `Clearing ${boxText(args.box)}: ${args.cells} cells`;
    if (!args.markers) return `${where}.`;
    return args.shell === 'keep' ? `${where} inside the marked box; its outer layer stays.` : `${where} of the marked box, its outer layer included.`;
}

// Counts by a key, largest first: [[key, count, first cell]].
function groups(cells, keyOf) {
    const map = new Map();
    for (const c of cells) {
        const key = keyOf(c);
        const g = map.get(key) ?? [key, 0, c];
        g[1]++;
        map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b[1] - a[1]);
}

// The question for what is left (REQ-CLR-9): every type of the unrecorded
// non-natural blocks with its count, and every container by name and
// position on lines of their own, with the warning. A yes grants exactly
// what the text lists, so nothing is left out of it; chatLines splits it.
export function leftoversQuestion(args, s) {
    const parts = [`${s.empty} of ${args.cells} cells are empty.`];
    if (s.leftovers.length) {
        const listed = groups(s.leftovers, c => c.block).map(([name, n, c]) => `${name} ${n} (${n === 1 ? 'at' : 'one at'} ${at(c)})`);
        const n = s.leftovers.length;
        // Not "that I did not place": scaffold the cap evicted is the bot's own.
        parts.push(`${n} block${n === 1 ? ' is' : 's are'} left that ${n === 1 ? 'is' : 'are'} not natural and not in my records: ${listed.join(', ')}. Remove ${n === 1 ? 'it' : 'them'} too? Answer yes or no.`);
    }
    if (s.containers.length) {
        const listed = s.containers.map(c => `${c.block} at ${at(c)}`);
        parts.push(`\nAlso inside: ${listed.join(', ')}; their contents would drop; say 'yes, chests too' to remove them${s.leftovers.length ? '' : ', or no to keep them'}.`);
    }
    return parts.join(' ').replace(' \n', '\n');
}

// The report from the final scan (REQ-CLR-8), for example "772/780 cells empty;
// left: 5 next to water, 2 under a falling block, 1 chest (a container, kept)".
// It never claims drops were collected.
export function clearReport(args, s, { declined = false } = {}) {
    const left = [];
    for (const [why, n] of groups(s.kept, c => c.why)) left.push(`${n} ${why}`);
    if (s.leftovers.length) left.push(`${s.leftovers.length} not natural and not in my records${declined ? ' (kept, as you said)' : ''}`);
    for (const [name, n] of groups(s.containers, c => c.block)) left.push(`${n} ${name} (${n === 1 ? 'a container' : 'containers'}, kept)`);
    if (s.unloaded) left.push(`${s.unloaded} not loaded`);
    return `${s.empty}/${args.cells} cells empty${left.length ? `; left: ${left.join(', ')}` : ''}`;
}

// REQ-OWN-10: the tidy line, from a sweep's result (tidy.js). It never claims
// drops were collected.
export function tidyLine({ removed, left }) {
    const blocks = `${removed.length} scaffold block${removed.length === 1 ? '' : 's'} of mine`;
    if (!left.length) return `Removed ${blocks} here.`;
    const reasons = groups(left, l => l.reason);
    const why = reasons.length === 1 ? reasons[0][0] : reasons.map(([reason, n]) => `${n} ${reason}`).join(', ');
    return `Removed ${blocks}; left ${left.length} (${why}).`;
}

// A task started inside a !goal: done hands back to the goal; any other end
// leaves the goal stopped, and the report says so.
export function goalStopped(record) {
    return record.goal ? ` The goal "${record.goal}" that started this task stays stopped.` : '';
}

// A clear step's whole final report goes to the owner; its stored result is
// clipped (REQ-CLR-8).
export function doneReport(record, bot) {
    const steps = record.plan.map(s => `${s.n}. ${s.skill} ${shortArgs(s)}: ${(s.skill === 'clear' && s.progress?.report) || (s.result ?? s.status)}`).join(' ');
    const goal = record.goal ? ` Back to the goal "${record.goal}".` : '';
    return `Task done: "${record.objective}". ${steps} ${inventoryFacts(record, bot)}`.trim() + goal;
}

// Sent to the model as one system message (the blocked step's one model call).
export function blockedReport(record, step, bot) {
    const where = step ? `step ${step.n}/${record.plan.length} (${step.skill} ${shortArgs(step)})` : 'its current step';
    return `Task "${record.objective}" is blocked at ${where}: ${record.reason}. ${inventoryFacts(record, bot)} ` +
        'Tell the owner briefly, then use !taskRevise(from_step, "<steps>") with a changed plan, !taskResume to retry, or !taskCancel.' + goalStopped(record);
}

// REQ-CHAT-1: the owner's one short line for a task he asked for.
export function doneLine(record) {
    return `Task done: "${record.objective}".`;
}

// REQ-CHAT-2: a step blocked a second time in one task (one code line,
// beside the model's relay of the blocked report).
export function blockedAgainLine(n, reason) {
    return `Step ${n} blocked again: ${String(reason).replace(/\.$/, '')}.`;
}

// REQ-CHAT-2: her death, said by code (the model's turn for it is her own).
export function deathLine(pos, paused) {
    return `I died at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}${paused ? '; my task is paused' : ''}.`;
}

// The sleep routine's owner lines (REQ-SLP-8): only what needs the owner.
// `slots`: the free slots the refused pickup needed.
export function bedLine(what, pos, slots = 2) {
    const at = pos ? `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}` : '';
    switch (what) {
        case 'left': return `I left my bed at ${at}.`;
        case 'lost': return `I lost my bed at ${at}.`;
        case 'full': return `My bag is too full to take my bed back (${slots} free slot${slots === 1 ? '' : 's'} needed); it stays at ${at}.`;
        case 'no_skip': return 'The night did not skip, so I got up.';
        case 'stuck': return 'I could not get out of bed; I am still asleep.';
        default: return '';
    }
}

// The inventory upkeep's owner lines (REQ-OBT-11, design r7 §2, §4): only
// when he must act. `data`: the bad entry, the kept items, or the cap's
// {passes, window, hold} (minutes).
export function itemLine(what, data = '') {
    switch (what) {
        case 'error': return `My item list has an error (${data}); I won't drop anything until it's fixed.`;
        case 'cap': return `I've cleaned my bag ${data.passes} times in ${data.window} minutes, so I'm pausing that for ${data.hold} minutes.`;
        case 'kept': return `My bag is full of things I keep: ${data}; add some to my item list?`;
        default: return '';
    }
}

export function failedReport(record, bot) {
    return `Task failed: "${record.objective}": ${record.reason}. ${inventoryFacts(record, bot)}`.trim() + goalStopped(record);
}
