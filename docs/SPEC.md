# Specification — task layer for the Mindcraft fork

This document says **what** the fork must do and **why**. [PLAN.md](PLAN.md) says
how and in what order. Owner rulings are in [DECISIONS.md](DECISIONS.md); they win
over this file if the two ever disagree. Research behind the design is summarised
in [RESEARCH.md](RESEARCH.md). Carried changes to upstream files are recorded in
[CHANGES.md](CHANGES.md); known defects in [ISSUES.md](ISSUES.md).

Requirements are numbered `REQ-<AREA>-<n>`. Slices and tests cite these numbers.
"Must" is a requirement. "v1" means everything this file specifies, across all
iterations. Code references are `file:line` against commit `1297bae`; paths are relative to `src/` unless they
start with `node_modules/`, `docs/` or `runtime/`. Labels such as D4, E1, E1.1, P1
and P1b name the design-council documents a decision came from (RESEARCH.md §7);
everything they decided is stated here, so they are not needed to build.

**Iterations** (owner ruling 2026-11-08, PLAN §1). Every requirement carries the
iteration that builds it; its sub-bullets share the tag unless they carry their own:

| Tag | Iteration | Slices |
|---|---|---|
| `[I1]` | Usable for play: plan, gather and craft, combat then back to the task, a simple terrain-fitting shelter, text commands | S0-lite, S2, S3 |
| `[I2]` | Native tool calls and the rest of hardening | S1, S4 |
| `[I3]` | Structures: Qwen's designs, the design library, owner templates | DX, S5A |
| `[I4]` | Discovery beyond the loaded area, places memory | S5B |
| `[I5]` | Underground and smelting | S6 |
| `[Surv]` | Survival iteration, for when the owner turns damage back on | its own slice |
| `[On evidence]` | Built only if the named failure is observed | — |

The owner's rule for every cut: a discussed feature is never dropped. It either
reuses an existing upstream, Mindcraft or Mineflayer mechanism that really
delivers it, or is deferred to a named later iteration with its requirement kept
here. Only internal machinery that delivers nothing the owner can see is retired,
marked "(retired: …)" with the ID kept.

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

- **REQ-PRI-1** [I1] Qwen is the only gameplay decision maker. No operator-authored
  plans, coordinates or material lists are injected during a task.
- **REQ-PRI-2** [I1] Deterministic code executes, verifies, returns to work and resumes.
  It never changes the owner's intent (for example, it never switches designs).
- **REQ-PRI-3** [I1] Every completion report is rendered from observed world and
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

- **REQ-SCOPE-1** [I1] No server mods, plugins or datapacks are required.
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

- **REQ-SCOPE-2** [I1] No clearing, levelling or site-hunting unless the owner asks
  for it as its own task (DECISIONS 2026-11-08 "Building fits the terrain").
- **REQ-SCOPE-3** [I1] No mandatory owner preview or approval of Qwen's designs.
- No Nether, End, strongholds, ocean crossings or boats in v1. A request for them
  ends honestly: an unknown target is refused at validation, and a search ends
  with `not_found_within_budget` (REQ-FIND-2).
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
| **Task** | One owner request being worked on, from `!taskStart` (or `!build`) until done, cancelled or failed. At most one task exists at a time. |
| **Task record** | The file `task.json` that holds the task's state on disk (§6). |
| **Plan** | The task's ordered list of steps, written by Qwen in `!taskStart` (I1, text DSL) or `task_start` (I2, tool). |
| **Step** | One high-level skill call in the plan, such as `obtain{item:"oak_planks",count:40}`. Steps come from a registry (§8.2). |
| **Run** | One execution of the runner as a Mindcraft action. A run ends normally, or is interrupted; the next run continues the same step. |
| **Runner** | Work-module code that loads the record, checks safety, returns to the work position and executes the current step. |
| **Cursor** | The index of the current step. |
| **Work position** (`work_pos`) | Where the current step is being done. The runner returns here before continuing. |
| **Anchor** | Where the owner asked for the task to happen: `here` (the owner's position if the owner's entity is tracked, else the bot's), `owner` (the owner's position), or explicit coordinates. Code resolves it to `{x,y,z,dim}` and freezes it at validation (REQ-PLAN-8). |
| **Interruption** | A Mindcraft mode (self_defense, self_preservation, cowardice, unstuck) stopping the current run. |
| **Resume check** | The check every run does first: no protective mode active and no hostile with a clear path within 8 blocks (§7.3). The health and food gate joins it in the survival iteration. |
| **Iteration** | A group of PLAN slices that ships together (`[I1]` … `[Surv]`, see the table above). |
| **Step stall** | A step whose progress metric has not improved for `work.step_stall_s` of wall time, summed across restarts; it blocks (REQ-RES-16). |
| **Text DSL** | The compact step language inside the I1 text commands (`!taskStart`, `!build`), §12.0. |
| **Approach cell** | One `air` cell in front of an entrance, part of the template, so the builder clears it (REQ-BLD-18). |
| **Self-heal timer** | A work-module timer that restarts the runner when Mindcraft's own resume path did not (§7.4). |
| **Crash restart** | The agent process ran more than 10 s and exited non-zero without SIGINT, and Mindcraft restarted it (`init_message === 'Agent process restarted.'`, no `clean_stop` in the record) (REQ-REC-7). |
| **Fresh start** | Any other start: an operator Start, `load_memory:false`, or a start after a SIGINT stop (`clean_stop`), including MindServer's stop then start. |
| **Blocked** | A step or task that cannot continue without a decision. Costs one model call. |
| **Functional cell** | One cell of a template whose class says what must be true there, not which exact block: `solid`, `air`, `door`, `ladder`, `''` (untouched), or an exact block name (§11.1). |
| **Template** | The existing builder format: `{name, offset, blocks[y][z][x]}` with string cells, as in `agent/npc/construction/*.json`. |
| **Block-state suffix** | `name[prop=value,...]` inside a template cell, e.g. `ladder[facing=north]`. |
| **Design** | Qwen's own description of a structure as a **parts spec**: rooms, walls, platforms and so on, with sizes, relations and materials (§11.2). |
| **Part** | `[I3]` One element of a parts spec: `chamber`, `wall`, `deck`, `passage`. A tower is stacked chambers; a pit is a roofless `require` chamber (REQ-BLD-3). |
| **Compiler** | Deterministic code that turns a parts spec into a template (§11.3). |
| **Template source** | Where a build's template comes from: `owner` (the owner's own templates), `mine` (Qwen's design library), `catalog` (upstream's four built-in templates), `new` (Qwen designs it with `parts`), or `auto` (code picks: library, shelter macro, catalog by name, then design; §11.8). I1 has `catalog` and `auto` steps 2–3; the rest is I3. |
| **Shelter macro** | Code-synthesised, terrain-fitting one-chamber design used by `auto` for shelter-like words; Qwen gives only size and material. |
| **Night policy** | `[Surv]` `work.night_policy`: `continue` (work and fight through the night) or `shelter` (code digs in at dusk, no model call) (§7.6). Until then the behaviour is always `continue`. |
| **Owner question** | `[Surv]` A question code asks the owner and records as `pending_question`; only the owner's reply answers it (REQ-REC-12). |
| **Detail level** | How finished a build is: `minimal` (floor, walls, roof, open 1×2 entrance) or `basic` (adds a door and optional window openings) (§11.8). |
| **Design library** | Qwen's saved, validated designs, made in-game or in an offline design session. |
| **Fit search** | Code that picks origin, rotation and small shifts near the anchor with the fewest edits (§11.4). |
| **Blueprint** | The compiled, fitted template frozen into the task record with its origin and rotation, so re-running a build is idempotent. |
| **Region** | A functional part of a blueprint: a room, a top surface, a wall run (§11.7). The generator that made the blueprint names its regions. |
| **Verification contract** | The list of functional checks for a blueprint, emitted by its generator (the shelter macro, the compiler, or the explicit contract of a catalog template). "Done" means every check passes. |
| **Non-natural block** | A block that world generation does not place as terrain: planks, glass, crafted blocks, containers, beds, doors, cobblestone and so on. Protected (§13). |
| **Placement ledger** | Positions where the bot itself placed blocks, recorded from Mineflayer's `blockPlaced` event. These are exempt from protection. |
| **Places memory** | `[I4]` The existing `MemoryBank` with a persisted `places.json` backing: named places, found targets and deaths (§10.7). |
| **Locator chain** | The order in which `find` looks for a target: places memory, loaded chunks, `/locate` (Surv, if enabled), exploration (§10.2). |
| **Structure signature** | A rule that recognises a generated structure from marker blocks, e.g. a bell means a village (§10.5). |
| **Frontier leg** | One exploration move toward unexplored chunks (§10.3). |
| **Breadcrumb** | A position saved every 32 blocks during exploration. |
| **Search budget** | How long and how far `find` may explore before it ends with a report. |
| **Decision request** | A model request that may act (conversation turns). Only these get tools. |
| **Summary request** | A memory-summary, coding or bot-responder request. Never gets tools. |
| **Tool path / text path** | Native tool calls (§12, I2) versus Mindcraft's `!command` text parsing (I1). |
| **Envelope** | `{content, tool_calls}` returned by the new provider on the tool path. |
| **Carry** | A local change to an upstream file, recorded in CHANGES.md with a reapply check and a retirement trigger. |
| **Uncoached trial** | A live test where the owner gives one natural-language request and Qwen alone orchestrates. No mid-task hints. |
| **R_load** | The effective loaded radius, measured by probe P5 in S5B. |

## 4. Capability inventory (what exists today)

Status: **works** = usable as is; **partly** = usable with stated gaps; **missing**
= does not exist. "Design use" says how the task layer uses it.

### 4.1 Commands and skills

| Area | Command → skill (file:line) | Status | Facts and gaps | Design use |
|---|---|---|---|---|
| Gather blocks | `!collectBlocks` (commands/actions.js:292-301) → `collectBlock` (agent/library/skills.js:432-554) | partly | Searches only 64 blocks (:489). Collects N **more**, not "up to N" (:471). Aliases ores, dirt→grass_block, cobblestone→stone (:447-455). Tool check (:509-513). Reports net inventory change (:548-553, fork C09). 10-minute timeout. Its target filter uses its own `Movements` (:461, :488), and it sets `dontMineUnderFallingBlock=false` (:462). | Inner loop of `obtain`'s `collect`/`mine` nodes, called in bounded chunks; protected targets are excluded by the `safeToBreak` patch (REQ-OBT-9, REQ-SAFE-3). Not offered as a tool. |
| Pick up items | `pickupNearbyItems` (skills.js:556) | works | Walks to every item entity within 8 blocks; called after manual digging (:522) and by the `item_collecting` mode (modes.js:189-211). | After digging; a small carry skips junk the bot tossed (REQ-OBT-11). |
| Use tool on block/entity | `!useOn` (actions.js:528-537) → `useToolOn` (skills.js:2007) | partly | Generic right-click. | Not used in v1 (buckets, shears deferred). |
| Farming | `tillAndSow` (skills.js:1600) | partly | Skill only, no command. | Deferred method. |
| Craft | `!craftRecipe` (actions.js:303-312) → `craftRecipe` (skills.js:37-131) | works | Counts recipe runs, not items. Uses the first recipe (:97). Places a crafting table from inventory and picks it back up (:57-91). Reports before/after counts (fork C09). | `craft` nodes of the resolver. Not offered as a tool. |
| Craftable list | `!craftable` (queries.js:147) | works | — | — |
| Crafting plan | `!getCraftingPlan` (queries.js:284) → `getDetailedCraftingPlan` (utils/mcdata.js:436) | partly | Returns text. First recipe only (:486-487). Treats smelted items such as `iron_ingot` as base items (`loopingItems`, :391-433). | The plan text is not used. Its batch and leftover arithmetic (`craftItem`, :458-503: batches = `ceil(need/yield)`, excess to leftovers) is reused by the resolver (REQ-OBT-4). |
| Item dependency tree | `agent/npc/item_goal.js` | partly | Not reachable from commands. Its executor nests `runAction`, which deadlocks and lets the 10 s watchdog kill the process. `hunt` assigns an undeclared `res` (:163) and throws in strict mode. Blacklists deepslate, stripped, dye items (:7-20). Table rule `>4` ingredients (:45) misses 3-wide recipes. One coal per input (:75-80). | Not used (E1 B.7). |
| Smelt | `!smeltItem` (actions.js:314-328) → `smeltItem` (skills.js:157-288) | works | One input type. Places a furnace from inventory. Fuel: coal/charcoal/blaze rod, then logs/planks (utils/mcdata.js:261-283). Pauses `unstuck` itself (:195). Takes inputs and fuel back on interruption (:266-271). The **command** restarts the process after a successful smelt "to update inventory" (actions.js:320-326). | `[I5]` Reused: `smelt` nodes call `smeltItem` with its own nearest-furnace lookup, plus a small carry (only empty furnaces; take back only what it put in; REQ-OBT-6). It pauses `unstuck` itself. The command is not used. |
| Clear furnace | `!clearFurnace` (actions.js:330) | works | — | Furnace reconciliation. |
| Find block | `!searchForBlock` (actions.js:163-176) → `goToNearestBlock` (skills.js:1262-1297) | partly | Loaded chunks only; range 32–512 (cap :1273); walks to the nearest; no memory. | Replaced by `find` (§10). |
| Nearby blocks | `!nearbyBlocks` (queries.js:118) | works | In `$STATS`. | Prompt state. |
| Find entity | `!searchForEntity` (actions.js:178-187) → `goToNearestEntity` (skills.js:1299-1317) | partly | Tracked entities only (`bot.entities`, agent/library/world.js:179-197). | Replaced by `find{entity}`. |
| Entities | `!entities` (queries.js:162); villager profession (world.js:218-258) | works | — | Prompt state; `find` evidence. |
| Biome | `getBiomeName` (world.js:421-435) | partly | Bot position only. Uses the negotiated registry (fork C15). | `find` evidence and the exploration biome prior (I4). |
| Structures | — | missing | No recognition. `/locate` never used. | `find{structure}` with signatures (§10.5). |
| Exploration | `!moveAway` (actions.js:189) → `moveAway` (skills.js:1422-1453); item_goal's random 8-block move (item_goal.js:326) | missing | No systematic exploration. | `work/explore.js` (§10.3). |
| Dig down | `!digDown` (actions.js:512-518) → `digDown` (skills.js:1931-1986) | partly, unsafe | Digs straight down under the bot. Checks only the target and the block below for liquid (:1952-1953). No side or falling-block checks, no exit route. | **Not used** (REQ-FIND-15). |
| To surface | `!goToSurface` (actions.js:520) → `goToSurface` (skills.js:1988-2005) | partly | Walks to the highest block at the bot's x,z. | Fallback exit only. |
| Navigate | `!goToCoordinates` (:150), `!goToPlayer` (:128), `!followPlayer` (:139), `goToGoal` (skills.js:1095-1138) | works | `goToGoal` tries a low-dig path, then **falls back to unrestricted digging** (:1110-1124). `followPlayer` is the only resumable action (actions.js:147). | Movement inside steps, under the `safeToBreak` patch (REQ-SAFE-3). |
| Doors | `startDoorInterval` (skills.js:1141), `useDoor` (:1524); pathfinder `canOpenDoors=true` (node_modules/mineflayer-pathfinder/lib/movements.js:114) | works | — | Verification path checks. |
| Build catalog | `!getStructureInfo` (queries.js:16-27), `!buildStructure` (actions.js:35-54) → `BuildGoal.executeNext` (agent/npc/build_goal.js:148-203) | partly | Four fixed templates (agent/npc/construction/). World-diff: places only missing cells, idempotent at the same origin (:172-187). Rotation (:24). Door/bed grouped as one item (:33-50). Site check reports the first issue (:65-106). **Rejects any obstruction, including grass** (:99-102). No `solid` class (`getTypeOfGeneric` at :169, skipped at :180). Prefers the `'bottom'` face (:182). Skips obstruction checks for cells below y 0 (:94), and `placeBlock` breaks what is in the way (skills.js:732-738), so a chest in a floor cell is broken. Upper door cell is never prepared (:177-178). 10-minute timeout; not resumable. | Extended as a carry (§11.6); executes every blueprint. |
| Place one block | `!placeHere` (actions.js:338), `placeBlock` (skills.js:636-814) | works | Takes a preferred face and falls back to others (:752-763). Looks at the support block before placing (:804), which sets door facing. Mineflayer waits up to 5 s for the block to change and throws if it does not (node_modules/mineflayer/lib/plugins/place_block.js:29-43), so `true` means *a* block appeared, not which block or facing. | Builder placement plus re-read (REQ-BLD-20). |
| Generated code | `!newAction` (actions.js:56-89), agent/coder.js | partly | Fork C08/C10/C14/C17 repairs. Not resumable. | **Not offered on the tool path** (§12.4). On the I1 text path it is guarded while a task is non-terminal (REQ-RES-9); blocking it outright is OQ-20. |
| Blueprint tasks | `!checkBlueprint*`, `!getBlueprint*` (queries.js:244-282) | n/a | Evaluation harness only; blocked by default (settings.js:45). | Not used. |
| Inventory | `!inventory`, `!equip` (:240), `!consume` (:232), `!givePlayer` (:220), `!discard` (:278) → `discard` (skills.js:863, `bot.toss`), `!putInChest` (:248), `!takeFromChest` (:259), `!viewChest` (:270) | works | — | Text commands as today in I1; chat-action tools from I2 (§12.4); `give` step. |
| Auto-eat | mineflayer-auto-eat, `startAt: 14` (agent/agent.js:192-196) | works | Already eats below 14 food when food is held. | Kept; the "no food" block (REQ-SAFE-10) is `[Surv]`. |
| Sleep | `!goToBed` (actions.js:368) → `goToBed` (skills.js:1568) | works | — | Owner text command only; not used by the task layer (OQ-14 closed). |
| Villagers | `!showVillagerTrades` (actions.js:423) → skills.js:1773; `!tradeWithVillager` (:431) → skills.js:1814 | works | Explicit trades only. | Trading as an obtain method is deferred. |
| Combat | `!attack` (:347), `!attackPlayer` (:355), `defendSelf` (skills.js:385), `avoidEnemies` (:1470) | works | — | Modes handle danger; no combat steps in v1. |
| Modes | agent/modes.js:24-304: `self_preservation`, `unstuck`, `cowardice`, `self_defense` (interrupt all actions); `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `idle_staring` (idle only); `cheat` (off) | works | Interrupting modes stop any action. Afterwards an AUTO MESSAGE re-prompts the model unless a resume function is set (modes.js:317-329). `unstuck` fires after 20 s within 2 blocks while an action runs (:102-131) and kills the process if `moveAway` takes over 10 s (:126). `hunting` defaults on (:176); the deployed profile turns it off. | Kept as the reflex layer (§7). |
| Goal | `!goal` (actions.js:400-413), `!endGoal` (:415), self_prompter.js | works | `!goal` cannot be blocked (commands/index.js:18). While the self-prompter is active, resume never runs (agent/action_manager.js:63). | Guarded while a task is active (REQ-RES-9). |
| Places | `!rememberHere` (actions.js:197), `!goToRememberedPlace` (:207), `!savedPlaces` (queries.js:237), agent/memory_bank.js:1-24, death place (agent.js:490) | partly | In RAM only; never saved (history.js:110-126 omits it); no dimension. | `[I4]` Persisted backing with the same API (REQ-FIND-17). |
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
| `bot.recipesAll(itemType, metadata, craftingTable)` returns every recipe for an item, without the inventory filter of `recipesFor`; recipes that need a table are included only when `craftingTable` is truthy (node_modules/mineflayer/lib/plugins/craft.js:236-244). Each prismarine-recipe `Recipe` has `requiresTable` (more than 2 rows or columns, or more than 4 ingredients) and `result.count` (node_modules/prismarine-recipe/lib/recipe.js:14-26, :39-55). They read the bot's negotiated registry. | Code. |
| `world.getNearestEntityWhere(bot, mc.isHostile, 8)` and `world.isClearPath(bot, enemy)` are exported (agent/library/world.js:194, :390); `self_defense` uses exactly this pair (modes.js:163-164). `isClearPath` paths with a fresh `Movements` with dig, place and doors off. | Code. |
| Mindcraft's text-command parser: a command is `!name` or `!name(args)`; arguments are numbers, `true`/`false` or double-quoted strings with no `"` inside and no escapes; commas and newlines inside the quotes are kept; there is no length limit (commands/index.js:29-30, :146-225). Only the first command in a reply runs, and text after it is dropped (agent.js:341-344; `truncCommandMessage`). A command inside backticks, quotes or a blockquote is a mention and does not run (commands/index.js:34-75). | Code. |
| `promptConvo` rejects non-string generations (models/prompter.js:234-238) and discards a response if a newer message arrived (:253-256). | Code. |
| A falsy command result ends the command loop (agent.js:379-382) and skips `history.save()` (:390). | Code. |

## 5. Architecture

### 5.1 Decision

- **REQ-ARC-1** [I1] The task layer is our own module, `src/agent/work/`, inside the
  Mindcraft agent process, connected through small hooks (DECISIONS 2026-11-08).
- **REQ-ARC-2** [I1] No Pi agent SDK, embedded or as a separate process.
- **REQ-ARC-3** [I2] No rebase onto upstream PR #769. Its `tool_adapter.js` is copied
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

- **REQ-ARC-4 Revisit triggers.** [I2] Re-evaluate `pi-agent-core` behind the provider
  interface if (1) our transport/loop code (provider, adapter, the `agent.js`
  branch and the `prompter.js` tool changes) grows past about 400 lines, or we
  find ourselves re-implementing steering, compaction or tool validation; or
  (2) upstream Mindcraft adopts an SDK-based loop.
- **REQ-ARC-5 #769 trigger.** [I2] If #769 merges upstream with nested parameter
  support, replace our adapter and provider with upstream's and keep `work/`.

### 5.2 Module layout

| File (under `src/`) | Responsibility | Iteration (slice) |
|---|---|---|
| `models/openai_tools.js` | New provider (prefix of its own), subclass of `GPT`; request logging (I1); tools and the envelope, returned only when tools were requested (I2). | I1 (S0-lite), I2 (S1) |
| `agent/commands/tool_adapter.js` | Copy of #769's adapter, patched for `array`/`object` params and coercion. | I2 |
| `models/native_tools.js` | `parseToolArguments` shim the adapter imports (about 22 lines). | I2 |
| `agent/work/index.js` | `Work` class: init, hook installation, idle watcher, self-heal timer. | I1 |
| `agent/work/config.js` | Defaults for the `work.*` settings of the built iterations (§14). | I1 |
| `agent/work/record.js` | Task record load/save (atomic), versioning, transitions. | I1 |
| `agent/work/runner.js` | Runs, resume check, deadlines, the stall rule, step dispatch, reports. | I1 |
| `agent/work/plan.js` | The text DSL parser (§12.0), validation and dry run of plans. | I1 |
| `agent/work/commands.js` | Text commands `!taskStart`, `!taskRevise`, `!taskPause`, `!taskResume`, `!taskCancel`, `!build` (I1); their tool forms (I2); owner-only `!saveTemplate` (I3). | I1, I2, I3 |
| `agent/work/steps/*.js` | Step registry: `obtain`, `go_to`, `give`, `build` (I1); `find` (I4). | I1, I4 |
| `agent/work/resolve.js` | Obtain resolver (§9): surface items (I1); mine and smelt nodes (I5). | I1, I5 |
| `agent/work/protect.js` | Protection predicate, tree test, placement ledger, the `Movements.prototype.safeToBreak` patch with the forced hazard flags, the SIGINT `clean_stop` handler. | I1 |
| `agent/work/site.js` | Fit search (§11.4). | I1 |
| `agent/work/shelter.js` | The shelter macro: the permanent functional shelter generator, not rebuilt through the compiler (REQ-BLD-4). | I1 |
| `agent/work/verify.js` | Functional verification of the contract a generator emits (§11.7). | I1, I3 |
| `agent/work/compile.js` | Parts spec to template, with private geometry helpers (REQ-BLD-5). | I3 |
| `agent/work/designs.js` | Template sources beyond the catalog, the design library and owner templates (§11.8). | I3 |
| `agent/work/places.js` | The persisted `MemoryBank` backing (REQ-FIND-17). | I4 |
| `agent/work/locate.js`, `explore.js` | Locator chain, exploration. | I4 |
| `agent/work/underground.js` | `descend_to` staircase and tunnel. | Surv |
| `agent/work/smelt.js` | (retired: S6 reuses `skills.smeltItem` through a small carry, REQ-OBT-6.) | — |
| `agent/work/ask.js` | Owner questions: render, record, parse the owner's reply; called by the `agent.js` interception before the model (REQ-REC-12). | Surv |
| `agent/work/view.js`, `report.js` | Task view for the prompt; reports from facts. | I1 |
| `agent/work/data/*.json` | `natural_blocks.json` (I1); `structure_signatures.json`, `biome_priors.json` (I4); `smelting.json` (I5). | I1, I4, I5 |
| `../tests/work-*.test.mjs` | Offline tests (fixture bot, no game, no model). | every slice |

There is no `probes.js` and no `!probe` command: each probe runs inside the slice
that needs it, as a test script or a short owner-agreed check (PLAN §4).

### 5.3 Core carries (hooks into upstream files)

- **REQ-ARC-6** [I1] Edits to upstream files are limited to the table below. Anything
  else goes in `work/` or a new provider file. Each row gets a CHANGES.md entry
  with a reapply check and a retirement trigger.

| File | Change | Status before | Iteration |
|---|---|---|---|
| `agent/agent.js` | I1: `this.work` init in `startEvents`, given `init_message` to tell a crash restart from a fresh start. I2: structured tool-call branch inside the stop-epoch checks, before the empty-response break (:329-338). Surv: owner-answer interception in `handleMessage`, after the forced-command block (:278-300) and before the history add (:323), so a matched answer to `pending_question` never reaches the model (REQ-REC-12). | fork carry | I1, I2, Surv |
| `models/prompter.js` | I1: request kind passed to the provider; task view into `$SELF_PROMPT`. I2: envelope accepted on the tool path (string checks use `.content`; stale-response check kept); tools only on decision requests. | fork carry | I1, I2 |
| `agent/commands/index.js` | I1: register the work commands. I2: export the command list for the adapter. | fork carry | I1, I2 |
| `agent/history.js` | `memory_max_chars` replaces the literal 500 (:44-45). | fork carry | I1 |
| `agent/npc/build_goal.js` | I1: cell classes, the patched `safeToBreak` at dig and replace, both door cells, dig order, face-aware placement, re-read, deferral of cells a player occupies. I3: ladder cells, suffix parsing, access before upper work. | existing fork carry | I1, I3 |
| `utils/mcdata.js` | I1: `isHostile` also excludes `allay` and `copper_golem`, beside the iron and snow golems (owner ruling 2026-11-08, probe P11). | fork carry | I1 |
| `agent/library/skills.js` | I1 (S2): `placeBlock` refuses to break a protected block in its way (:744) or to remove one as `air` (:660), and `tillAndSow` to break a protected block above the soil (:1654), through the work module's protection predicate (REQ-SAFE-3). I1 (S3): door yaw positioning; post-place re-read. I1: `pickupNearbyItems` skips junk-type item entities within 3 blocks of a recorded junk drop point (REQ-OBT-11). I5: `smeltItem` uses only a furnace with empty slots and takes back only what it put in (REQ-OBT-6). | existing fork carry | I1, I5 |

Estimated I1 total: 4 upstream core files plus 2 existing fork carries, about
80–110 lines (D4 §12; the builder and placement extensions are counted with the
fork carries). These hooks need no core edit:

- the `!goal` guard (wraps `getCommand('!goal').perform` at work init);
- the `Movements.prototype.safeToBreak` patch (installed once by the work module);
- the `MemoryBank` swap (`agent.memory_bank` is read at call time everywhere:
  agent.js:490, actions.js:202, :211, queries.js:240);
- mode toggles through `bot.modes.pause/unpause/setOn` (modes.js:353-379);
- placement tracking through Mineflayer's `blockPlaced` event
  (node_modules/mineflayer/lib/plugins/place_block.js:44).

## 6. Task record

### 6.1 File and writes

- **REQ-REC-1** [I1] One file per bot: `$MINDCRAFT_RUNTIME_DIR/bots/<name>/task.json`
  (the same folder as `memory.json`; `botDataPath` in utils/runtime_paths.js).
- **REQ-REC-2** [I1] Every state change is written atomically (temp file plus rename).
- **REQ-REC-3** [I1] The record has a `version`. Loading a record with an unknown
  version leaves it untouched and starts with no task (logged).

### 6.2 Fields

| Field | Content | Written by |
|---|---|---|
| `version`, `id`, `revision`, `created_at`, `updated_at` | Housekeeping; `revision` increments on every write. | code |
| `status` + `reason` | `active`, `paused`, `blocked`, `done`, `failed`, `cancelled` (`planning` retired: REQ-PLAN-2 goes straight to `active`). | code |
| `requested_by` | Owner username (ready for friends later). | code |
| `objective` | Qwen's restatement of the request. | model |
| `request_text` | The owner's words, verbatim. | code |
| `anchor` | `{x,y,z,dim}`; Qwen gives `here`, `owner` or coordinates; code resolves and freezes it at validation (REQ-PLAN-8). | model intent, code value |
| `plan[]` | `{n, skill, args, status, attempts, no_progress, work_pos, progress, result}` | model: `skill`, `args`; code: the rest |
| `plan[].progress` | `{metric, start, now, target, best, last_progress_at, stalled_s}` plus step-specific state (see 6.3). `best`, `last_progress_at` and `stalled_s` feed the stall rule (REQ-RES-16). | code |
| `plan[].subplan` | (retired: the obtain dependency graph is recomputed from the current inventory on every run, REQ-OBT-2; only the state in §6.3 is persisted.) | — |
| `plan[].result` | ≤ 160 chars, rendered from facts. | code |
| `cursor` | Index of the current step. | code |
| `structures[]` | `{id, source (resolved), name, design_id, detail, params, blueprint, contract, origin, rotation, cells_total, cells_missing, verified, verified_at}`; `blueprint` and `contract` are frozen (`design_hash` and `compiler_version` retired: the frozen blueprint is all a resume needs). | code |
| `site_rejections[]` | (retired: the block reason already carries the rejection.) | — |
| `gate` | `[Surv]` `{refused_since, reason}` while the health and food gate refuses (REQ-RES-8). | code |
| `interruptions` | `{count, last{by, at, step, pos}}` for the task view (`window[]` retired with the interruption limit, REQ-RES-16). | code |
| `restarts[]` | (retired: the stall rule replaces the restart-storm guard, REQ-REC-8.) | — |
| `night_blocked` | (retired: night blocks cost no model call under E1.2, so no bookkeeping is needed.) | — |
| `placements[]` | The placement ledger: `{pos, block, build_id?, kind?: permanent|station (scaffold from I3), at}` for every block the bot placed while this task was active, the crafting tables and furnaces it placed while it was not, plus `station` entries carried forward from the task it replaced (REQ-BLD-22). | code |
| `pending_question` | `[Surv]` `{id, text, options, asked_at}` while code waits for an owner answer (REQ-REC-12). | code |
| `clean_stop` | Set when the agent process receives SIGINT; cleared by startup classification after it is read (REQ-REC-7). | code |
| `metrics` | (retired: totals come from `requests.jsonl` and the bot log, REQ-OBS-2.) | — |
| `notes` | (retired: model-written state is what the record exists to remove, C03.) | — |

- **REQ-REC-4** [I1] The model writes only `objective`, the anchor intent and
  `plan[].skill/args` (through `!taskStart`/`!taskRevise`, or their tool forms in
  I2). Code writes
  everything else from observation. The model can never mark a step done or set
  `verified`.

### 6.3 Step progress by step type

| Step | `progress` holds |
|---|---|
| `obtain` | metric = inventory count of the item; explicit material choices; from I5 the smelting station position, pending furnace inputs and expected output. |
| `go_to` | metric = distance to target. |
| `give` | metric = count the player was seen to pick up (`confirmed`). One unit is one bounded attempt: a Mineflayer `playerCollect` listener is armed right before `giveToPlayer` and kept until the outstanding count is credited or `GIVE_CONFIRM_S` (30 s, code constant) pass, then removed. Credit = min(the target player's pickups of the step's item, summed by stack count; the bot's inventory decrease of that item since the unit started), so a stack the player picks up elsewhere, the bot's own re-pickups and any other inventory loss never count. There is no work-level listener, no settlement between ticks and no automatic resume. Done when `confirmed` covers the count; otherwise the step blocks with what happened ("dropped N X near P, not picked up" / "P picked up M of N X; K dropped near P, not picked up") and is never tossed again by itself. `!taskResume` re-gives only the outstanding count from what is still in the inventory, else blocks "have 0 X, N still to give to P". `inv_start` is persisted before the first toss, so a crash between toss and pickup blocks "not confirmed picked up". |
| `build` | metric = missing cells; `structures[]` entry id; resolved source. |
| `find` | `target, phase, waypoint, visited, rejected, elapsed_s, travelled, breadcrumbs[], return_place, last_evidence, coverage`. |

### 6.4 Lifecycle

| From | Event | To |
|---|---|---|
| — | `!taskStart` or `!build` passes validation | `active` (cursor 0) |
| `active` | all steps `done` and verified | `done` (terminal) |
| `active` | step blocked (any cause in §7.5) | `blocked` + reason; one model call |
| `active` | `[Surv]` an ask is pending (REQ-REC-12) | `blocked(awaiting_owner)`; 0 model calls |
| `blocked(awaiting_owner)` | `[Surv]` owner answers yes or an option | `active` |
| `paused`/`blocked` | a new task request (`!taskStart` or `!build`) | old task `cancelled(superseded)`; new task `active` |
| any non-terminal | owner `!stop` (written by the `!stop` wrapper before it awaits the action shutdown; if the write fails it is logged once and upstream `!stop` still runs; REQ-SAFE-11) | `cancelled(stop)` (terminal) |
| `active` | death | `paused(died)` |
| `active` | another resumable action replaces the runner | `paused(replaced)` |
| `active` | `!taskPause` | `paused` |
| `paused`/`blocked` | `!taskResume` or `!taskRevise` | `active` |
| any non-terminal | `!taskCancel` | `cancelled` (terminal) |
| any non-terminal | unrecoverable internal error (record unreadable, step code throws repeatedly) | `failed` (terminal) + reason |

- **REQ-REC-5** [I1] At most one non-terminal task. A new task request
  (`!taskStart` or `!build`) while a task is `active` is refused with "a task is
  active — use !taskRevise or !taskCancel". A `paused` or `blocked` task is superseded in
  code: it becomes `cancelled(superseded)` and the new task starts. Its stations
  are carried forward into the new record (REQ-BLD-22).
- **REQ-REC-6** [I1] Terminal tasks stay on disk until the next task replaces
  them (the task view and reports read them; the `task_status` tool is retired,
  because the task view is in every prompt).

### 6.5 Restart rules

- **REQ-REC-7 Crash restart.** [I1] A crash is only this: the process ran more than
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
- **REQ-REC-8 Restart-storm guard.** (retired: the step stall rule, REQ-RES-16,
  catches a crash loop, because its stall time is persisted and keeps counting
  across restarts; Mindcraft never restarts a process that lived under 10 s,
  process/agent_process.js:42-50.)
- **REQ-REC-9 Fresh start.** [I1] Any start that is not a crash restart (operator
  Start, `load_memory:false`, a start after `clean_stop`). An `active` task loads
  as `paused` and continues only when the owner asks. Stopped work never revives
  by itself.

### 6.6 In the prompt and in memory

- **REQ-REC-10** [I1] Whenever a record exists, a compact **task view** of at most
  700 characters (about 200 tokens) replaces the `$SELF_PROMPT` text. It never
  says "no active persistent goal" while a task exists (today's text at
  prompter.js:180). A finished task's view keeps the fork's guidance "Do not
  resume a goal that was stopped or ended, or a task that appears only in your
  memory summary, unless the owner asks again"; that guidance has reserved room and
  the variable text (status, reason, objective) is clipped first. The full blueprint and places memory are never sent.
- **REQ-REC-11** [I1] The memory summary covers only the conversation. Its cap
  becomes the setting `memory_max_chars`, default 1,000 (the owner found 500 too
  low; upstream's literal is 500). The summariser
  prompt tells the model not to record coordinates, quantities or step progress;
  until S3 it keeps build origins, because construction still runs on `!goal`.
- **REQ-REC-12 Owner questions.** [Surv] Deferred as one bundle with its
  consumers (`ask_over_s`, rare-target prompts, search-budget extensions,
  `/locate`). Until then no code path asks the owner: a search that runs out of
  budget ends with a final report (REQ-FIND-10), and a new owner request starts a
  new search. When code must ask the owner (`work.ask_over_s`,
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
  The first consumer is `ask_over_s`.
- The task view contains: status and reason, objective, step `n/N` with skill and
  short args, progress `now/target`, distance from `work_pos`, last interruption,
  the current blocker, and for `find` (I4) the one target line (for example "village
  (bell) 340 blocks NE").

## 7. Interruption and resume

### 7.1 Mechanism

- **REQ-RES-1** [I1] The runner starts as
  `runAction('action:task', run, {resume:true, timeout:-1})`. That stores
  `resume_func` (action_manager.js:56-62).
- **REQ-RES-2** [I1] An interrupting mode stops the run. Because `resume_func` is set,
  no AUTO MESSAGE and no model call follow (modes.js:317-322). When the mode's
  action ends, `idle` fires and Mindcraft calls `resumeAction()` one second later
  (agent.js:499-508).
- **REQ-RES-3** [I1] Each run: reload the record; run the resume check (§7.3);
  if the bot is more than `work.return_radius` (6) blocks from `work_pos`, go back;
  then re-run the current step idempotently. `obtain` recomputes the shortfall
  from inventory; `build` re-diffs the frozen blueprint at its stored origin;
  `find` (I4) continues from its breadcrumbs.
- **REQ-RES-4** [I1] The runner catches every operational failure itself. It
  re-observes, then retries within `attempts` or marks the step `failed` or
  `blocked`. It never throws out of `run` (an exception would clear `resume_func`,
  action_manager.js:144).

### 7.2 Deadlines

- **REQ-RES-5 No-progress deadline.** [I1] Every actuator call inside a run has a
  no-progress deadline of `work.no_progress_s` (120 s): no inventory, world or
  position change. On expiry the runner calls `agent.requestInterrupt()`
  (agent.js:236-244) and ends the run. It never clears `interrupt_code` and never
  retries inside the same run. The next attempt starts from the self-heal timer;
  `attempts` is counted in the record. A bare `Promise.race` is never used.
  One deadline covers every call, including crafting sync on a silent server
  (about 80 s, C07); the separate 45 s and 120 s keys are merged. A stuck collect
  or path call therefore takes up to 120 s to give up; `unstuck` still fires at
  20 s (modes.js:102-131). A build pass that
  is only waiting on cells a player occupies does not count as no progress
  (REQ-BLD-34).
- **REQ-RES-6 Run bound.** [I1] A run ends itself normally after `work.run_deadline_s`
  (300 s) of work, so `idle` fires and the next run continues. Reason: a resumed
  run inherits a 10-minute ActionManager timeout (§4.2), and a run that times out
  is never resumed by Mindcraft. The bound is checked between actuator calls,
  never in the middle of one.
- **REQ-RES-7** [I1] Long skills are called in bounded chunks: `obtain` collects or
  crafts in chunks (a craft unit runs at most 4 recipe runs, because Mineflayer's
  craft loop ignores `interrupt_code`); a build pass places at most a bounded number of cells.
- **REQ-RES-16 Step stall rule.** [I1] (W3; one rule replaces the interruption
  limit, the restart-storm guard and the gate wait.) Each step persists its best
  metric value, `last_progress_at` and `stalled_s`. Whenever the metric improves on
  `best` (more items, fewer missing cells, less distance, more coverage), `stalled_s`
  resets to 0. While the task is `active` and the process runs, the runner and the
  self-heal timer add elapsed wall time to `stalled_s` at each record write, so the
  sum carries across restarts (time with the process down does not count). The
  timer's periodic write measures the step first, so one long actuator call that
  keeps progressing is not counted as stalled. That sampling feeds only the stall
  clock: the runner moves `work_pos` from its own measure before and after the
  unit. When
  `stalled_s` reaches `work.step_stall_s` (600), the step blocks with its last
  recorded cause ("no progress for 10 min; last: creeper interruption"); a block
  from the timer also interrupts a run still in its call and posts its report
  once that run has ended or after 15 s (a call that never returns), whichever
  comes first, exactly once, and only if the task is still that blocked one
  (same record, same plan generation, no `!stop` since); a result that
  arrives after the block (or after a pause, cancel or revision) is discarded. One model
  call. A step that keeps making progress under constant combat never blocks.

### 7.3 Resume check

- **REQ-RES-8 Resume check.** [I1] The first thing each run does. It passes when
  no protective mode is active (the run starts from `idle`, so no mode action is
  running) and no hostile within 8 blocks has a clear path. The hostile test
  reuses the pair `self_defense` uses, called directly:
  `world.getNearestEntityWhere(bot, e => mc.isHostile(e), 8)` and
  `world.isClearPath(bot, enemy)` (agent/library/world.js:194, :390;
  modes.js:163-164). If it fails, the run returns and lets the modes act; the next
  idle retries it. It never blocks the step by itself; a long refusal is caught by
  the stall rule (REQ-RES-16).
  - **Health and food gate.** [Surv] The check also passes only when health ≥
    `work.min_health` (10) or health is rising. A refusal records `gate.reason`
    and `gate.refused_since`. (Its own 120 s wait, `work.max_unsafe_wait_s`, is
    retired: the stall rule blocks the step instead, with the gate's reason as the
    cause, for example "health 6, no food".) It is deferred because the owner's
    server makes the bot invincible (no damage, drowning or hunger), so it could
    not trigger.
- Idle-triggered retries come every second; a model-free retry costs nothing.

### 7.4 Self-heal timer and guards

- **REQ-RES-9 `!goal` guard.** [I1] While a task is non-terminal, `!goal` is refused
  with "a task is active — use !taskRevise or !taskCancel". The guard wraps
  `getCommand('!goal').perform`, so it applies to the model's text command, the
  owner's forced command and (I2) the tool path alike. The same wrapper guards
  `!newAction` on the I1 text path: while a task is non-terminal it is refused
  with the same message, so generated code cannot act beside the runner. The
  profile's examples steer Qwen to `!taskStart` and `!build` instead. The
  self-prompter stays
  stopped in task mode, because `resumeAction` does nothing while it is active
  (action_manager.js:63). A goal it was running when the task started is kept in
  the record (`goal`): when the task ends `done` its self-prompting restarts; on
  any other end it stays stopped and the report says so (the record's `goal` is
  cleared then, so a later resume and done does not revive it). `!endGoal`,
  `!stop`, a new `!goal` and a clean stop or fresh start also clear it, and the
  handback checks, just before it restarts the goal, that the record is still the
  same task, the goal was not cleared meanwhile and the self-prompter is stopped.
- **REQ-RES-10 Self-heal timer.** [I1] When the task is `active`, `resume_func` is ours,
  and the agent has been idle for more than `work.stall_s` (15 s), call
  `resumeAction()`. This covers runs that ended interrupted (no `idle`) and
  timed-out runs.
- **REQ-RES-11 `unstuck` pause.** [I1] At the start of stationary steps (building,
  crafting) the runner calls `bot.modes.pause('unstuck')`. `idle` un-pauses all
  modes (agent.js:502; modes.js:400-402). From I5, smelting reuses `smeltItem`,
  which pauses `unstuck` itself before every furnace wait (skills.js:195); a
  resumed smelt calls `smeltItem` again, so the resumed wait is paused too.
  Movement steps leave `unstuck` on.
- **REQ-RES-12 Non-blocking report.** [I1] The runner never awaits `handleMessage`
  while it is the running action. It finishes the run, then posts its report with
  `setTimeout`; a report from the self-heal timer (a stall block) waits until the
  interrupted run has returned. Reports are always rendered from facts and need no model call
  (`work.report_with_model` is retired).

### 7.5 Causes, detected from real events

| Cause | Detected by | Result | Model calls |
|---|---|---|---|
| Mode interrupt (combat, creeper, low health, unstuck) | mode action label | resume on `idle` | 0 |
| Run ended by no-progress deadline or timeout | runner / self-heal timer | resume by timer; `attempts++` | 0 |
| Crash restart | `init_message` and no `clean_stop` | resume (REQ-REC-7) | 0 |
| Night | — | work goes on; combat modes interrupt and resume (always `continue` until the survival iteration) | 0 |
| Night (`shelter`) `[Surv]` | dusk or repeated night interruptions | code dig-in; resume after the night (REQ-RES-15) | 0 |
| Owner `!stop` | change in `agent.stop_epoch` | `cancelled` | 0 |
| Death | bot `death` event | `paused(died)`; the existing death prompt | 1 |
| Replaced by another resumable action (e.g. `followPlayer`) | action label at the next idle | `paused(replaced)` | 0 |
| Non-resumable owner action (e.g. `goToPlayer`) | action finishes, `idle` | runner resumes | 0 |
| Step stall: no metric improvement for `work.step_stall_s` (600 s), summed across restarts (REQ-RES-16); covers repeated interruptions, crash loops and a refusing resume check | record | step `blocked` with the last cause | 1 |
| Search budget exhausted (REQ-FIND-10, I4) | record | step `blocked` with the final `not_found_within_budget` report | 1 |
| `[Surv]` Pending owner question (REQ-REC-12) | record | `blocked(awaiting_owner)` | 0 |
| Plan revision | `!taskRevise` | — | 1 |

- **REQ-RES-13** [I1] Cancellation causes are recorded from these events, never
  inferred from a missing `resume_func`.

### 7.6 Night policy (owner amendment E1.2) `[Surv]`

Until the survival iteration the behaviour is always `continue` and there is no
`work.night_policy` key; the key returns with `shelter`.

- **REQ-RES-14 Night policy.** [Surv] `work.night_policy: continue | shelter`, set in the
  bot profile with the other work settings; default **`continue`**. The owner's
  server currently makes the bot invincible, and digging in would stop it fighting
  and working. (Replaces the earlier rule that a night block cost a model call.)
  - `continue`: no dusk dig-in, no daytime-only exploration, no night blocking.
    Combat modes fight as usual and the runner resumes after every interruption.
  - `shelter`: at dusk, or when night interruptions repeat, code digs in with a
    1×1 cover, with **no model call**, and resumes by REQ-RES-15.
- **REQ-RES-15** [Surv] Under `shelter`, the self-heal timer resumes a sheltered step with
  no model call once the night has passed (`bot.time.timeOfDay` has wrapped from 24000 to
  the next day) and is below `work.night_resume_before` (12000). It does not rely on
  the `sunrise` event (fires only at exactly 0) or on
  `bot.time.isDay` (still true until 13000, i.e. at dusk).

### 7.7 Model calls per event (summary)

0 for combat, creepers, unstuck, timeouts, crash restarts, night, and (Surv)
pending owner questions. 1 each for a death, a blocked step (a stall, an
exhausted search, an unfittable build) and a plan revision.

## 8. Plan mode and validation

### 8.1 Starting a task

- **REQ-PLAN-1** [I1] Qwen plans in the same call that receives the request. In
  I1 that is the text command `!taskStart("<objective>", "<steps DSL>")` (or the
  `!build` shorthand), with the steps in the text DSL of §12.0. From I2 the same
  plan is the tool call `task_start(objective, steps[])` with native JSON array
  arguments; the DSL stays as the fallback if the I2 tool probe (P1) fails. Both
  forms produce the same validated plan.
- **REQ-PLAN-2** [I1] `!taskStart` (and `task_start` in I2) validates, persists,
  schedules the runner asynchronously, saves its one-line confirmation to history
  explicitly, and returns a falsy value so no follow-up inference happens
  (agent.js:379-382; `history.save()` at :390 is skipped otherwise). The same
  holds when the owner types the command himself (the forced-command path,
  agent.js:278-300). The task goes straight to `active`.

### 8.2 Step vocabulary

| Step | Arguments | Meaning | Iteration |
|---|---|---|---|
| `obtain` | `item, count` | Have at least `count` of `item` in inventory (§9). | I1 (surface: wood, stone, crafting, crafting table), I5 (iron, underground, smelting) |
| `go_to` | `target`: `here`, `owner`, `{x,y,z}`, or a place name/id | Arrive within 2 blocks. | I1 (place targets from I4) |
| `give` | `player, item, count` | Hand items to a player. | I1 |
| `build` | `what, source?: owner|catalog|mine|new|auto` (default `auto`), `name?, detail?, at?, size?, material?, parts?` | Build a structure; code resolves the source, `detail` and `embed` with no model call (§11.8). Also the `!build` shorthand (§12.0) and, from I2, a tool. | I1 (`catalog`; `auto` steps 2–3: the shelter macro, then the catalog by explicit name), I3 (`owner`, `mine`, `new` with `parts`, full `auto`) |
| `find` | `target:{kind: block|item|entity|structure, name}`, `budget?` | Observe and record a target (§10). | I4 |

- **REQ-PLAN-3** [I1] New skills are added to the registry without changing the record
  schema (`skill` + `args`).

### 8.3 Validation (deterministic, `work/plan.js`)

- **REQ-PLAN-4** [I1] Before anything executes, check (each check arrives with the
  step type or source it covers):
  - item, block and entity names exist in the negotiated registry (`bot.registry`);
  - counts ≤ `work.max_obtain_count` (256);
  - at most `work.max_steps` (8) steps;
  - shelter interior size within 2–5;
  - (I4) `find` kinds are known; structure names are in the signature table, so
    an unknown structure is refused with the reason;
  - a source that arrives in a later iteration is refused with the reason ("source
    owner arrives with I3; use auto or catalog");
  - (I3) `build` with `source: owner` needs an exact owner-template name; an ambiguous
    name is refused with the list of matches; `auto` never resolves to an owner
    template (REQ-BLD-29); the source is resolved here, before execution;
  - **materials:** the shelter macro (I1) or the compiler (I3) is dry-run against the
    inventory plus earlier `obtain` steps. A shortfall becomes an inserted
    `obtain` step, or a precise error;
  - **tools:** digging stone or deepslate `air` cells needs a pickaxe that can
    harvest them; a missing one becomes an inserted `obtain wooden_pickaxe` (or
    the matching tier), or the step is refused with the reason.
- **REQ-PLAN-5** [I1] All errors come back together in one tool result.
- **REQ-PLAN-8 Anchor freeze.** [I1] `here` resolves to the owner's position when the
  owner's entity is tracked, otherwise to the bot's position. Every anchor (and
  every `at`) is resolved and frozen during validation, before prerequisite steps
  are inserted or run, and kept unchanged through resume and restarts.
- **REQ-PLAN-9 Design needed.** [I3] In-game design is never a model call nested
  inside a command or tool. When a `build`'s source resolves to "design needed"
  (`source: new` without `parts`, or `auto` step 4), validation starts no task and
  returns a result `{design_needed: true, what, constraints, at}`, where `at` is the
  anchor frozen by REQ-PLAN-8, so the follow-up uses the same place. The result is
  serialized as a string, because the command loop writes a command's result to
  history as a system message (agent.js:379-380). It is a non-empty string, so
  the loop continues: Qwen's next turn calls `build` again with
  `source: new, parts, at` (the returned `at`). Validation compiles the parts and
  freezes the compiled blueprint and its contract into the task, and saves the
  design to the library through the same compile path (REQ-BLD-30). Invalid parts
  return the errors and the same `at` for a retry, at most
  `work.design.ingame_max_revisions` (2) times. If in-game design is turned off
  (`work.design.ingame_enabled: false`, PLAN §5 fail branch), the result is a
  refusal with the reason instead.

### 8.4 Re-planning

- **REQ-PLAN-6** [I1] `!taskRevise(from_step, "<steps DSL>")` (I2: `task_revise(from_step,
  steps[])`) replaces unfinished steps only. Done steps are kept.
- **REQ-PLAN-7** [I1] Changing a partially built design must be explicit. The runner
  never silently switches designs (the fourth house trial's failure, ISSUES.md).

## 9. Obtain resolver

- **REQ-OBT-1** [I1] `obtain{item, count}` is resolved by our own `work/resolve.js`
  (the shortfall and dependency resolver: `recipesFor` alone cannot resolve
  missing prerequisites). It reuses Mineflayer's recipe objects instead of
  hand-written recipe rules: `bot.recipesAll(itemId, null, true)` (all recipes,
  including table recipes; node_modules/mineflayer/lib/plugins/craft.js:236-244),
  each recipe's `requiresTable` and `result.count` (prismarine-recipe), and
  `mc.ingredientsFromPrismarineRecipe` (utils/mcdata.js:346) for ingredient
  counts. Block sources and tools come from `getItemBlockSources` (:303),
  `getBlockTool` (:328) and the registry's `harvestTools`. These read the bot's
  negotiated registry (the C15 lesson). It does not use item_goal's executor or
  `getDetailedCraftingPlan`'s text.
- When no craft, collect, mine or (I5) smelt method resolves an item, the step is
  refused with "no method for X in this version" (this replaces the separate
  table of unobtainable items, REQ-OBT-12).

### 9.1 What it computes

- **REQ-OBT-2** [I1] Count-target nodes `{have: item ≥ n, method: craft|smelt|mine|collect,
  via, tier_req}`, sorted so prerequisites come first. The graph is recomputed
  from the current inventory on every run, not persisted (W3). What is
  persisted is in §6.3: explicit material choices and attempts, and from I5 the
  station position, pending furnace inputs and expected output, which count as
  pending production before any replacement is gathered.
- **REQ-OBT-3** [I1] On every run each node is re-evaluated against the current
  inventory. "Collect N more" never appears; resuming is idempotent.
- **REQ-OBT-4** [I1] Crafting: the first recipe the current inventory (plus what
  earlier nodes will produce) allows; the crafting-table requirement is the
  recipe's `requiresTable`, not item_goal's `>4` rule. Yields and leftovers follow
  the arithmetic of mcdata's `craftItem` (utils/mcdata.js:458-503: runs =
  `ceil(need / result.count)`, the excess goes to leftovers); it is not exported,
  so the resolver copies these few lines rather than adding a carry. (Choosing
  among alternatives by cost is dropped; the wood-variant choice is cruder.)
- **REQ-OBT-5** [I1] Tool tiers from `harvestTools`. The wood → stone chain is
  derived automatically in I1; iron joins in I5.

### 9.2 Smelting and fuel `[I5]`

- **REQ-OBT-6** [I5] Smelting reuses `skills.smeltItem` (skills.js:157-288), called
  directly (not through `!smeltItem`, whose command restarts the process after a
  smelt, actions.js:320-326), with its own nearest-furnace lookup
  (`world.getNearestBlock(bot, 'furnace', 16)`, :177), so a nearby furnace,
  including the owner's, may be used. It is never broken: protection refuses a
  furnace that is not in the ledger (REQ-SAFE-1/2), and `smeltItem` picks up only
  a furnace it placed itself (`placedFurnace`, :274-276). `smeltItem` pauses
  `unstuck` itself (:195). A small carry (owner ruling W3b) adds two rules:
  - **Only an empty furnace.** A furnace is used only if its input and fuel slots
    are empty, and, so that no earlier output is taken, its output slot too.
    Otherwise the next eligible furnace within range is used (from
    `world.getNearestBlocks`, world.js:118), or the bot places
    its own (the existing fallback, :178-186). Today `smeltItem` refuses only a
    furnace holding a different input (:200-209) and reuses fuel already there
    (:220).
  - **Take back only what it put in.** The counts put into the input and fuel
    slots are recorded at insertion; on finishing or an interruption, at most
    those counts are taken back (today it takes everything left, :266-271).
  - The furnace used is persisted as the station in step progress. On resume,
    the resolver first opens the station and takes the output this step
    produced (`bot.openFurnace` on that block), then calls `smeltItem` again for
    the remaining count. Items left in the furnace by a process crash are thus
    collected as output, or smelted on.
  - Smelt calls run in batches of at most `work.smelt_batch` (8), so progress
    shows in the inventory.
  - Inputs are limited to mcdata's whitelist (`isSmeltable`, mcdata.js:256-259,
    checked at skills.js:169-172; outputs `getItemSmeltingIngredient`, :285-301:
    the iron, gold and copper ingots, glass, foods and similar).
  - **Wider smelting coverage.** [I5] Inputs outside that whitelist (stone →
    smooth_stone, cactus → green_dye, and the rest) come from a work-module table,
    `work/data/smelting.json`, because minecraft-data has no furnace recipes (its
    data for these versions lists crafting `recipes` only). Until then such an
    item is refused with "no method for X in this version".
- **REQ-OBT-7** [I5] Fuel: coal or charcoal (8 items each), or planks (1.5 items each,
  mcdata.js:271-283). Fuel need is `ceil(n/8)` coal for n items.
- **REQ-OBT-8** [I5] The station position, pending inputs and expected output are
  persisted in step progress (§6.3). The station is the furnace `smeltItem` used
  (REQ-OBT-6): an empty nearby furnace, one the bot placed (in the ledger), or a
  `station` entry carried forward from the task it replaced (REQ-BLD-22). After
  an interruption or restart its output is collected before it is refilled.
- Inventory after furnace use: upstream restarts after every smelt "to update
  inventory" (actions.js:320-326). Probe P9, run before S6, checks whether the
  client inventory goes stale (OQ-3). If it does, the resolver re-reads it (close
  and reopen the window) or uses a controlled restart-and-resume.

### 9.3 Collection

- **REQ-OBT-9** [I1] `collect`/`mine` nodes call `skills.collectBlock` in bounded chunks.
  Protection needs no extra filtering here: the single protection mechanism
  (REQ-SAFE-3) patches `Movements.prototype.safeToBreak`, which both
  `collectBlock`'s target filter (its own `Movements`, skills.js:461, :488) and the
  collect plugin (node_modules/mineflayer-collectblock/lib/CollectBlock.js:70-72)
  call. Protected blocks are therefore never selected as targets.
- **REQ-OBT-10** [I5] Exposed ores are reached by path. Buried ores are reached by
  `collectBlock` or the pathfinder's own digging under the forced hazard flags
  (REQ-SAFE-3; lava is in the pathfinder's `blocksToAvoid`,
  node_modules/mineflayer-pathfinder/lib/movements.js:53-58). This is less careful
  than a staircase and is acceptable while the bot is invincible. The careful
  `descend_to` staircase (§10.6) is `[Surv]`.

### 9.4 Inventory

- **REQ-OBT-11 No automatic discarding of the owner's items.** [I1] Code never
  discards an item that is not on the junk list. (The owner approved using the
  bot as a disposable trash can for common junk, W3b.)
  - **Junk drop.** Before a step that needs free slots (`obtain`, `give`, a
    `build`'s materials), if `bot.inventory.emptySlotCount()` is below
    `work.min_free_slots` (4), code drops items on `work.junk_items` with no model
    call: by default dirt, cobblestone, gravel, cobbled_deepslate, andesite,
    diorite, granite, tuff, netherrack, wheat_seeds, rotten_flesh. It keeps
    `work.junk_keep` (by default one stack, 64, each of dirt and cobblestone, for
    scaffolding and stone tools), anything the current task's steps or resolver
    need, and everything not on the list. It reuses `skills.discard`
    (skills.js:877, `bot.toss`), one observed inventory stack per call, so an
    interruption stops the drop between any two stacks.
  - **Re-pickup guard.** Vanilla picks up an item on contact once its throw delay
    ends, and upstream also walks to items: `pickupNearbyItems` (skills.js:556,
    8 blocks; called after manual digging at :522) and the `item_collecting` mode
    (modes.js:189-211, which calls it; off in the deployed profile). So the bot
    drops junk where it stands before it moves to the work, facing away from the
    work position, and records each drop point for 5 minutes (vanilla's despawn
    time). `bot.toss` returns no entity ids, so the guard is keyed on drop points:
    a small carry in `pickupNearbyItems` skips item entities of a junk type within
    3 blocks of a recorded drop point. Contact pickup when a path crosses the spot
    is accepted. If junk refills the slots during the same step, the drop
    runs again, at most twice.
  - **Failure.** If the drop cannot reach the minimum, the step blocks with a
    fact report naming the five largest stacks in the inventory. The owner frees
    space himself (the chest commands keep working).
  - **Auto-deposit and surplus drop.** [Surv] Instead of blocking, deposit to a
    chest the owner has authorised (a named place), or drop surplus picked up
    during this task that no step needs, only if `work.allow_drop_task_surplus`
    (false) is true.
- **REQ-OBT-12** (retired: merged into resolver failure, REQ-OBT-1. Nether, End,
  trade-only, structure-loot and animal-only items get "no method for X in this
  version".)

## 10. Find and explore

This section is `[I4]` (S5B) unless a line says otherwise. Underground access
(§10.6) is I1 for the forced flags, I5 for ore digging and `[Surv]` for the
staircase.

### 10.1 Vocabulary and results

- **REQ-FIND-1** [I4] `find{target:{kind: block|item|entity|structure, name}, budget?}`
  observes and records. It completes when there is a current matching observation
  with its position. Approaching or acting on the target is a separate step.
- **REQ-FIND-2** [I4] Results are honest: `found` (with position and evidence),
  `not_found_within_budget` (with coverage), `unsupported_method`, `unreachable`.
- A `find{kind:item}` target is resolved to its sources (blocks, entities) first.

### 10.2 Locator chain

- **REQ-FIND-3** [I4] In order:
  1. places memory (a named entry, re-observed before use);
  2. a loaded-chunk scan: `findBlocks` with `maxDistance = √(R² + H²)` and a
     horizontal filter, so full height is covered (Mineflayer's radius test is
     spherical, node_modules/mineflayer/lib/plugins/blocks.js:185); `bot.entities`
     for entities; the signature table for structures;
  3. `[Surv]` `/locate`, only if `work.find.allow_locate` is true and the server
     permits it (deferred with the owner-question bundle, because it needs the
     owner's answer first);
  4. exploration (§10.3).
- **REQ-FIND-4** [I4] Scans run on demand: one bounded, throttled scan at each
  exploration leg and at the start of the search, so they do not stall the 300 ms
  mode loop. Scan cost is measured first. A found target is stored as a named
  place.
  - **Background indexer.** [I4] Incremental scans on `chunkColumnLoad` that
    write everything seen (target ids plus the signature set) into places memory.

### 10.3 Exploration

- **REQ-FIND-5** [I4] Frontier legs on the chunk grid, scored by unexplored chunks,
  distance and a water penalty (no boats); plus a biome prior
  (`work/data/biome_priors.json`). C15's negotiated-registry biome
  names stay wherever a biome is reported.
  Waypoints are at most R_load/2 away, so pathfinder goals stay in loaded chunks.
  Failed approaches are blacklisted for this search.
- **REQ-FIND-6** [I4] Breadcrumbs every `work.find.breadcrumb_blocks` (32) go into step
  progress. `work_pos` is updated at each accepted waypoint (otherwise the return
  rule would drag the explorer back to its start).
- **REQ-FIND-7 Night.** [I4] Exploration runs day and night (the `continue`
  behaviour). [Surv] Under `shelter`, legs start only while
  `timeOfDay < work.find.dusk_tick` (11500); at dusk the bot digs in with a 1×1
  cover and resumes by REQ-RES-15; hiding time does not count against the budget.
- **REQ-FIND-8** [I4] Exploration moves on the surface without digging: explore legs
  use a `Movements` with `canDig=false` (the protection patch alone would still
  let them dig natural blocks).

### 10.4 Budgets

- **REQ-FIND-9** [I4] One default budget: `work.find.budget_s` (600 s) or
  `work.find.budget_blocks` (512) from the search anchor, whichever comes first.
  Return time is reserved.
- **REQ-FIND-10** [I4] Exhaustion ends the search with a final
  `not_found_within_budget` report with coverage and evidence (e.g. "explored 140
  chunks within 512; no desert seen; nearest unexplored frontier W"), and the step
  blocks. A budget is never extended inside the task; a new owner request starts
  another search.
  - **As an owner question.** [Surv] Exhaustion instead becomes a templated owner
    question, `blocked(awaiting_owner)` with no model call, ending "Go further?
    (yes/no)" (REQ-REC-12).
- **REQ-FIND-11** [Surv] Ask the owner (REQ-REC-12) before exceeding the budget,
  before starting a target listed in `work.find.ask_targets` (far or rare), and
  before using `/locate`. Only the owner's answer extends a budget; Qwen cannot.
- **REQ-FIND-12** (retired: no explicit refusal list. An unknown target is refused
  at validation and an exhausted search gives an honest result; Nether, End,
  strongholds and ocean crossings stay outside v1, §2.3.)

### 10.5 Structure signatures

- **REQ-FIND-13** [I4] A config table, `work/data/structure_signatures.json`:

| Marker evidence | Structure |
|---|---|
| bell | village |
| end_portal_frame | stronghold (I4; recognised only, travel is outside v1) |
| reinforced_deepslate | ancient city |
| trial_spawner or vault | trial chambers |
| spawner + mossy_cobblestone | dungeon |
| spawner + cobweb or rail | mineshaft |
| crying_obsidian + obsidian | ruined portal |
| chiseled_sandstone + orange_terracotta + blue_terracotta | desert pyramid |
| mossy_cobblestone + tripwire_hook | jungle temple |
| prismarine_bricks + sea_lantern | ocean monument |
| dark_oak_planks cluster in a dark forest | woodland mansion (I4; needs cluster-plus-biome code) |

- **REQ-FIND-14** [I4] Results are `candidate` (partial evidence) or `recognized`
  (the rule matched), with supporting coordinates. Recognition is heuristic: a
  player can build the same evidence. Discovery never means looting, breaking
  supports or entering traps. Signature presence in the deployed game version is
  probed in S5B (P10).

### 10.6 Underground access

- **REQ-FIND-15** [I1] `digDown` is not used.
- **REQ-FIND-16** [I1] `dontCreateFlow` and `dontMineUnderFallingBlock` are forced
  back to true while a task runs, for every block (the obtain-target exception is
  `[I5]`, REQ-SAFE-3). [I5] Underground hazard settings on the work path: extra step
  cost within 1 block of lava; no parkour below y 50; `maxDropDown` 3. The forcing
  lives in the `safeToBreak` patch (REQ-SAFE-3), because both flags are read
  only inside `safeToBreak` (node_modules/mineflayer-pathfinder/lib/movements.js:275,
  :284), while `collectBlock` sets the second to false on its own filter
  (skills.js:462) and the collect plugin sets both to false on every `collect()`
  (node_modules/mineflayer-collectblock/lib/CollectBlock.js:192-195).
- `[Surv]` `descend_to(y, toward)`, called by the resolver's `mine` nodes for buried ores:
  a code-driven 1×2 staircase plus a horizontal tunnel to the chosen ore. Before
  each dig: the 6 neighbours and the next floor are checked for liquid, and the
  column above for falling blocks. Lava within 2 blocks turns the tunnel 90°. A
  pickaxe of the right tier is required. Torches every 8 steps if held. The
  staircase is also the exit.
- `[I5]` Ore choice: lowest cost = horizontal distance + 3 × stone blocks to dig + lava
  penalty; exposed ores win when within about 2× the cost.

### 10.7 Places memory

- **REQ-FIND-17** [I4] Places memory reuses the existing `MemoryBank`
  (agent/memory_bank.js:1-24, `rememberPlace`, `recallPlace`, `getJson`,
  `loadJson`) with a small persisted backing,
  `$MINDCRAFT_RUNTIME_DIR/bots/<name>/places.json`, written atomically and loaded
  at work init. Today the bank lives only in RAM (`History.save` omits it,
  history.js:110-126). Each found target is stored as a named place; every named
  result carries a dimension field. `!rememberHere`, `!goToRememberedPlace`,
  `!savedPlaces` and `last_death_position` then survive restarts unchanged.
- The current search's waypoints, visited chunks, evidence and breadcrumbs stay in
  step progress (§6.3), not in places memory.
- Targets are re-observed before travel, extraction or a claimed find. For animals
  and villagers, store the last-seen position; reacquire the live entity rather
  than trusting an old entity id.
- **Discovery database.** [I4] Entry kinds (`resource`, `structure`,
  `mob_area`, `base`) with `status: seen|visited|depleted|gone`, depletion
  tracking, mob-area TTLs, LRU caps, a merge radius for nearby sightings, the
  global explored-chunk set and dangerous places.
- **REQ-FIND-18** [I4] Places never enter the prompt beyond the current target line.

### 10.8 Entities

- **REQ-FIND-19** [I4] `find{entity}` observes only. Finding an animal or villager
  does not authorise killing or moving it. (Forcing `hunting` off during the step
  is retired: `hunting` runs only when the agent is idle or during `followPlayer`
  (modes.js:172-175), never interrupting a task run, and the deployed profile has
  it off.)

## 11. Building

Owner requirement: build where asked, fit the terrain, keep trees and natural
ground; a hut among trees, a cave, a house dug into a hill are valid; acceptance
is functional (DECISIONS). Qwen designs; compiling, fitting and building are
mechanical (owner, addenda 2 and 3).

### 11.1 Functional cells

- **REQ-BLD-1** [I1] Template cells stay strings in `blocks[y][z][x]` with `offset`
  (the existing format). Classes:
  - `solid` (floor, walls, roof): satisfied by any full block already there
    (stone, dirt, a hillside, a player's wall). Only empty or soft cells get a
    block, from the chosen material role.
  - `air` (interior, headroom): satisfied by air or soft vegetation (cleared).
    Natural diggable blocks are dug out; this is how a cave or dug-in house is made.
  - `door`: a door, both cells, one item.
  - `ladder` (I3): a ladder with a mandatory facing suffix.
  - `''`: untouched.
  - an exact block name (existing behaviour; generic `planks`, `log`, `door`,
    `bed` match any wood, build_goal.js:7-12), optionally with a block-state
    suffix such as `oak_door[facing=south]`, split at `[`.
- **REQ-BLD-2** [I1] Roofs cover the whole outer footprint, so every roof cell has a
  neighbour to place against in y→z→x order.

### 11.2 The parts spec (Qwen's design) `[I3]`

- **REQ-BLD-3** [I3] Qwen writes a design as parts with relations. That spec **is**
  the design. Four parts: `chamber` (room), `wall` (line), `deck` (platform or
  floor), `passage` (corridor or doorway link). The tower and the pit stay as
  features, built from these: a tower is chambers stacked on each other with the
  derived access ladder (REQ-BLD-6); a pit is a `chamber` with `embed: require`
  and no roof.
- Each part has: an `id`; usable **interior** dimensions; an attachment to
  another part by named face (`north|south|east|west`) or a stack on top of
  another part; material roles (`walls`, `floor`, `roof`, `frame`); and
  `embed: allow|avoid|require`.
- An optional `intent` may **add** checks (for example "top reachable"); it can
  never remove a derived check.
- The exact field schema (`parts/1`) is frozen at the end of DX (PLAN). ASCII
  layer rows are an I3 front end (PLAN S5A).
- **REQ-BLD-4** [I1] The shelter macro (`work/shelter.js`) is a code-synthesised
  one-chamber design, the cheapest path, and the permanent shelter generator: it is
  not rebuilt through the compiler in I3. Qwen gives only size and material
  (through `build`); code sets `embed` (REQ-BLD-12a). It emits the blueprint, the
  approach cell (REQ-BLD-18) and its Room contract (§11.7).

### 11.3 Compiler

- **REQ-BLD-5** [I3] One module, `work/compile.js`, turns parts directly into the
  existing template format, using private geometry helpers (box, shell, line,
  column, opening, clear). There is no separate coordinate-op language, and no
  `slab_floor` or `steps` (their blocks are substituted away anyway). Later
  schematic and image importers emit the same, already stable template format.
- **REQ-BLD-6** [I1] Code derives, never Qwen (each item applies from the
  iteration of the generator that needs it):
  - fit and placement (§11.4), the protection predicate and hazard checks;
  - foundations up to `work.build.max_foundation` (3) deep; deeper is a reject
    with the coordinate;
  - door upper cells;
  - (I3) access: an auto-ladder on an inside face when an upper level is
    unreachable, listed in the report; no inside face means a reject with the
    reason;
  - survival substitutions: stairs, slabs and beds become full blocks in v1,
    listed in the report;
  - placement order: supports first; dig from the entrance outward; access before
    upper work;
  - the bill of materials from the **fitted world diff** (existing satisfactory
    terrain costs nothing), plus tools, ladders, door and a scaffold reserve;
  - the verification contract, emitted by the generator (§11.7).
- **REQ-BLD-7** [I3] Validation errors are precise (unknown part, overlap, out of cap,
  disconnected room, unreachable floor, unsupported attachment). In-game design
  (REQ-PLAN-9) gets at most `work.design.ingame_max_revisions` (2) revisions of
  `build{source: new, parts}`; then the request is refused with the last errors.
- **REQ-BLD-8** [I1] No owner confirmation and no model approval step. The
  validator and compiler are the gate. The report states what was verified.
  - [Surv] The time-based ask (`work.ask_over_s`, 900) applies to very long tasks,
    through the owner-question contract (REQ-REC-12). It needs a task-duration
    estimate, specified with it.

### 11.4 Terrain fit (forest, hillside, cave)

- **REQ-BLD-9** [I1] Candidates: the anchor plus shifts of at most `work.fit_shift` (2)
  blocks horizontally and `work.fit_y_shift` (1) vertically, across 4 rotations.
  Code picks the rotation, and with it the side of the entrance.
- **REQ-BLD-10** [I1] Score: blocks to place + blocks to dig + leaves to clear. The
  lowest wins.
- **REQ-BLD-11 Hard rejects:** [I1]
  - a tree trunk in any `air` or `door` cell (trees are never felled);
  - any edit of a protected block (§13); a protected block may *satisfy* a
    `solid` cell (a hut built against the owner's wall);
  - water or lava inside the volume;
  - a liquid next to any cell that would be dug;
  - more than `work.max_leaf_clear` leaves to clear;
  - an `embed` violation: `require` rejects candidates that are not dug into
    terrain; (I3) `avoid` rejects candidates that dig into or lean walls and roof
    on natural terrain (OQ-9 for the exact tests).
- **REQ-BLD-12** [I1] If nothing qualifies, the step is **blocked with the reason**
  (e.g. "trunk at x,y,z inside; 4 rotations tried"). Qwen or the owner decides:
  move, smaller, or an explicit clearing task later. The bot never wanders off to
  find a flat spot.
- **REQ-BLD-12a Embed by code.** [I1] Code sets `embed` from the owner's words with
  the same keyword table as `detail` and `source` (`work.build.auto_keywords`), not
  Qwen: "cave", "into the hill" → `require`; otherwise `allow`. [I3] "hut" →
  `avoid` unless a hill or cave is mentioned. (DECISIONS: a hut among trees, a
  cave or a house dug into a hill are all valid, so I1 needs no `avoid`.)
- **REQ-BLD-13 Walls follow the terrain:** [I3] a `wall` part has a per-column base y
  from the ground. Rooms and towers use a flat base with foundations.

### 11.5 Protection and hazards while building

- **REQ-BLD-14** [I1] The builder's dig and `placeBlock`'s break-in-the-way both call
  the patched `Movements.prototype.safeToBreak` (REQ-SAFE-3) through a `Movements`
  instance, and refuse what it refuses. So "one predicate" is literal: protection,
  liquid neighbours and the falling-block check are the same code for paths,
  collection and building.
- **REQ-BLD-15** [I1] Because of REQ-BLD-14, each dig is refused next to a liquid
  (the block above and the four sides; `dontCreateFlow`) and under a falling block
  or an entity (`dontMineUnderFallingBlock`, movements.js:275-288). A cave dug
  under a sand or gravel ceiling is therefore refused, and the step blocks with
  the reason. Falling blocks that still drop into the build are re-dug and missing
  cells re-placed by the world-diff builder (`self_preservation` dodges falling
  blocks).
- **REQ-BLD-16** [I1] Dig `air` cells in order of distance from the entrance.

### 11.6 Survival placement

- **REQ-BLD-17 Face-aware placement.** [I1] The builder passes the cell's face (from
  the suffix or the part geometry) instead of the hard-coded `'bottom'`
  (build_goal.js:182).
- **REQ-BLD-18 Entrance and door.** [I1] For every detail level, prepare and verify
  both entrance cells (1×2) as air (today the builder skips the upper door cell,
  build_goal.js:177-178). For `basic`, the door is then placed into them: before
  placing, the bot stands on the axis perpendicular to the wall, so the door's
  facing (set by the bot's yaw) closes the doorway. Probe P8 checks this in S3,
  where the door is first placed.
  - **Approach cell.** The shelter macro (and from I3 the compiler) marks one `air`
    cell in front of the entrance, at entrance height and the cell above it, in
    the template, so the world-diff builder clears anything there, including a
    scaffold pillar.
- **REQ-BLD-19 Ladders.** [I3] Build the backing block first; keep the floor opening
  and landing clearance.
- **REQ-BLD-20 Re-read.** [I1] After placing, re-read the block type and, for ladders
  and doors, the `facing`, before counting the cell as done.
- **REQ-BLD-34 Player in the footprint.** [I1] (W2; numbered after REQ-BLD-33 to keep
  IDs stable.) A cell occupied by a player (any player entity's bounding box) is
  deferred, not placed or dug. The first time a pass defers such a cell, code
  tells that player once "please step out" (no model call). The builder retries
  deferred cells on its next pass; waiting on them does not count toward the
  no-progress deadline (REQ-RES-5).
- **REQ-BLD-21 Scaffolding.** [I1] During builds the pathfinder scaffolds with dirt
  only (`scafoldingBlocks`, movements.js:86-88 default dirt + cobblestone), and
  the bill reserves a scaffold amount (4 dirt per 5-level lift above the first; a
  constant). Dirt counts as natural, so scaffolding left behind is never
  protected.
- **REQ-BLD-22 Placement ledger.** [I1] The bot's own placements are recorded from
  Mineflayer's `blockPlaced` event, so pathfinder pillars are tracked too
  (pathfinder places through `bot.placeBlock` directly). The ledger is persisted
  in the task record (`placements[]`), so exemptions and cleanup survive a crash
  restart. While no task is active (none, or one paused, blocked or ended) only
  the bot's stations are recorded (crafting table, furnace: a one-off
  `!craftRecipe` takes back the table it placed), in the current record or,
  before the first task, in memory until a record exists; everything else the bot
  places then (`!buildStructure`, `!placeHere`, generated code) stays protected
  like any non-natural block. Each entry is tagged with its build (or task) and a kind: `permanent`
  (blueprint cells, a placed crafting table or furnace) or `station` (below).
  [I3] A third kind, `scaffold` (pillars and other non-blueprint placements made
  while a build runs), arrives with cleanup (REQ-BLD-23); until then such
  placements are recorded as plain entries with no kind.
  - **Stations survive a task change.** Whenever a new record replaces a task
    (done, failed, cancelled or superseded), its `permanent` crafting-table and furnace entries
    that lie outside every blueprint footprint are carried into the new record as
    `kind: station`, so the bot can still reuse or pick up its own table and
    furnace. An entry is carried forward only while the block at its position
    still matches it; an entry whose cell changed type (picked up, or broken by
    the owner) is dropped. All other entries are dropped; earlier builds then count as
    protected like any other non-natural block.
- **REQ-BLD-23 Cleanup.** [I3] Before verification, remove only `scaffold` entries
  tagged to the current build, within the bounding box +
  `work.build.cleanup_margin` (3), keeping an exit. Completed structures and
  `permanent` placements are never removed. Until I3, dirt pillars may remain
  beside a build (cosmetic; the approach cell keeps the entrance clear).

### 11.7 Region verification

- **REQ-BLD-24** [I1] "Done" = every blueprint cell satisfied (class-aware) **and**
  every check in the verification contract passes. Path checks use the pathfinder
  with digging, placing and scaffolding disabled (`canDig=false`,
  `allow1by1towers=false`, no scaffolding blocks); doors may be opened. No
  physical walk-through.
- The contract comes from the generator, which knows each part it made (W3):
  the shelter macro emits its Room checks (I1); the four catalog templates carry
  explicit, hand-written contracts (I1); from I3 each compiled part emits its own
  checks. The contracts keep enclosure and connectivity checks, read-only
  pathfinding, and unloaded = `pending`. Compiler fixtures keep independently
  written expectations, so a compiler mistake cannot also write a passing
  contract.
- [I3] Recovering regions from an arbitrary template by flood-fill (needed for
  owner templates, which have no generator) is deferred together with owner
  templates.

| Region | Checks |
|---|---|
| Room (enclosed air region), `minimal` (I1) | floor under every interior cell; 2-high air (headroom); solid enclosure except the open entrance; roof over the interior; a walkable path from outside to inside through the entrance. Never reported as mob-proof. |
| Room, `basic` (I1) | the `minimal` checks, plus: door present in the entrance with `facing` perpendicular to its wall; a path from outside to inside through the opened door. |
| Reachable top (tower, platform) (I3) | a path from the entrance to the top surface; ladders count as walkable. |
| Continuous wall (`wall` part) (I3) | every column solid from the ground to the requested height; no gap of 2 or more except declared openings. |
| Enclosure (closed perimeter, unroofed) (I3) | no path from inside to outside except through a gate. |
| Composite (a base) (I3) | each region's checks, plus a path between each region's entrance and the main entrance. |

- **REQ-BLD-25** [I1] Unloaded cells make verification `pending`, not passed.
- **REQ-BLD-26** [I1] The report is rendered from these facts. A wall is never reported
  as mob-proof without an enclosure check.

### 11.8 Build requests: detail level and source resolution

Owner amendment (E1.1): sometimes he wants a plain enclosure with no door or
furniture; complexity and source choice must be clear and cheap for the small
model. He names his own templates when he wants one, and asks directly when he
wants a new design.

- **REQ-BLD-27 One build call.** [I1] Qwen calls
  `build{what, source?, name?, detail?, at?, size?, material?}`: in I1 as the text
  command `!build("<what>", "<options>")` (§12.0), from I2 also as a tool. [I3]
  The `parts` argument (with `source: new`) carries Qwen's design (REQ-PLAN-9).
  `what` is the owner's words for the structure ("small hut"). `source` defaults
  to `auto`. Qwen does not browse or compare templates; it passes the owner's
  words and any explicit size or material. The common request ("build a small hut
  here") costs one tool call and no design work.
- **REQ-BLD-28 Detail level.** [I1] `detail: minimal | basic` in v1.
  - `minimal`: floor, walls and roof with an **open entrance** (a 1×2 opening, no
    door) and no extras.
  - `basic`: the same with a door, plus window openings when a part asks for them.
  - Default (`work.build.default_detail`): `minimal`, unless the request mentions
    a door or the chosen template or part has one; then `basic`.
  - Furniture and decoration (`full`) come later.
  - Verification follows the detail level (§11.7).
- **REQ-BLD-29 Source resolution, by code, with no model call:** [I1 for `catalog`
  and `auto` steps 2–3; I3 for the rest]

| `source` | Resolves to | When used |
|---|---|---|
| `owner` + `name` (I3) | The exact owner template of that name; an ambiguous name is refused with the list of matches. | Only when the owner explicitly asks for "my template X". |
| `catalog` + `name` (I1) | An upstream catalog template. | When asked for by name. |
| `mine` + `name?` (I3) | A design from Qwen's library (by id, name or tag). | When asked for a saved design. |
| `new` (I3) | With `parts`: compile, freeze and build. Without: "design needed" (REQ-PLAN-9), and Qwen's next turn sends `build{source: new, parts, at}`, with at most `work.design.ingame_max_revisions` (2) validator revisions. | Only when the owner asks for a new design. |
| `auto` (default) | 1. (I3) a tag or name match in Qwen's design library; 2. then the terrain-fitting shelter macro, for shelter-like words; 3. then the upstream catalog, **only** if the request names a catalog template; 4. (I3) only if none fits, "design needed" as for `new`. In I1, when neither step 2 nor step 3 fits, the request is refused with the reason ("in-game design arrives with I3"). | Every other request. |

  - Order agreed with the owner on 2026-11-08 (it supersedes E1.1's catalog-second
    order): a catalog house is a fixed 5×7 with exact planks and a door, so
    reaching it by keyword would ignore the terrain and force `basic`.
  - `auto` **never** chooses an owner template.
  - Matching uses a keyword/tag table in configuration
    (`work.build.auto_keywords`), not a model call. Shelter-like words by default:
    hut, house, shelter, shed, cabin, cave, base room.
  - Step 4 is the only path that costs extra model calls (one decision turn for
    `build{source: new, parts}` plus up to 2 revisions).

- **REQ-BLD-30 Storage, kept apart:** [I3; the catalog row is I1]

| Store | Location | Rules |
|---|---|---|
| Owner templates | `runtime/config/templates/owner/*.json` | The owner's templates. Exact lookup by name. Qwen never writes here. I3: hand-written JSON in the template format, and `!saveTemplate` (REQ-BLD-33). |
| Design library (`mine`) | `$MINDCRAFT_RUNTIME_DIR/bots/<name>/designs/*.json` | Qwen's designs, saved through the same compile path as in-game builds and offline design: `{id, by: "model", tags, request_text, parts, compiler_version, validation, template}`. |
| Catalog | `src/agent/npc/construction/*.json` | Upstream's four templates, built in. |

- **REQ-BLD-31 Design tools.** (retired: `design_structure` merged into
  `build{source: new, parts}`, REQ-BLD-27 and REQ-PLAN-9; `list_designs` cut,
  because Qwen does not browse templates. The design library, owner templates and
  offline design stay as features, REQ-BLD-30, 32, 33.)
- **REQ-BLD-32 Offline design library.** [I3] Qwen designs ahead of time in a design
  session outside gameplay (DX's `tests/dx/run.mjs` doubles as the design session;
  no separate operator script), with the same compiler, no latency pressure, an
  optional larger reasoning budget (`work.design.offline_reasoning_budget`,
  default unchanged), and up to `work.design.offline_max_revisions` revisions
  against the validator. Valid designs are saved with tags, so `auto` finds them.
- **REQ-BLD-33 `!saveTemplate(name, x1,y1,z1, x2,y2,z2)`** [I3] (owner-only, S5A)
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
  template format with `by: import` or `by: image`; nothing downstream changes.

## 12. Transport

I1 uses Mindcraft's existing text `!commands` (§12.0). Native tool calls
(§12.1–12.5) are I2. Both reach the same command `perform` functions, so the task
layer does not change between them.

### 12.0 Text commands and the step DSL `[I1]`

- **REQ-TRN-13 Task commands.** [I1] The work module registers these commands
  through the `commands/index.js` carry, so they appear in `$COMMAND_DOCS` like any
  other command, with the grammar summary below in their descriptions:

| Command | Arguments (all `string` unless noted) | Does |
|---|---|---|
| `!taskStart("<objective>", "<steps>")` | objective; steps DSL | Validate and start a task (REQ-PLAN-1/2). |
| `!build("<what>", "<options>")` | the owner's words; build options DSL, or `""` | Shorthand for a task with one `build` step (REQ-BLD-27). |
| `!taskRevise(<from_step>, "<steps>")` | `from_step` is an `int` | Replace unfinished steps from that step on (REQ-PLAN-6). |
| `!taskPause`, `!taskResume`, `!taskCancel` | none | Lifecycle (§6.4). |

- How they run (verified, §4.2): the model's reply is scanned for the first bare
  command; it is executed with `command.perform(agent, ...args)` inside the loop's
  stop-epoch and interrupt checks (agent.js:328-352, `checkInterrupt` at :310);
  text after the command is dropped. A command the owner types runs through the
  forced-command path (agent.js:278-300) and the same `perform`. The `!goal` guard
  (REQ-RES-9) wraps `perform`, so it applies to both. Mindcraft passes exactly the
  declared number of arguments; there are no optional arguments, hence `""` for
  empty options.
- Raw commands reuse Mindcraft's `blocked_actions` setting (settings.js:45;
  overridable through the settings overlay, main.js:53-55, :65-70). At agent start
  `blacklistCommands` deletes each listed command from the command map
  (commands/index.js:17-27; agent.js:63-64), so it no longer executes, and
  `getCommandDocs` leaves it out of `$COMMAND_DOCS` (commands/index.js:297). The
  setting is global, so a blocked command is gone for the owner's typed commands
  too ("Command '!x' does not exist.", agent.js:281-283); `!stop`, `!stats`,
  `!inventory` and `!goal` cannot be blocked (:18). The I1 value is the
  deployment's existing blocked list (including any `!setMode` block, which keeps
  Qwen from turning modes off during a task); from S3 it adds `!buildStructure`,
  which `!build` covers (S2 ships first, so construction keeps `!buildStructure`
  until then). Overriding the setting replaces the whole list, so the existing
  entries must be carried over.
  `!collectBlocks` and `!craftRecipe` stay available for one-off requests; the
  profile's examples show `!taskStart` and `!build`. Whether to block more is
  OQ-20.
- **REQ-TRN-14 Step DSL.** [I1] One string; the grammar:

```
steps   := step ( ";" step )*            at most work.max_steps (8) steps
step    := skill ( " " arg )*            skill: obtain | go_to | give | build
arg     := key "=" value
value   := token | "'" text "'"          token: letters, digits and _ - . , :
                                         text: any characters except ' and "
```

  - Skills and keys (keys in any order; unknown keys are errors; `[…]` marks an
    optional key):
    - `obtain item=<item> count=<1-256>`;
    - `go_to target=here|owner|<x>,<y>,<z>` (place names from I4);
    - `give player=<name> item=<item> count=<n>`;
    - `build what='<words>' [source=auto|catalog] [name=<template>]
      [detail=minimal|basic] [at=here|owner|<x>,<y>,<z>] [size=<2-5>]
      [material=<item>]`. In `!build`, the options string uses the same keys
      without `what`.
  - Example: `!taskStart("40 oak planks", "obtain item=oak_planks count=40")`;
    `!build("small hut with a door", "detail=basic size=3")`.
  - Limits from Mindcraft's parser: an argument is a double-quoted string with no
    `"` inside and no escapes, so the DSL uses single quotes for free text and
    never `"`; an apostrophe in the owner's words is dropped by Qwen. The parser
    has no length limit; the DSL string is capped at 1,000 characters (a
    constant).
- **REQ-TRN-15 DSL errors.** [I1] All errors come back together in one system
  result (REQ-PLAN-5), each naming its step: `"!taskStart refused: step 2: unknown
  skill 'mine' (use obtain, go_to, give, build); step 3: count 300 is above 256"`.
  The messages:
  - Mindcraft's own, before ours: `Command !taskStart was given N args, but
    requires 2 args.` This is also what a `"` inside an argument produces, because
    the argument pattern then fails and the command matches with no arguments
    (commands/index.js:29-30, :162-163); our command description says so.
  - `no steps given`; `more than 8 steps`; `steps text longer than 1000
    characters`; `step N: unknown skill 'X' (use …)`; `step N: unknown key 'K' for
    S`; `step N: missing key 'K'`; `step N: key 'K' given twice`; `step N:
    unclosed quote`; `step N: 'V' is not a number`; `step N: count V is outside
    1–256`; `step N: unknown item or block 'X'` (checked against `bot.registry`);
    `step N: bad position 'V' (use here, owner or x,y,z)`; `step N: source 'S'
    arrives with I3; use auto or catalog`; and the validation errors of
    REQ-PLAN-4.

### 12.1 Probe first `[I2]`

- **REQ-TRN-1** [I2] Before S1, probe P1 sends requests with 3 tools to the local
  backend and checks: parsed `tool_calls` within the 2048 reasoning budget;
  whether `parallel_tool_calls:false` is honoured; nested array/object arguments
  intact. If it fails, I2 keeps the text DSL of §12.0 and only the provider work
  that does not need tools is done.

### 12.2 Provider and adapter `[I2]`

- **REQ-TRN-2** [I2] `models/openai_tools.js` subclasses `GPT`, is auto-loaded by
  `_model_map.js`, and returns `{content, tool_calls}` only when the caller passed
  tools. The reasoning budget (2048) is sent explicitly.
- **REQ-TRN-3** [I2] The adapter is #769's `tool_adapter.js`, copied and patched
  (array/object types with `items`/`properties` passed through; coercion), plus
  the two import shims (exported command list; `parseToolArguments`).
- **REQ-TRN-4** [I2] Tools are passed only on decision requests (`promptConvo`).
  Memory summaries, coding and bot-responder requests never get them. Tool mode is
  enabled by the profile flag `use_native_tools` (the #769 name).
- **REQ-TRN-5** [I2] `promptConvo` accepts the envelope on the tool path only; logging,
  `</think>` stripping, content-only and empty responses, and the stale-response
  check keep working.

### 12.3 Execution and history `[I2]`

- **REQ-TRN-6** [I2] When a response carries `tool_calls`, `agent.js` runs the **first**
  call through the adapter with `perform(agent, ...args)`, inside the stop-epoch
  checks. Extra calls are refused with a note in the result.
- **REQ-TRN-7** [I2] History stays plain text. A call is stored as an assistant turn in
  canonical form (`task_start{...json...}`); its result as the next system turn.
  Past turns are never rebuilt as `tool_calls` messages. `strictFormat` is not
  applied on the tool path.
- **REQ-TRN-8** [I2] On the tool path the model's text `!commands` are not executed; a
  one-line "use tools" system turn is added, at most once per decision request (a
  second text command in the same request ends the loop, so each slip costs at most
  one extra model call). `!stop` and `!goal` stay owner-only
  (the forced-command path, agent.js:278-300). Profile examples are written in tool
  form. On the text fallback, text commands work in full.
- **REQ-TRN-9 Drift fallback.** [On evidence] A reply that leads with `name{json}`
  is parsed as a tool call. Built only if I2 trials show this slip; until then the
  bounded "use tools" turn (REQ-TRN-8) handles malformed replies.

### 12.4 Tool list and schema budget `[I2]`

| Group | Tools | Iteration |
|---|---|---|
| Task | `task_start`, `task_revise`, `task_pause`, `task_resume`, `task_cancel` (`task_status` retired: the task view is in every prompt) | I2 |
| Build | `build` (shorthand for `task_start` with one `build` step; the validator inserts `obtain` steps for any shortfall); from I3 it also takes `parts` with `source: new`, including the continuation turn after a `design_needed` result (REQ-PLAN-9) | I2, I3 |
| Chat actions | `goToPlayer`, `followPlayer`, `givePlayer`, `consume`, `equip`, `putInChest`, `takeFromChest` | I2 |

The design tools `design_structure` and `list_designs` are retired (REQ-BLD-31).
About 13 tools in all.

- **REQ-TRN-10** [I2] Not offered as tools: raw `collectBlocks` and `craftRecipe` (they
  bypass truthful accounting), the search, dig and build commands (replaced by
  steps), `!newAction`, `!stop`, `!goal`. Owner text `!commands` keep working.
- **REQ-TRN-11** [I2] All tool schemas together stay under 8 KB, measured by a test.

### 12.5 Prompt layout `[I2]`

- **REQ-TRN-12** [I2] Static persona, rules and tool-form examples come first;
  `$COMMAND_DOCS` is dropped when tools are sent. The dynamic state (`$STATS`,
  `$INVENTORY`, the task view in `$SELF_PROMPT`, `$MEMORY`) goes at the end of the
  system prompt, before the history (arm A, a profile change only). Latency is
  dominated by reasoning tokens, not the prompt (RESEARCH §1), so caching gains
  are a few seconds at most.
  - **Arm B.** [On evidence] Dynamic state after the history, as a final message
    (a `prompter.js` change, D4 §6), only if I2 measurements show a worthwhile
    gain over arm A.

## 13. Safety rules for the owner's world and items

- **REQ-SAFE-1 One predicate: never break or replace a non-natural block.** [I1]
  Non-natural means not placed by world generation as terrain. The natural list
  lives in `work/data/natural_blocks.json` (stone family, dirt family, sand,
  gravel, clay, ores, natural logs, natural leaves, plants, snow, ice, liquids…).
  Commonly farmed plants (sugar cane, bamboo, cactus, sweet berry bushes, kelp)
  are left out with the crops, for every caller (they may be the owner's farms).
  Ore exposure is a task-layer harvesting policy, not owner property: inside a
  task run an ore counts only with a face open to air or water, and buried ores
  are reached from I5; outside task runs ores are natural, buried or not, as
  before S2 (native `!collectBlocks` mines them).
  Everything else is protected: planks, glass, crafted blocks, containers, beds,
  doors, cobblestone, wool, and the blocks of villages and other structures.
- **REQ-SAFE-2 Exemption.** [I1] A placement-ledger entry (the bot's own
  placement) exempts its position only while the block there is the recorded
  block, so the bot can pick up its own table or furnace and repair its own build;
  an entry whose block is gone or replaced is retired when seen, on a restored
  ledger too. Nothing else is exempt.
- **REQ-SAFE-3 One mechanism for pathfinding, collection and building.** [I1] At work init the
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
  - **Obtain targets near water.** [I5] (Deferred: until then the two flags stay
    forced for every block, and clay or sand under water is a known gap, §16.) For a block of the current `obtain` target
    type, the wrapper skips only the water-adjacency part of `dontCreateFlow`
    (a lava neighbour is still refused), so underwater clay and sand stay
    collectable. The falling-block and entity-above check
    (`dontMineUnderFallingBlock`, movements.js:284-286) stays on for targets, so
    the bot never digs out the block a player stands on. All other blocks, which
    are the path digs, keep the full forced flags.
  - The tree test (REQ-SAFE-4) is memoized inside the wrapper: its result is
    cached per position for the current run, because the pathfinder calls
    `safeToBreak` for the same blocks many times while it searches. Outside a
    run it is computed fresh.
  - Three call sites dig without the pathfinder: the builder's dig,
    `placeBlock`'s break-in-the-way and `air` branch (skills.js:744 and :660),
    and `tillAndSow`'s break of the block above the soil (skills.js:1654); the
    skills call `breakBlockAt` → `bot.dig`. `breakBlockAt` itself (so also generated
    code), `placeBlock`'s break-in-the-way and `tillAndSow` (S2) ask the same
    protection predicate the patched `safeToBreak` checks first
    (`isProtectedForBot`), without upstream's hazard flags, and refuses with the
    reason; the builder's dig (S3) calls the patched `safeToBreak` through a
    `Movements` instance (REQ-BLD-14). One predicate in fact, not two copies.
- **REQ-SAFE-4 Log heuristic (tree test).** [I1] A log is a natural tree when both
  hold: (1) a path of same-type logs going up (one block up per step, straight or
  diagonal), visiting at most 40 logs, reaches a log with `persistent=false` leaves
  directly above it: a trunk ends under its canopy; and (2) its component, the
  26-connected same-type logs containing it, has at most 64 logs (over the cap it
  is protected) and no log of it touches a block that is not natural, not leaves,
  not air or water, not `cocoa`, `bee_nest`, `beehive`, `creaking_heart` or a
  farmed plant (sugar cane, bamboo and its sapling, cactus and its flower, sweet
  berry bushes, kelp and its plant, melon, pumpkin; accepted beside a tree, never
  collectable themselves), and not a ledger entry of the bot's own. A log of
  another wood type is not accepted (a mixed-wood build). So planks, a door, glass,
  a torch or another wood against a log build under a canopy protect it. There is no ground condition: a felled trunk stays a tree.
  Other logs are protected (an all-log cabin, also where a tree's leaves touch its
  side), except ledger positions.
- **REQ-SAFE-5** [I1] Navigation may dig natural terrain, as upstream does; it never digs
  protected blocks.
- **REQ-SAFE-6 `/locate` is off by default** [Surv] (`work.find.allow_locate: false`;
  deferred with the owner-question bundle).
  Whether the bot may use operator powers is the owner's call. Permission is
  probed only when enabled.
- **REQ-SAFE-7 No automatic discarding** [I1] of anything off the junk list (REQ-OBT-11).
- **REQ-SAFE-8** [I4] Discovery never loots, breaks supports or enters traps; finding
  creatures never harms them (REQ-FIND-14, REQ-FIND-19).
- **REQ-SAFE-9** [I1] Danger: the resume check, the modes and the death rule (§7).
  [I4] Dangerous places are marked temporarily avoided in places memory (with
  the discovery database, REQ-FIND-17).
- **REQ-SAFE-10 Food.** [Surv] Auto-eat already eats below 14 food when food is held
  (agent.js:192-196). With no food and food ≤ `work.food_block_at` (6), the step
  blocks with the reason. Deferred because the server makes the bot invincible, so
  it could not trigger (§7.3); auto-eat itself works today.
- **REQ-SAFE-11** [I1] Owner `!stop` is final for the task. Mindcraft's protective modes
  may still move, dig or place after a stop (existing behaviour, ISSUES.md).

## 14. Configuration

- **REQ-CFG-1** [I1] Defaults live in `src/agent/work/config.js`. The owner overrides
  them in the profile's `work` object (ignored `runtime/config/profiles/`).
  `memory_max_chars` lives in the settings overlay (`settings.json`); the tool flag
  and reasoning budget live in the profile. Root `settings.js` is not edited.
  `config.js` holds only the keys of the iterations already built; a deferred
  mechanism's keys arrive with it. Display caps and fixed policies are constants
  in code, not keys.
- **REQ-CFG-2** [I1] Every default below is the same in all docs. "Source" says where it
  was decided: D4 (core design), E1 (extension rulings), P1/P1b (proposal detail
  E1 points to), E1.1 and E1.2 (owner amendments on build requests and night),
  W1–W3 (main-seat rulings on the doc reviews and cuts), or **open** (not decided;
  see §17).

**I1 keys**

| Key | Default | Meaning | Source |
|---|---|---|---|
| `memory_max_chars` (settings) | 1000 | Memory summary cap (REQ-REC-11). | W3 (owner) |
| `work.return_radius` | 6 | Blocks from `work_pos` before returning. | D4 |
| `work.stall_s` | 15 | Idle seconds before the self-heal timer resumes. | D4 |
| `work.no_progress_s` | 120 | Per-call no-progress deadline, crafting sync included (REQ-RES-5). | W3 |
| `work.step_stall_s` | 600 | Wall time without metric improvement before a step blocks (REQ-RES-16). | W3 |
| `work.run_deadline_s` | 300 | Run bound (REQ-RES-6). | D4 §11.6 |
| `work.max_steps` | 8 | Plan length. | D4 |
| `work.max_obtain_count` | 256 | Count cap per `obtain`. | P1 |
| `work.shelter.min_size` / `max_size` | 2 / 5 | Shelter interior side. | D4 |
| `work.shelter.default_size` | 3 | When Qwen omits `size`. | W1 (OQ-10 closed) |
| `work.fit_shift` / `work.fit_y_shift` | 2 / 1 | Fit search shifts. | D4 / E1 |
| `work.max_leaf_clear` | — | Leaves the fit may clear. | open (OQ-8) |
| `work.build.default_detail` | minimal | Detail level when the request names no door. | E1.1 |
| `work.build.auto_keywords` | shelter words: hut, house, shelter, shed, cabin, cave, base room; embed words: cave, into the hill | `auto` and `embed` matching table (§11.8). | E1.1 |
| `work.build.max_foundation` | 3 | Foundation depth. | E1 |
| `work.build.material_margin` | — | Extra material in the bill. | open (OQ-7) |
| `work.min_free_slots` | 4 | Free inventory slots a step needs before the junk drop runs (REQ-OBT-11). | W3b (owner) |
| `work.junk_items` | dirt, cobblestone, gravel, cobbled_deepslate, andesite, diorite, granite, tuff, netherrack, wheat_seeds, rotten_flesh | Items the junk drop may toss. | W3b (owner) |
| `work.junk_keep` | dirt 64, cobblestone 64 | Junk kept back for scaffolding and stone tools. | W3b (owner) |
| `blocked_actions` (settings) | the deployment's existing blocked list (including any `!setMode` block); from S3 plus `!buildStructure` | Commands removed from the model's docs and from execution (REQ-TRN-13, OQ-20). | W3b |

Constants in code (not keys): the junk drop's 5-minute drop-point memory, its
3-block skip radius and its two re-runs per step; the resume check's hostile radius 8 (the same as
`self_defense`); the task view cap of 700 characters; the step result cap of 160
characters; the DSL cap of 1,000 characters; the scaffold block (dirt) and the
scaffold reserve (4 per 5-level lift above the first).

**Keys of later iterations** (added to `config.js` when their iteration is built)

| Key | Default | Meaning | Iteration | Source |
|---|---|---|---|---|
| `use_native_tools` (profile) | true when the provider supports tools | Tool path on/off. | I2 | D4 / #769 |
| `params.reasoning_budget_tokens` (profile) | 2048 | Sent explicitly on every request by the new provider. | I2 | D4 |
| `work.build.max_cells` / `max_volume` | — | Design caps. | I3 | open (OQ-6) |
| `work.build.cleanup_margin` | 3 | Cleanup box margin. | I3 | E1 |
| `work.build.save_template_max` | 16×16×16 | Largest region `!saveTemplate` captures (REQ-BLD-33). | I3 | W2 |
| `work.design.ingame_max_revisions` | 2 | In-game design revisions. | I3 | E1 |
| `work.design.ingame_enabled` | true | In-game design on or off (off if DX fails, PLAN §5). | I3 | W1 |
| `work.design.offline_max_revisions` | — | Offline revisions. | I3 | open (OQ-11) |
| `work.design.offline_reasoning_budget` | 2048 | Offline design budget. | I3 | E1 |
| `work.find.budget_s` / `budget_blocks` | 600 / 512 | Search budget. | I4 | E1 |
| `work.find.breadcrumb_blocks` | 32 | Breadcrumb spacing. | I4 | E1 |
| `work.smelt_batch` | 8 | Items per smelt call. | I5 | E1 |
| `work.underground.no_parkour_below_y` | 50 | Hazard setting. | I5 | E1 |
| `work.underground.max_drop_down` | 3 | Hazard setting. | I5 | E1 |
| `work.night_policy` (profile) | continue | `continue` or `shelter` (§7.6). | Surv | E1.2 |
| `work.night_resume_before` | 12000 | Under `shelter`: `timeOfDay` below which a sheltered step resumes after the night. | Surv | D4 §13 |
| `work.find.dusk_tick` | 11500 | Under `shelter`: no new legs after this `timeOfDay`. | Surv | P1b |
| `work.min_health` | 10 | Health gate threshold (REQ-RES-8). | Surv | D4 |
| `work.food_block_at` | 6 | Block with no food at or below this (REQ-SAFE-10). | Surv | E1 |
| `work.allow_drop_task_surplus` | false | Drop unneeded task pickups (REQ-OBT-11). | Surv | E1 |
| `work.ask_over_s` | 900 | Ask before tasks estimated longer (REQ-BLD-8). | Surv | P1b / E1 |
| `work.find.allow_locate` | false | `/locate` use (REQ-SAFE-6). | Surv | E1 |
| `work.find.ask_targets` | desert_pyramid, jungle_temple, mansion, monument | Ask first (REQ-FIND-11). | Surv | P1b |
| `work.underground.lava_turn_radius` | 2 | `descend_to`: turn the tunnel away. | Surv | P1b |
| `work.underground.torch_every` | 8 | `descend_to`: steps between torches. | Surv | P1b |
| `work.find.places_caps` | 200 resource, 50 mob areas (LRU) | Discovery database caps. | I4 | P1b |
| `work.find.mob_area_ttl_ticks` | 24000 | Mob-area expiry (1 game day). | I4 | P1b |
| `work.find.merge_radius` | 4 | Merge nearby ore sightings. | I4 | P1b |

Retired keys (W3): `work.danger_radius` (now the constant 8),
`work.max_interrupts` / `interrupt_window_s`, `work.max_restarts` /
`restart_window_s` and `work.max_unsafe_wait_s` (all replaced by
`work.step_stall_s`), `work.craft_no_progress_s` (merged into
`work.no_progress_s`), `work.report_with_model` (reports always come from facts),
`work.view_max_chars`, `work.notes_max_chars` / `result_max_chars` (constants, or
retired with `notes`), `work.build.scaffold_block` / `scaffold_reserve`
(constants), `work.probes_enabled` (no `!probe` command).

Data tables (not tunables): `work/data/natural_blocks.json` (I1),
`structure_signatures.json` and `biome_priors.json` (I4), `smelting.json` (I5).

## 15. Observability and metrics

- **REQ-OBS-1** [I1] The provider logs one line per request to
  `$MINDCRAFT_RUNTIME_DIR/diagnostics/requests.jsonl`: time, request kind
  (decision / summary / coding / bot_responder), prompt, cached and completion
  tokens (when the backend reports them), reasoning characters, duration, task id,
  and (I2) tool count and tool-parse result.
- **REQ-OBS-2** [I1] Runner events (start, end, interruption cause, resume-check
  refusal, deadline, stall, block) go to the existing bot log with the task id.
  Per-task totals (model calls by kind, resumes, wall time) are derived from
  `requests.jsonl` and the log; the record holds no `metrics`.
- **REQ-OBS-3** [I1] Every live trial reports what the logs and the record give
  automatically: request text, start and end time, model calls by kind,
  interruptions and how many resumed with 0 calls, blocks and their reasons, and
  the verifier outcome. Build trials add the protected-block diff (non-natural
  blocks within 16, before and after). Interventions should be zero.

Targets (measured, not promised):

| Task | Model calls | Today |
|---|---|---|
| Gather or craft | 1 plan + 0–1 validation + 0–1 blocked; typically 1–3 | 20–34 requests per task, 26–30 % summaries |
| Simple shelter from an empty inventory | 2–5 | no completed house |
| Ordinary interruption | 0 | 1+ (AUTO MESSAGE or goal re-prompt) |

## 16. Known limits and residuals

Recorded, not built:

- Falling-block hazards in builds are handled after the fact by the world-diff
  builder, apart from the `safeToBreak` falling-block check before each dig.
- A cave dug under a sand or gravel ceiling is refused, and the build blocks with
  the reason (REQ-BLD-15).
- A player's natural-dirt build cannot be told from terrain.
- Structure recognition is heuristic; entity tracking and load radius depend on
  the server.
- `unstuck` still fires on movement steps, by design.
- 10 s watchdog exits remain possible; crash-restart resume and the stall rule
  make them survivable.
- Owner chat mid-task may interrupt the runner while Qwen answers (folded into
  S2/S3 tests; contention measured in I2).
- Crafting sync on a silent server can take about 80 s (C07), so the single
  no-progress deadline is 120 s, and a stuck collect or path call takes up to
  120 s to give up (REQ-RES-5).
- Until I3, dirt scaffold pillars may stay beside a build (cosmetic; dirt counts
  as natural; the approach cell keeps the entrance clear).
- A table or furnace left behind by a crash stays in the world; while its ledger
  entry or station entry survives it can be reused or picked up.
- Until I5, clay or sand under water cannot be collected, because the hazard flags
  stay forced for every block (REQ-SAFE-3); the step gets an honest "none
  reachable".
- From I5 until the survival iteration, buried ores are dug by the pathfinder,
  which is less careful than a staircase; acceptable only while the bot is
  invincible.
- Until the wider smelting table (`smelting.json`, I5), smooth stone, green dye and other
  inputs outside mcdata's whitelist are refused ("no method for X in this
  version").
- Under `night_policy: shelter` (Surv) with the `doDaylightCycle` gamerule off, a
  sheltered step waits forever (LOW).
- Lava meeting water makes cobblestone, which then counts as protected and is not
  dug (LOW).
- The upper door half and the second bed cell are not in the placement ledger,
  because Mineflayer's `blockPlaced` reports only the destination cell
  (node_modules/mineflayer/lib/plugins/place_block.js:44), so those positions
  are not exempt under REQ-SAFE-2 (LOW).
- Pathfinder pillars placed outside a build get no ledger kind; they are recorded
  but are neither scaffold to clean up nor a station (LOW).
- The `shelter` dig-in (Surv) digs through `breakBlockAt` (skills.js:586 →
  `bot.dig`), which bypasses `safeToBreak`, so its call sites must call the
  patched `safeToBreak` through a `Movements` instance, as the builder does
  (REQ-BLD-14) (LOW).
- All live trials run with the owner's server making the bot invincible (no
  damage, drowning or hunger). They show task capability, not survival or
  self-sufficiency.
- Until the survival iteration, a long build starts without asking first, and a
  search that runs out of budget ends; the owner asks again to search further.
- After an exhausted search blocks, Qwen's one blocked-step turn may start a new
  search by itself. Accepted (LOW): each search is bounded by its budget, and the
  task by the stall rule (REQ-RES-16).
- Junk the bot dropped can be picked up again on contact when a later path
  crosses the spot (REQ-OBT-11).
- `!newAction` (generated code) is outside the task layer and refused while a
  task is non-terminal (REQ-RES-9); C08,
  C10, C14 and C17 limits remain on the text path.
- `MemoryBank` stored no dimension before the persisted backing (fixed in I4).
- Deferred, each behind a seam (PLAN §8): clearing/levelling, furniture and
  decoration (`detail: full`),
  yaw-dependent blocks (stairs, beds, gables), multi-task queues, friends'
  ownership, `hunt`, trading, buckets, shearing, farming, fishing, schematic and
  image import, explorer maps, boats, Nether/End, larger caps, a
  request gate between summaries and decisions, a Pi swap.

## 17. Open questions (settled by experiment or a later ruling)

| # | Question | Settled by |
|---|---|---|
| OQ-1 | Does the backend return parsed `tool_calls` within the 2048 budget, honour `parallel_tool_calls:false`, and keep nested arguments? | I2, probe P1 before S1 |
| OQ-2 | (closed by W3: arm A adopted, REQ-TRN-12; arm B only on evidence. Whether per-turn example selection should be fixed stays with I2 measurements.) | — |
| OQ-3 | Does the client inventory go stale after furnace use? | I5, probe P9 before S6 |
| OQ-4 | Does door facing follow yaw as predicted (an unprobed prediction)? Does the pathfinder climb the bot's own ladders mid-build instead of pillaring? | P8 in S3; P7 in S5A |
| OQ-5 | Effective R_load, entity tracking range, and which structure markers exist in the deployed game version's world generation. | I4, probes P5, P6, P10 in S5B |
| OQ-6 | Design caps: P1b proposed 12×12×16 and 600 cells; P2b 16×16×16 and 1,024 edits. | DX |
| OQ-7 | Material margin in the bill (P1b proposed 10 %). | S3 measurement |
| OQ-8 | Default for `work.max_leaf_clear`. | S3 forest fixture |
| OQ-9 | Exact test for `embed: require` (I1) and for `embed: avoid` (I3). | S3 fixtures; DX fixtures |
| OQ-10 | (closed by W1: `here` and the default anchor are the owner's position if tracked, else the bot's, frozen at validation, REQ-PLAN-8; default shelter size 3.) | — |
| OQ-11 | Offline design revision limit. | DX |
| OQ-12 | (closed by W1: the owner-question contract, REQ-REC-12; deferred to the survival iteration by W3.) | — |
| OQ-13 | (closed by W3: one 120 s no-progress deadline covers craft calls, REQ-RES-5.) | — |
| OQ-14 | (closed by E1.2: night costs no model call under either policy, so no sleep decision exists in v1.) | — |
| OQ-15 | (closed by W1: the ledger persists in the task record, REQ-BLD-22; W3 kinds `permanent` and `station`, `scaffold` from I3.) | — |
| OQ-16 | Plan quality of the quantized Qwen with the text DSL (I1) and the typed schema (I2); whether DX arm A (parts only) meets the bar. | S2/S3 trials, I2 trials, DX |
| OQ-17 | Which entity types `mc.isHostile` (utils/mcdata.js:113-116) classifies as hostile on the deployed version; the resume check and `self_defense` rely on it. P11 ran: `allay` and `copper_golem` were classified hostile and are now excluded (§5.3); `hoglin`, which the function misses, is Nether-only and left as is. | S0-lite, probe P11 |
| OQ-18 | Is a request gate between summaries and decisions needed on the single backend? | I2 (S4 measurement) |
| OQ-19 | Is `descend_to` ever needed as a plan step, or only inside `obtain`? | Survival iteration |
| OQ-20 | Which raw commands to block through `blocked_actions` beyond the I1 default (`!buildStructure`, from S3); `!collectBlocks` and `!craftRecipe` stay available for one-off requests (REQ-TRN-13). Blocking also removes them from the owner's typed commands. Also an open owner question: whether to block `!newAction` outright in I1 rather than guard it during tasks (REQ-RES-9). | S2/S3 trials: decide if Qwen bypasses `!taskStart` or `!build` |

---

## Appendix A. Interaction coverage

How every kind of interaction is handled. "—" means not applicable.

| Interaction | v1 handling | Iteration | Later / out |
|---|---|---|---|
| Walk, climb, swim on the surface | pathfinder under the `safeToBreak` patch | I1 | — |
| Return to work after interruption | runner (§7) | I1 | — |
| Dig natural blocks to gather | `obtain` collect/mine | I1, I5 | — |
| Fell trees | `obtain` logs; only trees that pass the tree test | I1 | — |
| Dig underground for ores | `collectBlock` and pathfinder digging under the forced flags | I5 | `descend_to` staircase (Surv) |
| Dig to build (cave, hillside) | `air` cells; the patched `safeToBreak` (liquid and falling-block checks) | I1 | — |
| Place blocks, foundations | builder, face-aware, re-read | I1, I3 | — |
| Clear vegetation | soft cells; leaves ≤ `work.max_leaf_clear` | I1 | — |
| Clear or level an area, find a flat site | not done unless asked | — | deferred `clear` step |
| Water, lava | avoided; liquid checks; lava in `blocksToAvoid` | I1, I5 | underwater targets (I5), lava turn (Surv), buckets deferred |
| Falling sand/gravel | `safeToBreak` falling-block check; builder re-dig | I1 | staircase checks (Surv) |
| Torches | `torch_placing` mode | I5 | tunnel torches with `descend_to` (Surv) |
| Ladders | ladder cells, auto-ladder access | I3 | — |
| Entrances and doors | open 1×2 entrance (`minimal`); door with yaw and facing check (`basic`); approach cell; opened by pathfinder | I1 | — |
| Beds | owner's `!goToBed` text command only; in designs replaced by full blocks | — | yaw-dependent blocks |
| Crafting table, furnace | resolver places and picks up its own; carried forward as `station` entries whenever a new task replaces the record (REQ-BLD-22) | I1, I5 | — |
| Chests | `!putInChest`/`!takeFromChest` (text in I1, tools from I2) | I1 | authorised deposit chest (Surv) |
| Full inventory | junk drop from `work.junk_items` with no model call; else block with the five largest stacks | I1 | — |
| Owner's builds and containers | protected; may serve as a `solid` cell | I1 | — |
| Villages and other structures | found, recognised, protected; never looted | I4 | — |
| Hostile mobs | modes defend/flee; resume check | I1 | health gate, night shelter (Surv); combat steps out of scope |
| Creepers | modes; resume with 0 calls | I1 | — |
| Animals: find | `find{entity}` (observe only) | I4 | — |
| Animals: kill for food/drops, breed, shear, milk, lead | — | — | `hunt` and other methods deferred |
| Villagers: find, see profession | `find{entity}`; `!entities` | I4 | — |
| Villagers: trade | existing explicit commands (text) | — | trading as obtain method deferred |
| Players: owner requests | chat → Qwen → text commands (I1), tools (I2) | I1, I2 | friends later |
| Players: follow, go to, give | chat-action commands; `give` step | I1 | — |
| Players standing in a build footprint | cell deferred, "please step out" once, retried next pass (REQ-BLD-34) | I1 | — |
| Owner answers a bot question | intercepted before the model; one history line (REQ-REC-12) | Surv | — |
| Farming, fishing | — | — | deferred methods |
| Nether, End, strongholds, oceans | outside v1; unknown targets refused, searches end honestly | I4 | deferred |
| `/locate`, explorer maps | — | — | `/locate` (Surv); explorer maps deferred |
| Death | `paused(died)`, one model call | I1 | — |
| Night | work and fight through (`continue`) | I1 | `shelter` policy: code dig-in and time resume, no model call (Surv) |
