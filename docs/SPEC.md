# Specification — task layer for the Mindcraft fork

This document says **what** the fork must do and **why**. [PLAN.md](PLAN.md) says
how and in what order. Owner rulings are in [DECISIONS.md](DECISIONS.md); they win
over this file if the two ever disagree. Research behind the design is summarised
in [RESEARCH.md](RESEARCH.md). Carried changes to upstream files are recorded in
[CHANGES.md](CHANGES.md); known defects in [ISSUES.md](ISSUES.md).

Requirements are numbered `REQ-<AREA>-<n>`. Slices and tests cite these numbers.
"Must" is a requirement. "v1" means the slices S0–S6 in PLAN.md. Code references
are `file:line` against commit `1297bae`; paths are relative to `src/` unless they
start with `node_modules/`, `docs/` or `runtime/`. Labels such as D4, E1, E1.1, P1
and P1b name the design-council documents a decision came from (RESEARCH.md §7);
everything they decided is stated here, so they are not needed to build.

Contents: 1 Purpose · 2 Scope · 3 Glossary · 4 Capability inventory ·
5 Architecture · 6 Task record · 7 Interruption and resume · 8 Plan mode ·
9 Obtain · 10 Find and explore · 11 Building · 12 Transport · 13 Safety ·
14 Configuration · 15 Observability · 16 Known limits · 17 Open questions ·
Appendix A Interaction coverage.

---

## 1. Purpose and the owner's priorities

The fork is a Minecraft companion bot. The owner talks to it in natural language
("a small house here", "get 40 planks", "find a village"). A local quantized Qwen
model decides what to do. Mindcraft's existing skills act in the world.

Today the bot loses its task when it is interrupted, re-plans from a 500-character
memory summary, and builds only fixed templates on flat, empty ground (see
[ISSUES.md](ISSUES.md), C01–C17). This specification adds a **task layer**: a
persisted task record, a deterministic runner that resumes after interruptions,
high-level world-checked skills, and building that fits the terrain.

Priorities, in order:

1. **Capability.** The bot completes open-ended requests about gathering,
   crafting, smelting, finding things and building. It keeps its task through
   combat, night, creepers and getting stuck, returns to where it was working,
   and reports truthfully.
2. **Efficiency and speed.** Qwen is slow (about 20–75 s per decision). It must
   orchestrate high-level skills, never place blocks one by one. An ordinary
   interruption costs no model call.
3. **Maintainability.** Keep upstream Mindcraft mergeable. Own as little code as
   possible, in a separate module with small hooks. No enterprise machinery.

- **REQ-PRI-1** Qwen is the only gameplay decision maker. No operator-authored
  plans, coordinates or material lists are injected during a task.
- **REQ-PRI-2** Deterministic code executes, verifies, returns to work and resumes.
  It never changes the owner's intent (for example, it never switches designs).
- **REQ-PRI-3** Every completion report is rendered from observed world and
  inventory facts, never from a skill's return value alone.

## 2. Scope and non-goals

### 2.1 In scope (v1)

- Gather any base-game block or item that can be mined, collected, crafted or
  smelted in the Overworld with wood, stone or iron tools (§9).
- Find blocks, items, mobs, animals, villagers and generated structures by
  scanning loaded chunks and exploring on foot (§10).
- Build open-ended structures requested in natural language, fitted to the
  terrain where the owner asks (§11).
- Survive interruptions and process restarts without losing the task (§7).

### 2.2 Vanilla and client-side limits

The server stays vanilla; the bot is an ordinary Mineflayer client connected
through ViaProxy. These limits are facts of the platform, not design choices:

- **REQ-SCOPE-1** No server mods, plugins or datapacks are required.
- The client sees blocks only in chunks the server has sent (the server's view
  distance; vanilla default 10 chunks, about 160 blocks). Underground blocks in
  those chunks are visible without line of sight.
- The client sees entities only within the server's tracking range, which depends
  on entity type and server software.
- The server never tells a client where structures are. `/locate` exists but
  needs operator permission (level 2); it is off unless the owner enables it
  (REQ-SAFE-6).
- The client cannot know who placed a block. "Player-made" is a heuristic (§13).
- Anti-xray (Paper/Purpur option, off by default) can hide ores. On a vanilla
  server this does not apply; the spec records it as a limit only.
- Survival mode: blocks come from inventory; there is no `/setblock` (the `cheat`
  mode stays off).

### 2.3 Non-goals

- **REQ-SCOPE-2** No clearing, levelling or site-hunting unless the owner asks
  for it as its own task (DECISIONS 2026-11-08 "Building fits the terrain").
- **REQ-SCOPE-3** No mandatory owner preview or approval of Qwen's designs.
- No Nether, End, strongholds, ocean crossings or boats in v1 (refused with a
  reason, REQ-FIND-12).
- No trading, hunting, farming, fishing, shearing or bucket use as automatic
  acquisition methods in v1 (deferred, §16).
- No multi-task queue, no friends' ownership (the record has `requested_by` for
  later), no multi-bot coordination.
- No online or paid model; the model route is the owner's local backend.
- No unattended service or keep-alive guarantee (see operator/README.md).

## 3. Glossary

| Term | Meaning |
|---|---|
| **Owner** | The one player allowed to give the bot tasks (`only_chat_with`). |
| **Task** | One owner request being worked on, from `task_start` until done, cancelled or failed. At most one task exists at a time. |
| **Task record** | The file `task.json` that holds the task's state on disk (§6). |
| **Plan** | The task's ordered list of steps, written by Qwen in `task_start`. |
| **Step** | One high-level skill call in the plan, such as `obtain{item:"oak_planks",count:40}`. Steps come from a registry (§8.2). |
| **Run** | One execution of the runner as a Mindcraft action. A run ends normally, or is interrupted; the next run continues the same step. |
| **Runner** | Work-module code that loads the record, checks safety, returns to the work position and executes the current step. |
| **Cursor** | The index of the current step. |
| **Work position** (`work_pos`) | Where the current step is being done. The runner returns here before continuing. |
| **Anchor** | Where the owner asked for the task to happen: `here` (the owner's position if the owner's entity is tracked, else the bot's), `owner` (the owner's position), or explicit coordinates. Code resolves it to `{x,y,z,dim}` and freezes it at validation (REQ-PLAN-8). |
| **Interruption** | A Mindcraft mode (self_defense, self_preservation, cowardice, unstuck) stopping the current run. |
| **Safe-to-resume gate** | The check every run does first: health, nearby hostiles (§7.3). |
| **Self-heal timer** | A work-module timer that restarts the runner when Mindcraft's own resume path did not (§7.4). |
| **Crash restart** | The agent process ran more than 10 s and exited non-zero without SIGINT, and Mindcraft restarted it (`init_message === 'Agent process restarted.'`, no `clean_stop` in the record) (REQ-REC-7). |
| **Fresh start** | Any other start: an operator Start, `load_memory:false`, or a start after a SIGINT stop (`clean_stop`), including MindServer's stop then start. |
| **Blocked** | A step or task that cannot continue without a decision. Costs one model call. |
| **Functional cell** | One cell of a template whose class says what must be true there, not which exact block: `solid`, `air`, `door`, `ladder`, `''` (untouched), or an exact block name (§11.1). |
| **Template** | The existing builder format: `{name, offset, blocks[y][z][x]}` with string cells, as in `agent/npc/construction/*.json`. |
| **Block-state suffix** | `name[prop=value,...]` inside a template cell, e.g. `ladder[facing=north]`. |
| **Design** | Qwen's own description of a structure as a **parts spec**: rooms, walls, platforms and so on, with sizes, relations and materials (§11.2). |
| **Part** | One element of a parts spec: `chamber`, `wall`, `deck`, `passage`, `tower`, `pit`. |
| **Compiler** | Deterministic code that turns a parts spec into a template (§11.3). |
| **Template source** | Where a build's template comes from: `owner` (the owner's own templates), `mine` (Qwen's design library), `catalog` (upstream's four built-in templates), `new` (Qwen designs it in its next turn), or `auto` (code picks: library, shelter macro, catalog by name, then design; §11.8). |
| **Shelter macro** | Code-synthesised, terrain-fitting one-chamber design used by `auto` for shelter-like words; Qwen gives only size and material. |
| **Night policy** | `work.night_policy`: `continue` (default; work and fight through the night) or `shelter` (code digs in at dusk, no model call) (§7.6). |
| **Owner question** | A question code asks the owner and records as `pending_question`; only the owner's reply answers it (REQ-REC-12). |
| **Detail level** | How finished a build is: `minimal` (floor, walls, roof, open 1×2 entrance) or `basic` (adds a door and optional window openings) (§11.8). |
| **Design library** | Qwen's saved, validated designs, made in-game or in an offline design session. |
| **Fit search** | Code that picks origin, rotation and small shifts near the anchor with the fewest edits (§11.4). |
| **Blueprint** | The compiled, fitted template frozen into the task record with its origin and rotation, so re-running a build is idempotent. |
| **Region** | A connected part of a blueprint found by flood-fill: a room, a top surface, a wall run (§11.7). |
| **Verification contract** | The list of functional checks derived from a blueprint's regions. "Done" means every check passes. |
| **Non-natural block** | A block that world generation does not place as terrain: planks, glass, crafted blocks, containers, beds, doors, cobblestone and so on. Protected (§13). |
| **Placement ledger** | Positions where the bot itself placed blocks, recorded from Mineflayer's `blockPlaced` event. These are exempt from protection. |
| **Places memory** | The persisted file `places.json` of named places, resource patches, structures, mob areas, deaths and bases (§10.7). |
| **Locator chain** | The order in which `find` looks for a target: places memory, loaded chunks, `/locate` (if enabled), exploration (§10.2). |
| **Structure signature** | A rule that recognises a generated structure from marker blocks, e.g. a bell means a village (§10.5). |
| **Frontier leg** | One exploration move toward unexplored chunks (§10.3). |
| **Breadcrumb** | A position saved every 32 blocks during exploration. |
| **Search budget** | How long and how far `find` may explore before asking the owner. |
| **Decision request** | A model request that may act (conversation turns). Only these get tools. |
| **Summary request** | A memory-summary, coding or bot-responder request. Never gets tools. |
| **Tool path / text path** | Native tool calls (§12) versus Mindcraft's `!command` text parsing. |
| **Envelope** | `{content, tool_calls}` returned by the new provider on the tool path. |
| **Carry** | A local change to an upstream file, recorded in CHANGES.md with a reapply check and a retirement trigger. |
| **Uncoached trial** | A live test where the owner gives one natural-language request and Qwen alone orchestrates. No mid-task hints. |
| **R_load** | The effective loaded radius measured by the S0 probe. |

## 4. Capability inventory (what exists today)

Status: **works** = usable as is; **partly** = usable with stated gaps; **missing**
= does not exist. "Design use" says how the task layer uses it.

### 4.1 Commands and skills

| Area | Command → skill (file:line) | Status | Facts and gaps | Design use |
|---|---|---|---|---|
| Gather blocks | `!collectBlocks` (commands/actions.js:292-301) → `collectBlock` (agent/library/skills.js:432-554) | partly | Searches only 64 blocks (:489). Collects N **more**, not "up to N" (:471). Aliases ores, dirt→grass_block, cobblestone→stone (:447-455). Tool check (:509-513). Reports net inventory change (:548-553, fork C09). 10-minute timeout. Its target filter uses its own `Movements` (:461, :488), and it sets `dontMineUnderFallingBlock=false` (:462). | Inner loop of `obtain`'s `collect`/`mine` nodes, called in bounded chunks; protected targets are excluded by the `safeToBreak` patch (REQ-OBT-9, REQ-SAFE-3). Not offered as a tool. |
| Pick up items | `pickupNearbyItems` (skills.js:556) | works | — | After digging. |
| Use tool on block/entity | `!useOn` (actions.js:528-537) → `useToolOn` (skills.js:2007) | partly | Generic right-click. | Not used in v1 (buckets, shears deferred). |
| Farming | `tillAndSow` (skills.js:1600) | partly | Skill only, no command. | Deferred method. |
| Craft | `!craftRecipe` (actions.js:303-312) → `craftRecipe` (skills.js:37-131) | works | Counts recipe runs, not items. Uses the first recipe (:97). Places a crafting table from inventory and picks it back up (:57-91). Reports before/after counts (fork C09). | `craft` nodes of the resolver. Not offered as a tool. |
| Craftable list | `!craftable` (queries.js:147) | works | — | — |
| Crafting plan | `!getCraftingPlan` (queries.js:284) → `getDetailedCraftingPlan` (utils/mcdata.js:436) | partly | Returns text. First recipe only (:486-487). Treats smelted items such as `iron_ingot` as base items (`loopingItems`, :391-433). | Not used by the resolver. |
| Item dependency tree | `agent/npc/item_goal.js` | partly | Not reachable from commands. Its executor nests `runAction`, which deadlocks and lets the 10 s watchdog kill the process. `hunt` assigns an undeclared `res` (:163) and throws in strict mode. Blacklists deepslate, stripped, dye items (:7-20). Table rule `>4` ingredients (:45) misses 3-wide recipes. One coal per input (:75-80). | Not used (E1 B.7). |
| Smelt | `!smeltItem` (actions.js:314-328) → `smeltItem` (skills.js:157-288) | works | One input type. Places a furnace from inventory. Fuel: coal/charcoal/blaze rod, then logs/planks (utils/mcdata.js:261-283). Pauses `unstuck` itself (:195). Takes inputs and fuel back on interruption (:266-271). The **command** restarts the process after a successful smelt "to update inventory" (actions.js:320-326). | Not used by the task layer: `smelt` nodes go through the station-addressed actuator `work/smelt.js` (REQ-OBT-6), which pauses `unstuck` itself (REQ-RES-11). |
| Clear furnace | `!clearFurnace` (actions.js:330) | works | — | Furnace reconciliation. |
| Find block | `!searchForBlock` (actions.js:163-176) → `goToNearestBlock` (skills.js:1262-1297) | partly | Loaded chunks only; range 32–512 (cap :1273); walks to the nearest; no memory. | Replaced by `find` (§10). |
| Nearby blocks | `!nearbyBlocks` (queries.js:118) | works | In `$STATS`. | Prompt state. |
| Find entity | `!searchForEntity` (actions.js:178-187) → `goToNearestEntity` (skills.js:1299-1317) | partly | Tracked entities only (`bot.entities`, agent/library/world.js:179-197). | Replaced by `find{entity}`. |
| Entities | `!entities` (queries.js:162); villager profession (world.js:218-258) | works | — | Prompt state; `find` evidence. |
| Biome | `getBiomeName` (world.js:421-435) | partly | Bot position only. Uses the negotiated registry (fork C15). | Exploration biome prior. |
| Structures | — | missing | No recognition. `/locate` never used. | `find{structure}` with signatures (§10.5). |
| Exploration | `!moveAway` (actions.js:189) → `moveAway` (skills.js:1422-1453); item_goal's random 8-block move (item_goal.js:326) | missing | No systematic exploration. | `work/explore.js` (§10.3). |
| Dig down | `!digDown` (actions.js:512-518) → `digDown` (skills.js:1931-1986) | partly, unsafe | Digs straight down under the bot. Checks only the target and the block below for liquid (:1952-1953). No side or falling-block checks, no exit route. | **Not used** (REQ-FIND-15). |
| To surface | `!goToSurface` (actions.js:520) → `goToSurface` (skills.js:1988-2005) | partly | Walks to the highest block at the bot's x,z. | Fallback exit only. |
| Navigate | `!goToCoordinates` (:150), `!goToPlayer` (:128), `!followPlayer` (:139), `goToGoal` (skills.js:1095-1138) | works | `goToGoal` tries a low-dig path, then **falls back to unrestricted digging** (:1110-1124). `followPlayer` is the only resumable action (actions.js:147). | Movement inside steps, under the `safeToBreak` patch (REQ-SAFE-3). |
| Doors | `startDoorInterval` (skills.js:1141), `useDoor` (:1524); pathfinder `canOpenDoors=true` (node_modules/mineflayer-pathfinder/lib/movements.js:114) | works | — | Verification path checks. |
| Build catalog | `!getStructureInfo` (queries.js:16-27), `!buildStructure` (actions.js:35-54) → `BuildGoal.executeNext` (agent/npc/build_goal.js:148-203) | partly | Four fixed templates (agent/npc/construction/). World-diff: places only missing cells, idempotent at the same origin (:172-187). Rotation (:24). Door/bed grouped as one item (:33-50). Site check reports the first issue (:65-106). **Rejects any obstruction, including grass** (:99-102). No `solid` class (`getTypeOfGeneric` at :169, skipped at :180). Prefers the `'bottom'` face (:182). Skips obstruction checks for cells below y 0 (:94), and `placeBlock` breaks what is in the way (skills.js:732-738), so a chest in a floor cell is broken. Upper door cell is never prepared (:177-178). 10-minute timeout; not resumable. | Extended as a carry (§11.6); executes every blueprint. |
| Place one block | `!placeHere` (actions.js:338), `placeBlock` (skills.js:636-814) | works | Takes a preferred face and falls back to others (:752-763). Looks at the support block before placing (:804), which sets door facing. Mineflayer waits up to 5 s for the block to change and throws if it does not (node_modules/mineflayer/lib/plugins/place_block.js:29-43), so `true` means *a* block appeared, not which block or facing. | Builder placement plus re-read (REQ-BLD-20). |
| Generated code | `!newAction` (actions.js:56-89), agent/coder.js | partly | Fork C08/C10/C14/C17 repairs. Not resumable. | **Not offered on the tool path** (§12.4). Stays for the text path. |
| Blueprint tasks | `!checkBlueprint*`, `!getBlueprint*` (queries.js:244-282) | n/a | Evaluation harness only; blocked by default (settings.js:45). | Not used. |
| Inventory | `!inventory`, `!equip` (:240), `!consume` (:232), `!givePlayer` (:220), `!discard` (:278), `!putInChest` (:248), `!takeFromChest` (:259), `!viewChest` (:270) | works | — | Chat-action tools (§12.4); `give` step. |
| Auto-eat | mineflayer-auto-eat, `startAt: 14` (agent/agent.js:192-196) | works | Already eats below 14 food when food is held. | Kept; REQ-SAFE-10 adds the "no food" block. |
| Sleep | `!goToBed` (actions.js:368) → `goToBed` (skills.js:1568) | works | — | Owner text command only; not used by the task layer (OQ-14 closed). |
| Villagers | `!showVillagerTrades` (actions.js:423) → skills.js:1773; `!tradeWithVillager` (:431) → skills.js:1814 | works | Explicit trades only. | Trading as an obtain method is deferred. |
| Combat | `!attack` (:347), `!attackPlayer` (:355), `defendSelf` (skills.js:385), `avoidEnemies` (:1470) | works | — | Modes handle danger; no combat steps in v1. |
| Modes | agent/modes.js:24-304: `self_preservation`, `unstuck`, `cowardice`, `self_defense` (interrupt all actions); `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `idle_staring` (idle only); `cheat` (off) | works | Interrupting modes stop any action. Afterwards an AUTO MESSAGE re-prompts the model unless a resume function is set (modes.js:317-329). `unstuck` fires after 20 s within 2 blocks while an action runs (:102-131) and kills the process if `moveAway` takes over 10 s (:126). `hunting` defaults on (:176); the deployed profile turns it off. | Kept as the reflex layer (§7). |
| Goal | `!goal` (actions.js:400-413), `!endGoal` (:415), self_prompter.js | works | `!goal` cannot be blocked (commands/index.js:18). While the self-prompter is active, resume never runs (agent/action_manager.js:63). | Guarded while a task is active (REQ-RES-9). |
| Places | `!rememberHere` (actions.js:197), `!goToRememberedPlace` (:207), `!savedPlaces` (queries.js:237), agent/memory_bank.js:1-24, death place (agent.js:490) | partly | In RAM only; never saved (history.js:110-126 omits it); no dimension. | Persisted backing with the same API (REQ-FIND-17). |
| Memory | agent/history.js: 15 turns, summary of the oldest 5, cut at 500 chars (:44-45); summaries run in the background (:50-59) | partly | Summaries invent facts and truncate (C03). | Conversation only; working state moves to the task record (REQ-REC-10). |

### 4.2 Mechanisms the design relies on (verified)

| Mechanism | Evidence |
|---|---|
| `runAction(label, fn, {resume:true})` stores `resume_func` (action_manager.js:56-62). | Adversary fixture: a resumable run interrupted by a mode finished 20/20 with no model call. |
| A mode interrupt sends no AUTO MESSAGE while `resume_func` is set (modes.js:317-322). | Code. |
| After a run ends without interruption, `idle` fires (action_manager.js:133-135); one second later the agent calls `resumeAction()` if idle (agent.js:499-508). | Code. |
| `resumeAction()` passes no timeout, so a **resumed** run gets the default 10-minute timeout (action_manager.js:15-17, :56). The first run uses whatever `runAction` was given. | Code. |
| An interrupted or timed-out run emits **no** `idle` (action_manager.js:128-135); nothing resumes it by itself. | Code; adversary fixture stalled at 8/20. |
| An exception inside a run clears `resume_func` (action_manager.js:144). | Code. |
| `stop()` waits for the action and kills the process after 10 s (action_manager.js:27-49). A nested `runAction` inside a running action deadlocks and triggers that kill. | Adversary probe: kill after 10.0 s. |
| Owner `!stop` increments `agent.stop_epoch` (actions.js:94) and cancels resume. | Code. |
| Death cancels resume and stops the action (agent.js:476-479); a death message triggers one model call (:486-497). | Code. |
| A crashed child that ran > 10 s restarts with `load_mem=true` and `init_message='Agent process restarted.'` (process/agent_process.js:42-50). | Code. |
| `sunrise` fires only when `timeOfDay == 0` exactly (agent.js:445-446). Mineflayer's `bot.time.isDay` is `timeOfDay < 13000` (node_modules/mineflayer/lib/plugins/time.js:38). | Code. |
| Pathfinder `Movements.safeToBreak` honours `blocksCantBreak` and `exclusionAreasBreak` (movements.js:270-291). | Code. |
| `_model_map.js` auto-loads any `models/*.js` class with a static `prefix` (models/_model_map.js:10-31). | Code. |
| `promptConvo` rejects non-string generations (models/prompter.js:234-238) and discards a response if a newer message arrived (:253-256). | Code. |
| A falsy command result ends the command loop (agent.js:379-382) and skips `history.save()` (:390). | Code. |

## 5. Architecture

### 5.1 Decision

- **REQ-ARC-1** The task layer is our own module, `src/agent/work/`, inside the
  Mindcraft agent process, connected through small hooks (DECISIONS 2026-11-08).
- **REQ-ARC-2** No Pi agent SDK, embedded or as a separate process.
- **REQ-ARC-3** No rebase onto upstream PR #769. Its `tool_adapter.js` is copied
  under the same name and shape and patched minimally, so it retires cleanly.

Why (details in RESEARCH.md):

| Option | Verdict |
|---|---|
| Own module plus thin hooks | **Adopted.** Reflexes, actions and the builder are in-process. Upstream is quiet (about 2 code commits in 6 months), so a small carry rebases cheaply. |
| Pi embedded | No. Pi provides the model-to-tool loop, which Mindcraft already has. It lacks the task record, a scheduler, resume and building. It is the churning dependency (61 releases and ≥ 8 breaking-change sections in 6 months). |
| Pi as a separate process | No. It needs a command RPC, suppression of Mindcraft's own loop and forwarded interrupt events (≥ 3 core edits) on top of a task layer that must live in-process anyway. |
| Rebase on #769 | No. 28 conflict hunks in 9 files, unreviewed for 6 months, large unrelated scope. |
| PR #812 (task controller) | Concepts adopted (observe/plan/act/verify, persisted progress); code not. |
| Another agent SDK | Rejected for the same reasons as Pi. |

- **REQ-ARC-4 Revisit triggers.** Re-evaluate `pi-agent-core` behind the provider
  interface if (1) our transport/loop code (provider, adapter, the `agent.js`
  branch and the `prompter.js` tool changes) grows past about 400 lines, or we
  find ourselves re-implementing steering, compaction or tool validation; or
  (2) upstream Mindcraft adopts an SDK-based loop.
- **REQ-ARC-5 #769 trigger.** If #769 merges upstream with nested parameter
  support, replace our adapter and provider with upstream's and keep `work/`.

### 5.2 Module layout

| File (under `src/`) | Responsibility | Slice |
|---|---|---|
| `models/openai_tools.js` | New provider (prefix of its own), subclass of `GPT`; request logging; returns the envelope only when tools were requested. | S0 (logging), S1 (tools) |
| `agent/commands/tool_adapter.js` | Copy of #769's adapter, patched for `array`/`object` params and coercion. | S1 |
| `models/native_tools.js` | `parseToolArguments` shim the adapter imports (about 22 lines). | S1 |
| `agent/work/index.js` | `Work` class: init, hook installation, idle watcher, self-heal timer. | S0 skeleton, S2 |
| `agent/work/config.js` | Defaults for every `work.*` setting (§14). | S2 |
| `agent/work/record.js` | Task record load/save (atomic), versioning, transitions. | S2 |
| `agent/work/runner.js` | Runs, safe-to-resume gate, deadlines, step dispatch, reports. | S2 |
| `agent/work/plan.js` | Validation and dry run of plans. | S2 |
| `agent/work/commands.js` | `task_*`, `build`, `design_structure`, `list_designs`; owner-only `!saveTemplate`; `!probe` (S0 only). | S0, S2, S3, S5A |
| `agent/work/steps/*.js` | Step registry: `obtain`, `go_to`, `give`, `build`, `find`. | S2–S5B |
| `agent/work/resolve.js` | Obtain resolver (§9). | S2, S6 |
| `agent/work/protect.js` | Protection predicate, tree test, placement ledger, the `Movements.prototype.safeToBreak` patch and hazard settings. | S2, S6 |
| `agent/work/site.js` | Fit search (§11.4). | S3 |
| `agent/work/shelter.js` | Functional shelter generator. Replaced by a one-chamber parts spec in S5A. | S3 |
| `agent/work/verify.js` | Functional and region verification (§11.7). | S3, S5A |
| `agent/work/compile.js`, `parts.js`, `ops.js` | Parts front end, coordinate-op layer, compiler. | DX, S5A |
| `agent/work/designs.js` | Template sources and design library (§11.8). | S5A |
| `agent/work/places.js` | Places memory and the `MemoryBank` backing. | S5B |
| `agent/work/locate.js`, `explore.js` | Locator chain, exploration. | S5B |
| `agent/work/underground.js` | `descend_to` staircase and tunnel. | S6 |
| `agent/work/smelt.js` | Station-addressed smelting actuator (REQ-OBT-6). | S6 |
| `agent/work/ask.js` | Owner questions: render, record, parse the owner's reply; called by the `agent.js` interception before the model (REQ-REC-12). | S3 |
| `agent/work/view.js`, `report.js` | Task view for the prompt; reports from facts. | S2 |
| `agent/work/data/*.json` | `natural_blocks.json`, `structure_signatures.json`, `biome_priors.json`, `smelting.json`. | S2, S5B, S6 |
| `../tests/work-*.test.mjs` | Offline tests (fixture bot, no game, no model). | every slice |

### 5.3 Core carries (hooks into upstream files)

- **REQ-ARC-6** Edits to upstream files are limited to the table below. Anything
  else goes in `work/` or a new provider file. Each row gets a CHANGES.md entry
  with a reapply check and a retirement trigger.

| File | Change | Status before | Slice |
|---|---|---|---|
| `agent/agent.js` | `this.work` init in `startEvents`, given `init_message` to tell a crash restart from a fresh start; structured tool-call branch inside the stop-epoch checks, before the empty-response break (:329-338); owner-answer interception in `handleMessage`, after the forced-command block (:278-300) and before the history add (:323), so a matched answer to `pending_question` never reaches the model (REQ-REC-12). | fork carry | S1, S2, S3 |
| `models/prompter.js` | Request kind passed to the provider; envelope accepted on the tool path (string checks use `.content`; stale-response check kept); tools only on decision requests; task view into `$SELF_PROMPT`. | fork carry | S0, S1, S2 |
| `agent/commands/index.js` | Register the work commands; export the command list for the adapter. | fork carry | S0, S1 |
| `agent/history.js` | `memory_max_chars` replaces the literal 500 (:44-45). | fork carry | S2 |
| `agent/npc/build_goal.js` | Cell classes, protection predicate at dig and replace, both door cells, dig order, face-aware placement and re-read. | existing fork carry | S3, S5A |
| `agent/library/skills.js` | Protection predicate before `placeBlock`'s break-in-the-way (:732-738); door yaw positioning; post-place re-read. | existing fork carry | S3 |

Estimated total: 4 upstream core files plus 2 existing fork carries, about
80–110 lines (D4 §12). These hooks need no core edit:

- the `!goal` guard (wraps `getCommand('!goal').perform` at work init);
- the `Movements.prototype.safeToBreak` patch (installed once by the work module);
- the `MemoryBank` swap (`agent.memory_bank` is read at call time everywhere:
  agent.js:490, actions.js:202, :211, queries.js:240);
- mode toggles through `bot.modes.pause/unpause/setOn` (modes.js:353-379);
- placement tracking through Mineflayer's `blockPlaced` event
  (node_modules/mineflayer/lib/plugins/place_block.js:44).

## 6. Task record

### 6.1 File and writes

- **REQ-REC-1** One file per bot: `$MINDCRAFT_RUNTIME_DIR/bots/<name>/task.json`
  (the same folder as `memory.json`; `botDataPath` in utils/runtime_paths.js).
- **REQ-REC-2** Every state change is written atomically (temp file plus rename).
- **REQ-REC-3** The record has a `version`. Loading a record with an unknown
  version leaves it untouched and starts with no task (logged).

### 6.2 Fields

| Field | Content | Written by |
|---|---|---|
| `version`, `id`, `revision`, `created_at`, `updated_at` | Housekeeping; `revision` increments on every write. | code |
| `status` + `reason` | `planning`, `active`, `paused`, `blocked`, `done`, `failed`, `cancelled`. | code |
| `requested_by` | Owner username (ready for friends later). | code |
| `objective` | Qwen's restatement of the request. | model |
| `request_text` | The owner's words, verbatim. | code |
| `anchor` | `{x,y,z,dim}`; Qwen gives `here`, `owner` or coordinates; code resolves and freezes it at validation (REQ-PLAN-8). | model intent, code value |
| `plan[]` | `{n, skill, args, status, attempts, no_progress, work_pos, progress, subplan, result}` | model: `skill`, `args`; code: the rest |
| `plan[].progress` | `{metric, start, now, target}` plus step-specific state (see 6.3). | code |
| `plan[].subplan` | Resolver nodes for `obtain` (§9.2); persisted from S2. | code |
| `plan[].result` | ≤ 160 chars, rendered from facts. | code |
| `cursor` | Index of the current step. | code |
| `structures[]` | `{id, source (resolved), name, design_id, design_hash, compiler_version, detail, params, blueprint, origin, rotation, cells_total, cells_missing, verified, verified_at}`; `blueprint` is frozen. | code |
| `site_rejections[]` | Last 5: `{origin, rotation, reason, block}`. | code |
| `gate` | `{refused_since, reason}` while the safe-to-resume gate refuses. | code |
| `interruptions` | `{count, window[], last{by, at, step, pos}}`. | code |
| `restarts[]` | Timestamps of crash restarts. | code |
| `night_blocked` | (retired: night blocks cost no model call under E1.2, so no bookkeeping is needed.) | — |
| `placements[]` | The placement ledger: `{pos, block, build_id?, kind: scaffold|permanent|station, at}` for every block the bot placed during this task, plus `station` entries carried forward from the task it replaced (REQ-BLD-22). | code |
| `pending_question` | `{id, text, options, asked_at}` while code waits for an owner answer (REQ-REC-12). | code |
| `clean_stop` | Set when the agent process receives SIGINT; cleared by startup classification after it is read (REQ-REC-7). | code |
| `metrics` | `{model_calls, resumes, wall_ms}` for this task. | code |
| `notes` | ≤ 300 chars, Qwen's own working note. | model |

- **REQ-REC-4** The model writes only `objective`, the anchor intent,
  `plan[].skill/args` (through `task_start`/`task_revise`) and `notes`. Code writes
  everything else from observation. The model can never mark a step done or set
  `verified`.

### 6.3 Step progress by step type

| Step | `progress` holds |
|---|---|
| `obtain` | metric = inventory count of the item; resolver nodes in `subplan`; smelting station position and pending inputs. |
| `go_to` | metric = distance to target. |
| `give` | metric = count handed over (observed in inventory). |
| `build` | metric = missing cells; `structures[]` entry id; resolved source. |
| `find` | `target, phase, waypoint, visited, rejected, elapsed_s, travelled, breadcrumbs[], return_place, last_evidence, coverage`. |

### 6.4 Lifecycle

| From | Event | To |
|---|---|---|
| — | `task_start` passes validation | `active` (cursor 0) |
| `active` | all steps `done` and verified | `done` (terminal) |
| `active` | step blocked (any cause in §7.5) | `blocked` + reason; one model call, except owner-authorization waits (0 calls) |
| `active` | an ask is pending (REQ-REC-12) | `blocked(awaiting_owner)`; 0 model calls |
| `blocked(awaiting_owner)` | owner answers yes or an option | `active` |
| `paused`/`blocked` | a new task request (`task_start` or the `build` tool) | old task `cancelled(superseded)`; new task `active` |
| `active` | owner `!stop` | `cancelled` (terminal) |
| `active` | death | `paused(died)` |
| `active` | another resumable action replaces the runner | `paused(replaced)` |
| `active` | `task_pause` | `paused` |
| `paused`/`blocked` | `task_resume` or `task_revise` | `active` |
| any non-terminal | `task_cancel` | `cancelled` (terminal) |
| any non-terminal | unrecoverable internal error (record unreadable, step code throws repeatedly) | `failed` (terminal) + reason |

- **REQ-REC-5** At most one non-terminal task. A new task request (`task_start`
  or the `build` tool) while a task is `active` is refused with "a task is active —
  use task_revise or task_cancel". A `paused` or `blocked` task is superseded in
  code: it becomes `cancelled(superseded)` and the new task starts. Its stations
  are carried forward into the new record (REQ-BLD-22).
- **REQ-REC-6** Terminal tasks stay on disk until the next `task_start` replaces
  them (useful for `task_status` and reports).

### 6.5 Restart rules

- **REQ-REC-7 Crash restart.** A crash is only this: the process ran more than
  10 s and exited non-zero without SIGINT (process/agent_process.js:42-50). If the
  record is `active` and the start is a crash restart, re-observe inventory and
  position, then resume the current step with **zero model calls**.
  - MindServer's "start agent" also starts the process with
    `init_message === 'Agent process restarted.'` (`forceRestart`,
    process/agent_process.js:65-83), and "stop agent" sends SIGINT (:60-63). So a
    UI stop then start would look like a crash restart. To tell them apart, the
    work module handles SIGINT: it writes `clean_stop` into `task.json`
    synchronously, removes its handler and re-raises SIGINT, so the parent still
    sees the signal. A start that finds `clean_stop` set is a fresh start.
    Startup classification clears `clean_stop` (atomic write) right after reading
    it, so a later crash in the resumed session is again a crash restart.
  - An agent-only restart for a deploy (MindServer restart or `!restart`, which
    exits with code 1, actions.js:113-117) is a crash restart and resumes an active
    task. That is acceptable; PLAN §7 says to finish or cancel tasks before
    deploying.
- **REQ-REC-8 Restart-storm guard.** Three crash restarts within 10 minutes on the
  same step set that step to `blocked` ("restart storm").
- **REQ-REC-9 Fresh start.** Any start that is not a crash restart (operator
  Start, `load_memory:false`, a start after `clean_stop`). An `active` task loads
  as `paused` and continues only when the owner asks. Stopped work never revives
  by itself.

### 6.6 In the prompt and in memory

- **REQ-REC-10** Whenever a record exists, a compact **task view** of at most
  700 characters (about 200 tokens) replaces the `$SELF_PROMPT` text. It never
  says "no active persistent goal" while a task exists (today's text at
  prompter.js:180). The full blueprint and places memory are never sent.
- **REQ-REC-11** The memory summary covers only the conversation. Its cap becomes
  the setting `memory_max_chars` (default 500 as upstream). The summariser
  prompt tells the model not to record coordinates, quantities or step progress.
- **REQ-REC-12 Owner questions.** When code must ask the owner (`work.ask_over_s`,
  a far or rare target, a search-budget extension, `/locate`), it renders the
  question itself and records `pending_question {id, text, options, asked_at}`;
  the task is `blocked(awaiting_owner)` and no model call is made. Only an owner
  chat message (owner username only) that a simple code parse matches to yes, no
  or one of the options answers it. The model never answers on the owner's
  behalf, and no tool can set the answer.
  - **Interception before the model.** The `agent.js` carry (§5.3) checks
    `pending_question` first in `handleMessage`, for owner messages only: after
    the forced-command block (agent.js:278-300) and before the message is added
    to history (:323). A matched answer is consumed there and never reaches the
    model; code writes one system line into history ("asked X / owner answered
    Y") and the task continues. An owner message that does not match goes on to
    the model as usual, and the question stays pending.
  - There is no timeout: the task stays `blocked(awaiting_owner)` until it is
    answered, cancelled or superseded (REQ-REC-5).
  The first consumer is `ask_over_s` in S3.
- The task view contains: status and reason, objective, step `n/N` with skill and
  short args, progress `now/target`, distance from `work_pos`, last interruption,
  the current blocker, and for `find` the one target line (for example "village
  (bell) 340 blocks NE").

## 7. Interruption and resume

### 7.1 Mechanism

- **REQ-RES-1** The runner starts as
  `runAction('action:task', run, {resume:true, timeout:-1})`. That stores
  `resume_func` (action_manager.js:56-62).
- **REQ-RES-2** An interrupting mode stops the run. Because `resume_func` is set,
  no AUTO MESSAGE and no model call follow (modes.js:317-322). When the mode's
  action ends, `idle` fires and Mindcraft calls `resumeAction()` one second later
  (agent.js:499-508).
- **REQ-RES-3** Each run: reload the record; run the safe-to-resume gate (§7.3);
  if the bot is more than `work.return_radius` (6) blocks from `work_pos`, go back;
  then re-run the current step idempotently. `obtain` recomputes the shortfall
  from inventory; `build` re-diffs the frozen blueprint at its stored origin;
  `find` continues from its breadcrumbs.
- **REQ-RES-4** The runner catches every operational failure itself. It
  re-observes, then retries within `attempts` or marks the step `failed` or
  `blocked`. It never throws out of `run` (an exception would clear `resume_func`,
  action_manager.js:144).

### 7.2 Deadlines

- **REQ-RES-5 No-progress deadline.** Every actuator call inside a run has a
  no-progress deadline of `work.no_progress_s` (45 s): no inventory, world or
  position change. On expiry the runner calls `agent.requestInterrupt()`
  (agent.js:236-244) and ends the run. It never clears `interrupt_code` and never
  retries inside the same run. The next attempt starts from the self-heal timer;
  `attempts` is counted in the record. A bare `Promise.race` is never used.
  Craft calls get their own deadline, `work.craft_no_progress_s` (120 s), which
  covers crafting sync on a silent server (about 80 s, C07). A build pass that
  is only waiting on cells a player occupies does not count as no progress
  (REQ-BLD-34).
- **REQ-RES-6 Run bound.** A run ends itself normally after `work.run_deadline_s`
  (300 s) of work, so `idle` fires and the next run continues. Reason: a resumed
  run inherits a 10-minute ActionManager timeout (§4.2), and a run that times out
  is never resumed by Mindcraft. The bound is checked between actuator calls,
  never in the middle of one.
- **REQ-RES-7** Long skills are called in bounded chunks: `obtain` collects or
  crafts in chunks; a build pass places at most a bounded number of cells.

### 7.3 Safe-to-resume gate

- **REQ-RES-8** The first thing each run does. It passes when health ≥
  `work.min_health` (10) or health is rising, and no hostile is within
  `work.danger_radius` (8) with a clear path (the same test `self_defense` uses,
  modes.js:163-164). If it fails, the run records `gate.reason` and
  `gate.refused_since`, returns, and lets the modes act.
- After `work.max_unsafe_wait_s` (120 s) without passing, the step becomes
  `blocked` with the reason (for example "health 6, no food"). One model call.
- While the owner's server makes the bot invincible (no damage, drowning or
  hunger), the health and food gates are configured but never trigger. There is
  no special invincibility code.
- Idle-triggered retries come every second; a model-free retry costs nothing.

### 7.4 Self-heal timer and guards

- **REQ-RES-9 `!goal` guard.** While a task is non-terminal, `!goal` is refused
  with "a task is active — use task_revise/task_cancel". The self-prompter stays
  stopped in task mode, because `resumeAction` does nothing while it is active
  (action_manager.js:63).
- **REQ-RES-10 Self-heal timer.** When the task is `active`, `resume_func` is ours,
  and the agent has been idle for more than `work.stall_s` (15 s), call
  `resumeAction()`. This covers runs that ended interrupted (no `idle`) and
  timed-out runs.
- **REQ-RES-11 `unstuck` pause.** At the start of stationary steps (building,
  crafting) the runner calls `bot.modes.pause('unstuck')`. `idle` un-pauses all
  modes (agent.js:502; modes.js:400-402). The smelting actuator `work/smelt.js`
  (REQ-OBT-6) pauses `unstuck` during every furnace wait, including a wait
  resumed after an interruption or restart (it does not rely on `smeltItem`,
  which pauses it only inside its own call, skills.js:195). Movement steps leave
  `unstuck` on.
- **REQ-RES-12 Non-blocking report.** The runner never awaits `handleMessage`
  while it is the running action. It finishes the run, then posts its report with
  `setTimeout`. The report needs no model call unless `work.report_with_model`
  is true.

### 7.5 Causes, detected from real events

| Cause | Detected by | Result | Model calls |
|---|---|---|---|
| Mode interrupt (combat, creeper, low health, unstuck) | mode action label | resume on `idle` | 0 |
| Run ended by no-progress deadline or timeout | runner / self-heal timer | resume by timer; `attempts++` | 0 |
| Crash restart | `init_message` and no `clean_stop` | resume (REQ-REC-7) | 0 |
| Night (`continue`) | — | work goes on; combat modes interrupt and resume | 0 |
| Night (`shelter`) | dusk or repeated night interruptions | code dig-in; resume after the night (REQ-RES-15) | 0 |
| Owner `!stop` | change in `agent.stop_epoch` | `cancelled` | 0 |
| Death | bot `death` event | `paused(died)`; the existing death prompt | 1 |
| Replaced by another resumable action (e.g. `followPlayer`) | action label at the next idle | `paused(replaced)` | 0 |
| Non-resumable owner action (e.g. `goToPlayer`) | action finishes, `idle` | runner resumes | 0 |
| Repeated interruptions ≥ `work.max_interrupts` (6) within `work.interrupt_window_s` (300 s); under `night_policy: continue`, hostile-mode interruptions at night (`timeOfDay` 13000–23000) do not count | record | step `blocked` | 1 |
| Pending owner question (REQ-REC-12) | record | `blocked(awaiting_owner)` | 0 |
| Search budget exhausted (REQ-FIND-10) | record | `blocked(awaiting_owner)` with the report | 0 |
| Gate refused > 120 s | record | step `blocked` | 1 |
| Restart storm | record | step `blocked` | 1 |
| Plan revision | `task_revise` | — | 1 |

- **REQ-RES-13** Cancellation causes are recorded from these events, never
  inferred from a missing `resume_func`.

### 7.6 Night policy (owner amendment E1.2)

- **REQ-RES-14 Night policy.** `work.night_policy: continue | shelter`, set in the
  bot profile with the other work settings; default **`continue`**. The owner's
  server currently makes the bot invincible, and digging in would stop it fighting
  and working. (Replaces the earlier rule that a night block cost a model call.)
  - `continue`: no dusk dig-in, no daytime-only exploration, no night blocking.
    Combat modes fight as usual and the runner resumes after every interruption.
  - `shelter`: at dusk, or when night interruptions repeat, code digs in with a
    1×1 cover, with **no model call**, and resumes by REQ-RES-15.
- **REQ-RES-15** Under `shelter`, the self-heal timer resumes a sheltered step with
  no model call once the night has passed (`bot.time.timeOfDay` has wrapped from 24000 to
  the next day) and is below `work.night_resume_before` (12000). It does not rely on
  the `sunrise` event (fires only at exactly 0) or on
  `bot.time.isDay` (still true until 13000, i.e. at dusk).

### 7.7 Model calls per event (summary)

0 for combat, creepers, unstuck, timeouts, crash restarts, night (either
policy), pending owner questions and search exhaustion. 1 each for a death, a
blocked step and a plan revision.

## 8. Plan mode and validation

### 8.1 Starting a task

- **REQ-PLAN-1** Qwen plans in the same call that receives the request:
  `task_start(objective, anchor?, steps[])`. Steps are native JSON array arguments
  on the tool path. If the S0 tool probe fails, a compact DSL string is the
  fallback (PLAN S1).
- **REQ-PLAN-2** `task_start` validates, persists, schedules the runner
  asynchronously, saves its one-line confirmation to history explicitly, and
  returns a falsy value so no follow-up inference happens (agent.js:379-382;
  `history.save()` at :390 is skipped otherwise).

### 8.2 Step vocabulary

| Step | Arguments | Meaning | Slice |
|---|---|---|---|
| `obtain` | `item, count` | Have at least `count` of `item` in inventory (§9). | S2 (wood/stone), S6 (iron, underground) |
| `go_to` | `target`: `here`, `owner`, `{x,y,z}`, or a place name/id | Arrive within 2 blocks. | S2 (places from S5B) |
| `give` | `player, item, count` | Hand items to a player. | S2 |
| `build` | `what, source?: owner|catalog|mine|new|auto` (default `auto`), `name?, detail?, at?, size?, material?` | Build a structure; code resolves the source, `detail` and `embed` with no model call (§11.8). Also a tool (§12.4). | S3 (`auto` via the shelter macro and catalog by name; `catalog`), S5A (`owner`, `mine`, `new`, full `auto`) |
| `find` | `target:{kind: block|item|entity|structure, name}`, `budget?` | Observe and record a target (§10). | S5B |

- **REQ-PLAN-3** New skills are added to the registry without changing the record
  schema (`skill` + `args`).

### 8.3 Validation (deterministic, `work/plan.js`)

- **REQ-PLAN-4** Before anything executes, check:
  - item, block and entity names exist in the negotiated registry (`bot.registry`);
  - counts ≤ `work.max_obtain_count` (256);
  - at most `work.max_steps` (8) steps;
  - shelter interior size within 2–5;
  - `find` kinds are known; structure names are in the signature table;
  - out-of-scope targets are refused with the reason (REQ-FIND-12);
  - `build` with `source: owner` needs an exact owner-template name; an ambiguous
    name is refused with the list of matches; `auto` never resolves to an owner
    template (REQ-BLD-29); the source is resolved here, before execution;
  - **materials:** the shelter macro or the compiler is dry-run against the
    inventory plus earlier `obtain` steps. A shortfall becomes an inserted
    `obtain` step, or a precise error;
  - **tools:** digging stone or deepslate `air` cells needs a pickaxe that can
    harvest them; a missing one becomes an inserted `obtain wooden_pickaxe` (or
    the matching tier), or the step is refused with the reason.
- **REQ-PLAN-5** All errors come back together in one tool result.
- **REQ-PLAN-8 Anchor freeze.** `here` resolves to the owner's position when the
  owner's entity is tracked, otherwise to the bot's position. Every anchor (and
  every `at`) is resolved and frozen during validation, before prerequisite steps
  are inserted or run, and kept unchanged through resume and restarts.
- **REQ-PLAN-9 Design needed.** In-game design is never a model call nested inside
  a tool. When a `build`'s source resolves to "design needed" (`source: new`, or
  `auto` step 4), validation starts no task and returns a structured result
  `{design_needed: true, what, constraints, at}`, where `at` is the anchor frozen
  by REQ-PLAN-8, so the follow-up `build` uses the same place. The result is
  serialized as a string, because the command loop writes a command's result to
  history as a system message (agent.js:379-380). It is a non-empty string, so
  the loop continues: Qwen's next turn calls `design_structure{request_text,
  parts}`, then `build{source: mine, name: <design_id>, at}` with the returned `at`. If in-game design is
  turned off (`work.design.ingame_enabled: false`, PLAN §5 fail branch), the
  result is a refusal with the reason instead.

### 8.4 Re-planning

- **REQ-PLAN-6** `task_revise(from_step, steps[])` replaces unfinished steps only.
  Done steps are kept.
- **REQ-PLAN-7** Changing a partially built design must be explicit. The runner
  never silently switches designs (the fourth house trial's failure, ISSUES.md).

## 9. Obtain resolver

- **REQ-OBT-1** `obtain{item, count}` is resolved by our own `work/resolve.js`,
  built on the data helpers in `utils/mcdata.js` (`getItemCraftingRecipes` :218,
  `getItemSmeltingIngredient` :285, `getItemBlockSources` :303, `getBlockTool`
  :328, `getFuelSmeltOutput` :271) and the registry's `harvestTools`. It does not
  use item_goal's executor or `getDetailedCraftingPlan`.

### 9.1 What it computes

- **REQ-OBT-2** Count-target nodes `{have: item ≥ n, method: craft|smelt|mine|collect,
  via, tier_req}`, stored in `plan[].subplan`, sorted so prerequisites come first.
- **REQ-OBT-3** On every run each node is re-evaluated against the current
  inventory. "Collect N more" never appears; resuming is idempotent.
- **REQ-OBT-4** Crafting: recipe yields and leftovers (`ceil(need/yield)` runs);
  alternatives chosen by cost; the crafting-table requirement taken from the
  recipe shape (3-wide or 3-high needs a table), not item_goal's `>4` rule.
- **REQ-OBT-5** Tool tiers from `harvestTools`. The wood → stone → iron chain is
  derived automatically.

### 9.2 Smelting and fuel

- **REQ-OBT-6** Smelting runs through a **station-addressed actuator** in the
  work module (`work/smelt.js`), not through `skills.smeltItem` or `!smeltItem`.
  Reasons: `smeltItem` picks the nearest furnace (skills.js:177) and takes back
  all remaining input and fuel (:266-271), so it could empty the owner's furnace;
  it accepts only a short whitelist of inputs (mcdata.js:256-259 `isSmeltable`,
  checked at skills.js:169-172; outputs at mcdata.js:285-301); and the command
  restarts the process (actions.js:320-326). The actuator opens the furnace at the
  persisted station position (`bot.openFurnace`), puts in and takes out only what
  this step put in, and works in batches of at most `work.smelt_batch` (8), so
  progress shows in the inventory.
- Smelting recipes come from a work-module data table,
  `work/data/smelting.json` (input → output, for example raw ores → ingots,
  sand → glass, cobblestone → stone, stone → smooth_stone, cactus → green_dye,
  log → charcoal, clay_ball → brick, foods). minecraft-data has no furnace recipes
  (its data for these versions lists crafting `recipes` only), so this table is the
  one source; no carry to `mcdata.js` or `skills.js` is needed.
- **REQ-OBT-7** Fuel: coal or charcoal (8 items each), or planks (1.5 items each,
  mcdata.js:271-283). Fuel need is `ceil(n/8)` coal for n items.
- **REQ-OBT-8** The station position and pending inputs are persisted in step
  progress. The station is a furnace in the ledger (placed for this task, or a
  `station` entry carried forward from the task it replaced, REQ-BLD-22) or one
  the owner authorised. After an interruption or restart the
  furnace is inspected before it is refilled.
- Inventory after furnace use: upstream restarts after every smelt "to update
  inventory" (actions.js:320-326). S0 probes whether the client inventory goes
  stale (OQ-3). If it does, the resolver re-reads it (close and reopen the window)
  or uses a controlled restart-and-resume.

### 9.3 Collection

- **REQ-OBT-9** `collect`/`mine` nodes call `skills.collectBlock` in bounded chunks.
  Protection needs no extra filtering here: the single protection mechanism
  (REQ-SAFE-3) patches `Movements.prototype.safeToBreak`, which both
  `collectBlock`'s target filter (its own `Movements`, skills.js:461, :488) and the
  collect plugin (node_modules/mineflayer-collectblock/lib/CollectBlock.js:70-72)
  call. Protected blocks are therefore never selected as targets.
- **REQ-OBT-10** Exposed ores are reached by path; buried ores through
  `descend_to` (§10.6).

### 9.4 Inventory

- **REQ-OBT-11 No automatic discarding of the owner's items.** A full inventory
  blocks the step with a report, or deposits to a chest the owner has authorised
  (a named place). The only exception: surplus picked up during this task that no
  step needs, and only if `work.allow_drop_task_surplus` (false) is true.
- **REQ-OBT-12** Unobtainable items in v1 (Nether, End, trade-only, structure loot,
  animal-only drops) are refused at validation with the reason.

## 10. Find and explore

### 10.1 Vocabulary and results

- **REQ-FIND-1** `find{target:{kind: block|item|entity|structure, name}, budget?}`
  observes and records. It completes when there is a current matching observation
  with its position. Approaching or acting on the target is a separate step.
- **REQ-FIND-2** Results are honest: `found` (with position and evidence),
  `not_found_within_budget` (with coverage), `unsupported_method`, `unreachable`.
- A `find{kind:item}` target is resolved to its sources (blocks, entities) first.

### 10.2 Locator chain

- **REQ-FIND-3** In order:
  1. places memory (a recent, non-depleted entry);
  2. a loaded-chunk scan: `findBlocks` with `maxDistance = √(R² + H²)` and a
     horizontal filter, so full height is covered (Mineflayer's radius test is
     spherical, node_modules/mineflayer/lib/plugins/blocks.js:185); `bot.entities`
     for entities; the signature table for structures;
  3. `/locate`, only if `work.find.allow_locate` is true and the server permits it;
  4. exploration (§10.3).
- **REQ-FIND-4** Scans run incrementally (throttled, on `chunkColumnLoad`) so they
  do not stall the 300 ms mode loop, and write what they see (target ids plus the
  signature set) into places memory.

### 10.3 Exploration

- **REQ-FIND-5** Frontier legs on the chunk grid, scored by unexplored chunks, a
  biome prior (`work/data/biome_priors.json`) and a water penalty (no boats).
  Waypoints are at most R_load/2 away, so pathfinder goals stay in loaded chunks.
  Failed approaches are blacklisted for this search.
- **REQ-FIND-6** Breadcrumbs every `work.find.breadcrumb_blocks` (32) go into step
  progress. `work_pos` is updated at each accepted waypoint (otherwise the return
  rule would drag the explorer back to its start).
- **REQ-FIND-7 Night.** Under `work.night_policy: continue` (default),
  exploration runs day and night. Under `shelter`, legs start only while
  `timeOfDay < work.find.dusk_tick` (11500); at dusk the bot digs in with a 1×1
  cover and resumes by REQ-RES-15; hiding time does not count against the budget.
- **REQ-FIND-8** Exploration moves on the surface without digging: explore legs
  use a `Movements` with `canDig=false` (the protection patch alone would still
  let them dig natural blocks).

### 10.4 Budgets and asking the owner

- **REQ-FIND-9** One default budget: `work.find.budget_s` (600 s) or
  `work.find.budget_blocks` (512) from the search anchor, whichever comes first.
  Return time is reserved.
- **REQ-FIND-10** Exhaustion blocks the step as `blocked(awaiting_owner)` with
  coverage and evidence, as a templated owner question (REQ-REC-12; no model call),
  e.g. "explored 140 chunks within 512; no desert seen; nearest unexplored frontier
  W. Go further? (yes/no)".
- **REQ-FIND-11** Ask the owner (REQ-REC-12) before exceeding the budget, before
  starting a target listed in `work.find.ask_targets` (far or rare), and before
  using `/locate`. Only the owner's answer extends a budget; Qwen cannot.
- **REQ-FIND-12** Refused in v1, with the reason: Nether and End targets,
  strongholds (need eyes of ender), ocean crossings.

### 10.5 Structure signatures

- **REQ-FIND-13** A config table, `work/data/structure_signatures.json`:

| Marker evidence | Structure |
|---|---|
| bell | village |
| end_portal_frame | stronghold (recognised, but travel there is refused in v1) |
| reinforced_deepslate | ancient city |
| trial_spawner or vault | trial chambers |
| spawner + mossy_cobblestone | dungeon |
| spawner + cobweb or rail | mineshaft |
| crying_obsidian + obsidian | ruined portal |
| chiseled_sandstone + orange_terracotta + blue_terracotta | desert pyramid |
| mossy_cobblestone + tripwire_hook | jungle temple |
| prismarine_bricks + sea_lantern | ocean monument |
| dark_oak_planks cluster in a dark forest | woodland mansion |

- **REQ-FIND-14** Results are `candidate` (partial evidence) or `recognized`
  (the rule matched), with supporting coordinates. Recognition is heuristic: a
  player can build the same evidence. Discovery never means looting, breaking
  supports or entering traps. Signature presence in the deployed game version is
  probed in S0/S5B.

### 10.6 Underground access

- **REQ-FIND-15** `digDown` is not used.
- **REQ-FIND-16** Hazard settings on the work path: extra step cost within 1 block
  of lava; no parkour below y 50; `maxDropDown` 3; and `dontCreateFlow` and
  `dontMineUnderFallingBlock` forced back to true while a task runs, except that
  blocks of the current `obtain` target type are refused only next to lava
  (REQ-SAFE-3). That last
  part lives in the `safeToBreak` patch (REQ-SAFE-3), because both flags are read
  only inside `safeToBreak` (node_modules/mineflayer-pathfinder/lib/movements.js:275,
  :284), while `collectBlock` sets the second to false on its own filter
  (skills.js:462) and the collect plugin sets both to false on every `collect()`
  (node_modules/mineflayer-collectblock/lib/CollectBlock.js:192-195).
- `descend_to(y, toward)`, called by the resolver's `mine` nodes for buried ores:
  a code-driven 1×2 staircase plus a horizontal tunnel to the chosen ore. Before
  each dig: the 6 neighbours and the next floor are checked for liquid, and the
  column above for falling blocks. Lava within 2 blocks turns the tunnel 90°. A
  pickaxe of the right tier is required. Torches every 8 steps if held. The
  staircase is also the exit.
- Ore choice: lowest cost = horizontal distance + 3 × stone blocks to dig + lava
  penalty; exposed ores win when within about 2× the cost.

### 10.7 Places memory

- **REQ-FIND-17** `$MINDCRAFT_RUNTIME_DIR/bots/<name>/places.json`, written
  atomically. Entries: `{id, kind: named|resource|structure|mob_area|death|base,
  what, pos{x,y,z,dim}, extent?, count_est, status: seen|visited|depleted|gone,
  source, evidence (≤ 80 chars), first_seen, last_seen}`. Also `explored` chunk
  set. Capped with LRU eviction.
- The existing `MemoryBank` gets this persisted backing with the same API plus a
  dimension, swapped in at work init. `!rememberHere`, `!goToRememberedPlace`,
  `!savedPlaces` and `last_death_position` then survive restarts unchanged.
- Places are rechecked before travel or extraction; depleted resources become
  stale. For animals and villagers, store last-seen position (and UUID when
  available); reacquire the live entity rather than trusting an old entity id.
- **REQ-FIND-18** Places never enter the prompt beyond the current target line.

### 10.8 Entities

- **REQ-FIND-19** `find{entity}` observes only. Finding an animal or villager does
  not authorise killing or moving it. The `hunting` mode is forced off while a
  `find{entity}` step runs and restored afterwards.

## 11. Building

Owner requirement: build where asked, fit the terrain, keep trees and natural
ground; a hut among trees, a cave, a house dug into a hill are valid; acceptance
is functional (DECISIONS). Qwen designs; compiling, fitting and building are
mechanical (owner, addenda 2 and 3).

### 11.1 Functional cells

- **REQ-BLD-1** Template cells stay strings in `blocks[y][z][x]` with `offset`
  (the existing format). Classes:
  - `solid` (floor, walls, roof): satisfied by any full block already there
    (stone, dirt, a hillside, a player's wall). Only empty or soft cells get a
    block, from the chosen material role.
  - `air` (interior, headroom): satisfied by air or soft vegetation (cleared).
    Natural diggable blocks are dug out; this is how a cave or dug-in house is made.
  - `door`: a door, both cells, one item.
  - `ladder`: a ladder with a mandatory facing suffix.
  - `''`: untouched.
  - an exact block name (existing behaviour; generic `planks`, `log`, `door`,
    `bed` match any wood, build_goal.js:7-12), optionally with a block-state
    suffix such as `oak_door[facing=south]`, split at `[`.
- **REQ-BLD-2** Roofs cover the whole outer footprint, so every roof cell has a
  neighbour to place against in y→z→x order.

### 11.2 The parts spec (Qwen's design)

- **REQ-BLD-3** Qwen writes a design as parts with relations. That spec **is** the
  design. Parts: `chamber` (room), `wall` (line), `deck` (platform or floor),
  `passage` (corridor or doorway link), `tower` (chamber stack with an access
  shaft), `pit` (dug volume).
- Each part has: an `id`; usable **interior** dimensions; an attachment to
  another part by named face (`north|south|east|west`) or a stack on top of
  another part; material roles (`walls`, `floor`, `roof`, `frame`); and
  `embed: allow|avoid|require`.
- An optional `intent` may **add** checks (for example "top reachable"); it can
  never remove a derived check.
- The exact v1 field schema (`parts/1`) is frozen at the end of DX (PLAN). ASCII
  layer rows are not in v1 unless DX admits them.
- **REQ-BLD-4** The shelter macro is a code-synthesised one-chamber design, the
  cheapest path. Qwen gives only size and material (through `build`); code sets
  `embed` (REQ-BLD-12a).

### 11.3 Compiler

- **REQ-BLD-5** The compiler turns parts into the existing template format. Its
  internal layer is coordinate ops: `box`, `shell`, `line`, `column`, `ladder`,
  `opening`, `clear`, `slab_floor`, `steps`. This layer is also the seam for later
  schematic and image import.
- **REQ-BLD-6** Code derives, never Qwen:
  - fit and placement (§11.4), the protection predicate and hazard checks;
  - foundations up to `work.build.max_foundation` (3) deep; deeper is a reject
    with the coordinate;
  - door upper cells;
  - access: an auto-ladder on an inside face when an upper level is unreachable,
    listed in the report; no inside face means a reject with the reason;
  - survival substitutions: stairs, slabs and beds become full blocks in v1,
    listed in the report;
  - placement order: supports first; dig from the entrance outward; access before
    upper work;
  - the bill of materials from the **fitted world diff** (existing satisfactory
    terrain costs nothing), plus tools, ladders, door and a scaffold reserve;
  - regions and the verification contract (§11.7).
- **REQ-BLD-7** Validation errors are precise (unknown part, overlap, out of cap,
  disconnected room, unreachable floor, unsupported attachment). In-game design
  (REQ-PLAN-9) gets at most `work.design.ingame_max_revisions` (2)
  `design_structure` revisions; then the request is refused with the last errors.
- **REQ-BLD-8** No owner confirmation and no model approval step. The validator
  and compiler are the gate. The time-based ask (`work.ask_over_s`, 900) applies
  to very long tasks, through the owner-question contract (REQ-REC-12). The report
  states what was verified.

### 11.4 Terrain fit (forest, hillside, cave)

- **REQ-BLD-9** Candidates: the anchor plus shifts of at most `work.fit_shift` (2)
  blocks horizontally and `work.fit_y_shift` (1) vertically, across 4 rotations.
  Code picks the rotation, and with it the side of the entrance.
- **REQ-BLD-10** Score: blocks to place + blocks to dig + leaves to clear. The
  lowest wins.
- **REQ-BLD-11 Hard rejects:**
  - a tree trunk in any `air` or `door` cell (trees are never felled);
  - any edit of a protected block (§13); a protected block may *satisfy* a
    `solid` cell (a hut built against the owner's wall);
  - water or lava inside the volume;
  - a liquid next to any cell that would be dug;
  - more than `work.max_leaf_clear` leaves to clear;
  - an `embed` violation: `avoid` rejects candidates that dig into or lean walls
    and roof on natural terrain; `require` rejects candidates that are not dug
    into terrain (OQ-9 for the exact test).
- **REQ-BLD-12** If nothing qualifies, the step is **blocked with the reason**
  (e.g. "trunk at x,y,z inside; 4 rotations tried"). Qwen or the owner decides:
  move, smaller, or an explicit clearing task later. The bot never wanders off to
  find a flat spot.
- **REQ-BLD-12a Embed by code.** Code sets `embed` from the owner's words with the
  same keyword table as `detail` and `source` (`work.build.auto_keywords`), not
  Qwen: "hut" → `avoid` unless a hill or cave is mentioned; "cave", "into the
  hill" → `require`; otherwise `allow`.
- **REQ-BLD-13 Walls follow the terrain:** a `wall` part has a per-column base y
  from the ground. Rooms and towers use a flat base with foundations.

### 11.5 Protection and hazards while building

- **REQ-BLD-14** The builder's dig and `placeBlock`'s break-in-the-way both check
  the protection predicate (§13) and refuse protected blocks.
- **REQ-BLD-15** Immediately before each dig, check the 6 neighbours for liquid.
  Falling blocks that drop into the build are re-dug and missing cells re-placed
  by the world-diff builder (`self_preservation` dodges falling blocks).
- **REQ-BLD-16** Dig `air` cells in order of distance from the entrance.

### 11.6 Survival placement

- **REQ-BLD-17 Face-aware placement.** The builder passes the cell's face (from
  the suffix or the part geometry) instead of the hard-coded `'bottom'`
  (build_goal.js:182).
- **REQ-BLD-18 Entrance and door.** For every detail level, prepare and verify
  both entrance cells (1×2) as air (today the builder skips the upper door cell,
  build_goal.js:177-178). For `basic`, the door is then placed into them: before
  placing, the bot stands on the axis perpendicular to the wall, so the door's
  facing (set by the bot's yaw) closes the doorway.
- **REQ-BLD-19 Ladders.** Build the backing block first; keep the floor opening
  and landing clearance.
- **REQ-BLD-20 Re-read.** After placing, re-read the block type and, for ladders
  and doors, the `facing`, before counting the cell as done.
- **REQ-BLD-34 Player in the footprint.** (W2; numbered after REQ-BLD-33 to keep
  IDs stable.) A cell occupied by a player (any player entity's bounding box) is
  deferred, not placed or dug. The first time a pass defers such a cell, code
  tells that player once "please step out" (no model call). The builder retries
  deferred cells on its next pass; waiting on them does not count toward the
  no-progress deadline (REQ-RES-5).
- **REQ-BLD-21 Scaffolding.** During builds the pathfinder scaffolds with dirt
  only (`scafoldingBlocks`, movements.js:86-88 default dirt + cobblestone), and
  the bill reserves a scaffold amount.
- **REQ-BLD-22 Placement ledger.** The bot's own placements are recorded from
  Mineflayer's `blockPlaced` event, so pathfinder pillars are tracked too
  (pathfinder places through `bot.placeBlock` directly). The ledger is persisted
  in the task record (`placements[]`), so exemptions and cleanup survive a crash
  restart. Each entry is tagged with its build (or task) and a kind: `scaffold`
  (temporary: pillars and other non-blueprint placements made while a build runs)
  or `permanent` (blueprint cells, a placed crafting table or furnace).
  - **Stations survive a task change.** Whenever a new record replaces a task
    (done, failed, cancelled or superseded), its `permanent` crafting-table and furnace entries
    that lie outside every blueprint footprint are carried into the new record as
    `kind: station`, so the bot can still reuse or pick up its own table and
    furnace. An entry is carried forward only while the block at its position
    still matches it; an entry whose cell changed type (picked up, or broken by
    the owner) is dropped. All other entries are dropped; earlier builds then count as
    protected like any other non-natural block.
- **REQ-BLD-23 Cleanup.** Before verification, remove only `scaffold` entries
  tagged to the current build, within the bounding box +
  `work.build.cleanup_margin` (3), keeping an exit. Completed structures and
  `permanent` placements are never removed.

### 11.7 Region verification

- **REQ-BLD-24** "Done" = every blueprint cell satisfied (class-aware) **and**
  every check in the verification contract passes. Path checks use the pathfinder
  with digging, placing and scaffolding disabled (`canDig=false`,
  `allow1by1towers=false`, no scaffolding blocks); doors may be opened. No
  physical walk-through.
- Regions come from a flood-fill of the blueprint:

| Region | Checks |
|---|---|
| Room (enclosed air region), `minimal` | floor under every interior cell; 2-high air (headroom); solid enclosure except the open entrance; roof over the interior; a walkable path from outside to inside through the entrance. Never reported as mob-proof. |
| Room, `basic` | the `minimal` checks, plus: door present in the entrance with `facing` perpendicular to its wall; a path from outside to inside through the opened door. |
| Reachable top (tower, platform) | a path from the entrance to the top surface; ladders count as walkable. |
| Continuous wall (`wall` part) | every column solid from the ground to the requested height; no gap of 2 or more except declared openings. |
| Enclosure (closed perimeter, unroofed) | no path from inside to outside except through a gate. |
| Composite (a base) | each region's checks, plus a path between each region's entrance and the main entrance. |

- **REQ-BLD-25** Unloaded cells make verification `pending`, not passed.
- **REQ-BLD-26** The report is rendered from these facts. A wall is never reported
  as mob-proof without an enclosure check.

### 11.8 Build requests: detail level and source resolution

Owner amendment (E1.1): sometimes he wants a plain enclosure with no door or
furniture; complexity and source choice must be clear and cheap for the small
model. He names his own templates when he wants one, and asks directly when he
wants a new design.

- **REQ-BLD-27 One build call.** Qwen calls
  `build{what, source?, name?, detail?, at?, size?, material?}`.
  `what` is the owner's words for the structure ("small hut"). `source` defaults
  to `auto`. Qwen does not browse or compare templates; it passes the owner's
  words and any explicit size or material. The common request ("build a small hut
  here") costs one tool call and no design work.
- **REQ-BLD-28 Detail level.** `detail: minimal | basic` in v1.
  - `minimal`: floor, walls and roof with an **open entrance** (a 1×2 opening, no
    door) and no extras.
  - `basic`: the same with a door, plus window openings when a part asks for them.
  - Default (`work.build.default_detail`): `minimal`, unless the request mentions
    a door or the chosen template or part has one; then `basic`.
  - Furniture and decoration (`full`) come later.
  - Verification follows the detail level (§11.7).
- **REQ-BLD-29 Source resolution, by code, with no model call:**

| `source` | Resolves to | When used |
|---|---|---|
| `owner` + `name` | The exact owner template of that name; an ambiguous name is refused with the list of matches. | Only when the owner explicitly asks for "my template X". |
| `catalog` + `name` | An upstream catalog template. | When asked for by name. |
| `mine` + `name?` | A design from Qwen's library (by id, name or tag). | When asked for a saved design. |
| `new` | "Design needed" (REQ-PLAN-9): Qwen's next turn designs with `design_structure`, at most `work.design.ingame_max_revisions` (2) validator revisions, then builds it with `source: mine`. | Only when the owner asks for a new design. |
| `auto` (default) | 1. a tag or name match in Qwen's design library; 2. then the terrain-fitting shelter macro, for shelter-like words; 3. then the upstream catalog, **only** if the request names a catalog template; 4. only if none fits, "design needed" as for `new`. | Every other request. |

  - Order agreed with the owner on 2026-11-08 (it supersedes E1.1's catalog-second
    order): a catalog house is a fixed 5×7 with exact planks and a door, so
    reaching it by keyword would ignore the terrain and force `basic`.
  - `auto` **never** chooses an owner template.
  - Matching uses a keyword/tag table in configuration
    (`work.build.auto_keywords`), not a model call. Shelter-like words by default:
    hut, house, shelter, shed, cabin, cave, base room.
  - Step 4 is the only path that costs extra model calls (one decision turn for
    `design_structure` plus up to 2 revisions).

- **REQ-BLD-30 Storage, kept apart:**

| Store | Location | Rules |
|---|---|---|
| Owner templates | `runtime/config/templates/owner/*.json` | The owner's templates. Exact lookup by name. Qwen never writes here. v1: hand-written JSON in the template format; from S5A also `!saveTemplate` (REQ-BLD-33). |
| Design library (`mine`) | `$MINDCRAFT_RUNTIME_DIR/bots/<name>/designs/*.json` | Qwen's designs: `{id, by: "model", tags, request_text, parts, compiler_version, validation, template}`. |
| Catalog | `src/agent/npc/construction/*.json` | Upstream's four templates, built in. |

- **REQ-BLD-31 Design tools.** `design_structure{request_text, parts}` validates,
  compiles and saves to the design library, returning `{design_id, dims, bill,
  substitutions, errors, regions, est_minutes}`; `list_designs{tag?}` lists saved
  designs. They serve design sessions, explicit owner requests and the
  "design needed" turn (REQ-PLAN-9); they are **not** part of an ordinary build.
- **REQ-BLD-32 Offline design library.** Qwen designs ahead of time in a design
  session outside gameplay, with the same compiler, no latency pressure, an
  optional larger reasoning budget (`work.design.offline_reasoning_budget`,
  default unchanged), and up to `work.design.offline_max_revisions` revisions
  against the validator. Valid designs are saved with tags, so `auto` finds them.
- **REQ-BLD-33 `!saveTemplate(name, x1,y1,z1, x2,y2,z2)`** (owner-only, S5A)
  captures a world region into the owner folder. It reuses the existing
  `worldToBlueprint` (agent/tasks/construction_tasks.js:1011-1048), which waits for
  chunks, reads every cell's block name and returns
  `{materials, levels[{level, coordinates, placement[z][x]}]}`. The command
  converts `levels[y].placement` into `blocks[y][z][x]` with `offset` 0. Two
  limits to handle: an unloaded cell reads as `"air"` (`getBlockName`, :997-1000),
  so the command refuses unless every cell is loaded; and block states are not
  captured, so doors and ladders get their facing from the builder.
  - **Normalization.** The capture is normalized before saving: block names are
    mapped to the items that place them (for example `wall_torch` → `torch`,
    `redstone_wall_torch` → `redstone_torch`, wall signs → signs); plants and
    short grass become air; the upper door half and the second bed cell are
    dropped, because the builder places doors and beds as one grouped item
    (build_goal.js:33-50). Any name still without a placing item is refused,
    and the command names it.
  - The region volume is capped by `work.build.save_template_max` (16×16×16);
    a larger region is refused.
  - Owner-only
  means it is not a tool and not in the model's docs; on the tool path the model's
  text commands never run (REQ-TRN-8).
- Later front ends (schematic `.schem/.litematic/.nbt`, images) produce the same
  coordinate ops with `by: import` or `by: image`; nothing downstream changes.

## 12. Transport

### 12.1 Probe first

- **REQ-TRN-1** S0 sends one request with 3 tools to the local backend and checks:
  parsed `tool_calls` within the 2048 reasoning budget; whether
  `parallel_tool_calls:false` is honoured; nested array/object arguments intact.
  If it fails, S1 is the text-DSL fallback.

### 12.2 Provider and adapter

- **REQ-TRN-2** `models/openai_tools.js` subclasses `GPT`, is auto-loaded by
  `_model_map.js`, and returns `{content, tool_calls}` only when the caller passed
  tools. The reasoning budget (2048) is sent explicitly.
- **REQ-TRN-3** The adapter is #769's `tool_adapter.js`, copied and patched
  (array/object types with `items`/`properties` passed through; coercion), plus
  the two import shims (exported command list; `parseToolArguments`).
- **REQ-TRN-4** Tools are passed only on decision requests (`promptConvo`).
  Memory summaries, coding and bot-responder requests never get them. Tool mode is
  enabled by the profile flag `use_native_tools` (the #769 name).
- **REQ-TRN-5** `promptConvo` accepts the envelope on the tool path only; logging,
  `</think>` stripping, content-only and empty responses, and the stale-response
  check keep working.

### 12.3 Execution and history

- **REQ-TRN-6** When a response carries `tool_calls`, `agent.js` runs the **first**
  call through the adapter with `perform(agent, ...args)`, inside the stop-epoch
  checks. Extra calls are refused with a note in the result.
- **REQ-TRN-7** History stays plain text. A call is stored as an assistant turn in
  canonical form (`task_start{...json...}`); its result as the next system turn.
  Past turns are never rebuilt as `tool_calls` messages. `strictFormat` is not
  applied on the tool path.
- **REQ-TRN-8** On the tool path the model's text `!commands` are not executed; a
  one-line "use tools" system turn is added, at most once per decision request (a
  second text command in the same request ends the loop, so each slip costs at most
  one extra model call). `!stop` and `!goal` stay owner-only
  (the forced-command path, agent.js:278-300). Profile examples are written in tool
  form. On the text fallback, text commands work in full.
- **REQ-TRN-9 Drift fallback.** A reply that leads with `name{json}` is parsed as a
  tool call.

### 12.4 Tool list and schema budget

| Group | Tools | Slice |
|---|---|---|
| Task | `task_start`, `task_revise`, `task_pause`, `task_resume`, `task_cancel`, `task_status` | S1 (schemas), S2 |
| Build | `build` (shorthand for `task_start` with one `build` step; the validator inserts `obtain` steps for any shortfall) | S3 |
| Design | `design_structure`, `list_designs` (design sessions, explicit owner requests, and the continuation turn after a `design_needed` result, REQ-BLD-31, REQ-PLAN-9) | S5A |
| Chat actions | `goToPlayer`, `followPlayer`, `givePlayer`, `consume`, `equip`, `putInChest`, `takeFromChest` | S1 |

- **REQ-TRN-10** Not offered as tools: raw `collectBlocks` and `craftRecipe` (they
  bypass truthful accounting), the search, dig and build commands (replaced by
  steps), `!newAction`, `!stop`, `!goal`. Owner text `!commands` keep working.
- **REQ-TRN-11** All tool schemas together stay under 8 KB, measured by a test.

### 12.5 Prompt layout

- **REQ-TRN-12** Static persona, rules and tool-form examples come first;
  `$COMMAND_DOCS` is dropped when tools are sent. Where the dynamic state
  (`$STATS`, `$INVENTORY`, the task view in `$SELF_PROMPT`, `$MEMORY`) goes is
  **decided at S0** by probe P2, which measures both arms:
  - arm A: at the end of the system prompt, before the history (a profile change
    only);
  - arm B: after the history, as a final message (a `prompter.js` change, D4 §6).
  The arm with the better measured cache use and latency becomes this requirement;
  the other is dropped.

## 13. Safety rules for the owner's world and items

- **REQ-SAFE-1 One predicate: never break or replace a non-natural block.**
  Non-natural means not placed by world generation as terrain. The natural list
  lives in `work/data/natural_blocks.json` (stone family, dirt family, sand,
  gravel, clay, ores, natural logs, natural leaves, plants, snow, ice, liquids…).
  Everything else is protected: planks, glass, crafted blocks, containers, beds,
  doors, cobblestone, wool, and the blocks of villages and other structures.
- **REQ-SAFE-2 Exemption.** Positions in the placement ledger (the bot's own
  placements) are exempt, so the bot can pick up its own table or furnace and
  repair its own build. Nothing else is exempt.
- **REQ-SAFE-3 One mechanism for pathfinding and collection.** At work init the
  work module wraps `Movements.prototype.safeToBreak` of mineflayer-pathfinder
  (`class Movements`, node_modules/mineflayer-pathfinder/lib/movements.js:18,
  :270-291). `blocksCantBreak` keeps only types that are never exempt (its
  defaults are chest and undiggable blocks, :40-46; containers may be added).
  Other non-natural types are refused by the wrapper, not added there, because the
  wrapper must let ledger positions through (REQ-SAFE-2): adding planks or furnaces
  to `blocksCantBreak` would stop the bot picking up its own table or furnace. Because it is
  the prototype, it covers every `Movements` instance, including `collectBlock`'s
  own (skills.js:461, :488) and the collect plugin's check
  (CollectBlock.js:70). The wrapper returns false for any protected block and,
  while a task runs, evaluates the hazard checks with `dontCreateFlow` and
  `dontMineUnderFallingBlock` forced true (REQ-FIND-16). It is installed once and
  removed with the module.
  - **Obtain targets near water.** For a block of the current `obtain` target
    type, the wrapper skips only the water-adjacency part of `dontCreateFlow`
    (a lava neighbour is still refused), so underwater clay and sand stay
    collectable. The falling-block and entity-above check
    (`dontMineUnderFallingBlock`, movements.js:284-286) stays on for targets, so
    the bot never digs out the block a player stands on. All other blocks, which
    are the path digs, keep the full forced flags.
  - The tree test (REQ-SAFE-4) is memoized inside the wrapper: its result is
    cached per position for the current run, because the pathfinder calls
    `safeToBreak` for the same blocks many times while it searches.
  - Two call sites dig without the pathfinder and check the same predicate
    directly: the builder's dig and `placeBlock`'s break-in-the-way
    (skills.js:732-738, which calls `breakBlockAt` → `bot.dig`).
- **REQ-SAFE-4 Log heuristic (tree test).** Same-type connected logs, any axis,
  capped at about 40 blocks, that reach leaves with `persistent=false` are a
  natural tree. Other logs are protected (an all-log cabin), except ledger
  positions.
- **REQ-SAFE-5** Navigation may dig natural terrain, as upstream does; it never digs
  protected blocks.
- **REQ-SAFE-6 `/locate` is off by default** (`work.find.allow_locate: false`).
  Whether the bot may use operator powers is the owner's call. Permission is
  probed only when enabled.
- **REQ-SAFE-7 No automatic discarding** (REQ-OBT-11).
- **REQ-SAFE-8** Discovery never loots, breaks supports or enters traps; finding
  creatures never harms them (REQ-FIND-14, REQ-FIND-19).
- **REQ-SAFE-9** Danger: the safe-to-resume gate, the modes and the death rule
  (§7). Dangerous places are marked temporarily avoided in places memory.
- **REQ-SAFE-10 Food.** Auto-eat already eats below 14 food when food is held
  (agent.js:192-196). With no food and food ≤ `work.food_block_at` (6), the step
  blocks with the reason. Inert while the server makes the bot invincible (§7.3).
- **REQ-SAFE-11** Owner `!stop` is final for the task. Mindcraft's protective modes
  may still move, dig or place after a stop (existing behaviour, ISSUES.md).

## 14. Configuration

- **REQ-CFG-1** Defaults live in `src/agent/work/config.js`. The owner overrides
  them in the profile's `work` object (ignored `runtime/config/profiles/`).
  `memory_max_chars` lives in the settings overlay (`settings.json`); the tool flag
  and reasoning budget live in the profile. Root `settings.js` is not edited.
- **REQ-CFG-2** Every default below is the same in all docs. "Source" says where it
  was decided: D4 (core design), E1 (extension rulings), P1/P1b (proposal detail
  E1 points to), E1.1 and E1.2 (owner amendments on build requests and night),
  W1 (main-seat rulings on the doc reviews), or **open** (not decided; see §17).

| Key | Default | Meaning | Source |
|---|---|---|---|
| `memory_max_chars` (settings) | 500 | Memory summary cap. The owner's deployment uses 1,200. | D4 |
| `use_native_tools` (profile) | true when the provider supports tools | Tool path on/off. | D4 / #769 |
| `params.reasoning_budget_tokens` (profile) | 2048 | Sent explicitly on every request. | D4 |
| `work.return_radius` | 6 | Blocks from `work_pos` before returning. | D4 |
| `work.stall_s` | 15 | Idle seconds before the self-heal timer resumes. | D4 |
| `work.min_health` | 10 | Gate threshold. | D4 |
| `work.danger_radius` | 8 | Gate hostile radius. | D4 |
| `work.max_interrupts` / `work.interrupt_window_s` | 6 / 300 | Interruptions before a step blocks. | D4 |
| `work.max_restarts` / `work.restart_window_s` | 3 / 600 | Restart-storm guard. | D4 |
| `work.max_unsafe_wait_s` | 120 | Gate refusal before blocking. | D4 |
| `work.no_progress_s` | 45 | Per-call no-progress deadline. | D4 |
| `work.craft_no_progress_s` | 120 | No-progress deadline for craft calls (covers ~80 s sync, C07). | W1 |
| `work.night_policy` (profile) | continue | `continue` or `shelter` (§7.6). | E1.2 |
| `work.run_deadline_s` | 300 | Run bound (REQ-RES-6). | D4 §11.6 |
| `work.night_resume_before` | 12000 | Under `shelter`: `timeOfDay` below which a sheltered step resumes after the night. | D4 §13 |
| `work.report_with_model` | false | Model-written reports. | P1 |
| `work.view_max_chars` | 700 | Task view size. | D4 |
| `work.notes_max_chars` / `work.result_max_chars` | 300 / 160 | Record text caps. | D4 |
| `work.max_steps` | 8 | Plan length. | D4 |
| `work.max_obtain_count` | 256 | Count cap per `obtain`. | P1 |
| `work.shelter.min_size` / `max_size` | 2 / 5 | Shelter interior side. | D4 |
| `work.shelter.default_size` | 3 | When Qwen omits `size`. | W1 (OQ-10 closed) |
| `work.fit_shift` / `work.fit_y_shift` | 2 / 1 | Fit search shifts. | D4 / E1 |
| `work.max_leaf_clear` | — | Leaves the fit may clear. | open (OQ-8) |
| `work.smelt_batch` | 8 | Items per smelt batch. | E1 |
| `work.food_block_at` | 6 | Block with no food at or below this. | E1 |
| `work.allow_drop_task_surplus` | false | Drop unneeded task pickups. | E1 |
| `work.ask_over_s` | 900 | Ask before tasks estimated longer. | P1b / E1 |
| `work.build.default_detail` | minimal | Detail level when the request names no door. | E1.1 |
| `work.build.auto_keywords` | shelter words: hut, house, shelter, shed, cabin, cave, base room | `auto` matching table (§11.8). | E1.1 |
| `work.build.max_foundation` | 3 | Foundation depth. | E1 |
| `work.build.cleanup_margin` | 3 | Cleanup box margin. | E1 |
| `work.build.save_template_max` | 16×16×16 | Largest region `!saveTemplate` captures (REQ-BLD-33). | W2 |
| `work.build.scaffold_block` | dirt | Only scaffold block during builds. | E1 |
| `work.build.scaffold_reserve` | 4 per 5-level lift above the first | Bill reserve. | P1b |
| `work.build.max_cells` / `max_volume` | — | Design caps. | open (OQ-6) |
| `work.build.material_margin` | — | Extra material in the bill. | open (OQ-7) |
| `work.design.ingame_max_revisions` | 2 | In-game design revisions. | E1 |
| `work.design.ingame_enabled` | true | In-game design on or off (off if DX fails, PLAN §5). | W1 |
| `work.design.offline_max_revisions` | — | Offline revisions. | open (OQ-11) |
| `work.design.offline_reasoning_budget` | 2048 | Offline design budget. | E1 |
| `work.find.allow_locate` | false | `/locate` use. | E1 |
| `work.find.budget_s` / `budget_blocks` | 600 / 512 | Search budget. | E1 |
| `work.find.breadcrumb_blocks` | 32 | Breadcrumb spacing. | E1 |
| `work.find.dusk_tick` | 11500 | Under `shelter`: no new legs after this `timeOfDay`. | P1b |
| `work.find.ask_targets` | desert_pyramid, jungle_temple, mansion, monument | Ask first. | P1b |
| `work.find.places_caps` | 200 resource, 50 mob areas (LRU) | Places memory caps. | P1b |
| `work.find.mob_area_ttl_ticks` | 24000 | Mob-area expiry (1 game day). | P1b |
| `work.find.merge_radius` | 4 | Merge nearby ore sightings. | P1b |
| `work.underground.no_parkour_below_y` | 50 | Hazard setting. | E1 |
| `work.underground.max_drop_down` | 3 | Hazard setting. | E1 |
| `work.underground.lava_turn_radius` | 2 | Turn the tunnel away. | P1b |
| `work.underground.torch_every` | 8 | Steps between torches. | P1b |
| `work.probes_enabled` | false | S0 `!probe` command. | PLAN |

Data tables (not tunables): `work/data/natural_blocks.json`,
`structure_signatures.json`, `biome_priors.json`.

## 15. Observability and metrics

- **REQ-OBS-1** The provider logs one line per request to
  `$MINDCRAFT_RUNTIME_DIR/diagnostics/requests.jsonl`: time, request kind
  (decision / summary / coding / bot_responder), prompt, cached and completion
  tokens (when the backend reports them), reasoning characters, duration, tool
  count, tool-parse result, task id. Text path too.
- **REQ-OBS-2** The record's `metrics` hold per-task totals (model calls by kind,
  resumes, wall time). Runner events (start, end, interruption cause, gate refusal,
  deadline, block) go to the existing bot log.
- **REQ-OBS-3** Every live trial records: request text, start/end time, model calls
  by kind, interruptions and how many resumed with 0 calls, verifier outcome,
  protected-block diff (non-natural blocks within 16 before/after), edits (placed,
  dug, leaves cleared), distance travelled, interventions (should be zero).

Targets (measured, not promised):

| Task | Model calls | Today |
|---|---|---|
| Gather or craft | 1 plan + 0–1 validation + 0–1 blocked; typically 1–3 | 20–34 requests per task, 26–30 % summaries |
| Simple shelter from an empty inventory | 2–5 | no completed house |
| Ordinary interruption | 0 | 1+ (AUTO MESSAGE or goal re-prompt) |

## 16. Known limits and residuals

Recorded, not built in v1:

- Falling-block hazards in builds are handled after the fact by the world-diff
  builder; only staircases check above before digging.
- A player's natural-dirt build cannot be told from terrain.
- Structure recognition is heuristic; entity tracking and load radius depend on
  the server.
- `unstuck` still fires on movement steps, by design.
- 10 s watchdog exits remain possible; crash-restart resume and the storm guard
  make them survivable.
- Owner chat mid-task may interrupt the runner while Qwen answers (S4).
- Crafting sync on a silent server can take about 80 s (C07); craft calls have
  their own 120 s deadline (REQ-RES-5).
- Under `night_policy: shelter` with the `doDaylightCycle` gamerule off, a
  sheltered step waits forever (LOW).
- Lava meeting water makes cobblestone, which then counts as protected and is not
  dug (LOW).
- The upper door half and the second bed cell are not in the placement ledger,
  because Mineflayer's `blockPlaced` reports only the destination cell
  (node_modules/mineflayer/lib/plugins/place_block.js:44), so those positions
  are not exempt under REQ-SAFE-2 (LOW).
- Pathfinder pillars placed outside a build (no build running) get no ledger
  kind; they are recorded but are neither scaffold to clean up nor a station
  (LOW).
- The `shelter` dig-in digs through `breakBlockAt` (skills.js:586 → `bot.dig`),
  which bypasses `safeToBreak`, so its call sites would need the protection
  predicate directly, as the builder's dig has (REQ-SAFE-3). Not built: only
  `night_policy: shelter` uses them, and it is off by default (LOW).
- All live trials run with the owner's server making the bot invincible (no
  damage, drowning or hunger). They show task capability, not survival or
  self-sufficiency.
- `!newAction` (generated code) is unchanged and outside the task layer; C08,
  C10, C14 and C17 limits remain on the text path.
- `MemoryBank` stored no dimension before the persisted backing (fixed in S5B).
- Deferred, each behind a seam (PLAN §8): clearing/levelling, furniture and
  decoration (`detail: full`),
  yaw-dependent blocks (stairs, beds, gables), multi-task queues, friends'
  ownership, `hunt`, trading, buckets, shearing, farming, fishing, schematic and
  image import, layer rows, `/locate` by default and explorer maps, boats,
  Nether/End, larger caps, a request gate between summaries and decisions, a Pi
  swap.

## 17. Open questions (settled by experiment or a later ruling)

| # | Question | Settled by |
|---|---|---|
| OQ-1 | Does the backend return parsed `tool_calls` within the 2048 budget, honour `parallel_tool_calls:false`, and keep nested arguments? | S0 probe |
| OQ-2 | Real prefix-cache behaviour across consecutive turns with a changing tail; which REQ-TRN-12 arm wins (dynamic state before or after the history); whether per-turn example selection should be fixed. | S0 probe P2 |
| OQ-3 | Does the client inventory go stale after furnace use? | S0 probe |
| OQ-4 | Does the pathfinder climb the bot's own ladders mid-build instead of pillaring? Does door facing follow yaw as predicted (an unprobed prediction)? | S0 probes, S3/S5A |
| OQ-5 | Effective R_load, entity tracking range, and which structure markers exist in the deployed game version's world generation. | S0, S5B |
| OQ-6 | Design caps: P1b proposed 12×12×16 and 600 cells; P2b 16×16×16 and 1,024 edits. | DX |
| OQ-7 | Material margin in the bill (P1b proposed 10 %). | S3/S5A measurement |
| OQ-8 | Default for `work.max_leaf_clear`. | S3 forest fixture |
| OQ-9 | Exact tests for `embed: avoid` and `embed: require`. | DX fixtures, S3 |
| OQ-10 | (closed by W1: `here` and the default anchor are the owner's position if tracked, else the bot's, frozen at validation, REQ-PLAN-8; default shelter size 3.) | — |
| OQ-11 | Offline design revision limit. | DX |
| OQ-12 | (closed by W1: the owner-question contract, REQ-REC-12.) | — |
| OQ-13 | (closed by W1: craft calls use `work.craft_no_progress_s`, 120 s.) | — |
| OQ-14 | (closed by E1.2: night costs no model call under either policy, so no sleep decision exists in v1.) | — |
| OQ-15 | (closed by W1: the ledger persists in the task record, tagged scaffold or permanent, REQ-BLD-22.) | — |
| OQ-16 | Plan quality of the quantized Qwen with the typed schema; DX arm choice (parts only, + ops, + layer rows). | S1/S2 trials, DX |
| OQ-17 | Which entity types `mc.isHostile` (utils/mcdata.js:113-116) classifies as hostile on the deployed version; the gate and `self_defense` rely on it. | S0 probe |
| OQ-18 | Is a request gate between summaries and decisions needed on the single backend? | S0/S2 measurements, S4 |
| OQ-19 | Is `descend_to` ever needed as a plan step, or only inside `obtain`? | S6 |

---

## Appendix A. Interaction coverage

How every kind of interaction is handled. "—" means not applicable.

| Interaction | v1 handling | Slice | Later / out |
|---|---|---|---|
| Walk, climb, swim on the surface | pathfinder under the `safeToBreak` patch | S2 | — |
| Return to work after interruption | runner (§7) | S2 | — |
| Dig natural blocks to gather | `obtain` collect/mine | S2, S6 | — |
| Fell trees | `obtain` logs; only trees that pass the tree test | S2 | — |
| Dig underground for ores | `descend_to` staircase and tunnel | S6 | — |
| Dig to build (cave, hillside) | `air` cells, liquid-neighbour check | S3 | — |
| Place blocks, foundations | builder, face-aware, re-read | S3, S5A | — |
| Clear vegetation | soft cells; leaves ≤ `work.max_leaf_clear` | S3 | — |
| Clear or level an area, find a flat site | not done unless asked | — | deferred `clear` step |
| Water, lava | avoided; liquid checks; lava turn | S3, S6 | buckets deferred |
| Falling sand/gravel | staircase checks; builder re-dig | S3, S6 | — |
| Torches | placed in tunnels if held; `torch_placing` mode | S6 | — |
| Ladders | ladder cells, auto-ladder access | S5A | — |
| Entrances and doors | open 1×2 entrance (`minimal`); door with yaw and facing check (`basic`); opened by pathfinder | S3 | — |
| Beds | owner's `!goToBed` text command only; in designs replaced by full blocks | — | yaw-dependent blocks |
| Crafting table, furnace | resolver places and picks up its own; carried forward as `station` entries whenever a new task replaces the record (REQ-BLD-22) | S2, S6 | — |
| Chests | `putInChest`/`takeFromChest` tools; authorised deposit chest | S2 | — |
| Owner's builds and containers | protected; may serve as a `solid` cell | S2, S3 | — |
| Villages and other structures | found, recognised, protected; never looted | S5B | — |
| Hostile mobs | modes defend/flee; gate; night policy | S2 | combat steps out of scope |
| Creepers | modes; resume with 0 calls | S2 | — |
| Animals: find | `find{entity}`, hunting off | S5B | — |
| Animals: kill for food/drops, breed, shear, milk, lead | — | — | `hunt` and other methods deferred |
| Villagers: find, see profession | `find{entity}`; `!entities` | S5B | — |
| Villagers: trade | existing explicit commands (text) | — | trading as obtain method deferred |
| Players: owner requests | chat → Qwen → tools | S1 | friends later |
| Players: follow, go to, give | chat-action tools; `give` step | S1, S2 | — |
| Players standing in a build footprint | cell deferred, "please step out" once, retried next pass (REQ-BLD-34) | S3 | — |
| Owner answers a bot question | intercepted before the model; one history line (REQ-REC-12) | S3 | — |
| Farming, fishing | — | — | deferred methods |
| Nether, End, strongholds, oceans | refused with reason | S5B | deferred |
| `/locate`, explorer maps | off by default | S5B | deferred |
| Death | `paused(died)`, one model call | S2 | — |
| Night | `continue` (default): work and fight through; `shelter`: code dig-in and time resume, no model call | S2, S5B | — |
