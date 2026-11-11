# Handoff

## 2026-11-10/11 — clearing design approved (revision 6); PLAN and SPEC next

- The clutter ask (the bot's own pathfinder blocks) went through a small council
  and a live probe; the owner ruled the lean tidy (DECISIONS.md "Tidying the
  bot's own scaffold blocks"). Findings 17–18 added to ISSUES.md (cube analysis).
- The whole design had its review round (Sol plus the Opus adversary, two fix
  waves, then main-seat rulings): `runtime/diagnostics/i1-build/clear-council/recommended-design.md`
  revision 6 (`final-r6.sha256`), rulings in `review-r3/r4/r5-rulings.md`,
  live probe in `clutter/live-probe/`. The owner approved it on 2026-11-11
  (DECISIONS.md); the complete scaffold record is a later slice, and the S2c
  trials count the bot's own blocks left behind.
- PLAN S2b/S2c and the SPEC are written and committed (`aa84358`, quick review
  SHIP after one fix wave).
- Bot: online again since 2026-11-11 (operator restarted), idle. A 6-block test
  pillar stands at −468 73..78 1770 (pre-design, unrecorded).
- S2b is built, reviewed (Sol plus the Opus adversary, two fix waves, final
  main-seat rulings; records in `runtime/diagnostics/i1-build/s2b-review/`) and
  committed (`d9595e6`); deployed 2026-11-11 by an agent-only restart (the owner
  allows restarts at any time; keep the bot in game while working).
- Live checks run by the main seat alone, 2026-11-11 (the owner could not log in;
  owner messages sent through MindServer `send-message` as the owner):
  - Block listing: "where are the cobblestone blocks around you?" gave one
    `!blockPositions("cobblestone", 32)` call, 52 found, the nearest being the
    block under her; no movement from the command (self_defense moved her).
  - Outage: the model was cut for about 4 min through a local socat relay
    (profile url and `work.model_outage_wait_s` 60 set through MindServer
    `set-agent-settings`, restored identical afterwards) during a walking goal.
    The goal never paused: self_defense against phantoms called `stopLoop()`
    every cycle and the pause check skipped interrupted loops. Fixed (the pause
    no longer skips them; quick review SHIP); the goal itself survived and went
    on after recovery.
  - Repeat trial on the fixed code (`f0a0eaf`, model cut 16:22–16:25): the goal
    paused at 16:23 although a mode had stopped its loop, saved PAUSED with the
    outage flag, and probed once a minute. A restart then loaded the pause
    ("before the restart", no new notice) and went on probing.
  - From about 16:26 the model backend itself answered every request with HTTP
    503 "the model's output became non-finite (NaN) twice in a row" (health
    "ok"); the owner restarted it (cause unknown). At 16:35 the outage ended
    ("reachable again"): the restart message's turn was answered first, then
    the same goal resumed and ran to 8/8 and `!endGoal`. S2b live checks pass.
  - The notices are whispered to the owner (`only_chat_with`), so MindServer's
    `bot-output` does not show them and they were lost while he was offline;
    seeing them needs an outage while he is in game (owner's 8-marker ask too).
- Exact next step: start S2c (PLAN S2c, build order D2 → dig.js → D1 → D3 →
  D6) in a fresh session.

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
