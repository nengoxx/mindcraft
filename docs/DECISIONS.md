# Decisions

Owner rulings for this fork, newest last. Append-only: a later entry supersedes an
earlier one by saying so. Design rationale lives in [SPEC.md](SPEC.md) and
[PLAN.md](PLAN.md); history in [CHANGES.md](CHANGES.md) and [ISSUES.md](ISSUES.md).

## 2026-11-08 — Mindcraft is the base

The owner compared this fork with two other client-side frameworks: a Pi-SDK
Mineflayer harness and an AltoClef-based client. This fork is the base going
forward because its in-game behaviour (combat, gathering, crafting) worked
best. The other two are kept outside this repository: the Pi harness is parked,
and AltoClef is paused for a separate future project.

## 2026-11-08 — This repository is self-contained

Everything about this fork's development lives here: specification, plan,
decisions, issues, changes and handoff. An outside umbrella record may compare
frameworks and point here, but it is not required to build, run or understand
this fork. Tracked docs contain no machine-specific hosts, accounts or private
paths; those stay in the ignored `runtime/`.

## 2026-11-08 — Task layer design approved; no Pi

The owner approved the task-layer design, reached by a design council
(three blind proposals, an independent review and an adversarial review).

- The layer is our own module inside Mindcraft (`src/agent/work/`), connected
  through a few small hooks.
- It does not use the Pi agent SDK, embedded or as an external process.
  Mindcraft already has the model-to-tool loop Pi would provide; what is
  missing (task memory, resume, building skills) Pi does not provide either.
- Two triggers reopen the Pi question: our own transport/loop code growing past
  about 400 lines, or upstream adopting an SDK-based loop.
- Native tool calls come from a provider file and a copy of upstream PR #769's
  adapter, which retires if #769 merges.
- Build order S0–S4 as in PLAN.md.

## 2026-11-08 — Building fits the terrain

Build where asked and adapt to the terrain. Keep trees and natural ground
wherever they don't block the structure's function.

- A hut among trees, a cave, or a house dug into a hill are all valid results.
- Clearing, levelling and site-hunting are separate tasks, done only when asked.
- Acceptance is functional, not geometric.

## 2026-11-08 — Open-ended requests

The owner asks in natural language: "a small house here", a hut, a cave, a base,
a tower, and so on. There is no fixed short list. The system must handle that
flexibility reliably.

The same goes for resources and finding things:

- locate and gather any base-game material (wood, ores and the rest), crafting
  alongside gathering;
- find mobs, animals and villagers;
- find structures by exploring.

Vanilla limits apply. A client cannot ask the server where structures are.

## 2026-11-08 — Live testing etiquette

The game server shuts itself down after about five minutes with no player
connected, and the owner has to start it by hand.

- Keep the bot connected between tests and while implementing. Use agent-only
  restarts (quick rejoin) rather than a full stop.
- If the bot drops anyway, for example because the server kicked it for being
  AFK, tell the owner so he can start the server again.
- Never leave the bot disconnected on purpose for longer than a few minutes.

## 2026-11-08 — Iterations and simplification

This supersedes "Build order S0–S4 as in PLAN.md" in the entry "Task layer design
approved; no Pi". Native tool calls move to the second iteration. The order is
PLAN.md §1.

The owner's rule for cuts: reuse or defer, never drop a discussed feature. A
feature either reuses an existing upstream, Mindcraft or Mineflayer mechanism that
really delivers it, or is deferred to a named later iteration and kept in SPEC.md
with its requirement. Only internal machinery that delivers nothing the owner can
see may be cut.

- **Iteration 1, usable for play:** planning, gathering and crafting, combat then
  back to the task, and a simple terrain-fitting shelter, driven by Mindcraft's
  text commands.
- **Deferred, by iteration:**
  - Iteration 2: native tool calls and measuring summary-versus-decision load.
  - Iteration 3: Qwen's own designs, the design library, offline design, and owner
    templates.
  - Iteration 4: exploring beyond the loaded area and remembering places.
  - Iteration 5: mining underground and smelting, including wider smelting
    coverage.
  - Survival iteration, for when damage is turned back on: the night shelter
    mode, health and food gates, auto-deposit to a chest, asking the owner before
    long builds or longer searches, `/locate`, and a careful underground
    staircase.
  - Every other deferral is named too: the enclosure check and layer rows go
    with iteration 3; the background chunk indexer, biome priors, a fuller
    discovery database and the rarer structure checks with iteration 4.
- **Smelting reuses the nearest furnace:** the bot may use any nearby furnace
  whose slots are empty, never breaks it, and takes back only what it put in.
- **Junk drop in iteration 1:** when the inventory is nearly full, the bot may
  drop common junk (dirt, cobblestone, gravel and similar stone, seeds, rotten
  flesh), keeping a stack of dirt and cobblestone and anything the task needs. It
  never discards anything else.

## 2026-11-08 — Generated code and friendly mobs in iteration 1

- **Generated code (OQ-20):** `!newAction` is not blocked outright in iteration 1.
  It is refused only while a task is running, as REQ-RES-9 specifies; the trials
  show whether Qwen uses it to bypass the task commands.
- **Friendly mobs:** allays and golems are not hostile. Probe P11 showed the
  hostile check treating allays and copper golems as hostile; they are added to
  the existing exclusion beside iron and snow golems (the owner's base has several
  iron golems).

## 2026-11-08 — Clearing an area and the bot's own blocks

After the cube-clearing trials and a design council (working files in the
private diagnostics folder; summary in [ISSUES.md](ISSUES.md), cube analysis):

- Clearing an area is its own capability, not part of building a shelter; the
  owner usually clears an area to build something there later.
- A box given by marker blocks is stated to the owner and cleared at once (he
  can stop it); a box given by coordinates is stated and waits for his yes.
- Blocks the bot placed to move or fight (pathfinder pillars, bridges, blocks
  for getting up to fight) are not protected, and should not be left behind as
  clutter. Blocks it placed with code or commands may be a building it made and
  stay protected outside a box the owner asked to clear.
- Containers stay, also inside a box being cleared, unless the owner says
  otherwise.
- The size limit for one clear is 32 × 32 × 32 cells (32 768), as configuration;
  the owner wants no tight limit.

## 2026-11-10 — Tidying the bot's own scaffold blocks

After a small council on the clutter ask (main seat, Opus, Sol blind; Opus
adversary) and a live probe of pathfinder placements (private diagnostics,
`clear-council/clutter/`):

- Lean version first: the bot removes its recorded scaffold blocks that it can
  reach without walking, right after a fight ends and when a task ends, plus the
  same sweep as a command. No walking idle sweep for now; it can be added later
  on the same sweep without a rewrite. Bridges left behind after travel stay
  until an area clear covers them.
- If the owner stops a tidy mid-way, the blocks not yet removed stay for good.
- Any pillar or bridge the bot made may be removed, even one the owner walks on;
  he keeps one by replacing a block with a different type.
- One short line when it tidies, switchable in configuration (the owner finds
  the bot verbose in general; to review later).
- Scaffold records from before a restart, or from while the bot was away
  (chunk unloaded), are not tidied automatically; an explicit area clear can
  still remove them.

## 2026-11-11 — Clearing design approved; full scaffold record later

- The clearing and tidy design (revision 6 of the council's recommended design)
  is approved as the lean version. Scaffold records from before a restart are
  forgotten, not kept as built on purpose: an old cobblestone pillar is then
  protected like any non-natural block and an old dirt pillar counts as natural.
- The more complete version (record every block the bot puts down and also
  remove scaffold out of reach, walking to it) is its own slice in a later
  iteration.
- The lean version must be shown to work: the live trials count the bot's own
  blocks left behind. If many are left, that later slice moves up the priority
  list.

## 2026-11-11 — Sleeping through the night (slice S2d)

- She sleeps every night by default, also mid-task, mid-goal and while following;
  a config switch limits it to idle time or turns it off. The resume after sleep
  must be solid.
- She places a bed from her inventory near her only to sleep and picks it up
  again straight after. With no bed she carries on as now; making a bed is later.
- On the owner's server one sleeper skips the night for everyone, which is part of why
  he wants it (seen live on 2026-11-11: the night skipped about 3 s after she lay
  down). Her respawn point moving to the bed is accepted. Chat stays quiet unless
  something needs the owner.
- Design: `runtime/diagnostics/i1-build/sleep-council/recommended-design.md`
  (revision 3 and its §14), amended by the inventory design below: the bed pickup
  needs 2 free slots, and a resumed action keeps its original timeout.

## 2026-11-11 — Inventory upkeep (slice S2e, after S2d)

- One item list in her config gives each item a keep count: 0 (junk, dropped),
  a number or one stack (the rest dropped), or all. Anything not listed is kept.
  It replaces `work.junk_items` and `work.junk_keep`; tasks use the same list.
- Defaults: 0 for rotten flesh, spider eye, gravel, leaf litter and the earlier
  stone and seed junk; one stack for dirt, cobblestone, bone, string, phantom
  membrane, arrow, flint and coal; all for gunpowder.
- She drops the surplus by herself, with no model call, when she has fewer than
  4 free slots and is idle or following the owner ("she can drop things while it's
  following"); never during fights, tasks or a goal.
- A chest instead of dropping is designed but waits until dropping has been
  refined ("chest can wait for later after we refined the dropping the items").
- Design: `runtime/diagnostics/i1-build/junk-council/recommended-design.md`
  (revision 7, with the owner's answers in §11).

## 2026-11-11 — After the S2c live trials

The owner's answers to the trial findings (ISSUES.md "S2c live trials, 2026-11-11 night"):

- Her scaffold records should survive a restart, "if it's not too cumbersome".
  This reverses the "forgotten at restart" part of the two rulings above; the how
  (and whether it also covers chunk unloads) still needs a short design pass.
- Walking back to tidy scaffold out of reach stays the later slice: "I want the
  slice to be clear, but it's not a priority for this iteration."
- Pits: "she should be able to climb back, right?" Getting stuck in a 1-wide pit
  is a bug to fix, not a limit to accept.
- Chat: "she talks too much in chat". Most of what she says on her own should be
  off by default and switchable on for debugging; on her own she only speaks
  about important things.

## 2026-11-12 — Quiet chat and remembered scaffold (S2c follow-up)

After a council (main seat, Opus, Sol blind; Opus adversary; a Sol review and two waves; design
`runtime/diagnostics/i1-build/quiet-council/recommended-design.md` r4):

- One switch, `work.chat`: quiet by default, debug brings back today's output. In quiet she speaks when
  the owner speaks to her (her answers in that turn), when she needs an answer, when a task fails or a step is stuck
  a second time, when she dies, before clearing a marked box (its corners), with one short "done" for a task he
  asked for, at the end of a goal, and in answer to a command he typed. Her own narration, task-start and tidy
  lines, the command echo and the public "Restarting." go quiet. `work.tidy.announce` is retired.
- Her scaffold records survive restarts, crashes and leaving an area. An old block counts as hers only while
  nothing non-natural she did not place touches its pillar or bridge; then she may remove it by herself as before
  ("let's go with your suggestion"). This replaces the "not tidied automatically" rule of 2026-11-10.
- No receipt for a long command he types in quiet ("We don't want too much verbosity when it's not needed").
- "Ideally, she should be able to work in different worlds": her block records are kept per world (by the
  world's hashed seed). Task records, structures and memory are not per world yet.

## 2026-11-12 — After the S2e live trials (follow-up slice S2e-fu)

The owner ruled on the three findings of the S2e trials (ISSUES "S2e live trials").

- **Junk in her hand (F4).** Junk in the selected hotbar slot is junk like any other: she
  switches her hand off it and drops it.
- **The pit (F2).** When she stands one block deep, she throws over the one-block lip, as a
  player can. If that proves impractical for the bot, or the pit is deeper, she walks to the
  nearest open spot within a few blocks and drops there. Throwing over the lip may move to its
  own slice if it turns out complicated.
- **Kept items (F3).** The owner does not name items to drop: the list decides. When everything
  left is on her keep list and the bag is still full, the report says so and she tells the
  owner; the model does not pick kept items to discard. The owner's "throw this too" stays a
  one-off drop; adding the item to her list from chat is a possible later feature.
- **The list itself** should be revised so a bag full of kept items practically never happens.
- **List revision, first rulings.** Banners and ominous bottles: keep one stack (one slot,
  whatever the stack size). Bows and crossbows join the list: keep the best one of each and
  drop plain spares (common loot); arrows stay at one stack. These kept weapons and arrows are
  for the owner (she fights with melee) and may be thrown when there is no space at all.
- **No "throw if no space" tier** (supersedes the last sentence above). The kept weapons and
  arrows are plainly kept: no new list kind. When the bag is full of kept items and she needs to
  collect something, the answer is S2e part B, putting things in a chest, not throwing them. Part
  B stays parked until the owner's word; this need goes with it.
- **Best one, period.** Of bows and of crossbows she keeps exactly one, the best; every other
  one is dropped, enchanted or not.
