# Handoff

## 2026-11-11 (evening) — S2c deployed; S2d and S2e designed; live trials next

- S2c is built, reviewed (Sol plus an Opus adversary, two fix waves per part and
  main-seat rulings; records in `runtime/diagnostics/i1-build/s2c-review/`),
  committed (part 1 `7d94aee`, part 2 `75be9aa`, merge `1f4ab07`; 317 tests) and
  deployed by `set-agent-settings` (MindServer keeps the loaded profile in memory,
  so a plain agent restart reuses the old one). Startup migrated the old station
  into `runtime/bots/amaia/placements.json`; `!tidy` answered "removed 0; left 0".
- Private profile updated (clearing through `!taskStart` with `clear markers=` /
  `clear box=`, `!blockPositions` for marker listing, one clear example); backup
  `runtime/config/profiles/amaia.json.bak-pre-s2c`.
- Sleep probe P14 (2026-11-11): sleep works through ViaProxy and the night skipped
  about 3 s after `!goToBed` (she was alone online); phantoms broke the first
  night. Record: `runtime/diagnostics/i1-build/sleep-council/p14-live-20261111.md`.
  A black bed placed by `!placeHere` stands near −475 66 1744 (unrecorded, so the
  S2 protection keeps it; the owner may break it).
- Designs closed, the owner's answers in DECISIONS.md (`0cef52b`): S2d sleeping
  (`sleep-council/recommended-design.md` r3) and S2e inventory upkeep
  (`junk-council/recommended-design.md` r7; the chest part is parked). S2e amends
  S2d: the bed pickup launches only with 2 free slots, and an `action_manager.js`
  carry keeps a resumable action's timeout on resume (a cut follow otherwise stops
  after 10 minutes; also true today after any fight during a follow).
- Known: the shipped in-task junk drop can toss the way she already faced (forced
  `lookAt` sends no packet before the toss); S2e fixes it (junk design §3, G1).
- A 6-block test pillar stands at −468 73..78 1770 (pre-design, unrecorded).
- Owner notices are whispered (`only_chat_with`); MindServer's web panel sends as
  'ADMIN', which she ignores; the operator helper sends as the owner.
- **Test card (S2c live acceptance, PLAN S2c item 4; the owner in game):**
  1. Mark a small box with 8 identical blocks and say "clear inside the <block>
     markers" → one `!taskStart` with `clear markers=…`; containers stay; if
     something not natural is inside she lists it and asks once; answer "yes" or
     "no" (short answers only). Expect a final report and the markers kept.
  2. Make her fight on uneven ground (she pillars) with no task → within about a
     minute after the fight she removes her own pillar blocks, quietly.
  3. During a tidy, type `!stop` in game chat → the rest stays (also the block she
     was digging). For "stop tidying" in words use game chat, not the panel.
  4. `!tidy` while a task runs → refused; after it ends → tidies.
  5. Report: blocks of hers left behind (the own-blocks count sets the priority of
     the later full scaffold slice), anything dug that should not be, any chat
     spam or extra model calls.
- Exact next step: the live trials above with the owner, then S2d's PLAN and SPEC (the
  sleep design plus the two amendments), then build S2d, then S2e.

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
