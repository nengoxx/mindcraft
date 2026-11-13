# Handoff

## 2026-11-13 (afternoon) — both slices approved and building

- The owner answered both designs (DECISIONS 2026-11-13 "Both designs answered", and "Following him on the move").
  The combat design closed at r10 (adversary r4–r8 confirms; rulings in `combat/rulings-adversary-r4-r8.md`).
- Two builders run in worktrees: `<scratch>/mindcraft-ownblocks` (branch `ownblocks`, design
  `ownblocks/recommended-design.md` r4 plus the owner's yes to §8) and `<scratch>/mindcraft-combat`
  (branch `combat`, design r10). Briefs: `brief-builder.md` in each record folder; reports land as
  `builder-report.md` there.
- **If this session ends now:** read both builder reports, re-run the gate in each worktree, then the review round
  (Sol + a fresh Opus adversary) per slice; nothing is merged or deployed. The server was down from 13:07 (Aternos
  shutdown); her agent process exited and needs an operator restart once the server is up.

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
