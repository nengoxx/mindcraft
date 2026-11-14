# Handoff

## 2026-11-14 (evening) — paused before S3: the reliability steps are done

- **Paused on the owner's word** (DECISIONS 2026-11-14 "Step 3 staged by the agent; a pause after it"): he uses the
  bot day to day and compares backend models (a new one is due). S3 starts on his word; nothing is half-built.
- **The owner's three reliability steps are done** (DECISIONS 2026-11-14 "Walks after sleeping; reliability before
  S3"): step 1 (`38d9c30`, merge `86b9b59`); step 2, the audit (ledger `docs/audits/i1_audit.md`: I1-1, 2, 4, 5,
  6, 8–17 fixed in "Reliability 2", `6516904`, merge `90cd720`; I1-3 and I1-7 deferred; I1-18 wontfix); step 3,
  the uncoached trials (ISSUES "Step 3 trials": 15 of 24 runs passed).
- **Next, on his word:** his rulings on the step 3 findings (ISSUES "Step 3 trials", the table; the most serious:
  saved places are not looked up and do not survive a restart; a tool made for him dropped as junk), best made
  with his model comparison in hand; then S3 (PLAN §3 "S3", built from its section).
- **To compare models:** rerun the step 3 set (the per-trial criteria in
  `runtime/diagnostics/i1-build/step3/trials-report.md`) on the new backend and compare success, calls and
  latency with the table in ISSUES. A model change goes through the private profile (`live.mjs settings` / `set`).
- **Live state:** the operator runs since 2026-11-14 17:39 (a full start after a power cut; bot log
  `runtime/logs/mindcraft-2026-11-14T16-39-51-308Z.log`); her memory and saved places are empty since then. Private
  profile unchanged (`work.combat.ranged` the four skeletons, `travel_speed` 2, `work.inventory` gear best / cap
  stack / surplus 2, `min_free_slots` default, `modes.sleeping` false, `modes.cheat` false). She is not op.
- **Records:** `runtime/diagnostics/i1-build/reliability/` (`STATE.md`), `runtime/diagnostics/i1-build/step3/`.
- **Owner preference (2026-11-13):** label every review finding by its evidence: seen in game, the real code in a
  staged situation, or theoretical; theoretical findings with small consequences are recorded, not fixed.
- **Sleeping is off** (the owner's ask: he wants night mobs to spawn): back on only on his word.
- Later: coming back after a far respawn is not built. "Defend the owner" is a later slice (`goToPlayer` keeps
  upstream's pause of `self_defense`).

## Waiting for the owner

- **Test cards** (trials only he can run; he may do them as he plays; report anything under "Report"):
  1. *Questions while she works* (Reliability 2). Ask about her bag, the time, her health during a task. Expect:
     quick answers, no long pause. Report: a reply much slower than the others.
  2. *Her memory* (Reliability 2). After a while, ask what she remembers. Expect: his standing rules and recent
     tasks. Report: anything wrong or missing.
  3. *A changed order* (Reliability 2). "collect 64 dirt", then at once "leave the dirt and come here". Expect: only
     the second happens. Report: she collects anyway.
  4. *Armour thrown to her* (gear trial 2). Throw her a piece of armour. Expect: she wears it if better and keeps
     it. Report: dropped, not worn, or worn over better gear.
  5. *Bottles and banners* (S2e-fu trial 6). Hand her potions of different strengths, two banner stacks, an
     enchanted bow. Expect: each kept in one best slot, nothing dropped. Report: any of them dropped.
  6. *Combat while following him* (Combat). Let her follow him past mobs. Expect: she fights within her leash and
     comes back to him; passing mobs she ignores. Report: she wanders off or stops following.
  7. *`goToPlayer` while he moves*. Call her while walking away. Expect: she reaches him. Report: she stops short.
  8. *Following at dusk; cleanup while following* (S2d, S2e). Expect: no bed placed while she follows; the bag
     cleanup does not stop the follow. Report: she stops or wanders.
  9. *A night, once sleeping is back on* (S2d; `modes.sleeping` is off until his word). Expect: she places her
     bed, sleeps, the night skips, she takes the bed back and goes on. Report: any "I lost my bed" / "I left my
     bed" line, or a bed left in the world.
  10. *A clear box in a cave* (Reliability 2, offline only so far). Mark a small box underground and ask her to
     clear it. Expect: it completes. Report: it stops part way, and what she said.
- Open questions: U1 (keep "yes, chests too" in the clear's leftovers question); the death line naming its cause (a
  taste call); the operator as its own user service, with a retry after a server restart (ISSUES "Operator: the proxy
  after a server restart"); memory across full restarts (a full start begins with empty memory, `load_memory:
  false`).
- Parked until the project resumes (the owner, 2026-11-14): an easy start for anyone trying the fork. Today one
  command starts it once set up (`operator/mindcraft.sh start`; Windows `operator/Mindcraft.ps1`), but the setup
  is manual and dense (Node 22 and Java 17+ into `runtime/tools`, `npm ci`, copy `operator/examples/` to
  `runtime/config/` and edit three files, `mindcraft.sh update` for ViaProxy; operator/README.md). Wanted: a
  plain quick start and, if lean, one setup command.
- Parked until his word: S2e part B (the chest). Later slices: the clear's chest mode, walking back to tidy
  out-of-reach scaffold, task records, structures and memory per world (SPEC §16, PLAN §8).

## In the world

- She stands idle at about -439,105,1561 (step 3, the forest), no active task.
- Step 3 left: her oak plank markers at -529,68,1727, -524,68,1732, -529,70,1732, -524,70,1727 and the cleared box
  inside; cave clears near -370,58..62,1668 with scaffold at -367,61,1667 and -368,60,1665; cobblestone pillars at
  -391,66..75,1648, -405,80..81,1645, -411,92..96,1604, -422,92,1595, -370,68..71,1667..1669 and 5 blocks at
  -446..-447,102..104,1562..1563; dropped items near -530,69,1733 (flowers, a sapling, sand, phantom membrane, the
  stone pickaxe); one of the owner's coral markers (-531,69,1733) mined on his yes (in her bag).
- Her dirt pit at -533,64,1733 (T5 clean: a 6-deep shaft at -532,66..71,1735 and about 40 dug dirt
  around it; it was her saved place "pit", lost at the full start); the coral markers stand (T6).
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
