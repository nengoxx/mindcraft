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
I1  usable for play     S0-lite → S2 → S3
I2  native tools        S1 → S4 (rest)
I3  structures          DX → S5A
I4  discovery           S5B
I5  underground, smelt  S6
Surv survival           SV (when the owner turns damage back on)
```

The slice names S0 … S6 are kept; iterations group them. The full requirement
text of every later iteration stays in SPEC, tagged with its iteration.

**The owner's rule for cuts** (DECISIONS 2026-11-08, "Iterations and
simplification"): no feature discussed with the owner is dropped. It either reuses
an existing upstream, Mindcraft or Mineflayer mechanism that really delivers it, or
is deferred to a named later iteration. Only internal machinery that delivers
nothing the owner can see is retired.

- **I1 — usable for play (build now).** The smallest set that fixes the core
  complaints: planning, gathering and crafting, combat then back to the task, a
  simple terrain-fitting shelter. Transport is Mindcraft's text `!commands` with
  the compact step DSL (SPEC §12.0); native tools wait for I2.
  - Step vocabulary: `obtain` (surface: wood, stone, crafting, a crafting table),
    `go_to`, `give`, `build` (the shelter macro; the catalog only by explicit
    name).
  - S0-lite: request logging, the two baselines, P11 (hostile classification).
  - S2: task record, runner and resume, the surface obtain resolver, protection,
    the persisted ledger (`permanent` and `station` kinds), the task view and
    fact-based reports.
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
  extensions, `/locate`, rare-target prompts); the careful `descend_to` staircase.
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
  - junk drop: below `work.min_free_slots` the bot tosses only `work.junk_items`,
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

#### S3 — Terrain-fitting shelter

- **Goal.** "Build a small shelter here" works on open ground, among trees and
  against a hillside, in one `!build` command, without felling trees or touching
  the owner's builds. Both detail levels work.
- **SPEC.** REQ-BLD-1, 2, 4, 6 (I1 items), 8, 9 … 12, 12a, 14 … 18, 20 … 22, 24 … 29
  (I1 parts), 34; REQ-PLAN-4, 8; REQ-SAFE-1 … 5 applied to building; the `!build`
  command (REQ-TRN-13).
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
  design library, `auto` steps 1 and 4, ladders, multi-storey, scaffold cleanup,
  `embed: avoid`.

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
    `protect.js` (ledger kind `scaffold`, cleanup).
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
| Clearing or levelling as an explicit task | a new `clear` step in the registry, using the protection predicate |
| Furniture and decoration (`detail: full`); stairs, beds, gable roofs (yaw-dependent blocks) | exact cells with suffixes plus one builder handler: set yaw, place, verify `facing` |
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
