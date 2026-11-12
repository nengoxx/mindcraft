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
| `[I1]` | Usable for play: plan, gather and craft, combat then back to the task, clearing an area on request, a simple terrain-fitting shelter, text commands | S0-lite, S2, S2b, S2c, S2c-fu, S3 |
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
9 Obtain · 10 Find and explore · 11 Building (with 11.9 Clearing and 11.10 the
bot's own blocks) · 12 Transport · 13 Safety ·
14 Configuration · 15 Observability (with 15.1 Chat to the owner) · 16 Known limits · 17 Open questions ·
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
- Clear an area the owner names, on request, and leave none of the bot's own
  reachable scaffold behind as clutter (§11.9, §11.10).
- Survive interruptions, model outages and process restarts without losing the
  task (§7).

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
  for it as its own task (DECISIONS 2026-11-08 "Building fits the terrain"). A
  build never clears its site by itself. Clearing an area is a capability of its
  own, done only on the owner's request: the `clear` step (§11.9; DECISIONS
  2026-11-08 "Clearing an area and the bot's own blocks"). Levelling and
  site-hunting stay deferred (PLAN §8).
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
| **Owner question** | A question code asks the owner and records as `pending_question`; only the owner's reply answers it (REQ-REC-12). The core and the clear step's questions are I1 (S2c); the other consumers are `[Surv]`. |
| **Detail level** | How finished a build is: `minimal` (floor, walls, roof, open 1×2 entrance) or `basic` (adds a door and optional window openings) (§11.8). |
| **Design library** | Qwen's saved, validated designs, made in-game or in an offline design session. |
| **Fit search** | Code that picks origin, rotation and small shifts near the anchor with the fewest edits (§11.4). |
| **Blueprint** | The compiled, fitted template frozen into the task record with its origin and rotation, so re-running a build is idempotent. |
| **Region** | A functional part of a blueprint: a room, a top surface, a wall run (§11.7). The generator that made the blueprint names its regions. |
| **Verification contract** | The list of functional checks for a blueprint, emitted by its generator (the shelter macro, the compiler, or the explicit contract of a catalog template). "Done" means every check passes. |
| **Non-natural block** | A block that world generation does not place as terrain: planks, glass, crafted blocks, containers, beds, doors, cobblestone and so on. Protected (§13). |
| **Placement ledger** | Positions where the bot itself placed blocks. In S2 it is held in the task record and recorded from Mineflayer's `blockPlaced` event, and its entries are exempt from protection. From S2c it is its own file with kinds (`station`, `scaffold`, `building`, `own`) whose protection differs by kind (§11.10); from S2c-fu the file keeps the entries per world (REQ-OWN-1). |
| **Scaffold** | A block the pathfinder placed to move or fight (pillars, bridges, blocks for getting up). A live `scaffold` ledger entry placed this session is exempt everywhere and is removed by the tidy sweep (REQ-OWN-2, REQ-OWN-7). From S2c-fu its record survives a restart, a crash and a chunk unload; such an entry (with `gap_at`) is the bot's only while its connected component stands free (REQ-OWN-4). |
| **Chat category** | What a line the bot says is: `reply`, `question`, `alert`, `done` or `detail`. `work.chat` `quiet` (the default) shows every category but `detail`; `debug` shows all (REQ-CHAT-1). |
| **Tidy sweep** | `tidyNear` in `work/tidy.js`: the bot removes its recorded scaffold within reach, without moving (REQ-OWN-7). |
| **Clear box** | The cells a `clear` step empties, frozen at validation, with an optional kept outer layer (the shell) (§11.9). |
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
| Pick up items | `pickupNearbyItems` (skills.js:580) | works | Walks to every item entity within 8 blocks; called after manual digging and by the `item_collecting` mode (modes.js:189-211). | After digging; a small carry skips the names the bot dropped at a recorded drop point (REQ-OBT-11). |
| Use tool on block/entity | `!useOn` (actions.js:528-537) → `useToolOn` (skills.js:2007) | partly | Generic right-click. | Not used in v1 (buckets, shears deferred). |
| Farming | `tillAndSow` (skills.js:1600) | partly | Skill only, no command. | Deferred method. |
| Craft | `!craftRecipe` (actions.js:303-312) → `craftRecipe` (skills.js:37-131) | works | Counts recipe runs, not items. Uses the first recipe (:97). Places a crafting table from inventory and picks it back up (:57-91). Reports before/after counts (fork C09). | `craft` nodes of the resolver. Not offered as a tool. |
| Craftable list | `!craftable` (queries.js:147) | works | — | — |
| Crafting plan | `!getCraftingPlan` (queries.js:284) → `getDetailedCraftingPlan` (utils/mcdata.js:436) | partly | Returns text. First recipe only (:486-487). Treats smelted items such as `iron_ingot` as base items (`loopingItems`, :391-433). | The plan text is not used. Its batch and leftover arithmetic (`craftItem`, :458-503: batches = `ceil(need/yield)`, excess to leftovers) is reused by the resolver (REQ-OBT-4). |
| Item dependency tree | `agent/npc/item_goal.js` | partly | Not reachable from commands. Its executor nests `runAction`, which deadlocks and lets the 10 s watchdog kill the process. `hunt` assigns an undeclared `res` (:163) and throws in strict mode. Blacklists deepslate, stripped, dye items (:7-20). Table rule `>4` ingredients (:45) misses 3-wide recipes. One coal per input (:75-80). | Not used (E1 B.7). |
| Smelt | `!smeltItem` (actions.js:314-328) → `smeltItem` (skills.js:157-288) | works | One input type. Places a furnace from inventory. Fuel: coal/charcoal/blaze rod, then logs/planks (utils/mcdata.js:261-283). Pauses `unstuck` itself (:195). Takes inputs and fuel back on interruption (:266-271). The **command** restarts the process after a successful smelt "to update inventory" (actions.js:320-326). | `[I5]` Reused: `smelt` nodes call `smeltItem` with its own nearest-furnace lookup, plus a small carry (only empty furnaces; take back only what it put in; REQ-OBT-6). It pauses `unstuck` itself. The command is not used. |
| Clear furnace | `!clearFurnace` (actions.js:330) | works | — | Furnace reconciliation. |
| Find block | `!searchForBlock` (actions.js:163-176) → `goToNearestBlock` (skills.js:1262-1297) | partly | Loaded chunks only; range 32–512 (cap :1273); walks to the nearest; no memory. Mineflayer's `findBlocks` misses blocks inside its radius (4–26 % by radius in a council probe; the 8th cube marker, 13.7 blocks away, was missed at radius 16), which also affects `collectBlock`. | Replaced by `find` (§10). Positions of a block type: `!blockPositions` with a complete search (REQ-TRN-16). |
| Nearby blocks | `!nearbyBlocks` (queries.js:118) | works | In `$STATS`. | Prompt state. |
| Find entity | `!searchForEntity` (actions.js:178-187) → `goToNearestEntity` (skills.js:1299-1317) | partly | Tracked entities only (`bot.entities`, agent/library/world.js:179-197). | Replaced by `find{entity}`. |
| Entities | `!entities` (queries.js:162); villager profession (world.js:218-258) | works | — | Prompt state; `find` evidence. |
| Biome | `getBiomeName` (world.js:421-435) | partly | Bot position only. Uses the negotiated registry (fork C15). | `find` evidence and the exploration biome prior (I4). |
| Structures | — | missing | No recognition. `/locate` never used. | `find{structure}` with signatures (§10.5). |
| Exploration | `!moveAway` (actions.js:189) → `moveAway` (skills.js:1422-1453); item_goal's random 8-block move (item_goal.js:326) | missing | No systematic exploration. | `work/explore.js` (§10.3). |
| Dig down | `!digDown` (actions.js:512-518) → `digDown` (skills.js:1931-1986) | partly, unsafe | Digs straight down under the bot. Checks only the target and the block below for liquid (:1952-1953). No side or falling-block checks, no exit route. | **Not used** (REQ-FIND-15). |
| To surface | `!goToSurface` (actions.js:520) → `goToSurface` (skills.js:1988-2005) | partly | Walks to the highest block at the bot's x,z. | Fallback exit only. |
| Navigate | `!goToCoordinates` (:150), `!goToPlayer` (:128), `!followPlayer` (:139), `goToGoal` (skills.js:1132-1165, current tree) | works | `goToGoal` tries a low-dig path, then **falls back to unrestricted digging**. It builds its own `Movements` and discards the caller's movement settings, so `breakBlockAt`'s "no scaffolding" never applies and its approach pillars with dirt or cobblestone. `followPlayer` is the only resumable action (actions.js:147). | Movement inside steps, under the `safeToBreak` patch (REQ-SAFE-3). S2b adds a `configure` argument so callers' settings survive (§5.3). |
| Doors | `startDoorInterval` (skills.js:1141), `useDoor` (:1524); pathfinder `canOpenDoors=true` (node_modules/mineflayer-pathfinder/lib/movements.js:114) | works | — | Verification path checks. |
| Build catalog | `!getStructureInfo` (queries.js:16-27), `!buildStructure` (actions.js:35-54) → `BuildGoal.executeNext` (agent/npc/build_goal.js:148-203) | partly | Four fixed templates (agent/npc/construction/). World-diff: places only missing cells, idempotent at the same origin (:172-187). Rotation (:24). Door/bed grouped as one item (:33-50). Site check reports the first issue (:65-106). **Rejects any obstruction, including grass** (:99-102). No `solid` class (`getTypeOfGeneric` at :169, skipped at :180). Prefers the `'bottom'` face (:182). Skips obstruction checks for cells below y 0 (:94), and `placeBlock` breaks what is in the way (skills.js:732-738), so a chest in a floor cell is broken. Upper door cell is never prepared (:177-178). 10-minute timeout; not resumable. | Extended as a carry (§11.6); executes every blueprint. |
| Place one block | `!placeHere` (actions.js:338), `placeBlock` (skills.js:636-814) | works | Takes a preferred face and falls back to others (:752-763). Looks at the support block before placing (:804), which sets door facing. Mineflayer waits up to 5 s for the block to change and throws if it does not (node_modules/mineflayer/lib/plugins/place_block.js:29-43), so `true` means *a* block appeared, not which block or facing. | Builder placement plus re-read (REQ-BLD-20). |
| Generated code | `!newAction` (actions.js:56-89), agent/coder.js | partly | Fork C08/C10/C14/C17 repairs. Not resumable. | **Not offered on the tool path** (§12.4). On the I1 text path it is guarded while a task is non-terminal (REQ-RES-9); blocking it outright is OQ-20. |
| Blueprint tasks | `!checkBlueprint*`, `!getBlueprint*` (queries.js:244-282) | n/a | Evaluation harness only; blocked by default (settings.js:45). | Not used. |
| Inventory | `!inventory`, `!equip` (:240), `!consume` (:232), `!givePlayer` (:220), `!discard` (:278) → `discard` (skills.js:863, `bot.toss`), `!putInChest` (:248), `!takeFromChest` (:259), `!viewChest` (:270) | works | — | Text commands as today in I1; chat-action tools from I2 (§12.4); `give` step. |
| Auto-eat | mineflayer-auto-eat, `startAt: 14` (agent/agent.js:192-196) | works | Already eats below 14 food when food is held. | Kept; the "no food" block (REQ-SAFE-10) is `[Surv]`. |
| Sleep | `!goToBed` (actions.js:368) → `goToBed` (skills.js:1612) | partly | Walks to the nearest bed within 32 and sleeps; P14 (2026-11-11) showed `bot.sleep` works through ViaProxy and the night skipped about 3 s after she lay down (she was alone online). Its in-bed loop (`while (bot.isSleeping)`, :1637) ignores `interrupt_code`, so a `!stop` while it sleeps waits for the server to wake her and past 10 s the stop watchdog kills the process (ISSUES; not fixed, design §12). | Owner text command only; for beds already in the world. Nightly sleep is the task layer's own routine (`work/sleep.js`, §7.9), which never calls it. |
| Villagers | `!showVillagerTrades` (actions.js:423) → skills.js:1773; `!tradeWithVillager` (:431) → skills.js:1814 | works | Explicit trades only. | Trading as an obtain method is deferred. |
| Combat | `!attack` (:347), `!attackPlayer` (:355), `defendSelf` (skills.js:385), `avoidEnemies` (:1470) | works | — | Modes handle danger; no combat steps in v1. |
| Modes | agent/modes.js:24-304: `self_preservation`, `unstuck`, `cowardice`, `self_defense` (interrupt all actions; from S2d also the fork's `sleeping`, §7.9); `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `idle_staring` (idle only); `cheat` (off) | works | Interrupting modes stop any action. Afterwards an AUTO MESSAGE re-prompts the model unless a resume function is set (modes.js:317-329). `unstuck` fires after 20 s within 2 blocks while an action runs (:102-131) and kills the process if `moveAway` takes over 10 s (:126). `hunting` defaults on (:176); the deployed profile turns it off. | Kept as the reflex layer (§7). |
| Goal | `!goal` (actions.js:400-413), `!endGoal` (:415), self_prompter.js | works | `!goal` cannot be blocked (commands/index.js:18). While the self-prompter is active, resume never runs (agent/action_manager.js:63). | Guarded while a task is active (REQ-RES-9). |
| Places | `!rememberHere` (actions.js:197), `!goToRememberedPlace` (:207), `!savedPlaces` (queries.js:237), agent/memory_bank.js:1-24, death place (agent.js:490) | partly | In RAM only; never saved (history.js:110-126 omits it); no dimension. | `[I4]` Persisted backing with the same API (REQ-FIND-17). |
| Memory | agent/history.js: 15 turns, summary of the oldest 5, cut at 500 chars (:44-45); summaries run in the background (:50-59) | partly | Summaries invent facts and truncate (C03). | Conversation only; working state moves to the task record (REQ-REC-10). |

### 4.2 Mechanisms the design relies on (verified)

| Mechanism | Evidence |
|---|---|
| `runAction(label, fn, {resume:true})` stores `resume_func` (action_manager.js:56-62). | Adversary fixture: a resumable run interrupted by a mode finished 20/20 with no model call. |
| A mode interrupt sends no AUTO MESSAGE while `resume_func` is set (modes.js:317-322). | Code. |
| After a run ends without interruption, `idle` fires (action_manager.js:133-135); one second later the agent calls `resumeAction()` if idle (agent.js:499-508). | Code. |
| `resumeAction()` passes no timeout (action_manager.js:15-17, :56). Upstream, a **resumed** run therefore gets the default 10-minute timeout, whatever the first run was given. From S2d the `action_manager.js` carry (§5.3) stores the timeout a resumable action started with beside `resume_func` and uses it on every resume, so a resumed `!followPlayer` (started with −1) and a resumed task run keep "no timeout". | Code; `work-sleep.test.mjs` "a cut follow resumes with timeout -1 …". |
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
| The pathfinder writes a predicted stone (state 1) into the destination cell just before it calls `bot.placeBlock` through the bot object (Mindcraft's pathfinder patch file, `patches/mineflayer-pathfinder+2.4.5.patch`). No other caller places into stone, so a placement whose destination reads state 1 at call time is the pathfinder's (tell A). Its `blockPlaced` event fires about 3 times per cell with `newBlock` = the server's stale air; the real block arrives 0.5–1.1 s after the first attempt as a plain `blockUpdate`. `pathfinder.isBuilding()` reads false at every `blockPlaced`. | Live probe P13, 2026-11-10: tell A held on 24 of 24 pathfinder placements; false positives were not exercised (no other placement happened). |
| The pathfinder's entity-above check (`dontMineUnderFallingBlock`'s entity part) reads an entity index that is filled only when a path search starts (`getPathTo`) and cleared when the path resets, so a dig-time check outside a search does not see a player standing on the cell. | Code (movements.js `updateCollisionIndex`, index.js `getPathTo`, `resetPath`); council adversary. |

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
| `agent/work/chat.js` | The chat switch and categories: `chatMode`, `chatShown`, the turn's category (§15.1, REQ-CHAT-1). | I1 (S2c-fu) |
| `agent/work/record.js` | Task record load/save (atomic), versioning, transitions. | I1 |
| `agent/work/runner.js` | Runs, resume check, deadlines, the stall rule, step dispatch, reports. | I1 |
| `agent/work/plan.js` | The text DSL parser (§12.0), validation and dry run of plans. | I1 |
| `agent/work/commands.js` | Text commands `!taskStart`, `!taskRevise`, `!taskPause`, `!taskResume`, `!taskCancel`, `!build` (I1); `!blockPositions` (I1, S2b); `!tidy` (I1, S2c); their tool forms (I2); owner-only `!saveTemplate` (I3). | I1, I2, I3 |
| `agent/work/steps/*.js` | Step registry: `obtain`, `go_to`, `give` (I1, S2), `clear` (I1, S2c), `build` (I1, S3); `find` (I4). | I1, I4 |
| `agent/work/ledger.js` | The placements ledger file (`placements.json`): kinds, the placement wrap and its settlement, retirement, the cap and eviction (§11.10). From S2c-fu: per world (file version 2), kept scaffold with its gap mark, hygiene, the exit flush, `scaffoldEligible`. | I1 (S2c, S2c-fu) |
| `agent/work/dig.js` | The dig seam shared by the clear step, the tidy sweep, the bed pickup (S2d, `ownBed`) and S3's builder: `digCell` with its approach, occupancy check, safety check, tool and reason (REQ-CLR-6). | I1 (S2c) |
| `agent/work/tidy.js` | The tidy sweep `tidyNear` and its triggers' launch checks (REQ-OWN-7 … 9). | I1 (S2c) |
| `agent/work/sleep.js` | Sleeping through the night (§7.9): `Sleeper` with `next()` (when she sleeps, what sleep may cut), the `mode:sleeping` routine (spot, placement, sleep, the guarded wake), the bed pickup in the routine and as `action:bed` from `Work.tick`, the in-memory night record and collection receipt, the owner lines. | I1 (S2d) |
| `agent/work/inventory.js` | Inventory upkeep (REQ-OBT-11): the policy helpers (`keepOf`, the registry check), the planner `planRemoval` (slot operations: what, never where; the best of a limited item stays), the dropper `dropItems` (facing over a one-block lip, the walk to a drop spot `findDropSpot`, the look fix, the hand off a held slot, per-slot tosses) and its re-pickup guard `isGuardedJunk`, `largestItems` (the kept note and the blocked report), and `Upkeep`: the idle cleanup `action:items` from `Work.tick` (its two admissions, currency, holds), `!itemList` and the owner lines; its constants `INVENTORY`. The item list's merge lives in `config.js`. | I1 (S2e) |
| `agent/model_outage.js` | Outage state shared by the prompter, the coder and the self-prompter: `down`, `up`, `isDown`, waiting; one owner notice per outage and one on recovery (REQ-RES-17). Created in the agent init carry. | I1 (S2b) |
| `agent/work/resolve.js` | Obtain resolver (§9): surface items (I1); mine and smelt nodes (I5). | I1, I5 |
| `agent/work/protect.js` | Protection predicate, tree test, placement ledger (S2; from S2c it reads `ledger.js` by kind and the active clear box's scope; from S2c-fu the component guard for old scaffold, REQ-OWN-4), the `Movements.prototype.safeToBreak` patch with the forced hazard flags, the SIGINT `clean_stop` handler. | I1 |
| `agent/work/site.js` | Fit search (§11.4). | I1 |
| `agent/work/shelter.js` | The shelter macro: the permanent functional shelter generator, not rebuilt through the compiler (REQ-BLD-4). | I1 |
| `agent/work/verify.js` | Functional verification of the contract a generator emits (§11.7). | I1, I3 |
| `agent/work/compile.js` | Parts spec to template, with private geometry helpers (REQ-BLD-5). | I3 |
| `agent/work/designs.js` | Template sources beyond the catalog, the design library and owner templates (§11.8). | I3 |
| `agent/work/places.js` | The persisted `MemoryBank` backing (REQ-FIND-17). | I4 |
| `agent/work/locate.js`, `explore.js` | Locator chain, exploration. | I4 |
| `agent/work/underground.js` | `descend_to` staircase and tunnel. | Surv |
| `agent/work/smelt.js` | (retired: S6 reuses `skills.smeltItem` through a small carry, REQ-OBT-6.) | — |
| `agent/work/ask.js` | Owner questions: render, record, parse the owner's reply; called by the `agent.js` interception before the model (REQ-REC-12). Whether the I1 core lives here or in the clear step and `index.js` is decided when S2c is built. | I1 (S2c: the core), Surv |
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
| `agent/agent.js` | I1: `this.work` init in `startEvents`, given `init_message` to tell a crash restart from a fresh start. I1 (S2b): the outage module created at init; a catch on the un-awaited `handleMessage` call in `respondFunc` (:174); `handleMessage` passes its self-prompt flag to `promptConvo` (:338); a loaded self-prompter `PAUSED` state with the outage flag restarts the recovery probe (:203; REQ-RES-18). I1 (S2c): owner-answer interception in `handleMessage`, after the forced-command block (:278-300) and before the history add (:323), so a matched answer to `pending_question` never reaches the model (REQ-REC-12; Surv adds its other consumers). I1 (S2c-fu): quiet chat (REQ-CHAT-1): `openChat(message, category = 'detail')` gates every line first; `routeResponse` passes the category through (the bot-to-bot branch unchanged); `reply` on the raw owner command's "does not exist" (:291) and result (:306) and on a model reply with no command (:408); in quiet a branch around the whole `show_command_syntax` dispatch (:369) sends only the text before the command, by the turn's voice (`work/chat.js` `replyCategory`, taken for every response with a command, :373, so it consumes a pending owner answer); `cleanKill` says "Restarting."/"Exiting." only when `detail` is shown (:572). I2: structured tool-call branch inside the stop-epoch checks, before the empty-response break (:329-338). | fork carry | I1, I2 |
| `models/prompter.js` | I1: request kind passed to the provider; task view into `$SELF_PROMPT`. I1 (S2b): the model keys read through `loadWorkConfig(profile.work)` (the prompter is built before `Work`); `requestOptions` adds an `outcome` object; `promptConvo` waits through an outage with back-off without spending its tries; `promptCoding` reports an outage to the coder (REQ-RES-17). I2: envelope accepted on the tool path (string checks use `.content`; stale-response check kept); tools only on decision requests. | fork carry | I1, I2 |
| `agent/coder.js` | I1 (S2b): an unreachable model ends generation with the outage message and does not count as a "no code block" failure (REQ-RES-17). | fork carry | I1 |
| `agent/self_prompter.js` | I1 (S2b): the outage pause: `PAUSED` with an `outage` flag, the recovery probe, resume of the same goal epoch; `start()`, `!stop`, a new goal and a manual pause clear the flag (REQ-RES-18). I1 (S2c-fu): the "did not use command … Stopping auto-prompting" line is an `alert` (:141; REQ-CHAT-1). | upstream before S2b; fork carry since | I1 |
| `agent/modes.js` | I1 (S2c): in `execute`, `should_reprompt` excludes the quiet actions, and one callback line at its end, `agent.work?.onModeEnd(mode.name, code_return)` (REQ-OWN-8). I1 (S2d): the exclusion becomes one shared check, `!agent.work?.isQuietAction(interrupted_action)` (`action:tidy`, `mode:sleeping`, `action:bed`; from S2e also `action:items`, with no change to this file); one `modes_list` entry, `sleeping`, right after `self_defense` (`interrupts: ['all']`, `on: true`), whose `update` runs `agent.work?.sleeper?.next()`'s routine through `execute` (REQ-SLP-1). Retire when upstream offers a quiet-action flag and a mode-end event; the `sleeping` entry when upstream sleeps by itself. | upstream | I1 |
| `agent/action_manager.js` | I1 (S2d): `_executeResume` stores the timeout of a new resumable action beside `resume_func` (`resume_timeout`) and uses it on every resume (two lines), so a resumed follow keeps "no timeout" (§4.2; junk design r7 §5, amendment 2). Retire when upstream passes the original timeout on resume. | upstream | I1 |
| `agent/commands/index.js` | I1: register the work commands. I2: export the command list for the adapter. | fork carry | I1, I2 |
| `agent/history.js` | `memory_max_chars` replaces the literal 500 (:44-45). I1 (S2b): the self-prompter's `outage` flag is saved with its state (:115-118). | fork carry | I1 |
| `agent/npc/build_goal.js` | I1: cell classes, the patched `safeToBreak` at dig and replace, both door cells, dig order, face-aware placement, re-read, deferral of cells a player occupies. I3: ladder cells, suffix parsing, access before upper work. | existing fork carry | I1, I3 |
| `utils/mcdata.js` | I1: `isHostile` also excludes `allay` and `copper_golem`, beside the iron and snow golems (owner ruling 2026-11-08, probe P11). I1 (S2c-fu): in `initBot`, beside the "[mcdata] Logged in" line (:97-102), listeners on the client's `login` and `respawn` packets keep `worldState.hashedSeed` as `bot.game.hashedSeed`, the ledger's world (REQ-OWN-1). | fork carry | I1 |
| `agent/library/skills.js` | I1 (S2): `placeBlock` refuses to break a protected block in its way (:744) or to remove one as `air` (:660), and `tillAndSow` to break a protected block above the soil (:1654), through the work module's protection predicate (REQ-SAFE-3). I1 (S2b): `goToGoal(bot, goal, configure = null)` applies `configure` to both of its `Movements` instances, so callers' movement settings survive (today they are discarded). I1 (S2e-fu): the stuck-door helper `startDoorInterval` opens nothing while the active movements have `canOpenDoors === false` (the item walks). I1 (S3): door yaw positioning; post-place re-read. I1: `pickupNearbyItems` skips item entities of a name dropped at a recorded drop point within 3 blocks of it (per name and dimension from S2e, `work/inventory.js` `isGuardedJunk`; REQ-OBT-11). I5: `smeltItem` uses only a furnace with empty slots and takes back only what it put in (REQ-OBT-6). | existing fork carry | I1, I5 |

Estimated I1 total: 4 upstream core files plus 2 existing fork carries, about
80–110 lines (D4 §12; the builder and placement extensions are counted with the
fork carries). The S2b and S2c rows above add to this; their size is counted in
those slices (PLAN §3). These hooks need no core edit:

- the `!goal` guard (wraps `getCommand('!goal').perform` at work init);
- the `Movements.prototype.safeToBreak` patch (installed once by the work module);
- the `MemoryBank` swap (`agent.memory_bank` is read at call time everywhere:
  agent.js:490, actions.js:202, :211, queries.js:240);
- mode toggles through `bot.modes.pause/unpause/setOn` (modes.js:353-379);
- placement tracking through Mineflayer's `blockPlaced` event
  (node_modules/mineflayer/lib/plugins/place_block.js:44) in S2; from S2c
  through a runtime wrap of `bot.placeBlock` and `bot._placeBlockWithOptions`
  at work init, like the command guards (REQ-OWN-3);
- the owner's raw messages through MindServer: a wrap of `agent.respondFunc` at
  work init, beside the existing `chat` and `whisper` listeners (REQ-OWN-9);
- the label of each action started: a runtime wrap of `actions.runAction`
  (REQ-OWN-7); from S2d it also records the turn's voice and whether a goal was
  ACTIVE at the start, and tells the sleeper (REQ-SLP-2, 7); from S2e it also
  records the action on the turn it starts in, and the `handleMessage` wrap
  counts every turn in flight (the item cleanup's admission, REQ-OBT-11);
- the provider's `outcome` seam in our own `models/openai_tools.js`; upstream
  `gpt.js` is unchanged (REQ-RES-17).

Tell A (REQ-OWN-3) depends on one line of Mindcraft's pathfinder patch file
(the predicted `setBlockStateId(dest, 1)` written before `bot.placeBlock`). It
is not our carry; a unit test asserts that order in the installed pathfinder, so
an upstream merge or a pathfinder bump that drops it fails the suite instead of
silently recording every pillar as `own`.

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
| `placements[]` | S2: the placement ledger, `{pos, block, build_id?, kind?: permanent|station, at}` for every block the bot placed while this task was active, the crafting tables and furnaces it placed while it was not, plus `station` entries carried forward from the task it replaced (REQ-BLD-22). From S2c the ledger is its own file (REQ-OWN-1); stations found here are migrated once, and blueprint cells are `building` entries in the placements ledger (REQ-OWN-1). | code |
| `pending_question` | `{id, kind, text, options, asked_at}` while code waits for an owner answer (REQ-REC-12); `kind` tells the questions apart: `clear_start` (REQ-CLR-4) and `clear_leftovers` (REQ-CLR-9), which also holds the positions and blocks it covers. I1 (S2c) for the clear step's questions; Surv for the rest. | code |
| `clean_stop` | Set when the agent process receives SIGINT; cleared by startup classification after it is read (REQ-REC-7). | code |
| `notify_done` | Optional (S2c-fu; the version is unchanged): whether the owner hears the done line, set at `!taskStart` from the turn's voice and by an owner's `!taskResume` or `!taskRevise`; a record without it is judged at done time (REQ-CHAT-1). | code |
| `blocks_by_step` | Optional (S2c-fu): blocks per step ordinal, `{ "<cursor + 1>": count }`, for the "blocked again" alert (REQ-CHAT-2). | code |
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
| `clear` | metric = empty cells (air or liquid) of the box, from rescans; per-cell hard-failure counts; the inline `obtain` sub-progress for a tool; the owner question's state and the granted positions (REQ-CLR-7 … 9). |
| `build` | metric = missing cells; `structures[]` entry id; resolved source. |
| `find` | `target, phase, waypoint, visited, rejected, elapsed_s, travelled, breadcrumbs[], return_place, last_evidence, coverage`. |

### 6.4 Lifecycle

| From | Event | To |
|---|---|---|
| — | `!taskStart` or `!build` passes validation | `active` (cursor 0) |
| `active` | all steps `done` and verified | `done` (terminal) |
| `active` | step blocked (any cause in §7.5) | `blocked` + reason; one model call |
| `active` | an ask is pending (REQ-REC-12; I1 for the clear step, Surv for the rest) | `blocked(awaiting_owner)`; 0 model calls |
| `blocked(awaiting_owner)` | owner answers yes, no or an option (a `clear_leftovers` no included: the step ends with them kept) | `active` |
| `blocked(awaiting_owner)` | owner answers no to a `clear_start` question (REQ-CLR-4) | `cancelled(owner_declined)` (terminal), nothing dug |
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
  are carried forward into the new record (REQ-BLD-22; from S2c stations live in
  the placements ledger, which a task change does not touch, REQ-OWN-1).
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
- **REQ-REC-12 Owner questions.** [I1 core, S2c; Surv consumers] The core below
  (the record field, `blocked(awaiting_owner)` with no model call, the
  interception, no timeout) is built in S2c for the clear step, whose questions
  are its first consumers: the start of a coordinate box (REQ-CLR-4) and the
  leftovers (REQ-CLR-9). The other consumers (`ask_over_s`, rare-target prompts,
  search-budget extensions, `/locate`) stay deferred as one bundle with the
  survival iteration. Until then no other code path asks the owner: a search that
  runs out of budget ends with a final report (REQ-FIND-10), and a new owner
  request starts a new search. When code must ask the owner (the clear step;
  later `work.ask_over_s`, a far or rare target, a search-budget extension,
  `/locate`), it renders the
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
  - **Armed.** An answer counts only while the question is armed, so the
    owner's bare yes to a question of the model's own is not taken as the
    answer. A post arms it only once every line is sent, and only if it is
    still the current question and the latest post and nothing disarmed it
    meanwhile (the first post too). Any other bot chat to the owner (a model
    reply, whatever started its turn: an owner message, a restart or death
    message, a mode) and an owner message that goes on to the model disarm
    it, each with a token of the turn that caused it; only when every such
    turn has finished and its chat is sent does code post the question again,
    which arms it. An unrelated turn's end does not. Runtime wraps of the
    agent's `handleMessage` (each call a turn, carried through its awaits by
    `AsyncLocalStorage`) and `openChat`. The armed state is not persisted: a
    restart posts an open question again before it takes an answer.
  - The parse: short exact answers only (case and trailing "." or "!"
    ignored): yes, ok, sure, go ahead and the like; no, nope, nah, no thanks,
    no keep them / no, keep them, keep them, don't. Anything else ("keep
    going", "no problem, go ahead") goes on to the model.
  - The question goes to the owner in chat lines of at most 200 characters,
    split at spaces and at the text's own line breaks, so a long question
    arrives whole, and paced at least 1 s apart, under the server's chat-spam
    kick (vanilla: +20 a message, −1 a tick, kick above 200); the same holds
    for every code report (report.js `chatLines`, Work `deliver`). All code
    output to the owner goes through one queue with one next-send time, so
    deliveries never interleave or send faster. Before each line a question
    post checks that its task, its question and its post are still current,
    and stops otherwise: a replaced question sends nothing more, and a newer
    post of the same question drops the older one.
  - There is no timeout: the task stays `blocked(awaiting_owner)` until it is
    answered, cancelled or superseded (REQ-REC-5).
  - `!taskResume` is refused while a question is open ("waiting for the owner's
    yes or no; only the owner can answer"), from the model and the owner alike;
    no command sets the answer.
  - The task is live while the question is open, so no `action:tidy` starts
    (REQ-OWN-8). A `blocked(awaiting_owner)` task runs no units, so a pending
    in-task sweep of mode-placed scaffold waits until the answer.
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
  run inherited a 10-minute ActionManager timeout (§4.2), and a run that times out
  is never resumed by Mindcraft. (From S2d the `action_manager.js` carry keeps a
  resumed run's −1; the bound stays, as each run's own limit.) The bound is
  checked between actuator calls, never in the middle of one.
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
  - *The sleep hold* (S2d, REQ-SLP-9). While `mode:sleeping` or `action:bed`
    runs, the stall clock is held: on entry the work time up to then is charged
    (`Work.holdStall` saves), during the hold every save advances the clock
    without charging, and the hold closes in the routine's `finally`, before
    the task resumes (`Work.releaseStall` restarts the clock), so no sleep time
    reaches a later save. Real stall time is never reset. Both interruption
    classifiers (`afterInterruptedRun` and the self-heal tick's `by` fill) keep
    the step's `last_cause` for these two labels while still recording
    `interruptions.last.by` and counting the interruption.

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
| Night, with a bed (S2d) | the `sleeping` mode (`mode:sleeping`, REQ-SLP-2) | she sleeps; the task resumes the same step on `idle`; the stall clock is held and `last_cause` kept (REQ-RES-16) | 0 |
| Bed pickup by day (S2d) | `action:bed` from `Work.tick` (REQ-SLP-5) | resume on `idle`, as after a mode; hold and cause as above | 0 |
| Night, no bed or a done night | — | work goes on; combat modes interrupt and resume (always `continue` until the survival iteration) | 0 |
| Night (`shelter`) `[Surv]` | dusk or repeated night interruptions | code dig-in; resume after the night (REQ-RES-15) | 0 |
| Owner `!stop` | change in `agent.stop_epoch` | `cancelled` | 0 |
| Death | bot `death` event | `paused(died)`; the existing death prompt | 1 |
| Replaced by another resumable action (e.g. `followPlayer`) | action label at the next idle | `paused(replaced)` | 0 |
| Non-resumable owner action (e.g. `goToPlayer`) | action finishes, `idle` | runner resumes | 0 |
| Step stall: no metric improvement for `work.step_stall_s` (600 s), summed across restarts (REQ-RES-16); covers repeated interruptions, crash loops and a refusing resume check | record | step `blocked` with the last cause | 1 |
| Search budget exhausted (REQ-FIND-10, I4) | record | step `blocked` with the final `not_found_within_budget` report | 1 |
| Pending owner question (REQ-REC-12; I1 for the clear step, Surv for the rest) | record | `blocked(awaiting_owner)` | 0 |
| Model unreachable (connection error, timeout or 5xx) | the provider's `outcome` (REQ-RES-17) | the task runs on; decisions wait with back-off; the self-prompter pauses and resumes on recovery | 0 while down |
| Plan revision | `!taskRevise` | — | 1 |

- **REQ-RES-13** [I1] Cancellation causes are recorded from these events, never
  inferred from a missing `resume_func`. (S2d) A sleep or a bed pickup is
  recorded as the interruption's `by` (`mode:sleeping`, `action:bed`) but is
  never the step's `last_cause`: a later stall block names the cause before it
  (REQ-RES-16). Neither is a quiet action's AUTO MESSAGE cause: a mode that cuts
  them prompts no model call (REQ-SLP-9).

### 7.6 Night policy (owner amendment E1.2) `[Surv]`

Until the survival iteration the behaviour is always `continue` and there is no
`work.night_policy` key; the key returns with `shelter`. (S2d) Sleeping (§7.9,
`work.sleep`) is separate from this policy: the night policy applies only when
no sleep happens (no bed, or the night is done).

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

0 for combat, creepers, unstuck, timeouts, crash restarts, night, a night's
sleep and the bed pickup (S2d; a goal cut by either restarts its loop with the
next turn it would make anyway), pending owner
questions (I1 for the clear step) and the bot's own tidy sweeps (no decision
calls: a tidy line enters history and can contribute to a
memory-summary call, which the live trials count separately). While the model
is unreachable, retries are not counted as calls spent. 1 each for a death, a
blocked step (a stall, an exhausted search, an unfittable build) and a plan
revision.

### 7.8 Model outages `[I1]` (S2b)

The cube-clearing trials lost a goal to a backend outage: the coder counted each
connection error as "no code block", the self-prompter stopped after three
replies without a command, and the bot said "My brain disconnected" without
telling the owner (ISSUES, cube analysis item 8).

- **REQ-RES-17 Outage signal and waiting.** [I1]
  - The signal is opt-in per call, with no change to upstream `gpt.js`:
    `prompter.requestOptions` adds an `outcome` object; `models/openai_tools.js`
    strips it from the request options (as it already strips `kind` and
    `task_id`) and sets `outcome.unreachable` (the cause) on a connection error
    (timeouts included) or an HTTP status of 500 or higher. The cause shown to
    the owner is only an error code, "timed out", "HTTP <status>" or "connection
    error", never an error message (which can hold the endpoint's address).
  - The OpenAI client gets an explicit `timeout` and `maxRetries` from
    configuration (`work.model_timeout_s` 600, the SDK's own value, above the
    one observed 551 s request; `work.model_max_retries` 2, the SDK's). Each call
    has one retry owner: the decision requests that `promptConvo` retries pass
    `maxRetries: 0` per request; every other call (coding, summary,
    bot_responder, the probe) keeps the client's retries (main-seat ruling R8,
    2026-11-11).
  - `promptConvo` waits through an outage with back-off (5 s, doubling to 60 s)
    for up to `work.model_outage_wait_s` (600) without spending its 3 tries; no
    request starts once that time has run out. It stops when a newer message
    supersedes the turn (the existing stale-response check), when the owner's
    `!stop` changes `stop_epoch`, or when a new goal replaces the self-prompt
    turn in flight, and then returns no reply; that check also runs just before
    each request, after the cooldown and the prompt preparation. A recovery
    meanwhile ends the current back-off of every waiting turn, so it retries at
    once. Every turn is registered with the outage state from its entry (before
    its first request) until it ends; its wait, and the wait's deadline, begin
    at its first unreachable reply. Blocked-step reports wait there too.
  - The coder: when the model is unreachable it ends with "Action stopped: my
    model is unreachable (<cause>); no code was run" only when no execution began
    in that generation session; otherwise "my model became unreachable; the code
    ran N times before that and no further code ran", keeping the last
    execution's output. The count rises just before `executionModule.main`, also
    for runs that throw. An outage never counts as a "no code block" failure.
  - The owner gets one notice per outage and one on recovery, through
    `agent/model_outage.js` (for example "I can't reach my model (<cause>). Tasks
    keep running; I'll answer and continue the goal when it's back." and "My
    model is reachable again.").
  - The un-awaited `handleMessage` call in `respondFunc` (agent.js:174) gets a
    catch, so a rejected turn is logged, not lost silently.
  - A running task needs no model while it works (§7), so it keeps running.
- **REQ-RES-18 Self-prompter outage pause.** [I1] A goal is paused, not stopped,
  by an outage. The pause is the existing `PAUSED` state with an `outage` flag
  (a new state would need every `isStopped()` consumer and `handleLoad`
  changed).
  - The goal pauses only when its own `promptConvo` turn ended inside the
    outage wait (gave up, or was cut short there by a newer message):
    `handleMessage` passes its self-prompt flag to `promptConvo`, and only such
    a turn marks the end. A single failed call elsewhere (a summary, coding,
    bot_responder) or another turn's wait notifies the owner but never pauses a
    goal through that mark.
  - The goal starts no turn while another turn (the owner's message) is in its
    outage wait, since that would supersede it: it pauses for the outage
    instead.
  - After the foreground wait (REQ-RES-17), a recovery probe runs every
    `work.model_outage_probe_s` (60). On recovery it resumes the same goal (the same
    goal epoch, not equal prompt text) if it is still the current one, but not
    while another turn (the owner's message) is still running, from its first
    request on: that turn is answered first and the next interval resumes the
    goal. Resuming sets the goal `ACTIVE`; the self-prompter's `update()`
    restarts its loop once the agent is idle, so an action the owner's answer
    started is not cut short.
  - An owner `!stop`, a new goal or a manual pause clears the flag, and so does
    `start()` (`!stfu` resumes a paused goal through conversation.js
    `_resumeSelfPrompter`, also with a single bot).
  - The flag is saved with the self-prompter state (history.js:115-118) and
    loaded with it (agent.js:203, self_prompter.js:39); a load of `PAUSED` with
    the flag restarts the probe and takes the outage as still on, with no new
    notice, so only a probe or a request that succeeds in this process resumes
    the goal (and then the recovery notice is posted).

### 7.9 Sleeping through the night `[I1]` (S2d)

Owner rulings: DECISIONS 2026-11-11 "Sleeping through the night (slice S2d)"
(she sleeps every night by default, also mid-task, mid-goal and while
following; the resume must be solid; the bed goes down only to sleep and comes
straight back; one sleeper skips the night on his server; the respawn point
moving to the bed is accepted; chat quiet unless something needs him) and
2026-11-12 (one chat switch). Design:
`runtime/diagnostics/i1-build/sleep-council/recommended-design.md` r3 with its
§14, amended by `junk-council/recommended-design.md` r7 §5 (the 2-free-slot
pickup launch, the resume-timeout carry). Live facts: probe P14 (PLAN §4).
There is no `work.sleep.announce` key (main-seat ruling: one chat switch, the
owner lines are `alert`s).

- **REQ-SLP-1 The mode and the module.** [I1] A mode `sleeping` (modes.js
  carry, §5.3) right after `self_defense`, `interrupts: ['all']`, on by
  default; its `update` asks `agent.work.sleeper.next()` and `execute()`s the
  routine it returns as `mode:sleeping` (timeout −1). All policy and logic live
  in `work/sleep.js` (`Sleeper`): each start re-derives what to do from the
  world and the ledger (observe, then act); there is no persisted phase. The
  bed pickup outside the routine runs from `Work.tick` as the quiet action
  `action:bed`, so `!setMode sleeping off` (model-callable) cannot strand a
  placed bed. `work.sleep.when` (§14): `always` (default), `idle` or `off`; an
  unknown value is logged once and means `always`. `off`, or the mode switched
  off for the session, stops new sleeps; the pickup still runs.
- **REQ-SLP-2 When she sleeps.** [I1] `next()` is cheap and returns a routine
  only when all hold: sleeping is enabled; the overworld; `timeOfDay`
  12541–23000 (mineflayer's window start; later is not worth a bed; daytime
  thunderstorms: no); a `*_bed` item in the inventory or *my bed* (REQ-SLP-6)
  live and loaded within 16 blocks; this night not done (the night id is
  `bot.time.day`, from the world's day time, captured when a try starts, so a
  sleep ending after dawn marks its own night; in memory, REQ-SLP-7); 30 s
  since the last failed try; no hostile in mineflayer's monster box around her
  (x −8…+7, y −6…+4, z −8…+7; mineflayer's `Hostile mobs` kind or our
  `isHostile`); no stop in progress; and what runs may be cut:
  - `always`: the agent idle, unless a goal is ACTIVE with its loop running
    (its model call is in flight: she fires at its next action); `action:task`;
    from S2e the item cleanup `action:items` (REQ-OBT-11; the bed pickup never
    cuts it: they share the maintenance latch);
    the pending resumable owner action (`label === resume_name`) unless a goal
    is ACTIVE (upstream would not resume it, action_manager.js:63; it is waited
    out); a goal's own action (started in her own turn while the goal was
    ACTIVE, recorded by the `runAction` wrap). Never a `mode:*` action,
    `action:tidy`, `action:bed` or a one-off action (an owner's command; it is
    waited out).
  - `idle`: only with the agent idle, no task active, no goal active and no
    `resume_func` pending.
- **REQ-SLP-3 The spot and the placement.** [I1]
  - *My bed* within 16 is reused (walked to), re-validated like a new spot.
    Otherwise up to 3 stand cells B, nearest first within 6 blocks of her and
    |dy| ≤ 2, each standable (feet and head cells passable, not liquid; a
    solid floor), with the first cardinal d that fits: foot F = B + d, head
    H = B + 2d; F and H air (not grass or another replaceable, not liquid),
    air above both, a full cube under both, no liquid beside either (above and
    the four sides), no player or mob in B, F or H, none of F, H and their
    supports in an active clear box or its kept shell, no hostile in the
    monster box around H. (No live build blueprint exists before S3; S3 adds
    its footprint to this check.) A candidate she cannot walk to is skipped;
    none left: the try failed.
  - *Placement.* She walks to B and must stand in it (no 2-block tolerance, no
    `skills.placeBlock` move-away); the cells are re-checked (and the
    dimension); she equips the bed and clicks the top of F's support
    (`bot.placeBlock(blockAt(F − up), up)`: mineflayer looks toward F first, so
    the head goes the way she faces). Both halves are verified from the block
    states (foot at F facing d, head at H). The cells and the dimension are
    re-checked after the equip (it awaits). An equip error or a refusal: the
    try failed. An issued placement that timed out (Mineflayer gives up after
    5 s with no update for F, so `blockPlaced` never fires and nothing is
    recorded; the bed may still arrive): she watches F for up to 2 s and
    records the bed as her own (`mode:sleeping`) only when her bed appears
    there **and** her count of that bed item dropped by one, then carries on;
    otherwise nothing new (a bed there stays protected) and the try failed
    (rulings r1, S6 + N1). Half a bed or the head elsewhere: her bed
    is picked up (REQ-SLP-5) and the try failed. Then the ledger is flushed
    synchronously before she sleeps; a write failure aborts and picks the bed
    up. A bed that `blockPlaced` reported but the ledger did not record is
    protected like any non-natural block: she leaves it and says so
    (REQ-SLP-8).
- **REQ-SLP-4 Sleep and the night in bed.** [I1] Dimension and window
  re-checked (the window ended: she picks the bed up and the night is done);
  `bot.modes.pause('unstuck')`; `await bot.sleep(bed)`. An error ("there are
  monsters nearby", "bot is not sleeping" within 3 s) is a failed try, and the
  routine picks the bed up before it returns; the next try places again. In
  bed she polls every 500 ms:
  - woken by the server: the night skipped (the day id changed or the window
    ended) is a completed sleep; any other wake (damage, a broken bed) is a
    failed try. Either way she picks the bed up.
  - still asleep after 15 s: the night did not skip (on the owner's server one
    sleeper skips it, P14; this is the fallback): the guarded wake, the night
    is done, the owner is told once per session, she picks the bed up.
  - interrupted (a mode, another action, `!stop`): the guarded wake, and the
    routine returns; the bed stays (she lies down in it again after the
    cooldown, or `Work.tick` picks it up when allowed).
  - *The guarded wake*: the `wake` listener first; `bot.wake()` only while
    `bot.isSleeping` (it throws when awake), its error caught; at most 3 s for
    `wake`; return either way, well inside the 10 s stop watchdog, and at most
    once per routine. A wake not confirmed in 3 s is logged and said as a
    `detail` line; the next action may stall until the server wakes her, and if
    the watchdog fires the crash restart wakes her (§16).
- **REQ-SLP-5 The pickup.** [I1]
  - *Free slots.* `Work.tick` launches a pickup, or a receipt's collection,
    only with at least 2 free inventory slots (junk design §5, amendment 1),
    checked before the launch; with fewer the bed (or its drop) stays and the
    owner is told once (no model turn). A collection that finds no room for
    the bed keeps the receipt until there is room or it expires (not lost;
    rulings r1, S7). The pickup itself, also inside the sleep routine, needs only
    the bed's own slot (at least 1 free; placing the bed freed it, so a full
    bag still sleeps and takes the bed back); with none the bed stays, told
    once (rulings r1, #5 reversed).
  - *Dig.* Within reach (a bounded walk first: the seam's own approach,
    `move: true`, has no time bound, and every walk is bounded, REQ-SLP-10),
    both halves are checked: a player or mob in or on either is a soft refusal
    (retry later); liquid beside either or a falling block above is a hard
    one. Then `digCell(bot, foot, { move: false, hand: true, ownBed: entry,
    standing: true, final })`, the S2c dig seam with the own-bed exemption
    (REQ-SLP-6); `final` re-checks, synchronously right before the dig packet
    (the tidy sweep's pattern), that the entry is still the live one, the bed
    is whole, and both halves are free of players, mobs, liquid beside and a
    falling block above; a veto is a soft refusal. A recorded bed whose loaded
    cell shows another block is a lost bed (REQ-SLP-8); an unloaded cell is a
    soft refusal.
  - *Collect.* The dig leaves an in-memory collection receipt (cell,
    dimension, bed item, time, bed count) until the bed count rises or the
    loss is reported: she waits up to 1 s for the dropped bed within 5 blocks
    (contact pickup often takes it at once), walks to it (bounded) and checks
    the count. A rise seen anywhere (any pickup) closes the receipt; an
    interrupted collect keeps it for `Work.tick`; no drop, or no rise after
    the walk, or a receipt older than 5 minutes (the item's life) is a lost
    bed.
  - *Refusals.* Soft (occupied, interrupted, not loaded, changed, vetoed):
    retried later (at most every 30 s from `Work.tick`). Unreachable (the
    bounded walk did not bring her within reach): the obligation is kept, as
    for a bed beyond 16: "I left my bed at x, y, z.", told once, and retried
    after the same 30 s back-off (rulings r1, #8 reversed), but only while she
    has nothing to do (no task, goal or follow; the `idle` cut rule), so the
    retries never cut her work (N3); the mark goes once she reaches it or the
    obligation resolves. At night the sleep routine may still walk to it to
    sleep, and failing that is a try. Hard (next to
    water, under a falling block, protected, a failed dig): "I left my bed at
    x, y, z.", told once, and the entry goes (the bed is no longer hers). Lost:
    "I lost my bed at x, y, z.", told once.
  - *From `Work.tick`* (before its active-task guard, whatever
    `work.sleep.when` says): a pending receipt's drop within 16 is collected
    first, also at night (a placed bed is reserved for sleeping, a drop is
    not), and `next()` starts no sleep while a receipt is pending, so no new
    pickup overwrites it; when my bed is within 16 and not wanted for sleeping
    (day, the night done, or sleeping off), she takes it back. Either runs as
    `runAction('action:bed', …, { timeout: -1 })` (no resume), cutting only
    what sleep may cut under the current `when` (REQ-SLP-2; under `off` as
    under `idle`). One synchronous latch, cleared when the action ends; nothing
    launches while a stop is in progress; an ACTIVE goal's loop is stopped
    (`stopLoop()`, not awaited) as `execute()` does; the callback re-validates
    `stop_epoch`, the entry and the policy (a placed bed only) when it starts.
    A bed obligation is kept whatever the distance: beyond 16, loaded or not
    (loading is needed only to reuse or dig it), the owner is told once ("I
    left my bed at x, y, z.") and the entry stays, so she takes it when she
    comes back within 16. A recorded bed whose loaded cell shows another block
    (broken before a restart, or while its update was missed) is retired as a
    lost bed. This also covers a bed found after a restart.
- **REQ-SLP-6 My bed.** [I1] A bed placed while the action label is
  `mode:sleeping` is recorded at its foot as kind `own`, `by: 'mode:sleeping'`
  (the ledger's context kind, REQ-OWN-2): protected from the pathfinder,
  collection and the tidy sweep like any `own` entry, and exempt only for the
  sleep routine's own pickup dig, scoped to that exact live entry
  (`Protector.withOwnBed`, honoured by both protection checks of the dig seam:
  the predicate and the patched `safeToBreak`). *My bed* = such an entry in this
  dimension whose block is still that bed. `own` entries survive restarts
  (REQ-OWN-4 marks only scaffold), so a bed is reused at night or picked up by
  day after a crash.
- **REQ-SLP-7 The night done, and the owner.** [I1] A night is done after a
  completed sleep, a night that did not skip, a `!stop` during the routine
  (`stop_epoch` changed), a non-mode action that cuts the sleep, a new
  resumable action starting during the night (window), 3 failed tries, or
  `work.sleep.max_mode_cuts` (6) mode cuts. The
  task runner's own runs and resumes (`action:task`, `resume_func ===
  runner.runFn`) and `action:bed` never mark it, so a crash or self-heal
  restart or a `!taskStart` at dusk does not cancel the night; a resume through
  `resumeAction()` is not a new action. A failed try (no spot, a refusal
  including `bot.sleep`'s "monsters nearby", an early wake, an interruption
  that did not end the night and was not a mode) starts the 30 s cooldown. A
  protective mode's cut (a fight; phantoms come every night, P14) is not a
  failed try: it starts the same cooldown and counts toward its own cap
  (rulings r1, #3 changed); the bed stays and she lies down in it again. The record is in memory: a crash restart in
  the same night may try again (§16). `!stop` in bed: the guarded wake, the
  night is done, the S2 wrapper cancels any task as today, and `Work.tick` takes
  the bed back when idle. Queries start no action and change nothing. A task
  cut by a new owner `!followPlayer` is `paused(replaced)`, as today.
- **REQ-SLP-8 What she says.** [I1] Console `[sleep]` lines per phase (spot,
  placed, slept, woke and why, skipped or not, dug, took back, left, lost,
  each night done and failed try). `behavior_log`: "Sleeping." and "Took my bed
  back.". Owner chat only through the chat gate (REQ-CHAT-1) and only when he
  needs to know, as `alert` lines through `postReport` (history too): "I left
  my bed at x, y, z.", "I lost my bed at x, y, z." and "My bag is too full to
  take my bed back (N free slots needed); it stays at x, y, z." (N is 2 for
  the `Work.tick` launch, 1 inside the pickup; each count is its own line, so
  the launch's line still comes after the night's, N2), each once per obligation (one
  placed bed and its drop, keyed by its entry; forgotten when it resolves:
  taken back, lost or no longer hers, so a later bed at the same spot is told
  again), and "The night did not skip, so I got up." (once per session). A
  bed of hers whose entry the ledger retires on a block update (a player, a
  creeper, a broken support; not her own pickup dig, which the ledger marks
  `removing`) is a lost bed, told once. The unconfirmed wake, "I could not get
  out of bed; I am still asleep.", is `detail` (once per session). The task view says "Sleeping now: the task resumes by itself after
  the night." while she is asleep (only while a task record exists). Request
  log: 0 model calls per sleep.
- **REQ-SLP-9 Resume is not hurt.** [I1] `mode:sleeping` and `action:bed` are
  quiet actions (`Work.isQuietAction`, with `action:tidy`): a mode that cuts
  them prompts no model call. The stall clock is held while they run and the
  step's `last_cause` is kept (REQ-RES-16). The no-progress deadline and the
  run bound are per run and unaffected; the resume check and the `work_pos`
  return work unchanged after waking (a new spot is within 6; a reused bed may
  be up to 16 away, beyond `return_radius`, and the runner's return walk
  brings her back). A resumed `!followPlayer`, and a resumed task run, keep
  "no timeout" (the `action_manager.js` carry, §4.2).

| Event | Task | Resumable owner action | Goal | Previously idle |
|---|---|---|---|---|
| Sleep, a handled failed try or a mode cut | same step, 0 decision calls | same function (not cut while a goal is ACTIVE) | next decision turn; the cut action is not replayed (a day pickup that cuts a goal's action costs that turn too) | idle |
| A protective mode cuts the sleep | resumes after the fight | same | restarts once idle | quiet, no AUTO MESSAGE |
| Owner `!stop` | cancelled (S2 wrapper) | resume slot cancelled | stopped | the bed is taken back when idle |
| Crash restart | the existing active-task recovery | not persisted (as today) | its saved state; may call the model | bed reconciled from the ledger; a receipt is lost |

- **REQ-SLP-10 Boundaries.** [I1] Both routines are non-throwing: every
  expected failure is a bounded outcome (a failed try, a soft retry, left,
  lost); the wake and the night's accounting run in `finally`; the launcher's
  rejection is observed. Every walk (spot approach, bed reuse, pickup, drop)
  uses no-dig, no-tower, no-scaffold movements (`goToGoal` with `configure`)
  and is bounded by 10 s (the pathfinder's goal is cleared then);
  unreachable is a controlled outcome.

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
| `clear` | `box` (exact cells, `x1,y1,z1:x2,y2,z2`) or `markers` (an exact block name) with `shell?: keep|clear` (default `keep`) | Empty the box of everything the bot may remove, top-down, and report what is left and why (§11.9). | I1 (S2c) |
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
  - (S2c) `clear`: the box, the marker test, the caps and the distance
    (REQ-CLR-2, 3); validation completes and freezes the step's args;
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
  `station` entry in the placements ledger (REQ-OWN-1). After
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

- **REQ-OBT-11 Inventory upkeep: no automatic discarding of the owner's
  items.** [I1] (S2e, part A.) Owner ruling: DECISIONS 2026-11-11 "Inventory
  upkeep (slice S2e, after S2d)". Design:
  `runtime/diagnostics/i1-build/junk-council/recommended-design.md` r7 §2–§6,
  §8–§10, with the owner's answers in §11. Follow-up S2e-fu (DECISIONS
  2026-11-12 "After the S2e live trials"; design
  `runtime/diagnostics/i1-build/s2efu/design.md` §1–§5, probe P16): junk in
  her hand, the throw over a one-block lip, the walk to a drop spot, the kept
  report, the new defaults and the best one kept. Code removes only what the item list
  makes disposable. (The owner approved using the bot as a disposable trash can
  for common junk, W3b, and the list on 2026-11-11 and 2026-11-12.)
  - **The item list.** `work.inventory.items` (§14) gives per item name how many
    she keeps: `0` (junk: all of it goes), a non-negative integer (that many
    stay), `"stack"` (the item's registry stack size), `"slot"` (one slot: the
    best stack stays, every other slot of the item goes) or `"all"` (never removed;
    it also overrides a default). Anything not listed is kept. A profile writes
    only the items it changes: the list merges by item name over the defaults
    (`work/config.js` `mergeInventory`, into fresh maps; the defaults are never
    mutated). Defaults: `0` for rotten_flesh, spider_eye, gravel, leaf_litter,
    cobbled_deepslate, andesite, diorite, granite, tuff, netherrack, wheat_seeds;
    `1` for bow and crossbow; `"stack"` for dirt, cobblestone, bone, string,
    phantom_membrane, arrow, flint, coal; `"slot"` for ominous_bottle and the
    16 `<color>_banner`s (only these: bottles of different strengths, and a
    patterned banner beside a plain one, do not stack together; owner ruling
    2026-11-12 "One slot of the best"); `"all"` for gunpowder. The bow,
    crossbow, arrows, banners and ominous bottles are kept for the owner (she
    fights with melee; owner rulings 2026-11-12). Any new default needs the owner's
    approval (it makes a kept item disposable).
  - **Fail safe.** `loadWorkConfig` checks the supplied structure (`inventory`
    and `items` objects, not null or arrays; `idle` a boolean) and every entry
    before merging; `Work.init` checks every name against the connected
    registry. Any error turns automatic removal off (tasks then block on slots
    as before, the idle cleanup does nothing), is logged, and is told to the
    owner once as an `alert`: "My item list has an error (rotten_fleshh); I
    won't drop anything until it's fixed." An error never widens removal.
  - **What may go.** Never an unlisted or `"all"` item, never one needed by
    any live, paused or blocked task (`work.neededItems()`, which has no status
    check, so a cancelled or failed task's remaining items stay protected until
    the next task: the safe direction), never armour or the offhand (outside
    the 36 slots used). The selected hotbar slot is a source like any other:
    junk in her hand is junk, and she switches her hand off it before dropping
    it (owner ruling 2026-11-12, S2e trials F4).
  - **One planner, one dropper** (`work/inventory.js`). `planRemoval(bot,
    policy, { needed, minFree })` returns slot operations `[{ slot, name,
    count }]`, what to remove and never where (the seam a chest destination,
    part B, adds to). Order: every tier-0 stack, whole; then per limited
    item, for a `"slot"` item every slot but its best (highest worth, then the
    larger count, then the later slot), each whole; for a counted item its
    surplus as whole stacks smallest first, then lowest worth, then by
    slot, within its budget; a remainder below a whole stack comes from the
    first stack left in that order and may free no slot, so it never counts
    toward `minFree` (phantom membrane 64 + 55, keep 64 → the 55 stack; keep
    100 → 19 from the 55). Worth is the sum of the enchantment levels
    (`item.enchants`) and an ominous bottle's amplifier (the 26.1
    `ominous_bottle_amplifier` component, a varint, read as
    `componentMap.get(…).data`; absent = 0; checked offline through the
    protocol's slot codec), then the durability left (`maxDurability -
    durabilityUsed`), 0 for items with none of them; an unreadable enchantment list
    counts as none. So of the bows and of the crossbows exactly the best one
    stays, enchanted or not ("the best one, period", owner ruling 2026-11-12;
    P16 read the durability live, enchantments on this version are unprobed),
    and of the ominous bottles the slot of the highest amplifier, of a banner
    the largest stack.
    The planner simulates the freed slots; the caller re-reads the real free slots.
    `dropItems(bot, plan, { awayFrom, avoid, never, walk, current })` removes them
    where she stands: a cardinal free from her feet to her eyes for 3 blocks
    (free = not a liquid and no collision box more than half a block above her
    feet, so short grass, leaf litter and cave air are free, and so are a floor
    lower than a full block, a path, farmland, soul sand, mud, a bottom slab or
    a carpet, the grass edge beside a path and a slab ahead: S2e review R1-7;
    the toss leaves 1.32 up, P15). In her feet row a block whose collision top
    is at most one block (`INVENTORY.lipHeight`) above her feet is a lip she
    throws over, as a player can (owner ruling 2026-11-12, S2e trials F2;
    P16: from a pit one deep the toss cleared the lip at distance 1 on all four
    sides and landed 1.8–3.2 blocks out on the surface). The lip must start at
    distance 1 (her pit's edge, and the ground beyond it at 2 and 3): a face 2
    or 3 out behind an open cell keeps the half-block rule, because a low toss
    can hit it and fall back into contact reach (S2e-fu review r1, adversary
    D2, a vanilla toss simulation). A fence or wall (1.5
    up) still blocks, and so does any block in the rows above that is more than
    half a block above her feet, so a pit two deep finds no direction. Never a direction toward
    `never` (a follow's target); among the rest the first, most opposite
    `awayFrom`, that is toward neither `awayFrom` nor `avoid` (in a task the
    owner within 16), else the most opposite. With none and `walk` set, she
    walks to a drop spot first (`findDropSpot`: the nearest cell within 5
    blocks horizontally, `INVENTORY.walkRadius`, and from 1 below to 3 above
    her feet that is standable, a full cube below and the feet and head cells
    passable and not a liquid, and from which a direction is free; nearest
    horizontally, then vertically, then by the cardinal order; never toward
    `never`), with `goToGoal(GoalBlock)` under movements that never dig (no
    terrain or build damage), chosen by the caller: in a task (`walk:
    'task'`) she may tower and scaffold (the ledger records those placements
    as S2c's scaffold and the task-end tidy takes them back, as on any task
    path); idle (`walk: 'idle'`) she places nothing either (the sleep
    routine's `NO_DIG`), because an idle pass has no tidy trigger and she
    leaves no pathfinder blocks behind (owner ruling 2026-11-11, clearing), so
    an idle walk that needs a tower fails and the pass holds. Neither walk
    opens a door or gate (`canOpenDoors` false: nothing would close it behind
    her; review r1, D4; `goToGoal`'s stuck-door helper honours it, the
    skills.js carry, review r2). The walk is bounded by 15 s (`INVENTORY.walkMs`,
    when the pathfinder is stopped, as the sleep routine's walks), and its goal
    is cleared at the end while still active (a rejected `goto` can leave a
    partial route running; review r1, Sol 2). Then the currency is checked;
    she drops only when she stands in the spot's cell (a bounded or partial
    walk may stop anywhere; D3); the plan is made again from the live bag
    (`replan`, the caller's planner: the walk may have used her blocks as
    scaffold; Sol 1); and the facing is chosen again. No direction (with no
    spot, off the spot after the walk, or without `walk`): no drop
    (`unavailable`, "no free direction nearby").
    She looks level (pitch 0) at a point 3 blocks out at her
    eye height, waits 2 ticks and re-checks before the first toss (the look
    fix: a forced `bot.lookAt` sends no packet of its own, so a toss could fly
    the way she was already looking, G1). Then, when a planned slot is the
    live selected hotbar slot, she selects (`bot.setQuickBarSlot`) the first
    empty hotbar slot, else the first holding no planned operation, else none
    (the held operation is then skipped); the held-item packet goes out before
    the window clicks on the same connection. Each slot operation is one toss of
    exactly that slot (`bot.transfer` from that slot to −999), so a toss can
    never take the stack she then holds by name; each is re-checked
    right before it: a tier-0 stack needs the same item with at least the
    planned count (a contact pickup may have merged into it) and goes whole,
    any other the same item with the planned count, and neither the live
    selected hotbar slot (the server may select another slot meanwhile);
    anything else is skipped for the next pass. Nothing is clicked with an
    item on the cursor (a one-slot transfer would swap it in and toss it as a
    leftover) or a container window open (the click would act on it): the
    pass ends `unavailable`. Interrupt and currency checks run after the walk,
    after the wait and between tosses. She stands still afterwards. Outcomes carry the
    counts removed per name: `done`, `interrupted`, `unavailable`, `failed`;
    every expected failure is a returned outcome, never a throw. Console
    `[items]` lines; `behavior_log` "Dropped junk.".
  - **Re-pickup guard.** Vanilla picks up an item on contact once its throw
    delay ends, and upstream also walks to items: `pickupNearbyItems`
    (skills.js:580, 8 blocks; called after manual digging) and the
    `item_collecting` mode (modes.js:189-211, which calls it; off in the
    deployed profile). Each pass records one drop point at the landing spot
    (her position + 3 blocks along the facing) with the dimension and the
    time; each name is added to it just before its first toss. A small carry
    in `pickupNearbyItems` skips item entities of those names within 3 blocks
    of a drop point of this dimension for 5 minutes (vanilla's despawn time).
    At most 32 drop points are kept (the oldest goes): an approximate guard.
    `bot.toss` returns no entity ids, so the guard is keyed on drop points.
    The level throw lands about 3 blocks out, beyond contact pickup (about
    1.4 blocks), so standing still is enough: probe P15 (PLAN §4,
    `runtime/diagnostics/i1-build/s2e-review/p15-live-20261112.md`) measured
    3.1–3.2 blocks on flat ground with the 2-tick wait, the toss flying the
    old way without it (G1), and no pickup standing still for 6 s (P15 tossed
    with `bot.toss`). The S2e and S2e-fu live trials ran the one-slot
    `bot.transfer` path with whole-stack tosses through ViaProxy (nothing came
    back while she stood still). Not proven live: an obstacle within 3 blocks
    (the facing rule excludes it) and the guard against `pickupNearbyItems`
    (offline tests; the `item_collecting` mode is off).
  - **In a task.** Before a step that needs free slots (`obtain`, `give`, a
    `build`'s materials; the `clear` step's `drop-only`), if
    `bot.inventory.emptySlotCount()` is below `work.min_free_slots` (4), the
    runner's `ensureFreeSlots` plans with the task's needed items and drops,
    with no model call, where she stands before she moves to the work, facing
    away from the work position and, among those directions, not toward the
    owner within 16 blocks (design r7 §3); with no free direction there she
    walks to the nearest drop spot first (`walk`). If the slots refill during the same step, the
    drop runs again, at most twice (`progress.junk_drops`). If it cannot reach
    the minimum (also with no free direction nearby, or a bad item list), the
    step blocks with a fact report: with a bad item list (removal off)
    "inventory full: 3 free slots, 4 needed; my item list has an error
    (rotten_flesh: "none"); largest: …"; else when the re-planned removal is
    empty (nothing on the list may go), "inventory full of things I keep: 3
    free slots, 4 needed; kept or needed by this task: dirt 64, arrow 32, …"
    (the task's needed items are not removed either; review r1, Sol 3, D10);
    else "inventory full: 3 free slots, 4 needed (no free direction nearby);
    largest: dirt 128, …" (the drop's reason in brackets when it did not
    finish). Each names the five largest items, totalled by name
    (`largestItems`, shared with the kept note). The reason carries only
    these facts (the step result, the task view and the owner's blocked-again
    line show it); the blocked report to the model adds, for the kept
    variant, "Tell the owner your bag is full of things you keep or need for
    this task; do not discard kept items unless he names them.", and for the other
    inventory-full variants "Do not discard kept items unless the owner names
    them." (`report.js` `INVENTORY_KEPT`, `isInventoryFull`, on the heads the
    runner builds the reasons with; owner ruling 2026-11-12, S2e trials F3:
    the list decides, never the model, and she tells the owner; review r1, D1).
    `!discard` is not refused: the owner's own
    command keeps working, and his "throw this too" stays a one-off `!discard`.
    The clear step digs on. Never a chest walk in a task.
  - **Idle cleanup** (`action:items`, `work.inventory.idle`, default true).
    `Work.tick` checks it after the bed reconcile and before its active-task
    guard; a pass runs as a quiet, non-resumable action with no model call
    and no chat, under the maintenance latch (bed pickup > tidy > items: the
    bed pickup launches first, and none launches while another is in flight).
    Two admissions:
    - *Idle:* nothing executing at launch, and nothing else started by entry;
      it never stops another action. A pending resume blocks it only within
      3 s after an action last ended normally (the 1 s resume gap, after a
      mode such as `unstuck` cut a follow), except a follow whose target
      player is not visible (it re-runs every second).
    - *While following* (owner, 2026-11-11: "she can drop things while it's
      following"): the running action is the pending resumable owner action
      `action:followPlayer` (`label === resume_name`) and its target player is
      visible. The pass cuts it through the S2d maintenance launcher and the
      follow resumes by the existing idle resume (about 1 s later, keeping "no
      timeout", §4.2). She always faces away from the follow target, never
      toward it (re-read at the pass's entry); with no such direction free
      the follow is not cut, and a pass while following never walks (the
      follow moves her anyway). Only this label is cut; any other running action blocks. The turn that started the
      follow stays open while it runs, so the turn count ignores the one turn
      whose recorded action is the running follow.
    Both need: removal enabled and free slots below `work.min_free_slots`, a
    non-empty plan (an empty one is remembered per inventory and task state
    for at most 5 minutes, so a bag of kept items is not re-planned every
    second) and a free direction to drop into or, idle, a drop spot to walk
    to (the pass walks there; no launch without either, and the hold below
    says "no free direction nearby"); no task running (`status === 'active'`) and no open
    owner question (a paused or blocked task does not exclude it; its needed
    items stay protected); the goal stopped (`isStopped()`: neither active nor
    paused); no message turn in flight (every `agent.handleMessage` call,
    counted synchronously on entry in the S2c turn wrapper); no stop in
    progress, no mode running and no hostile within 16 blocks for 5 s; not
    held: 30 s since the last pass; a pass that removed nothing, or an
    admission with no direction, is not retried until the inventory or her
    position (> 8 blocks) changes, or 5 minutes pass (the config changes only
    with a restart), and the hold records why: "nothing to drop from here" or
    "no free direction nearby" (S2e trials F5); an owner `!stop` during a
    pass holds the cleanup 10 minutes; a 4th pass that removed something
    within 10 minutes holds it 10 minutes and tells the owner once: "I've
    cleaned my bag 4 times in 10 minutes, so I'm pausing that for 10
    minutes." Currency: the pass captures `stop_epoch` and the owner-message
    generation at admission and re-checks them, with the task, question and
    goal conditions, the hostile check (16 blocks, 5 s) and the message-turn
    count (only the turn parked on a cut follow may stay open), at entry,
    after a walk, after the tick wait and between tosses, so a stop, an owner message, a
    hostile or a new turn ends a pending or running pass. Anything cuts a
    pass (modes, commands, `!stop`, owner messages, sleep: REQ-SLP-2); a mode
    that cuts it prompts no model call. A pass cut before it removed anything
    is not held.
  - **The full bag of kept items.** When the admission finds the slots low and
    the plan empty, she tells the owner once per session the five largest
    kept items, totalled by name: "My bag is full of things I keep: arrow 192,
    gunpowder 64, …; add some to my item list?" (`alert`).
  - **`!itemList`** (a query, code-rendered): the effective list by tier with
    what she holds, the free slots, whether the idle cleanup is on or held and
    why, and the last pass ("dropped 86 rotten_flesh, 41 gravel, 3 min ago").
    The list is edited in the profile; a full operator Stop/Start reloads it
    (main.js reads every profile file at start).
  - **Gifts.** An item the owner hands her that is on the 0 list is dropped at
    the next pass when she is nearly full; the cure is `"all"` or a count for
    that item.
  - **Chest destination.** Part B (design r7 §7: `!itemChest`, a single bound
    chest or barrel, idle passes only), parked until the owner's word after
    S2e's trials. The `[Surv]` surplus drop of task pickups no step needs stays
    `[Surv]`, behind `work.allow_drop_task_surplus` (false).
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
  move, smaller, or a clearing task the owner asks for (§11.9). The bot never wanders off to
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
  (`dontMineUnderFallingBlock`, movements.js:275-288). That flag's entity check
  sees entities only during a path search (§4.2), so it does not keep a dig from
  removing the block a player or the bot stands on; digs outside a search check
  occupancy themselves (`dig.js` `digCell`, REQ-CLR-6; REQ-BLD-34 defers cells a
  player occupies). A cave dug
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
  protected. From S2c these placements are also recorded as `scaffold` and
  tidied when in reach (§11.10).
- **REQ-BLD-22 Placement ledger.** [I1] (S2 form. S2c replaces it with the
  placements ledger of §11.10, REQ-OWN-1 … 6: its own file, kinds `station`,
  `scaffold`, `building` and `own`, and recording from the placement attempt.
  The record-held ledger, the in-memory list before the first task and the
  station carry below retire then.) The bot's own placements are recorded from
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
  (S2 form; `scaffold` arrives in S2c, REQ-OWN-2.) In this form pillars and
  other non-blueprint placements are recorded as plain entries with no kind.
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
  beside a build (cosmetic; the approach cell keeps the entrance clear); from
  S2c the task-end tidy sweep removes those within the bot's reach (REQ-OWN-8).
  The cleanup reuses the tidy sweep: it wraps `tidyNear` with its own approach
  walk around the build, because the sweep itself never moves (REQ-OWN-7).
- **REQ-BLD-35 Blueprint cells in the ledger.** [I1] (S3; numbered after
  REQ-BLD-34 to keep IDs stable.) When the builder accepts or verifies a
  blueprint cell that holds a ledger entry (REQ-BLD-1: a `solid` cell is
  satisfied by any full block already there), it re-kinds that entry to
  `building`, so a tidy sweep never removes a wall block (REQ-OWN-2).

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

### 11.9 Clearing an area `[I1]` (S2c)

Owner ruling (DECISIONS 2026-11-08, "Clearing an area and the bot's own
blocks"): clearing is a capability of its own, not part of building; the owner
usually clears an area to build something there later. It sits beside building
because it shares the dig seam, the placements ledger and the owner question
with S3. The cube-clearing trials that led to it are in ISSUES.md (cube
analysis).

- **REQ-CLR-1 The `clear` step.** [I1] Two forms (DSL, §12.0):
  - `clear box=x1,y1,z1:x2,y2,z2`: exactly those cells, corners included. The
    model converts the owner's corners to the cells it means; there is no
    `shell` key in this form.
  - `clear markers=<exact block name> [shell=keep|clear]`: the box marked by
    those blocks. `keep` (default) clears the inside only; `clear` clears the
    marked box with its outer layer.
  - Validation completes and freezes `args.box` (the cells to clear),
    `args.bounds`, `args.shell`, `args.markers` and `args.cells`. The record
    schema does not change (REQ-PLAN-3).
- **REQ-CLR-2 Markers.** [I1] Markers are found by a complete search: every cell
  of the cube of radius `work.clear.marker_radius` (32) around the frozen anchor
  (REQ-PLAN-8), scanned cell by cell or by section and filtered by distance,
  never `findBlocks` alone (it misses in-range blocks, §4.1). The same search
  serves `!blockPositions` (REQ-TRN-16). The markers must pass the corner test
  (each marker's x, y and z each equal a minimum or a maximum of their bounding
  box), be at least 4 on three distinct axes, and leave an inside when
  `shell=keep`. The corner test alone would have refused the trial run that
  boxed every oak log within 64 blocks: tree logs are not the corners of a box.
  An incomplete marker search cannot occur, by construction.
- **REQ-CLR-3 Caps and errors.** [I1] A box over `work.clear.max_cells` (32 768,
  32 × 32 × 32; the owner wants no tight limit) or farther than
  `work.clear.max_distance` (64, from the frozen anchor to the nearest cell of the
  box) is refused. Errors follow REQ-PLAN-5 and
  REQ-TRN-15:
  - `step N: give box=… or markers=…, not both`;
  - `step N: missing key 'box' or 'markers'`;
  - `step N: bad box 'V' (use x1,y1,z1:x2,y2,z2)`;
  - `step N: the box has C cells; at most M`;
  - `step N: the box is D blocks away; at most R`;
  - `step N: no M within R blocks to mark the box (name the marker block, or give
    the box as x1,y1,z1:x2,y2,z2)`;
  - `step N: K M within R blocks do not mark the corners of one box (x,y,z is not
    a corner); give the box as x1,y1,z1:x2,y2,z2`;
  - `step N: the marked box has no inside (W×H×D); use shell=clear`;
  - `step N: found K M within R blocks; a marked box needs at least 4, on three
    axes; give the box as x1,y1,z1:x2,y2,z2` (main-seat ruling, OQ-22).
- **REQ-CLR-4 Start.** [I1] The `!taskStart` confirmation states the box and its
  cell count, rendered by code (for example "Clearing x −103..−94, y 63..68,
  z 473..485: 780 cells inside the marked box; its outer layer stays."). A
  `markers=` box is cleared at once; the owner can `!stop`. A `box=` box (the
  model may have written the coordinates) is stated and waits for the owner's
  yes through an owner question (REQ-REC-12) before any dig (DECISIONS
  2026-11-08). The question is the same statement followed by "Clear it? yes /
  no" (`pending_question.kind` `clear_start`); a no cancels the task as
  `cancelled(owner_declined)` with nothing dug (main-seat ruling, OQ-22).
- **REQ-CLR-5 Protection scope.** [I1] While the task is active, its current
  step is a clear step and the bot is in the task anchor's dimension (the box,
  its kept layer and its grants are coordinates in that dimension), the
  Protector reads the box from the frozen args:
  - the kept outer layer counts as protected for every caller (through the
    `safeToBreak` prototype patch, so modes and collection never dig it either),
    and the clear step's own movements exclude it (`exclusionAreasBreak` ≥ 100,
    so it cannot be broken; nothing is placed in it: every move the pathfinder
    generates is dropped when a placement destination, reference + face, lies
    in the kept layer, because `exclusionAreasPlace` is handed the feet cell
    for a forward bridge that places one cell below, movements.js:412-413);
  - inside the box, `scaffold` and `own` ledger entries are ordinary cells
    (REQ-OWN-2), and granted positions are exempt while their block matches
    (REQ-CLR-9); a completed `building` entry stays protected before any grant
    or container rule, so a furnished build's chest is reported "part of my
    build", never asked about;
  - containers (`work.clear.containers`, every listed block that holds items)
    are never candidates unless the owner's explicit answer grants them
    (REQ-CLR-9); the bot's own `station` furnace in a box is a container like
    any other; `work.clear.never_remove` blocks (the spawner) are never
    candidates;
  - inside the box the clear step's candidates include buried natural blocks
    such as ores: the exposure rule of REQ-SAFE-1 does not apply to clear-step
    digs inside the box;
  - everything else follows the normal predicate (REQ-SAFE-1): an unrecorded
    non-natural block stays and goes to the leftovers question.
- **REQ-CLR-6 Dig seam.** [I1] `work/dig.js`, shared with the tidy sweep and S3's
  builder. Movement goes through `goToGoal(bot, goal, configure)` (the S2b carry,
  §5.3), so the caller's movement settings survive. `digCell` runs, in order:
  approach (non-destructive outside the box) → occupancy check (no player and not
  the bot over the cell; the pathfinder's own entity check is empty outside a
  search, §4.2) → the patched `safeToBreak` with the hazard flags forced → tool →
  every check again right before the dig (interruption, the caller's
  dimension, reach, the cell loaded and still the same block, occupancy,
  protection and so the exact grant), since equipping awaits and Mineflayer's
  dig checks none of them → dig. It returns a reason (for example next to water, under a falling block,
  occupied, kept shell, a kept container, never removed, needs a tool), never
  just a boolean. The falling-block check, the dig checker's and the
  pathfinder's through the `safeToBreak` patch alike, also knows suspicious
  sand and gravel (the pathfinder lists only sand and gravel,
  movements.js:64-66), so the support of a kept one is not dug. As built (S2c
  part 2): a `standing` option leaves the bot itself out of the occupancy check
  for pillar-down (REQ-OWN-7); other players on the cell still keep it. A
  `final(block)` option is the caller's own check, run synchronously after the
  tool is chosen and immediately before the dig; the seam looks at the block
  first and then digs with Mineflayer's `'ignore'` look, so nothing awaits
  between the last checks and the dig packet (the clear step's digs too; the
  packet's face is unchanged: Mineflayer's `dig(block, true)` already sent the
  default top face).
  Options `{ move, obtain, hand }`; with `hand: true` it digs by hand when no held
  tool harvests the block. `breakBlockAt` and `digDown` are not used: they refuse
  without a harvest tool (skills.js:651-655).
- **REQ-CLR-7 Unit.** [I1] Each unit rescans the box. Candidates are cells that
  are not air or liquid, not `never_remove`, not an ungranted container, and
  have fewer than 2 hard failures.
  Order: the highest layer first, then nearest first; at most 16 digs per unit.
  When only cells under the bot remain, it first moves to a cleared cell; with
  none yet, those cells wait for a later unit (a soft refusal, never counted as
  a failure; the stall rule bounds it). When
  nothing held can harvest the next cell, it obtains a tool through an inline
  `obtain` sub-progress. The stall rule, resume with no model call, the run bound
  and the deadlines are inherited from S2 (§7). In another dimension than the
  anchor's the unit digs nothing and the step waits with no block and no model
  call: the run ends as a refusing resume check does, with the cause ("the box
  is in overworld; I am in the_nether") as its last cause, the next idle
  retries it, the stall rule bounds it, and the step goes on once the bot is
  back; the check runs again after every awaited move and dig, and its
  measure keeps the last value there.
- **REQ-CLR-8 Done and report.** [I1] Progress comes from rescans, never from
  counters. The step is done when no candidate remains and a settled second scan
  agrees. The report is rendered by code and goes to the owner directly, for
  example "772/780 cells empty; left: 5 next to water, 2 under falling blocks,
  1 chest (a container, kept)". The owner gets the whole report (the step's
  stored result is clipped to 160 characters). Drops are picked up
  opportunistically; the runner's free-slot drop (REQ-OBT-11) runs before a unit,
  but a full inventory never blocks a clear (a dig needs no free slot; drops
  stay on the ground). The report never claims drops were collected.
- **REQ-CLR-9 Leftovers: one owner question.** [I1] (DECISIONS 2026-11-08: a box
  the owner asked to clear; containers stay unless he says otherwise.)
  - The question is asked when the step ends with unrecorded non-natural cells
    left (not a container, not `never_remove`, not the kept layer), or with
    containers in the box, or both. It is a `pending_question`, the task is `blocked(awaiting_owner)` and
    no model call is made (REQ-REC-12). Example: "762 of 780 cells are empty. 18
    blocks are left that are not natural and not in my records: cobblestone
    16 (one at −98,64,479), oak_planks 2 (one at −100,63,480). Remove them too?
    Answer yes or no." ("not in my records", not "that I did not place": the
    bot's own scaffold evicted by the cap, or recorded in an unknown world,
    is among them.) Every type is
    listed with its count, with no cap, since a yes grants all of them.
  - Containers (`work.clear.containers`) are listed each by name and position,
    every one of them, on lines of their own, with the warning that their contents would drop (for
    example "Also inside: chest at −100,63,478, furnace at −98,64,480; their
    contents would drop; say 'yes, chests too' to remove them"). Only that
    explicit answer covers them; a plain yes leaves them. `never_remove` blocks
    (the spawner) always stay.
  - The owner's answer is read from his chat after translation, before the
    model (the `agent.js` interception, REQ-REC-12). A yes grants
    exactly the listed positions, each only while its block still matches; a no
    keeps them and the step ends.
  - A container grant makes exactly those positions candidates. The patched `safeToBreak` would still refuse a chest
    (`blocksCantBreak`, movements.js:42, :291), so the clear step's check takes a
    position-scoped exception for exactly the granted container positions; the
    liquid, falling-block, occupancy, kept-shell and every other blacklist check
    stay.
  - A grant of either kind resets the per-cell failure counts of the granted
    positions, so cells refused earlier as protected are dug.
  - What a model mistake cannot do: widen the box (frozen at validation), answer
    the question (no command sets it), or reach a container without the owner's
    explicit word.

### 11.10 The bot's own blocks: ledger and tidying `[I1]` (S2c)

Owner rulings (DECISIONS 2026-11-08, 2026-11-10 "Tidying the bot's own
scaffold blocks", 2026-11-11 "Clearing design approved"): blocks the bot placed
to move or fight (pathfinder pillars, bridges, blocks for getting up to fight)
are not protected and are not left behind as clutter; blocks it placed with
code or commands may be a building it made and stay protected outside a box the
owner asked to clear. This is the **lean version**: the bot removes recorded
scaffold it can reach without walking. Recording every block it puts down and
removing scaffold out of reach by walking to it is its own later slice (PLAN
§8).

- **REQ-OWN-1 The placements ledger.** [I1] One versioned file per bot,
  `$MINDCRAFT_RUNTIME_DIR/bots/<name>/placements.json`, written atomically at
  most once per 2 s and flushed at task changes and on SIGINT. On first load it
  migrates the station entries of `task.json` once. It retires the record-held
  ledger of REQ-BLD-22, the in-memory list before the first task (`loose`), the
  station carry (`carryStations`) and the S2 residual that stations placed
  before the first task are forgotten on a crash. An entry holds the position,
  the block, the kind, `by` (the action label at the placement attempt,
  `actions.currentActionLabel`), `dim` (`bot.game.dimension`), `at` and, for a
  `building` entry, `build_id?` (the S3 build or the `!buildStructure` run it
  belongs to, so "protected after its build" knows which build); it matches only
  in its own dimension. A `!buildStructure` run is the agent's
  `npc.build_goal.executeNext` under the `action:buildStructure` label (a
  runtime wrap inside the executed action; the command's `perform` is left
  alone because `runAsAction` finds its label by `perform` identity). An
  unreadable or unknown-version file is renamed aside to
  `placements.json.bad-<ms>` and logged, so the first write cannot overwrite
  its entries; the ledger starts empty.
  - *Per world* (S2c-fu; DECISIONS 2026-11-12, "she should be able to work in
    different worlds"). The file is version 2:
    `{ version: 2, updated_at, worlds: { <id>: { entries: [...] } } }`. The
    world id is `seed:<16 hex digits>` of the login packet's
    `worldState.hashedSeed` (protocol 26.1 `SpawnInfo`), kept as
    `bot.game.hashedSeed` by the `utils/mcdata.js` carry (§5.3) and updated by
    a respawn packet; the ledger reads it once, at load (`Work.init`, after
    login). Load reads only the current world's entries; every write replaces
    only that world's slot and writes the other worlds back untouched. A
    version-1 file (one list, no world) was written on this server: it is
    folded once into the current world's slot and written back at load as
    version 2 (one quarantined fold; the v1 shape is gone). An unknown world
    (no hashed seed): nothing is loaded or written (what the bot places that
    session lives in memory only, every kind; one log line), and a version-1
    file is left as it is for a start that knows its world.
- **REQ-OWN-2 Kinds.** [I1] Stated once; this changes the ledger branch of
  `isProtected` (protect.js), which in S2 exempts every matching entry. Every
  exemption holds only while the recorded block is still there (REQ-SAFE-2).

| Kind | Recorded for | Protection |
|---|---|---|
| `station` | a crafting table or furnace the bot placed outside any blueprint | exempt, as today |
| `scaffold` | a pathfinder placement, told by tell A (REQ-OWN-3) | exempt everywhere while live; removed by the tidy sweep (REQ-OWN-7) |
| `building` | blueprint cells (S3, REQ-BLD-35) and `!buildStructure` placements | protected after its build (a `!buildStructure` build ends when that action returns) |
| `own` | placements by code or `!placeHere`, task-time placements that are not blueprint cells, scaffold the owner kept (REQ-OWN-9), and (S2d) the sleep routine's bed, recorded at its foot with `by: 'mode:sleeping'` whatever else runs (REQ-SLP-6) | protected outside an active clear box whatever its material (a dirt or stone house the bot built must not look natural), exempt inside one; the sleep routine's bed is also exempt for its own pickup dig only (`ownBed`, the exact live entry, both protection checks of the dig seam) |

- **REQ-OWN-3 Recording: context at the attempt, block from the cell.** [I1]
  (Live probe P13, 2026-11-10; §4.2.)
  - *Attempt.* At work init the work module wraps `bot.placeBlock` and
    `bot._placeBlockWithOptions` (a runtime wrap like the command guards, no
    upstream patch; the pathfinder calls `bot.placeBlock` through the bot
    object). At call time it records an attempt for `dest = reference + face`:
    the source is `scaffold` when `blockAt(dest).stateId === 1` **at call time**
    (tell A: the pathfinder writes the predicted stone synchronously just before
    the call, and no other caller places into stone), otherwise the context kind
    of REQ-OWN-2; `expected` = the held item's block name; `by`; `dim`; the
    column's load generation; `at`. The context is fixed at the attempt;
    settlement never re-samples it.
  - *Non-scaffold attempts* are written from `newBlock` at `blockPlaced`, at once,
    as in S2 (Mineflayer's `placeBlock` has already waited for the destination's
    real update). So `!craftRecipe` still takes back its table, and real stone
    placed by code is recorded.
  - *Scaffold attempts.* Repeated attempts for one cell merge. The entry is
    written when the cell shows the `expected` block (a `blockUpdate` there, or
    `blockAt` 2 s after the last attempt) in the same loaded-world generation.
    Anything else (air, the old liquid of a water crossing, predicted stone,
    another block) writes nothing. An attempt is dropped when its column unloads
    or the world changes. If the held item changed before the packet (for example
    auto-eat), nothing matches and nothing is written (the safe direction).
  - *Owner-kept attempts:* an attempt marked `keep` by an owner `!stop`
    (REQ-OWN-9) settles as `own`.
  - This also fixes the S2 defect that records task-time pathfinder blocks as
    `air` (ISSUES, cube analysis item 17), which left them protected.
- **REQ-OWN-4 Scaffold records survive; the component guard.** [I1] (S2c-fu;
  DECISIONS 2026-11-11 "After the S2c live trials" and 2026-11-12, which
  replace the 2026-11-10 "forgotten, not tidied automatically" rule.)
  - *Kept.* `scaffold` entries are kept through a clean stop, a crash and a
    chunk unload (a dimension change, which unloads every column, included);
    an unload still drops its column's pending attempts.
  - *Gap mark.* An entry that lived through a gap gets `gap_at` (ms of the
    first gap; never cleared): at process start (`Work.init`, not the runner's
    per-run reload) every scaffold entry is marked, and an unloaded column
    marks its scaffold entries (of any dimension). Init logs
    `[ledger] kept N scaffold entries from before`. An entry placed this
    session keeps today's rule (exempt everywhere).
  - *The component guard*, in `isProtected` (protect.js), so pathfinding,
    collection, the dig seam and the tidy sweep all see it. A gap `scaffold`
    entry outside an active clear box is the bot's only while its whole
    connected component of gap scaffold entries (face-connected, live, block
    matching) stands free: every face neighbour of every member is loaded and
    is empty or liquid, a member, her live matching same-session scaffold
    (a `scaffold` entry without `gap_at`), or natural by the default
    predicate's own tests (logs and leaves only through the tree and canopy
    tests, never by name, so a log build around her pillar lapses it). An
    `own`, `building` or `station` neighbour lapses it like an unrecorded
    block, whatever its material (checked before the natural test: kept dirt
    or stone is not terrain; fix wave 2, S4): `own` holds owner-kept
    scaffold, so "nothing of his touches them"
    rules it out (S2c-fu fix wave 1, D3; design §8b counted any non-scaffold
    entry as hers, the unsafe direction). A
    component of more than 64 members is lapsed (a constant; measured: an
    uncached 40-block component added 18 ms per A* search, 160 blocks
    110 ms). The verdict, and the tree and canopy answers behind it (the
    guard keeps its own, never a run's memos), is memoized per component
    until the ledger's next
    block or entry change (any `blockUpdate`, column load or unload, or entry
    change) or one game tick (50 ms). Otherwise the entry is *lapsed*: the
    cell falls through to the default predicate (an old cobblestone pillar is
    protected like any non-natural block, an old dirt pillar is natural like
    all dirt), the record is kept, and it stands free again once the foreign
    neighbour goes. Inside an active clear box a gap entry is the bot's.
  - *Eligibility*, apart from the material verdict, since a lapsed dirt block
    is natural yet must not be tidied: `ledger.scaffoldEligible(entry, { gap })`
    (live `scaffold`, not being dug, and a gap entry only while `gap(entry)`,
    the Protector's `gapHers`: in an active clear box, or standing free). The
    tidy sweep's candidates, its pillar-down test, the trigger discovery
    (`Tidy.within`, `modeScaffold`) and its final pre-dig check all use it;
    the structure under the bot (`standingOn`) keeps every matching recorded
    block, whatever its kind (its connectivity is a safety feature).
  - *Who removes them* (the owner's answer of 2026-11-12, Q1: yes): the guard applies
    to every caller, so old scaffold that stands free is removed as before by
    the fight-end and task-end sweeps, a `!tidy` of either side, gathering
    (`collectBlocks` treats her blocks as fair game) and the pathfinder.
  - Entries re-kinded `own` by an owner `!stop` are kept, as before.
- **REQ-OWN-5 Cap and retirement.** [I1]
  - `work.ledger_max` (2000) caps live `scaffold` entries only, per world (gap
    entries included): the oldest is evicted, and an evicted pillar falls back
    to the default predicate as an unrecorded block. The cap also applies once
    right after load, marking the ledger dirty when it evicts, so a lowered cap
    takes effect at the next start. `own`, `building` and `station` entries are
    never evicted; they grow only with what the bot builds (a log warning above
    10 000).
  - An entry whose block changed is retired (REQ-SAFE-2, and on `blockUpdate`),
    only for loaded cells: an unloaded cell is unknown, not gone.
  - *Hygiene* (S2c-fu): when a chunk column loads (`chunkColumnLoad`), the
    current dimension's `scaffold` entries in that column whose cell shows
    another block are retired (an entry being dug is skipped); `Work.init` runs
    the same check once over the cells already loaded. Retirement on any
    `isProtected` query stays as before.
  - *Durability* (S2c-fu): `Ledger.install` adds a `process.once('exit')`
    handler that flushes what is dirty (synchronous; a write error is logged,
    never thrown), removed by `dispose`; a successful tidy dig marks the ledger
    dirty at once, so an exit inside the revert window does not leave the
    removed entry in the file.
  - *Tidy digs.* Before `bot.dig` the entry is marked `removing` and is exempt
    from retirement while the dig runs (Mineflayer writes the predicted air
    locally first, digging.js:160). After the dig it is `removed_at`; a
    `blockUpdate` showing the same block in that cell within 3 s (a server
    revert, one round trip) makes it live again, and a 3 s timer then deletes it.
    An aborted dig clears `removing`.
- **REQ-OWN-6 Tell A guard and fallback.** [I1] A unit test asserts the
  pathfinder's write-before-call order (§5.3). If tell A fails a later
  regression, the fallback is dirt-only scaffolding everywhere (a prototype patch
  of `countScaffoldingItems` / `getScaffoldingItem`), with no `scaffold` kind:
  dirt placements are not recorded at all (dirt is natural, so pillars need no
  record, but they are not tidied either), and other placements keep their
  context kind.
- **REQ-OWN-7 The tidy sweep, `tidyNear(bot, opts)`** [I1] in `work/tidy.js`, one
  function for every trigger. The build cleanup (REQ-BLD-23) wraps it with its
  own approach walk, since the sweep never moves.
  - *Sweep context first.* Every call registers the active sweep with the work
    layer for its whole run (its pending attempts within reach and its
    candidates not yet removed), whatever action or task phase it runs in. It
    then waits for pending scaffold attempts within reach to settle (at most the
    2 s window), so the top of a pillar just built is not missed.
  - *Candidates:* live `scaffold` entries, same `dim`, block still matching
    (`blockAt`), within reach of the bot's eyes (4.5 blocks). `opts.only_by`
    limits them to entries whose `by` is in a set (inside a task, REQ-OWN-8).
  - *No movement at all.* The bot never walks, places or uses the pathfinder
    during a sweep, so it cannot strand itself, creep, build new scaffold or dig
    terrain.
  - *The structure under the bot.* The blocks under the bot are every block
    under its hitbox footprint (x ± 0.3, z ± 0.3 at its feet), not only the
    floored position. Connectivity is computed over all ledger entries the bot
    placed (any kind, live or not, loaded cells, matching blocks) before any
    eligibility filter (reach, kind, `only_by`). If a block under the bot belongs
    to such a component, every block of that component is excluded, except by
    pillar-down: a bridge it stands on is left whole, whatever its parts' kinds.
    The bot must be grounded when candidates are chosen, and the footprint is
    recomputed before each dig (knockback or flowing water can move it).
  - *Pillar-down:* only when that component is a plain vertical column of live
    scaffold (no recorded block beside any of its blocks) standing on a loaded
    full solid block, with no liquid beside the support or the landing cell, and
    the bot grounded above it. It digs the support, waits until grounded one
    block lower (2 s, else the sweep ends), and repeats.
  - *Order:* top-down. A candidate is removable only when the cell above it is
    air, or a non-solid natural block that breaks when its support goes (snow
    layer, short grass, flowers), or becomes so in this sweep: a column whose top
    is out of reach or fails stays whole, so no floating block is left.
  - *Before each dig:* the entry and the block still match; no player in or
    standing on the cell; no liquid beside it (`dontCreateFlow`); no falling
    block (sand, gravel, concrete powder) above it; no hostile within 16 (a
    hostile ends the sweep and the rest stays live). These checks use a separate
    `Movements` instance with `safeToBreak`'s flags forced on; nothing navigates
    with it.
  - *Dig:* `digCell(bot, block, { move: false, obtain: false, hand: true })`
    (REQ-CLR-6) calls `bot.dig` with the best held tool, or by hand when no held
    tool harvests the block (removal is the goal; cobblestone by hand drops
    nothing). REQ-OWN-5's `removing` / `removed_at` rule applies.
  - *Drops:* no pickup walk. Items within the vanilla pickup range are collected
    by the game; the rest despawn. The report never claims drops.
  - *Bounds:* at most 32 digs and 60 s per sweep; what is left stays live. (As
    built: both are checked before each dig, so a dig in progress may end a
    little past 60 s; §16.)
  - *Interrupted remainder.* When a mode interrupts a sweep, its remainder
    (pending attempts and candidates not yet removed) is kept as the interrupted
    remainder until the next sweep starts, which supersedes it. Attempts already
    marked `keep` stay `keep` when superseded.
  - *As built (S2c part 2).* The sweep runs in rounds: candidates are chosen
    (grounded), removed top-down with every check per dig, then one pillar-down
    step, then candidates are chosen again one block lower. The live candidates
    within reach are registered with the pending attempts before the first
    await, so a stop during the settle wait keeps them too. The sweep's own
    checks (keep or interruption, dimension, bounds, hostile, grounded, the
    entry still live `scaffold` of this sweep's `only_by`, the structure under
    the bot or the pillar predicate, top-down) run before each dig and again
    through `digCell`'s `final` check right before the dig packet. A candidate
    refused for a cell reason (next to water, protected, a player on it, a
    failed dig) is not retried in later rounds; one left as "part of what I
    stand on" or "under a block that stays" is. Pillar-down also obeys
    `only_by`, so a sweep inside a task never pillars down the task's own
    column. Its support must be a full cube (one collision box filling the
    cell; a slab or a fence is not, though both have `boundingBox: 'block'`).
    "No liquid beside the support or the landing cell" is the dig seam's liquid
    check on the block dug (above it and its four sides): liquid beside the
    untouched support cannot start a new flow. The falling-block check is
    covered by the top-down rule (a solid block above, falling or not, keeps the
    candidate). The 32-dig bound counts every dig attempt through `digCell`,
    refusals included. A candidate whose block changed is no longer the bot's
    and is neither dug nor reported. Only a sweep a **mode** interrupted keeps a
    remainder (a runtime wrap of `actions.runAction` records the label of the
    last action started; nothing else uses it), and the remainder expires when
    the next sweep starts or after 5 minutes. One ended by a command, a hostile,
    a bound or the ground leaves its rest live. The wait for pending attempts
    lasts the settle window plus one 50 ms poll; this narrows, not closes, the
    race between the wait's `Date.now()` deadline and the ledger's settle timer
    (§16).
- **REQ-OWN-8 Triggers.** [I1] `work.tidy.enabled` (default true) turns the
  automatic triggers 1 and 2 off; `!tidy` still works.
  1. *Task end.* When a task reaches `done` or `failed` (not `cancelled`,
     `blocked` or `paused`), `finishDone` / `fail` post the report and run the
     goal handback exactly as today. The run's `finally` (runner.js), which every
     run passes through, resumed ones too, captures the record, `stop_epoch` and
     `actions.last_action_time`, and schedules a bounded per-tick check (up to
     5 s, never awaited: starting the sweep from inside the run would deadlock on
     `runAction` stopping `action:task`). The check waits until
     `!actions.executing`, then, immediately before launch, starts `action:tidy`
     only if the same terminal record is still the current one, no newer task
     exists, `stop_epoch` and `last_action_time` are unchanged, and the agent is
     idle. If a goal was handed back, its next command simply replaces the
     sweep; the rest stays live. (As built: the 5 s window is also checked
     immediately before launch, not only while the run's action executes.)
  2. *After a mode.* The modes carry (§5.3) calls
     `agent.work?.onModeEnd(mode.name, code_return)` at the end of upstream
     `execute`; there is no `runAction` wrap. It acts only when the mode ended
     uninterrupted, on the next tick, with no action executing or stopping
     (`!actions.stopPromise`, no `interrupt_code`), and with live or pending
     scaffold labelled `mode:*` within reach:
     - no live task and no resumable action pending (`actions.resume_func` unset,
       so after a fight during `!followPlayer` following resumes first): if no
       hostile is within 16, start `action:tidy`; otherwise re-check every 5 s
       for up to 60 s while the agent stays idle (no walking). The request
       captures `stop_epoch`; any stop (owner or model) cancels it, and every
       launch, first or re-check, re-validates all of these conditions
       immediately before starting;
     - a live task: the request sets the runner's `tidy_after_mode` flag; the
       runner runs `tidyNear({ only_by: <the mode:* labels> })` at the start of
       its next unit and clears the flag only when that sweep completes, so the
       task's own access scaffold is never taken away mid-task. (As built: a
       sweep completes when nothing ended it early; a hostile within 16, a
       bound or not being grounded keeps the flag for the next unit, and such a
       sweep that removed nothing says nothing (REQ-OWN-10). The flag belongs
       to its task: it is cleared when the task ends (done, failed, cancelled)
       and when a new task starts. A sweep that throws clears it and is not
       counted against the step.)
     - (As built: the stop epoch, `actions.last_action_time`, the tidy keep
       generation and the 60 s deadline are captured in `onModeEnd`, before
       the first timer; any stop, any owner keep (a raw `!stop` whose command
       is still translating included), any action started since then, or the
       deadline having passed cancels the request at every check, the first
       and the live-task flag included. The task-end trigger captures the keep
       generation the same way. "No `runAction` wrap" above still holds for the
       trigger itself; the separate label-recording wrap is REQ-OWN-7's.)
  3. *`!tidy`* (owner or model) runs the same sweep as `action:tidy`. It is
     refused while a task is live: "A task is running; I tidy when it ends."
     (As built, S2c-fu: the answer is REQ-OWN-10's; for a sweep with no line
     the command returns "No scaffold of mine within reach." for an empty
     sweep, or "Nothing tidied (<why>)." when the sweep ended before choosing
     anything; an interrupted `!tidy` returns nothing.)
  - The modes carry also keeps a fight that interrupts a sweep from prompting the
    model (`should_reprompt` excludes `action:tidy`; otherwise a 16–45 s call
    for nothing).
- **REQ-OWN-9 Owner `!stop` mid-sweep.** [I1] (DECISIONS 2026-11-10: the blocks
  not yet removed stay for good.) The keep is applied synchronously where the
  owner's raw message is observed, not inferred later: the work layer's observer
  of the owner's raw messages (`Work.onOwnerMessage` for chat and whispers, and a
  wrap of `agent.respondFunc` at init for messages through MindServer, both with
  the `only_chat_with` filter) parses the message with the existing command
  parser. When it is `!stop`, the active sweep, or else the interrupted
  remainder, is kept at once: its candidates are re-kinded `own`, its pending
  attempts are marked `keep` (they settle as `own`), the ledger is persisted, and
  deferred mode-tidy requests are cancelled. This runs before any translation or
  model call, so a slow translation cannot misclassify it. The ordinary stopping
  of actions stays with the existing `!stop` command. A `!stop` the model issues
  within 60 s of an owner message counts as the owner's (the owner typed "stop
  tidying" in words): it errs toward keeping. Any other model `!stop` keeps
  nothing. Any pillar or bridge the bot made may be removed, even one the owner
  walks on; he keeps one by replacing a block with a different type (DECISIONS
  2026-11-10). (As built: the `respondFunc` wrap applies only the `!stop` keep;
  a MindServer message is not the last owner message. The sender rule:
  MindServer's web UI sends as `ADMIN`, which `only_chat_with` filters out, so
  only the operator helper, which sends as the owner, reaches the keep through
  this path. A keep of the active sweep also cancels its dig in progress
  synchronously (`bot.stopDigging()`), and no dig starts after a keep; the
  action, task and resume are still stopped by the `!stop` command. The owner
  keep also clears the runner's `tidy_after_mode` flag.)
- **REQ-OWN-10 Tidy message.** [I1] After a sweep that removed or left
  something, one line rendered by code through the work report seam:
  "Removed 1 scaffold block of mine here." / "Removed 5 scaffold blocks of
  mine here." / "Removed 3 scaffold blocks of mine; left 2 (next to water)."
  Nothing for an empty sweep. As built: nothing either for a sweep a mode or a
  stop interrupted (the sweep after the mode, or the stop, follows); the line
  reports only blocks left for a reason of their own (a cell reason, as in the
  examples), never those a hostile, a bound or the ground kept the sweep from
  reaching, so a sweep that removed nothing and left nothing for a cell reason
  says nothing; several reasons are counted ("left 3 (2 next to water, 1 part
  of what I stand on)").
  - *Under `work.chat`* (S2c-fu, REQ-CHAT-1; `work.tidy.announce` is retired,
    one switch): the line always goes into history through `postReport`, and to
    chat as `detail` (shown in debug only).
  - *`!tidy`'s answer:* a `!tidy` in an owner turn, typed by him (shown as
    `reply`) or issued by the model for his words (the line comes back to the
    model, whose next response in his turn is shown; fix wave 1, G2), returns
    the line as its command result whenever the chat line was not said; a
    `!tidy` in her own turns returns nothing once its line was posted (no
    second history entry); whether the line was said no longer depends on a
    switch of its own.
- **REQ-OWN-11 Interplay.** [I1]
  - The clear step: inside its box, `scaffold` and `own` are ordinary cells
    (REQ-CLR-5); the task-end sweep then removes reachable scaffold outside the
    box.
  - An open owner question keeps the task live, so no `action:tidy` starts
    (REQ-REC-12).
  - S3: the builder re-kinds a ledger entry it accepts as a blueprint cell to
    `building` (REQ-BLD-35).
  - What the lean version does not cover is listed in §16.

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
| `!blockPositions("<type>", <range>)` | exact block name; `range` is an `int` | Read-only listing of a block type's positions (REQ-TRN-16). S2b. |
| `!tidy` | none | Remove the bot's own reachable scaffold now (REQ-OWN-8); refused while a task is live. S2c. |

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
step    := skill ( " " arg )*            skill: obtain | go_to | give | clear | build
arg     := key "=" value
value   := token | "'" text "'"          token: letters, digits and _ - . , :
                                         text: any characters except ' and "
```

  - Skills and keys (keys in any order; unknown keys are errors; `[…]` marks an
    optional key):
    - `obtain item=<item> count=<1-256>`;
    - `go_to target=here|owner|<x>,<y>,<z>` (place names from I4);
    - `give player=<name> item=<item> count=<n>`;
    - `clear box=<x1>,<y1>,<z1>:<x2>,<y2>,<z2>` or `clear markers=<block>
      [shell=keep|clear]` (S2c; exactly one of `box` and `markers`, REQ-CLR-1);
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
    REQ-PLAN-4 and of the clear step (REQ-CLR-3).
- **REQ-TRN-16 `!blockPositions(type, range)`.** [I1] (S2b) A read-only query,
  registered with the work commands: a complete search of the cube of `range`
  around the bot, filtered by distance (the same search as the clear step's
  markers, REQ-CLR-2), with no movement. It answers with the count, the bounds
  and up to 10 positions, for example "8 stripped_spruce_wood within 32: bounds
  x −104..−93, y 62..69, z 472..486; nearest: …". It closes the observation gaps
  of the cube trials (ISSUES, cube analysis items 5 and 13). `range` is 1–64,
  clamped (main-seat ruling, OQ-22). When any cell in the radius is not loaded,
  both the listing and the "No <type> within <range>" answer end with "(part of
  the range is not loaded)"; the search reports that coverage to its callers
  (S2c's marker search). Output truncation (`action_manager.js`) is unchanged: the
  listing and the clear step's report remove the need to compact action output.

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
  before S2 (native `!collectBlocks` mines them); a clear step digs buried ores
  inside its box (REQ-CLR-5).
  Everything else is protected: planks, glass, crafted blocks, containers, beds,
  doors, cobblestone, wool, and the blocks of villages and other structures.
- **REQ-SAFE-2 Exemption.** [I1] A placement-ledger entry (the bot's own
  placement) exempts its position only while the block there is the recorded
  block, so the bot can pick up its own table or furnace and repair its own build;
  an entry whose block is gone or replaced is retired when seen, on a restored
  ledger too. Nothing else is exempt. From S2c the exemption depends on the
  entry's kind (REQ-OWN-2): `own` entries are protected outside an active clear
  box, `building` entries after their build; and inside an active clear box the
  owner's grant exempts the granted positions (REQ-CLR-9).
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
    (`dontMineUnderFallingBlock`, movements.js:284-286) stays on for targets. Its
    entity part sees entities only during a path search (§4.2), so it does not by
    itself keep the bot from digging out the block a player stands on; a dig
    outside a search needs its own occupancy check (REQ-CLR-6). All other blocks,
    which are the path digs, keep the full forced flags.
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
- **REQ-SAFE-7 No automatic discarding** [I1] of anything the item list does
  not make disposable: never an unlisted or `"all"` item, one a live, paused
  or blocked task needs, or worn armour or the offhand; she switches her hand
  off junk before dropping it (S2e-fu, owner ruling 2026-11-12); a bad item
  list turns automatic removal off (REQ-OBT-11).
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
  W1–W3 (main-seat rulings on the doc reviews and cuts), the clear council (the
  clearing, tidy and outage design, revision 6, approved by the owner on
  2026-11-11), or **open** (not decided; see §17).

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
| `work.min_free_slots` | 4 | Below this many free inventory slots she drops the item list's surplus: before a step that needs free slots, and when idle or following (REQ-OBT-11). | W3b (owner); S2e (owner, 2026-11-11) |
| `work.inventory.items` | `0`: rotten_flesh, spider_eye, gravel, leaf_litter, cobbled_deepslate, andesite, diorite, granite, tuff, netherrack, wheat_seeds; `1`: bow, crossbow; `"stack"`: dirt, cobblestone, bone, string, phantom_membrane, arrow, flint, coal; `"slot"`: ominous_bottle, the 16 `<color>_banner`s; `"all"`: gunpowder | Per item name how many she keeps (`0`, a count, `"stack"`, `"slot"` (the best stack's slot) or `"all"`); unlisted items are kept; of a limited item the best stays (REQ-OBT-11). Merged by item name over the defaults; a bad structure, value or name turns automatic removal off, told once (REQ-OBT-11). A new default needs the owner's approval. S2e; bow, crossbow, ominous_bottle and the banners S2e-fu. | W3b (owner); owner (2026-11-11, 2026-11-12); junk council r7 |
| `work.inventory.idle` | true | The idle cleanup (`action:items`) on or off; tasks use the list either way (REQ-OBT-11). S2e. | owner (2026-11-11); junk council r7 |
| `blocked_actions` (settings) | the deployment's existing blocked list (including any `!setMode` block); from S3 plus `!buildStructure` | Commands removed from the model's docs and from execution (REQ-TRN-13, OQ-20). | W3b |
| `work.model_timeout_s` | 600 | OpenAI client timeout (REQ-RES-17). S2b. | clear council; main-seat ruling R7 (2026-11-11) |
| `work.model_max_retries` | 2 | OpenAI client retries of every call except decisions, which pass 0 per request because `promptConvo` retries them: one retry owner per call (REQ-RES-17). S2b. | clear council; main-seat ruling R8 (2026-11-11) |
| `work.model_outage_wait_s` | 600 | How long `promptConvo` waits through an outage (REQ-RES-17). S2b. | clear council |
| `work.model_outage_probe_s` | 60 | Recovery probe interval for an outage-paused goal (REQ-RES-18). S2b. | clear council |
| `work.clear.max_cells` | 32768 | Largest clear box (32 × 32 × 32; REQ-CLR-3). S2c. | owner (2026-11-08) |
| `work.clear.max_distance` | 64 | Farthest clear box (REQ-CLR-3). S2c. | clear council |
| `work.clear.marker_radius` | 32 | Marker search radius (REQ-CLR-2). S2c. | clear council |
| `work.clear.containers` | every item-holding block of the 26.1 registry (56): chest, trapped_chest, the 8 copper chests, barrel, every shulker box, hopper, dispenser, dropper, furnace, blast_furnace, smoker, brewing_stand, crafter, lectern, chiseled_bookshelf, the 12 wood shelves, decorated_pot, jukebox, campfire, soul_campfire, suspicious_sand, suspicious_gravel | Blocks that hold items: kept unless the owner's explicit answer grants them (REQ-CLR-5, 9); a test checks the families against the registry. S2c. | clear council; owner (containers, 2026-11-11 "leave out any chest or container"); main-seat ruling (split) |
| `work.clear.never_remove` | spawner | Blocks a clear always keeps (REQ-CLR-5). S2c. | clear council; main-seat ruling (split) |
| `work.ledger_max` | 2000 | Cap on live `scaffold` entries per world, applied also once after load (REQ-OWN-5). S2c; per world from S2c-fu. | clear council |
| `work.tidy.enabled` | true | Automatic tidy triggers on or off; `!tidy` always works (REQ-OWN-8). S2c. | clear council |
| `work.chat` | quiet | `quiet` (every chat category but `detail`) or `debug` (today's full output); an unknown value is logged once and means quiet (REQ-CHAT-1). Read through `prompter.work_config`, so it exists before `Work`. S2c-fu. | owner (2026-11-11, 2026-11-12); quiet council |
| `work.sleep.when` | always | `always` (she sleeps every night, also mid-task, mid-goal and while following), `idle` (only with nothing to do) or `off` (no new sleeps; the bed pickup still runs); an unknown value is logged once and means always (REQ-SLP-1, 2). There is no `announce` key: the owner lines are `alert`s under `work.chat`. S2d. | owner (2026-11-11); sleep council r3; main-seat ruling (no announce) |
| `work.sleep.max_mode_cuts` | 6 | protective-mode cuts (fights) a night allows before it is done; they are not among the 3 failed tries (REQ-SLP-7); anything but a positive integer means 6. S2d fix wave 1. | main-seat rulings r1 (#3 changed; P14: phantoms every night) |

The four model keys are flat keys of the profile's `work` section, so the
one-level merge never drops one of them; S2b adds them to the defaults in
`work/config.js`. The prompter is built before `Work` (agent.js), so it calls
`loadWorkConfig(profile.work)` itself and hands the timeout and retry count to
the provider it builds (main-seat ruling, OQ-21).
From S2c, `loadWorkConfig` merges object defaults one level deep (`work.clear`,
`work.tidy`, from S2d `work.sleep`), so a profile that sets one sub-key keeps the
other defaults; other values still replace the default whole. From S2e,
`work.inventory` merges `items` by item name (`mergeInventory`) and keeps the
validation result as `inventory.error`. `work.junk_items` and `work.junk_keep`
are retired (S2e): a profile that still sets them gets the usual "ignoring
unknown work setting" log line.

Constants in code (not keys): from S2e (`work/inventory.js` `INVENTORY`; the
look, the wait, the landing and standing still measured by probe P15, PLAN
§4): the 3-block free facing,
look point and drop point, the 2-tick wait after the look, the guard's
3-block radius, 5-minute life and 32 drop points, the 16-block owner radius,
the two re-runs per step, the idle cleanup's 16-block hostile radius and 5 s
quiet, 30 s between passes, 3 s resume gap, 5-minute and 8-block retry of a
pass that removed nothing, 10-minute `!stop` hold, the cap of 4 passes in 10
minutes and its 10-minute hold, and the five kept items named; from S2e-fu
the one-block lip (`lipHeight`, P16), the 5-block walk radius (`walkRadius`;
1 below to 3 above her feet) and the 15 s walk bound (`walkMs`); the resume check's hostile radius 8 (the same as
`self_defense`); the task view cap of 700 characters; the step result cap of 160
characters; the DSL cap of 1,000 characters; the scaffold block (dirt) and the
scaffold reserve (4 per 5-level lift above the first). From S2b: the outage
back-off (5 s doubling to 60 s). From S2c: the clear step's 16 digs per unit and
2 hard failures per cell; the ledger's 2 s write throttle, 2 s scaffold settle
window, 3 s revert window and 10 000-entry log warning; the tidy sweep's reach
(4.5 blocks from the eyes), hostile radius 16, 32 digs and 60 s per sweep, 2 s
pillar-down wait, 5 s task-end launch window, 5 s re-check for up to 60 s after a
mode, and the 60 s window in which a model `!stop` counts as the owner's. From
S2c-fu: the component guard's 64-member limit and its one-tick (50 ms) memo
(REQ-OWN-4). From S2d (`work/sleep.js` `SLEEP`): the night window 12541–23000,
3 tries a night, the 30 s cooldown after a failed try or a mode cut (also
between soft and unreachable pickup retries), the 15 s skip wait, the 6-block spot radius with |dy| ≤ 2 and 3
candidates, the 16-block reuse and pickup radius, the 3 s wake bound, the 10 s
bound on every walk, the 500 ms poll in bed, the 5-block drop radius and 1 s
drop wait, the 5-minute receipt (an item's life), the 2 free slots the
`Work.tick` pickup or collection launch needs and the 1 the pickup itself
needs, and the 2 s watch for a bed after a timed-out placement.

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
| `work.allow_drop_task_surplus` | false | Drop unneeded task pickups (REQ-OBT-11; the chest destination is S2e part B, design r7 §7). | Surv | E1 |
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
(constants), `work.probes_enabled` (no `!probe` command). S2c-fu:
`work.tidy.announce` (the tidy line is a `detail` chat line under `work.chat`;
one switch, REQ-OWN-10); a profile that still sets it gets the usual
"ignoring unknown work setting" log line.

Data tables (not tunables): `work/data/natural_blocks.json` (I1),
`structure_signatures.json` and `biome_priors.json` (I4), `smelting.json` (I5).

## 15. Observability and metrics

- **REQ-OBS-1** [I1] The provider logs one line per request to
  `$MINDCRAFT_RUNTIME_DIR/diagnostics/requests.jsonl`: time, request kind
  (decision / summary / coding / bot_responder / probe, the outage recovery
  probe of REQ-RES-18), prompt, cached and completion
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
- **REQ-OBS-4** [I1] (S2c) The bot log records every placement attempt with its
  source, `by` and position and whether it settled to an entry; every tidy
  sweep's removals and leftovers with their reasons; and one line, with position
  and reason, for each ledger change that is not a placement: the gap marks at
  process start and on chunk unload (counted; from S2c-fu, which replaced the
  forget and the delete), a cap eviction, a retirement and an owner keep
  (REQ-OWN-4, 5, 9). So the S2c trials can count
  the bot's own blocks left behind and why (DECISIONS 2026-11-11; PLAN S2c).
  From S2c-fu every chat line quiet drops is logged as
  `[chat] quiet: dropped (<category>): <line>` (REQ-CHAT-1).

### 15.1 Chat to the owner `[I1]` (S2c-fu)

Owner rulings: DECISIONS 2026-11-11 "After the S2c live trials" ("she talks too
much in chat") and 2026-11-12 "Quiet chat and remembered scaffold". Design:
`runtime/diagnostics/i1-build/quiet-council/recommended-design.md` r4. The
chat rules sit here, beside the log rules, because they decide what the owner
observes; the log keeps everything (the full model responses stay in the
agent log, and every dropped line is logged).

- **REQ-CHAT-1 The switch and the categories.** [I1] One switch,
  `work.chat`: `quiet` (default) or `debug` (§14), a flat key in
  `WORK_DEFAULTS`, read through `agent.prompter.work_config` (built in
  `Agent.start` before `Work`, kept by the panel's Apply) by one helper,
  `work/chat.js` (`chatMode`, `chatShown`); an unknown value is logged once per
  process and means quiet. Every line the bot says has a category; quiet shows
  every category but `detail`, debug shows all (today's output paths). The gate
  is the first line of `agent.openChat(message, category = 'detail')`, so an
  untagged line is `detail`; `routeResponse` passes the category through, and
  the bot-to-bot branch is unchanged. The profile text (§3 of the design)
  applies in both modes, so debug shows less model narration than before.

| Category | Quiet | Lines |
|---|---|---|
| `reply` | shown | a raw owner command's result and "Command … does not exist."; the model's text in every response of an owner turn (with or without a command); its text in a blocked-report turn; a model reply with no command in any turn; the model's next text before a command while the owner's answer is pending (below); the line of every task command (`!taskStart`, `!taskRevise`, `!taskPause`, `!taskResume`, `!taskCancel`) in the owner's turns and blocked-report turns (classified in `work/commands.js` `report()`, which keeps its falsy return); `!tidy`'s answer in an owner turn (REQ-OWN-10) |
| `question` | shown | the work layer's owner questions (REQ-REC-12) |
| `alert` | shown | a failed task; the goal loop giving up (self_prompter.js:141); the model outage notice and its recovery notice; a `markers=` clear's box statement, whoever started the task (REQ-CLR-4); a step blocked a second time (REQ-CHAT-2); her death (REQ-CHAT-2); (S2d) the bed left, lost (also broken by someone else) or kept by a full bag, once per obligation, and once per session the night that did not skip (REQ-SLP-8); (S2e) once per session each: the item list's error, the pass-cap hold and "My bag is full of things I keep: …" (REQ-OBT-11) |
| `done` | shown | the done line of a task the owner asked for (below); the text before `!endGoal` |
| `detail` | dropped | the `*<owner> used X*` echo; command syntax; the model's text before a command in her own turns (self-prompted, system and mode-interrupt turns); task command lines in her own turns; the tidy line; a done report for a task she started herself; the hello line; the public "Restarting."/"Exiting."; mode `say()`; "Shutting up." and "newAction is disabled" (the model relays the returned text); the bot-to-bot mirror; (S2d) the unconfirmed wake (REQ-SLP-8) |

  - *The model's replies.* In quiet a branch around the whole
    `show_command_syntax` dispatch (agent.js) sends only the text before the
    command, never its syntax, with the category from the turn: an owner turn
    or a blocked-report turn → `reply`; the command `!endGoal` → `done`;
    otherwise `detail`. A reply with no command is `reply`. Debug keeps today's
    dispatch.
  - *The turn's voice.* The work layer's `handleMessage` wrap (`guardTurns`)
    stores it on the turn: `owner` when the source is the owner (agent.js's
    own test: not `'system'`, not the bot's name, not another bot; not
    `fromOwner()`, which is true for `'system'` when `only_chat_with` is
    empty), `alert` when the message is the blocked report the work layer
    hands to the model (marked synchronously right before that call and
    consumed at the turn's entry), else `own`. `Work.turnVoice()` is null for
    a finished turn and for the question's own post, so runner code in an
    inherited context never reads a stale `owner`. A blocked-report turn also
    carries whether the blocked task was the owner's (`notify_done`, or the
    legacy judgement below), so a task the model starts in it is his
    (`Work.ownerTurn()`; fix wave 1, G3).
  - *The owner's answer pending* (fix wave 1, G1). While a goal runs, agent.js
    answers an owner message with one response (`max_responses = 1`); when
    that is a bare query, its answer comes in her next, self-prompted turn.
    So an owner turn that began while a goal ran (`self_prompter.isActive()`
    at its start), whose words went to the model (not a raw command, not an
    answer code consumed, REQ-REC-12) and that showed no line leaves
    `Work.answerPending`. The model's next response, in any turn, takes it
    (`Work.takeAnswer`, from `replyCategory`, which the quiet branch calls
    for every response with a command), whether or not it shows text: its
    text before the command, if any, is `reply`. Any shown `reply` line
    clears it too (a reply with no command), as does the end of an owner turn
    that showed one (fix wave 2, A1).
  - *Work-layer lines* go through `deliver(report, { current, category, chat
    = report })`: the report always enters history; its chat text is queued
    only when its category is shown, with no pacing wait for a dropped one;
    `postReport` passes the options through.
  - *The done line.* A task the owner asked for ends with one short line,
    `Task done: "<objective>".` (`done`); a task with a clear step keeps its
    whole done report (anything left must show); debug shows the whole report
    as before; a task she started herself sends its report to history only.
    The record's optional `notify_done` (version unchanged) is set at
    `!taskStart` from the turn's voice (`owner` → true; in a blocked-report
    turn, inherited from the blocked task, G3); an owner's
    `!taskResume` or `!taskRevise` sets it true; a crash resume keeps it. A
    record without it is judged at done time as
    `Boolean(requested_by && !goal)`, with no write-back.
  - *The box statement* of a `markers=` clear is a structured part of the
    start (and revise) result, `result.statement`, sent as its own `alert`
    line; the rest of the line follows the turn; history keeps the whole line.
    A `box=` clear states its box in its question, so its statement stays in
    the line.
  - *Questions are not disarmed by dropped lines:* the `openChat` wrap calls
    `work.onChat()` only for a line that is shown.
  - Owner answer (2026-11-12, Q2): in quiet, a raw long command
    (`!collectBlocks`, `!goToCoordinates`) has no receipt until it ends (the
    echo stays `detail`).
- **REQ-CHAT-2 Alerts that code says.** [I1]
  - *A step blocked a second time.* The record's `blocks_by_step` (step
    ordinal `cursor + 1` → count; optional, version unchanged) counts the
    blocks of `blockStep` (owner questions are not blocks); it is kept through
    a resume, and through a revision of that ordinal whose skill and args are
    unchanged, whatever the order the args are written in (a changed one
    starts again). When a count first reaches 2, code
    sends one `alert` line, "Step N blocked again: <reason>.", besides the
    model's relay of the blocked report.
  - *Her death.* Work's `death` listener sends "I died at x, y, z; my task is
    paused." (or "I died at x, y, z." when no task was active), since the
    model's turn for a death is her own and quiet drops its text.

Targets (measured, not promised):

| Task | Model calls | Today |
|---|---|---|
| Gather or craft | 1 plan + 0–1 validation + 0–1 blocked; typically 1–3 | 20–34 requests per task, 26–30 % summaries |
| Simple shelter from an empty inventory | 2–5 | no completed house |
| Ordinary interruption | 0 | 1+ (AUTO MESSAGE or goal re-prompt) |

## 16. Known limits and residuals

Recorded, not built:

- If tell A ever fails and the dirt-only fallback is in use (REQ-OWN-6), dirt
  placements are not recorded, so a dirt structure the bot builds by code has no
  `own` protection (against the owner's 2026-11-08 ruling for code-placed blocks).

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
  as natural; the approach cell keeps the entrance clear). From S2c the task-end
  sweep removes those within reach.
- The lean tidy version (§11.10) does not cover, by the owner's rulings
  (DECISIONS 2026-11-10, 2026-11-11) or as recorded residuals of its design
  (LOW unless noted):
  - bridges and pillars left behind after travel: they stay until an area clear
    covers them (owner ruling);
  - scaffold out of reach, including free-standing pillars taller than reach;
  - (S2c-fu: scaffold from before a restart or an unload is no longer
    forgotten; it is kept and tidied while it stands free, REQ-OWN-4. The
    walking tidy slice can enumerate these records and rank them by
    `gap_at`.)
  - a crash mid-sweep: the entries not yet dug survive in the file and are
    marked `gap_at` at the restart, so they are tidied while they stand free
    (REQ-OWN-4); on an abrupt stop, a tidy dig of the last 3 s (its revert
    window, `revertMs`) may still be in the file (the exit-flush bullet
    below);
  - water placed by `self_preservation` (bucket use never fires `blockPlaced`);
  - torches from `torch_placing` (off on the deployment);
  - placements by generated code through `bot.activateBlock` (unrecorded, as in
    S2);
  - a same-block refill by the owner within 3 s of a tidy dig is taken for a
    server revert (REQ-OWN-5);
  - the held item changing before the placement packet writes no entry (the safe
    direction);
  - S2c part 2 review round 1: the 60 s sweep bound is checked before each dig,
    not enforced during one, so a slow dig begun just before it ends a little
    later (scaffold digs take seconds);
  - the settle wait's 50 ms margin narrows, not closes, the race between its
    `Date.now()` deadline and the ledger's settle timer: after an event-loop
    stall a block placed just before the sweep may settle only after the wait
    and is not tidied (the safe direction; on the deployment the server's block
    update usually settles it first);
  - occupancy is checked before the dig packet, not during a long hand dig: a
    player who steps onto a block mid-dig can fall (inherited from REQ-CLR-6;
    DECISIONS 2026-11-10, "even one the owner walks on");
  - "0 model calls" for tidying means no decision calls: tidy lines
    enter history and can contribute to memory-summary calls, counted
    separately in the live trials (fewer lines since REQ-OWN-10's as-built
    rule);
  - S2c part 2 review round 2: when two actions interrupt one sweep, the last
    label started wins its remainder decision, and an idle resume
    (`resumeAction`, which bypasses `runAction`) is not recorded; both only
    decide whether a remainder is kept (REQ-OWN-7);
  - after REQ-OWN-9's narrowing, "stop tidying" in words through the MindServer
    helper does not open the 60 s window for a model `!stop` (the helper's raw
    `!stop` still keeps); the live trial of that case uses game chat.
- Quiet chat and remembered scaffold, S2c-fu (design r4 §4, §6, §10; LOW
  unless noted):
  - a same-type replacement with identical surroundings cannot be told apart:
    an owner block of the same type in a cell where her old scaffold was, with
    nothing foreign around, still reads as hers (REQ-OWN-4);
  - a regenerated world with the same seed shares its world id, so her old
    records apply there (REQ-OWN-1);
  - the task record, structures and memory are not per world yet: a world
    switch with an active task would resume it at the old coordinates
    (flagged for the owner, DECISIONS 2026-11-12);
  - text that quiet drops stays in the model's history (the profile puts
    questions in replies with no command; every drop is logged);
  - owner-turn action chains show the text of every response (no "drop i ≥ 1
    after an action" refinement), so a long chain in an owner turn may show a
    few lines;
  - the ledger reads the world id once, at load: a `login` or `respawn`
    packet with another hashed seed later in the same process (a server
    transfer or a configuration-phase re-entry, which Mineflayer handles)
    updates `bot.game.hashedSeed` but not the loaded ledger, which then
    mis-files the new world's placements under the first world's key, where
    they would match other blocks at the same coordinates on return (adversary
    r1 D9). Not reachable on the deployment: every disconnect through ViaProxy
    exits the process and the restart loads again (agent.js `end`/`kicked` →
    `cleanKill`);
  - the exit flush covers `process.exit` and SIGINT (the MindServer stop),
    not SIGTERM, SIGKILL or an out-of-memory kill: such an end loses at most
    the last 2 s of changes (the write throttle), and a tidy dig's removal
    reaches the file only after its 3 s revert window (`revertMs`), so a dig
    of the last 3 s may still be in the file; hygiene at the next start
    retires those cells;
  - a failed unstuck (`modes.js`: `moveAway` not done within 10 s) restarts
    the process through `cleanKill`, and in quiet its "Restarting." is
    `detail`, so the owner sees her stop and come back with no word (the
    design keeps it `detail`; the pathfinder's futility guard removes the
    known pit path into it);
  - the owner's answer pending (REQ-CHAT-1) lasts one model response: when
    her next response is a bare command, the answer is not shown at all, and
    when its text is unrelated narration, that one line is shown as his
    answer; two overlapping owner turns set it last-writer-wins at their
    ends; an empty response or an unknown command does not consume it, so it
    waits for the next response with a known command (at most one extra line
    shown; S2c-fu final review, ruled a residual);
  - a model `!tidy` in an owner turn writes its tidy line to history twice
    (chat shows it once);
  - a version-1 file met in an unknown world is left as it is, and stations
    from an S2 task record migrated in an unknown world live in memory only
    (the record's `placements` key is still removed); neither happens on the
    deployment, whose ledger is already a file and whose server sends a seed.
- The pit escape, S2c-fu amendment 1 (the pathfinder carry places a tower
  block only once her feet clear the cell, and resets a tower she cannot
  clear, at once when she stands in its reference cell, else after 3.5 s,
  CHANGES.md; live confirm round in the private
  `i1-build/s2cfu-review/pit-probe-report.md`). The fault is narrowed, not
  closed: one refusal was seen after the placement fix with her feet clear of
  the cell (cause unknown):
  - a `GoalNear` of range 2–3 (`goToPosition`'s default 2, `work/dig.js`'s
    approach 3) is already met from inside a pit one or two blocks below its
    rim, so she may stop standing on her own tower inside the pit (seen live
    at ranges 2 and 3); the fix is the callers' (a standable goal cell with
    range 0–1, or a reach check that walks on), not the pathfinder's;
  - once seen live: an 18 s jump in place after a refused tower placement,
    with no further attempt, ended by the unstuck mode. Hypothesis, not
    logged: a path reset in mid-air plans from her floored mid-air cell a
    tower block she can never clear, and the jump-placement branch returned
    before the 3.5 s `lastNodeTime` stuck check. The carry now resets such a
    plan in the jump-placement branch (`resetPath('stuck')`): at once when
    she stands on the ground with her feet in the reference cell, so the
    replan starts from the ground, and else on that 3.5 s check (honey,
    cobweb); that it escapes is a live check.
    The probe that settles the cause (a clean 4-deep, 1-wide pit at range 2,
    several runs, logging `path_reset` and `path_update`'s `toPlace`) is in
    that report.
- The clear step and the ledger, S2c review round 1 (LOW unless noted):
  - the tell A guard (REQ-OWN-6) is a text-order check of the installed
    pathfinder source: it catches the predicted write removed, renamed or
    reordered, not a write made conditional or dead; a behavioural guard
    (driving the pathfinder against a placeBlock spy) is later debt;
  - while the task is blocked on a clear question (or paused), the kept layer
    has no protection: REQ-CLR-5 scopes it to the active clear step, and
    natural blocks are unprotected outside it anyway;
  - an owner block placed in a cell the pathfinder just failed to fill, of the
    same block, within the ~2 s merge window, settles as the bot's `scaffold`;
  - `protected` is one dig refusal reason for every protection kind (kept
    layer, kept container, never removed, the owner's build); part 2's tidy
    sweep and S3 may want them apart;
  - a failed ledger write (for example ENOSPC) can leave its temp file behind;
  - the open question cannot be answered while a model-started action runs
    (MED-LOW, the safe direction): the turn that disarmed it ends only when
    `handleMessage` returns, which awaits `executeCommand` and so the whole
    action (`runAsAction`; `!followPlayer` runs until stopped). Until then
    every owner yes goes to the model and the question stays open; it is
    posted again when the action ends (the owner can ask the model to stop
    the action, or wait). An owner `!stop` does not bring it back: it cancels
    the clear task (`cancelled(stop)`, REQ-SAFE-11). Not an ordering bug of
    the interception: re-posting before the turn ends would contradict the
    disarm rule (REQ-REC-12);
  - if renaming an unreadable ledger aside fails (the runtime folder not
    writable at start) and a later write succeeds, that write replaces the
    unreadable file (needs the folder unwritable at start and writable later,
    which does not happen on the deployment);
  - every re-post of an open question adds the whole question to the model's
    history again, so a long question re-posted often brings summaries forward;
  - red sand and concrete powder are not falling blocks to the pathfinder
    (movements.js:64-66; only suspicious sand and gravel are added): a clear
    never keeps them, so they fall rather than being lost; part 2's tidy sweep
    is not affected (its top-down rule keeps any candidate under a solid block);
  - a clear waiting in another dimension retries on every idle (about once a
    second in production, a task.json reload and save each) until it is back
    or the stall rule blocks it; with the test fixture's 20 ms idle delay the
    upstream fast-loop guard (action_manager.js:76-87) cancels the resume and
    the self-heal tick restarts it;
  - owner output is paced through one queue, but model replies bypass it, so a
    reply can land about 50 ms after a question line; a report waits behind a
    long question (about 1 s per line); each queued report line before a
    re-post adds another copy of the question to history (the re-post note
    above); no test covers the stop-at-shutdown check of a queued line.
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
- Until S2c, pathfinder pillars get no ledger kind, and task-time ones are
  recorded as `air` entries that never match, so they stay protected (ISSUES,
  cube analysis item 17). S2c records them as `scaffold` (REQ-OWN-3).
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
- Inventory upkeep (REQ-OBT-11, S2e; design r7 §10 and the build):
  - items she dropped can be picked up again on contact when a later path
    crosses the pile (server-side); the next pass drops them again;
  - a full bag during a goal waits until the goal ends (the cleanup needs the
    goal stopped);
  - a follow is cut for a second or two per pass;
  - a deliberate gift on the 0 list is dropped at the next pass when she is
    nearly full (cure: `"all"` or a count for it);
  - the guard is approximate: 32 drop points, 3 blocks, 5 minutes; an item
    that rolls more than 3 blocks from its drop point is not skipped by
    `pickupNearbyItems`;
  - probe P15 measured the landing on flat ground only: a step ahead
    shortens it (2.38 blocks onto a one-block step; the facing rule excludes
    that direction); an obstacle within 3 blocks and the guard against
    `pickupNearbyItems` are unproven live (the S2e trials ran the one-slot
    `bot.transfer` path through ViaProxy);
  - a model-issued `!stop` during a pass ends it but does not hold the
    cleanup (only the owner's raw `!stop` holds it, 10 minutes); the hold
    arms only while a pass runs (well under a second), so it is nearly
    unreachable (S2e review ruling 3, as contracted);
  - in a 1×1 pit she throws over a one-block lip, and deeper or in a stair
    tunnel she walks to the nearest drop spot (S2e-fu); with no spot within 5
    blocks and 1 down to 3 up (a deep shaft, a long tunnel) the in-task drop
    still fails and the step blocks "inventory full (no free direction
    nearby)" (design r7 §3, S2e-fu §2);
  - the lip is allowed only where it starts at distance 1; live, only a lip at
    distance 1 was probed (P16). In the review r2 toss simulation every
    allowed feet-row shape landed 1.57 blocks out or more (lip/lip/lip
    1.57–3.34, lip/lip/open and lip/open/open 1.57–4.02); the blocked
    open-then-lip case landed 1.17–1.37 out, inside reach, and lip/open/lip
    is blocked though it would have been safe (1.57–3.34);
  - indoors, with no direction free, she may walk a block or two inside a
    small room and throw across its floor (S2e already throws onto any free
    floor in front of her; review r1, D4);
  - `never` in `findDropSpot` is unreached in production (a follow does not
    walk); kept, harmless (review r1, D5);
  - curse enchantments count toward worth like any other level, so a cursed
    bow can outrank a fresh plain one (review r1, D9);
  - test holes, not built (review r1, D6): the walk timer's `clearTimeout`,
    the empty-plan key, the radius shape (Euclidean), `never` in the spot's
    facing, and the vertical lower bound (−1) are not pinned by a mutant-killing
    test;
  - the fixture's collect leaves her inside a log column, so one existing
    test now walks onto a canopy; whether collectBlock does that live is for
    the live trials (review r1, C26);
  - a drop spot is chosen by the cells only, not by a path: a task walk may
    tower or scaffold up to 3 blocks (tidied at task end); an idle walk places
    nothing, so from a pit two deep or more it cannot reach the rim, fails and
    holds ("no free direction nearby") until she moves, the bag changes or 5
    minutes pass, and the retry fails the same way; a walk that ends off the
    spot drops nothing and leaves her where she stopped; an owner message during
    the walk (up to 15 s) is seen only after it; a `!stop` interrupts it;
  - enchantments on this version are unprobed live (P16 had no enchanted
    item): the best-kept order reads prismarine-item's `enchants`, and an
    unreadable list counts as none (durability then decides);
  - the ominous bottle's amplifier was read offline through the 26.1 codec,
    not live through ViaProxy;
  - a banner's "best" is its largest stack: patterns are not ranked, so a
    single patterned banner beside a larger plain stack goes (the owner was
    told; left as is, his call);
  - a server pickup refilling the one source slot during a partial transfer
    can swap with a foreign item and toss it (needs a pickup in the same
    tick); the cursor is checked before each transfer, not inside
    Mineflayer's (S2e review, adversary gap 4; LOW);
  - an exception from the needed items inside the admission is logged every
    second (S2e review, adversary gap 5; LOW);
  - the "full of things I keep" note and the inventory-full report count
    every slot `getInventoryCounts` counts, armour included;
  - an open container or a stuck cursor is found only inside the pass: it ends
    `unavailable` and holds, `!itemList` then says "nothing to drop from here",
    and a task step blocks "inventory full" (S2e review r2, adversary N2; LOW);
  - the no-progress hold (also set when no direction is free, or a follow's
    target stands on her) lifts on an inventory change, her own move > 8
    blocks or 5 minutes, not on a world change (a door opened): a free
    direction can wait up to 5 minutes (S2e review r3, adversary; LOW);
  - untested paths: the follow target moving during the cut (the facing re-read
    at entry), the runner's owner-avoid wiring, an obstacle in the eye row on a
    path floor (adversary N4; LOW).
- Model outages (REQ-RES-17/18, S2b review rulings 2026-11-11; LOW unless
  noted):
  - a backend that is alive but slower than `work.model_timeout_s` (600) on a
    decision flaps: the decision times out, the goal pauses, the quick probe
    "recovers" it, and the same long decision times out again (one notice pair
    per cycle);
  - the probe uses the profile's request params (for example its `max_tokens`
    and reasoning budget), so on a reasoning model it may take a while; that
    only delays the recovery by its own duration;
  - `!stfu` during an outage: on recovery the goal runs three empty turns
    (`shut_up` still on) and stops, as upstream does with any paused goal;
  - the outage notices go through `openChat` and so ignore `!stfu`;
  - a response whose body fails to read after its headers is no
    `APIConnectionError`, so it still gives gpt.js's "My brain disconnected";
  - a decision that started before the wait ran out and succeeds after it is
    used: the model is back;
  - a waiting turn woken by a recovery retries even at or after its deadline:
    the wake means another call has just succeeded, so the retry is the
    productive path (ruling W5 of the confirm round, 2026-11-11);
  - a provider with no client timeout whose request never returns keeps its
    turn registered for good, so the recovery probe never resumes the goal (the
    OpenAI-client providers time out at `work.model_timeout_s`);
  - on a backend that accepts connections and never answers, a coding,
    summary, bot_responder or probe call can take up to 3 × 600 s (the client's
    retries), so recovery can be noticed up to that late; a decision takes
    600 s per attempt, so a goal pauses only after about 20 minutes;
  - `start()` supersedes a turn in flight by setting `most_recent_msg_time` to
    `Date.now()`, which has millisecond resolution: a turn that began in the
    same millisecond is not superseded;
  - system messages (a blocked-step report, the death and restart messages)
    count as self-prompted turns, so one that a goal turn supersedes during an
    outage can pause a goal whose own turn succeeded (one 60 s pause and a
    notice pair; final-confirm ruling 2026-11-11);
  - the goal loop waits only behind a turn whose outage wait has begun: an
    owner's first request still in flight can be superseded by the next goal
    turn, as upstream does outside an outage; and a retry admitted just before
    the deadline can cross it during cooldown or prompt preparation;
  - while an owner turn retries after a recovery, the goal stays paused until
    the next probe interval (up to `work.model_outage_probe_s`);
  - while a goal is outage-paused, a mode that interrupts an action (for
    example cowardice cutting into self_defense) can start upstream's
    `(AUTO MESSAGE)` reprompt turn; it waits through the outage and is answered
    first at recovery, and the goal resumes up to one probe interval later
    (live-fix review, 2026-11-11).
- Sleeping through the night (§7.9, S2d; design r3 §12 and the council's
  residuals; LOW unless noted):
  - the night record and the collection receipt are in memory: a crash restart
    in the same night may try again, and a crash between the pickup dig and the
    pickup loses the drop (it despawns after 5 minutes);
  - a crash between the server placing the bed and the client seeing it leaves
    an unrecorded bed, protected like any non-natural block (a placement
    answered late without a crash is adopted, REQ-SLP-3);
  - a wake not confirmed within 3 s: the next action may stall until the server
    wakes her, and if the stop watchdog fires the crash restart is what wakes
    her (P14 has not measured `bot.wake()` yet);
  - with a goal ACTIVE and an endless follow she never sleeps (upstream does
    not resume a follow while a goal is ACTIVE, so sleep waits it out);
  - there is no command to get her up and go on with the task: any instruction
    that starts an action does it; `!stop` cancels the task;
  - her respawn point moves to the bed and picking the bed up clears it
    (accepted by the owner, design OQ-3; matters only once damage is on);
  - after a `!stop` she takes the bed back without a line (the owner lines
    cover only problems, OQ-4);
  - a server that reverts the pickup dig (within the ledger's 3 s window) can
    make her report a lost bed while the bed stands again; the next tick takes
    it as hers again;
  - a server wake that arrives before the time update that ends the night is
    counted as an early wake (a failed try); the next tick sees the morning;
  - with fewer than 2 free slots (by day) or no free slot (inside the
    routine) the bed stays placed until space frees: the item cleanup that
    would free it is S2e;
  - (review r1, LOW) someone standing on her bed by day makes `Work.tick` cut
    a running task every 30 s (each time she walks up to 16 blocks, refuses and
    the run walks back to `work_pos`); no stall time is charged, but throughput
    drops while it lasts (an unreachable bed waits for idle, REQ-SLP-5);
  - (review r2, LOW) a reverted pickup dig can say "I lost my bed" twice: the
    receipt is lost and told, the entry revives, and if that bed later breaks
    it is told again;
  - (review r2, LOW) a crash right after a pickup, before the ledger drops the
    entry (the revert window and the write throttle), makes the restart see
    air and say "I lost my bed at …" while the bed is in her bag;
  - (review r1, LOW) with a bed in the bag and a placed bed of hers that fails
    re-validation for a lasting reason (water beside it), the placed bed wins
    every try: she spends the tries and the night instead of placing the bed she
    carries (moot with one bed, the usual case);
  - (review r1, LOW) "I left my bed at x, y, z." means two states: a bed no
    longer hers (a hard refusal) and a bed kept as an obligation (beyond 16 or
    unreachable for now); the owner cannot tell which;
  - (review r1, LOW) `othersIn` counts arrows and other non-blocking entities
    as occupants (over-strict: a spot or a pickup is refused or retried);
  - (review r1, LOW) a catalog `!buildStructure` cut by sleep has no blueprint
    check: the bed may land in its unbuilt footprint (S3 adds the footprint
    check);
  - (review r1, LOW) untested by the offline suite (the code reads correctly):
    the dimension and window re-check before `bot.sleep`, the unstuck pause,
    and the walks' behaviour against a real pathfinder (the fixture teleports;
    the no-dig movements and the 10 s bound are asserted);
  - left out by design §12: making a bed, beds already in the world (upstream
    `!goToBed` stays for those, with its `!stop` defect in ISSUES), fetching a
    bed left far away (the owner is told), daytime thunderstorms, restoring the
    respawn point.
- `!newAction` (generated code) is outside the task layer and refused while a
  task is non-terminal (REQ-RES-9); C08,
  C10, C14 and C17 limits remain on the text path.
- `MemoryBank` stored no dimension before the persisted backing (fixed in I4).
- Deferred, each behind a seam (PLAN §8): levelling and site-hunting, the
  complete scaffold record and cleanup (a later slice, PLAN §8), furniture and
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
| OQ-12 | (closed by W1: the owner-question contract, REQ-REC-12; deferred to the survival iteration by W3; its core brought into I1 for the clear step by the owner's approval of the clear design, 2026-11-11.) | — |
| OQ-13 | (closed by W3: one 120 s no-progress deadline covers craft calls, REQ-RES-5.) | — |
| OQ-14 | (closed by E1.2: night costs no model call under either policy, so no sleep decision exists in v1. S2d sleeps by code, still with no decision call, §7.9.) | — |
| OQ-15 | (closed by W1: the ledger persists in the task record, REQ-BLD-22; W3 kinds `permanent` and `station`, `scaffold` from I3. Superseded from S2c: its own file with kinds `station`, `scaffold`, `building` and `own`, REQ-OWN-1, 2.) | — |
| OQ-16 | Plan quality of the quantized Qwen with the text DSL (I1) and the typed schema (I2); whether DX arm A (parts only) meets the bar. | S2/S3 trials, I2 trials, DX |
| OQ-17 | Which entity types `mc.isHostile` (utils/mcdata.js:113-116) classifies as hostile on the deployed version; the resume check and `self_defense` rely on it. P11 ran: `allay` and `copper_golem` were classified hostile and are now excluded (§5.3); `hoglin`, which the function misses, is Nether-only and left as is. | S0-lite, probe P11 |
| OQ-18 | Is a request gate between summaries and decisions needed on the single backend? | I2 (S4 measurement) |
| OQ-19 | Is `descend_to` ever needed as a plan step, or only inside `obtain`? | Survival iteration |
| OQ-20 | Which raw commands to block through `blocked_actions` beyond the I1 default (`!buildStructure`, from S3); `!collectBlocks` and `!craftRecipe` stay available for one-off requests (REQ-TRN-13). Blocking also removes them from the owner's typed commands. Also an open owner question: whether to block `!newAction` outright in I1 rather than guard it during tasks (REQ-RES-9). | S2/S3 trials: decide if Qwen bypasses `!taskStart` or `!build` |
| OQ-21 | (closed by main-seat ruling, 2026-11-11: the four model keys live in the profile's `work` section, REQ-RES-17/18 and §14; the "foreground window" is `promptConvo`'s outage wait of up to `work.model_outage_wait_s`, after which the self-prompter pauses with the `outage` flag and the recovery probe starts.) | — |
| OQ-22 | (closed by main-seat rulings, 2026-11-11: the `box=` start question and a no that cancels with nothing dug, REQ-CLR-4; the marker-count error, REQ-CLR-3; `!blockPositions` range 1–64, REQ-TRN-16; a `!buildStructure` placement counts as built when that action returns, REQ-OWN-2; `crafting_table` stays off `never_remove`, so a placed table in a box goes to the leftovers question and the bot's own `station` table is taken back; `max_distance` is measured from the frozen anchor to the nearest cell of the box, REQ-CLR-3; ores in a box count as natural and are dug.) | — |

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
| Clear an area | only when the owner asks: the `clear` step, box from markers or coordinates, top-down, one owner question for leftovers and containers (§11.9) | I1 (S2c) | — |
| Level an area, find a flat site | not done unless asked | — | deferred (PLAN §8) |
| The bot's own scaffold (pillars, bridges, fight blocks) | recorded as `scaffold`; removed within reach after a fight, at task end and on `!tidy` (§11.10) | I1 (S2c) | out-of-reach scaffold and travel bridges: a later slice (PLAN §8) |
| Model backend unreachable | tasks keep running; decisions wait with back-off; the goal pauses and resumes; one notice each way (§7.8) | I1 (S2b) | — |
| Water, lava | avoided; liquid checks; lava in `blocksToAvoid` | I1, I5 | underwater targets (I5), lava turn (Surv), buckets deferred |
| Falling sand/gravel | `safeToBreak` falling-block check; builder re-dig | I1 | staircase checks (Surv) |
| Torches | `torch_placing` mode | I5 | tunnel torches with `descend_to` (Surv) |
| Ladders | ladder cells, auto-ladder access | I3 | — |
| Entrances and doors | open 1×2 entrance (`minimal`); door with yaw and facing check (`basic`); approach cell; opened by pathfinder | I1 | — |
| Beds | owner's `!goToBed` text command only; in designs replaced by full blocks | — | yaw-dependent blocks |
| Crafting table, furnace | resolver places and picks up its own; carried forward as `station` entries whenever a new task replaces the record (REQ-BLD-22); from S2c kept as `station` entries in the placements ledger (REQ-OWN-1) | I1, I5 | — |
| Chests | `!putInChest`/`!takeFromChest` (text in I1, tools from I2) | I1 | authorised deposit chest (Surv) |
| Full inventory | the item list's surplus dropped with no model call, in a task and when idle or following (S2e), over a one-block lip or after a short walk out of a pit (S2e-fu); else a task blocks naming the five largest items (or "full of things I keep") and asks the owner | I1 | chest destination (S2e part B) |
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
| Owner answers a bot question | intercepted before the model; one history line (REQ-REC-12) | I1 (S2c: the clear step's questions) | the other consumers (Surv) |
| Farming, fishing | — | — | deferred methods |
| Nether, End, strongholds, oceans | outside v1; unknown targets refused, searches end honestly | I4 | deferred |
| `/locate`, explorer maps | — | — | `/locate` (Surv); explorer maps deferred |
| Death | `paused(died)`, one model call | I1 | — |
| Night | work and fight through (`continue`) | I1 | `shelter` policy: code dig-in and time resume, no model call (Surv) |
