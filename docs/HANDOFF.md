# Handoff

## 2026-11-08 (evening) — S0-lite and S2 built; S2 live trials and S3 next

### Where things stand

- **S0-lite** is committed and deployed: request logging (`requests.jsonl`, provider
  `openai_tools`), probe P11, and the two baselines (RESEARCH.md §8.1–8.2).
- **S2** is committed (task record, runner and resume, `!taskStart` and the step
  DSL, the surface obtain resolver, protection, the persisted ledger, junk drop,
  reports from facts). Reviewed by Sol and an Opus adversary over two fix waves and
  the main seat's final rulings; residuals are in ISSUES.md "Iteration 1 residuals".
- Plan changes from the review (PLAN and SPEC updated): `!buildStructure` stays
  available until S3 (S2 ships before the shelter); owner `!stop` cancels any
  unfinished task; farmed plants (sugar cane, bamboo, cactus, berries, kelp) are
  protected as possible farms; allays and golems are never attacked.
- The bot runs the S2 code with the S2 profile (private patch applied on the
  installed checkout).

### Exact next step

1. Run PLAN S2's four live trials (uncoached; §2.2 protocol; record each attempt):
   "get 40 oak planks" at dusk with a mob interruption; a `!restart` crash
   mid-task; an operator Stop/Start mid-task (owner connected); "make me a stone
   pickaxe" from an empty inventory. Compare with the baselines (14 and 22 calls).
2. Then S3 (terrain-fitting shelter), in a clean session: PLAN §3 S3. The probe kit
   for P8 is 1 oak door and 8 dirt. S3 also moves the `!buildStructure` block and
   the construction examples to `!build` (PLAN S3 profile bullet).

### Notes

- To start the bot with fresh memory: full operator Stop, archive the bot's
  `memory.json`, then Start. An agent-only restart saves the running history on
  exit and loads it again, so it cannot give a fresh start.
- The backend slowed about 30× once (a 551 s request) until it was restarted;
  if trials look stalled, check model latency in `requests.jsonl` first.

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
