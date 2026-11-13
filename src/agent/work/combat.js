import pf from 'mineflayer-pathfinder';
import { performance } from 'node:perf_hooks';
import * as world from '../library/world.js';
import * as skills from '../library/skills.js';
import * as mc from '../../utils/mcdata.js';
import * as gear from './gear.js';
import { FOLLOW_LABEL } from './inventory.js';
import { WORK_DEFAULTS } from './config.js';

// Combat (SPEC §7.10, REQ-CMB-1 … 9; design combat/recommended-design.md
// r10). The `self_defense` mode (modes.js carry) asks `pick()` every tick
// and runs `fight(enemy)` as `mode:self_defense`; the task runner's resume
// check asks `threat()`, the same pick. A ranged mob named in
// work.combat.ranged is engaged once it aggros (DECISIONS 2026-11-13 "Combat
// starts late against skeletons"), only along an easy path; every fight
// stays on a leash around where the first fight began and walks back to it
// (DECISIONS 2026-11-13 "Combat stays near where it started"), except that a
// cut follow resumes instead and that she passes the mobs while the player
// she follows travels (DECISIONS 2026-11-13 "Both designs answered",
// "Following him on the move").

// Constants, not keys (SPEC §14, design §7); tests shorten the waits.
export const COMBAT = {
    meleeRadius: 8,       // today's self_defense radius (the melee rule)
    closeRadius: 3,       // any mob this close is fought by the melee rule, also after a leash drop, beyond his leash, while he travels
    searchMs: 60,         // one ranged path search (easyPath)
    goalRange: 2,         // easyPath's goal: this close to the target
    verdictMs: 3000,      // a path verdict (ranged or melee) is cached this long per entity ...
    verdictMoved: 4,      // ... unless the target moved more than this since
    hitMs: 5000,          // a mob that hurt her counts as engaged this long
    giveUpIgnoreMs: 60000, // a target given up is ignored this long
    dropIgnoreMs: 10000,  // a ranged target dropped (leash, travelling, no easy path) is ignored this long
    detourFactor: 2,      // an easy path is at most factor x the straight distance ...
    detourExtra: 8,       // ... plus this many nodes
    tickMs: 500,          // the fight's loop
    arrival: 2,           // back at the anchor within this
    walkBackRange: 1,     // the walk back's goal range
    walkBackMs: 30000,    // the walk back gives up after this without arriving
    sampleMinMs: 2500,    // his speed is measured from a sample this old ...
    sampleMaxMs: 3500,    // ... at most this old ...
    freshMs: 1000,        // ... to a newest sample at most this old (else unknown)
    stopMs: 3000,         // travelling ends after this long below half the start speed
};

const AGGRESSIVE = 4;    // the mob_flags bit "aggressive" (has a target; P18)
const fmt = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const tag = e => `${e.name}#${e.id}`;
const dimOf = bot => bot.game?.dimension ?? 'overworld';
const log = message => console.log(`[combat] ${message}`);
// A cached path verdict holds 3 s, unless the mob moved more than 4 since.
const fresh = (v, e, now) => Boolean(v) && now - v.at < COMBAT.verdictMs && v.pos.distanceTo(e.position) <= COMBAT.verdictMoved;

// The fork's follow guard (inventory.js, the item cleanup's admission): the
// action waiting to resume is the follow. Read at the moment it matters.
export function followPending(actions) {
    return Boolean(actions?.resume_func) && actions.resume_name === FOLLOW_LABEL;
}

// The follow rules apply only to a fight that cuts the follow: the running
// action is the follow, or nothing runs and the follow is the pending resume
// (rulings-build-r1 F6). Read by the mode's update before runAction.
export function cutsFollow(actions) {
    return actions?.currentActionLabel === FOLLOW_LABEL || (!actions?.executing && followPending(actions));
}

// One movement recipe for the gate, the chase and the walk back (design §3):
// protection applies (the safeToBreak patch), no doors, no placing at all
// (no scaffold, no towers), the default dig cost.
export function fightMovements(bot) {
    const m = new pf.Movements(bot);
    m.canOpenDoors = false;
    m.scafoldingBlocks = [];
    m.allow1by1towers = false;
    return m;
}

// work.combat's numbers and their checks; a bad value is logged and the
// default used (config.js merges the object one level, unchecked).
const SETTINGS = Object.freeze({
    ranged_radius: v => Number.isFinite(v) && v >= 0,
    path_digs: v => Number.isSafeInteger(v) && v >= 0,
    give_up_s: v => Number.isFinite(v) && v > 0,
    leash: v => Number.isFinite(v) && v > 0,
    travel_speed: v => Number.isFinite(v) && v >= 0,
});

export class Combat {
    constructor(work) {
        this.work = work;
        this.agent = work.agent;
        this.bot = work.agent.bot;
        const c = work.config?.combat ?? WORK_DEFAULTS.combat;
        this.config = {};
        for (const [key, valid] of Object.entries(SETTINGS)) {
            this.config[key] = valid(c[key]) ? c[key] : WORK_DEFAULTS.combat[key];
            if (this.config[key] !== c[key]) log(`ignoring work.combat.${key}: ${JSON.stringify(c[key])} (default ${WORK_DEFAULTS.combat[key]})`);
        }
        if (!Array.isArray(c.ranged)) log(`ignoring work.combat.ranged: ${JSON.stringify(c.ranged)} (not a list)`);
        this.ranged = new Set(Array.isArray(c.ranged) ? c.ranged : []);   // names checked against the registry in check()
        this.anchor = null;          // {pos, dim}: where the first fight of this run began
        this.ignored = new Map();    // entity id -> until (ms)
        this.verdicts = new Map();   // entity id -> {easy, why, at, pos}: the ranged gate
        this.clears = new Map();     // entity id -> {clear, at, pos}: the melee gate
        this.hits = new Map();       // entity id -> when it last hurt her
        this.indexes = new Map();    // mob name -> its mob_flags and health metadata indexes
        this.samples = [];           // {t, x, y, z}: the followed player's positions
        this.sampled = null;         // the entity they belong to
        this.travel = false;         // he is travelling (the two-threshold state)
        this.slowSince = null;
        this.current = null;         // the running fight's state
        this.wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        work.listen(this.bot, 'entityHurt', (entity, source) => this.onHurt(entity, source));
        work.listen(this.bot, 'death', () => this.clearAnchor('death'));
    }

    dispose() {
        this.disposed = true;
    }

    now() {
        return this.work.now();
    }

    // Work.init: unknown mob names are logged and dropped (design §7).
    check() {
        const known = this.bot.registry?.entitiesByName ?? {};
        for (const name of [...this.ranged]) {
            if (known[name]) continue;
            this.ranged.delete(name);
            log(`unknown mob in work.combat.ranged: ${name} (dropped)`);
        }
    }

    // --- events ---------------------------------------------------------------

    onHurt(entity, source) {
        if (!entity || entity !== this.bot.entity) return;
        if (this.current) this.current.hitsTaken++;
        if (source?.id != null) this.hits.set(source.id, this.now());
    }

    clearAnchor(why) {
        if (!this.anchor) return;
        this.anchor = null;
        if (why) log(`anchor cleared (${why})`);
    }

    // --- whom to fight (design §2) -------------------------------------------------

    indexOf(name) {
        let entry = this.indexes.get(name);
        if (!entry) {
            const keys = this.bot.registry?.entitiesByName?.[name]?.metadataKeys;
            entry = { flags: Array.isArray(keys) ? keys.indexOf('mob_flags') : -1, health: Array.isArray(keys) ? keys.indexOf('health') : -1 };
            this.indexes.set(name, entry);
        }
        return entry;
    }

    // The aggressive bit, or a hit on her within the last 5 s; a missing index
    // or a non-number value reads as not aggressive.
    engaged(e, now) {
        const i = this.indexOf(e.name).flags;
        const flags = i >= 0 ? e.metadata?.[i] : undefined;
        if (typeof flags === 'number' && (flags & AGGRESSIVE) !== 0) return 'aggressive';
        return this.hurtHer(e, now) ? 'hit her' : null;
    }

    hurtHer(e, now) {
        const hit = this.hits.get(e.id);
        return hit != null && now - hit < COMBAT.hitMs;
    }

    health(e) {
        const i = this.indexOf(e.name).health;
        const h = i >= 0 ? e.metadata?.[i] : undefined;
        return typeof h === 'number' ? h : null;
    }

    isRanged(e) {
        return Boolean(e) && this.ranged.has(e.name);
    }

    // Not a dying mob (health 0, still loaded about 1–2 s, P18) nor an invalid one.
    alive(e) {
        const h = this.health(e);
        return e.isValid !== false && (h == null || h > 0);
    }

    // The follow rules hold (design §4, §5): in a fight, when it cut the
    // follow (a !stop that cancels it also ends the fight); else cutsFollow
    // (the mode's update reads it here: self_defense is paused while a fight runs).
    following() {
        if (this.current) return this.current.following;
        return cutsFollow(this.agent.actions);
    }

    isIgnored(e, now) {
        const ig = this.ignored.get(e.id);
        return ig != null && now < ig.until;
    }

    // `firm`: a give-up or a fight error; else a 10 s drop (leash, travel, no easy path).
    ignore(e, ms, now = this.now(), firm = false) {
        this.ignored.set(e.id, { until: now + ms, firm });
    }

    // The melee rule's ignore (rulings-build-r2 W2): within 3 of her a drop
    // never holds, and no ignore holds for a mob that hurt her in the last 5 s.
    ignoredNear(e, now) {
        if (!this.isIgnored(e, now)) return false;
        if (this.bot.entity.position.distanceTo(e.position) > COMBAT.closeRadius) return true;
        return this.ignored.get(e.id).firm && !this.hurtHer(e, now);
    }

    // The leash centre (design §4): the followed player while the follow
    // rules hold (his entity loaded), else the anchor; null with neither.
    centre() {
        if (this.anchor && this.anchor.dim !== dimOf(this.bot)) this.clearAnchor('another dimension');
        if (this.following()) {
            const him = this.work.followTarget();
            if (him?.position) return { pos: him.position, followed: true };
        }
        return this.anchor ? { pos: this.anchor.pos, followed: false } : null;
    }

    // The travelling sampler (design §4, "Following him on the move"): only
    // while the follow check holds and his entity is loaded.
    sample(now) {
        const him = this.following() ? this.work.followTarget() : null;
        if (!him?.position) {
            this.samples = [];
            this.sampled = null;
            return;
        }
        if (him !== this.sampled) {
            this.samples = [];
            this.sampled = him;
        }
        this.samples.push({ t: now, x: him.position.x, y: him.position.y, z: him.position.z });
        while (this.samples.length && now - this.samples[0].t > COMBAT.sampleMaxMs) this.samples.shift();
    }

    // His speed (blocks/s) from a sample 2.5–3.5 s old to the newest one; null
    // (unknown) with no such sample or no sample in the last second.
    speed(now) {
        const newest = this.samples[this.samples.length - 1];
        if (!newest || now - newest.t > COMBAT.freshMs) return null;
        const old = this.samples.find(s => now - s.t >= COMBAT.sampleMinMs && now - s.t <= COMBAT.sampleMaxMs);
        if (!old || newest.t <= old.t) return null;
        return Math.hypot(newest.x - old.x, newest.y - old.y, newest.z - old.z) / ((newest.t - old.t) / 1000);
    }

    // Two thresholds: he starts travelling at travel_speed and stops only
    // after 3 s below half of it (or unknown). Off with travel_speed 0 and
    // while the follow rules do not hold.
    travelling(now) {
        const limit = this.config.travel_speed;
        if (!(limit > 0) || !this.following()) {
            if (this.travel) log('owner stopped: normal rules');
            this.travel = false;
            this.slowSince = null;
            return false;
        }
        const v = this.speed(now);
        if (!this.travel) {
            if (v != null && v >= limit) {
                this.travel = true;
                this.slowSince = null;
                log(`owner travelling (${v.toFixed(1)} b/s): passing mobs`);
            }
        } else if (v == null || v < limit / 2) {
            this.slowSince ??= now;
            if (now - this.slowSince >= COMBAT.stopMs) {
                this.travel = false;
                this.slowSince = null;
                log('owner stopped: normal rules');
            }
        } else {
            this.slowSince = null;
        }
        return this.travel;
    }

    // The gate for a ranged target (design §3): a path with at most path_digs
    // digs, no placing, and no long detour.
    easyPath(target) {
        const bot = this.bot;
        const started = performance.now();
        const m = fightMovements(bot);
        if (m.updateLavaAvoidance) m.updateLavaAvoidance();
        const p = target.position;
        const result = bot.pathfinder.getPathFromTo(m, bot.entity.position, new pf.goals.GoalNear(p.x, p.y, p.z, COMBAT.goalRange),
            { timeout: COMBAT.searchMs, tickTimeout: COMBAT.searchMs }).next().value.result;
        const ms = performance.now() - started;
        const path = result.path ?? [];
        const digs = path.reduce((n, node) => n + (node.toBreak?.length ?? 0), 0);
        const bound = COMBAT.detourFactor * bot.entity.position.distanceTo(p) + COMBAT.detourExtra;
        let why = null;
        if (result.status !== 'success') why = result.status;
        else if (digs > this.config.path_digs) why = `${digs} digs`;
        else if (path.length > bound) why = `${path.length} nodes, a detour`;
        return { easy: !why, why, nodes: path.length, digs, ms };
    }

    // The cached verdict for `e`, or a new one while this update's one search
    // is unused; else null, except that the current target keeps its last
    // verdict until a later update re-checks it (a nearer candidate took the
    // search: the chase is not dropped for that).
    verdict(e, now, budget, current) {
        let v = this.verdicts.get(e.id);
        if (fresh(v, e, now)) return v;
        if (budget.used) return e === current ? v ?? null : null;
        budget.used = true;
        const prev = v;
        v = { ...this.easyPath(e), at: now, pos: e.position.clone() };
        this.verdicts.set(e.id, v);
        if (!v.easy && prev?.why !== v.why) log(`no easy path to ${tag(e)} (${v.why}, ${Math.round(v.ms)} ms)`);
        return v;
    }

    // The melee gate (world.isClearPath) for a new melee target, in a fight
    // too; its verdict is cached as a ranged one is, and its search is the
    // update's one search (rulings-build-r1 F4).
    async clear(e, now, budget) {
        const v = this.clears.get(e.id);
        if (fresh(v, e, now)) return v.clear;
        budget.used = true;
        const clear = await world.isClearPath(this.bot, e);
        this.clears.set(e.id, { clear, at: now, pos: e.position.clone() });
        return clear;
    }

    prune(now) {
        for (const [id, { until }] of this.ignored) if (now >= until) this.ignored.delete(id);
        for (const [id, at] of this.hits) if (now - at >= COMBAT.hitMs) this.hits.delete(id);
        for (const cache of [this.verdicts, this.clears])
            for (const id of cache.keys()) if (!this.bot.entities?.[id]) cache.delete(id);
    }

    // The entity to fight now, or null (design §2, §4). The mode's update
    // (outside a fight), every fight tick (`fight` set) and the runner's
    // threat() share it.
    async pick({ fight = null } = {}) {
        try {
            const bot = this.bot;
            if (this.disposed || !bot.entity?.position) return null;
            const now = this.now();
            this.prune(now);
            const her = bot.entity.position;
            const centre = this.centre();
            this.sample(now);
            const travelling = this.travelling(now);
            // Beyond the leash of the player she follows, after a leash drop and
            // while he travels: melee only within 3; beyond his leash and while
            // he travels also no ranged target (design §4).
            const beyondHim = Boolean(centre?.followed) && her.distanceTo(centre.pos) > this.config.leash;
            const close = travelling || beyondHim || Boolean(fight?.leashDropped);
            const meleeRadius = close ? COMBAT.closeRadius : COMBAT.meleeRadius;
            const current = fight?.target ?? null;
            const budget = { used: false };   // one path search per update
            // 1. The melee rule (today's): it always wins over the ranged rule.
            // A ranged mob counts only within 3; farther it is the ranged
            // rule's alone (rulings-build-r1 F1). A new target needs a clear path.
            const fightable = e => mc.isHostile(e) && this.alive(e) && !this.ignoredNear(e, now)
                && (!this.isRanged(e) || her.distanceTo(e.position) <= COMBAT.closeRadius);
            const melee = world.getNearestEntityWhere(bot, fightable, meleeRadius);
            if (melee && (melee === current || await this.clear(melee, now, budget))) return melee;
            // A blocked nearer mob never drops the current target while the
            // rule still admits it (rulings-build-r2 W1; no search).
            if (melee && current && fightable(current) && her.distanceTo(current.position) < meleeRadius) return current;
            // 2. The ranged rule: engage once it aggros, along an easy path
            // (DECISIONS 2026-11-13 "Combat starts late against skeletons").
            // None while he travels (DECISIONS 2026-11-13 "Following him on the move").
            if (!this.ranged.size || travelling || beyondHim) return null;
            const candidates = Object.values(bot.entities ?? {})
                .filter(e => e !== bot.entity && this.ranged.has(e.name) && e.position && her.distanceTo(e.position) <= this.config.ranged_radius
                    && this.alive(e) && !this.isIgnored(e, now)
                    // A new target within the leash of the centre; the current one stays until her leash check drops it.
                    && (e === current || !centre || centre.pos.distanceTo(e.position) <= this.config.leash)
                    && this.engaged(e, now))
                .sort((a, b) => her.distanceTo(a.position) - her.distanceTo(b.position));
            for (const e of candidates) {
                const v = this.verdict(e, now, budget, current);
                if (!v) continue;
                if (v.easy) return e;
                if (e === current) {
                    // The chase stays easy (design §4): dropped, ignored 10 s.
                    this.ignore(e, COMBAT.dropIgnoreMs, now);
                    log(`${tag(e)} dropped: no easy path (${v.why})`);
                }
            }
            return null;
        } catch (err) {
            console.error('[combat] pick failed:', err);
            return null;
        }
    }

    // The task runner's resume check (REQ-RES-8): no hostile self_defense
    // would fight now.
    async threat() {
        return this.bot.modes?.isOn('self_defense') ? this.pick() : null;
    }

    // --- the fight (design §4, §5) -------------------------------------------------

    // mode:self_defense. `epoch`: agent.stop_epoch as the mode's update read it
    // before pick; `cut`: the action the fight cuts (for the log);
    // `following`: it cuts the follow (cutsFollow, read with the epoch).
    async fight(first, { epoch = this.agent.stop_epoch, cut = '', following = cutsFollow(this.agent.actions) } = {}) {
        const { bot, agent } = this;
        const started = this.now();
        const halted = () => Boolean(bot.interrupt_code) || agent.stop_epoch !== epoch;
        const fight = { target: null, leashDropped: false, digs: new Map(), watch: new Map(), walk: null, noPath: false,
            kills: 0, hitsTaken: 0, maxFromAnchor: 0, following };
        this.current = fight;
        bot.modes.pause('self_defense');
        bot.modes.pause('cowardice');
        const pvpMovements = bot.pvp.movements;
        bot.pvp.movements = fightMovements(bot);
        // Her digs during a chase, counted when each completes (Mineflayer
        // drops every diggingCompleted listener on death); the
        // count lives on this fight, so a late callback never counts into a later one.
        const dig = bot.dig;
        const counted = function (block, ...rest) {
            const id = fight.target?.id;
            return dig.call(this, block, ...rest).then(result => {
                if (id != null) fight.digs.set(id, (fight.digs.get(id) ?? 0) + 1);
                return result;
            });
        };
        bot.dig = counted;
        const onPath = result => { if (fight.walk && result?.status === 'noPath') fight.noPath = true; };
        bot.on('path_update', onPath);
        let target = first;
        try {
            if (halted()) return;
            if (!this.anchor) {
                this.anchor = { pos: bot.entity.position.clone(), dim: dimOf(bot) };
                log(`anchor ${fmt(this.anchor.pos)} (first fight; cut ${cut || 'nothing'})`);
            }
            while (true) {
                if (halted()) return;
                const now = this.now();
                this.checkAnchor();
                if (this.anchor) fight.maxFromAnchor = Math.max(fight.maxFromAnchor, bot.entity.position.distanceTo(this.anchor.pos));
                if (target) {
                    fight.walk = null;
                    // Not while a path dig runs: its tool and its finish time stand (rulings-build-r1 F2).
                    if (!bot.pathfinder.isMining()) await gear.equipWeapon(bot);
                    if (halted()) return;
                    if (target !== fight.target) {
                        if (!(await this.switchTo(fight, target, halted))) return;
                        if (!fight.watch.has(target.id)) fight.watch.set(target.id, { health: this.health(target), at: now });
                        this.logEngage(target, now);
                    }
                } else if (!(await this.walkBack(fight, now, halted))) {
                    return;
                }
                await this.wait(COMBAT.tickMs);
                if (halted()) return;
                const ended = this.afterTick(fight);
                if (ended) return;
                const previous = fight.target;
                target = await this.pick({ fight });
                if (halted()) return;
                // While he travels a ranged target beyond 3 the rule no longer
                // admits is dropped and ignored 10 s; melee mobs never are
                // (design §4, r10; rulings-build-r1 F1).
                if (previous && target !== previous && this.travel && this.isRanged(previous)
                    && bot.entity.position.distanceTo(previous.position) > COMBAT.closeRadius) {
                    this.ignore(previous, COMBAT.dropIgnoreMs);
                    log(`${tag(previous)} dropped: owner travelling`);
                }
            }
        } catch (err) {
            // An error ends the fight like an interrupt: no walk back, no
            // throw, so the cut action stays pending and no model call follows
            // (rulings-build-r1 F5); its target is ignored 10 s, so a lasting
            // error is no fight loop (rulings-build-r2 W3). Accepted residual
            // (rulings-build-r3): a hit within the last 5 s lifts this ignore
            // within 3, so a lasting error beside a mob that hit her retries
            // every update for up to 5 s; it needs a persistent equip failure.
            log(`fight error: ${err?.message ?? err}`);
            if (target) this.ignore(target, COMBAT.dropIgnoreMs, this.now(), true);
        } finally {
            bot.pvp.forceStop();
            bot.pathfinder.setGoal(null);
            bot.pvp.movements = pvpMovements;
            if (bot.dig === counted) bot.dig = dig;
            bot.removeListener('path_update', onPath);
            bot.modes.unpause('self_defense');
            bot.modes.unpause('cowardice');
            // Every end clears the anchor: back within 2, the follow skip, the
            // walk back's bound, or an end without finishing the walk back
            // (interrupted, a !stop, cut by unstuck or self_preservation), so a
            // later fight never walks her back to an old spot (design §5).
            this.anchor = null;
            this.current = null;
            const max = fight.maxFromAnchor.toFixed(1);
            log(`fight over: ${fight.kills} kills, ${fight.hitsTaken} hits taken, max ${max} from the anchor, ${Math.round((this.now() - started) / 1000)} s`);
            if (fight.kills) skills.log(bot, 'Successfully defended self.');
        }
    }

    // The anchor's clear conditions checked during a fight: another dimension,
    // or more than 2 x leash away (a teleport).
    checkAnchor() {
        const a = this.anchor;
        if (!a) return;
        if (a.dim !== dimOf(this.bot)) this.clearAnchor('another dimension');
        else if (this.bot.entity.position.distanceTo(a.pos) > 2 * this.config.leash) this.clearAnchor('a teleport');
    }

    // One serialized target change (design §4): forceStop (synchronous) before
    // any new attack or goal, then the interruption is checked again, so no
    // pending attack() overwrites a later goal. False when halted.
    async switchTo(fight, target, halted) {
        const bot = this.bot;
        bot.pvp.forceStop();
        fight.target = target;
        if (!target) bot.pathfinder.setGoal(null);
        if (halted()) return false;
        if (target) await bot.pvp.attack(target);
        return !halted();
    }

    logEngage(target, now) {
        const d = this.bot.entity.position.distanceTo(target.position).toFixed(1);
        const v = this.isRanged(target) ? this.verdicts.get(target.id) : null;
        const why = this.isRanged(target) ? this.engaged(target, now) ?? 'kept' : 'melee';
        log(`engage ${tag(target)} ${d} (${why})${v ? `; path ${v.nodes} nodes, ${v.digs} digs, ${Math.round(v.ms)} ms` : ''}`);
    }

    // After each 500 ms wait: the target's end, give-up (health, digs) and the
    // leash on her. True when the fight ends now (a leash drop under the
    // follow rules: the follow skip).
    afterTick(fight) {
        const { bot } = this;
        const now = this.now();
        const target = fight.target;
        if (!target) return false;
        // Gone, dying or invalid: a kill, counted once (pick never returns it again).
        if (!bot.entities?.[target.id] || !this.alive(target)) {
            fight.kills++;
            fight.target = null;
            return false;
        }
        const watch = fight.watch.get(target.id);
        const h = this.health(target);
        if (watch && h != null && (watch.health == null || h < watch.health)) {
            watch.health = h;
            watch.at = now;
        }
        const digs = fight.digs.get(target.id) ?? 0;
        if (digs > this.config.path_digs) return this.giveUp(fight, target, `${digs} digs`, now);
        if (watch && now - watch.at >= this.config.give_up_s * 1000)
            return this.giveUp(fight, target, `${Math.round((now - watch.at) / 1000)} s no damage`, now);
        // The leash is on her (design §4; DECISIONS 2026-11-13 "Combat stays
        // near where it started": a 16-block area by default): beyond it from
        // the centre, a target within 3 of her is kept, whatever its kind; a
        // farther one is dropped, and ignored 10 s when ranged (never a melee
        // one; rulings-build-r1 F1).
        const centre = this.centre();
        if (!centre) return false;
        const out = bot.entity.position.distanceTo(centre.pos);
        if (out <= this.config.leash) return false;
        if (bot.entity.position.distanceTo(target.position) <= COMBAT.closeRadius) return false;
        if (this.isRanged(target)) this.ignore(target, COMBAT.dropIgnoreMs, now);
        fight.leashDropped = true;
        fight.target = null;
        log(`leash: ${out.toFixed(1)} from the ${centre.followed ? 'followed player' : 'anchor'}; back`);
        if (this.following()) {
            log('the follow resumes: no walk back');
            return true;
        }
        return false;
    }

    giveUp(fight, target, why, now) {
        this.ignore(target, COMBAT.giveUpIgnoreMs, now, true);
        fight.target = null;
        log(`give up ${tag(target)} (${why})`);
        return false;
    }

    // The walk back (design §5), inside the fight action before idle. False
    // when the fight ends.
    async walkBack(fight, now, halted) {
        const { bot } = this;
        const a = this.anchor;
        if (!a) return false;
        // Following: the follow resumes instead (the owner's answer, DECISIONS 2026-11-13).
        if (this.following()) {
            log('the follow resumes: no walk back');
            return false;
        }
        const d = bot.entity.position.distanceTo(a.pos);
        if (d <= COMBAT.arrival) {
            if (fight.walk) log(`back at the anchor (${fight.walk.from.toFixed(1)} in ${((now - fight.walk.at) / 1000).toFixed(1)} s)`);
            return false;
        }
        if (!fight.walk) {
            if (!(await this.switchTo(fight, null, halted))) return false;
            bot.pathfinder.setMovements(fightMovements(bot));
            bot.pathfinder.setGoal(new pf.goals.GoalNear(a.pos.x, a.pos.y, a.pos.z, COMBAT.walkBackRange));
            fight.walk = { at: now, from: d };
            fight.noPath = false;
            return true;
        }
        if (fight.noPath) {
            log('could not get back (noPath); anchor cleared');
            return false;
        }
        if (now - fight.walk.at >= COMBAT.walkBackMs) {
            log(`could not get back (${Math.round(COMBAT.walkBackMs / 1000)} s); anchor cleared`);
            return false;
        }
        return true;
    }
}
