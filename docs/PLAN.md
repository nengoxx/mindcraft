# Plan — building the task layer

This document says **how and in what order** the [specification](SPEC.md) is
built. Requirement numbers (`REQ-…`) and open questions (`OQ-…`) refer to SPEC.md;
each requirement there carries the iteration that builds it (`[I1]` … `[Surv]`).
Owner rulings are in [DECISIONS.md](DECISIONS.md).

Contents: 1 Iterations and order · 2 Rules for every slice · 3 Slices · 4 Probes ·
5 Design experiment (DX) · 6 Review and commit · 7 Live-testing etiquette ·
8 Deferred items and their seams.

---

## 1. Iterations and order

```
I1  usable for play     S0-lite → S2 → S2b → S2c → S2c-fu → S2d → S2e → S2e-fu → Gear → Ownblocks → Combat → Travel → Reliability 1 → S3
I2  native tools        S1 → S4 (rest)
I3  structures          DX → S5A
I4  discovery           S5B
I5  underground, smelt  S6
Surv survival           SV (when the owner turns damage back on)
```

**Status (2026-11-08):** S0-lite and S2 are built, reviewed, deployed and passed their live
trials (S2: 1–2 model calls per request, resume after fights, crash restarts and stops
with no call; [RESEARCH.md](RESEARCH.md) §8, [ISSUES.md](ISSUES.md) live findings). (Its
"next: S3" is superseded by the status below.)

**Status (2026-11-11):** the cube-clearing trials (ISSUES, cube analysis) led to
a design council on clearing, the bot's own blocks, model outages and
observation; the owner approved its lean version (DECISIONS 2026-11-11). Two
slices go before S3: S2b, then S2c. Next: S2b.

**Status (2026-11-12):** S2b, S2c and S2c-fu are built, deployed and passed their
live trials. S2d is built and deployed, but its live trials failed on the bed's
placement check and one lost bed (ISSUES "S2d live trials"). Next: the S2d fix,
then S2e (inventory upkeep, DECISIONS 2026-11-11), then S3.

**Status (2026-11-12, later):** S2e part A (inventory upkeep: the item list,
the shared planner and dropper, the idle cleanup) is built offline; probe P15
ran live the same day and kept the design's values (§4). Part B (the chest)
is parked until his word after S2e's trials.

**Status (2026-11-12, evening):** S2e was deployed and trialled (ISSUES "S2e
live trials"); the owner ruled on its findings (DECISIONS 2026-11-12 "After
the S2e live trials"). The follow-up slice S2e-fu (junk in her hand, the pit,
the kept report, the list) is merged and deployed (`13b7b86`); live trials 1–5
pass (ISSUES "S2e-fu live trials"); trial 6 (one best slot of bottles and
banners) waits for the owner to hand her the items. Next, before S3: a gear
slice (the owner's rulings, DECISIONS 2026-11-12 night "The owner's gear and
a one-stack cap"); its section is written from its design.

**Status (2026-11-13):** the gear slice (§3 "Gear") is merged and deployed
(`6e699b6`). Its live trials 1, 3, 5, 6 and 7 pass; trial 2 waits for the
owner; trial 4 (obsidian through `!collectBlocks`) is blocked by protection
(ISSUES "Gear live trials"). Next: the owner's choices on those, the
combat-start slice (DECISIONS 2026-11-13), then S3.

**Status (2026-11-13, later):** the owner answered both council designs
(DECISIONS 2026-11-13 "Both designs answered"). The ownblocks slice (§3
"Ownblocks": the truthful collect count and his blocks on request) is built
offline and goes to review; then its live trials, the combat-start slice, then
S3.

**Status (2026-11-13, evening):** after the live trials of the ownblocks and
combat slices the owner ruled on travel (DECISIONS 2026-11-13 (evening)
"Travel after the live trials"). The travel slice (§3 "Travel") is built
offline and goes to review; then its live trials, then S3.

**Status (2026-11-14):** the travel slice is merged and deployed (`4bae59f`). Its
live trials T1–T4 and T6 pass; T5 (back to work after the climb to drop) is
partial (ISSUES "Travel live trials, 2026-11-14 night"). Next: S3.

The slice names S0 … S6 are kept; iterations group them. The full requirement
text of every later iteration stays in SPEC, tagged with its iteration.

**The owner's rule for cuts** (DECISIONS 2026-11-08, "Iterations and
simplification"): no feature discussed with the owner is dropped. It either reuses
an existing upstream, Mindcraft or Mineflayer mechanism that really delivers it, or
is deferred to a named later iteration. Only internal machinery that delivers
nothing the owner can see is retired.

- **I1 — usable for play (build now).** The smallest set that fixes the core
  complaints: planning, gathering and crafting, combat then back to the task, a
  simple terrain-fitting shelter; since the cube-clearing trials also clearing an
  area on request and not leaving the bot's own scaffold as clutter (DECISIONS
  2026-11-08, 2026-11-11). Transport is Mindcraft's text `!commands` with
  the compact step DSL (SPEC §12.0); native tools wait for I2.
  - Step vocabulary: `obtain` (surface: wood, stone, crafting, a crafting table),
    `go_to`, `give`, `build` (the shelter macro; the catalog only by explicit
    name).
  - S0-lite: request logging, the two baselines, P11 (hostile classification).
  - S2: task record, runner and resume, the surface obtain resolver, protection,
    the persisted ledger (`permanent` and `station` kinds), the task view and
    fact-based reports.
  - S2b: model outages (wait, pause and resume, one notice each way),
    `!blockPositions`, the `goToGoal` configure carry.
  - S2c: clearing an area (the `clear` step and one owner question for
    leftovers and containers), the placements ledger with kinds, and tidying the
    bot's own reachable scaffold. Clearing is a capability of its own (DECISIONS
    2026-11-08); it lands before S3 only because S3 reuses `dig.js`, the ledger
    kinds and the owner question.
  - S2c-fu: quiet chat (`work.chat`) and scaffold records that survive
    restarts and unloads, kept per world (DECISIONS 2026-11-11 "After the S2c
    live trials", 2026-11-12).
  - S2d: sleeping through the night with a bed from her inventory, picked
    straight back up, without hurting the resume (DECISIONS 2026-11-11
    "Sleeping through the night (slice S2d)", 2026-11-12).
  - S2e: inventory upkeep, part A: one item list (keep 0, a count, a stack or
    all), the shared drop for tasks, and dropping the surplus by herself when
    idle or following (DECISIONS 2026-11-11 "Inventory upkeep (slice S2e,
    after S2d)"); part B, a chest instead of dropping, waits for the owner.
  - S2e-fu: after the S2e trials, junk in her hand is dropped, she throws
    over a one-block lip or walks out of a deeper pit to drop, a bag full of
    kept items is reported as such for the owner, and the list keeps the best
    bow and crossbow, and one slot (the best) of banners and of ominous
    bottles (DECISIONS 2026-11-12 "After the S2e live trials", "One slot of
    the best").
  - Gear: she uses the best gear she holds by its real values, keeps only the
    best of each kind, caps every stackable at one stack, lets up to 2
    surplus slots wait, keeps a finished task's goods 30 minutes and gives
    what she has, spares first (DECISIONS 2026-11-12 night, 2026-11-13).
  - Ownblocks: `!collectBlocks` reports only what it really removed and which
    protected blocks stand near; the owner's blocks are mined only on his word,
    through `!collectPlaced` (DECISIONS 2026-11-13 "His blocks on request
    [...]", "Both designs answered").
  - Combat: she engages a skeleton once it aggros if the path is easy, every
    fight stays within 16 of where it started (or of the player she follows)
    and walks back, a cut follow resumes instead, and she passes the mobs
    while he travels (DECISIONS 2026-11-13).
  - S3: the shelter macro (`minimal` or `basic`; `embed` `allow` or `require`),
    the fit search, the builder carry, the Room verifier, material and tool
    insertion, P8 (door yaw).
  - S4's offline tests (stop and death in each step type, owner chat during a
    task) are folded into S2 and S3, and its live trial runs during an S3 build.
- **I2.** S1 native tool calls (P1 runs first; provider, the #769 adapter copy,
  prompt layout arm A, the "use tools" correction). The rest of S4: measure
  summary-versus-decision contention (OQ-18).
- **I3 — structures.** DX, narrowed (§5). S5A: in-game designs through
  `build{source: new, parts}`, the design library, offline design, owner templates
  with `!saveTemplate`, the `enclosure` region type and the layer-row front end.
- **I4 — discovery.** S5B: exploring beyond the loaded area, places memory on
  `MemoryBank`, structure signatures; also the background chunk indexer, biome
  priors, the discovery-database extras (depletion, TTLs, LRU, merge radius,
  global explored set, dangerous places) and the mansion and stronghold rows.
- **I5 — underground and smelting.** S6: `smeltItem` reusing the nearest empty
  furnace, buried ore through the pathfinder's digging, and the wider smelting
  table (`smelting.json`).
- **Survival iteration (SV).** When the owner turns damage back on: the night
  `shelter` policy; the health and food gates; auto-deposit to an owner chest and
  surplus drop; the owner-question bundle (ask before long builds, search-budget
  extensions, `/locate`, rare-target prompts; the question core itself arrives in
  S2c); the careful `descend_to` staircase.
- **On evidence.** Built only if the named failure is observed: the `name{json}`
  drift parser (REQ-TRN-9), prompt layout arm B (REQ-TRN-12).

Why this order:

- Losing the task on interruption is the owner's main complaint, so the task
  record and resume (S2) come right after the baseline, on the text path that
  already works.
- I3 before I4 before I5: structures use surface materials that I1's resolver
  already obtains; discovery comes before underground mining and the iron tier.
- DX needs no game but uses the model backend, so it is scheduled like a trial:
  never while a live trial runs.

## 2. Rules for every slice

### 2.1 Definition of done

A slice is done when all of these hold:

1. Its offline tests pass, together with the existing suites:
   `node --experimental-test-module-mocks --test tests/*.test.mjs` and the
   operator checks listed in operator/README.md.
2. It passed review (§6) and was committed.
3. It was deployed by an agent-only restart and each live acceptance trial passed
   uncoached at least once. Every attempt, passed or failed, is recorded.
4. Its metrics are recorded (§2.3), and the docs whose content changed are
   current.

A trial that fails for the same cause after two fix rounds goes to a design
decision instead of a third patch.

### 2.2 Uncoached trial protocol

- The owner's request is sent once through the owner channel, in natural language,
  exactly as written in the slice. Nothing else is sent until the end.
- Qwen alone orchestrates. No hints, coordinates, material lists or plans.
- The developer may end a trial only for a critical problem (danger to the owner's
  builds or items, a loop that damages the world) or demonstrated non-progress,
  with a terminal `!stop`. That counts as a failed attempt.
- Before a build trial, record the non-natural blocks within 16 of the site;
  after it, the same (the protected-block diff).
- Never resume a failed trial from old memory. Start the next attempt as a new
  request.
- The owner's server currently makes the bot invincible (no damage, drowning or
  hunger), and trials run that way. Every trial report says "invincible"; no
  survival or self-sufficiency claim follows.

### 2.3 Metrics recorded for every trial

What the logs and the record give automatically (REQ-OBS-1..3): request text;
start and end time; model calls by kind; summaries as a share of all requests;
latency per request; interruptions by cause and how many resumed with 0 model
calls; crash restarts; blocks and their reasons; verifier outcome. Build trials
add the protected-block diff. Interventions: target 0.

## 3. Slices

### I1 — usable for play

#### S0-lite — Logging and baselines

- **Goal.** A baseline on the current code and the logging every later trial
  reads.
- **SPEC.** REQ-OBS-1 (text path); answers OQ-17.
- **Files.**
  - `src/models/openai_tools.js` (new): provider with request logging only, text
    path unchanged.
  - `src/models/prompter.js` (carry): pass the request kind to `sendRequest` in
    its existing `options` argument.
  - `tests/probes/hostiles.mjs` (new, P11).
  - `tests/work-s0.test.mjs` (new).
- **Offline tests.** The provider logs every request kind with the right fields
  and never sends tools; the request kind reaches the provider from all four
  prompter paths.
- **Probe.** P11 (§4).
- **Live acceptance (current code, uncoached).** Two baselines with the existing
  text commands: "get 40 oak planks" and "build a small shelter here". They are
  measurements, not pass/fail; their numbers are the comparison point for S2 and
  S3. Count `unstuck` firings during the shelter baseline (the old P12).
- **Exit.** Baselines and P11 recorded; OQ-17 updated; a sanitized summary added
  to RESEARCH.md §8.
- **Not in S0-lite.** Tools, the task record, any behaviour change, a `!probe`
  command.

#### S2 — Task record, runner, resume, text commands

- **Goal.** The bot keeps its task through interruptions and restarts, and gathers
  and crafts through `obtain` (wood and stone tiers), driven by text commands.
- **SPEC.** REQ-REC-1 … 11 (REQ-REC-8 retired); REQ-RES-1 … 13 and 16 (REQ-RES-8's
  I1 part); REQ-PLAN-1 … 8 (non-build parts); REQ-TRN-13 … 15 (text commands and
  DSL); REQ-OBT-1 … 5, 9, 11; REQ-SAFE-1 … 5, 7, 9, 11; REQ-FIND-15, 16 (I1
  part); REQ-OBS-2.
- **Files.**
  - `src/agent/work/`: `index.js`, `config.js`, `record.js`, `runner.js`,
    `plan.js` (DSL parser, validation, dry run), `commands.js` (`!taskStart`,
    `!taskRevise`, `!taskPause`, `!taskResume`, `!taskCancel`), `steps/obtain.js`,
    `steps/go_to.js`, `steps/give.js`, `resolve.js`, `protect.js` (predicate, tree
    test, persisted ledger, the `Movements.prototype.safeToBreak` patch with the
    forced flags, SIGINT `clean_stop` handler), `view.js`, `report.js`,
    `data/natural_blocks.json`.
  - Carries: `agent.js` (work init with `init_message`), `prompter.js` (task view
    in `$SELF_PROMPT`), `commands/index.js` (register), `history.js`
    (`memory_max_chars`, default 1,000).
  - Carry: `library/skills.js` (`pickupNearbyItems` skips junk-type items within
    3 blocks of a recorded junk drop point; `placeBlock` and `tillAndSow` ask the
    protection check before breaking a block in the way).
  - Profile: summariser wording (no coordinates except build origins until S3,
    no quantities or step progress); examples showing `!taskStart` for gathering
    and crafting, and a fallback to the existing commands when `!taskStart`
    answers "no method". Construction keeps its current examples and
    `!buildStructure` until S3 (review ruling F19, 2026-11-08): S2 ships before
    the shelter, so `blocked_actions` stays the deployment's existing list.
  - `tests/work-record.test.mjs`, `work-runner.test.mjs`, `work-dsl.test.mjs`,
    `work-resolve.test.mjs`, `work-protect.test.mjs`.
- **Offline tests** (fixture bot plus the real ActionManager and modes code):
  - DSL and commands: every grammar rule and every error message of REQ-TRN-15
    (unknown skill and key, missing and repeated keys, unclosed quote, bad numbers
    and positions, a later-iteration source, over 8 steps, over 1,000
    characters); all errors returned together; a `"` inside an argument gives
    Mindcraft's argument-count error; a command written in backticks does not
    run; only the first command in a reply runs; the commands appear in
    `$COMMAND_DOCS`; `!taskStart` from the model and from the owner's forced path
    reach the same `perform`; the stop-epoch checks still stop a model command;
  - parsing on a frozen request sequence: at least 10 independent requests,
    written and frozen before the run in `tests/s2/requests.json` (short gather,
    craft, give and follow requests), each with the expected DSL; the parser and
    validator accept every expected plan (the live parse rate is measured in the
    trials, target ≥ 95 % valid);
  - record: atomic write, unknown version left alone, every lifecycle transition;
  - restart: crash restart resumes with 0 model calls; fresh start loads `paused`;
    a SIGINT stop writes `clean_stop`, re-raises the signal, and the next start
    (even with `init_message 'Agent process restarted.'`) loads `paused`; startup
    clears `clean_stop` after reading it, so stop → start → resume → crash
    resumes the task again as a crash restart;
  - stall rule: `stalled_s` resets on improvement, carries across a simulated
    restart, ignores time with the process down, and blocks at 600 s with the last
    cause (fake clock); constant combat with progress never blocks; a crash loop
    blocks;
  - supersede: a new request while a task is `paused` or `blocked` cancels it as
    `superseded`; while `active` it is refused;
  - anchor: `here` resolves to the owner's position when tracked, else the bot's,
    and is unchanged after inserted `obtain` steps and a restart;
  - one 120 s no-progress deadline for every call, crafting included;
  - resume: a mode interrupt resumes with no AUTO MESSAGE and no model call; an
    interrupted run is resumed by the self-heal timer; a thrown error is caught and
    `resume_func` survives; the no-progress deadline ends the run through
    `requestInterrupt`; a run ends itself at the run bound, checked only between
    actuator calls;
  - resume check: refuses while a hostile within 8 has a clear path (the
    `self_defense` pair), passes once it is gone, never blocks by itself;
  - causes: owner `!stop` → `cancelled`; death → `paused(died)`; a resumable
    replacement → `paused(replaced)`;
  - folded from S4: `!stop` and death in each step type (`obtain`, `go_to`,
    `give`); owner chat during a run: a non-resumable chat action pauses the
    runner and it resumes afterwards; `followPlayer` pauses the task;
  - `!goal` refused while a task is active, from the model and the owner;
    `unstuck` paused in stationary steps;
  - the report is posted after the run, from facts, with no nested `runAction`;
  - `!taskStart` returns falsy and saves history;
  - night: hostile interruptions at night resume like any other; no dig-in exists;
  - resolver: planks from logs, sticks, a wooden pickaxe and a stone pickaxe from
    an empty inventory, using `bot.recipesAll` and `requiresTable`; the first
    recipe the inventory allows; leftovers by mcdata's batch arithmetic; the graph
    recomputed after partial progress gives the right shortfall; an item with no
    method gives "no method for X in this version";
  - protection: a natural tree is collectable, an all-log cabin is not; collection
    never re-selects a protected block; the prototype patch covers a `Movements`
    that was never passed to `setMovements` and the collect plugin's check; while
    a task runs `safeToBreak` uses `dontCreateFlow` and `dontMineUnderFallingBlock`
    true for every block even after `collectBlock` set them false; the tree test
    runs once per position per run (memoized); the bot's own table, recorded in
    the persisted ledger, is collectable after a restart; after any task
    replacement, a still-present `permanent` table or furnace outside any
    blueprint is carried into the new record as a `station` entry and stays
    collectable, while other entries are dropped;
  - junk drop (S2e replaces the two junk keys with the item list, `work.inventory`): below `work.min_free_slots` the bot tosses only `work.junk_items`,
    keeps `work.junk_keep` and anything the task needs, drops before moving to the
    work while facing away from the work position, records the drop point for 5
    minutes, and `pickupNearbyItems` (also as called by `item_collecting`) skips
    junk-type item entities within 3 blocks of it but still picks up other items
    there, and junk again after 5 minutes; a refill re-runs the drop at most
    twice; when the minimum cannot be reached the step blocks with the five
    largest stacks; nothing off the list is ever discarded;
  - `blocked_actions`: construction keeps `!buildStructure` until S3; an existing
    `!setMode` block is kept; `!collectBlocks` and `!craftRecipe` still run;
  - `!newAction` is refused while a task is non-terminal, from the model and the
    owner, by the same wrapper as `!goal`, and runs again once the task ends;
- **Live acceptance (uncoached).**
  1. "get 40 oak planks", started at dusk: at least one mob interruption resumed
     with 0 extra model calls (log), the bot back within 6 blocks of `work_pos`,
     inventory ≥ 40, truthful report. Repeat until at least one mob interruption
     occurs; a run without one does not count. Request count and latency are
     compared with the S0-lite baseline.
  2. Kill the agent process mid-task (`!restart` from the owner channel): the crash
     restart completes the task.
  3. An operator Stop then Start mid-task leaves the task `paused`; so does a
     MindServer UI stop then start (do this only while the owner is connected; §7).
  4. "make me a stone pickaxe" from an empty inventory: the resolver chain
     completes with 1–3 model calls.
- **Metrics.** §2.3; model calls per gather task against the 1–3 target; the
  DSL's live parse rate.
- **Exit.** All four trials pass; the 120 s deadline is confirmed against real
  crafting sync times; OQ-20 has a first reading.
- **Not in S2.** Building, `find`, smelting, underground, places memory, tools.

#### S2b — Model outages, block listing, movement settings

- **Goal.** A model outage no longer costs a goal or misleads the owner: tasks
  keep running, decisions wait, the goal pauses and resumes, and the owner hears
  one notice each way. The model and the owner can list a block type's positions
  without moving. Callers' movement settings survive `goToGoal`. (Design: the
  clear council's recommended design, revision 6, D4 and D5, in the private
  diagnostics folder `clear-council/`; approved DECISIONS 2026-11-11.)
- **SPEC.** REQ-RES-17, 18 (§7.8); REQ-TRN-16; the `goToGoal` configure carry
  (§5.3, `library/skills.js`); the REQ-BLD-15 and REQ-SAFE-3 doc fix (the
  pathfinder's entity check is empty outside a path search, §4.2), already
  applied in SPEC with this plan; S2b checks it against the code. The §14 keys
  `work.model_timeout_s`, `work.model_max_retries`, `work.model_outage_wait_s`
  and `work.model_outage_probe_s`; the §5.3 rows for `prompter.js`, `coder.js`,
  `self_prompter.js`, `history.js`, `agent.js` and `skills.js`.
- **Files.**
  - `src/models/openai_tools.js`: strip `outcome` from the options and set
    `outcome.unreachable` on connection errors, timeouts and 5xx; the client's
    `timeout` and `maxRetries` from configuration.
  - `src/agent/work/config.js`: the four model keys added to the defaults.
  - `src/agent/model_outage.js` (new): outage state and the owner notices.
  - Carries: `models/prompter.js` (the model keys through
    `loadWorkConfig(profile.work)`, called by the prompter itself because it is
    built before `Work`; `outcome` in `requestOptions`, the back-off
    wait in `promptConvo`, the outage signal from `promptCoding`);
    `agent/coder.js` (the outage messages, not counted as "no code block");
    `agent/self_prompter.js` (new carry: `PAUSED` with the `outage` flag, the
    recovery probe, the flag cleared by `start()`, `!stop`, a new goal and a
    manual pause); `agent/history.js` (the flag saved with the self-prompter
    state); `agent/agent.js` (the outage module at init, the catch on
    `respondFunc`'s `handleMessage` call, a loaded flag restarts the probe);
    `library/skills.js` (`goToGoal(bot, goal, configure)`).
  - `src/agent/work/commands.js`: `!blockPositions`, with the complete search the
    S2c marker search reuses.
  - CHANGES.md entries for every new or grown carry (§6), `self_prompter.js`
    being a new one.
- **Offline tests.**
  - provider: `outcome` never reaches the request; `unreachable` is set on a
    connection error, a timeout and a 5xx, and not on a 4xx; the client is built
    with the configured timeout and retries;
  - `promptConvo` (fake clock): back-off from 5 s doubling to 60 s, none of its 3
    tries spent; it stops when a newer message supersedes the turn and gives up
    after `work.model_outage_wait_s` with no reply; "My brain disconnected" is never
    said;
  - coder: "no code was run" only when no execution began in that generation
    session; otherwise "the code ran N times before that", with the count risen
    also for a run that threw and the last execution's output kept; an outage is
    never a "no code block" failure;
  - one owner notice per outage and one on recovery, however many calls fail;
  - self-prompter: an outage pauses the goal (`PAUSED` with the flag), never
    stops it; the probe runs every `work.model_outage_probe_s` after the foreground
    wait; on recovery the same goal epoch resumes, and a goal replaced meanwhile
    does not; an owner `!stop`, a new goal, a manual pause and `start()` (also
    through `!stfu` with a single bot) clear the flag; the flag survives a
    save and load, and a load of `PAUSED` with it restarts the probe;
  - a rejected `handleMessage` from `respondFunc` is caught and logged;
  - an active task keeps running through an outage with no model call;
  - `!blockPositions`: the complete search finds every block of the type within
    range in a fixture where `findBlocks` misses one (the cube trials' 8th
    marker); the bot does not move; at most 10 positions, plus the count and the
    bounds;
  - `goToGoal` applies `configure` to both of its `Movements` instances.
- **Live acceptance.**
  1. Uncoached: the owner marks a box with 8 blocks of one type, as in the cube
     trials, and asks "where are the 8 stripped spruce wood blocks?". Expected:
     one `!blockPositions` call, all 8 positions and the bounds, no movement.
  2. Owner-agreed check (not uncoached, because the owner must take the model
     backend away): `work.model_outage_wait_s` is set to 60 for the trial (a
     profile override, restored afterwards), and with a goal running the backend
     is unreachable for about 3 minutes, so the foreground wait ends, the goal
     enters `PAUSED` with the outage flag and the recovery probe runs. Expected:
     one outage notice and one recovery notice; the goal never stopped; no "My
     brain disconnected"; after recovery the same goal resumes within one probe
     interval.
- **Metrics.** §2.3; model calls and failed requests during the outage; time
  from recovery to the goal's resume.
- **Size.** Not re-estimated in the final design. The council's first estimate
  for D4 and D5 was about 200 production and 200 test lines, before revisions 4
  and 5 added the recovery probe and the saved flag.
- **Exit.** Both checks pass; CHANGES.md is current.
- **Not in S2b.** Output compaction (rejected by the council: it would erase
  coordinate listings; truncation stays), the clear step, the ledger, tidying.

#### S2c — Clearing an area and the bot's own blocks

- **Goal.** The owner can have an area cleared: the box he marks or names is
  stated, cleared top-down by code with no model call per cell, resumed after
  interruptions, and reported truthfully, with one question for what is left.
  The bot records what it places by kind and removes its own reachable scaffold
  after fights, at task end and on `!tidy`, and the trials show how much of its
  own blocks it still leaves behind. (Design: the clear council's revision 6, D1,
  D2, D3 and D6; DECISIONS 2026-11-08, 2026-11-10, 2026-11-11.)
- **SPEC.** §11.9 (REQ-CLR-1 … 9) and §11.10 (REQ-OWN-1 … 11); REQ-REC-12's
  core (its I1 part); REQ-SAFE-2 (kinds); REQ-PLAN-4 (the clear checks);
  REQ-TRN-13, 14 (`!tidy`, `clear`), 15 (the clear errors); REQ-BLD-22 (retired
  by REQ-OWN-1) and the REQ-BLD-21 and 23 amendments; REQ-OBS-4; the S2c keys of
  §14; the `agent.js` and `modes.js` rows of §5.3.
- **First step: probe P13 (done).** The live probe of the pathfinder placement
  tell ran on 2026-11-10 (§4; private diagnostics folder,
  `clear-council/clutter/live-probe/`). Tell A held on all 24 pathfinder
  placements of two runs; false positives were not exercised, because no other
  placement happened. The design therefore keeps the guard test on the
  pathfinder patch (REQ-OWN-6) and the dirt-only fallback if the tell ever
  fails.
- **Build order.** D2 first, including the recording fix for the S2 defect that
  records task-time pathfinder blocks as `air` (ISSUES, cube analysis item 17);
  then `dig.js`; then D1 (the clear step); then D3 (the owner question); then D6
  (tidying).
- **Files.**
  - `src/agent/work/`: `ledger.js` (new: the file, kinds, the placement wrap and
    settlement, retirement, the cap, forgetting old scaffold); `dig.js` (new);
    `tidy.js` (new); `steps/clear.js` (new, registry entry); `index.js` (wrap
    install, the owner's raw-message `!stop` keep and the `respondFunc` wrap,
    `onModeEnd`, forgetting old scaffold at process start, retiring `loose` and
    the station carry); `protect.js` (kind semantics in `isProtected`, the clear
    scope); `plan.js` (the clear DSL and validation); `runner.js` (the owner
    question block, the task-end tidy scheduled from the run's `finally`,
    `tidy_after_mode`); `commands.js` (`!tidy`; `!taskResume` refused while a
    question is open); `config.js` (`work.clear`, `work.ledger_max`,
    `work.tidy`; the one-level merge); `view.js`, `report.js` (the clear report,
    the question in the task view, the tidy line).
  - Carries: `agent/agent.js` (the owner-answer interception, REQ-REC-12);
    `agent/modes.js` (new carry: `should_reprompt` and `onModeEnd`).
  - Profile: an example showing `!taskStart` with a `clear` step.
  - CHANGES.md: the `modes.js` carry with its retirement trigger (upstream
    offers a quiet-action flag and a mode-end event); the grown `agent.js` carry.
- **Offline tests** (fixture bot plus the real ActionManager and modes code):
  - recording: a pathfinder placement (destination in state 1 at call time) is
    recorded as `scaffold` only once the cell shows the expected block, from
    repeated attempts merged into one entry; settling to air, a liquid,
    predicted stone or another block writes nothing; an attempt is dropped on
    chunk unload and world change; a changed held item writes nothing; a
    non-scaffold placement is written at once from `newBlock`, so `!craftRecipe`
    still takes back its table and real stone placed by code is recorded;
    `by` and `dim` come from the attempt; entries match only in their dimension;
  - the guard test: the installed pathfinder writes the predicted stone before
    it calls `bot.placeBlock`;
  - kinds: `scaffold` exempt everywhere; `own` protected outside an active clear
    box whatever its material and exempt inside it; `building` protected after
    its build; `station` exempt; stations migrated from `task.json` once;
  - the ledger file: atomic, throttled write; flush at task changes and SIGINT;
    old scaffold deleted at process start (not at the runner's reload) and on
    chunk unload, owner-kept `own` entries kept; the cap evicts only the oldest
    live `scaffold`; the warning above 10 000; retirement only for loaded cells;
    `removing` exempt during a dig, revived by a same-block update within 3 s,
    deleted after, cleared by an aborted dig;
  - the clear step: both DSL forms; every validation error of REQ-CLR-3,
    including the marker-count error (fewer than 4 markers, or not on three
    axes); the corner test with at least 4 markers on three axes and an inside;
    the complete marker search; the box and cell count stated in the
    confirmation; a `markers=` box starts at once, a `box=` box waits for the
    owner's yes with no dig before it, and an owner no to that `clear_start`
    question cancels the task as `cancelled(owner_declined)` with nothing dug;
    ungranted containers (`work.clear.containers`) and the spawner are never candidates;
    a buried ore inside the box is dug; the kept layer protected for every caller and excluded for the
    clear movements; top-down, nearest-first order, at most 16 digs per unit;
    the move to a cleared cell; the occupancy check; a tool obtained inline;
    done only after a settled second scan; the report from the final scan;
    resume with no model call after a mode interrupt and a crash restart;
  - the owner question: asked for leftovers, for containers, or both; consumed
    before the model; no timeout; `!taskResume` refused while open; a plain yes
    removes the listed blocks but no container; "yes, chests too" removes the
    listed containers through the position-scoped exception while the liquid,
    falling-block and occupancy checks still refuse; a grant resets the failure
    counts; a block changed since the question is not dug; a no keeps them;
  - tidying: every live acceptance item below as a fixture, plus the structure
    under the bot (the hitbox footprint, connectivity over all bot-placed
    entries before any filter, a bridge left whole), pillar-down, top-down with
    no floating block, each pre-dig check, the 32-dig and 60 s bounds, the
    interrupted remainder and its supersession, the task-end launch guards (same
    record, no newer task, unchanged `stop_epoch` and `last_action_time`, idle),
    the mode-end trigger (uninterrupted only, next tick, no stop in flight;
    re-checks while a hostile is near; skipped while `resume_func` is set; the
    in-task `tidy_after_mode` sweep limited to `mode:*` entries and cleared only
    when complete), the owner `!stop` keep from chat, whispers and MindServer
    before any translation, a model `!stop` within 60 s of an owner message
    counted as the owner's, `should_reprompt` false for `action:tidy`,
    `work.tidy.enabled` and `announce` (`announce` retired in S2c-fu; its test
    replaced by the quiet ones). (As built: `tests/work-tidy.test.mjs`,
    with a control test that a fight interrupting any other action still
    prompts the model.)
- **Live acceptance (uncoached unless noted; bot invincible).**
  1. Marker box: the owner marks a box with 8 blocks of one type, as in the cube
     trials, and asks "clear everything inside the 8 stripped spruce wood
     blocks". Expected: one `!taskStart` with a `clear markers=` step; the box
     and cell count stated; cleared top-down with no further model call per
     interruption; the markers stay; the report matches a check with
     `!blockPositions` and the protected-block diff.
  2. Coordinate box: "clear the box from x1 y1 z1 to x2 y2 z2". Expected: the box
     stated, nothing dug before the owner's yes, then cleared.
  3. Leftovers and a chest: the box holds a block the owner placed and a chest.
     Expected: one question listing the block, and the chest on its own line; a
     plain yes removes the block and keeps the chest. Answering the bot's
     question is part of the trial, not coaching.
  4. The tidy items of the design: a fight pillar with no task is removed after
     the fight; a task ending on its own pillar pillars down; a bridge over water
     is recorded, and a scaffold next to water is left and reported; an owner
     `!stop` mid-sweep keeps the rest (protected afterwards); after a restart,
     old scaffold is not tidied; `!tidy` works and is refused during a task; a
     bridge the bot stands on is left whole; `!craftRecipe` still takes back its
     table; a fight during `!followPlayer` resumes following before any tidy.
     Items that need a setup (water, a restart, a stop at the right moment) are
     owner-agreed checks.
- **Own-blocks count (the owner's acceptance demand, DECISIONS 2026-11-11).**
  The lean version must be shown to work. Every S2c trial counts the bot's own
  blocks left behind, and so do a travel trial (the owner leads the bot across
  terrain that makes it pillar and bridge, for example "follow me" over a gap and
  up a cliff) and a night fight trial.
  - Method: the placement attempts, sweep results and ledger changes (forget,
    unload delete, eviction, retirement, owner keep) in the bot log (REQ-OBS-4),
    each logged cell read after the trial, plus the protected-block diff within
    16 of each site before and after (§2.2), which also catches non-natural
    blocks the bot placed that the record missed. For the travel and fight
    trials the site is every logged attempt position, plus the route the owner
    led.
  - Known blind spot: a dirt placement the record never saw is not counted;
    the non-natural diff cannot see dirt.
  - Each block left is counted with its reason: out of reach (including a
    pillar taller than reach), travel bridge or pillar left behind, from before a
    restart or an unloaded chunk, skipped for liquid, under a falling block,
    a hostile ended the sweep, a sweep bound, kept by an owner stop, part of the
    structure under the bot, evicted by the cap, or never recorded.
  - The counts per trial and in total, with reasons, go to the owner with the
    trial report. They set the priority of the complete-scaffold slice (§8): if
    many are left, it moves up; the owner judges what is many.
- **Metrics.** §2.3; the own-blocks count above; per clear: cells left by
  reason, model calls (target: the plan call plus 0–1), interruptions resumed
  with 0 calls; per sweep: removed and left.
- **Size.** About 1,500–2,500 changed lines with tests for the clearing work
  (the council's calibration against S2), plus about 450–650 production and
  500–700 test lines for tidying (D6). Whether the first figure includes S2b's
  share was not stated.
- **Exit.** All trials pass; the own-blocks count is reported to the owner and
  his ruling on the later slice's priority recorded in DECISIONS; CHANGES.md is
  current.
- **Not in S2c.** A walking idle sweep, scaffold out of reach and travel bridges
  (the later slice, §8); levelling; the builder's use of `dig.js` and the ledger
  (S3); water from `self_preservation` and torches (SPEC §16).

#### S2c-fu — Quiet chat and remembered scaffold

- **Goal.** The S2c trials' follow-ups (DECISIONS 2026-11-11 "After the S2c live
  trials", 2026-11-12 "Quiet chat and remembered scaffold"): in quiet, the
  default, she speaks only when the owner speaks to her, when she needs an
  answer, when something fails, is stuck a second time or kills her, before
  clearing a marked box, with one short line for a task he asked for, at a
  goal's end and in answer to a command he typed; `work.chat: "debug"` brings
  back today's output. Her scaffold records survive restarts, crashes and
  unloads, kept per world, and an old block is hers to remove only while
  nothing non-natural she did not place touches its pillar or bridge. (Design:
  `runtime/diagnostics/i1-build/quiet-council/recommended-design.md` r4, from a
  council with a Sol review and two adversary waves.)
- **SPEC.** §15.1 (REQ-CHAT-1, 2); §11.10 REQ-OWN-1 (file version 2, worlds),
  REQ-OWN-4 (kept records, the gap mark, the component guard), REQ-OWN-5 (cap
  per world, eviction after load, hygiene, durability), REQ-OWN-8 and 10 (the
  tidy line and `!tidy`'s answer); §6.2 (`notify_done`, `blocks_by_step`); the
  `work.chat` row of §14 and `work.tidy.announce` retired; the `agent.js`,
  `self_prompter.js` and `utils/mcdata.js` rows of §5.3; §16.
- **Files.**
  - `src/agent/work/`: `chat.js` (new: `chatMode`, `chatShown`, the turn's
    category); `index.js` (the turn's voice in `guardTurns`, `turnVoice`,
    `ownerTurn`, the owner's answer pending, the blocked-report mark,
    `deliver`'s categories, the done
    line and `notify_done`, `blocks_by_step` and the second-block alert, the
    death alert, the box statement apart, the gap mark and hygiene at init);
    `ledger.js` (file version 2 and the v1 fold, `worldId`, kept scaffold with
    `gap_at`, hygiene on chunk load, the exit flush, eviction after load,
    `scaffoldEligible`); `protect.js` (the component guard, `protectorFor`);
    `tidy.js` (eligibility in every choice, the line as `detail`, `!tidy`'s
    answer); `commands.js` (the task line by the turn, the statement as an
    alert); `report.js` (the done, blocked-again and death lines; the tidy
    line's singular); `record.js` (the two optional fields); `config.js`
    (`work.chat`; `tidy.announce` retired).
  - Carries: `agent/agent.js` (the chat gate and the quiet branch),
    `agent/self_prompter.js` (one category), `utils/mcdata.js` (the hashed
    seed); `agent/model_outage.js` (our own file) tags its two notices;
    `patches/mineflayer-pathfinder+2.4.5.patch` (amendment 1: the tower
    placement waits until her feet clear the cell).
  - Profile (private, not in the repo): the `conversing` sentence and the
    examples without narration before commands (design §3); the proposal is a
    full file beside the build report, for the owner to apply.
  - CHANGES.md: the three carries and the pathfinder patch hunk.
- **Offline tests.** `tests/work-chat.test.mjs` (new) drives the real
  `openChat`/`routeResponse`, capturing `bot.whisper`, with
  `prompter.work_config` set and `show_command_syntax: "full"`: the switch and
  its unknown value; quiet and debug owner turns with a query then an answer;
  her own turns dropped, a no-command reply and the `!endGoal` text shown; a
  blocked-report turn shown (the relay and its task receipt) and the
  second-block alert once; every raw task command answered, the echo not; the
  marker statement alone; a dropped line does not disarm a question; the done
  line only for owner tasks (also after an owner's resume, and for a record
  without the field); the death line; `cleanKill` silent in quiet; the turn's
  voice. The fixture default is `work.chat: 'debug'`, so the older suites keep
  testing today's output. `work-ledger.test.mjs`: the world id; the v1 fold;
  worlds kept apart and the cap per world after load; an unknown world;
  restart keeps entries with `gap_at`, an unload keeps and marks; hygiene at
  start and on chunk load; the exit flush after a successful dig; the
  component guard (a foreign neighbour on one member lapses the whole
  component; air, natural terrain, a natural tree and same-session scaffold
  keep it; an `own`, `building` or `station` neighbour, a log build, an
  unloaded neighbour lapse it; a clear box makes it hers; 64 members free, 65
  lapsed; the memo, also dropped by a column load or unload; planks on a tree
  lapse it inside a run). `work-tidy.test.mjs`: after a restart
  old scaffold is tidied while it stands free, a lapsed pillar, an own
  neighbour's and a lapsed dirt block are not, nor one that lapses during the
  sweep; the line in quiet goes to history only; the owner's raw `!tidy` and
  the model's in his turn answered, hers in her own turn returns nothing.
  Fix wave 1 also pins in `work-chat.test.mjs`: the outage notices and a task
  failure shown; a raw query's result shown; the second-block alert at
  exactly the second block; the block count kept by a reordered revision; a
  clear's whole done report; an owner's revision sets `notify_done`; a task
  started in a blocked-report turn inherits it; the owner's answer pending.
- **Live acceptance (the test card; bot invincible).**
  1. Restart her with a pillar recorded: the log shows
     `[ledger] kept N scaffold entries from before`, and a `!tidy` within reach
     removes the pillar when nothing of his touches it.
  2. A night of fights: count her chat lines (target: only the categories
     above; no tidy lines, no narration, no "Restarting.").
  3. A `markers=` clear she starts: the box statement is still shown.
  4. A raw `!tidy` from the owner is answered with its line, and so is "tidy
     up your blocks" in words (the model's `!tidy`, then her answer).
  5. A death: one line "I died at x, y, z; …".
  6. Pit escape (amendment 1; the pathfinder carry places a tower block only
     once her feet clear the cell, and resets a tower she cannot clear: at
     once when she stands in its reference cell, else after 3.5 s,
     CHANGES.md): in a 1-wide, 4-deep pit she towers out, and every tower
     block is recorded on its first attempt; no jump in place lasts longer
     than about 4 s. Already measured live in the probe's confirm
     round, before the futility reset (private
     `i1-build/s2cfu-review/pit-probe-report.md`): 5/5 one-block towers and a
     4-block tower clean, each block recorded on the first attempt. Stopping
     on her tower inside the pit at a `GoalNear` of range 2–3 is a SPEC §16
     residual, not part of this trial.
  7. While a `!goal` runs, ask her a question she answers with a query (for
     example "what do you have?"): her answer is shown in her next turn.
  - Note for the card: if the unstuck mode fails, she restarts with no word
    in quiet ("Restarting." is `detail`); the log shows it.
- **Metrics.** §2.3; chat lines per hour by category (from the `[chat]` log
  lines and the whispers), and the own-blocks count of S2c with the
  "from before a restart or an unloaded chunk" reason split into tidied,
  lapsed and out of reach.
- **Exit.** All trials pass; the profile change is applied by the owner; CHANGES.md is
  current.
- **Not in S2c-fu.** The pit-escape residuals (the `GoalNear` range met inside
  a pit, the refusal of unknown cause; SPEC §16); sleeping (S2d), inventory
  upkeep (S2e), the walking tidy (§8); per-world task records, structures and
  memory (SPEC §16).

#### S2d — Sleeping through the night

- **Goal.** She sleeps every night by default, also mid-task, mid-goal and while
  following: she places a bed from her inventory near her, sleeps (on the
  owner's server one sleeper skips the night) and picks the bed straight back
  up; the task, a follow or a goal goes on as after a fight, with no model call
  for the sleep and no stall time. Chat stays quiet unless something needs him
  (a bed left, lost or kept by a full bag; once per session a night that did
  not skip). (Owner rulings: DECISIONS 2026-11-11 "Sleeping through the night
  (slice S2d)", 2026-11-12. Design:
  `runtime/diagnostics/i1-build/sleep-council/recommended-design.md` r3 with its
  §14, amended by `junk-council/recommended-design.md` r7 §5: the 2-free-slot
  pickup launch and the resume-timeout carry. P14 passed, §4.)
- **SPEC.** §7.9 (REQ-SLP-1 … 10, new); §7.5 (the sleep and pickup rows,
  REQ-RES-13), REQ-RES-16 (the sleep hold), §7.6 (sleep beside the night
  policy), §7.7; §4.1 (the Sleep row), §4.2 (the resume timeout); §11.10
  REQ-OWN-2 (the sleep routine's bed); §15.1 (the owner lines); §14
  (`work.sleep.when`, the merge, the constants); §5.2, §5.3 (`modes.js`,
  `action_manager.js`); §16.
- **Files.**
  - `src/agent/work/`: `sleep.js` (new: `Sleeper`, `SLEEP`); `index.js` (the
    sleeper, `lastStart` from the `runAction` wrap, `isQuietAction`, the stall
    hold, the two classifiers, the reconcile in `tick`, the view's line);
    `protect.js` (`withOwnBed` and the own-bed exemption); `dig.js` (`ownBed`
    through both protection checks); `ledger.js` (the context kind of
    `mode:sleeping`); `report.js` (`bedLine`); `view.js` (the sleeping line);
    `config.js` (`work.sleep`, merged one level deep); `tidy.js` (exports
    `fullCube`).
  - Carries: `agent/modes.js` (the `sleeping` entry, `isQuietAction`),
    `agent/action_manager.js` (the resume timeout).
  - CHANGES.md: the two carries, our new file; ISSUES.md: the upstream
    `!goToBed` `!stop` defect.
- **Offline tests.** `tests/work-sleep.test.mjs` (new; a `bedServer` fixture
  with placement, sleep, wake, dig and drop hooks): the resume-timeout carry;
  the config merge; `next()`'s conditions and what sleep may cut under
  `always` and `idle`; the spot grid; an idle night end to end; the flush
  before sleeping; a night that does not skip; failed tries, a refused
  placement and sleep, a bed facing elsewhere; reuse after a restart, and a
  reused bed that no longer validates; a walk that does not arrive; the
  guarded wake (also unconfirmed, and once per routine under `!stop`); `!stop`
  in bed; the night marks with the task, runner and `action:bed` exclusions;
  a task at dusk and the self-heal restart; mid-obtain at dusk (9-minute hold,
  `last_cause` kept, 0 calls, the hold released and charging again); a fight
  that cuts the sleep (no AUTO MESSAGE; a mode cut, not a try, with its own
  cap); following at dusk (resumes with −1); the task view; the day pickup
  cutting a task (its hold released too); no pickup while the bed is wanted,
  and the pickup's re-validation when it starts; the 2-free-slot check before
  the launch, and the routine's pickup with a full bag (the bed's own slot);
  the refusals (on either half) and receipts; my bed's protection. Fix wave 1
  (review r1): a receipt collected at night before any sleep; a bed broken by
  someone else (and one changed before a restart) told lost; an unloaded bed
  beyond 16 told; the final veto before the dig packet; alerts per obligation;
  a late-answered placement adopted; an unreachable bed kept, told once and
  retried; every walk no-dig and bounded. Fix wave 2 (review r2): the late bed
  (arriving after the throw) adopted only with her bed item gone from the bag,
  never after an equip error, a bed she did not place, or a later arrival
  than the watch; the cells re-checked after the equip; the 2-slot gate for a
  receipt and a no-room collection that keeps it; the full line per slot
  count; an unreachable bed's retries never cutting a running task, and a try
  at night. `work-runner.test.mjs`: the night check (no night policy key,
  `sleep` the only night key, nothing placed or dug with no bed).
- **Live acceptance (the test card; bot invincible; uncoached, request log
  on; a bed in her inventory).** The design §10 trials:
  1. Idle at dusk: she places the bed beside her, sleeps, the night skips, she
     picks the bed back up; nothing else changed.
  2. Mid-`obtain` at dusk: the same step resumes after the night, `stalled_s`
     not grown, 0 model calls for the sleep.
  3. Following the owner at dusk: she sleeps and follows again, and a follow
     cut by a fight or by sleep still follows more than 10 minutes later.
  4. An active goal at dusk: she sleeps at the goal's next action; its
     restarted turn is counted separately.
  5. `!stop` in bed: she gets up at once (no crash restart), and takes the bed
     back when idle.
  6. Owner "follow me" at night after waking: she follows; the night is done.
  7. Crash in bed: the bed is reused by night or picked up by day.
  8. No bed: as today.
  9. A clear task at dusk: the bed goes outside the box.
  10. (Review r1) A full bag (36/36, as in P14) at dusk: she still sleeps and
      takes the bed back. A night with phantoms: fights cut the sleep, she lies
      down in the same bed again, and the night ends only after
      `work.sleep.max_mode_cuts` (6) cuts.
  - Pass: 0 sleep decision calls (a goal's restarted turn counted apart), the
    bed back in her inventory, no other block changed, no owner line unless
    something went wrong.
- **Metrics.** §2.3; sleeps per night, failed tries, mode cuts and their
  reasons (the `[sleep]` console lines), the bed pickups (routine or `action:bed`) and owner
  lines.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in S2d.** Making a bed, beds already in the world (upstream `!goToBed`),
  fetching a bed left far away, daytime thunderstorms, restoring the respawn
  point (design §12); inventory upkeep (S2e); the chest.

#### S2e — Inventory upkeep

- **Goal.** One item list in her config says per item how many she keeps: 0
  (junk: she drops all), a number, one stack, or all; anything not listed she
  keeps. When she is idle or following the owner and has fewer than 4 free
  slots, she drops the surplus by herself, with no model call and no chat, in
  a spot she won't walk over at once; tasks use the same list. Chat stays
  quiet unless he must act (a bad list, the pass cap, a bag full of things she
  keeps). (Owner ruling: DECISIONS 2026-11-11 "Inventory upkeep (slice S2e,
  after S2d)". Design: `runtime/diagnostics/i1-build/junk-council/recommended-design.md`
  r7 §1–§6 and §8–§10, the owner's answers in §11; part B, §7, parked until
  his word after S2e's trials. Order: built first, P15 before the deploy, the
  owner's ruling of 2026-11-12; P15 done, §4.)
- **SPEC.** §9.4 REQ-OBT-11 (rewritten: the list, the planner and dropper, the
  guard, the look fix, the idle cleanup, `!itemList`); REQ-SAFE-7; §14
  (`work.inventory.items`, `work.inventory.idle`, the `INVENTORY` constants;
  `work.junk_items`, `work.junk_keep` retired); §5.2 (`work/inventory.js`),
  §5.3 (the `skills.js` guard carry, the runtime wraps); §7.9 REQ-SLP-2 (sleep
  cuts `action:items`); §15.1 (the three `alert` lines); §16.
- **Files.**
  - `src/agent/work/`: `inventory.js` (new: `planRemoval`, `dropItems`,
    `isGuardedJunk`, `largestStacks`, `Upkeep`, `INVENTORY`); `config.js`
    (`work.inventory` and `mergeInventory`; the junk keys gone); `runner.js`
    (`ensureFreeSlots` calls the shared planner and dropper); `resolve.js`
    (the junk drop and guard moved out); `index.js` (`Work.items`, the turn
    count and the turn's action, the owner-message generation, the `!stop`
    hold, `isQuietAction`, `Work.tick`); `sleep.js` (sleep may cut
    `action:items`; the bed reconcile waits for its latch); `report.js`
    (`itemLine`); `commands.js` (`!itemList`).
  - Carry: `library/skills.js` (the `pickupNearbyItems` guard now reads
    `work/inventory.js`: per name and dimension).
  - CHANGES.md: the carry change, our new file; ISSUES.md: G1 closed.
- **Offline tests.** `tests/work-inventory.test.mjs` (new): the merge by name,
  `"all"` over a default, fresh maps; structure and entry validation (fail
  safe: tasks block, idle does nothing, told once); the registry check; every
  default in the registry; the planner table (tier-0 first, smallest first,
  the partial remainder not counted, the held slot, needed, unlisted and
  `"all"` items); the per-toss slot re-check; the facing (free = no collision
  box and not a liquid; none free: `unavailable`); the look, the 2-tick wait,
  then the toss, and an interruption in the wait; the guard per name, landing
  spot, dimension, 32 points; a throwing toss as `failed`; an idle pass
  standing still with no call and no chat; the admission table (each
  condition); the turn count; the resume gap and the dead-follow exception;
  an owner-typed follow cut by a pass and resumed with −1; the follow
  admission's exclusions; currency (stop and owner message, pending and
  between tosses); the holds (cooldown, nothing removed, `!stop`, the cap and
  its one line); quiet when a fight cuts a pass, and sleep's cut rule; a
  throw inside the pass (latch released, resume kept); the kept-items note;
  `!itemList`; in-task parity with the old defaults. `work-sleep.test.mjs`: a
  full bag of junk by day (the cleanup first, then the bed pickup); the S2d
  full-bag tests now fill with kept items. `work-resolve.test.mjs`: the in-task
  drop's level look and landing spot, the guard per name.
  `work-clear.test.mjs`: the junk keys are ignored. Review round 1 (the
  `R1-` tests): the cursor and an open container refuse the click; the live
  selected slot; the empty-plan memory's key and expiry; a hostile or a
  turn ending the pass; prototype names; floors lower than a full block; no
  launch or cut without a free direction; never toward a follow's target; a
  task's drop not toward the owner; the owner radius, the follow re-read, the
  work check between tosses, no hold after an interruption, and an
  interrupted in-task drop returning to its step.
- **Probe P15** (§4): done 2026-11-12, before the deploy; it kept the
  `INVENTORY` values.
- **Live acceptance (the test card; bot invincible; uncoached, request log
  on).** The design §8 trials:
  1. The owner's case: fill her bag, leave her idle: within seconds she drops
     the surplus (nothing he keeps), with no chat; a placed bed by day is then
     picked up.
  2. A night ending: cleanup at the first quiet moment after the bed.
  3. Following him with a full bag: she drops behind her, follows again within
     a second or two, and still follows more than 10 minutes later.
  4. A task with a full bag: the drop before the step, the task goes on.
  5. Walk her across a fresh pile (a residual) and the hold after repeated
     passes (4 in 10 minutes, one line).
  - Pass: 0 model calls for the cleanup, nothing off the list dropped, no
    owner line unless one of the three applies.
- **Metrics.** §2.3; passes and what they dropped (the `[items]` console
  lines), re-pickups seen, holds and owner lines.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in S2e.** The chest (part B, design §7); a manual `!cleanItems`;
  walking to a pile; any change to the clear step beyond the shared dropper.

#### S2e-fu — Inventory upkeep follow-up

- **Goal.** The S2e trials' findings F2–F5 fixed as the owner ruled: junk in
  her hand is junk (she switches her hand off it); from a pit one deep she
  throws over the lip, from a deeper one she walks to the nearest open spot
  within a few blocks; a bag full of kept items is reported as such and the
  model tells the owner instead of picking kept items to discard; the list
  keeps the best bow and crossbow (every other one goes) and one slot of the
  best of banners and of ominous bottles (a new list value, `"slot"`). (Owner rulings: DECISIONS 2026-11-12 "After the S2e
  live trials (follow-up slice S2e-fu)", "One slot of the best". Design:
  `runtime/diagnostics/i1-build/s2efu/design.md` §1–§5; probe P16,
  `runtime/diagnostics/i1-build/s2efu/p16-live-20261112.md`: the throw over a
  one-block lip and her weapons' item data.)
- **SPEC.** §9.4 REQ-OBT-11 (the held slot, the lip, the walk, the kept
  report, the best-kept order, the new defaults, the hold's reason);
  REQ-SAFE-7; §5.2 (`work/inventory.js`); §14 (`work.inventory.items`, the new
  `INVENTORY` constants); §16.
- **Files.** `src/agent/work/inventory.js` (`planRemoval` takes the held slot
  and orders by worth; `chooseFacing` with the lip and a `from` position;
  `findDropSpot`; `dropItems`' `walk` and hand-off; `largestItems` replaces
  `largestStacks`; `Upkeep`'s admission, hold reason and walk flag);
  `runner.js` (`ensureFreeSlots`: `walk: 'task'`, the kept report);
  `report.js` (`INVENTORY_FULL`, `isInventoryFull`: the blocked report's ask);
  `sleep.js` (`NO_DIG` exported for the idle walk); `config.js` (the new
  defaults).
- **Offline tests.** `tests/work-inventory.test.mjs`: the held slot as a
  source and the hand-off (empty slot first, then an unplanned one, the skip
  case); the lip (one deep open, a fence and a wall blocked, two deep
  blocked, the rows above unchanged); `findDropSpot` (nearest first, never
  toward a follow target, standability, the vertical range and the radius);
  the walk's movements per caller (a task may tower and scaffold, idle places
  nothing), bound, failure and currency; the idle admission with no
  direction (a spot admits and the pass walks, a walk that fails or no spot
  holds with its reason, never while following); `largestItems`; the best-kept order (worn
  against fresh, enchanted against plain, an unreadable list); the new
  defaults. `tests/work-resolve.test.mjs`: the kept and inventory-full
  reasons (facts only), the bad-list reason, and the blocked report's line
  for the model, the walk out of a two-deep pit in a task, and the
  block with the drop's reason when there is no spot. Review round 1 (the
  `S2e-fu r1` tests): the re-plan after a walk (in the dropper, the idle
  pass and a task), the walk's goal cleared after a rejected `goto`, no drop
  off the spot, a lip only from distance 1, no door opened by either walk.
- **Live acceptance** (design §6; bot invincible, uncoached):
  1. Junk in hand: with a junk item selected and the bag below 4 free slots,
     the pass drops it (she switches hand).
  2. A one-deep pit: `!collectBlocks dirt` until she stands in a pit with
     surplus; the drop goes over the lip.
  3. A two-deep pit, in a task: she walks (towering if needed) to the nearest
     open spot and drops there. Idle in a two-deep pit she places no blocks,
     so she holds with "no free direction nearby" (DECISIONS 2026-11-12 "Idle
     in a deeper pit").
  4. A task with a bag full of kept items: the blocked report names them as
     kept, the model tells the owner the bag is full of things she keeps or
     needs for the task and does not discard.
  5. The list: of her 5 bows and 4 crossbows she keeps the least-worn bow
     (164/384 used) and crossbow (330/465), when a pass runs.
  6. One slot of the best: ominous bottles of different strengths in three
     slots keep only the strongest slot; two stacks of one banner colour keep
     the larger.
  - Pass: 0 model calls for the cleanup, nothing off the list dropped.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in S2e-fu.** The chest (part B, parked); adding items to the list
  from chat; any refusal of `!discard`.

#### Gear — the best gear, one stack, spares go

- **Goal.** She uses the best gear she holds by the item's own values (the
  owner's copies: his unbreakable axe, the pickaxe copy without Silk Touch,
  his leather armour): weapons and armour unbreakable first, tools by
  capability first, the silk rule kept, picked-up armour never replacing his;
  of each gear kind only the best stays and the spares go; every stackable
  keeps at most one stack; up to 2 surplus slots wait and the third sends all
  surplus; a finished task's goods stay 30 minutes; asked for an item she
  gives the one she has, spares first. (Owner rulings: DECISIONS 2026-11-12
  (night) "The owner's gear and a one-stack cap", 2026-11-13 "The gear
  slice". Design: `runtime/diagnostics/i1-build/gear/recommended-design.md`
  r5; probe P17.)
- **SPEC.** §9.5 REQ-GEAR-1 (new); §9.4 REQ-OBT-11 (the cap, gear, the
  surplus allowance, a finished task's goods, giving, `!itemList`); §5.2
  (`work/gear.js`, `work/inventory.js`); §5.3 (`utils/mcdata.js`,
  `library/skills.js`, the plugin's member replacements); §14 (four
  `work.inventory` keys, the constants); §16.
- **Files.** New `src/agent/work/gear.js` (readers, ranking, using, the
  plugin `install`). `src/utils/mcdata.js` (plugin order: pathfinder, pvp,
  tool, collectblock, autoEat, gear; no armor-manager);
  `src/agent/library/skills.js` (weapon equip, `collectBlock`'s intent, silk
  refusal and harvest binding, the harvest checks, `giveToPlayer`'s exact
  slots); `work/inventory.js` (the cap, gear spares, signatures, `due`, the
  `!itemList` lines; `busy` moves to gear); `work/config.js` (the four keys);
  `work/index.js` (`done_at`, `neededItems`); `work/resolve.js`
  (`ownHarvester`); `work/dig.js` (`gear.canHarvest`); `work/commands.js`
  (the `!itemList` description). `package.json` and the lock:
  `mineflayer-tool` a direct dependency at 1.2.0, `mineflayer-armor-manager`
  removed.
- **Offline tests.** New `tests/work-gear.test.mjs` (the owner's items read as
  P17 logged them; the vanilla table and the attribute rules; tags, the
  bridge, reach, dig ticks; `interval`; the ranking per kind; the block
  chooser with the four silk cases and the bare-hand rule; `collectBlock`'s
  binding and refusal; the install order and the missing-member error; the
  swing timer; the armour controller and its guards; the signature;
  giving). `tests/work-inventory.test.mjs` (`"best"` on her bag drops exactly
  the diamond pickaxe, axe and sword, `"all"` nothing; needed, listed and
  unreadable protected; the cap; config validation; the signature skip;
  `due`, the allowance, the re-plan, the kept tell; the Upkeep signature;
  the done-task window; `!itemList`). `tests/work-resolve.test.mjs` (the
  resolver with the copy on obsidian and a component-granted pickaxe on iron
  ore).
- **Live acceptance** (design §7; bot invincible, uncoached; the private
  profile sets `gear: "best"`, `cap: "stack"`, `surplus_slots: 2` and drops
  its interim `"stack"` entries):
  1. A fight: she wields his axe and swings about every 11 ticks; 0 model
     calls.
  2. Armour thrown to her stays in the bag (his pieces stay worn) and goes as
     a spare.
  3. `!collectBlocks stone` with the copy gives cobblestone.
  4. Obsidian with the copy: she mines it and it drops.
  5. Spares and over-cap stacks drop at the surplus setting (a third surplus
     slot) and below 4 free slots.
  6. `!itemList` shows the rules, the best per kind and why, the spares and
     the surplus count.
  7. A finished task's goods stay (two stacks of logs asked for are not cut
     to one within 30 minutes).
  - Pass: 0 model calls for equipping and cleanup; nothing of his replaced or
    dropped; nothing off the list dropped.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in the gear slice** (design §9): Smite and Bane, situational picks
  (Fire Aspect, Looting, Fortune), Protection's exact formula, elytra, bows'
  unbreakable priority, server tags, chest storage (part B).

#### Ownblocks — a truthful collect count, his blocks on request

- **Goal.** `!collectBlocks` counts only blocks that are really gone, never
  retries a block that failed, always ends with one summary line and says when
  protected blocks of the type stand near; his blocks are mined only on his
  word, through `!collectPlaced(type, num)`: typed by him it mines at once; run
  by the model in his turn, code asks him one yes/no question naming the exact
  cells, and after his yes the result goes back to the model once. (Owner
  rulings: DECISIONS 2026-11-13 "His blocks on request [...]" and "Both designs
  answered": yes to all four questions. Design:
  `runtime/diagnostics/i1-build/ownblocks/recommended-design.md` r4.)
- **SPEC.** §13 REQ-SAFE-12, REQ-SAFE-13 (new); §4.1 (the gather row); §5.3
  (`library/skills.js`, `commands/actions.js`); §12.0 REQ-TRN-13 and OQ-20 (the
  command list); §15.1 (the categories); §14 (`work.collect.placed_radius`,
  `work.collect.question_s`, the constants); §16.
- **Files.** `src/agent/library/skills.js` (`collectBlocksOf`: the filter, the
  attempt and its count, the reasons, the protected count, the summary;
  `collectGrantedCells`); `src/agent/commands/actions.js` (`!collectPlaced`);
  `work/protect.js` (`grantable`, the grant, `withGrant`, the config getter);
  `work/index.js` (the raw marker, `rawOwnerCommand`, `collectPlaced`, the
  mining question, its answer and lapse, the grant run and its hand-back, the
  `!stop` wrap); `work/config.js` (`work.collect`, its checks);
  `work/steps/obtain.js` (the summary reading).
- **Offline tests.** New `tests/work-collect.test.mjs` (the defect reproduced;
  the palette pass; tried cells; reasons; interrupts; early exits; the G/K
  split; the radius key; both command forms; obtain's block and why; the typed
  grant; the question, yes and its one hand-back, no, lapses, disarms, a
  non-owner and a model yes; refusals outside his voice; the hand-back's drop;
  the grant's authority). The work fixture's findBlocks makes the palette pass
  and its collect skips what the plugin skips. `tests/work-gear.test.mjs` (the
  refusals as summary reasons).
- **Live acceptance** (design §6; his obsidian blocks):
  1. Typed `!collectPlaced("obsidian", 1)`: 1 dug, 0 model calls.
  2. "Mine two of the obsidian I placed": 1 model call, the question; "yes":
     2 dug, then 1 model call for the result.
  3. The same answered "no": nothing dug.
  4. "Get me 2 obsidian" without naming his blocks: the protected report; no
     block dug without his yes; at most one question (the model may follow the
     report with `!collectPlaced` in his turn, design §9).
  - Pass: nothing of his dug without his word; she never blames the tool.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in the ownblocks slice** (design §9): the residuals in SPEC §16.

#### Combat — engage on aggro, stay near where it started

- **Goal.** A skeleton (stray, bogged, parched) that aggroes within 16 is
  engaged before or at its first arrow if there is a path or she can make one
  easily (no placing, at most 3 digs, no long detour); every fight stays on a
  16-block leash around where the first fight began and walks back there
  before the task or idle resumes; when the fight cut a follow, the leash is
  centred on him and the follow resumes instead of the walk back; while he
  travels she passes the mobs. (Owner rulings: DECISIONS 2026-11-13 "Combat
  starts late against skeletons", "Combat stays near where it started", "Both
  designs answered", "Following him on the move". Design:
  `runtime/diagnostics/i1-build/combat/recommended-design.md` r10; probe P18.)
- **SPEC.** §7.10 REQ-CMB-1 … 9 (new); §7.3 REQ-RES-8 (amended: the check is
  the mode's own pick); §5.2 (`work/combat.js`); §5.3 (`modes.js`,
  `library/world.js`); §14 (six `work.combat` keys); §16.
- **Files.** New `src/agent/work/combat.js`. `src/agent/modes.js` (the
  `self_defense` carry); `src/agent/library/world.js` (`isClearPath`);
  `work/index.js` (`Combat` built in `init`, `followTarget` moved here from
  the item cleanup); `work/inventory.js`
  (`FOLLOW_LABEL` exported; the lookup calls `Work.followTarget`);
  `work/runner.js` (the resume check through `threat()`, `HOSTILE_RADIUS`
  gone); `work/config.js` (`work.combat`, merged one level).
- **Offline tests.** New `tests/work-combat.test.mjs` (P18's metadata and
  damage shapes: the registry index, the bit, the hit memory; melee first; one
  search per update and the cache; the easy path on the real pathfinder; the
  `isClearPath` carry, both reproductions failing on the old code; the fight
  on the real pvp plugin: forceStop, the pending attack, `!stop`, give-up,
  the dig count, the chase; the leash and its centre; the anchor's clears; the
  walk back and its bounds, in a task; following and the follow skip; the
  `stop_epoch` race; travelling: the window, unknown speeds, the two
  thresholds, flip-flop, `travel_speed` 0). `tests/work-runner.test.mjs`
  (the resume check through `threat()` and `isOn`). The work fixture gains
  `pvp.forceStop`, `pathfinder.getPathFromTo` and `pathfinder.isMining`.
- **Live acceptance** (design §9; night, invincible, where the owner put her;
  the private profile sets `work.combat.ranged` to the four skeletons and
  `travel_speed` 2):
  1. Skeletons aggro at 10–16: `engage` within about 0.4 s of the bit when
     idle; about 1 s, at or before the first arrow, when the fight cuts an
     action (the stop wait); at most 1 hit from one skeleton before engaging.
  2. She stays within 16 of the anchor and walks back.
  3. A skeleton on a ledge she cannot reach easily: one `no easy path` line
     and no loop.
  4. In a task, the task resumes after the walk back.
  5. Following the owner on a night walk (his trial): she passes the mobs
     while he moves and fights near him once he stops; never more than 16
     from him after a fight.
  - Pass: combat-caused model calls counted (0 expected when idle or in a
    task).
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in the combat slice** (design §11): hiding, bows, blazes and other
  nether shooters, shields, pillagers; `goToPlayer`'s pause (the owner's
  open question).

#### Travel — walks that survive fights and caves

- **Goal.** A walk (`!goToCoordinates`, `!goToPlayer`, `!searchForBlock`)
  cut by a fight or `unstuck` is restarted by the code with no model call
  and no AUTO MESSAGE; stuck in a low cave she climbs out once and walks on,
  else tells him and stops; a planning timeout is retried once; a task that
  digs down with a full bag climbs out to drop; his "no" to a mining
  question gets a fixed reply. (Owner rulings: DECISIONS 2026-11-13
  (evening) "Travel after the live trials". Design:
  `runtime/diagnostics/i1-build/travel/recommended-design.md` r4.)
- **SPEC.** §7.11 REQ-TRV-1 … 6 (new); §7.7; §7.10 REQ-CMB-8 (the AUTO
  MESSAGE note); §9.4 REQ-OBT-11 (amended by REQ-TRV-6); §5.2
  (`work/travel.js`, `work/climb.js`); §5.3 (`modes.js`, `skills.js`); §14
  (`work.travel.resume_max`); §15.1; §16.
- **Files.** New `src/agent/work/travel.js`, `src/agent/work/climb.js`.
  `src/agent/library/skills.js` (`goToGoal` retry, `moveAway`, `goToPlayer`,
  `giveToPlayer`); `src/agent/modes.js` (the unstuck `finally`, the
  `execute()` catch); `work/index.js` (`Travel` built in `init`, the wrap's
  start and `lastRun`, `isUpkeep`, the `!endGoal` drop, the fixed reply);
  `work/inventory.js` (the climb in `dropItems`; `passable`/`LIQUIDS` moved
  to `climb.js`); `work/runner.js` (`climb` for `needsFreeSlots` steps, the
  give-back); `work/steps/give.js` (the fast failure); `work/config.js`
  (`work.travel`).
- **Offline tests.** New `tests/work-travel.test.mjs` (the keeper on real
  modes: typed, model-run and goal walks; the drops; chained cuts;
  cowardice; `resume_max` 0 and the cap; an active task and a pending follow;
  `!endGoal`; the stuck rule, the climb and its cuts; the planning retry;
  `climbTarget`; the config; the reproductions, each seen failing on the old
  code: the AUTO MESSAGE call, the cut `goToPlayer` losing the resume slot,
  unstuck and self_preservation losing a pending follow, the live kill
  timer, `giveToPlayer` throwing, the give step waiting out its window).
  `tests/work-resolve.test.mjs` (the full bag in a shaft: tower, drop,
  return; the give-back; which steps climb), `tests/work-inventory.test.mjs`
  (the climb in `dropItems`), `tests/work-collect.test.mjs` (the fixed
  reply), `tests/work-combat.test.mjs` (the walk back still runs before the
  kept walk restarts).
- **Live acceptance** (design §10; the main seat as the owner, the bot
  invincible):
  1. A typed night `!goToCoordinates` of 300+ blocks: every fight followed
     by a restart, 0 AUTO MESSAGE calls, one arrival reply with the count.
  2. The same in words: 1 call to start, 0 per fight, 1 after arrival.
  3. The recorded cave (from about (-352,71,1675) toward (-488,72,1811)) if
     the trap still stands: one unstuck cut, a climb, the walk goes on; else
     recorded as untested.
  4. `!stop` during a fight on a kept walk: she stays.
  5. A sand or dirt task that digs down with a nearly full bag of junk:
     climb, drop, return, the task done with 0 calls.
  6. A mining question answered "no": the fixed reply.
  - Not testable by the main seat: `goToPlayer` while he moves.
- **Exit.** All trials pass; CHANGES.md is current.
- **Not in the travel slice** (design §6, §11): residuals R1–R9 (SPEC §16);
  restarts after `self_preservation` or sleeping and `!goToRememberedPlace`
  (the owner's open questions then; answered 2026-11-14, built in
  Reliability 1); `goToPlayer`'s pause of `self_defense`; the idle cleanup
  underground.

#### Reliability 1 — split stacks merged; the travel answers

- **Goal.** Step 1 of the owner's reliability steps before S3: split
  partial stacks of a kept item are merged before anything is dropped or a
  step blocks (the T5 finding: 30 kinds in 31 slots, "5 free slots, 6
  needed"); and the travel answers: after sleeping (under `when: always`)
  and after a near-death flee (once it is safe) a cut walk restarts, and
  `!goToRememberedPlace` is kept. (Owner rulings: DECISIONS 2026-11-14 "Walks
  after sleeping; reliability before S3".)
- **SPEC.** §9.4 REQ-OBT-11 (the merges before drops); §7.11 REQ-TRV-1 … 3
  (the walks, the cutters, the safety wait); §7.9 REQ-SLP-2 (sleep may cut a
  held walk); §7.7; §5.2; §14 (four `work.travel` keys); §16.
- **Files.** `work/inventory.js` (`planMerges`, the planner's merges and
  compaction, `mergeStill`, the merges first in `dropItems`, the idle
  admission and pass, a failed merge's cursor put back, `slotLayout`);
  `work/runner.js` (the log line, the merge-only give-back, no climb when
  the merges suffice, the slot-layout line); `work/travel.js`
  (`WALK_LABELS`, `RESTART_AFTER`, `onNearDeath`, `safeThen`, `untilSafe`,
  `bedStands`); `work/sleep.js` (`mayCut`); `work/config.js`
  (`work.travel.safe_*`); `agent/modes.js` (one carried line: the
  near-death branch calls `onNearDeath`).
- **Offline tests.** `tests/work-inventory.test.mjs` (the T5 bag in a task,
  seen failing on the old code; the planner's merges and no avoidable
  fragment; mixed signatures; merges only in a shaft, with no climb; the
  idle merge with no direction; from fix wave 1 a throwing merge, a merge
  not taken, the merge-only give-back, no climb when merges suffice, the
  slot-layout line; from fix wave 2 a retry with the cursor loaded, a merge
  the server sets back); `tests/work-travel.test.mjs` (the safety wait: hurt and
  a hostile near, a hostile chasing her through the flee, no hostile now with
  `safe_quiet_s` 0, never safe, a fire cut at once even hurt, a newer
  command, `!stop` and another dimension during the wait, a fight during
  it; `!goToRememberedPlace` cut by a fight; the keys);
  `tests/work-sleep.test.mjs` (under `always` sleep and the bed pickup cut a
  held walk and it restarts; under `idle` not; a fight-cut sleep: the walk
  waits for the bed; a night marked done with the bed placed, the pickup
  that cannot run, a sleep that keeps refusing and a pickup that keeps
  cutting the wait: the bed wait ends at one `safe_wait_s` per walk; an old
  bed holds no walk; `mayCut`). The work fixture gains `moveSlotItem` and
  `clickWindow` (mineflayer's clicks) and `health`.
- **Live acceptance** (the main seat runs them as the owner):
  1. A clean T5: a task that digs down with a nearly full bag climbs, drops,
     returns to work and finishes with 0 calls.
  2. A merge seen live: a kept item in two partial stacks, one slot short of
     `min_free_slots`, merged by a task step or the idle cleanup (console
     `[items]`/`junk drop … merge` lines), no toss of a kept item.
  3. A typed `!goToRememberedPlace` cut by a fight: restarted, 0 calls, one
     arrival reply with the count.
  - Not testable live now: Q1 (sleeping is off in his profile) and Q2's
    near-death case (damage is off): offline only.
- **Exit.** All trials pass; then step 2 (the reliability audit of the I1
  code) and step 3 (the repeated uncoached trial), then S3.

#### S3 — Terrain-fitting shelter

- **Goal.** "Build a small shelter here" works on open ground, among trees and
  against a hillside, in one `!build` command, without felling trees or touching
  the owner's builds. Both detail levels work.
- **SPEC.** REQ-BLD-1, 2, 4, 6 (I1 items), 8, 9 … 12, 12a, 14 … 18, 20 … 22, 24 … 29
  (I1 parts), 34, 35; REQ-PLAN-4, 8; REQ-SAFE-1 … 5 applied to building; the `!build`
  command (REQ-TRN-13).
- **Depends on S2c.** The builder reuses `work/dig.js` (`digCell` and the
  `goToGoal` configure carry from S2b), the placements ledger and its kinds
  (blueprint cells it accepts or verifies are re-kinded `building`, REQ-BLD-35),
  and the owner-question core.
- **Files.**
  - `src/agent/work/`: `site.js`, `shelter.js` (the permanent shelter macro, with
    the approach cell and its Room contract), `verify.js` (Room checks; explicit
    contracts for the four catalog templates), `steps/build.js` (sources `catalog`
    and `auto` steps 2–3; `detail` and `embed` from `work.build.auto_keywords`),
    `commands.js` (`!build`), `protect.js` (builder hooks).
  - Carries: `npc/build_goal.js` (cell classes, the patched `safeToBreak` at dig
    and replace, both door cells, dig order, face-aware placement, re-read,
    deferral of cells a player occupies); `library/skills.js` (the patched
    `safeToBreak` before `placeBlock`'s break, door yaw positioning, re-read).
  - Profile: examples showing `!build`. Settings overlay: `blocked_actions` =
    the deployment's existing list plus `!buildStructure`; examples steer away
    from `!newAction` and `!buildStructure` to `!build` (moved here from S2).
  - `tests/work-site.test.mjs`, `work-build.test.mjs`, `work-verify.test.mjs`.
- **Offline tests** (synthetic block grids, same style as
  `tests/structure-site.test.mjs`):
  - fit: open grass accepted; trees kept (trunk in an `air` cell rejected; leaves
    counted); hillside uses the natural wall; water inside or next to a dug cell
    rejected; the owner's wall satisfies a `solid` cell and is never edited; a chest
    in a floor cell rejects the candidate; `embed: require` versus `allow`, set by
    code from the keyword table;
  - source resolution: shelter words go to the macro (even "small house", never the
    catalog house); a request naming a catalog template goes to the catalog; `auto`
    never picks an owner template; a request neither fits is refused with the
    reason; no model call is made;
  - detail: default `minimal` (open 1×2 entrance, no door); a request that
    mentions a door gives `basic`;
  - builder: `solid` satisfied by stone or dirt; `solid` placed from inventory
    material; both entrance cells prepared, including an upper doorway cell that
    is occupied at the start (a fixture, in place of a repeated live trial); the
    approach cell is cleared, including a dirt pillar standing in it; dig order
    from the entrance; the cell face is passed; a wrong facing after placement is
    not counted; a cell a player occupies is deferred, "please step out" is said
    once with no model call, the cell is placed on a later pass, and the wait does
    not trip the no-progress deadline (REQ-BLD-34);
  - protection: the builder's dig and `placeBlock`'s break call the patched
    `safeToBreak`; a dig next to water or under sand is refused; a cave under a
    gravel ceiling blocks with the reason;
  - scaffolding uses dirt only;
  - a ledger entry in a blueprint cell the builder accepts or verifies becomes
    `building`, and the task-end tidy sweep then leaves it;
  - verifier: the `minimal` and `basic` room checks, including a door with the
    wrong facing failing and `minimal` never reported as mob-proof; a catalog
    template's explicit contract; path checks run with dig, place and scaffolding
    off;
  - folded from S4: `!stop` and death during a `build` step;
  - the bill comes from the world diff; catalog templates no longer reject grass.
- **Probe.** P8 (door yaw, §4), before the first `basic` trial.
- **Live acceptance (uncoached, no materials at the start).**
  1. open grass: "build a small shelter here" (`minimal`, open entrance);
  2. among trees: "build a small hut here" (no trunk felled);
  3. against a hillside: "build a small hut with a door here, against the hill"
     (`basic`; natural wall used);
  4. a hillside with water or gravel nearby: "build a small shelter here": a safe
     build or a precise refusal;
  5. folded from S4: during a "build a small shelter here" task the owner (1) asks
     an unrelated question, (2) says "come here", (3) says "stay here for now",
     then (4) "carry on". Expected: (1) the task continues; (2) the bot comes and
     then resumes the task; (3) the task is paused; (4) it resumes and completes.

  Trials 1–3 and 5 **must end in a verified build**; a refusal fails them. Only
  trial 4 may pass with a precise safety refusal. For each: one `!build` command
  starts the task (plus any `obtain` steps the validator inserted); the build is
  at the frozen anchor; the verifier passes for its detail level; no protected
  block changed (diff within 16); in trial 3 the door closes the doorway; the
  report matches the verifier.
- **Metrics.** §2.3; model calls against the 2–5 target; `unstuck` firings.
- **Exit.** All five trials pass; OQ-7 and OQ-8 have rulings;
  `work.max_leaf_clear` has a default; OQ-20 (whether to block more
  commands) is decided. I1 is then usable for
  play.
- **Not in S3.** Parts specs, compiler, sources `owner`, `mine` and `new`, the
  design library, `auto` steps 1 and 4, ladders, multi-storey, scaffold cleanup
  around the build (REQ-BLD-23; the S2c task-end sweep already removes scaffold
  within reach), `embed: avoid`.

### I2 — native tools

#### S1 — Transport

- **Goal.** Native tool calls on decision requests, plain-text history, prompt
  layout arm A. The task layer is unchanged; the tools call the same `perform`
  functions as the I1 text commands.
- **SPEC.** REQ-TRN-1 … 8, 10 … 12; REQ-ARC-3 … 5.
- **First.** Probe P1 (§4). If it fails, I2 keeps the text DSL and S1 stops here.
- **Files.**
  - `src/models/openai_tools.js`: tools, envelope, explicit reasoning budget.
  - `src/agent/commands/tool_adapter.js` (copy of #769 plus the patch).
  - `src/models/native_tools.js` (new shim: `parseToolArguments`).
  - `src/agent/commands/index.js` (carry): export the command list.
  - `src/models/prompter.js` (carry): envelope on the tool path; tools only on
    decision requests.
  - `src/agent/agent.js` (carry): structured branch inside the stop-epoch checks.
  - `operator/examples/profiles/local.json`: arm A layout, tool-form examples,
    `use_native_tools`. The private profile gets the same change.
  - `tests/work-transport.test.mjs` (new).
- **Offline tests.** Schema generation, including nested `array`/`object`
  parameters; a nested `task_start` schema round-trips into a stub `perform`
  unchanged; the envelope passes through `promptConvo` with the stale-response
  check intact; only the first call runs and extras are refused; text `!commands`
  from the model get the "use tools" turn, at most once per decision request, and
  do not run; owner forced commands still run; summary, coding and bot-responder
  requests carry no tools; all tool schemas together < 8 KB.
- **Live acceptance (uncoached).** One integration smoke: "get 40 oak planks"
  completes through `task_start`; the parse rate on the S2 frozen request
  sequence is at least 95 %.
- **Metrics.** §2.3, with parse rate per turn and schema bytes.
- **Exit.** Acceptance met; Pi trigger line count (REQ-ARC-4) recorded; arm B and
  the drift parser left unbuilt unless a failure was seen.
- **Not in S1.** Arm B, the `name{json}` parser, transitional gather tools.

#### S4 — Contention

- **Goal.** Measure the summary-versus-decision load on the single backend.
- **SPEC.** OQ-18; §16 item on owner chat.
- **Files.** `prompter.js` only if a request gate is ruled necessary; docs.
- **Offline tests.** Summaries arriving during a decision request keep their order
  (C04).
- **Live acceptance.** The S3 trial 5 sequence, repeated on the tool path, with
  overlap measured.
- **Metrics.** Summary requests overlapping decision requests; added latency.
- **Exit.** The request-gate decision (OQ-18) is recorded with its numbers.

### I3 — structures

#### DX — Design experiment (offline)

- **Goal.** Check that Qwen can write parts-only designs, with evidence, and seed
  the design library. Protocol in §5.
- **SPEC.** REQ-BLD-3, 5, 6, 7, 24 (fixture form); answers OQ-6, OQ-9, OQ-11,
  OQ-16.
- **Files.** `src/agent/work/compile.js` (parts to template, private geometry
  helpers), the compiled-part contracts in `verify.js`; `tests/dx/fixtures/*.json`
  (flat, hillside, forest worlds); `tests/dx/corpus.json`; `tests/dx/rubric.json`;
  `tests/dx/run.mjs` (makes model requests; doubles as the offline design session,
  REQ-BLD-32); `tests/work-compile.test.mjs`.
- **Offline tests.** Each part (chamber, wall, deck, passage); attachment and
  stacking (a tower as stacked chambers, a pit as a roofless `require` chamber);
  foundations; door upper cells; auto-ladder; substitutions listed; each part's
  emitted checks against independently written fixture expectations; bill; caps;
  precise validation errors.
- **Live acceptance.** None in game. The experiment run itself (§5) is the
  acceptance.
- **Exit.** Arm A adopted, arm B tried only if A failed, or the fail branch of §5;
  frozen `parts/1` schema; caps and revision limits set; `embed` tests defined;
  results summarised in RESEARCH.md; valid designs saved as the first library
  entries.
- **Not in DX.** In-game building, source resolution.

#### S5A — Structures

- **Goal.** Open-ended structures from natural language: hut, cave, tower, base,
  and new requests, through the parts spec, the compiler and the existing builder.
- **SPEC.** REQ-BLD-1 … 34 (all sources, the full `auto` order, `detail`, ladders,
  scaffold cleanup, `embed: avoid`, `!saveTemplate`); REQ-PLAN-9 ("design
  needed").
- **Files.**
  - `src/agent/work/designs.js` (owner store, library, tag matching),
    `steps/build.js` (sources `owner`, `mine`, `new` with `parts`; `auto` steps 1
    and 4 with the "design needed" result), `commands.js` (`parts` on `!build` and
    the `build` tool; owner-only `!saveTemplate` built on `worldToBlueprint`),
    `compile.js` integration, `verify.js` (region recovery for owner templates),
    the cleanup around the build (REQ-BLD-23: S2c's `tidyNear` wrapped with an
    approach walk; the `scaffold` kind itself arrives in S2c).
  - `shelter.js` stays as it is (REQ-BLD-4); S3's tests are kept as regression.
  - Carry: `npc/build_goal.js` (ladder cells, suffix parsing, access before upper
    work).
  - The `enclosure` contract kind in `verify.js`; the layer-row front end.
  - `tests/work-designs.test.mjs`.
- **Probe.** P7 (ladder climbing, §4).
- **Offline tests.** `auto` order: library tag match, then the shelter macro, then
  the catalog only by explicit name, then "design needed", with no model call
  before step 4; `auto` never picks an owner template; `new` without `parts`
  returns "design needed" with the frozen `at` as a string and starts no task;
  `build{source: new, parts, at}` compiles, freezes the blueprint and contract
  into the task and saves the design to the library; invalid parts return the
  errors and the same `at`, at most 2 revisions; no command's `perform` makes a
  model call; with `work.design.ingame_enabled: false` step 4 refuses with the
  reason; `!saveTemplate`: refuses if any cell is unloaded, converts
  `levels[].placement` to `blocks[y][z][x]`, maps block names to placing items
  (`wall_torch` → `torch`), turns plants and short grass into air, drops upper
  door halves and second bed cells, refuses unmapped names and regions over
  `work.build.save_template_max`, writes only to the owner folder, is absent from
  tools and docs; exact owner-template lookup, ambiguity refusal with matches,
  Qwen never writes to the owner folder; `window` openings only in `basic`;
  design files carry `by`, tags, request, compiler version and validation; ladder
  placement order; upper-level access; cleanup removes only `scaffold` entries of
  the current build; every region check on fixtures; `embed: avoid`.
- **Live acceptance (uncoached).**
  1. "build a small hut among these trees";
  2. "dig me a little cave into this hill";
  3. "build a two-storey stone tower with a ladder";
  4. "build a small base: two rooms connected by a corridor";
  5. "design me a new …" (a novel structure the owner names at trial time):
     `source: new` → "design needed" → `build{source: new, parts, at}` (at most 2
     revisions) at the original anchor; skipped if DX's fail branch turned in-game
     design off;
  6. one free request the owner phrases without asking for a new design: `auto`
     resolves it (record which step of the order was used);
  7. "build my template X here" for a template the owner saved earlier with
     `!saveTemplate` (from one of his own builds).

  Each verified by its contract for its detail level; no protected block changed;
  substitutions and auto-ladders listed in the report. A request resolved from the
  library, the macro or the catalog starts with one `build` and no design work.
  (A restart during upper-storey work is covered offline: the builder re-diffs the
  frozen blueprint idempotently, and S2 proved crash resume.)
- **Metrics.** §2.3; resolved source per build; revisions used; model calls per
  build.
- **Exit.** All trials pass; the S3 shelter regression still passes.
- **Not in S5A.** Schematic or image import, stairs, beds, gable roofs.

### I4 — discovery

#### S5B — Surface discovery

- **Goal.** Find blocks, mobs, animals, villagers and structures beyond loaded
  chunks, remember places, report honestly.
- **SPEC.** REQ-FIND-1 … 11, 13, 14, 17 … 19 (I4 parts); REQ-SAFE-8; answers OQ-5.
- **Files.** `src/agent/work/places.js` (the persisted `MemoryBank` backing),
  `locate.js`, `explore.js`, `steps/find.js`, `steps/go_to.js` (place targets),
  `data/structure_signatures.json`; `tests/work-find.test.mjs`,
  `work-places.test.mjs`.
- **Probes.** P5, P6, P10 (§4), before the first live trial.
- **Offline tests.** Locator order; the on-demand full-height scan from the
  formula, at each leg; signature rules (each row, candidate versus recognised);
  frontier scoring (coverage, distance, water penalty); breadcrumbs and `work_pos`
  updates; explore legs use `canDig=false`; exhaustion gives a final
  `not_found_within_budget` report and blocks the step; legs run at night; places:
  atomic write, the dimension field, `!savedPlaces` and `last_death_position`
  after a restart; a stored target is re-observed before use; an unknown
  structure is refused at validation.
- **Live acceptance (uncoached).**
  1. A block target outside the loaded chunks is found and stored ("find me some
     sand" or another target the owner picks that is not loaded);
  2. an honest exhaustion report for a target that is absent within budget;
  3. "find cows";
  4. "find a village".

  (Resuming mid-leg from breadcrumbs is covered offline; S2 proved crash resume.)
- **Metrics.** §2.3; chunks explored; blocks travelled.
- **Exit.** All trials pass.
- **Also in I4.** The background chunk indexer, biome priors, the
  discovery-database extras and the mansion and stronghold rows (SPEC §10, all
  `[I4]`), with their own offline tests.
- **Not in S5B.** Underground access, `/locate`, explorer maps, boats.

### I5 — underground and smelting

#### S6 — Underground and smelting

- **Goal.** Iron-tier items from an empty inventory, safely enough while the bot
  is invincible.
- **SPEC.** REQ-OBT-5 (iron), 6 … 8, 10; REQ-FIND-16 (I5 settings); REQ-SAFE-3's
  obtain-target exception; answers OQ-3.
- **Probe.** P9 (§4), before integration.
- **Files.** `src/agent/library/skills.js` (carry: `smeltItem` uses only a
  furnace with empty input, fuel and output slots, and takes back only the counts
  it put in), `resolve.js` (mine and smelt nodes, iron tier, fuel, station output
  collected on resume, inventory re-read per P9), `data/smelting.json` (inputs
  beyond mcdata's whitelist),
  `protect.js` (underground hazard settings; the obtain-target water exception);
  `tests/work-smelt.test.mjs`, `work-mine.test.mjs`.
- **Offline tests.** `smeltItem` skips a nearby furnace with anything in its
  input, fuel or output slot and uses the next empty one or places its own; it
  never takes back more than it put in; an owner's furnace is never broken; the
  station is persisted and its output collected on resume;
  `unstuck` is paused by `smeltItem` during the furnace wait, including a resumed
  smelt; fuel arithmetic; smelt batches ≤ 8; inputs outside mcdata's whitelist
  (stone → smooth_stone, cactus → green_dye) resolve and smelt from
  `smelting.json`; buried ore is reached by the
  pathfinder's digging under the forced flags; lava stays avoided; pickaxe tier
  required; underwater clay is collectable under the target exception while a
  path dig next to water is still refused.
- **Live acceptance (uncoached).**
  1. "get 10 iron ingots" from an empty inventory;
  2. "make me 8 smooth stone" (an input outside mcdata's whitelist);
  3. a precise refusal when the only route meets lava or unloaded terrain.
- **Metrics.** §2.3; blocks dug; time underground.
- **Exit.** All trials pass.
- **Not in S6.** The `descend_to` staircase, diamond tier
  or beyond, Nether, buckets, other acquisition methods.

### Survival iteration

#### SV — Survival

- **When.** The owner turns damage back on. Until then none of this can trigger.
- **SPEC.** REQ-RES-8 (health and food gate), REQ-RES-14, 15 (night `shelter`),
  REQ-SAFE-10 (food), REQ-OBT-11 (auto-deposit, surplus drop), REQ-REC-12 and its
  consumers (REQ-BLD-8's ask, REQ-FIND-10's owner question, REQ-FIND-11,
  REQ-SAFE-6 `/locate`), the `descend_to` staircase (§10.6), OQ-19.
- **Files.** `work/ask.js`; `agent.js` (carry: owner-answer interception);
  `work/underground.js`; the `shelter` branch of the runner and explorer; the
  Surv keys of SPEC §14.
- **Offline tests and trials.** Specified when the iteration is planned, from the
  requirement text in SPEC; the earlier owner-question tests (only an owner
  message answers; a matched answer never reaches the model; no timeout) and
  night-policy tests (dig-in and time-based resume with no model call) are the
  starting point.

## 4. Probes

Each probe runs in the slice that needs it, as a test script or a short check the
owner agrees to. There is no `!probe` command and no `probes.js`. Probes that place
blocks use natural ground at a spot the owner agrees to, and remove only their own
placements afterwards. Results go to `runtime/diagnostics/probes-<date>.json`.

Probes are measurements, not trials, so the owner may hand the bot what they need.
The bot's inventory is stale, so ask the owner for each kit before its slice:

- **I1 kit (S3, P8):** 1 oak door and 8 dirt (door frame).
- **I3 kit (S5A, P7):** 4 ladders and 4 more dirt (backing column).
- **I5 kit (S6, P9):** 1 furnace (the test furnace), 2 raw iron (or any 2
  smeltable items), 1 coal, and 1 wooden pickaxe so P9 can take its furnace back
  (a furnace drops nothing when broken by hand), unless the bot is checked to hold
  a pickaxe.

| # | Probe | Slice | Method | Answers |
|---|---|---|---|---|
| P1 | Backend tool calls | S1 (first) | 10 requests with 3 tools (nested `task_start`, scalar `goToPlayer`, no-arg `task_pause`) at the 2048 budget; with and without `parallel_tool_calls:false`. Record parse rate, latency, reasoning characters, calls per reply, whether nested arguments arrive intact. `tests/probes/backend-tools.mjs` reads the endpoint from the private profile. | OQ-1; whether I2 proceeds |
| P2 | (retired: arm A adopted, REQ-TRN-12.) | — | — | — |
| P3 | Request logging | S0-lite | Covered by S0-lite's offline tests and the baselines' logs. | REQ-OBS-1 |
| P4 | Baselines | S0-lite | The two uncoached baselines. | comparison |
| P5 | Loaded area | S5B | Count loaded chunk columns and their extent; check that underground blocks are visible in them. | R_load, OQ-5 |
| P6 | Entity range | S5B | Over a few minutes, the farthest distance at which each entity type is seen and disappears. | OQ-5 |
| P7 | Ladder | S5A | Place a 4-high ladder on a backing column; set a goal at the top; record whether the pathfinder climbs or pillars. | OQ-4 |
| P8 | Door yaw | S3 | Place a door in a dirt doorway standing on the wall's perpendicular axis and off it; read `facing` each time. Door facing following yaw is a prediction until this runs. | OQ-4 |
| P9 | Inventory after furnace | S6 | Place the kit furnace on natural ground away from any other furnace and check it is empty; open **that** furnace by position (`bot.openFurnace` on the block) and smelt 2 items; compare `bot.inventory` with the counts after closing and reopening a window; take the furnace back. | OQ-3 |
| P10 | Signature blocks | S5B | Check that every marker block name in the signature table exists in the deployed version's registry (offline); live sightings during S5B. | OQ-5 |
| P11 | Hostile classification | S0-lite | Offline: list every entity type in the deployed version's registry with its `type` and the `mc.isHostile` result (utils/mcdata.js:113-116). Live cross-check: S2's resume-check log lines name each hostile seen. | OQ-17 |
| P12 | `unstuck` during stationary work | S0-lite | Count firings during the shelter baseline (a log count, not a probe). | REQ-RES-11 |
| P13 | Pathfinder placement tell | S2c (first; done 2026-11-10) | A temporary listener logged `blockPlaced`, the planned `toPlace` cells, nearby `blockUpdate`s and `blockAt` after each placement while the bot pillared up twice through `!goToCoordinates`. Results in the private diagnostics folder (`clear-council/clutter/live-probe/`): tell A held on 24 of 24 placements; `newBlock` was air on 23 of 24; about 3 events per cell; false positives not exercised. | REQ-OWN-3 |
| P14 | Sleep through ViaProxy | S2d (first; done 2026-11-11) | With a bed the owner gave and a spot he agreed to, at night: place the bed from a stand cell (halves, facing against yaw), `bot.sleep`, the `sleep`/`wake` events, when the night skips with one sleeper, the server's sleep text, breaking the foot (drop, pickup). Results in the private diagnostics folder (`sleep-council/p14-live-20261111.md`): `bot.sleep` works through ViaProxy and the night skipped about 3 s after she lay down (she was the only player online; one sleeper skipping with others awake is the owner's statement). `bot.wake()` timing not measured yet (SPEC §16). | REQ-SLP-3, 4 |
| P15 | Item toss through ViaProxy | S2e (before its deploy; done 2026-11-12: `runtime/diagnostics/i1-build/s2e-review/p15-live-20261112.md`) | The toss direction with and without the 2-tick wait: G1 confirmed (without it the toss flies the way she looked before); with it a level toss 3 blocks out at eye height lands 3.1–3.2 blocks ahead on flat ground (2.38 onto a one-block step, a direction the facing rule excludes); standing still she picked nothing up in 6 s; an operator Stop/Start rereads the profile (`main.js:76-78`). The design's values hold. Not probed (the S2e trials cover them): an obstacle within 3 blocks (excluded by the facing rule), the guard against `pickupNearbyItems` (offline tests), and the one-slot `bot.transfer` path with whole-stack tosses through ViaProxy (P15 tossed with `bot.toss`). | REQ-OBT-11 |
| P16 | A throw out of a one-deep pit; her weapons' item data | S2e-fu (before its build; done 2026-11-12: `runtime/diagnostics/i1-build/s2efu/p16-live-20261112.md`) | From a pit one deep (walls at foot height on all four sides, eye cells open) the level toss 3 out at eye height, after the 2-tick wait, cleared the lip at distance 1 in all four directions and landed 1.84–3.15 blocks out on the surface; nothing picked up in 7 s. Her 5 bows and 4 crossbows read `durabilityUsed`/`maxDurability` correctly, all with `enchants=[]`; no enchanted item was available, so `enchants` on an enchanted item of this version is unprobed. | REQ-OBT-11 |
| P17 | The owner's gear, live | Gear (before its build; done 2026-11-13: `runtime/diagnostics/i1-build/gear/p17-live-20261113.md`) | Read the components of the owner's copies (the pickaxe copy's tool rule speed 9 on `mineable/pickaxe`, Efficiency V through `item.enchants`, unbreakable, no Silk Touch; her placeholder diamond pickaxe also unbreakable); the attack attributes (his axe speed 4, a diamond axe 1); bare-hand taps 5 and 10 ticks apart (the 10-tick hurt cooldown holds); the copy on owner-placed obsidian (the 47-tick wait; it dropped). | REQ-GEAR-1 |

## 5. Design experiment protocol (DX)

Needs only the compiler, validator and fixture verifier; no game.

- **Corpus.** 24 requests, 8 per tier, written and frozen before any run in
  `tests/dx/corpus.json`.
  - Simple: hut, cave, shed and similar.
  - Medium: tower with a ladder, two-room base, 12-block wall, lookout on a
    platform and similar.
  - Odd: L-shaped house, round tower, pyramid, bridge and similar.
- **Arms.** A parts only, one seed: 24 first attempts, plus revisions. Arm B
  (parts plus coordinate ops) runs only if A fails the bar. The layer-row arm is
  retired; layer rows become an I3 front end built in S5A.
- **Route.** The deployed model and backend, `reasoning_budget_tokens` 2048 (the
  in-game setting).
- **Per attempt.** Up to 2 validator revisions, each with the precise errors.
- **Measures.**
  - parse rate;
  - valid rate after 0, 1 and 2 revisions;
  - would-verify rate on the three synthetic fixtures (flat, hillside, forest);
  - automatic intent match from `tests/dx/rubric.json`, frozen with the corpus
    (dimensions within the words' range, material words matched to roles, door or
    ladder present when the request implies one);
  - tokens and latency.
- **Decision rule.** Adopt arm A if it reaches ≥ 80 % valid after ≤ 2 revisions on
  the simple and medium tiers and ≥ 70 % intent match. Otherwise run arm B and
  adopt it only if it meets the same bar. A failed experiment is never reported as
  open-ended capability.
- **Fail branch.** If neither meets the bar, S5A ships **library-only**: designs
  are made in offline design sessions (`tests/dx/run.mjs`) with more revisions and
  a larger reasoning budget, `auto` uses the library and the shelter macro, and
  in-game design is off (`work.design.ingame_enabled: false`; `source: new` and
  `auto` step 4 refuse with the reason).
- **Outputs.** Chosen arm or the fail branch; frozen `parts/1` schema; caps (OQ-6);
  offline revision limit (OQ-11); `embed` tests (OQ-9); every valid design saved to
  the library with `by: model` and tags.

## 6. Review and commit

- **Branch.** Work on `develop`. Concurrent editing sessions use separate Git
  worktrees, never the same tree (operator/README.md convention).
- **Gates before review.** All offline suites (§2.1). New tests reproduce the
  cause they guard, as the existing suites do.
- **Review.** Each slice gets the independent review the owner's review policy
  sets for it. Fix findings that can happen on the owner's deployment; record the
  rest as residuals in ISSUES.md. A finding that survives two fix rounds goes to a
  design decision.
- **CHANGES.md.** Every new or grown carry gets an entry: the file and what changed;
  why; a **reapply check** (the test that must pass after an upstream merge); a
  **retirement trigger** (the upstream change that would make it unnecessary).
  Example:

  | Field | Example |
  |---|---|
  | File | `agent/history.js` |
  | Change | `memory_max_chars` setting replaces the literal 500. |
  | Why | Conversation summaries only; working state is in the task record. |
  | Reapply check | `tests/work-record.test.mjs` "summary cap honours memory_max_chars". |
  | Retire when | Upstream makes the summary cap configurable. |

- **Commit.** After review closes. One commit per slice where practical; imperative
  summary line, like the existing history ("Validate only declared build cells…").
  Stage by explicit path. Then deploy by an agent-only restart and run the live
  trials; trial results go in a follow-up docs commit.
- **Push.** Only on the owner's word.
- **Docs.** A slice updates only the docs whose content changed: SPEC (a changed
  requirement), PLAN (status), ISSUES (residuals), CHANGES (carries), HANDOFF
  (next step). DECISIONS is append-only and records owner rulings only.

## 7. Live-testing etiquette

- The game server shuts itself down about 5 minutes after the last player leaves,
  and only the owner can start it again.
- **Keep the bot connected** between tests and while implementing. Deploy code with
  an agent-only restart (quick rejoin), not a full Stop.
- An agent-only restart (MindServer restart or `!restart`) is a **crash restart**
  for the task layer from S2 on: an active task resumes by itself. **Finish or
  cancel any task before deploying.** Restart deliberately mid-task only to test
  crash resume. A MindServer UI stop then start is a fresh start (`clean_stop`),
  so the task loads paused.
- Agent-only restarts always load the saved memory (`load_mem=true`,
  process/agent_process.js:49). Keep the saved memory current or archived (see
  HANDOFF).
- If the bot drops anyway (for example kicked as AFK), tell the owner so he can
  start the server again.
- Never leave the bot disconnected on purpose for more than a few minutes. Do the
  Stop/Start trial (S2 trial 3) only while the owner is connected.
- Never run the same bot identity from two clients or hosts at once. Before
  starting, make sure no other client is logged in with it.
- Start fresh (memory not loaded) unless a trial tests crash restart; never revive
  a stopped task from old memory.

## 8. Deferred items and their seams

None of these forces a rewrite: the record is versioned, steps are a registry,
every design compiles to the one template format, commands and tools share the
same `perform` functions, and transport sits behind the provider. Every deferral
inside v1 has a named iteration (§1); this table lists what lies beyond v1.

| Item | Seam |
|---|---|
| Levelling or site-hunting as an explicit task (clearing itself is S2c) | a new step in the registry, using the protection predicate and `work/dig.js` |
| The complete scaffold record and cleanup (DECISIONS 2026-11-11): record every block the bot puts down, also those the lean S2c version cannot reach; remove out-of-reach scaffold by walking to it; travel bridges. Its own slice in a later iteration, not yet named; S2c's own-blocks count sets its priority. | the placements ledger (kinds, `by`, `dim`, the attempt wrap) and the one sweep `tidyNear`: a walking sweep is a new trigger around it with its own approach walk, as the build cleanup (REQ-BLD-23) wraps it, without a rewrite. The adversary's findings for a walking sweep (bridge stranding, creep, gates) are kept for that slice in the private diagnostics folder (`clear-council/clutter/adversary-report.md`). The lean version's recorded residuals are in SPEC §16. |
| Furniture and decoration (`detail: full`); stairs, beds, gable roofs (yaw-dependent blocks) | exact cells with suffixes plus one builder handler: set yaw, place, verify `facing` (S2d's bed placement already verifies both halves and `facing` from the block states, `work/sleep.js`) |
| Sleeping in beds already in the world, making a bed, fetching a bed left far away, restoring the respawn point (sleep design §12) | `Sleeper`'s spot choice (`work/sleep.js`): a world bed is one more candidate beside *my bed*; making one is an `obtain` of `*_bed`; the far bed is an `action:bed` with a longer walk |
| Schematic import (`.schem`, `.litematic`, `.nbt`) | a front end emitting the template format (`by: import`); prismarine-schematic reads the files |
| Image-to-design | a front end emitting the template format (`by: image`) |
| Larger design caps | configuration (`work.build.max_cells`, `max_volume`) plus inventory logistics |
| `hunt` (with the `res` bug fixed), trading, buckets, shearing, farming, fishing | resolver methods |
| Diamond tier and beyond | resolver methods and tier data |
| Explorer maps | a locator-chain provider |
| Boats, ocean crossings, Nether, End, strongholds | exploration and resolver methods |
| Multi-task queues | the versioned record (one file becomes a queue) |
| Friends' ownership | `requested_by` in the record; `only_chat_with` |
| Request gate between summaries and decisions | prompter, if S4 rules it necessary |
| Dynamic state after the history (arm B), the `name{json}` drift parser | prompter and agent loop, on evidence (REQ-TRN-12, 9) |
| Pi or another loop | the provider interface (REQ-ARC-4 triggers) |
| Upstream #769 adapter | replaces ours if merged with nested params (REQ-ARC-5) |
