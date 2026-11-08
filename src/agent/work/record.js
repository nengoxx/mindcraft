import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { botDataPath } from '../../utils/runtime_paths.js';

// The task record (SPEC §6). One file per bot, next to memory.json (REQ-REC-1).
export const RECORD_VERSION = 1;
export const TERMINAL = Object.freeze(['done', 'failed', 'cancelled']);
export const RESULT_MAX = 160; // step result cap (a constant, SPEC §14)

// SPEC §6.4. `blocked` and `paused` go back to `active` through !taskResume or
// !taskRevise; every non-terminal state may end as cancelled or failed.
const TRANSITIONS = {
    active: ['paused', 'blocked', 'done', 'failed', 'cancelled'],
    paused: ['active', 'failed', 'cancelled'],
    blocked: ['active', 'failed', 'cancelled'],
    done: [], failed: [], cancelled: [],
};

export function recordPath(botName) {
    return botDataPath(botName, 'task.json');
}

export function isTerminal(record) {
    return !record || TERMINAL.includes(record.status);
}

// Returns {record, state}: state is 'none', 'ok', 'unknown_version' or
// 'unreadable'. The last two leave the file untouched and start with no task
// (REQ-REC-3); the caller logs them.
export function loadRecord(file) {
    if (!existsSync(file)) return { record: null, state: 'none' };
    let record;
    try {
        record = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
        return { record: null, state: 'unreadable', error: String(err) };
    }
    if (record?.version !== RECORD_VERSION) return { record: null, state: 'unknown_version', version: record?.version };
    return { record, state: 'ok' };
}

// Atomic write: temp file plus rename (REQ-REC-2). Synchronous, so the SIGINT
// handler can use it too.
export function saveRecord(file, record, now = Date.now()) {
    record.revision = (record.revision || 0) + 1;
    record.updated_at = now;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2));
    try {
        renameSync(tmp, file);
    } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
    }
    return record;
}

export function setStatus(record, status, reason = null) {
    if (!TRANSITIONS[record.status]?.includes(status))
        throw new Error(`task ${record.id}: illegal transition ${record.status} -> ${status}`);
    record.status = status;
    record.reason = reason;
    return record;
}

export function newStep(n, skill, args) {
    return { n, skill, args, status: 'pending', attempts: 0, no_progress: 0, work_pos: null, progress: null, result: null };
}

export function newRecord({ objective, request_text, requested_by, anchor, steps, placements = [], now = Date.now() }) {
    return {
        version: RECORD_VERSION,
        id: `t${now.toString(36)}`,
        revision: 0,
        created_at: now,
        updated_at: now,
        status: 'active',
        reason: null,
        requested_by,
        objective,
        request_text,
        anchor,
        plan: steps.map((step, i) => newStep(i + 1, step.skill, step.args)),
        cursor: 0,
        structures: [],
        interruptions: { count: 0, last: null },
        placements,
        clean_stop: false,
    };
}

export function clipResult(text) {
    text = String(text ?? '');
    return text.length > RESULT_MAX ? text.slice(0, RESULT_MAX - 1) + '…' : text;
}
