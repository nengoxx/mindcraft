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

`self_prompter.js`, `modes.js` and `process/agent_process.js` remain upstream.
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
- `agent/library/skills.js`, `placeBlock` (S2 fix wave 1): the break-in-the-way
  branch (:744) and the `air` branch (:660) ask the work module's protection
  predicate (`isProtectedForBot`, work/protect.js) first and refuse with the
  reason. Without it `!placeHere` on a chest, or code placing `air`, dug an
  owner's block through `breakBlockAt`, which no `safeToBreak` guards. Reapply
  check: `work-protect.test.mjs` "placeBlock never breaks a protected block in
  its way, nor removes one as air (F1)". Retire with the task layer, or when
  upstream's `placeBlock` consults the pathfinder's `safeToBreak`.
- `agent/library/skills.js`, `tillAndSow` (S2 fix wave 2): before it breaks the
  block above the soil (:1654) it asks the same predicate and refuses a protected
  block. Without it tilling under a slab or carpet broke it through
  `breakBlockAt`. Reapply check: `work-protect.test.mjs` "tillAndSow never breaks
  a protected block above the soil (G11)". Retire with the `placeBlock` carry.
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
