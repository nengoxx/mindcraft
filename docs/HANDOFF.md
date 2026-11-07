# Maintained Mindcraft fork

This checkout is Mindcraft only. It preserves the upstream repository history,
layout and default configuration while carrying a reviewed local compatibility
and behavior patch set. Broader comparisons with other Minecraft frameworks are
outside this repository; Mindcraft is not declared the final architecture.

Upstream baseline: `e1c1fc3ffa481506c2445fc639e16dba504b5920`. `upstream` tracks
the official repository; `origin` is this fork. Work is prepared on
`maintained/amaia`; accepted commits can fast-forward the existing `develop`
branch. Do not blindly upgrade dependencies or retire a carry just because a
version advanced. Verify equivalent upstream behavior first.

Linux deterministic migration checks passed. Real-server migration gameplay is
not yet verified, and the adapted full Windows lifecycle is not requalified.
No completed autonomous house or general reliability improvement is claimed
by this migration.

Start with [operator setup](../operator/README.md), [changes](CHANGES.md) and
[known issues](ISSUES.md). Private settings/profile/history/tools stay in ignored
`runtime/`; nothing in these notes authorizes resuming a stopped task. Never launch
the same game identity on two hosts at once. The previous deployment remains the
cutover rollback until the new one is accepted.

For Codex, start in this repository, for example `codex -C /path/to/mindcraft`,
and resume its session from the same checkout. Concurrent editing sessions use
separate Git worktrees, not the same working tree. Each worktree has its own
ignored runtime; do not duplicate a live bot or copy private state into commits.
No global Codex/provider configuration or repository instruction file is required.

The next step is real-world verification with the prior host's bot stopped first.
Check actual negotiated protocol, owner chat, one simple native action and task
stop; keep model decision errors distinct from executor failures.
