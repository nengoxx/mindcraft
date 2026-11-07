# Maintained Mindcraft fork

This checkout is Mindcraft only. It preserves the upstream repository history,
layout and default configuration while carrying a reviewed local compatibility
and behavior patch set. Broader comparisons with other Minecraft frameworks are
outside this repository; Mindcraft is not declared the final architecture.

Upstream baseline: `e1c1fc3ffa481506c2445fc639e16dba504b5920`. `upstream` tracks
the official repository; `origin` is this fork. The accepted executable migration
baseline is `01fa9b08995222b058085ded311c874e0b817761`, published on `develop`;
the local `develop` tracks `origin/develop`. Do not blindly upgrade dependencies or retire a carry just because a
version advanced. Verify equivalent upstream behavior first.

Linux migration is live: the prior host was stopped before state transfer, and
the new foreground session joined survival with the retained position/inventory.
Negotiated client protocol, a model-selected native crafting action, literal
movement and task stop passed smoke checks. The model then falsely reported no
crafting change; a backticked command mention also triggered an unwanted zero-arg
execution attempt. Truthful reporting and general task reliability did not pass.
Owner in-game chat was not retested; the smoke used the local UI owner channel.
Windows native parse/config and isolated proxy Start/Status/Stop passed; the full
adapted combined desktop lifecycle is not requalified. No completed autonomous
house or improvement from the higher request budget is claimed.

Start with [operator setup](../operator/README.md), [changes](CHANGES.md) and
[known issues](ISSUES.md). An installed local checkout also has an ignored
`runtime/diagnostics/HANDOFF.md` with its operator/session snapshot and private
evidence pointers; that file is absent from fresh public clones.
Private settings/profile/history/tools stay in ignored
`runtime/`; nothing in these notes authorizes resuming a stopped task. Never launch
the same game identity on two hosts at once. The previous deployment is retained
as rollback and must remain stopped while this identity is live here. Current
components remain connected with the task stopped; no old building task is queued.

For Codex, start in this repository, for example `codex -C /path/to/mindcraft`,
and resume its session from the same checkout. Concurrent editing sessions use
separate Git worktrees, not the same working tree. Each worktree has its own
ignored runtime; do not duplicate a live bot or copy private state into commits.
No global Codex/provider configuration or repository instruction file is required.

The C09/C12 investigation produced local source candidates and offline regressions
(see changes/issues). Crafting now supplies explicit observed before/after counts;
quoted command mentions are excluded from parsing. These changes are not deployed:
the existing connection was preserved. The next qualification is a separately
authorized reload and controlled model/game trial, checking the report against
independent pre/post inventory evidence. Hut construction, semantic memory and
broader autonomous task coherence remain open; preserve model-versus-executor
distinctions.
