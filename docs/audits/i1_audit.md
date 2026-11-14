# I1 task layer audit ledger — ID prefix I1

## Status
| ID | Title | Sev | Status |
|---|---|---|---|
| I1-1 | A decision waits for a concurrent memory summary on the one backend | M | fixed |
| I1-2 | Memory summaries spend about three quarters of their tokens on reasoning | M | fixed |
| I1-3 | The prompt cache is reused only to a message boundary; the decision's first message is the whole changing system prompt | M | open |
| I1-4 | The clear step's stand cell accepts only `air`; a box in a cave stalls, then blocks with no cause | M | fixed |
| I1-5 | The work layer's own history lines bring summaries forward | L | fixed |
| I1-6 | Obtain's no-gain rule misfires when the target item is her scaffold block | L | fixed |
| I1-7 | Outside a run the tree test runs uncached inside every path search | L | open |
| I1-8 | With digging off the safeToBreak patch still runs the protection predicate first | L | fixed |
| I1-9 | A mode that fails (not interrupted) while it cuts the task run clears the resume slot | L | fixed |
| I1-10 | The give step's 30 s confirm window is cut at about 20 s by `unstuck` | L | fixed |
| I1-11 | A persisted automatic recipe choice overrides the inventory (REQ-OBT-4 vs the code comment) | L | fixed |
| I1-12 | `pickupNearbyItems`' no-dig movements are discarded by `goToGoal` | L | fixed |
| I1-13 | The owner's long non-resumable action during a task runs into the stall rule | L | fixed |
| I1-14 | An exception in `Work.init` exits 0, so the bot is not restarted | L | fixed |
| I1-15 | A decision ending on `finish_reason` "length" is re-sent with one turn fewer, repeatedly | L | fixed |
| I1-16 | Task-command lines bypass the owner-output queue | L | fixed |
| I1-17 | The stall accumulator rounds every write to 0.1 s | L | fixed |
| I1-18 | SPEC line references into the carried files are stale | L | wontfix: about 131 references; a later doc pass |

## Runs
### 2026-11-14 — the I1 task layer (src/agent/work and the carried files it uses), standard
Scope: the task layer as built through the reliability 1 slice; the operator, the template builder and S3+ are
out. Commissioned by the owner: "before S3 I want to be sure that everything is consistently reliable."
Baseline: develop `9c9746d`, clean; gate 650/650. Lanes: two Opus audit lanes split by area (A orchestration,
state and timing; B world interaction), then one Opus adversary on both reports and the main seat's draft; the
main seat verified every H/M card (reproductions against the request log for I1-1/2/3, the code for I1-4/7).
Lane reports, the adversary's report and the rulings: kept in the ignored runtime diagnostics (reliability/).
Coverage: lane A read `work/index.js, runner.js, record.js, commands.js, report.js, chat.js, view.js, plan.js,
travel.js, combat.js, config.js` and the carried `action_manager.js, modes.js, agent.js, self_prompter.js,
mindserver_proxy.js, prompter.js, gpt.js, openai_tools.js`; lane B read `work/inventory.js, gear.js, sleep.js,
protect.js, ledger.js, tidy.js, dig.js, climb.js, resolve.js, ask.js, steps/*` and the carried `skills.js` /
`world.js` parts; both skimmed PLAN and CHANGES. Ran: the gate on copies (650/650; lane B's suites 345/345),
offline probes for I1-4, I1-7, I1-9, log measurements over `requests.jsonl` since 2026-11-11.
Stopped because: scope done. Findings are not exhaustive.
- non-risk: no lost work, loop, hang or stale-state read was found in the orchestration core (tasks, resume,
  stop/cancel, crash restarts, owner chat during a task) — lane A, confirmed by the adversary's gap hunt.
- dismissed: a separate card for the eight copies of the air-name set — they agree except `clear.js:169`, which is
  I1-4 (one root cause).
- dismissed: I1-3's first stated cause (the task view early in the prompt) — reuse stops at message boundaries, so
  reordering inside the one system message gains about nothing; and "a summary between decisions evicts the
  cache" — 8 of 8 such cases still hit.
- residual (fix review, 2026-11-14): during a long engine stall the doubled summary deadline resets after any
  completed request, a failed stand-in reply included, so each publication first loses one cut at the base
  deadline (~120 s); bounded and self-recovering.

## Findings

### I1-1 — A decision waits for a concurrent memory summary on the one backend
Severity: M
Location: `src/agent/history.js` (the summary call), `src/models/prompter.js` (decision and summary requests)
Trigger → consequence: a turn whose history crosses the summary threshold starts a summary at about the moment the
decision is sent → the backend serves one request at a time, so the decision waits for the summary: since
2026-11-11, 61 of 132 decisions overlapped a summary, median 33.5 s against 14.2 s alone.
Evidence: reproduced — `requests.jsonl` intervals (main seat and adversary agree); seen in game (every trial since
2026-11-11).
Fix direction: let a decision go first (defer or abort a summary when a decision starts; or summarise after the
reply); with I1-2. Test: a decision during a summary is sent first, or the summary is deferred.

### I1-2 — Memory summaries spend about three quarters of their tokens on reasoning
Severity: M
Location: `src/models/prompter.js` (the summary request's params), the profile's model params
Trigger → consequence: every summary (about one per decision) → median 544 completion tokens, about 76 % of them
reasoning; summaries used as much model time as decisions (4221 s vs 4168 s since 2026-11-11).
Evidence: reproduced — `reasoning_chars` against `completion_tokens` in `requests.jsonl`; seen in game.
Fix direction: per-kind request params (reasoning off, or a small budget, for summaries). Test: a summary request
carries the summary params; a decision keeps its own.

### I1-3 — The prompt cache is reused only to a message boundary; the decision's first message is the whole changing system prompt
Severity: M
Location: `src/models/gpt.js` (the messages it builds), `src/models/prompter.js` (the system prompt assembly)
Trigger → consequence: each decision sends one system message of 19–21 k characters with its changing parts (task
view, inventory, time) inside it → the backend's reuse stops at the first changed message, so almost nothing is
reused: 14 of 234 decisions hit; 12 of 16 decisions whose prompt extended an earlier one by whole messages hit,
2 hits otherwise. Re-reading the prompt is about 13 s of a ~15 s decision (2.65 ms per uncached prompt token).
Evidence: reproduced — `requests.jsonl` (`cached_tokens`, prompt prefixes); the backend's reuse granularity is
inferred from the log, not probed.
Fix direction: send the static part (rules, command docs, examples) as its own leading message(s) and the live
state after; first a short probe of the backend's reuse granularity. Natural home: the I2 provider
(`openai_tools.js`). Test: two consecutive decisions share their leading messages byte for byte.

### I1-4 — The clear step's stand cell accepts only `air`; a box in a cave stalls, then blocks with no cause
Severity: M
Location: `src/agent/work/steps/clear.js:169` (`standCell`)
Trigger → consequence: a clear box with `cave_air` above its top layer → she never steps off the cells under her,
they are never dug; no progress for `step_stall_s` (10 min), then the step blocks with "last: no cause recorded"
and the model is asked; a resume repeats it.
Evidence: reproduced — offline (lane B and the adversary): `air` above → done; `cave_air` above → active, 1 cell
left. Theoretical in game (not seen).
Fix direction: one standable test shared with the other modules' empty-block sets (`air`, `cave_air`, `void_air`),
and a recorded cause for the soft refusal. Test: the cave box completes.

### I1-5 — The work layer's own history lines bring summaries forward
Severity: L
Location: `src/agent/work/chat.js`, `report.js` (history writes); SPEC REQ-CHAT-1, §11
Trigger → consequence: tidy, restart and behaviour lines go into the model's history → more turns per summary
(trial period: 101 tidy and 52 restart lines of 601 turns); fewer in normal play.
Evidence: reproduced — history files (trial period, many restarts).
Expected: ? — SPEC says these lines always go into history; a change needs the owner's ruling.
Fix direction: keep the lines out of the summarised window, or merge them; with I1-1/I1-2.

### I1-6 — Obtain's no-gain rule misfires when the target item is her scaffold block
Severity: L (M if it repeats: three in a row block the step with a false cause)
Location: `src/agent/work/steps/obtain.js` (the gain check), the pathfinder's scaffold blocks
Trigger → consequence: an obtain of dirt or cobblestone, the pathfinder's default scaffold → the collect places some
of what it gathers, the count after the call shows no gain → "collected dirt but got no dirt" uses one of three
attempts (seen once in the clean T5 run, 2026-11-14, before the step finished).
Evidence: read; seen in game once.
Fix direction: count gain as the count after the call plus the target items placed during it (the ledger records
placements by action). Test: a dirt collect that places dirt counts the gain.

### I1-7 — Outside a run the tree test runs uncached inside every path search
Severity: L
Location: `src/agent/work/protect.js:70-84` (`newRun`/`endRun`), `:392-405` (the safeToBreak patch)
Trigger → consequence: walks, follows and fights near trees outside a task → each log the search meets is
re-tested; offline a search slice explored 2.5–4.7× fewer nodes; in 4 days of logs 5 planning timeouts, none tied
to trees.
Evidence: read; offline measurement; not seen in game.
Fix direction: measure a forest walk outside a task first; then a per-search memo as inside a run.

### I1-8 — With digging off the safeToBreak patch still runs the protection predicate first
Severity: L
Location: `src/agent/work/protect.js:398-403`
Trigger → consequence: a no-dig search → the full protection test (tree tests included) before the base check that
refuses anyway; wasted search time.
Evidence: read.
Fix direction: call the base check first when `canDig` is false. Test: no protection call for a no-dig movement.

### I1-9 — A mode that fails (not interrupted) while it cuts the task run clears the resume slot
Severity: L
Location: `src/agent/modes.js:355`, `src/agent/action_manager.js:145` (`cancelResume`)
Trigger → consequence: unstuck's move or self_preservation throws while it cuts `action:task` → the resume slot is
cancelled, the AUTO MESSAGE reaches the model (one call), the task waits about 15 s for the self-heal.
Evidence: reproduced — offline probe (lane A); 0 of 26 such mode ends threw in the logs.
Fix direction: a mode's own failure keeps the task's resume slot. Test: a throwing mode during a run resumes it.

### I1-10 — The give step's 30 s confirm window is cut at about 20 s by `unstuck`
Severity: L
Location: `src/agent/work/steps/give.js:15`, `:82-89`; `src/agent/modes.js:101`
Trigger → consequence: she stands still waiting for the owner to pick up → unstuck fires after 20 s → the window is
about 18–20 s.
Evidence: read.
Fix direction: pause unstuck during the confirm wait, as obtain's craft does. Test: the wait lasts its window.

### I1-11 — A persisted automatic recipe choice overrides the inventory
Severity: L
Location: `src/agent/work/resolve.js:157-169`
Trigger → consequence: a wood choice made at the first unit is persisted and reused → she may go for logs she cannot
find while others are in her bag.
Expected: ? — SPEC REQ-OBT-2/4 persist only explicit choices and take the first recipe the inventory allows; the
code comment says the persistence is intended.
Evidence: reproduced — offline (lane B).
Fix direction: persist only explicit choices, or amend the SPEC; the owner's or the main seat's ruling.

### I1-12 — `pickupNearbyItems`' no-dig movements are discarded by `goToGoal`
Severity: L
Location: `src/agent/library/skills.js:779-783` against `goToGoal` `:1373-1405`
Trigger → consequence: chasing a dropped item → `goToGoal` builds its own movements → the chase may dig.
Evidence: read.
Fix direction: pass the caller's movements through. Test: a pickup chase never digs.

### I1-13 — The owner's long non-resumable action during a task runs into the stall rule
Severity: L
Location: `src/agent/work/index.js:586-601`
Trigger → consequence: a long typed action while a task is active → stall time accrues → the step can block "no
progress".
Evidence: read.
Fix direction: hold the stall clock while an owner action runs.

### I1-14 — An exception in `Work.init` exits 0, so the bot is not restarted
Severity: L
Location: `src/agent/agent.js:145-147`
Trigger → consequence: a throw in the work layer's start-up → the process exits 0 → the operator does not restart it.
Evidence: read. The lane's fix (exit non-zero) would not restart a crash within 10 s of start (the process
retry's rule).
Fix direction: log loudly and stay up without the work layer, or a bounded retry; a test with a throwing init.

### I1-15 — A decision ending on `finish_reason` "length" is re-sent with one turn fewer, repeatedly
Severity: L
Location: `src/models/gpt.js:51-52`, `:77-79`
Trigger → consequence: a reply cut by the token limit → re-sent with shorter context up to about 15 times; a summary
falls to the stand-in reply. 0 decisions and 1 summary ended on length since 2026-11-11.
Evidence: read; log counts.
Fix direction: one retry, then the outage path.

### I1-16 — Task-command lines bypass the owner-output queue
Severity: L
Location: `src/agent/work/commands.js:68-73`
Trigger → consequence: a task confirmation is sent directly → it can interleave with paced lines.
Evidence: read.
Fix direction: send through `deliver`.

### I1-17 — The stall accumulator rounds every write to 0.1 s
Severity: L
Location: `src/agent/work/index.js:593`
Trigger → consequence: a step that writes more often than every ~50 ms with no progress → each increment rounds to 0
→ the stall rule never fires.
Evidence: read.
Fix direction: accumulate unrounded, round for display. Test: 100 writes 10 ms apart add about 1 s.

### I1-18 — SPEC line references into the carried files are stale
Severity: L
Location: `docs/SPEC.md` (e.g. `agent.js:278-300`, `modes.js:317-322`)
Trigger → consequence: a later session follows a line reference to moved code.
Evidence: read.
Fix direction: refer to functions, not line numbers.
