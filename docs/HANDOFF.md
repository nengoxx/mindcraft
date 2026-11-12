# Handoff

## 2026-11-12 — where Iteration 1 stands; next: the S2c follow-up slice

**Done.** S2c (clearing, the placements ledger, the owner question, tidying) is
built, reviewed, merged (`1f4ab07`) and deployed; its live trials ran on
2026-11-11 (results: ISSUES.md "S2c live trials, 2026-11-11 night"); one crash
fixed there (`0645e3f`). The bot is online on the committed code (`c685d74`),
profile as of S2c (backup `runtime/config/profiles/amaia.json.bak-pre-s2c`).

**Order of work (the owner, 2026-11-11/12):**
1. **S2c follow-up slice — next session.** Design closed:
   `runtime/diagnostics/i1-build/quiet-council/recommended-design.md` r4 (sha256 in
   `recommended-r4.sha256`; lanes, adversary, Sol review, two waves beside it).
   the owner's answers: DECISIONS 2026-11-11 "After the S2c live trials" and 2026-11-12.
   Contents: quiet chat (`work.chat`, quiet default, debug; death and stuck-twice
   alerts; `work.tidy.announce` retired), scaffold records kept through restarts,
   crashes and unloads with the connected-component "stands free" guard, a
   per-world ledger (hashed seed; §10 is a main-seat spec the build review must
   cover), and the pit-escape bug (below).
   Steps: PLAN (one slice) and SPEC edits (REQ-OWN-4/5/10, a chat REQ, §14 keys,
   §16 residuals; CHANGES carries for `agent.js` and `utils/mcdata.js`) → builder
   brief → build in a worktree → review (Sol + Opus adversary) → commit → deploy
   (profile text and examples by `set-agent-settings`) → test card for the owner:
   restart with a pillar recorded ("kept N"), a night of fights counting chat
   lines, the marker statement, a raw `!tidy`, a death line.
2. **S2d sleeping:** `sleep-council/recommended-design.md` r3 plus two amendments
   from S2e (bed pickup only with 2 free slots; the `action_manager.js` carry so a
   resumed action keeps its timeout). Probe record P14:
   `sleep-council/p14-live-20261111.md` (sleep works through ViaProxy; one
   sleeper skips the night).
3. **S2e inventory upkeep:** `junk-council/recommended-design.md` r7; probe P15
   (toss direction, landing, pickup, profile reload) before the build. Fixes the
   in-task drop facing (G1). The chest part is parked.
4. Then S3.

**Pit escape (bug, open).** In the trials the failing placement was usually the
last of a 2–4 block tower, in pits and in the open ("placement … no entry (the
cell shows air)"). The pathfinder places only by jumping (`movements.js`
getMoveUp, `index.js:560-590`); a ceiling stops the move from being planned.
Next probe (daytime, ~10 cobblestone): dig a 1-wide, 4-deep pit in the open with a
clear box, walk her in, send her out, log each attempt and `firstBlockAboveHead`.

**Open with the owner.** U1: keep the "yes, chests too" answer in the clear's leftovers
question (kept until he answers; `s2c-review/s2c-p1-rulings-r2.md`).

**Parked / later.** The clear's chest mode (after dropping is refined); walking
back to tidy out-of-reach scaffold (a later slice, keep it clear); task records,
structures and memory per world (flagged, not scheduled).

**In the world.** A black bed near −475 66 1744 and a 6-block test pillar at
−468 73..78 1770 (unrecorded; the owner may break them). From the trials: cobblestone at
−528 64..66 1749 and −528 64..67 1742 (filling pits she dug), one block at
−530 72 1745, mining pits under −526 64 1728. The 8 dead fire coral markers near
−526 70 1730 are in place; the box inside is empty.

**Notes.** Owner notices are whispered (`only_chat_with`); whispers are not logged
on the host. The panel sends as 'ADMIN' (ignored); the operator helper
the live-test helper sends as the owner (state, say, settings, set). A
profile change needs `set-agent-settings` (MindServer caches the profile). The owner
allows restarts any time; keep her in game while working. `develop` is 34 commits
ahead of GitHub (public fork): push only on the owner's word.

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
