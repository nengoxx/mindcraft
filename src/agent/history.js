import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';
import { botDataPath } from '../utils/runtime_paths.js';


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = botDataPath(this.name, 'memory.json');
        this.full_history_fp = undefined;

        mkdirSync(botDataPath(this.name, 'histories'), { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';
        this.summary_pending = null;
        this.summary_controller = null; // fork carry (I1-1): aborts the running summary when a decision starts
        this.history_revision = 0;

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        // Fork carry (I1-5): a code line's flag is never sent to the model.
        return JSON.parse(JSON.stringify(this.turns.map(({ role, content }) => ({ role, content }))));
    }

    // Fork carry (I1-5, DECISIONS 2026-11-14): the code's own lines (`code`:
    // tidy, restart and behaviour lines, re-posted questions) stay in the
    // history the model sees, but they neither count toward the summary
    // threshold nor go to the summariser; they leave with their chunk.
    countable() {
        return this.turns.reduce((n, turn) => n + (turn.code ? 0 : 1), 0);
    }

    // The first summary_chunk_size countable turns, then any assistant turns
    // that follow them (upstream's chunk rule, counted without code lines).
    chunkEnd() {
        let end = 0;
        for (let counted = 0; end < this.turns.length && counted < this.summary_chunk_size; end++)
            if (!this.turns[end].code) counted++;
        while (end < this.turns.length && this.turns[end].role === 'assistant') end++;
        return end;
    }

    async summarizeMemories(turns, signal = null) {
        console.log("Storing memories...");
        let memory = await this.agent.prompter.promptMemSaving(turns, signal);

        if (typeof memory !== 'string' || !memory.trim() ||
            ['My brain disconnected, try again.', 'Vision is only supported by certain models.'].includes(memory.trim()))
            throw new Error('Invalid memory summary');

        // Fork carry: the cap is the memory_max_chars setting (REQ-REC-11).
        const max_chars = settings.memory_max_chars ?? 1000;
        if (memory.length > max_chars)
            memory = memory.slice(0, max_chars);

        return memory;
    }

    // Fork carry (I1-1, DECISIONS 2026-11-14): the backend serves one request
    // at a time, so a decision never waits behind a summary. None starts while
    // a decision is in flight (the prompter calls this again when the last one
    // returns), and one running when a decision starts is aborted (yieldSummary)
    // and started again: an aborted summary publishes nothing and keeps every turn.
    // Bounded (fix wave 1, build2 r1 rulings): once a summary is a chunk overdue
    // (summaryOverdue), it starts even beside a decision, is no longer aborted,
    // and the decision waits for it, so back-to-back decisions cannot grow
    // history without limit.
    summaryOverdue() {
        return this.countable() >= this.max_messages + this.summary_chunk_size;
    }

    startSummary() {
        if (this.summary_pending || this.countable() < this.max_messages ||
            (this.agent.prompter?.decisions > 0 && !this.summaryOverdue())) return;
        const revision = this.history_revision;
        const controller = new AbortController();
        this.summary_controller = controller;
        this.summary_pending = this.summarizePending(revision, controller.signal)
            .catch(err => {
                if (controller.signal.aborted) console.log('Memory summary yielded to a decision; it runs again after it.');
                else console.error('Error summarizing history:', err);
            })
            .finally(() => {
                this.summary_pending = null;
                if (this.summary_controller === controller) this.summary_controller = null;
                if (revision !== this.history_revision || controller.signal.aborted) this.startSummary();
            });
    }

    // A decision starts: a summary under the bound is aborted (null); an overdue
    // one is returned for the decision to wait on (it never rejects).
    yieldSummary() {
        if (!this.summary_pending) return null;
        if (this.summaryOverdue()) return this.summary_pending;
        this.summary_controller?.abort();
        return null;
    }

    async summarizePending(revision, signal) {
        // I1-1: one macrotask first, so the decision agent.js sends right after
        // the line that crossed the threshold has registered and goes first.
        await new Promise(resolve => setImmediate(resolve));
        // With a decision in flight or waiting it stops after one chunk (fix
        // wave 2, below); one under the bound was aborted (yieldSummary).
        while (!signal.aborted && revision === this.history_revision && this.countable() >= this.max_messages) {
            const chunk = this.turns.slice(0, this.chunkEnd());
            const memory = await this.summarizeMemories(chunk.filter(turn => !turn.code), signal);
            if (revision !== this.history_revision ||
                !chunk.every((turn, index) => this.turns[index] === turn)) return;

            // Keep the pending evidence visible until its replacement is ready.
            this.appendFullHistory(chunk);
            this.memory = memory;
            this.turns.splice(0, chunk.length);
            console.log("Memory updated to: ", this.memory);
            await this.save();
            // Fix wave 2 (build2 r2 rulings): a waiting decision waits for one
            // chunk only; the rest runs after it (startSummary at its return).
            if (this.agent.prompter?.decisions > 0) return;
        }
    }

    appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = botDataPath(this.name, 'histories', `${string_timestamp}.json`);
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
            throw err;
        }
    }

    // Fork carry (I1-5): `code` marks a code line (countable() above).
    async add(name, content, { code = false } = {}) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push(code ? {role, content, code: true} : {role, content});

        this.startSummary();
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                self_prompt_outage: this.agent.self_prompter.outage, // fork carry (REQ-RES-18)
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this.history_revision++;
            this.memory = data.memory || '';
            this.turns = data.turns || [];
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.history_revision++;
        this.turns = [];
        this.memory = '';
    }
}
