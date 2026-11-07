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

The C09/C12 changes are committed as `4fd27e5` and deployed by an authorized
agent-only restart. Crafting supplies observed before/after counts; quoted command
mentions are excluded from parsing. Offline regressions and one guided live craft
report/quoted-mention exchange passed. Broader truthfulness remains open.

The owner then authorized a fresh autonomous small-house trial. Qwen is the sole
in-game orchestrator: one natural-language objective, no supervisor build plan,
coordinates, material list or mid-task steering. Only critical problems or a
demonstrated stall justify stopping the trial. Observe and improve the harness
between trials; do not count supervisor gameplay as model competence. See the
private runtime handoff for the live trial state and evidence. Hut construction,
semantic memory and broader task coherence remain open.

The first such trial was stopped incomplete after recurrent movement/search
following a terrain-preparation timeout. It motivated two reproduced harness
fixes: site filtering before the search result limit (C13), and retaining generated
action partial output on interruption/timeout (C14). Offline regressions pass;
the runtime handoff records deployment and subsequent trial status. Neither fix
constitutes a completed-house or general reliability qualification.

A second uncoached trial also failed to establish a site or house. It exposed
misleading biome observations: the static version table was used for server
registry IDs (C15). The observer now uses the negotiated registry, with regression
coverage for remapped/custom/unknown biomes. Runtime receipts own live validation;
do not infer construction competence from these harness corrections.

Current executable commit is `5459fbe` (including C13/C14 `924eb2a`); deployed by
agent-only restarts. The second house trial was stopped after 7m01s with no verified
house blocks. After the final reload, read-only status at identical coordinates
changed from the incorrect frozen_ocean label to forest. All 33 focused checks pass.
That snapshot preceded the next authorized retest. All three code commits are
local on develop and have not been pushed in this continuation.

The third uncoached trial used the biome fix and stopped after 6m34s with no
verified house construction. Qwen resumed its goal after combat, but travelled
among remembered grass locations and received three rejected builds. C16 now
corrects independently reproduced template-padding validation and reports exact
first-issue coordinates/blocks/requirements through the existing builder. All 38
focused tests and the runtime-method check pass. See the private runtime handoff
for deployment and subsequent live trial status; do not infer a completed house
or resume a failed trial from these notes.
