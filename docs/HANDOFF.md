# Handoff

## 2026-11-08 — specification and plan written; next is S0

### Where things stand

- The owner chose this fork as the base and approved the task-layer design
  ([DECISIONS.md](DECISIONS.md)). The design is written up in [SPEC.md](SPEC.md);
  the build order in [PLAN.md](PLAN.md); the research behind it in
  [RESEARCH.md](RESEARCH.md). No task-layer code exists yet.
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

### Exact next step: S0, in a clean session

1. Read SPEC.md, PLAN.md (§2, S0 and §4), DECISIONS.md, ISSUES.md and CHANGES.md.
   On an installed checkout, also read the private `runtime/diagnostics/HANDOFF.md`
   for operator detail (paths, receipts, evidence); it is absent from public clones.
2. Confirm no other client is connected with the bot's identity.
3. Before the first start or restart, archive the bot's saved runtime memory
   (`memory.json` in the bot's folder under the runtime directory) by moving it
   aside. Reason: agent-only restarts always load it, and a fresh start without an
   incoming message saves nothing to replace it.
4. Ask the owner to start the game server (only he can), and for the S0 probe kit
   (PLAN §4: ladders, a door, dirt, a furnace, smelt inputs, coal and a wooden
   pickaxe). Then start the bot with the operator Start
   (`operator/mindcraft.sh start`, see operator/README.md) and check status
   read-only before any action.
5. Build and run S0 as PLAN describes: provider logging, request kinds, `!probe`
   (enabled only for S0), the probes P1–P12, and the two baselines.
6. Record results, update SPEC open questions and RESEARCH §8, decide the S1 route
   (tool path or DSL fallback) from probe P1 and the prompt layout (REQ-TRN-12)
   from probe P2.

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
