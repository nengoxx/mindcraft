# Plan — building the task layer

This document says **how and in what order** the [specification](SPEC.md) is
built. Requirement numbers (`REQ-…`) and open questions (`OQ-…`) refer to SPEC.md.
Owner rulings are in [DECISIONS.md](DECISIONS.md).

Contents: 1 Order · 2 Rules for every slice · 3 Slices · 4 S0 probes ·
5 Design experiment (DX) · 6 Review and commit · 7 Live-testing etiquette ·
8 Deferred items and their seams.

---

## 1. Order

```
S0 probes → S1 transport → S2 task record, runner, resume → S3 terrain-fitting shelter
   → S4 hardening → DX design experiment (offline) → S5A structures
   → S5B discovery → S6 underground and smelting
```

- **S0–S3** are the approved core (DECISIONS 2026-11-08). S2 comes right after
  transport because losing the task on interruption is the owner's main complaint.
- **S4 sits right after S3.** Its items (owner chat during a task, the
  summary-versus-decision load on the single backend, stop and death in every step
  type) affect every later live trial. Fixing them first means the S5–S6 trials
  measure the new features, not these confounders. S4 also needs the S2/S3
  measurements, which exist only then.
- **DX before S5A** (E1). DX builds the compiler, validator and fixture verifier
  offline and decides the design representation. It needs no game. It does use
  the model backend, so it is scheduled like a trial: never while a live trial
  runs. It shares no code with S4, so it may run before S4 or alongside it.
- **S5A before S5B before S6.** Structures use surface materials (wood, stone)
  that S2's resolver already obtains. Discovery is needed before underground
  mining and the iron tier.

## 2. Rules for every slice

### 2.1 Definition of done

A slice is done when all of these hold:

1. Its offline tests pass, together with the existing suites:
   `node --experimental-test-module-mocks --test tests/*.test.mjs` and the
   operator checks listed in operator/README.md.
2. It passed review (§6) and was committed.
3. It was deployed by an agent-only restart and each live acceptance trial passed
   uncoached at least once. Every attempt, passed or failed, is recorded.
4. Its metrics are recorded (§2.3) and SPEC/PLAN/CHANGES/ISSUES are current.

A trial that fails for the same cause after two fix rounds goes to a design
decision instead of a third patch.

### 2.2 Uncoached trial protocol

- The owner's request is sent once through the owner channel, in natural language,
  exactly as written in the slice. Nothing else is sent until the end.
- Qwen alone orchestrates. No hints, coordinates, material lists or plans.
- The developer may end a trial only for a critical problem (danger to the owner's
  builds or items, a loop that damages the world) or demonstrated non-progress,
  with a terminal `!stop`. That counts as a failed attempt.
- Before each trial, record the bot's position, inventory, time of day and the
  non-natural blocks within 16 of the site. After it, record the same plus the
  metrics below.
- Never resume a failed trial from old memory. Start the next attempt as a new
  request.
- The owner's server currently makes the bot invincible (no damage, drowning or
  hunger), and trials run that way with `work.night_policy: continue`. Every trial
  report says "invincible"; no survival or self-sufficiency claim follows.

### 2.3 Metrics recorded for every trial

From `runtime/diagnostics/requests.jsonl` and the task record (REQ-OBS-1..3):
model calls by kind; summaries as a share of all requests; prompt, cached and
completion tokens; reasoning characters; latency per request; wall time; tool-call
parse rate; interruptions by cause and how many resumed with 0 model calls; crash
restarts; blocks and their reasons; verifier outcome; protected-block diff; edits
(placed, dug, leaves cleared); distance travelled; interventions (target 0).

## 3. Slices

### S0 — Probes and observability

- **Goal.** Measure before building: the backend's tool support, caching, the
  facts later slices depend on, and a baseline on the current code.
- **SPEC.** REQ-TRN-1, REQ-OBS-1; answers OQ-1, OQ-2, OQ-3, OQ-4, OQ-5, OQ-17.
- **Files.**
  - `src/models/openai_tools.js` (new): provider with request logging only, text
    path unchanged.
  - `src/models/prompter.js` (carry): pass the request kind to `sendRequest` in its
    existing `options` argument.
  - `src/agent/work/index.js`, `commands.js`, `probes.js` (new): skeleton and the
    `!probe(name)` command, registered only when `work.probes_enabled` is true.
  - `src/agent/commands/index.js` (carry): registration hook for work commands.
  - `tests/probes/backend-tools.mjs` (new): the backend tool-call and cache probe;
    reads the endpoint from the private profile; writes to `runtime/diagnostics/`.
  - `tests/work-s0.test.mjs` (new).
- **Offline tests.** Provider logs every request kind with the right fields and
  never sends tools; the request kind reaches the provider from all four prompter
  paths; `!probe` is absent when disabled.
- **Probes and baselines.** See §4.
- **Live acceptance (current code, uncoached).** Two baselines with the existing
  text commands: "get 40 oak planks" and "build a small shelter here". They are
  measurements, not pass/fail; their numbers are the comparison point for S1–S3.
- **Metrics.** All of §2.3, plus `unstuck` firings during stationary work.
- **Exit.** Every probe in §4 has a recorded result; the S1 route (tool path or
  DSL fallback) is decided from P1; the REQ-TRN-12 prompt-layout arm is decided
  from P2 and written into SPEC; SPEC open questions are updated; a sanitized
  summary is added to RESEARCH.md.
- **Not in S0.** Any tool path, task record or behaviour change.

### S1 — Transport

- **Goal.** Native tool calls on decision requests, plain-text history, the
  prompt layout chosen at S0.
- **SPEC.** REQ-TRN-2 … REQ-TRN-9, REQ-TRN-11, REQ-TRN-12; REQ-ARC-3.
- **Files.**
  - `src/models/openai_tools.js`: tools, envelope, explicit reasoning budget.
  - `src/agent/commands/tool_adapter.js` (copy of #769 plus the patch).
  - `src/models/native_tools.js` (new shim: `parseToolArguments`).
  - `src/agent/commands/index.js` (carry): export the command list.
  - `src/models/prompter.js` (carry): envelope on the tool path; tools only on
    decision requests; the dynamic-state-after-history message if S0 chose arm B.
  - `src/agent/agent.js` (carry): structured branch inside the stop-epoch checks.
  - `operator/examples/profiles/local.json`: layout reorder, tool-form examples,
    `use_native_tools`. The private profile gets the same change.
  - `tests/work-transport.test.mjs` (new).
- **Transitional tools.** S1 has no `obtain` step yet, so `collectBlocks` and
  `craftRecipe` are offered as tools in S1 only, to make the gather trial
  possible. S2 removes them (REQ-TRN-10).
- **Offline tests.** Schema generation, including nested `array`/`object`
  parameters; a nested `task_start` schema round-trips into a stub `perform`
  unchanged; the envelope passes through `promptConvo` with the stale-response
  check intact; only the first call runs and extras are refused; text `!commands`
  from the model get the "use tools" turn and do not run; owner forced commands
  still run; summary, coding and bot-responder requests carry no tools; the
  `name{json}` fallback; all tool schemas together < 8 KB.
- **Live acceptance (uncoached).**
  1. **Parsing:** a fixed sequence of at least 10 independent uncoached requests,
     written and frozen before the run in `tests/s1/requests.json` (short gather,
     craft, give, follow and status requests): at least 95 % of tool calls parse.
  2. **Completion and latency**, separately: "get 40 oak planks" completes; request
     count and latency are recorded against the S0 baseline. It is not required to
     take any minimum number of turns.
- **Metrics.** §2.3, with parse rate per turn and schema bytes.
- **Exit.** Acceptance met; Pi trigger line count (REQ-ARC-4) recorded.
- **Not in S1.** Task record, runner, resume, `obtain`.
- **If S0's P1 failed:** S1 becomes the DSL-over-text fallback: `task_start` and
  `task_revise` take one string argument in a compact step DSL, parsed by
  `work/plan.js`. S1 accepts the parser against stubs (≥ 95 % valid DSL on the
  frozen request sequence); its live gather trial uses the existing text commands.
  Executable DSL tasks are accepted in S2.

### S2 — Task record, runner and resume

- **Goal.** The bot keeps its task through interruptions and restarts, and gathers
  and crafts through `obtain` (wood and stone tiers).
- **SPEC.** REQ-REC-1 … 11; REQ-RES-1 … 15; REQ-PLAN-1 … 8 (non-build parts);
  REQ-OBT-1 … 5, 9, 11, 12; REQ-SAFE-1 … 5, 7, 9 … 11; REQ-TRN-10; REQ-OBS-2.
- **Files.**
  - `src/agent/work/`: `index.js`, `config.js`, `record.js`, `runner.js`, `plan.js`,
    `commands.js` (`task_*`), `steps/obtain.js`, `steps/go_to.js`, `steps/give.js`,
    `resolve.js`, `protect.js` (predicate, tree test, persisted ledger, the
    `Movements.prototype.safeToBreak` patch with the hazard flags, SIGINT
    `clean_stop` handler),
    `view.js`, `report.js`, `data/natural_blocks.json`.
  - Carries: `agent.js` (work init with `init_message`), `prompter.js` (task view in
    `$SELF_PROMPT`), `commands/index.js` (register), `history.js`
    (`memory_max_chars`).
  - Profile: summariser wording (no coordinates, quantities or step progress).
  - `tests/work-record.test.mjs`, `work-runner.test.mjs`, `work-resolve.test.mjs`,
    `work-protect.test.mjs`.
- **Offline tests** (fixture bot plus the real ActionManager and modes code):
  - record: atomic write, unknown version left alone, every lifecycle transition;
  - restart: crash restart resumes with 0 model calls; fresh start loads `paused`;
    a SIGINT stop writes `clean_stop`, re-raises the signal, and the next start
    (even with `init_message 'Agent process restarted.'`) loads `paused`; startup
    clears `clean_stop` after reading it, so stop → start → resume → crash
    resumes the task again as a crash restart; 3 restarts in 10 minutes block the
    step;
  - supersede: a new request while a task is `paused` or `blocked` cancels it as
    `superseded`; while `active` it is refused;
  - anchor: `here` resolves to the owner's position when tracked, else the bot's,
    and is unchanged after inserted `obtain` steps and a restart;
  - craft calls use the 120 s deadline; other calls 45 s;
  - the "use tools" turn appears at most once per decision request;
  - resume: a mode interrupt resumes with no AUTO MESSAGE and no model call; an
    interrupted run is resumed by the self-heal timer; a thrown error is caught and
    `resume_func` survives; the no-progress deadline ends the run through
    `requestInterrupt`; a run ends itself at the run bound, checked only between
    actuator calls;
  - gate: refusal persists its reason; blocks after 120 s (fake clock);
  - causes: owner `!stop` → `cancelled`; death → `paused(died)`; a resumable
    replacement → `paused(replaced)`;
  - `!goal` refused while a task is active; `unstuck` paused in stationary steps;
  - the report is posted after the run, with no nested `runAction`;
  - `task_start` returns falsy and saves history; all validation errors together;
  - night: under `continue`, night hostile interruptions do not count toward the
    block threshold and no dig-in happens; under `shelter`, dig-in and time-based
    resume with no model call;
  - resolver: planks from logs, sticks, a wooden pickaxe and a stone pickaxe from
    an empty inventory; table need from recipe shape; leftovers; re-evaluation
    after partial progress gives the right shortfall;
  - protection: a natural tree is collectable, an all-log cabin is not; collection
    never re-selects a protected block; the prototype patch covers a `Movements`
    that was never passed to `setMovements` and the collect plugin's check; while
    a task runs `safeToBreak` uses `dontCreateFlow` and `dontMineUnderFallingBlock`
    true even after `collectBlock` set them false, except that a block of the
    current `obtain` target type skips only the water-adjacency check (underwater
    clay is collectable; a lava neighbour, a falling block or a player standing on
    it is still refused; a path dig next to water is still refused); the tree test runs
    once per position per run (memoized); the bot's own table, recorded in the
    persisted ledger, is collectable after a restart; after any task replacement,
    a still-present `permanent` table or furnace outside any blueprint is carried into the new
    record as a `station` entry and stays collectable, while other entries are
    dropped;
  - full inventory blocks with a report and discards nothing.
- **Live acceptance (uncoached).**
  1. "get 40 oak planks", started at dusk: at least one mob interruption resumed
     with 0 extra model calls (log), the bot back within 6 blocks of `work_pos`,
     inventory ≥ 40, truthful report. Repeat until at least one mob interruption
     occurs; a run without one does not count.
  2. Kill the agent process mid-task (`!restart` from the owner channel): the crash
     restart completes the task.
  3. An operator Stop then Start mid-task leaves the task `paused`; so does a
     MindServer UI stop then start (do this only while the owner is connected; §7).
  4. "make me a stone pickaxe" from an empty inventory: the resolver chain
     completes with 1–3 model calls.
- **Metrics.** §2.3; model calls per gather task against the 1–3 target.
- **Exit.** All four trials pass; the craft deadline is confirmed against real
  crafting sync times.
- **Not in S2.** Building, `find`, smelting, underground, places memory.

### S3 — Terrain-fitting shelter

- **Goal.** "Build a small shelter here" works on open ground, among trees and
  against a hillside, in one `build` call, without felling trees or touching the
  owner's builds. Both detail levels work.
- **SPEC.** REQ-BLD-1, 2, 4, 9 … 18, 20 … 28; REQ-BLD-12a, 34; REQ-BLD-29 for
  `catalog` and the `auto` steps 2–3 (the shelter macro, then the catalog by
  explicit name); REQ-PLAN-4, 8; REQ-REC-12 (owner questions, first consumer
  `ask_over_s`); REQ-SAFE-1 … 5 applied to building; the `build` tool (§12.4).
- **Files.**
  - `src/agent/work/`: `site.js`, `shelter.js` (the shelter macro), `verify.js`,
    `steps/build.js` (sources `catalog` and `auto` without the library or in-game
    design; `detail` and `embed` from `work.build.auto_keywords`), `commands.js`
    (`build` tool), `ask.js` (owner questions), `protect.js` (builder hooks, ledger
    tags `scaffold`/`permanent`).
  - Carries: `agent.js` (owner-answer interception in `handleMessage` before the
    model, REQ-REC-12); `npc/build_goal.js` (cell classes, protection at dig and replace, both
    door cells, dig order, face-aware placement, re-read); `library/skills.js`
    (protection before `placeBlock`'s break, door yaw positioning, re-read).
  - `tests/work-site.test.mjs`, `work-build.test.mjs`, `work-verify.test.mjs`.
- **Offline tests** (synthetic block grids, same style as
  `tests/structure-site.test.mjs`):
  - fit: open grass accepted; trees kept (trunk in an `air` cell rejected; leaves
    counted); hillside uses the natural wall; water inside or next to a dug cell
    rejected; the owner's wall satisfies a `solid` cell and is never edited; a chest
    in a floor cell rejects the candidate; `embed: avoid` versus `allow`, set by
    code from the keyword table;
  - source resolution: shelter words go to the macro (even "small house", never the
    catalog house); a request naming a catalog template goes to the catalog; `auto`
    never picks an owner template; no model call is made;
  - owner questions: `pending_question` recorded; only an owner chat message that
    parses to yes, no or an option answers it; a model reply never does; a matched
    answer is consumed before the model (no model call, one "asked X / owner
    answered Y" system line in history); a non-matching owner message reaches the
    model and the question stays pending; the task stays `blocked(awaiting_owner)`
    with 0 model calls, with no timeout, until answered, cancelled or superseded;
  - detail: default `minimal` (open 1×2 entrance, no door); a request that
    mentions a door gives `basic`;
  - builder: `solid` satisfied by stone or dirt; `solid` placed from inventory
    material; both entrance cells prepared; dig order from the entrance; the cell face
    is passed; a wrong facing after placement is not counted; a cell a player
    occupies is deferred, "please step out" is said once with no model call, the
    cell is placed on a later pass, and the wait does not trip the no-progress
    deadline (REQ-BLD-34);
  - protection at the builder's dig and at `placeBlock`'s break;
  - scaffolding uses dirt only; cleanup removes only `scaffold` ledger entries of
    the current build, never a completed structure or a `permanent` placement next
    to it;
  - verifier: the `minimal` and `basic` room checks, including a door with the
    wrong facing failing and `minimal` never reported as mob-proof;
    path checks run with dig, place and scaffolding off;
  - the bill comes from the world diff; catalog templates no longer reject grass.
- **Live acceptance (uncoached, no materials at the start).**
  1. open grass: "build a small shelter here" (`minimal`, open entrance);
  2. among trees: "build a small hut here" (no trunk felled);
  3. against a hillside: "build a small hut with a door here, against the hill"
     (`basic`; natural wall used). Code picks the rotation, so whether the
     doorway's upper cell is occupied at the start cannot be arranged: record it,
     and repeat the trial at another spot until one run has it;
  4. a hillside with water or gravel nearby: "build a small shelter here": a safe
     build or a precise refusal.

  Trials 1–3 **must end in a verified build**; a refusal fails them. Only trial 4
  may pass with a precise safety refusal. For each: one `build` call starts the
  task (plus any `obtain` steps the validator inserted); the build is at the
  frozen anchor; the verifier passes for its detail level; no protected block
  changed (diff within 16); in trial 3 the door closes the doorway; at least one
  night-time interruption survived across the set; the report matches the
  verifier.
- **Metrics.** §2.3; model calls against the 2–5 target; `unstuck` firings.
- **Exit.** All four sites pass; OQ-7 and OQ-8 have rulings; `work.max_leaf_clear`
  has a default.
- **Not in S3.** Parts specs, compiler, sources `owner`, `mine` and `new`, the
  design library, `auto` steps 1 and 4, ladders, multi-storey.

### S4 — Hardening

- **Goal.** The core behaves well around the owner and the single backend.
- **SPEC.** §7.5 (all causes, every step type), §16 items on owner chat; OQ-18.
- **Files.** `work/runner.js`, `work/commands.js` (tool descriptions, e.g. "call
  `task_pause` if the owner wants the bot to stay"); `prompter.js` only if a request
  gate is ruled necessary; docs.
- **Offline tests.** Owner chat during a run: a non-resumable chat action pauses the
  runner and it resumes afterwards; `followPlayer` pauses the task; `!stop` and
  death in each step type (`obtain`, `build`, `go_to`, `give`); summaries
  arriving during a decision request (ordering kept, C04).
- **Live acceptance (uncoached).** During a "build a small shelter here" task the
  owner (1) asks an unrelated question, (2) says "come here", (3) says "stay here
  for now", then (4) "carry on". Expected: (1) the task continues; (2) the bot comes
  and then resumes the task; (3) the task is paused; (4) it resumes and completes.
- **Metrics.** §2.3; summary requests overlapping decision requests; added latency.
- **Exit.** The trial passes; the request-gate decision (OQ-18) is recorded with its
  numbers; the residual list in ISSUES.md is current.
- **Not in S4.** New features.

### DX — Design experiment (offline)

- **Goal.** Decide how Qwen writes designs, with evidence, and seed the design
  library. Protocol in §5.
- **SPEC.** REQ-BLD-3, 5, 6, 7, 24 (fixture form); answers OQ-6, OQ-9, OQ-11, OQ-16.
- **Files.** `src/agent/work/parts.js`, `ops.js`, `compile.js`, the region part of
  `verify.js`; `tests/dx/fixtures/*.json` (flat, hillside, forest worlds);
  `tests/dx/corpus.json`; `tests/dx/rubric.json`; `tests/dx/run.mjs` (makes model
  requests); `tests/work-compile.test.mjs`. A layer-row front end exists only for
  arm C and is deleted if C is not admitted.
- **Offline tests.** Every op; part attachment and stacking; foundations; door
  upper cells; auto-ladder; substitutions listed; regions from flood-fill; bill;
  caps; precise validation errors.
- **Live acceptance.** None in game. The experiment run itself (§5) is the
  acceptance.
- **Metrics.** Those of §5.
- **Exit.** Chosen arm (or the fail branch of §5); frozen `parts/1` schema; caps
  and revision limits set; `embed` tests defined; results summarised in
  RESEARCH.md; valid designs saved as the first library entries.
- **Not in DX.** In-game building, the design tools, source resolution.

### S5A — Structures v1

- **Goal.** Open-ended structures from natural language: hut, cave, tower, base,
  and new requests, through the parts spec, the compiler and the existing builder.
- **SPEC.** REQ-BLD-1 … 34 (all sources, the full `auto` order, `detail`,
  `!saveTemplate`); REQ-PLAN-9 ("design needed"); REQ-TRN-10 tool list with the
  design tools.
- **Files.**
  - `src/agent/work/designs.js` (stores, library, tag matching), `steps/build.js`
    (sources `owner`, `mine`, `new`; `auto` steps 1 and 4 with the "design needed"
    result), `commands.js` (`design_structure`, `list_designs`; owner-only
    `!saveTemplate` built on `worldToBlueprint`), `compile.js` integration,
    `verify.js` (all region types).
  - `shelter.js` replaced by a one-chamber parts spec through the compiler (one
    generator, not two); S3's tests are kept as regression.
  - Carry: `npc/build_goal.js` (ladder cells, suffix parsing, access before upper
    work).
  - `operator/design-session.mjs` (new): the offline design session.
  - `tests/work-designs.test.mjs`.
- **Offline tests.** `auto` order: library tag match, then the shelter macro, then
  the catalog only by explicit name, then "design needed", with no model call
  before step 4; `auto` never picks an owner template; `new` returns "design
  needed" and starts no task; no tool's `perform` makes a model call; with
  `work.design.ingame_enabled: false` step 4 refuses with the reason;
  `!saveTemplate`: refuses if any cell is unloaded, converts `levels[].placement`
  to `blocks[y][z][x]`, maps block names to placing items (`wall_torch` →
  `torch`), turns plants and short grass into air, drops upper door halves and
  second bed cells, refuses unmapped names and regions over
  `work.build.save_template_max`, writes only to the owner folder, is absent from
  tools and docs; the "design needed" result is a string that carries the frozen
  `at`, and the follow-up `build` uses it; exact owner-template lookup,
  ambiguity refusal with matches, Qwen never writes to the owner folder;
  `window` openings only in `basic`; design files carry `by`, tags, request,
  compiler version and validation; ladder placement order; upper-level access;
  every region check on fixtures; in-game revision limit.
- **Live acceptance (uncoached).**
  1. "build a small hut among these trees";
  2. "dig me a little cave into this hill";
  3. "build a two-storey stone tower with a ladder";
  4. "build a small base: two rooms connected by a corridor";
  5. "design me a new …" (a novel structure the owner names at trial time):
     `source: new` → "design needed" → `design_structure` (at most 2 revisions) →
     `build{source: mine, at}` at the original anchor; skipped if DX's fail branch turned in-game design off;
  6. one free request the owner phrases without asking for a new design: `auto`
     resolves it (record which step of the order was used);
  7. "build my template X here" for a template the owner saved earlier with
     `!saveTemplate` (from one of his own builds);
  8. the process restarted during upper-storey work on the tower: it resumes and
     completes.

  Each verified by its contract for its detail level; no protected block changed;
  substitutions and auto-ladders listed in the report. A request resolved from the
  library, the macro or the catalog starts with one `build` call and no design
  work.
- **Metrics.** §2.3; resolved source per build (library, macro, catalog, in-game
  design); revisions used; model calls per build.
- **Exit.** All trials pass; the S3 shelter regression still passes.
- **Not in S5A.** Schematic or image import, layer rows (unless DX admitted them),
  stairs, beds, gable roofs.

### S5B — Surface discovery

- **Goal.** Find blocks, mobs, animals, villagers and structures beyond loaded
  chunks, remember places, report honestly.
- **SPEC.** REQ-FIND-1 … 14, 17 … 19; REQ-SAFE-6, 8; REQ-REC-12 (budget
  extensions as owner questions); answers OQ-5 (live part).
- **Files.** `src/agent/work/places.js` (with the `MemoryBank` backing), `locate.js`,
  `explore.js`, `steps/find.js`, `steps/go_to.js` (place targets),
  `data/structure_signatures.json`, `data/biome_priors.json`;
  `tests/work-find.test.mjs`, `work-places.test.mjs`.
- **Offline tests.** Locator order; full-height scan from the formula; signature
  rules (each row, candidate versus recognised); frontier scoring and the water
  penalty; breadcrumbs and `work_pos` updates; explore legs use `canDig=false`;
  exhaustion records a `pending_question` with 0 model calls; under
  `night_policy: continue` legs run at night, under `shelter` the dusk dig-in
  happens and hiding time is excluded from the budget; places: atomic write, caps, LRU, merge radius, dimension,
  `!savedPlaces` after a restart; hunting forced off during `find{entity}` and
  restored; out-of-scope refusals.
- **Live acceptance (uncoached).**
  1. A block target outside the loaded chunks is found and stored ("find me some
     sand" or another target the owner picks that is not loaded);
  2. an honest exhaustion report for a target that is absent within budget;
  3. "find cows";
  4. "find a village";
  5. the process restarted mid-leg resumes from its breadcrumbs.
- **Metrics.** §2.3; chunks explored; blocks travelled; time hidden at night
  (only under `shelter`).
- **Exit.** All trials pass.
- **Not in S5B.** Underground access, `/locate` by default, explorer maps, boats.

### S6 — Underground and smelting

- **Goal.** Iron-tier items from an empty inventory, safely.
- **SPEC.** REQ-OBT-6 … 8, 10; REQ-FIND-15, 16; answers OQ-19.
- **Files.** `src/agent/work/underground.js` (`descend_to`), `smelt.js` (the
  station-addressed smelting actuator: opens the furnace at the persisted station,
  moves only this step's items; no carry to `skills.js` or `mcdata.js`),
  `data/smelting.json` (furnace recipes, replacing mcdata's input whitelist,
  mcdata.js:256-259 and :285-301, and the check at skills.js:169-172),
  `resolve.js` (mine and smelt nodes, iron tier, fuel, furnace reconciliation,
  inventory re-read per S0's P9), `protect.js` (hazard settings);
  `tests/work-underground.test.mjs`, `work-smelt.test.mjs`.
- **Offline tests.** Staircase digs with neighbour checks; lava turns the tunnel;
  falling block above stops the dig; pickaxe tier required; torches if held; exit by
  the staircase; ore choice by cost; fuel arithmetic; smelt batches ≤ 8; furnace
  inspected after an interruption; `unstuck` is paused during every furnace
  wait, including a wait resumed after an interruption or restart; the actuator
  never opens a furnace other than
  its station and never takes items it did not put in; inputs outside mcdata's
  whitelist (stone → smooth_stone, cactus → green_dye) resolve and smelt.
- **Live acceptance (uncoached).**
  1. "get 10 iron ingots" from an empty inventory;
  2. a smelt interrupted (combat or restart) completes without losing items;
  3. "make me 8 smooth stone" (an input outside mcdata's whitelist);
  4. a precise refusal when the only route meets lava or unloaded terrain.
- **Metrics.** §2.3; blocks dug; time underground.
- **Exit.** All trials pass.
- **Not in S6.** Diamond tier or beyond, Nether, buckets, other acquisition methods.

## 4. S0 probes

Run inside the bot's own process through `!probe(name)` (enabled only by
`work.probes_enabled`), except P1–P2 which call the backend directly. Probes that
place blocks use natural ground at a spot the owner agrees to, and remove only
their own placements afterwards. Results go to
`runtime/diagnostics/probes-<date>.json`.

Probes are measurements, not trials, so the owner may hand the bot what they
need. **Probe kit** (the bot's inventory is stale, so ask the owner for it before
S0): 4 ladders; 1 oak door; 8 dirt (backing column and door frame); 1 furnace (the
P9 test furnace); 2 raw iron (or any 2 smeltable items) and 1 coal; 1 wooden
pickaxe, so P9 can take its furnace back (a furnace drops nothing when broken by
hand), unless the bot is checked to hold a pickaxe before P9.

| # | Probe | Method | Answers |
|---|---|---|---|
| P1 | Backend tool calls | 10 requests with 3 tools (nested `task_start`, scalar `goToPlayer`, no-arg `task_status`) at the 2048 budget; with and without `parallel_tool_calls:false`. Record parse rate, latency, reasoning characters, how many calls per reply, whether nested arguments arrive intact. | OQ-1; S1 route |
| P2 | Prefix cache and prompt layout | 5 consecutive decision turns with a changing tail, for both REQ-TRN-12 arms: (A) dynamic state at the end of the system prompt, before the history; (B) dynamic state after the history. Record cached tokens if reported, else prefill time, and latency. The better arm becomes REQ-TRN-12. | OQ-2; REQ-TRN-12 |
| P3 | Request logging | Provider logs all four request kinds in a short session. | REQ-OBS-1 |
| P4 | Baselines | The two uncoached baselines (S0 slice). | comparison |
| P5 | Loaded area | Count loaded chunk columns and their extent; check that underground blocks are visible in them. | R_load, OQ-5 |
| P6 | Entity range | Over a few minutes, the farthest distance at which each entity type is seen and disappears. | OQ-5 |
| P7 | Ladder | Place a 4-high ladder on a backing column; set a goal at the top; record whether the pathfinder climbs or pillars. | OQ-4 |
| P8 | Door yaw | Place a door in a dirt doorway standing on the wall's perpendicular axis and off it; read `facing` each time. Door facing following yaw is a prediction until this runs. | OQ-4 |
| P9 | Inventory after furnace | Place the kit furnace on natural ground away from any other furnace and check it is empty; open **that** furnace by position (`bot.openFurnace` on the block, not the nearest-furnace `smeltItem`, which could pick and empty an owner's furnace); smelt 2 items; compare `bot.inventory` with the counts after closing and reopening a window; take the furnace back. | OQ-3 |
| P10 | Signature blocks | Check that every marker block name in the signature table exists in the deployed version's registry (offline); live sightings later in S5B. | OQ-5 |
| P11 | Hostile classification | Log entity types seen and `mc.isHostile` for each. | OQ-17 |
| P12 | `unstuck` during stationary work | Count firings during the shelter baseline. | REQ-RES-11 |

## 5. Design experiment protocol (DX)

Needs only the compiler, validator and fixture verifier; no game.

- **Corpus.** 24 requests, 8 per tier, written and frozen before any run in
  `tests/dx/corpus.json`.
  - Simple: hut, cave, shed and similar.
  - Medium: tower with a ladder, two-room base, 12-block wall, lookout on a
    platform and similar.
  - Odd: L-shaped house, round tower, pyramid, bridge and similar.
- **Arms.** A parts only · B parts plus coordinate ops · C parts plus ASCII layer
  rows. Two seeds each: 24 × 3 × 2 = 144 first attempts, plus revisions.
- **Route.** The deployed model and backend, `reasoning_budget_tokens` 2048 (the
  in-game setting). Estimated 1.5–3 hours on the single backend.
- **Per attempt.** Up to 2 validator revisions, each with the precise errors.
- **Measures.**
  - parse rate;
  - valid rate after 0, 1 and 2 revisions;
  - would-verify rate on the three synthetic fixtures (flat, hillside, forest);
  - automatic intent match from `tests/dx/rubric.json`, frozen with the corpus
    (dimensions within the words' range, material words matched to roles, door or
    ladder present when the request implies one);
  - tokens and latency.
- **Decision rule.** Adopt the simplest arm with ≥ 80 % valid after ≤ 2 revisions
  on the simple and medium tiers and ≥ 70 % intent match. Admit ops or layer rows
  only with a gain of ≥ 15 points on the odd tier, without falling below that bar.
- **Fail branch.** If no arm meets the bar, S5A ships **library-only**: designs
  are made in offline design sessions with more revisions and a larger reasoning
  budget, `auto` uses the library and the shelter macro, and in-game design is off
  (`work.design.ingame_enabled: false`; `source: new` and `auto` step 4 refuse
  with the reason).
- **Outputs.** Chosen arm or the fail branch; frozen `parts/1` schema; caps (OQ-6);
  offline revision limit (OQ-11); `embed` tests (OQ-9); every valid design saved to
  the library with `by: model` and tags.

## 6. Review and commit

- **Branch.** Work on `develop`. Concurrent editing sessions use separate Git
  worktrees, never the same tree (operator/README.md convention).
- **Gates before review.** All offline suites (§2.1). New tests reproduce the
  cause they guard, as the existing suites do.
- **Review.** Each slice gets an independent code review and an adversarial review
  of the frozen diff. Fix findings that can happen on the owner's deployment;
  record the rest as residuals in ISSUES.md. A finding that survives two fix rounds
  goes to a design decision.
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
- **Docs.** Each slice updates SPEC (if a requirement changed), PLAN (status),
  ISSUES (residuals), CHANGES (carries) and HANDOFF (next step). DECISIONS is
  append-only and records owner rulings only.

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
designs compile through one ops layer, and transport sits behind the provider.

| Item | Seam |
|---|---|
| Clearing or levelling as an explicit task | a new `clear` step in the registry, using the protection predicate |
| Furniture and decoration (`detail: full`); stairs, beds, gable roofs (yaw-dependent blocks) | exact cells with suffixes plus one builder handler: set yaw, place, verify `facing` |
| Schematic import (`.schem`, `.litematic`, `.nbt`) | a design front end emitting coordinate ops (`by: import`); prismarine-schematic reads the files |
| Image-to-design | a design front end (`by: image`) |
| ASCII layer rows (unless DX admits them) | a design front end |
| Larger design caps | configuration (`work.build.max_cells`, `max_volume`) plus inventory logistics |
| `hunt` (with the `res` bug fixed), trading, buckets, shearing, farming, fishing | resolver methods |
| Diamond tier and beyond | resolver methods and tier data |
| `/locate` by default, explorer maps | locator-chain providers |
| Boats, ocean crossings, Nether, End, strongholds | exploration and resolver methods |
| Multi-task queues | the versioned record (one file becomes a queue) |
| Friends' ownership | `requested_by` in the record; `only_chat_with` |
| Request gate between summaries and decisions | prompter, if S4 rules it necessary |
| Dynamic state after the history in the prompt | prompter, if S0/S1 show it pays (OQ-2) |
| Pi or another loop | the provider interface (REQ-ARC-4 triggers) |
| Upstream #769 adapter | replaces ours if merged with nested params (REQ-ARC-5) |
