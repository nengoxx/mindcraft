import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import Vec3 from 'vec3';
import { botDataPath } from '../../utils/runtime_paths.js';
import { isEmptyBlock } from './protect.js';

// The placements ledger (SPEC §11.10, REQ-OWN-1 … 6): one versioned file per
// bot with the blocks the bot placed, by kind. Recording takes the context at
// the placement attempt and the block from the cell (REQ-OWN-3): a runtime wrap
// of bot.placeBlock and bot._placeBlockWithOptions, no upstream patch.

// Version 2 keeps the entries per world (REQ-OWN-1); a version-1 file is
// folded into the current world once at load.
export const LEDGER_VERSION = 2;
export const KINDS = Object.freeze(['station', 'scaffold', 'building', 'own']);
export const STATION_BLOCKS = Object.freeze(['crafting_table', 'furnace']);
// Constants, not keys (SPEC §14).
const WRITE_THROTTLE_MS = 2000; // at most one write per 2 s
const SETTLE_MS = 2000;         // a scaffold attempt settles from the cell 2 s after its last attempt
const REVERT_MS = 3000;         // a tidy dig's server revert window
const WARN_ENTRIES = 10000;     // log warning for the never-evicted kinds
// Tell A: the pathfinder writes this predicted stone into the destination
// synchronously just before it calls bot.placeBlock, and no other caller places
// into stone (pathfinder index.js:571 -> :575; probe P13).
const PREDICTED_STATE = 1;

const ledgers = new WeakMap(); // bot -> Ledger (the dig seam finds it here)
export const ledgerFor = bot => ledgers.get(bot) ?? null;

export function ledgerPath(botName) {
    return botDataPath(botName, 'placements.json');
}

const floor = pos => ({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
const fmt = pos => `${pos.x},${pos.y},${pos.z}`;
const cellKey = (dim, pos) => `${dim}|${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
const inColumn = (pos, corner) => pos.x >= corner.x && pos.x < corner.x + 16 && pos.z >= corner.z && pos.z < corner.z + 16;
const validEntry = e => e && e.pos && Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y) && Number.isFinite(e.pos.z)
    && typeof e.block === 'string' && KINDS.includes(e.kind) && typeof e.dim === 'string';

// The world the bot is in (REQ-OWN-1): `seed:<16 hex digits>` from the login
// packet's hashed seed (bot.game.hashedSeed, kept by the utils/mcdata.js
// carry; protodef reads an i64 as a [high, low] array whose valueOf is a
// BigInt), or null for an unknown world.
export function worldId(bot) {
    const value = bot?.game?.hashedSeed?.valueOf();
    if (typeof value !== 'bigint') return null;
    return `seed:${BigInt.asUintN(64, value).toString(16).padStart(16, '0')}`;
}

export class Ledger {
    constructor(bot, { file, max = 2000, now = Date.now, label = () => null, log = message => console.log(`[ledger] ${message}`),
        throttleMs = WRITE_THROTTLE_MS, settleMs = SETTLE_MS, revertMs = REVERT_MS } = {}) {
        this.bot = bot;
        this.file = file;
        this.max = max;
        this.now = now;
        this.label = label;
        this.log = log;
        this.throttleMs = throttleMs;
        this.settleMs = settleMs;
        this.revertMs = revertMs;
        this.entries = new Map();   // dim|x,y,z -> entry, of the current world only
        this.onRetire = [];         // (entry, why) after an entry is retired (the sleeper's lost bed, S2d)
        this.world = null;          // worldId at load; null: an unknown world, nothing is written
        this.otherWorlds = {};      // the file's other worlds, written back untouched
        this.generation = 0;        // bumped on every block or entry change (the component guard's memo)
        this.attempts = new Map();  // pending scaffold attempts, by cell
        this.placing = new Map();   // non-scaffold attempts in flight, by cell
        this.building = null;       // the build_id of the !buildStructure run in progress
        this.dirty = false;
        this.lastWrite = 0;
        this.writeTimer = null;
        this.warned = false;
        this.timers = new Set();
        this.disposers = [];
    }

    dim() {
        return this.bot.game?.dimension ?? 'overworld';
    }

    // --- the file ----------------------------------------------------------------

    // Loads the current world's entries (REQ-OWN-1: the file keeps them per
    // world; the other worlds are written back untouched). When there is no
    // file (the first load), the station entries of the S2 task record migrate
    // once; `legacy` is that record's {placements, structures}. An unreadable
    // or unknown-version file is renamed aside (<file>.bad-<ms>), so the first
    // write does not overwrite the own, building and station entries in it,
    // and the ledger starts empty. In an unknown world nothing is loaded or
    // written: what the bot places lives in memory for this session.
    load(legacy = null) {
        this.world = worldId(this.bot);
        if (this.world == null) this.log('unknown world (no hashed seed): placements are kept in memory only, nothing is loaded or written');
        let state = 'none';
        if (existsSync(this.file)) {
            try {
                const data = JSON.parse(readFileSync(this.file, 'utf8'));
                if (data?.version === LEDGER_VERSION && data.worlds && typeof data.worlds === 'object') {
                    state = 'ok';
                    const { [this.world]: mine, ...others } = data.worlds;
                    this.otherWorlds = others;
                    if (this.world != null) this.adoptEntries(mine?.entries);
                } else if (data?.version === 1) {
                    state = this.fold(data);
                } else state = 'unknown_version';
            } catch {
                state = 'unreadable';
            }
        }
        if (state === 'unknown_version' || state === 'unreadable') {
            const aside = `${this.file}.bad-${this.now()}`;
            try {
                renameSync(this.file, aside);
                this.log(`${this.file}: ${state}; renamed to ${aside}, starting with an empty ledger`);
            } catch (err) {
                this.log(`${this.file}: ${state}; could not rename it (${err?.message ?? err}), starting with an empty ledger`);
            }
        }
        if (state === 'none' && legacy?.placements?.length) this.migrate(legacy);
        // REQ-OWN-5: the cap per world, once after load (a lowered cap applies).
        if (this.evict()) this.dirty = true;
        if (state === 'folded') this.flush();
        return state;
    }

    adoptEntries(entries) {
        for (const e of entries || []) if (validEntry(e)) this.entries.set(cellKey(e.dim, e.pos), e);
    }

    // The one quarantined fold of a version-1 file (one list, no world): it
    // was written on this server, so its entries become the current world's,
    // and load writes the file back as version 2 (the v1 shape is gone). In
    // an unknown world it is left as it is, for a start that knows its world.
    fold(data) {
        if (this.world == null) {
            this.log(`${this.file}: version 1, not folded in an unknown world; left as it is`);
            return 'v1_kept';
        }
        this.adoptEntries(data.entries);
        this.dirty = true;
        this.log(`${this.file}: version 1 folded into world ${this.world} (${this.entries.size} entries)`);
        return 'folded';
    }

    // REQ-OWN-1: S2's stations (carried `station` entries, and crafting tables or
    // furnaces recorded `permanent` outside every blueprint) become `station`
    // entries. The block is not checked here (the world may not be loaded yet):
    // a stale one is retired when seen (REQ-SAFE-2).
    migrate({ placements, structures = [] }) {
        const blueprints = new Set(structures.map(s => s.id));
        let migrated = 0;
        for (const e of placements) {
            if ((e.kind !== 'station' && e.kind !== 'permanent') || !STATION_BLOCKS.includes(e.block) || blueprints.has(e.build_id)) continue;
            this.entries.set(cellKey(this.dim(), e.pos), { pos: floor(e.pos), block: e.block, kind: 'station', by: null, dim: this.dim(), at: e.at ?? this.now() });
            this.log(`migrated station ${e.block} at ${fmt(floor(e.pos))} from task.json`);
            migrated++;
        }
        if (migrated) { this.dirty = true; this.flush(); }
    }

    // Atomic: temp file plus rename. Synchronous, so the SIGINT handler can use it.
    // Only the current world's slot changes; an unknown world writes nothing.
    flush() {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
        if (!this.dirty || !this.file || this.world == null) return;
        // A removed entry waiting out its revert window is not written: after a
        // restart its cell is air and the entry would only be retired.
        const entries = [...this.entries.values()].filter(e => !e.removed_at).map(({ removing, removed_at, ...e }) => e);
        const worlds = { ...this.otherWorlds, [this.world]: { entries } };
        mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: LEDGER_VERSION, updated_at: this.now(), worlds }, null, 2));
        try {
            renameSync(tmp, this.file);
        } catch (err) {
            rmSync(tmp, { force: true });
            throw err;
        }
        this.dirty = false;
        this.lastWrite = Date.now();
    }

    // At most one write per WRITE_THROTTLE_MS; task changes and SIGINT flush.
    changed() {
        this.dirty = true;
        this.generation++;
        if (this.writeTimer || this.disposed) return;
        const wait = Math.max(0, this.lastWrite + this.throttleMs - Date.now());
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            try {
                this.flush();
            } catch (err) {
                console.error('[ledger] could not write the placements ledger:', err?.message ?? err);
            }
        }, wait);
        this.writeTimer.unref?.();
    }

    later(fn, ms) {
        const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms);
        timer.unref?.();
        this.timers.add(timer);
        return timer;
    }

    // --- entries -----------------------------------------------------------------

    // The live entry at a position in the current dimension (REQ-OWN-1: an
    // entry matches only in its own dimension). A dug entry waiting out its
    // revert window is not live.
    get(pos) {
        const entry = this.entries.get(cellKey(this.dim(), pos));
        return entry && !entry.removed_at ? entry : null;
    }

    // Any entry at a position in the current dimension, live or not (the tidy
    // sweep's structure under the bot, REQ-OWN-7).
    entryAt(pos) {
        return this.entries.get(cellKey(this.dim(), pos)) ?? null;
    }

    list() {
        return [...this.entries.values()];
    }

    // I1-6 (DECISIONS 2026-11-14): how many blocks of `name` she placed at or
    // after `since` that still stand: live entries and pending scaffold
    // attempts (obtain's gain counts its own scaffold).
    placedSince(name, since) {
        const live = this.list().filter(e => e.block === name && e.at >= since && !e.removed_at && e.dim === this.dim()).length;
        const pending = [...this.attempts.values()].filter(a => a.expected === name && a.at >= since).length;
        return live + pending;
    }

    // REQ-OWN-9: an owner !stop keeps a sweep's rest for good: its candidates
    // not yet removed become `own`, its pending attempts are marked `keep` (they
    // settle as `own`; one already settled is re-kinded with the candidates),
    // and the ledger is written at once.
    keep({ candidates = [], attempts = [] }, why) {
        let changed = false;
        const positions = [...candidates];
        for (const attempt of attempts) {
            if (this.attempts.get(attempt.key) !== attempt) { positions.push(attempt.pos); continue; }
            if (attempt.keep) continue;
            attempt.keep = true;
            this.log(`kept pending scaffold attempt at ${fmt(attempt.pos)}: ${why}`);
        }
        for (const pos of positions) {
            const entry = this.get(pos);
            if (entry?.kind !== 'scaffold') continue;
            entry.kind = 'own';
            this.log(`kept scaffold ${entry.block} at ${fmt(entry.pos)} as own: ${why}`);
            changed = true;
        }
        if (!changed) return;
        this.dirty = true;
        this.generation++;
        this.flush();
    }

    add(entry) {
        this.entries.set(cellKey(entry.dim, entry.pos), entry);
        if (entry.kind === 'scaffold') this.evict();
        else if (!this.warned && this.entries.size > WARN_ENTRIES) {
            const kept = this.list().filter(e => e.kind !== 'scaffold').length;
            if (kept > WARN_ENTRIES) {
                this.warned = true;
                this.log(`warning: ${kept} own, building and station entries (above ${WARN_ENTRIES}); they are never evicted`);
            }
        }
        this.changed();
    }

    // REQ-OWN-5: work.ledger_max caps live scaffold entries (of this world,
    // gap entries included); the oldest go, and the cell falls back to the
    // default predicate. Returns how many went.
    evict() {
        const live = this.list().filter(e => e.kind === 'scaffold' && !e.removing && !e.removed_at);
        if (live.length <= this.max) return 0;
        live.sort((a, b) => a.at - b.at);
        const evicted = live.slice(0, live.length - this.max);
        for (const e of evicted) {
            this.entries.delete(cellKey(e.dim, e.pos));
            this.log(`evicted scaffold ${e.block} at ${fmt(e.pos)}: over work.ledger_max ${this.max}`);
        }
        return evicted.length;
    }

    // REQ-SAFE-2, REQ-OWN-5: an entry whose block changed is retired, only for a
    // loaded cell (the caller saw the block); an entry being dug is not.
    retire(pos, why) {
        const key = cellKey(this.dim(), pos);
        const entry = this.entries.get(key);
        if (!entry || entry.removing || entry.removed_at) return;
        this.entries.delete(key);
        this.log(`retired ${entry.kind} ${entry.block} at ${fmt(entry.pos)}: ${why}`);
        this.changed();
        for (const listener of this.onRetire) {
            try {
                listener(entry, why);
            } catch (err) {
                this.log(`a retire listener failed: ${err?.message ?? err}`);
            }
        }
    }

    // REQ-OWN-4: scaffold records are kept through a stop, a crash and an
    // unload. One that lived through such a gap gets `gap_at` (the first gap;
    // never cleared), and is the bot's only while the component guard says so
    // (Protector.gapHers). At process start every scaffold entry is marked.
    markGap(entries, why) {
        let marked = 0;
        for (const e of entries) {
            if (e.kind !== 'scaffold' || e.gap_at != null) continue;
            e.gap_at = this.now();
            marked++;
        }
        if (marked) {
            this.log(`marked ${marked} scaffold entr${marked === 1 ? 'y' : 'ies'} as from before: ${why}`);
            this.changed();
        }
        return marked;
    }

    startGap() {
        this.markGap(this.list(), 'process start');
        this.log(`kept ${this.list().filter(e => e.kind === 'scaffold').length} scaffold entries from before`);
    }

    // REQ-OWN-4: the bot may tidy a live scaffold entry; a gap entry only
    // while `gap(entry)` holds (the component guard, Protector.gapHers). Apart
    // from the material verdict: a lapsed dirt block is natural, yet not the
    // bot's to tidy. Used by every tidy choice and the final pre-dig check.
    scaffoldEligible(entry, { gap = () => false } = {}) {
        return entry?.kind === 'scaffold' && !entry.removing && !entry.removed_at && (entry.gap_at == null || Boolean(gap(entry)));
    }

    // REQ-OWN-5 hygiene: a current-dimension scaffold entry whose loaded cell
    // shows another block is retired (`where` limits it to a column); one
    // being dug is not (retire skips it).
    hygiene(where, why) {
        const dim = this.dim();
        for (const e of this.list()) {
            if (e.kind !== 'scaffold' || e.dim !== dim || !where(e)) continue;
            const block = this.bot.blockAt(new Vec3(e.pos.x, e.pos.y, e.pos.z));
            if (block && block.name !== e.block) this.retire(e.pos, `${why}: now ${block.name}`);
        }
    }

    // A !buildStructure run: its placements are `building` entries, exempt
    // while it runs and protected once it returns (REQ-OWN-2).
    beginBuild() {
        this.building = `b${this.now().toString(36)}`;
        return this.building;
    }

    endBuild(id) {
        if (this.building === id) this.building = null;
    }

    // --- tidy digs (REQ-OWN-5) ---------------------------------------------------

    // Before bot.dig: the entry is exempt from retirement while the dig runs
    // (Mineflayer writes the predicted air locally first, digging.js:160).
    beginRemove(pos) {
        const entry = this.get(pos);
        if (entry) entry.removing = true;
        return entry;
    }

    // After the dig: `removed_at`; a blockUpdate showing the same block within
    // REVERT_MS (a server revert) makes it live again, else it is deleted then.
    // An aborted dig only clears `removing`.
    endRemove(pos, dug) {
        const key = cellKey(this.dim(), pos);
        const entry = this.entries.get(key);
        if (!entry?.removing) return;
        delete entry.removing;
        if (!dug) return;
        entry.removed_at = this.now();
        // Dirty at once: a removed entry is not written, so an exit in the
        // revert window must not leave it in the file (REQ-OWN-5).
        this.dirty = true;
        this.generation++;
        this.later(() => {
            if (this.entries.get(key) !== entry || !entry.removed_at) return;
            this.entries.delete(key);
            this.log(`removed ${entry.kind} ${entry.block} at ${fmt(entry.pos)}`);
            this.changed();
        }, this.revertMs);
    }

    // --- recording (REQ-OWN-3) ---------------------------------------------------

    install() {
        const { bot } = this;
        ledgers.set(bot, this);
        for (const name of ['placeBlock', '_placeBlockWithOptions']) {
            const original = bot[name];
            if (typeof original !== 'function') continue;
            const ledger = this;
            const wrapped = async function (referenceBlock, faceVector, ...rest) {
                const attempt = ledger.attempt(referenceBlock, faceVector);
                let error = null;
                try {
                    return await original.call(this, referenceBlock, faceVector, ...rest);
                } catch (err) {
                    error = err;
                    throw err;
                } finally {
                    ledger.endAttempt(attempt, error);
                }
            };
            bot[name] = wrapped;
            this.disposers.push(() => { if (bot[name] === wrapped) bot[name] = original; });
        }
        this.listen('blockPlaced', (oldBlock, newBlock) => this.onBlockPlaced(newBlock));
        this.listen('blockUpdate', (oldBlock, newBlock) => this.onBlockUpdate(newBlock));
        // A dimension change unloads every column (blocks.js switchWorld).
        this.listen('chunkColumnUnload', corner => this.onColumnUnload(corner));
        this.listen('chunkColumnLoad', corner => this.onColumnLoad(corner));
        // REQ-OWN-5 durability: any exit writes what is dirty (synchronous;
        // a write error is logged, never thrown into the exit).
        const onExit = () => {
            try {
                this.flush();
            } catch (err) {
                console.error('[ledger] could not write the placements ledger at exit:', err?.message ?? err);
            }
        };
        process.once('exit', onExit);
        this.disposers.push(() => process.removeListener('exit', onExit));
        return this;
    }

    listen(event, fn) {
        this.bot.on(event, fn);
        this.disposers.push(() => this.bot.removeListener(event, fn));
    }

    dispose() {
        for (const dispose of this.disposers.splice(0)) dispose();
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        for (const a of this.attempts.values()) clearTimeout(a.timer);
        this.attempts.clear();
        this.placing.clear();
        try {
            this.flush();
        } catch (err) {
            console.error('[ledger] could not write the placements ledger:', err?.message ?? err);
        }
        this.disposed = true;
        if (ledgers.get(this.bot) === this) ledgers.delete(this.bot);
    }

    // The context kind of a placement that is not the pathfinder's (REQ-OWN-2).
    // The sleep routine's bed is `own` (by mode:sleeping) whatever else runs.
    contextKind(expected) {
        if (this.label() === 'mode:sleeping') return { kind: 'own' };
        if (this.building) return { kind: 'building', build_id: this.building };
        if (STATION_BLOCKS.includes(expected)) return { kind: 'station' };
        return { kind: 'own' };
    }

    // At call time: the source, the expected block and the context are fixed
    // here; settlement never re-samples them. Never throws into the placement.
    attempt(referenceBlock, faceVector) {
        try {
            if (!referenceBlock?.position || !faceVector) return null;
            const dest = floor(referenceBlock.position.plus(faceVector));
            const dim = this.dim();
            const key = cellKey(dim, dest);
            const held = this.bot.heldItem?.name ?? null;
            const expected = held && Object.hasOwn(this.bot.registry.blocksByName, held) ? held : null;
            const scaffold = this.bot.blockAt(referenceBlock.position.plus(faceVector))?.stateId === PREDICTED_STATE;
            if (scaffold) {
                const pending = this.attempts.get(key);
                if (pending) {
                    // Repeated attempts for one cell merge into the first.
                    pending.count++;
                    clearTimeout(pending.timer);
                    pending.timer = this.settleLater(pending);
                    return pending;
                }
            }
            const context = scaffold ? { kind: 'scaffold' } : this.contextKind(expected);
            const attempt = { key, pos: dest, source: context.kind, build_id: context.build_id ?? null, expected,
                by: this.label() || null, dim, at: this.now(), count: 1, keep: false };
            if (scaffold) {
                attempt.timer = this.settleLater(attempt);
                this.attempts.set(key, attempt);
            } else {
                this.placing.set(key, attempt);
            }
            return attempt;
        } catch (err) {
            console.error('[ledger] could not record a placement attempt:', err?.message ?? err);
            return null;
        }
    }

    settleLater(attempt) {
        const timer = setTimeout(() => {
            if (this.attempts.get(attempt.key) !== attempt) return;
            const block = this.bot.blockAt(new Vec3(attempt.pos.x, attempt.pos.y, attempt.pos.z));   // blockAt needs a Vec3
            if (block && block.name === attempt.expected) this.settle(attempt, block.name);
            else this.dropAttempt(attempt, block ? `the cell shows ${block.stateId === PREDICTED_STATE ? 'predicted stone' : block.name}` : 'the cell is not loaded');
        }, this.settleMs);
        timer.unref?.();
        return timer;
    }

    // A scaffold attempt becomes an entry once the cell shows the expected
    // block; one marked `keep` by an owner !stop settles as `own` (REQ-OWN-9).
    settle(attempt, block) {
        this.attempts.delete(attempt.key);
        clearTimeout(attempt.timer);
        const kind = attempt.keep ? 'own' : 'scaffold';
        this.add({ pos: attempt.pos, block, kind, by: attempt.by, dim: attempt.dim, at: attempt.at });
        this.log(`placement ${attempt.source} by ${attempt.by ?? '-'} at ${fmt(attempt.pos)} (${attempt.count} attempt${attempt.count === 1 ? '' : 's'}): recorded ${block} as ${kind}`);
    }

    dropAttempt(attempt, why) {
        clearTimeout(attempt.timer);
        if (this.attempts.get(attempt.key) === attempt) this.attempts.delete(attempt.key);
        if (this.placing.get(attempt.key) === attempt) this.placing.delete(attempt.key);
        this.log(`placement ${attempt.source} by ${attempt.by ?? '-'} at ${fmt(attempt.pos)} (${attempt.count} attempt${attempt.count === 1 ? '' : 's'}): no entry (${why})`);
    }

    // A non-scaffold attempt is written from newBlock at blockPlaced, at once
    // (Mineflayer's placeBlock has already waited for the destination's real
    // update, place_block.js:28-44), so !craftRecipe takes back its table.
    onBlockPlaced(newBlock) {
        if (!newBlock?.position) return;
        const key = cellKey(this.dim(), newBlock.position);
        const attempt = this.placing.get(key);
        if (!attempt || attempt.recorded) return;
        if (isEmptyBlock(newBlock)) return; // nothing there to record; endAttempt logs it
        attempt.recorded = true;
        const entry = { pos: attempt.pos, block: newBlock.name, kind: attempt.source, by: attempt.by, dim: attempt.dim, at: attempt.at };
        if (attempt.build_id) entry.build_id = attempt.build_id;
        this.add(entry);
        this.log(`placement ${attempt.source} by ${attempt.by ?? '-'} at ${fmt(attempt.pos)}: recorded ${newBlock.name}`);
    }

    // The wrapped call returned or threw. Scaffold attempts settle from the cell.
    endAttempt(attempt, error) {
        if (!attempt || attempt.source === 'scaffold') return;
        if (this.placing.get(attempt.key) === attempt) this.placing.delete(attempt.key);
        if (!attempt.recorded) this.log(`placement ${attempt.source} by ${attempt.by ?? '-'} at ${fmt(attempt.pos)}: no entry (${error ? error.message ?? error : 'nothing placed'})`);
    }

    onBlockUpdate(newBlock) {
        this.generation++;
        if (!newBlock?.position) return;
        const key = cellKey(this.dim(), newBlock.position);
        const attempt = this.attempts.get(key);
        if (attempt && newBlock.name === attempt.expected) this.settle(attempt, newBlock.name);
        const entry = this.entries.get(key);
        if (!entry) return;
        if (entry.removed_at) {
            if (newBlock.name === entry.block && this.now() - entry.removed_at <= this.revertMs) {
                delete entry.removed_at;
                this.log(`revived ${entry.kind} ${entry.block} at ${fmt(entry.pos)}: the server reverted the dig`);
                this.changed();
            }
            return;
        }
        if (newBlock.name !== entry.block) this.retire(newBlock.position, `now ${newBlock.name}`);
    }

    // REQ-OWN-3/4: an unloaded column drops its pending attempts and keeps its
    // scaffold entries, marked as from before (of any dimension: on a
    // dimension change the old one's columns unload, whichever dimension the
    // bot is in by then).
    onColumnUnload(corner) {
        this.generation++;
        if (!corner) return;
        for (const attempt of [...this.attempts.values(), ...this.placing.values()])
            if (inColumn(attempt.pos, corner)) this.dropAttempt(attempt, 'chunk unloaded');
        this.markGap(this.list().filter(e => inColumn(e.pos, corner)), `chunk unloaded at ${corner.x},${corner.z}`);
    }

    // REQ-OWN-5: a loaded column retires its scaffold entries whose cell shows another block.
    onColumnLoad(corner) {
        this.generation++;
        if (!corner) return;
        this.hygiene(e => inColumn(e.pos, corner), 'chunk loaded');
    }
}
