# Handoff

## 2026-11-14 (night) — the travel slice is live; T1 and T3 pass

- **Live on develop, not pushed:** the travel slice (`229cddf`, merge `4bae59f`; DECISIONS 2026-11-13 (evening)
  "Travel after the live trials"; council, reviews and two fix waves in `runtime/diagnostics/i1-build/travel/`,
  `STATE.md` there is the trail). Gate 620/620. Deployed 2026-11-14 00:46 by an agent-only restart; the profile is
  unchanged (`work.travel.resume_max` default 20). The worktree `<scratch>/mindcraft-travel` (branch
  `travel`, merged) can be removed with `git worktree remove`.
- **Trials** (ISSUES "Travel live trials, 2026-11-14 night"): T1 (fights cut a typed night walk: 4 restarts, 0
  model calls) and T3 (the P19 cave trap: one climb out, then on to the goal, 0 calls) pass; T5 (the task's climb
  to drop) seen in part. **Next, at night:** T2 (a walk asked in words: 1 call to start, 0 per fight, 1 at the
  end), T4 (`!stop` during a fight on a kept walk: she stays), a clean T5 (a task down a shaft with real junk), T6
  (a mining question answered "no": "OK, I'll leave them.").
- **New open issue:** `runtime/diagnostics/requests.jsonl` has had no line since 2026-11-13 20:24 although model
  calls run (ISSUES, same section). Quick audit first; until then count calls from the agent log's "Awaiting" lines.
- **Open owner questions (design §11; defaults built = today's behaviour):** restart a walk after sleeping through
  the night (recommended: yes, once the bed is back) or after `self_preservation` (recommended: no for the
  near-death flee); keep `!goToRememberedPlace` the same way (recommended: yes). Each is a one-line constant.
- In the world: a 24-dirt pillar at -363,71..94,1684 (the T3 climb, scaffold of `action:goToCoordinates`, not
  tidied: residual R5); her 6-deep shaft at -487,65..70,1810 with a 5-dirt tower in it (T5). She stands on it,
  idle, at -486.6,70,1810.4.

## 2026-11-13 (evening) — blocks and combat live; trials pass; travel is the weak spot

- **Live on develop, not pushed:** the blocks slice (`7e788a0`), the combat slice (`46e6cb4`) and a live-trial fix
  (`21f63d0`: the carried pathfinder patch no longer drops every `diggingCompleted` listener; it made
  `!collectBlocks` report a real dig as "changed"). Gate 583/583. Operator restarted 2026-11-13 17:53 (log
  `runtime/logs/operator-start-20261113a.log`, bot log `runtime/logs/mindcraft-2026-11-13T16-53-06-631Z.log`).
  Private profile: `work.combat.ranged` the four skeletons, `travel_speed` 2 (backup
  `~/.cache/tmp/combat-tmp/deploy/amaia.json.bak`).
- **Trials by the main seat** (ISSUES "Live trials 2026-11-13 evening"): blocks acceptance 1–4 pass at his
  obsidian (both blocks now mined, on his word in the trial); combat: a skeleton engaged at 11.7 on the aggressive
  bit before its first arrow, about 30 fights within 0–9.5 of their anchors; a task cut by fights resumes by
  itself. **Left for the owner:** combat while following (leash on him, the follow skip, travelling), armour trial 2.
- The travel findings of these trials are fixed by the travel slice (block above). The recorder hook is removed
  (`cmp` clean); its log is kept as `runtime/diagnostics/i1-build/combat/p19-trial-log.txt`.
- **Owner preference (2026-11-13):** label every review finding by its evidence: seen in game, the real code in a
  staged situation, or theoretical; theoretical findings with small consequences are recorded, not fixed.
- `goToPlayer`'s pause of `self_defense`: kept (DECISIONS 2026-11-13 (evening)); "defend the owner" is a later slice.

## 2026-11-13 — the gear slice is deployed; its trials mostly pass

- **Gear slice merged and live** (`6e699b6`; design council r5 approved by the owner, DECISIONS 2026-11-12 night and
  2026-11-13; probe P17; review Sol + Opus adversary, one fix wave, both confirms closed; record
  `runtime/diagnostics/i1-build/gear/`). The private profile sets `work.inventory` to `gear: "best"`, `cap: "stack"`,
  `surplus_slots: 2` (the interim `"stack"` entries are gone; backup `~/.cache/tmp/gear-tmp/deploy/amaia.json.bak`).
  `mineflayer-armor-manager` is removed from `node_modules` (`npm prune`); `npm ls` is clean apart from canvas.
- **Live trials** (ISSUES "Gear live trials"): fight, stone, surplus, `!itemList` and a finished task's goods pass;
  nothing of his was dropped or replaced. Trial 2 (armour thrown to her) waits for the owner. Trial 4 (obsidian through
  `!collectBlocks`) failed by protection, not gear: his blocks are protected, and collectblock silently skips them, so
  "Completed 2 … net change: none" (a pre-existing defect, ISSUES). Mining obsidian with the copy is proven by P17.
- **The owner answered (DECISIONS 2026-11-13, "His blocks on request [...]"):** fix the false `!collectBlocks`
  count; she mines a block of his only when he asks; better armour is worn whoever gave it (G1 closed, already
  built); her false obsidian lesson is corrected in `runtime/bots/amaia/memory.json` (backup in the session scratch).
- **Two council designs are ready for the owner, not yet approved or built:**
  - *His blocks on request + the truthful count:* `runtime/diagnostics/i1-build/ownblocks/recommended-design.md` r4
    (proposals: main seat, Sol, Opus; adversary r1–r3 and a Sol review closed; nothing above LOW open). A new
    `!collectPlaced(type, num)`: typed by him it mines at once; run by the model in his turn, code asks him a yes/no
    question listing the exact blocks. Four owner questions in its §8 (recommendations: yes to all).
  - *Combat start + leash:* `runtime/diagnostics/i1-build/combat/recommended-design.md` r4 (proposals: main seat
    plus addendum, Sol, Opus; adversary r1–r3 and a Sol review; r4 applies adversary r3's last HIGH, the admission
    bound; **first step next session: a confirm of r4** by a fresh Opus adversary given `adversary-r3.md` and r4).
    Skeleton family engaged on the
    aggressive bit (P18: about 1 s before the first arrow) or a hit, within 16, with an easy path (walk, at most 3
    natural digs, no placing, no doors); leash 16 on her position around the first fight's spot, walk back inside
    the fight action; `isClearPath` fixed (it replaced her walking path, and placed blocks). Five owner questions in
    its §10.
  - P18 (passive recorder, 2026-11-13 night) reproduced the owner's report: one skeleton hit her 5 times from 8-16
    blocks over 19 s; lines in `runtime/diagnostics/i1-build/combat/p18-lines.txt`. The mineflayer hook is removed
    (`cmp` clean).
- **Next:** the owner's answers on both designs; then a builder brief per slice (the blocks slice first: smaller),
  review (Sol + Opus adversary), deploy, live trials where he put her (combat at night).
- The gear worktree `<scratch>/mindcraft-gear` (branch `gear`, merged) can be removed with
  `git worktree remove` once nothing more is needed from it.
- **Sleeping is off for now** (the owner's ask: he wants night mobs to spawn): `modes.sleeping` is `false`. Back on
  only on his word.
- Later: trial 6 of S2e-fu (bottles of different strengths, two banner stacks, an enchanted bow); then the S3 design
  check. Coming back after a far respawn is not built.
- The operator is running (started 2026-11-12 evening as a background job of the persistent session, log
  `runtime/logs/operator-start-20261112c.log`; bot log `runtime/logs/mindcraft-2026-11-12T18-08-07-621Z.log`).

## Waiting for the owner

- Trials only he can run: following him at dusk (S2d) and the cleanup while following (S2e); watch a night once
  sleeping is back on (she places her bed, sleeps, the night skips, she takes it back; any "I lost my bed" / "I left
  my bed" line).
- Open questions: U1 (keep "yes, chests too" in the clear's leftovers question); the death line naming its cause (a
  taste call); the operator as its own user service, with a retry after a server restart (ISSUES "Operator: the proxy
  after a server restart"); memory across full restarts (a full start begins with empty memory, `load_memory:
  false`).
- Parked until his word: S2e part B (the chest). Later slices: the clear's chest mode, walking back to tidy
  out-of-reach scaffold, task records, structures and memory per world (SPEC §16, PLAN §8).

## In the world

- Gear trials: two owner obsidian blocks stand at -490 71..72 1813 (one mined in P17 at -497 71 1808; its item may lie
  near -495.6 71 1807.6); stone dug on the shore near -517 64 1786 (her tunnel; some of her scaffold dirt left
  underground). She stands there, idle.
- From the S2e and S2e-fu trials and P16: a one-deep pit at -480 69 1815, a two-deep hole at -473 68..69 1814, the
  3x3 pit at x -475..-473, y 69, z 1808..1810, about 13 dug cells of dirt and grass (S2e trial report).
- Older: about 110 dug dirt near x -480..-496, z 1740..1750; a cobblestone pit fill at -529 66..68 1743 (recorded)
  with a 1-deep hole above; an unrecorded cobblestone at -531 66 1741; a 6-block test pillar at -468 73..78 1770
  (unrecorded; the owner may break it); 8 dead fire coral markers near -526 70 1730.

## Notes

- A full operator start begins with empty memory; an agent-only restart keeps the running history (so it cannot give
  a fresh start).
- Before a trial, let the last task finish or cancel it: a stale task report once displaced the owner's request.
- If trials look stalled, check model latency in `requests.jsonl` first (the backend once slowed about 30×).
