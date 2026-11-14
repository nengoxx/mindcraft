# Handoff

## 2026-11-14 (day) — reliability before S3: step 1 done and live; next is step 2, the audit

- **The owner's plan (DECISIONS 2026-11-14 "Walks after sleeping; reliability before S3"):** everything consistently
  reliable before S3, in three steps: (1) close the open findings and build the travel answers; (2) a reliability
  audit of the I1 code (two Opus lanes by area, then an Opus adversary; ledger `docs/audits/i1_audit.md`); (3)
  repeated uncoached trials in words, Qwen alone, measuring success, calls and latency. Commits are authorized by
  that plan; push only on his word.
- **Step 1 is merged and live** (`52c477b`, merge `f8efe7d`; deployed 12:37 by an agent-only restart; gate
  650/650): split stacks are merged before drops; `!goToRememberedPlace` is a kept walk; a near-death flee's cut
  restarts once safe; sleep may cut a held walk, which restarts once her bed is back. Reviews: Sol + an Opus
  adversary, two fix waves, a ruled fix; record and residuals in `runtime/diagnostics/i1-build/reliability/`
  (`STATE.md`, `build-r1-rulings.md`). Live trials (ISSUES "Reliability 1 live trials"): T5 passes;
  `!goToRememberedPlace` passes; no merge seen live (no split in her bag); the flee and sleep parts are offline only.
- **Step 2 is done** (ledger `docs/audits/i1_audit.md`, `80680cf`): 18 findings, 4 M and 14 L, no H; the
  orchestration core holds (no lost work, loop, hang or stale read). The M findings: decisions wait for memory
  summaries (I1-1), summaries mostly reasoning (I1-2), the prompt cache is barely reused (I1-3), a clear in a cave
  stalls (I1-4). **Next: the owner rules on what gets fixed** (a commissioned audit; the main seat's
  recommendation went to him on 2026-11-14), then a fix slice, then step 3.
- Step 2 records: `runtime/diagnostics/i1-build/reliability/` (`STATE.md`). Live state: the operator runs since 2026-11-13 17:53 (bot
  log `runtime/logs/mindcraft-2026-11-13T16-53-06-631Z.log`); private profile unchanged (`work.combat.ranged` the
  four skeletons, `travel_speed` 2, `work.inventory` gear best / cap stack / surplus 2, `min_free_slots` default).
  The worktree `<scratch>/mindcraft-rel1` (branch `reliability`, merged) can be removed.
- **Travel trials** (ISSUES "Travel live trials, 2026-11-14 night"): T1–T6 pass (T5 in the reliability trials).
- **Owner preference (2026-11-13):** label every review finding by its evidence: seen in game, the real code in a
  staged situation, or theoretical; theoretical findings with small consequences are recorded, not fixed.
- **Sleeping is off** (the owner's ask: he wants night mobs to spawn): `modes.sleeping` is `false`; back on only on
  his word. Phantoms come every night (about 430 fights since 01:25).
- Later: trial 6 of S2e-fu (bottles of different strengths, two banner stacks, an enchanted bow). Coming back
  after a far respawn is not built. "Defend the owner" is a later slice (`goToPlayer` keeps upstream's pause of
  `self_defense`).

## Waiting for the owner

- Trials only he can run: combat while following him (the leash on him, the follow skip, passing mobs while he
  travels); `goToPlayer` while he moves; armour thrown to her (gear trial 2); following him at dusk (S2d) and the
  cleanup while following (S2e); watch a night once
  sleeping is back on (she places her bed, sleeps, the night skips, she takes it back; any "I lost my bed" / "I left
  my bed" line).
- Open questions: U1 (keep "yes, chests too" in the clear's leftovers question); the death line naming its cause (a
  taste call); the operator as its own user service, with a retry after a server restart (ISSUES "Operator: the proxy
  after a server restart"); memory across full restarts (a full start begins with empty memory, `load_memory:
  false`).
- Parked until his word: S2e part B (the chest). Later slices: the clear's chest mode, walking back to tidy
  out-of-reach scaffold, task records, structures and memory per world (SPEC §16, PLAN §8).

## In the world

- She stands idle in her dirt pit at -533,64,1733 (T5 clean: a 6-deep shaft at -532,66..71,1735 and about 40 dug dirt
  around it; the pit is her saved place "pit"); the coral markers stand (T6).
- Travel trials: a 24-dirt pillar at -363,71..94,1684 (T3, residual R5); a 6-deep shaft at -487,65..70,1810 with a
  5-dirt tower (T5 night); an 8-deep shaft at -411,76..83,1727 with a 3-dirt, 2-cobblestone tower at
  -412,76..80,1727 and a filled shaft at -414,83..85,1727 (T5 reruns); her dropped surplus near both.
- Gear trials: the owner's obsidian at -490 71..72 1813 is mined (blocks slice trials); stone dug on the shore near
  -517 64 1786 (her tunnel; some of her scaffold dirt left underground).
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
