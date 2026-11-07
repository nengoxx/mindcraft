# Known qualification limits

The integration can join, follow, batch gather and craft. Small uncoached physical
crafting outputs and goal ending were observed, but repeated autonomous hut trials
did not complete a usable house. Migration is not an autonomy fix. No new gameplay
was performed by the migration worker.

| Area | Current evidence / remaining work |
|---|---|
| Grounding and planning (C01/C05) | Model invented targets, changed geometry and confused nearby block types with completed walls. A clean hut attempt left a partial structure after about 11 minutes; a later explicit repair still had incorrect headroom/door geometry after about 6 minutes. A small checked catalog hut through the existing builder is a possible next trial, not installed work. |
| Native action choice (C02) | Literal native batch gathering succeeded while model-generated single-log code had weak pickup/feedback. Prefer existing batch skills; this does not guarantee the model selects them. |
| Semantic memory (C03) | Summaries still invented causes/current quantities and retained ended construction assumptions. Ordered publication and historical-only profile guidance do not prove model truth or complete task coherence. |
| History ordering (C04) | Actual-method overlap regression reproduced older summary overwriting newer. Reviewed ordered publication fixes that seam; saved/pending/clear/error paths passed. Keep semantic failures separate. |
| Restart (C06) | Loaded stopped state no longer receives the generic restart inference. Active-goal reload can still run native self-prompt plus generic inference; no broad restart redesign. |
| Crafting inventory (C07) | Earlier client counts changed after reconnect. Upstream-derived plugin patches and assisted recipe deltas passed; full grid/cursor capture and reconnect durability remain unverified. Silent-server sync/cleanup can last roughly 80 seconds across retries and conflict with the unchanged 10-second action watchdog. |
| Generated diagnostics (C08) | Valid synchronous code now passes generated lint; direct/literal bot.chat is rejected. Aliases/other chat routes are not globally blocked. `console.log` is rewritten to `log`, which can whisper in-game rather than produce an external diagnostic transcript. |
| Action evidence/reporting (C09) | Migration crafting consumed one log/yielded four planks, but the model invented starting counts and denied the change. The craft result only supplied final stock; the prompt inventory is refreshed on each inference. Deployed `4fd27e5` reports observed input/output counts before/after the craft call and net changes, even on errors. Offline checks and one guided live report passed (logs 12→11, planks 4→8). General truthfulness, server durability and exclusive causation remain unqualified. |
| Coding docs (C10) | Upstream query extraction truncates some quoted newAction tasks at parentheses. All-doc configuration bypasses selection; the separate reviewed extraction fix remains unselected. More available docs did not establish reliable geometry/completion. |
| Goal state (C11) | Explicit stopped-state context is deployed; a later repair set/resumed the same goal through combat but still failed building geometry. Wording influence is not a controlled causal result or automatic goal creation. |
| Command mentions (C12) | The unrestricted regex matched a backticked command name in prose, causing arity rejection and another inference. Deployed `4fd27e5` shares quote/code-aware matching across detection, parsing, truncation and display offsets. Offline checks and a live quoted owner/model exchange passed without execution or retry inference. Literal commands and inline prefaces remain supported; mentions must be quoted/backticked, since bare prose intent remains ambiguous. |
| Site discovery (C13) | Autonomous trial repeatedly found no site and guessed rejected origins. Independently reproduced: the nearest-1,000-air cap can hide a valid site within the advertised range. Search now applies complete footprint validation before Mineflayer's result limit, with an early ground check; obstruction/support rules are unchanged. Offline valid/blocked/unloaded checks pass. This does not establish that a valid site existed at the trial's positions. |
| Generated action feedback (C14) | A five-minute terrain-preparation timeout returned null to the command loop; partial physical work was absent from history. The generated-action wrapper discarded ActionManager's output. It now preserves interrupted observations in history without continuing during defense/stop, and returns available output after timeout. Actual-method interruption/timeout/success regressions pass; model recovery still needs live qualification. |
| Biome grounding (C15) | The second house trial reported `end_barrens` in the overworld and repeatedly reported `frozen_ocean` amid wooded terrain. The observer indexed chunk biome IDs through static minecraft-data instead of the server registry. A regression using the installed registry decoder reproduces wrong labels for remapped and custom biomes. `world.getBiomeName` now uses `bot.registry.biomes`; unknown IDs/unloaded positions return Unknown. Construction reliability and the effect of correcting these labels remain unqualified. |
| Operations | Foreground lifetime is intentional. Remote sessions may lose children when disconnected; no unattended service/keepalive guarantee. A compatible server or LAN world is connection configuration, not a hosting-specific architecture. |

Task `!stop` ends the persistent goal/action and invalidates pending conversational
work; native self-defense may still move, dig or place. Operator Stop disconnects
both components. Generated-code cancellation is strongest while awaiting the
local OpenAI-compatible HTTP request; staging/lint/backoff timing and synchronous
execution remain limits. Coding is not an OS sandbox.

Current scope is capability/reliability first, efficient native batched execution
second. No new planner, external agent layer, building feature, online provider or
server modification is selected here. Unattended companion behavior, multiple
friends/task ownership, iron/smelting and general construction remain unqualified.
Keep stopped work stopped rather than resuming it from these notes.

The first post-C09/C12 house trial used one natural-language request without
mid-task coaching. Qwen set a goal, correctly batched crafting/collection, attempted
site preparation and retained its selected origin across interruption. It did not
complete a house: preparation exceeded its intended height, timed out, and was
followed by an absent-phantom attack, a rejected original-site retry and a return
to movement/grass-underfoot searches. The supervisor ended it after 18m22s for
recurrent nonprogress. Physical terrain clearing occurred; no house blocks were
verified. C13/C14 are narrow harness corrections motivated by that run, not a new
planner or proof of model competence.
