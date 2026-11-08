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
        this.history_revision = 0;

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        let memory = await this.agent.prompter.promptMemSaving(turns);

        if (typeof memory !== 'string' || !memory.trim() ||
            ['My brain disconnected, try again.', 'Vision is only supported by certain models.'].includes(memory.trim()))
            throw new Error('Invalid memory summary');

        // Fork carry: the cap is the memory_max_chars setting (REQ-REC-11).
        const max_chars = settings.memory_max_chars ?? 1000;
        if (memory.length > max_chars)
            memory = memory.slice(0, max_chars);

        return memory;
    }

    startSummary() {
        if (this.summary_pending || this.turns.length < this.max_messages) return;
        const revision = this.history_revision;
        this.summary_pending = this.summarizePending(revision)
            .catch(err => console.error('Error summarizing history:', err))
            .finally(() => {
                this.summary_pending = null;
                if (revision !== this.history_revision) this.startSummary();
            });
    }

    async summarizePending(revision) {
        while (revision === this.history_revision && this.turns.length >= this.max_messages) {
            let end = this.summary_chunk_size;
            while (end < this.turns.length && this.turns[end].role === 'assistant') end++;
            const chunk = this.turns.slice(0, end);
            const memory = await this.summarizeMemories(chunk);
            if (revision !== this.history_revision ||
                !chunk.every((turn, index) => this.turns[index] === turn)) return;

            // Keep the pending evidence visible until its replacement is ready.
            this.appendFullHistory(chunk);
            this.memory = memory;
            this.turns.splice(0, chunk.length);
            console.log("Memory updated to: ", this.memory);
            await this.save();
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

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        this.startSummary();
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
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
