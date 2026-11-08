# Decisions

Owner rulings for this fork, newest last. Append-only: a later entry supersedes an
earlier one by saying so. Design rationale lives in [SPEC.md](SPEC.md) and
[PLAN.md](PLAN.md); history in [CHANGES.md](CHANGES.md) and [ISSUES.md](ISSUES.md).

## 2026-11-08 — Mindcraft is the base

The owner compared this fork with two other client-side frameworks: a Pi-SDK
Mineflayer harness and an AltoClef-based client. This fork is the base going
forward because its in-game behaviour (combat, gathering, crafting) worked
best. The other two are kept outside this repository: the Pi harness is parked,
and AltoClef is paused for a separate future project.

## 2026-11-08 — This repository is self-contained

Everything about this fork's development lives here: specification, plan,
decisions, issues, changes and handoff. An outside umbrella record may compare
frameworks and point here, but it is not required to build, run or understand
this fork. Tracked docs contain no machine-specific hosts, accounts or private
paths; those stay in the ignored `runtime/`.

## 2026-11-08 — Task layer design approved; no Pi

The owner approved the task-layer design, reached by a design council
(three blind proposals, an independent review and an adversarial review).

- The layer is our own module inside Mindcraft (`src/agent/work/`), connected
  through a few small hooks.
- It does not use the Pi agent SDK, embedded or as an external process.
  Mindcraft already has the model-to-tool loop Pi would provide; what is
  missing (task memory, resume, building skills) Pi does not provide either.
- Two triggers reopen the Pi question: our own transport/loop code growing past
  about 400 lines, or upstream adopting an SDK-based loop.
- Native tool calls come from a provider file and a copy of upstream PR #769's
  adapter, which retires if #769 merges.
- Build order S0–S4 as in PLAN.md.

## 2026-11-08 — Building fits the terrain

Build where asked and adapt to the terrain. Keep trees and natural ground
wherever they don't block the structure's function.

- A hut among trees, a cave, or a house dug into a hill are all valid results.
- Clearing, levelling and site-hunting are separate tasks, done only when asked.
- Acceptance is functional, not geometric.

## 2026-11-08 — Open-ended requests

The owner asks in natural language: "a small house here", a hut, a cave, a base,
a tower, and so on. There is no fixed short list. The system must handle that
flexibility reliably.

The same goes for resources and finding things:

- locate and gather any base-game material (wood, ores and the rest), crafting
  alongside gathering;
- find mobs, animals and villagers;
- find structures by exploring.

Vanilla limits apply. A client cannot ask the server where structures are.

## 2026-11-08 — Live testing etiquette

The game server shuts itself down after about five minutes with no player
connected, and the owner has to start it by hand.

- Keep the bot connected between tests and while implementing. Use agent-only
  restarts (quick rejoin) rather than a full stop.
- If the bot drops anyway, for example because the server kicked it for being
  AFK, tell the owner so he can start the server again.
- Never leave the bot disconnected on purpose for longer than a few minutes.
