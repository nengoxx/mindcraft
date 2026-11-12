# Mindcraft fork: project notes

## Priorities (the owner's words)
- The owner's local Qwen model drives the bot. Claude operates her only for tests; in a trial Qwen alone orchestrates (PLAN §2.2).
- "The end result and the priorities are for Qwen to drive the bot, the agent, effectively, to be capable to do all of the features that we want."
- "The second priority [...] is for Qwen to be efficient and fast." Trials measure it: model calls and latency (PLAN §2.3).

## Start here
- Session state and the next step: `docs/HANDOFF.md`. Owner rulings: `docs/DECISIONS.md` (they win over SPEC).
- Docs: SPEC what and why · PLAN how and in what order · DECISIONS rulings · ISSUES defects and live-trial records · CHANGES carried upstream changes · RESEARCH facts behind the design.
- Design councils, reviews and rulings live in `runtime/diagnostics/i1-build/` (ignored, not in git).

## Tooling
- Node is private to this checkout (DECISIONS 2026-11-08, self-contained): `runtime/tools/node-*/bin/node`, the one `operator/mindcraft.sh` picks (`MINDCRAFT_NODE` overrides). Don't use a system Node.
- Offline gate: `TMPDIR=<scratch dir> <node> --experimental-test-module-mocks --test tests/*.test.mjs`, plus the operator checks in `operator/README.md`.
- Operator (MindServer, ViaProxy and the agent): `operator/mindcraft.sh start|status|stop`. Run `start` as a background job of the session, logging under `runtime/logs/`.
- Live-test helper: `<node> operator/live.mjs state|listen|say|settings|set|restart`. `say` speaks as the owner; see its header.
- A profile change reaches the running bot only through `set-agent-settings` (`live.mjs settings`, edit, `live.mjs set`); an agent restart keeps the cached profile.
- Whispers are not logged on the host; `[chat] quiet: dropped` lines show what quiet chat hid.

## Live testing (PLAN §7)
- Keep her in game. Restarts are allowed any time; deploy by an agent-only restart.
- An agent-only restart is a crash restart: an active task resumes. Finish or cancel tasks before deploying.

## Public fork
- Tracked files carry no hosts, accounts, names ("the owner") or private paths; those stay in the ignored `runtime/`.
- Push rules are the user-level ones (push only on the owner's word).
