# Changes from upstream

Baseline: `e1c1fc3ffa481506c2445fc639e16dba504b5920`. This is a substantial
local behavior patch set, especially the template builder; it is not only settings.
Deployment-specific profiles, endpoints, diagnostics and previous operator notes
are deliberately absent from tracked source.

| Group / source | Retained behavior and reason |
|---|---|
| `agent/action_manager.js`, `agent.js`, commands/actions | Settled serial action cancellation, definitive task stop, pending-response epoch invalidation and factual stop history. Stop must not revive a late command. A true uncancellable action still hits the existing 10-second watchdog. |
| `agent/history.js` | One in-flight summary; pending evidence remains visible until valid publication, ordered prefix removal/archive, invalid/error outputs retained, clear/load invalidates late results. Native 15/5/500 limits remain. This fixes ordering, not semantic truth. |
| `agent.js` restart branch | Suppress only the exact generic restart inference when loaded state is stopped. Active-goal resumption remains native. |
| `models/prompter.js`, `models/gpt.js` | Embedding-disabled setup, coding AbortController propagation/cleanup and signal preservation through adapter retries. Neutral current stopped-state context; active/paused goal text unchanged. Pending HTTP cancellation is tested; synchronous JS is not preemptible. I1 S0-lite: the request kind passed to `sendRequest` (entry below). |
| `agent/coder.js` | Generated-only lint permits synchronous code and rejects direct/literal `bot.chat`, directing output through `log`. Existing broader lint remains; this is not a general chat barrier or sandbox. |
| `commands/queries.js`, `npc/build_goal.js`, `npc/controller.js` | Typed structure info/build commands using native templates with bounded site/material checks, paired blocks, interruption/resume and final world verification. Substantial custom actuator behavior; no additional tiny-hut template. |
| `library/skills.js`, `world.js`, `skill_library.js` | Net inventory collection feedback, formatted multiargument code output, corrected top-air predicate and intended text docs fallback without embeddings. No new ranking algorithm. |
| `utils/mcdata.js` | Protocol initialization from loaded settings, logged negotiated protocol and removal of a conflicting movement wrapper. |
| `package.json`, lockfile, seven patch files | Locked official Mineflayer source and native dependency graph, material/enchantment and inherited dependency patches. See below. |
| Runtime migration | Optional `MINDCRAFT_RUNTIME_DIR` helper moves bot outputs, and since I1 S0-lite the shared `diagnostics/requests.jsonl` (`runtimePath`; unset, the operator's default `runtime/`). History/coder/prompter/vision and the `openai_tools` provider use it; source templates remain at root. No-env storage behavior and root `settings.js` stay upstream. Native `SETTINGS_JSON`/`PROFILES` supply ignored local config. |
| `operator/` | Shared config/control/explicit verified ViaProxy update; adapted existing Windows foreground helpers and Linux foreground ownership/cleanup. No boot service or silent updates. |

`modes.js` and `process/agent_process.js` remain upstream; `self_prompter.js` is
carried since I1 S2b (the outage pause, below).
Native retry: exit code >1 ends parent; otherwise a nonzero/non-SIGINT exit after
at least 10 seconds reloads memory and retries; early crashes stay down. Full manual
Start defaults to memory disabled. This is distinct from an autostart service.

The lockfile pins official Mineflayer archive
`5a252e6d258882b042e60e21c37d552cdf3b3380` (package 4.39.0), minecraft-data
3.119.0, protocol 1.68.0, canvas 3.2.3 and gl 8.1.6. Seven patch files cover
Minecraft data, Mineflayer, pathfinder, PVP, prismarine-item, viewer and protodef.
The Mineflayer patch retains its material fix and exact upstream open PRs
[4195](https://github.com/PrismarineJS/mineflayer/pull/4195) at
`979b6fc36782fe5e2a6c9d11abac6170b416bdfa` and
[4196](https://github.com/PrismarineJS/mineflayer/pull/4196) at
`b18ba87cb5e4858ccd325af6a09749d275fd4906` for crafting-grid reconciliation.
They were not assumed merged. Runtime snapshots and patch-package application
were checked. Older water/rotation/500ms-placement patches were retired against
verified upstream behavior; the native 5-second placement wait remains.

Reapply with the committed lockfile and `npm ci` including postinstall; inspect
all seven patch results. Retire each carry only after equivalent behavior exists
in a selected upstream target and its focused regression/native smoke passes.
For storage, retire the helper only when upstream offers an equivalent configurable
output root. For operators, retain the smallest native process/config interfaces;
do not grow a second task controller. A source rollback does not undo world edits
or private history; preserve the stopped state and stop both hosts before cutover.

Generic examples demonstrate medium reasoning / 2048 thinking / 8192 output.
Those are request fields for a compatible endpoint, not upstream defaults or a
claim of better game performance. Actual private configuration is not published.
All-doc coding context can be selected with native `relevant_docs_count:-1`;
root defaults remain 5. The reviewed query-extraction candidate was not selected
or carried. Configuration changes require a full Stop/Start to refresh cached
MindServer settings unless the runtime setting is explicitly updated too.

C09/C12 changes deployed as `4fd27e5`: `library/skills.js` records
craft input/output inventory immediately before and after the native craft call,
including failures, instead of reporting final possession as crafting success.
`commands/index.js` skips quoted/code mentions while retaining bare inline
commands; `agent.js` uses the matching command's offset for display/translation.
An authorized agent-only restart loaded these changes; main app, proxy and
model/profile settings were retained. A guided live craft report and quoted
owner/model command mention passed. These are narrow checks, not a general
autonomous construction or reliability qualification.

Focused offline regression check, using Node 22 with installed dependencies:

```sh
node --experimental-test-module-mocks --test tests/action-reporting.test.mjs
```

The suite substitutes game data and a fixture bot, runs the actual command,
message-handler, crafting and action-manager methods, and makes no game/model
connection. It covers quote/code mentions, deliberate commands, pre-existing
stock, limited batches, no observed change and partial changes on failure.
Model truthfulness and server inventory durability still need separate evidence.

Subsequent autonomous house testing exposed two additional seams:

- `npc/build_goal.js`: qualify complete sites through Mineflayer's
  `useExtraInfo` filter before applying the result count. Nearby air cells can no
  longer consume the candidate budget before supported sites are considered.
  The existing footprint validator still decides validity; no terrain is changed.
- `commands/actions.js`: preserve generated-action partial output on interruption
  and timeout, matching native actions' interrupted-history behavior. Qwen still
  decides how to recover; successful code/result reports remain unchanged.

Run both focused suites with
`node --experimental-test-module-mocks --test tests/*.test.mjs`.
The first uncoached house trial remains incomplete; see C13/C14 and the qualification
limits in ISSUES. No model, profile, timeout, planner or backend change accompanied
these fixes.

`library/world.js` also resolves biome IDs through Mineflayer's negotiated server
registry, rather than static minecraft-data. Loaded registry IDs can be remapped
or custom; the old lookup supplied misleading environment labels to the model
and status UI. Tests exercise the installed registry decoder and missing data.

C16: the site validator now checks declared template cells rather than the entire
padded bounding box. The controller's square rotation padding and empty-string
cells are untouched by construction and must not reject sites or require support
for wholly unused columns. Required air cells, occupied-column support and resume
checks remain enforced. Rejections carry the first issue's coordinates, observed
block (null means unloaded) and required condition through the native build result.
This is observation, not clearance permission or an automatic terrain planner.
Regressions cover all rotations, unused cells, explicit air, missing support,
unloaded blocks, preservation of unrelated obstructions and builder propagation.

The third uncoached house trial, with corrected biome observations, stopped after
6m34s without construction. Three guessed sites were rejected and Qwen continued
travelling among remembered grass locations. This motivated C16; the padding bug
was reproduced offline, but is not established as the cause of those live
rejections. All 38 focused tests and the operator runtime-method check pass.

C17: `coder.js` now preserves the rejected assistant code before lint diagnostics
in its transient retry conversation, matching the existing runtime-error path.
Previously only diagnostic excerpts survived, so the model had no full candidate
to repair. Actual generator/ESLint regression reproduces that missing context
across successive failures and confirms only the valid candidate executes.
During trial4, a site-preparation request drifted into manual house construction
through two lint failures. Missing repair context is confirmed; its causal share
in that model drift and the behavioral benefit of this fix remain unqualified.

The C16 rejection wording is also shortened: its first live obstruction report
was 515 characters and the unchanged 500-character action-output limit split the
JSON. An actual command/ActionManager regression now confirms that this observed
case arrives intact. This is not a general guarantee for arbitrary long outputs.
All 40 focused regressions and the runtime-method check pass.

I1 S0-lite (REQ-OBS-1): `models/prompter.js` passes the request kind in the
existing `options` argument of `sendRequest`: `decision` from `promptConvo`,
`summary` from `promptMemSaving`, `coding` from `promptCoding` (beside its abort
signal) and `bot_responder` from `promptShouldRespondToBot`. The deprecated
`promptGoalSetting` and the vision path pass none. Why: the new `openai_tools`
provider logs one line per provider call to `$MINDCRAFT_RUNTIME_DIR/diagnostics/requests.jsonl`
and needs the kind to count model calls by kind. A line is one model call as the
bot sees it: the OpenAI SDK's own retries and back-off happen inside that call and
its line; GPT's shorter-context retry is a new call and a new line. Providers with
their own `sendRequest` that takes no options ignore the fourth argument; `gpt.js`,
and `azure.js` which inherits its `sendRequest`, forward it to the OpenAI client,
which ignores the unknown `kind` key (openai 4.104.0). The provider itself is a new file, and the
log root comes from a `runtimePath` addition to the fork's `utils/runtime_paths.js`
(unset, the operator's default `runtime/`). Reapply check: `tests/work-s0.test.mjs`
"the request kind reaches the provider from all four prompter paths". Retire when
upstream passes a request purpose to its providers.

I1 S2 (the task layer, `src/agent/work/`). The carries into upstream files, each
with its reapply check (a test in `tests/`) and retirement trigger:

- `agent/agent.js`: `startEvents(init_message)` builds `this.work` after
  `npc.init()`, and `start` passes the process's `init_message` through. Why: the
  task layer tells a crash restart (`'Agent process restarted.'`) from a fresh
  start (REQ-REC-7). Reapply check: `work-record.test.mjs` "agent.js startEvents
  builds the task layer with the process's init_message". Retire when upstream
  has a persistent task layer of its own.
- `models/prompter.js`: `$SELF_PROMPT` shows the task view whenever a task record
  exists (REQ-REC-10), else upstream's text; `requestOptions` adds the current
  task's id beside the request kind of S0-lite (REQ-OBS-1), and the
  `openai_tools` provider logs it as `task_id`. Reapply checks:
  `work-record.test.mjs` "$SELF_PROMPT shows the task view while a record exists,
  else the upstream text"; `work-s0.test.mjs` "every prompter path logs the
  active task id, and null when there is none (S2)". Retire with the task layer.
- `agent/commands/index.js`: the five task commands join the command list, so
  they parse, appear in `$COMMAND_DOCS` and obey `blocked_actions` like any other
  (REQ-TRN-13). Reapply check: `work-dsl.test.mjs` "the task commands appear in
  $COMMAND_DOCS with the grammar summary". Retire with the task layer.
- `agent/history.js`: the summary cap is the `memory_max_chars` setting, default
  1,000, instead of the literal 500 (REQ-REC-11). Reapply check:
  `work-record.test.mjs` "summary cap honours memory_max_chars (default 1000)".
  Retire when upstream makes the cap configurable.
- `agent/library/skills.js`: `pickupNearbyItems` skips item entities of a type the
  task layer dropped as junk within 3 blocks of the drop point, for 5 minutes
  (REQ-OBT-11); the `item_collecting` mode calls the same function. Without it the
  bot picks its junk straight back up. Reapply check: `work-resolve.test.mjs`
  "pickupNearbyItems skips junk near a drop point, still picks up other items
  there, and junk again after 5 minutes". Retire when upstream's pickup can
  exclude items.
- `agent/library/skills.js`, `placeBlock` (S2 fix wave 1) and `breakBlockAt`
  (I1 cube-clearing trial, 2026-11-08): `placeBlock`'s break-in-the-way branch
  and `breakBlockAt` itself (which `placeBlock`'s `air` branch calls) ask the
  work module's protection predicate (`isProtectedForBot`, work/protect.js)
  before digging a non-air block and refuse with the reason; air, cave air,
  water and lava are skipped as before. Without it `!placeHere` on a chest, code
  placing `air`, or generated `!newAction` code clearing an area dug an owner's
  block through `breakBlockAt`, which no `safeToBreak` guards. Reapply check:
  `work-protect.test.mjs` "placeBlock never breaks a protected block in its way,
  nor removes one as air (F1)". Retire with the task layer, or when upstream's
  `breakBlockAt` consults the pathfinder's `safeToBreak`.
- `agent/library/skills.js`, `tillAndSow` (S2 fix wave 2): before it breaks the
  block above the soil (:1654) it asks the same predicate and refuses a protected
  block. Without it tilling under a slab or carpet broke it through
  `breakBlockAt`. Reapply check: `work-protect.test.mjs` "tillAndSow never breaks
  a protected block above the soil (G11)". Retire with the `placeBlock` carry.
- `agent/library/skills.js`, `collectBlock` (S2 live trial): after `equipForBlock`,
  a silk-touch tool is swapped for a plain one of the same kind (else the bare hand,
  else a refusal with the reason) when the block is not the type asked for and its
  normal drops differ from itself (stone for cobblestone, grass for dirt). Without it
  "16 cobblestone" dug about 195 stone with the owner's silk-touch pickaxe and got
  none. Reapply check: `work-runner.test.mjs` "obtain cobblestone with a silk-touch
  pickaxe and a plain one uses the plain one" and the two silk-touch tests after it.
  Retire when upstream's tool choice accounts for silk touch.
- `utils/mcdata.js`: `isHostile` also excludes `allay` and `copper_golem`, beside
  the iron and snow golems (owner ruling 2026-11-08: golems and allays are not
  hostile, and the base keeps several iron golems). Probe P11 found both classed
  hostile (registry type `mob`), which would make `self_defense` attack them and
  the resume check wait for them. `hoglin`, which the function misses, is
  Nether-only and left as is. Reapply check: `work-runner.test.mjs` "allays and
  golems are not hostile; zombies and creepers are (owner ruling, P11)". Retire
  when upstream excludes them.

No hook into upstream code beyond these: the `!goal`/`!newAction` guard wraps the
two commands' `perform` at work init, the `safeToBreak` patch is installed on
`Movements.prototype` by `work/protect.js`, and placements come from Mineflayer's
`blockPlaced` event. The tracked example profile `operator/examples/profiles/local.json`
gains the summariser wording (no coordinates other than build origins, no
quantities or step progress; under 1,000 characters) and examples that send
gathering and crafting to `!taskStart` (the default examples for those requests
swapped in place, the hand-run crafting goal dropped), with a fallback to the
existing commands when `!taskStart` answers "no method". Construction keeps its
default examples and `!buildStructure` stays unblocked until S3 brings `!build`.
Run the suites with
`node --experimental-test-module-mocks --test tests/*.test.mjs`.

I1 S2b (model outages, `!blockPositions`, movement settings; SPEC §7.8,
REQ-TRN-16). Why: in the cube-clearing trials a backend outage cost the goal
(ISSUES, cube analysis item 8): the coder counted each connection error as "no
code block", the self-prompter stopped after three replies without a command,
and the bot said "My brain disconnected" without telling the owner. Our own new
files are `agent/model_outage.js` (the outage state, the owner notices, the
back-off wait and the recovery probe loop) and the `outcome` seam in
`models/openai_tools.js` (a connection error, timeouts included, or HTTP 5xx sets
`outcome.unreachable`, with only an error code, "timed out", "HTTP <status>" or
"connection error" as the cause; the client's `timeout` and `maxRetries` come
from `work.model_timeout_s` (600) and `work.model_max_retries` (2, for every
call but decisions, which pass `maxRetries: 0` because `promptConvo` retries
them)); `gpt.js` is unchanged. The
four `work.model_*` keys are in `work/config.js`. `!blockPositions` lives in
`work/commands.js` with the complete search (`findAllBlocks`, which also reports
whether part of the radius was not loaded) that S2c's marker search reuses. The carries into upstream files, all new in S2b except where noted:

- `models/prompter.js` (grown): the constructor reads the model keys through
  `loadWorkConfig(profile.work)`, because the prompter is built before `Work`, and
  calls `configureClient` on the providers that have it; `requestOptions` adds an
  `outcome` object, and every path reports it to the outage state (`reachable`);
  `promptConvo(messages, self_prompt)` is a small wrapper that registers the
  turn with the outage state on entry and ends that registration with the turn
  (`try … finally`), around upstream's body, renamed `promptConvoTurn`, which
  sends decisions with `maxRetries: 0` and waits through an outage with back-off
  (5 s doubling to 60 s, up to `work.model_outage_wait_s` from the first
  unreachable reply, no request after it) without spending its 3 tries; it
  returns no reply when a newer message or the owner's `!stop` (`stop_epoch`)
  supersedes the turn (checked in the wait and again just before each request)
  or the wait ends, and only a self-prompted turn ending in its wait sets
  `model_outage.wait_ended`;
  `promptCoding` takes the coder's `outcome`; `probeModel` is the recovery probe
  (one short request with the profile's params, logged as kind `probe`).
  Providers that forward the options to the OpenAI client (`gpt.js`, `azure.js`)
  pass the unused `outcome` key along with `kind`; the client ignores both, and
  honours the decision's `maxRetries`. Reapply checks: `work-outage.test.mjs` "promptConvo
  waits through an outage with back-off …", "promptConvo gives up with no reply
  …", "promptConvo stops waiting when a newer message supersedes the turn",
  "provider: the prompter builds the client with the configured timeout and
  retries …", "promptConvo starts no request once the wait has run out …",
  "decision requests pass maxRetries 0 …", "a stop during the retry's cooldown
  or prompt preparation …", "a recovery while a turn's request is still in
  flight …". Retire when upstream's prompter handles an unreachable model itself.
- `agent/coder.js`: an unreachable model ends generation with "Action stopped: my
  model is unreachable (<cause>); no code was run." only when no execution began
  in that generation session; otherwise "… the code ran N times before that and
  no further code ran", with the last execution's output. The count rises just
  before `executionModule.main`, also for runs that throw. It never counts as a
  "no code block" failure. Reapply checks: `work-outage.test.mjs` "coder: …"
  (two tests). Retire with the prompter carry.
- `agent/self_prompter.js` (new carry): a goal whose own turn ended inside its
  outage wait (`model_outage.wait_ended`, reset before each turn) pauses as
  `PAUSED` with an `outage` flag (a new state would need every `isStopped()`
  consumer and `handleLoad` changed) and saves the history; a failed call
  elsewhere never pauses it, and the loop starts no goal turn while another
  turn is in its outage wait (it pauses instead, so the owner's waiting turn is
  not superseded). The recovery probe (`model_outage.watch`) runs every
  `work.model_outage_probe_s` and, if the goal's `goal_epoch` is unchanged and
  no other turn is still running, resumes it by clearing the flag and setting
  it `ACTIVE`: upstream's `update()` restarts the loop once the agent is idle,
  so an owner action is not cut short. `start()`,
  `stop()`, `pause()`, `setPromptPaused()` and `handleLoad()` clear the flag and
  advance the epoch, so an owner `!stop`, a new goal, a manual pause and `!stfu`
  (conversation.js `_resumeSelfPrompter` calls `start()`) end it; a turn whose
  epoch changed is not counted, and `start()` while a turn is in flight
  supersedes it (`prompter.most_recent_msg_time`), so a late reply for the old
  goal never runs. A loaded outage pause marks the outage state down with no
  notice. Reapply checks: `work-outage.test.mjs` "self-prompter: …" (nineteen
  tests). Retire when upstream's self-prompter tells an outage from a reply
  without a command.
- `agent/history.js` (grown): `save()` writes `self_prompt_outage` beside the
  self-prompter state. Reapply check: `work-outage.test.mjs` "self-prompter: the
  flag survives a save and load …". Retire with the self-prompter carry.
- `agent/agent.js` (grown): `start` creates `this.model_outage` after the
  prompter; `_setupEventHandlers` passes the loaded flag to `handleLoad`, so a
  loaded outage pause restarts the probe; `respondFunc`'s un-awaited
  `handleMessage` call gets a `.catch` that logs the rejected turn;
  `handleMessage` passes its self-prompt flag to `promptConvo`. Reapply
  checks: `work-outage.test.mjs` "self-prompter: the flag survives a save and load
  …", "a rejected handleMessage from respondFunc is caught and logged" and
  "self-prompter: while the owner's turn waits through an outage …". Retire
  with the self-prompter carry; the catch when upstream awaits or guards the call.
- `agent/library/skills.js` (grown): `goToGoal(bot, goal, configure = null)`
  applies `configure` to both of its `Movements` instances after its own
  defaults; before, a caller's movement settings were discarded. `goToPlayer`'s
  stray upstream third argument `true` (no such parameter existed) is dropped, as
  it would now be called. No existing caller passes `configure` yet: S2c's dig
  seam is the first. Reapply check: `work-positions.test.mjs` "goToGoal applies
  configure to both of its Movements instances …". Retire when upstream's
  `goToGoal` takes the caller's movements.

The work fixture (`tests/work-fixture.mjs`) gives its agent a real
`ModelOutage`, as agent.js does.

I1 S2c, part 1 (clearing an area, the placements ledger and the owner
question; SPEC §11.9, §11.10, REQ-REC-12). Why: the cube-clearing trials
(ISSUES, cube analysis) cleared by generated code with no record, no resume and
a false report, and the S2 ledger recorded task-time pathfinder blocks as `air`
(item 17), so the bot's own pillars stayed protected. Our own new files are
`work/ledger.js` (the placements ledger `bots/<name>/placements.json`: kinds
`station`, `scaffold`, `building`, `own`; recording from the placement attempt;
retirement, the `work.ledger_max` cap, forgetting old scaffold at process start
and on chunk unload, the tidy-dig `removing` / `removed_at` states),
`work/dig.js` (`digCell`, the dig seam), `work/steps/clear.js` (the `clear`
step), and `work/ask.js` (the owner-question core: parse and record). The
record no longer holds `placements`: on the ledger's first load the S2
stations migrate from `task.json` once and the key is deleted; the in-memory
list before the first task (`loose`), the station carry (`carryStations`) and
the `blockPlaced` listener in `work/index.js` are gone. The ledger records
through a runtime wrap of `bot.placeBlock` and `bot._placeBlockWithOptions`
installed at work init and removed with the module (no upstream patch). A
`!buildStructure` run's placements are `building` entries of that run through a
runtime wrap of the agent's `npc.build_goal.executeNext`, active only under the
`action:buildStructure` label: the command's `perform` cannot be wrapped,
because `runAsAction` finds its label by `perform` identity (actions.js:12).
The open owner question is disarmed by any other bot chat to the owner and by
an owner message that goes to the model, and posted again (armed once every
line is sent) after the turn that caused it, through runtime wraps of the
agent's `handleMessage` (each call a turn, carried by `AsyncLocalStorage`) and
`openChat` (REQ-REC-12); code reports go through one owner-output queue,
paced 1 s a line, and a question post stops once it is no longer current. The `safeToBreak`
patch and the dig checker add suspicious sand and gravel to the pathfinder's
falling blocks (`gravityBlocks`, movements.js:64-66), per Movements instance. The clear step's movements filter the
pathfinder's generated moves by their placement destination (a per-instance
`getNeighbors` wrap, not `exclusionAreasPlace`, which gets the feet cell for a
forward bridge, movements.js:412-413). `work.clear` (merged one level deep by
`loadWorkConfig`) and `work.ledger_max` join `work/config.js`.

- `agent/agent.js` (grown): in `handleMessage`, after the forced-command block
  and the translation and before the behaviour log and the history add, an
  owner message that answers the task's open `pending_question`
  (`work.answerQuestion`: owner username only, a short yes / no / "yes, chests
  too") is consumed and never reaches the model; anything else goes on as
  before. Why: an owner question costs no model call and the model can never
  answer it (REQ-REC-12). Reapply check: `work-clear.test.mjs` "the answer is
  consumed before the model; other owner chat goes to the model and the
  question stays; …". Retire with the task layer, or when upstream offers a
  hook before the model for code-owned replies.
- Tell A (REQ-OWN-3, not our carry): the recording relies on Mindcraft's
  pathfinder patch writing the predicted stone (`setBlockStateId(dest, 1)`)
  before it calls `bot.placeBlock` (`patches/mineflayer-pathfinder+2.4.5.patch`,
  index.js:571 → :575). Check: `work-ledger.test.mjs` "the installed pathfinder
  writes the predicted stone before it calls bot.placeBlock (tell A guard,
  REQ-OWN-6)", a source check of the installed file. If it fails after a merge
  or a pathfinder bump, apply the dirt-only fallback of REQ-OWN-6 instead of
  dropping the test.

The work fixture gains `bot.setBlock` (a block change with Mineflayer's
`blockUpdate`), a `bot.dig` that writes the predicted air as a `blockUpdate`
first (digging.js:160), goto hooks that move the bot themselves (`'moved'`),
and `clearRecord` also removes the placements ledger; `ownerSays` calls the
agent's own `handleMessage` and `routeResponse` goes through `openChat` (as
agent.js:422 does), so the work layer's wraps run.
