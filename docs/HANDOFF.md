# Handoff

## 2026-11-12 (night) — docs checked against the live bot; next: the gear slice

- Consistency check done (the owner's ask): DECISIONS, SPEC REQ-OBT-11 and §16, PLAN, ISSUES and this handoff agree,
  and the running bot's profile equals `runtime/config/profiles/amaia.json` (`modes.sleeping` false, the one-stack
  entries). Fixed: stale "pending its live trials" rows in ISSUES (S2e F2–F5, G1), stale "wait for the S2e trials"
  notes in SPEC, a PLAN status line naming the gear slice, and this handoff (closed blocks removed; git keeps them).
- S2e-fu is merged (`13b7b86`), deployed and its live trials 1–5 pass (ISSUES "S2e-fu live trials"). Its record:
  `runtime/diagnostics/i1-build/s2efu/`.
- **Next: the gear slice**, the owner's rulings in DECISIONS 2026-11-12 (night) "The owner's gear and a one-stack
  cap". Design first (council per the user rules), then build, review, deploy, trials. Design folder:
  `runtime/diagnostics/i1-build/gear/` (the item dump of his gear and her tools: `item-dump-20261112.txt`). Scope:
  1. a one-stack cap for every stackable item on no list (a config default, e.g. `work.inventory.default`, set in the
     private profile; the public default keeps today's "unlisted is kept"); non-stackables outside the cap;
  2. weapon choice by damage over time from the item's own attributes (`attribute_modifiers` base_attack_damage and
     base_attack_speed, Sharpness), vanilla values as the fallback, and swing timing from the real speed: the 26.1
     registry has no `attackDamage`, so `equipHighestAttack` (skills.js) does not sort today, and mineflayer-pvp
     times swings from a by-name table;
  3. armour by real armour and toughness values (components, vanilla fallback), Protection next; picked-up armour
     never replaces his (mineflayer-armor-manager ranks by material name, leather lowest);
  4. tools by real mining speed (the `tool` component, Efficiency), the silk-touch rule kept;
  5. a truly unbreakable item (the `unbreakable` component) takes priority in all three;
  6. keep only the best one of weapons and of each tool kind, drop the rest (DECISIONS, "Gear: the best one,
     period"; the per-kind reading is to confirm with him in the design).
  His words, for the brief: "I want the damage over time and our real armor values to be the actual decision. And
  obviously, if there's anything that is unbreakable, like legit unbreakable, not just enchanted with unbreaking
  [...] that should take priority"; "I just want to make sure that [...] she's using the best gear that she can use,
  which happens to be mine"; "any item that is not in any list [...] maximum one stack [...] I don't want to clutter
  her inventory right now."
- **The owner's gear** (copies, ours to use): she wears his epic leather chestplate, leggings and boots (diamond-level
  armour values, Protection V, unbreakable) and carries his epic iron axe (damage 9 + Sharpness VII, attack speed 4,
  Looting III, unbreakable). His epic iron pickaxe (tool speed 9 on all pickaxe blocks, Efficiency V, Silk Touch,
  unbreakable) stays in his chest at -475 71 1800 with her diamond sword (it may be thrown away). He gave her a copy
  without Silk Touch (epic, unbreakable, Efficiency V, tool speed 9); a second copy went to the chest. Her own tools,
  for the ranking: diamond pickaxe unbreakable, no enchantments (his earlier gift); diamond axe Sharpness V,
  Efficiency V, Mending, Unbreaking III (not unbreakable).
- **Sleeping is off for now** (the owner's ask: he wants night mobs to spawn): `modes.sleeping` is `false` (backup
  `runtime/config/profiles/amaia.json.bak-pre-nosleep-20261112`). Back on only on his word.
- **One stack for now** (until the cap is built): the private profile's `work.inventory.items` sets `gunpowder`,
  `ender_pearl`, `iron_ingot`, `carrot`, `grass_block`, `redstone`, `sugar`, `stick` to `"stack"`. Profile changes
  go live with `live.mjs settings` / edit / `set`.
- Later: trial 6 of S2e-fu (bottles of different strengths, two banner stacks, an enchanted bow; the owner has none
  now); then the S3 design check. Coming back after a far respawn is not built ("come to me" needs him within sight;
  the End needs portal coordinates): a survival and navigation topic.
- The operator is running (started 2026-11-12 evening as a background job of the persistent session, log
  `runtime/logs/operator-start-20261112c.log`).

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
