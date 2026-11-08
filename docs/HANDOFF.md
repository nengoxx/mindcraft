# Handoff

## 2026-11-08 — specification and plan in iterations; next is I1

### Where things stand

- The owner chose this fork as the base and approved the task-layer design
  ([DECISIONS.md](DECISIONS.md)). The design is in [SPEC.md](SPEC.md), the build
  order in [PLAN.md](PLAN.md), the research behind it in [RESEARCH.md](RESEARCH.md).
  No task-layer code exists yet.
- The work is grouped into iterations (DECISIONS "Iterations and simplification";
  PLAN §1). **I1, "usable for play"**, is S0-lite → S2 → S3 on Mindcraft's text
  commands: planning, gathering and crafting, combat then back to the task, and a
  simple terrain-fitting shelter. Native tool calls are I2; later iterations stay
  specified in SPEC with their tags.
- Code: `develop` at the commit that added these docs; the last code change is
  C17 (`e67b290`). Local commits are not pushed.
- The bot is **stopped** since 2026-11-07 18:05 UTC (operator Stop; app and proxy
  down). Afterwards another client used the same bot identity, so the bot's saved
  runtime memory and history no longer match the world, its position or its
  inventory. Treat them as stale: start fresh (memory not loaded, the operator
  default) and never resume old work from them.
- Earlier work (C01–C17) made narrow harness fixes; four uncoached house trials did
  not complete a usable house. Details are in [ISSUES.md](ISSUES.md),
  [CHANGES.md](CHANGES.md) and git history.

### Exact next step: build I1, in a clean session

1. Read SPEC.md (the `[I1]` requirements), PLAN.md (§1, §2, the I1 slices, §4),
   DECISIONS.md, ISSUES.md and CHANGES.md. On an installed checkout, also read the
   private `runtime/diagnostics/HANDOFF.md` for operator detail (paths, receipts,
   evidence); it is absent from public clones.
2. Confirm no other client is connected with the bot's identity.
3. Before the first start or restart, archive the bot's saved runtime memory
   (`memory.json` in the bot's folder under the runtime directory) by moving it
   aside. Reason: agent-only restarts always load it, and a fresh start without an
   incoming message saves nothing to replace it.
4. Ask the owner to start the game server (only he can) and to hand the bot the
   I1 probe kit (PLAN §4: 1 oak door and 8 dirt, for P8 in S3). Then start the
   bot with the operator Start (`operator/mindcraft.sh start`, see
   operator/README.md) and check status read-only before any action.
5. Build S0-lite (request logging, P11, the two baselines), then S2, then S3, as
   PLAN describes; each slice is reviewed and committed before the next.
6. Open owner question to ask early in that session (SPEC OQ-20): block
   `!newAction` (generated code) outright in I1, or keep only the during-task guard?

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
