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
| `models/prompter.js`, `models/gpt.js` | Embedding-disabled setup, coding AbortController propagation/cleanup and signal preservation through adapter retries. Neutral current stopped-state context; active/paused goal text unchanged. Pending HTTP cancellation is tested; synchronous JS is not preemptible. |
| `agent/coder.js` | Generated-only lint permits synchronous code and rejects direct/literal `bot.chat`, directing output through `log`. Existing broader lint remains; this is not a general chat barrier or sandbox. |
| `commands/queries.js`, `npc/build_goal.js`, `npc/controller.js` | Typed structure info/build commands using native templates with bounded site/material checks, paired blocks, interruption/resume and final world verification. Substantial custom actuator behavior; no additional tiny-hut template. |
| `library/skills.js`, `world.js`, `skill_library.js` | Net inventory collection feedback, formatted multiargument code output, corrected top-air predicate and intended text docs fallback without embeddings. No new ranking algorithm. |
| `utils/mcdata.js` | Protocol initialization from loaded settings, logged negotiated protocol and removal of a conflicting movement wrapper. |
| `package.json`, lockfile, seven patch files | Locked official Mineflayer source and native dependency graph, material/enchantment and inherited dependency patches. See below. |
| Runtime migration | Optional `MINDCRAFT_RUNTIME_DIR` helper moves bot outputs only. History/coder/prompter/vision use it; source templates remain at root. No-env storage behavior and root `settings.js` stay upstream. Native `SETTINGS_JSON`/`PROFILES` supply ignored local config. |
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
