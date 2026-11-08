import * as world from '../library/world.js';
import { shortArgs } from './view.js';

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
        default:
            return 'done';
    }
}

// A task started inside a !goal: done hands back to the goal; any other end
// leaves the goal stopped, and the report says so.
export function goalStopped(record) {
    return record.goal ? ` The goal "${record.goal}" that started this task stays stopped.` : '';
}

export function doneReport(record, bot) {
    const steps = record.plan.map(s => `${s.n}. ${s.skill} ${shortArgs(s)}: ${s.result ?? s.status}`).join(' ');
    const goal = record.goal ? ` Back to the goal "${record.goal}".` : '';
    return `Task done: "${record.objective}". ${steps} ${inventoryFacts(record, bot)}`.trim() + goal;
}

// Sent to the model as one system message (the blocked step's one model call).
export function blockedReport(record, step, bot) {
    const where = step ? `step ${step.n}/${record.plan.length} (${step.skill} ${shortArgs(step)})` : 'its current step';
    return `Task "${record.objective}" is blocked at ${where}: ${record.reason}. ${inventoryFacts(record, bot)} ` +
        'Tell the owner briefly, then use !taskRevise(from_step, "<steps>") with a changed plan, !taskResume to retry, or !taskCancel.' + goalStopped(record);
}

export function failedReport(record, bot) {
    return `Task failed: "${record.objective}": ${record.reason}. ${inventoryFacts(record, bot)}`.trim() + goalStopped(record);
}
