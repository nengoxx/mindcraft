# Handoff

## 2026-11-12 (afternoon, closing) — S2e deployed and trialled; three design questions open

- **First in the next session: the owner answers three questions** from the S2e live trials (ISSUES "S2e live
  trials", report `runtime/diagnostics/i1-build/s2e-review/live-trials-report.md`). The main seat's
  recommendations, not yet ruled:
  - F2, the pit: gathering dirt leaves her 1 deep, walled in, with no free direction, so no drop runs (a task step
    blocks; idle waits until she moves). Recommended: when no direction is free, walk to the nearest spot within a
    few blocks that has one, then drop. It changes r7's "stand still" rule.
  - F3, the model discarded a kept stack: the "inventory full" report lists her largest stacks and the model ran
    `!discard("dirt", 64)`. Recommended: the report says everything left is on her keep list and she asks the owner
    what to drop. The alternative (refuse a model `!discard` of kept items) would also limit the owner's own command.
  - F4, junk in the selected hotbar slot is never dropped. Recommended: select a tool or an empty slot first.
  If he agrees, they make one small follow-up slice (design note, build, Sol + adversary review, trials). Then he
  decides whether to start the S3 design check (re-check PLAN S3 against today's code through a council).
- Done today: S2d F1/F2 (`65fce4a`, `33a0c5d`); S2e part A merged `0da559e` (three review rounds, closed; residuals
  in SPEC §16); the trial-found runner fix `6362eaf` (a met step no longer blocks on a full bag; quick review SHIP),
  deployed. S2e solo trials: 5 of 7 pass, the pile pickup is the known residual, the task trial failed on F1 (fixed),
  F2 and F4.
- The operator was stopped at the session's end (the owner's word), so the server may shut down. Start it with
  `operator/mindcraft.sh start` as a background job; a full start begins with empty memory (`load_memory: false`).
- Still waiting for the owner: the follow trials (S2d and S2e), U1, the death line's cause, the operator as a user
  service and an auto-retry after a server restart, memory across full restarts; S2e part B (the chest) is parked
  until his word.
- In the world: the 3x3 pit at x -475..-473, y 69, z 1808..1810; about 13 dug cells of natural dirt and grass
  from the S2e trials (listed in the trial report); the older leftovers below.

**Test card for the owner (next session).** Watch a night: she places her bed beside her, sleeps, the night skips,
and she takes the bed back every time. Tell her to follow you at dusk: she sleeps, then follows again, and still
follows 10+ minutes later. Inventory: with her bag nearly full (fewer than 4 free slots), she drops her junk and
surplus by herself within seconds, idle or while following you, in front of her and away from you; she should not
pick it back up. `!itemList` shows her list. Give her something on the junk list (rotten flesh, gravel) to see it go;
to keep a gift, the list needs "all" or a count for it. Tell us any "I lost my bed" / "I left my bed" line, and any
item list error line.

## 2026-11-12 (later) — S2c-fu done; S2d built but its live trials failed; next: the S2d fix slice

Work on this repo now runs in the persistent agent session `mindcraft` (cwd this repo, pinned Opus, effort high,
Remote Control); the workspace handoff only points here.

**Done this session** (main seat Opus; lanes: Opus builders, Sol + Opus adversary reviews, Opus live lanes acting as
the owner, who was not online):
- **S2c-fu** (quiet chat `work.chat`, scaffold records kept per world, the pit escape): merged `168dfd2`, deployed with
  the new profile text (backup `runtime/config/profiles/amaia.json.bak-pre-s2cfu`), live trials passed (ISSUES.md
  "S2c-fu live trials, 2026-11-12"). Design and review record: `runtime/diagnostics/i1-build/s2cfu-review/`.
- **Pit escape** root cause (live probe): the pathfinder's 1×1 tower placed while her body was in the cell; then a
  2-block tower ended one short (goal counted mid-jump before a refused last block). Both fixed in the carried
  pathfinder patch (`b4e4ca5`, `a080cff`), live-confirmed.
- **S2d** (sleeping through the night): merged `17ebb09`, deployed by an agent restart; offline 388/388; review closed
  (`runtime/diagnostics/i1-build/s2d-review/`; rulings `s2d-rulings-r1.md`). Live trials (ISSUES.md "S2d live trials,
  2026-11-12 morning"): 0 model calls for sleeping and the night skips every time; the mid-task resume passed; **but
  the first placement fails its whole-bed check every night (F1) and one pickup lost the bed (F2)**.

**Next.**
0. Restart the bot's operator under the new session (Notes).
1. **S2d fix slice (F1, F2, F3)**, a bug fix: root cause first (the `audit` quick form), with two short daytime probes
   on the live bot: (a) after a bed placement, log when the foot and head cells' updates arrive (F1: is the head read
   too early?); (b) break a placed bed's foot and log the item entities with `getDroppedItem()` for 2 s (F2: is the
   dropped bed recognised, and where does it land?). Then the leanest fix, a failing test first, review, merge,
   deploy, and re-run the failed and unrun S2d trials (idle at dusk, active goal at dusk with one-off commands, `!stop`
   in bed, a clear at dusk, the phantom cap if phantoms come). She has **no bed in her bag**: her white bed stands at
   −476 76 1802..1803 (recorded `own`); walk her there by day and she takes it back, or craft one.
2. **S2e inventory upkeep:** `runtime/diagnostics/i1-build/junk-council/recommended-design.md` r7 (its S2d amendments
   are built); probe P15 (toss direction, landing, pickup, profile reload) before the build; fixes the in-task drop
   facing (G1). The chest part stays parked. Same flow: PLAN + SPEC from the design (the builder may write them),
   builder brief, worktree, review round, merge, deploy, trials.
3. Then S3.

**For the owner (when back).**
- Test card S2c-fu: she should be quiet on her own; ask her a question during a goal (answer shown); `!tidy` answers;
  a clear by markers states the box. Taste call: the death line could name the cause ("I died at x, y, z (<cause>)");
  it now says "…; my task is paused."
- S2d after its fix: watch a night (she places her bed, sleeps, the night skips, she picks it up and carries on); tell
  her to follow you at dusk and check she still follows 10+ minutes later; `!stop` while she is in bed; tell us whether
  you saw the "I lost my bed …" or "I left my bed …" lines (whispers are not logged, F6).
- Still open: U1 (keep "yes, chests too" in the clear's leftovers question). Whether to run the operator as its own
  user service (below).

**Parked / later.** The clear's chest mode; walking back to tidy out-of-reach scaffold; task records, structures and
memory per world; the pit's `GoalNear` range met inside a pit (SPEC §16); the cause of tower refusals while the block
below is still predicted (a packet-level probe).

**In the world.** Her white bed, placed, at −476 76 1802..1803; she is idle at about −521 62 1821. The P14 black bed is
gone (taken by a clear, then lost as an item, F2). Her recorded dirt scaffold from the trials (report lists it) and
about 110 dug dirt near x −480..−496, z 1740..1750. A blocked task record `tmwd82ldo`. From before: a cobblestone pit
fill at −529 66..68 1743 (recorded) with a 1-deep hole above; an unrecorded cobblestone at −531,66,1741; a 6-block test
pillar at −468 73..78 1770 (unrecorded; the owner may break it); the 8 dead fire coral markers near −526 70 1730.

**Notes.** Durable project facts (priorities, tooling, live testing, the public-fork rule) are in `CLAUDE.md`. The
bot's operator was started as a background job of the session before this one: from the new session, check it
(`operator/mindcraft.sh status`), stop it (`operator/mindcraft.sh stop`) and start it again as a background job,
logging under `runtime/logs/`. Trial scratch from 2026-11-12 is archived in
`runtime/diagnostics/i1-build/live-scratch-20261112.tgz`.

## 2026-11-08 (late) — cube-clearing trials, protection fix, clearing design

- Owner trial: clear the inside of a box marked by 8 stripped spruce wood blocks.
  Analysis and fix ideas: ISSUES.md "Cube-clearing trials, 2026-11-08 evening".
- Committed (quick review closed: one Opus reviewer, SHIP after one fix): protection check moved into `breakBlockAt` (generated code could dig
  the owner's builds), its doc tells the coder it equips itself and to clear
  top-down; CHANGES.md and SPEC REQ-SAFE-3 updated; tests 188 pass.
- Private profile: `!taskStart` for tools needed mid-goal, clearing guidance
  (goal first, state the bounds, top-down, re-run after a timeout), marker
  listing. Backup: `runtime/backups/amaia.json.pre-clearfix-20261108`.
- Run 5 (box by coordinates) cleared about 760 of 780 cells; natural stone and
  dirt and the bot's own cobblestone pillars are left (ISSUES items 12–14). The
  bot was stopped at the end of the session with its memory archived, so the next
  start is fresh; it holds an unbreakable diamond pickaxe from the owner.
- Design council for clearing, own placements, outages and observation ran
  (main seat, Opus, Sol blind; Opus adversary). The owner ruled Q1–Q5 the same
  night (DECISIONS.md "Clearing an area and the bot's own blocks"; his new ask:
  the bot should not leave its pathfinder blocks behind as clutter). Design and
  rulings: `runtime/diagnostics/i1-build/clear-council/recommended-design.md`,
  lane reports beside it.
- Exact next step: fold the rulings and the clutter ask into the recommended
  design, run the council's review of that text (a fresh Sol review, then the
  adversary's follow-up), show the owner the result in plain words, then write
  PLAN (slices S2b: outages and the block listing; S2c: the clear capability,
  ledger and dig seam, before S3) and SPEC edits. The first build step of S2c is
  a live probe of the pathfinder-placement tell.
- The private profile is back on the model host's usual name (the host machine's
  VPN login had lapsed); it applies at the bot's next start.

## 2026-11-08 (evening) — I1: S0-lite and S2 done and live-tested; S3 next

### Where things stand

- **S0-lite** and **S2** are committed on `develop`, reviewed (Sol and an Opus
  adversary; final main-seat rulings) and deployed. Residuals: ISSUES.md "Iteration 1
  residuals"; live findings and improvement ideas: ISSUES.md "Iteration 1 live findings".
- **S2 live trials passed** (RESEARCH.md §8 baselines for comparison): 40 planks with a
  fight resumed at no call (2 calls, 150 s; baseline 14 calls); `!restart` mid-task
  resumed by itself; operator and MindServer stop/start mid-task loaded paused; a stone
  pickaxe from an empty inventory in 1 call, 42 s.
- Two live bugs found and fixed during the trials: a repeated request answered "done"
  from memory (`9f47cf7`) and cobblestone mined with a silk-touch pickaxe, which dug
  about 195 stone near the base (`debfe26`). The owner's two pickaxes are both silk
  touch and sit in the chest by the base, so the bot uses plain tools it crafts.
- Plan changes from the review: `!buildStructure` stays available until S3; owner
  `!stop` cancels any unfinished task; farmed plants are protected; allays and golems
  are never attacked.

### Exact next step

1. S3 (terrain-fitting shelter), in a clean session: PLAN §3 S3. The probe kit for P8 is
   1 oak door and 8 dirt. S3 also moves the `!buildStructure` block and the construction
   examples to `!build` (PLAN S3 profile bullet).
2. Choose which live findings (ISSUES table) to fold into S3 or a small S2 follow-up.

### Notes

- To start the bot with fresh memory: full operator Stop, archive the bot's
  `memory.json`, then Start. An agent-only restart saves the running history on exit and
  loads it again, so it cannot give a fresh start.
- Before a trial, make sure no older task report is still queued (finish or cancel the
  last task and let the bot go idle): a stale report once displaced the owner's request.
- The backend slowed about 30× once (a 551 s request) until it was restarted; if trials
  look stalled, check model latency in `requests.jsonl` first.

### Live-testing etiquette (PLAN §7)

- The server shuts down about 5 minutes after the last player leaves; only the
  owner can start it.
- Keep the bot connected between tests and while implementing; deploy with
  agent-only restarts (quick rejoin), not a full Stop.
- From S2 on, an agent-only restart resumes an active task by itself (it counts as
  a crash restart): finish or cancel tasks before deploying.
- Trials run with the owner's server making the bot invincible; reports say so and
  claim no survival.
- If the bot drops (for example kicked as AFK), tell the owner.
- Never leave it disconnected on purpose for more than a few minutes. Never run
  the same identity from two clients at once.
