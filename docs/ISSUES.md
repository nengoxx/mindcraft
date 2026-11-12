# Known qualification limits

> **Mapping to the new design ([SPEC.md](SPEC.md), 2026-11-08).** C03 semantic memory, C06 restart and C11 goal state → task record and resume (SPEC §6–7); C01/C05 grounding and C13/C16 site discovery → plan validation and the terrain-fitting functional builder (§8, §11); C02 action choice, C09 reporting and C12 command mentions → tools, `obtain` and fact-based reports (§9, §12).
> C04 history ordering, C07 crafting sync and C15 biomes remain as carries or residuals (§16); C08/C10/C14/C17 concern generated code, which stays outside the task layer. The body below is the pre-design record.

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
| Biome grounding (C15) | The second house trial reported `end_barrens` in the overworld and repeatedly reported `frozen_ocean` amid wooded terrain. The observer indexed chunk biome IDs through static minecraft-data instead of the server registry. A regression using the installed registry decoder reproduces wrong labels for remapped/custom biomes. Deployed `5459fbe` uses `bot.registry.biomes`; unknown IDs/unloaded positions return Unknown. At identical live coordinates, the old label was frozen_ocean and the corrected label forest. Subsequent trials with this fix remained incomplete; see the later results below. |
| Operations | Foreground lifetime is intentional. Remote sessions may lose children when disconnected; no unattended service/keepalive guarantee. A compatible server or LAN world is connection configuration, not a hosting-specific architecture. |

C16: a third trial with C15 fixed stopped incomplete after 6m34s. Three build
attempts at remembered grass locations returned generic obstruction/support
rejections; Qwen navigated between them without verifying or preparing a site.
Goal resumption after combat worked. Memory summaries still mislabeled command
arguments (closeness became dimension) and truncated recent evidence. No verified
house blocks. Only the objective and terminal stop were supplied by the supervisor.

Offline reproduction showed square rotation padding wrongly rejecting an
otherwise valid site. The validator now ignores declared empty-string cells and
wholly unused columns, and native build results include the first observed issue
with coordinate/block/required condition. All 38 focused tests pass, including
rotation, support, explicit-air and unrelated-obstruction guards. This does not
prove padding caused the live rejections or that Qwen will use better feedback
consistently. Live qualification of this correction is recorded in the handoff.

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

The second trial, with C13/C14 deployed as `924eb2a`, lasted 7m01s and again
produced no verified house blocks. It repeated grass searches and rejected guessed
origins, with defense/navigation interruptions and the C15 observation defect.
Only the initial objective and terminal stop came from the supervisor in either
trial. The model/profile/backend stayed unchanged. All 33 focused regressions
pass; the live task is stopped. Next assess construction with corrected biome
observations before claiming a capability gain or selecting further changes.


The fourth uncoached trial on C16 (`457dc0a`) stopped after 13m30s. Generated site
preparation drifted through two lint failures into a larger manual design. Real
partial floor/log placement occurred, then its chosen wood type ran out. Its own
weak verification reported 61 missing cells/no door; that is not full independent
geometry verification. Qwen freed inventory space, collected logs and crafted
40 planks, but resumed the different catalog template. The new result identified
a grass obstruction at (-2433,90,-149), requiring air. Qwen abandoned the partial
build and travelled through three remembered locations without fresh site evidence.
Only initial objective and terminal stop were supplied; same local model/profile.

C17: lint retries omitted the rejected assistant code while passing diagnostic
excerpts. This is independently reproduced through actual generation/ESLint
methods and fixed by retaining the candidate, matching runtime-error retries.
Scope drift remains a model observation, not a proved consequence of this defect.
The first live C16 rejection also crossed the existing 500-character output limit
(515 characters), splitting JSON. Shorter wording fixes that observed case, tested
through the actual command/ActionManager. All 40 focused checks and runtime-method
checks pass; no subsequent house trial has qualified these final corrections.

Remaining priorities: reconcile actual partial structure versus selected template,
retain current work/rejections through summary truncation and combat, and validate
completion truthfully. Do not add a supervisor planner or supply trial coordinates
as a substitute for Qwen's decisions. The task is stopped; partial world edits
remain and must not be mistaken for a completed house or automatically resumed.

## Iteration 1 live findings (S2 trials, 2026-11-08)

Seen on the owner's deployment during the S2 trials; improvement candidates for S3
and later, not yet scheduled.

| Finding | Effect | Idea |
|---|---|---|
| An automatic "your action was interrupted" message arriving while an owner request is answered discards the first reply. | One duplicated model call. | Drop the automatic message while an owner request is in flight. |
| A collect failure after a fight carried no cause; Qwen invented causes ("the storm", "no placed cobblestone"). | Wrong revisions, extra calls. | Done for collect (the reason is now in the block message); extend to other actuators. |
| Obtain counts are held totals; Qwen reasons in deltas ("need 1 more log" → `count=1` while holding 9). | No-op plan steps. | A `more=N` form in the DSL. |
| A stream of self-defence interruptions (phantoms) kept a task at zero progress; the stall rule named only the last interruption; Qwen self-resumed the same stall. | 10-minute stalls, wasted calls. | Report "under attack" with the count; don't self-resume a block with the same cause within minutes. |
| The resolver counts a silk-touch pickaxe as meeting the tool tier, so with only silk-touch pickaxes it never plans a plain one and blocks. | Cobblestone and stone tools blocked while the owner's enchanted tools are held. | Resolve the tool as missing when only silk-touch tools would change the drop. |
| A block report for a task that was cancelled since is still delivered and outranks a newer owner request. | The owner's request was ignored. | Drop reports whose task is no longer current. |
| Cube-clearing trial (2026-11-08): no task step covers clearing, so the model used `!goal` and `!newAction` code. That code dug bottom-up under gravel; self-preservation moved the bot away and killed the action each time, and each restart cost a new code generation (50–80 s). | 11 min and 16 calls with little cleared. | A `clear` step (PLAN §8), or a library helper that clears a box top-down. Profile guidance to dig top-down was ignored by Qwen in the next run. |
| The model widened "stone" to "every non-wood block" and changed the box between attempts (inside only vs. including the outer layer) without telling the owner. | Unclear scope. | State the bounds before clearing (profile asks it; not followed yet). |
| With fresh memory and "the 8 wood blocks" in the request, the model guessed `oak_log`, took the bounding box of every oak log within 64 blocks (trees) and cleared inside it. | The wrong area dug for 5 minutes until `!stop` (natural terrain and trees only; protection held). | Ask the owner for the marker block when it is neither named nor next to the bot; refuse a box far larger than the markers suggest. |
| `!searchForBlock` walks to the nearest block and returned the same marker three times. | Three wasted calls. | A command listing positions of a block type. |
| A pickaxe wears out inside a long `!newAction`; `breakBlockAt` then skips stone ("Don't have right tools") while the code counts on. Mid-goal the model crafted tools with `!craftRecipe` instead of `!taskStart`. | Silent skips, slow manual crafting. | Profile now says to get tools with `!taskStart` (worked live) and to set the goal first (a task without a goal left the bot idle after the pickaxe; fix not yet seen live). |
| `breakBlockAt` had no protection check, so generated code could dig the owner's builds. | Safety gap. | Fixed in the working tree (protection in `breakBlockAt`, air skipped first). |

### S2d live trials, 2026-11-12 morning (an Opus trial lane acting as the owner)

Deployed `17ebb09` by an agent restart. Six nights, stopped early on night 6 by an
agent crash (F4). Report and receipts:
`runtime/diagnostics/i1-build/s2d-review/s2d-live-trials-report.md`. On every night
the sleep made 0 model calls and the night skipped about 5 s after she lay down.
**S2d does not pass its live acceptance yet: a fix slice comes first (F1, F2).**

| Trial | Result |
|---|---|
| No bed | pass (no `[sleep]` line, 0 calls) |
| Mid-`obtain` at dusk | pass: the same step resumed twice, `stalled_s` 0, no call (with F1) |
| Idle at dusk | **fail**: the bed was lost at the pickup (F2) |
| Phantom night (mode-cut cap) | partial: phantoms near, no cut, the cap not exercised |
| Active goal at dusk | not exercised: a gathering goal starts a task, which stops the goal (F5) |
| `!stop` in bed, clear at dusk, full bag | not run (stopped on the crash) |
| Following the owner, a follow still on 10+ min later, crash in bed | not run (need the owner online or restarts) |

| Finding | Effect | Idea |
|---|---|---|
| F1. The first placement fails its whole-bed check every night (5/5): "try 1 failed: the bed was not placed whole where planned", yet 30 s later the same bed checks whole and she sleeps in it. The routine's pickup in that branch does nothing and logs nothing. | One failed try and a 30 s cooldown every night; the placed bed stays put meanwhile, and twice she went back to work leaving it (F3). | Likely cause (code reading, not proven live): `place()` reads the head cell as soon as `bot.placeBlock` resolves (`src/agent/work/sleep.js` ~:631), and the patched `placeBlock` resolves on the foot cell's update only (`place_block.js` ~:28); the head arrives in a later update. Probe first: log both cells' updates after a placement. |
| F2. On night 3 the pickup logged "dug my bed …; collecting it", then at once "lost my bed", with no walk; the item never came back. On every other night the bed came back only by contact pickup. | The P14 black bed is gone; a lost bed means no sleep until she gets another. | Unproven: `drop()` may never recognise a dropped bed item on this server (`getDroppedItem()` through ViaProxy, 26.1), and the item drops from the head half, a block from the foot. Probe: break a bed foot and log the item entities for 2 s. |
| F3. After F1 left the bed placed, her own blocked-task turn ran `!searchForBlock("oak_log", 256)` and walked her about 50 blocks away from it. | A placed bed left far from her at night (white bed at −476 76 1802..1803, recorded `own`); she takes it back only within 16 blocks by day. | Goes with F1: a failed try should take the bed back before anything else runs. |
| F4. The agent process exited while `mode:unstuck` interrupted her `!goToSurface` (the stop watchdog), and was crash-restarted. | One crash; a blocked task record (`tmwd82ldo`) stayed. | Not S2d code; the known unstuck kill (SPEC §4.1). |
| F5. A gathering `!goal` starts a task at once and the S2 rule stops the goal. | The goal-at-dusk trial needs a goal made of one-off commands. | Trial staging only. |
| F6. Shown lines (`alert`, `reply`) are whispers and reach neither the log nor `operator/live.mjs listen`. | The bed-lost and bed-left alerts cannot be checked without the owner. | Log shown lines at debug level, or check with the owner. |

### S2c-fu live trials, 2026-11-12 (an Opus probe lane acting as the owner)

Deployed `168dfd2` by set-agent-settings (new profile text): the ledger folded
version 1 into world `seed:…` (31 entries) and kept 30 scaffold
entries from before. Shown lines are whispers (not logged on the host), so
"shown" means in her history with no `[chat] quiet: dropped` line. Report and
receipts: `runtime/diagnostics/i1-build/s2cfu-review/live-trials-report.md`.

| Trial | Result |
|---|---|
| Restart with scaffold recorded | pass: "kept 30 …", later 67 and 75 after more fights |
| Marker clear (8 dead fire coral markers) | pass: 3 lines (the box statement, the leftovers question, "Task done"), nothing dropped |
| Raw `!tidy`; "tidy up your blocks" in words | worded: answered; raw: the line was dropped as `detail` and returned as the command result (that path logs nothing, so shown is unproven); "Removed 0 …" reads oddly when nothing was removed |
| Owner question during a goal | pass: "48." matched her inventory; the goal's done line shown |
| Pit escape, range 2 and 0 | pass 3/3, every tower block recorded on its first attempt (one run used her last dirt; one unrecorded cobblestone left at −531,66,1741) |
| Tower from a dirt path | no standing still; but a 2-block tower straight up to a goal ended one short 4/4 (also from stone): the goal counted mid-jump before a refused last block. Fixed `a080cff` (landing and reply wait); then 2-block towers 5/5 and 3/3 |
| A night of fights | pass: nothing said on her own; 3 lines dropped, all `detail` |
| Death line | not testable live (invincible); offline tests cover it |

### S2c live trials, 2026-11-11 night (main seat acting as the owner)

Run through the MindServer helper as the owner, near −526 70 1730 (8 dead fire coral
markers, inside x −530..−522, y 70..71, z 1727..1732). Passed: the marker clear
(108/108 in ~35 s, markers kept, start and done reports), the leftovers question
and the box start question (yes and no, no model call; "no" cancels silently as
SPEC §4 says), own blocks cleared with no question, the after-fight tidy (16
blocks over one night), the in-task flag and its sweep on resume, the task-end
tidy, `!tidy` from beside a structure (top-down) and on her pillar (pillar-down),
an owner `!stop` mid-sweep (the rest re-kinded `own` before the command reached
her), `!tidy` sending no sweep while a task ran.

| Finding | Effect | Idea |
|---|---|---|
| The scaffold settle timer passed a plain object to `bot.blockAt`. | The agent process crashed on the first pillar trial. | Fixed (`0645e3f`; the fixture's `blockAt` now needs a Vec3 like the real one). |
| Every process start forgets live scaffold (REQ-OWN-4): the crash and four restarts turned 23 of her pillar blocks into unrecorded cobblestone. | Clutter that a clear then asks the owner about, and tidy never takes. | Weigh keeping scaffold across a clean restart in the scaffold slice. |
| The after-fight sweep does not walk: fights end several blocks from the pillars she built, and plain moves (`!goToCoordinates`, mining out of a pit) have no trigger at all. | About 16 recorded blocks were left out of reach during one night until walked to; each pit escape leaves a 4-block pillar. | The later scaffold slice (walk to own scaffold; tidy after plain moves). |
| A 1-wide pit is a trap: her tower out stalls at the 4th block (the placement at y67/68 shows air, every time, both pits), the task-end tidy then digs the tower down again, and the clear ends "out of reach". | She stays in the pit; clears outside it fail. | Narrowed in S2c-fu (amendment 1): tower placement fixed, futility guard added. The pathfinder placed the tower block while her body was still in the cell and the server refused it; the patch now places once her feet clear it, and resets a tower she cannot clear (at once when she stands in its reference cell, else after 3.5 s) (CHANGES.md, the pathfinder patch; PLAN S2c-fu trial 6). Left: a `GoalNear` of range 2–3 met inside the pit, and one refusal of unknown cause seen after the fix (SPEC §16). After the deploy, a 2-block tower ended one short (the goal counted at her jump's peak before a refused last block); the landing wait fixed it (CHANGES, live 5/5). The refusals happen when the block below is still the client's own prediction; their cause is open (a packet-level probe). |
| Twice, a tower block at −528 66 1749 had no ledger line at all, after a clear had dug the column she stood on; five instrumented climbs later recorded every placement. | One unrecorded block (protected; the clear asked about it). | Unproven theory: the server rejected the dig of the block under her and the client never saw the revert; the tower then never placed there. |
| A fight interrupting a *running* task never logged the in-task flag live (only blocked or resumed tasks did); in each case she ended the fight away from the blocks, and a real-sequence fixture probe sets the flag. | None seen. | Watch for it in later trials. |
| About 14 whispered tidy lines over the trial (5 after night fights); singular "Removed 1 of my scaffold block here." | Chat noise; awkward wording. | `work.tidy.announce` is the owner's call (REQ-OWN-10); fix the singular. |
| A raw owner command interrupts a running fight mode; every raw command is also echoed "*<owner> used …*" (upstream). | Noise. | — |
| "Under a block that stays" is also given when the block above is merely out of reach. | Misleading reason. | Name the out-of-reach block. |
| The model obeyed "toss the phantom membranes" but not "then carry on"; the blocked task waited for `!taskResume`. The block was "inventory full" (S2e). | One extra owner step. | S2e. |

### Upstream `!goToBed` and `!stop` (found in the S2d design, 2026-11-11)

| Finding | Effect | Idea |
|---|---|---|
| Upstream `goToBed` (skills.js:1612) waits in bed with `while (bot.isSleeping) await wait(500)` (:1637) and never reads `bot.interrupt_code`. A `!stop` while it sleeps waits until the server wakes her; past 10 s the stop watchdog kills the process. Code reading; not seen live. | A `!stop` in an upstream sleep that does not skip the night costs a crash restart. | Not fixed (sleep design §12: the nightly sleep is our own routine, `work/sleep.js`, which wakes on an interrupt; `!goToBed` stays as upstream's owner command for beds already in the world). A small carry would add the interrupt check and a guarded `bot.wake()`. |

### Cube-clearing trials, 2026-11-08 evening: analysis

The owner asked the bot to clear everything inside a box marked by 8 stripped
spruce wood blocks (x −104..−93, y 62..69, z 472..486; the inside is 10 × 6 × 13
= 780 cells). Five runs: the first with the S2 profile; the later ones after the
`breakBlockAt` protection fix and profile guidance (see the table above); the
last two with an unbreakable diamond pickaxe from the owner and the bot standing
inside the box. No run finished the whole box. Logs: `runtime/logs/mindcraft-2026-11-08T20-17-29-212Z.log`
(run 1), `…T21-32-54…`, `…T21-38-35…`, `…T21-52-24…`, `…T21-59-01…` (runs 2–5).

What worked: understanding the request; finding the markers with generated code;
the `!taskStart` pickaxe (one call, after the profile change); in run 4, once it
stood next to named markers, it told the owner the bounds, set a goal and planned
the inside top-down, as the profile now asks.

Root causes, by layer, with the fix each needs:

1. **No deterministic clearing (engine).** Clearing exists only as model-written
   code inside `!newAction`, so every attempt costs a code generation (50–80 s) and
   may pick a different box; nothing records progress, and there is no truthful
   final report. Fix: the `clear` step (PLAN §8: box from markers or coordinates,
   top-down, the protection predicate, progress = cells left, resume with no model
   call, a volume cap in config). A smaller interim: a library helper
   (`skills.clearBox`) so the generated code shrinks to one call.
2. **Interruptions end code actions (engine).** `self_preservation` (falling
   gravel) and `self_defense` (phantoms) interrupt all actions; `!newAction` is not
   resumable, so each interruption becomes a fresh model call and new code. Fix:
   the `clear` step (task layer resume), or re-run the last code after a mode
   interruption when it is marked idempotent.
3. **Bottom-up digging (model).** Upstream's loop order is the model's choice; it
   dug under gravel. Partly fixed: `breakBlockAt`'s doc and the profile now say
   top-down. Run 3 ignored it; run 4 planned it. The `clear` step removes the choice.
4. **Silent tool failure (engine).** When the pickaxe wears out, `breakBlockAt`
   returns false ("Don't have right tools") and generated code counts on; the
   action output keeps only its first and last 250 characters
   (`action_manager.js:170`), so the model never sees how much failed. Fix: in the
   `clear` step, obtain a tool through `obtain` when none can harvest the next
   cell, and report counts.
5. **Marker discovery (engine).** `!searchForBlock` walks to the nearest match and
   reports one block; three calls returned the same marker. Fix: a listing
   command (positions of a block type within a range), or marker lookup inside
   the `clear` step.
6. **Guessed context (model).** With fresh memory and "wood blocks", Qwen guessed
   `oak_log`, boxed every tree within 64 blocks and dug that box (run 3).
   Run 1 widened "stone" to "everything" and changed the box between attempts.
   Fix: profile — ask the owner when the marker block is neither named nor next
   to the bot; engine — the `clear` step refuses a box over the configured volume
   and states the box before digging.
7. **Goal and task interplay (prompt).** Run 2 started the pickaxe task without a
   goal, so the bot went idle after it. Profile fixed (goal first); run 4 followed
   it.
8. **Backend outage mid-run (engine and ops).** At 21:56 UTC the model host stopped
   resolving (`EAI_AGAIN`). The coder counts each connection error as "no code
   block" and gives up after 3 ("agent would not write code"); the self-prompter
   stops after 3 replies without a command; the bot answers "My brain
   disconnected" and the goal stalls without telling the owner. Fix: treat
   transport errors separately: retry with back-off, keep the goal paused, tell
   the owner once that the model is unreachable.
9. **Codegen slips (model).** A duplicate `let block` (SyntaxError, one retry
   lost), an assumed diamond pickaxe it did not have, `"pickaxe".includes("axe")`
   re-equipping before every block (`breakBlockAt` already equips the best tool;
   its doc now says so), relative-coordinate API misuse. These shrink as the
   generated code shrinks (items 1 and 5).
10. **Stale memory summary (engine).** The summary said "one marker found" long
    after all were found. Low impact; the task record would replace it.
11. **Latency.** Decisions took 16–45 s and code generations 50–80 s on the local
    model; run 1 spent 11 minutes and 16 calls with little cleared.
12. **Run 5 (the box named by coordinates, the backend reached by LAN address):**
    one goal, one clean top-down loop (about 3 minutes, no interruption), then a
    check. About 18 of 780 cells remained, mostly cobblestone refused as
    protected. That cobblestone is in no placement ledger: most likely the bot's
    own pathfinder pillars from runs 1–3, placed while no task ran (SPEC: such
    placements are not exempt). The owner wants the whole inside gone. Fix to
    design: an explicit owner clear request should cover non-natural blocks
    inside its box (except containers and stations), or the ledger should record
    pathfinder placements made outside a task.
13. **The coder ignored "do not mine, just report"** in the check action and wrote
    a second mining pass with inconsistent counters ("3 broken, 18 failed, 18
    total"). A read-only scan belongs in a command or the `clear` step's report.
14. **False final report.** The bot ended with "Cleared all natural and
    own-placed blocks … 18 remaining are protected, they belong to an existing
    build"; the owner still saw natural stone and dirt, and the cobblestone was
    mostly its own. Why the natural cells failed is not visible: the action
    output keeps only 250 characters at each end (item 4). It first passed the
    report as an argument to `!endGoal`, which takes none (profile wording fixed).
    The owner's ruling (2026-11-08): blocks the bot placed itself (defence
    pillars, scaffolding) should not be protected unless they are part of a
    building. Today only stations placed outside a task, and placements made
    during a task, are exempt (REQ-BLD-22, `work/index.js` `onBlockPlaced`), and
    a new task keeps only stations (`carryStations`); blocks placed before any
    record existed cannot be told apart afterwards. Design both halves with the
    `clear` step: recording non-building placements outside tasks, and an
    owner-scoped clear permission for unrecorded leftovers.
15. **Ops: the host machine's VPN login lapsed** (21:56:28 UTC), so the model
    host's name stopped resolving; the private profile pointed at the host's LAN
    address for one run and was switched back after the re-login.
16. **Found by the design council's adversary (probes, 2026-11-08):**
    `findBlocks` misses blocks inside its radius (the 8th marker, 13.7 blocks
    away, was missed at radius 16; 4–26 % misses by radius), which also affects
    `!searchForBlock` and `collectBlock`; `goToGoal` discards the caller's
    movement settings (skills.js `goToGoal`), so `breakBlockAt`'s "no
    scaffolding" never applies and it pillars with dirt or cobblestone; the
    pathfinder's entity-above check is empty outside path searches, so a
    dig-time check does not protect a player standing on the cell (SPEC
    REQ-BLD-15 and REQ-SAFE-3 overclaim it); the OpenAI client runs with SDK
    defaults (10-minute timeout, 2 retries). Designs: `runtime/diagnostics/i1-build/clear-council/`.
17. **Live probe of pathfinder placements (2026-11-10):** a pathfinder pillar
    fires `blockPlaced(stone, air)` about three times per cell (the old block is
    the pathfinder's predicted stone, state 1; the new block is the server's
    stale air), and the real cobblestone arrives about half a second later as a
    plain block update. So `onBlockPlaced` (`work/index.js`) records task-time
    pathfinder blocks as `air` entries that never match, and those pillars stay
    protected: a second cause of item 12. Fixed by the design's D2 recording
    rule (S2c). Evidence: `runtime/diagnostics/i1-build/clear-council/clutter/live-probe/`.
18. **Ops: MindServer crashes on a `restart-agent` sent while the agent is
    reconnecting** (`src/mindcraft/mindserver.js:219`, no check that the agent's
    socket exists; upstream code). It took the whole operator down once on
    2026-11-10, when a test driver sent the restart twice. Send one restart and
    wait for the agent to log in again.

## Iteration 1 residuals (task layer)

Recorded by slice review; none occurs on the owner's deployment as configured.

| Slice | Residual |
|---|---|
| S0-lite | A `requests.jsonl` line is one provider call: the SDK's own retries and back-off happen inside it and are not visible. |
| S0-lite | A partial write on a full disk can leave a malformed line; calls still in flight when the process exits are never logged. |
| S0-lite | `openai_tools` logs only chat completions: a profile without `url` (Responses API) is unlogged; the shorthand model string `openai_tools/x` without `api` resolves to GPT. |
| S0-lite | Logging parses the response body, so `asResponse()` and the SDK's beta `parse` helpers fail on this client (awaiting `create` and `withResponse()` work). |
| S0-lite | Probe P11 with `minecraft_version: "auto"` falls back to the newest installed dataset; run it with the settings path of a pinned deployment. |
| S0-lite | No rotation of `requests.jsonl` (about 0.5 MB per gather task). |
| S2 | A unit that fails deterministically ("steve is not in view", "could not craft") retries its 3 attempts at once with nothing changed in between, so it blocks within milliseconds; `go_to target=owner` is frozen at validation and blocks at once if the owner walked away. |
| S2 | An unreadable `task.json` is left alone at start-up, but the next `!taskStart` overwrites it without keeping a copy. |
| S2 | A crash restart with no `memory.json` costs one model call (upstream's start-up message, agent.js:214-216). |
| S2 | Default conversation example 22 still uses `!setMode`, which the deployment blocks. |
| S2 | The 120 s no-progress deadline against real crafting sync times (up to about 80 s) and the 10 s stop watchdog: a live check in the S2 trials. |
| S2 | (Retired by S2c: stations live in the placements ledger file, REQ-OWN-1.) The bot's station placements (crafting table, furnace) before its first task ever (no `task.json` yet) were kept in memory only; a crash before that first task forgot them, so such a table stayed protected. |
| S2 | The tree test reads a pure-log structure (logs of one type and no other block type) of at most 64 logs under a natural canopy as a tree, so it is collectable. |
| S2 | Trees over 64 logs are protected by the tree test's component cap and left standing. |
| S2 | Natural trees of different wood types that touch each other are protected (a log of another type counts as a build) and left standing. |
| S2 | Mineflayer's `playerCollect` carries no pickup count, so a give step counts a partial pickup of a stack as the whole stack (needs the owner's inventory nearly full). |
| S2 | `!stop` with a failed record write: memory says cancelled, the disk still says active; a crash restart before the next successful write resumes the stopped task. |
| S2 | The active and blocked task views clip their guidance ("do not use !goal", "Decide with !taskRevise…") for very long objectives; only the finished view reserves room for it. |
| S2 | The tree test's upward rule still protects some natural logs: a trunk tip above its canopy, horizontal branch runs and a stump under a gap can be left standing (safe direction). |
| S2 | Any `!stop`, including the model's own ("stop following me"), cancels a non-terminal task, also a paused one; REQ-SAFE-11 names the owner's `!stop`. The owner can ask again. |
| S2 | A `give` step confirms pickups only during its bounded attempt (the call plus up to 30 s). A pickup after that window, or after an interrupt (self-defence, unstuck, an owner command) ends the wait, is not credited: the step blocks ("dropped N X near P, not picked up", or "not confirmed picked up" on the run after an interrupt or crash) although the owner may hold the items. A later `!taskResume` re-gives the outstanding count if the inventory still holds it, else blocks "have 0 X, N still to give". The owner decides (`!taskCancel` if he has them). |
| S2 | A `give` step's block message says "dropped … not picked up" also when the bot itself picked its drop back up (the items are in its inventory again). |
| S2 | The finished-task view's "You hold now" counts sit in the head, which is clipped before the guidance: a very long objective cuts them off first. |
| S2 | Obtaining raw iron, gold or copper with only a silk-touch pickaxe at hand digs ore blocks (the collect target is the ore itself, so the tool swap does not apply); obtain's no-gain rule stops it after at most 3 chunks (24 ores) and blocks "collected X but got no Y". |
