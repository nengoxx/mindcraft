# Handoff

## 2026-11-14 (morning) — travel trials done except a clean T5; next is S3

- **Live on develop, not pushed:** the blocks (`7e788a0`), combat (`46e6cb4`), live-trial fix (`21f63d0`) and
  travel (`229cddf`, merge `4bae59f`) slices. Gate 620/620. The operator runs since 2026-11-13 17:53 (bot log
  `runtime/logs/mindcraft-2026-11-13T16-53-06-631Z.log`); travel deployed 2026-11-14 00:46 by an agent-only
  restart. Private profile: `work.combat.ranged` the four skeletons, `travel_speed` 2, `work.inventory` gear
  best / cap stack / surplus 2; `min_free_slots` at its default (staged and reverted today, checked).
- **Travel trials** (ISSUES "Travel live trials, 2026-11-14 night"; logs `runtime/diagnostics/i1-build/travel/trials/`):
  T1, T2, T3, T4 and T6 pass. T5 (a task's climb out of a shaft to drop, then back to work) is still partial: the
  climb and the drop are seen three times, the return and the task's end never, because each staging blocked on
  free slots. One new open finding from it (30 kinds in 31 slots after the drop, ISSUES). The request-log issue is
  dismissed: no call had completed; `requests.jsonl` counts calls again.
- **Next:** the owner's word on what follows. Recommended: S3 (the terrain-fitting shelter, PLAN §3 "S3"), the last
  I1 slice, starting with its design check; a clean T5 only if the slot finding is looked at first (check her
  slots, not counts).
- **Open owner questions on travel (design §11; defaults built = today's behaviour):** restart a walk after
  sleeping through the night (recommended: yes, once the bed is back) or after `self_preservation` (recommended: no
  for the near-death flee); keep `!goToRememberedPlace` the same way (recommended: yes). Each is a one-line constant.
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

- She stands idle at -520,71,1731, by the coral markers (T6; the coral stands).
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
