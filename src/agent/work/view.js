import { isTerminal } from './record.js';

// The task view (REQ-REC-10): at most 700 characters, replacing the
// $SELF_PROMPT text whenever a record exists. Never the full plan internals.
export const VIEW_MAX = 700; // a constant, SPEC §14

export function shortArgs(step) {
    const a = step.args;
    switch (step.skill) {
        case 'obtain': return `${a.item} x${a.count}`;
        case 'give': return `${a.item} x${a.count} to ${a.player}`;
        case 'go_to': return `${a.target.given === 'here' || a.target.given === 'owner' ? `${a.target.given} ` : ''}(${a.target.x}, ${a.target.y}, ${a.target.z})`;
        default: return Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    }
}

function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

function held_count(bot, item) {
    return (bot.inventory?.items?.() ?? []).filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
}

function clip(text, max = VIEW_MAX) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// Returns null when the record should not replace the prompt text: no record,
// or a finished task while a !goal self-prompt is active.
export function renderView(record, { bot, selfPromptActive = false, now = Date.now() } = {}) {
    if (!record) return null;
    if (isTerminal(record)) {
        if (selfPromptActive) return null;
        // The guidance has reserved room; the variable text is clipped first.
        const guidance = 'No task is active now. Do not resume a goal that was stopped or ended, or a task that appears only in your memory summary, unless the owner asks again. ' +
            'Every new gathering, crafting or delivery request, even one that repeats the last task, is new work: start it with !taskStart. ' +
            'Never say something is done unless your inventory shows it now.';
        // What the bot holds now, next to the word "done" (a repeated request was once answered "done" from memory).
        const items = [...new Set(record.plan.filter(s => s.args?.item).map(s => s.args.item))];
        const held = bot && items.length ? ` You hold now: ${items.map(i => `${held_count(bot, i)} ${i}`).join(', ')}.` : '';
        const head = `LAST TASK (${record.status}${record.reason ? `: ${record.reason}` : ''}): "${record.objective}".${held}`;
        return clip(head, VIEW_MAX - guidance.length - 1) + ' ' + guidance;
    }
    const reason = record.status === 'paused' && record.reason ? `: ${record.reason}` : '';
    const parts = [`CURRENT TASK (${record.status}${reason}): "${record.objective}".`];
    const step = record.plan[record.cursor];
    if (step) {
        let line = `Step ${record.cursor + 1}/${record.plan.length}: ${step.skill} ${shortArgs(step)}`;
        if (step.progress) line += `, ${step.progress.metric === 'distance' ? `${step.progress.now} blocks to go` : `${step.progress.now}/${step.progress.target}`}`;
        if (step.work_pos && bot?.entity) {
            const p = bot.entity.position;
            line += `, ${Math.round(Math.hypot(p.x - step.work_pos.x, p.y - step.work_pos.y, p.z - step.work_pos.z))} blocks from its work position`;
        }
        parts.push(line + '.');
    }
    const last = record.interruptions?.last;
    if (last) parts.push(`Last interruption: ${last.by ?? 'unknown'}, ${ago(now - last.at)} ago (${record.interruptions.count} in total).`);
    if (record.status === 'blocked') parts.push(`Blocked: ${record.reason}. Decide with !taskRevise, !taskResume or !taskCancel.`);
    else if (record.status === 'paused') parts.push('Paused: !taskResume continues it, !taskCancel ends it.');
    else parts.push('It runs by itself and resumes after interruptions: answer chat briefly, do not redo its steps with other commands, and do not use !goal.');
    return clip(parts.join(' '));
}
