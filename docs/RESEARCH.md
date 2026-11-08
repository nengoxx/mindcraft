# Research summary

Facts behind the [specification](SPEC.md), condensed from two research dossiers
and a design council (November 2026). Numbers are as found on 2026-11-08 unless
stated. Markers: **V** verified from source code, docs or an API; **R** reported
by a secondary source; **M** measured by a probe during the council.

## 1. The local model and its cost

- The bot runs a quantized Qwen3-class model on the owner's own GPU through an
  OpenAI-compatible backend, one request at a time, with an explicit reasoning
  budget of 2048 tokens and `max_tokens` 8192.
- One decision measured exactly (**V**, a replayed request): 13,389 prompt tokens,
  2,213 completion tokens, 74.75 s, about 30 completion tokens per second end to
  end. Latency is dominated by reasoning tokens, not by the prompt.
- Without an explicit reasoning budget, single decisions ran 140–160 s with no
  action (**V**). The budget field must always be sent.
- Typical wall time per decision in agent trials: about 50–70 s (**V**, derived from
  trial logs); 20–28 s per request including actions in this fork's trials.

## 2. Mindcraft (upstream) and this fork

Upstream: <https://github.com/mindcraft-bots/mindcraft>.

- **Activity (V).** `develop` at `e1c1fc3` (2026-10-26). 7 commits on develop since
  2026-05-08, about 2 of them touching code. Merged PRs per month from 2026-05 to
  2026-11: 1, 2, 0, 0, 0, 2, 0. Last release v0.1.4 (2026-03-20). About 6k stars,
  26 open PRs.
- **Fork divergence (V).** 17 source files, +513/−190 lines against upstream,
  touching 8 core-loop files (agent.js, prompter.js, history.js, action_manager.js,
  coder.js, commands/index.js, actions.js, queries.js); modes.js, self_prompter.js
  and the MindServer files are untouched. See [CHANGES.md](CHANGES.md).
- **Relevant upstream PRs (V).**

| PR | What | State |
|---|---|---|
| [#769](https://github.com/mindcraft-bots/mindcraft/pull/769) native tools | OpenAI-style tool calls: `tool_adapter.js` (170 lines) maps command params to JSON schema and executes calls; text commands refused in tool mode. Also a provider registry, a Codex login, deletes 17 model files, +574 lines in history.js, a UI. +10,622/−2,800 in 115 files. | Open since 2026-05-01, no review. Against this fork: 9 conflicting files, 28 hunks plus one modify/delete. |
| [#812](https://github.com/mindcraft-bots/mindcraft/pull/812) task controller | Observe/plan/act/verify, persisted progress, `!taskStatus`; edits 8 upstream files. | Open, no maintainer reply. |
| [#859](https://github.com/mindcraft-bots/mindcraft/pull/859) prompt reorder | Stable prefix grew from 142 to 8,550 characters on the default profile (**R**). | Opened 2026-11-08. |
| [#842](https://github.com/mindcraft-bots/mindcraft/pull/842) | Stops the `***` stop marker mutating OpenAI-compatible prompts. | Open. |
| [#854](https://github.com/mindcraft-bots/mindcraft/pull/854) | Regenerates the Mineflayer 4.39 patch (overlaps the fork's patch). | Open. |
| [#636](https://github.com/mindcraft-bots/mindcraft/pull/636) enhanced coding | Coding-agent tools for the coder. | Closed. |

- Issues: [#858](https://github.com/mindcraft-bots/mindcraft/issues/858) lists 15
  long-run bugs (including non-managed building killed by the infinite-loop guard,
  and duplicated merged turns); [#846](https://github.com/mindcraft-bots/mindcraft/issues/846)
  reports the 10 s stop watchdog causing 82 exits in 89 sessions over 8 hours (**R**).
- **Loop facts (V).** Only `!followPlayer` is resumable. Memory summaries cut at
  500 characters. Responses are discarded when a newer message arrives during
  generation. The dynamic `$STATS`/`$MEMORY` sections come before the static command
  docs, which defeats prefix caching. `strictFormat` sends the system prompt as a
  `user` message prefixed "SYSTEM:" and merges same-role turns.
- **Prompt sizes (V).** The deployed conversing prompt: 2,718 characters plus
  `$COMMAND_DOCS` (57 commands, about 6.3k characters) and examples; about 5–7k
  tokens per conversation request (estimate). The coding prompt includes all 49
  skill docs (about 29.3k characters) when `relevant_docs_count` is −1.
- **Measured trials in this fork (V).**

| Trial | API requests | Of which summaries | Duration |
|---|---|---|---|
| 1 | 34 | 9 | about 18 min |
| 2 | 21 | 6 | 421 s |
| 3 | 21 | 6 | 394 s |
| 4 | 29 | 7 | 810 s |

  Summaries were 26–30 % of all requests. A saved memory of exactly 500 characters
  was cut mid-sentence, and about 70 % of it was coordinates.

## 3. Pi agent SDK

Repository: <https://github.com/earendil-works/pi> (formerly `badlogic/pi-mono`).

- **Packages (V).** `pi-coding-agent`, `pi-ai`, `pi-agent-core` and others (12 in
  the repo). MIT. About 120k stars.
- **Churn (V).** 61 releases of `pi-coding-agent` since 2026-05-08; 1.0.0 on
  2026-10-01; latest 1.5.0 (2026-11-02). Breaking-change sections in 0.83.0, 0.84.0,
  0.84.3, 0.86.0, 0.87.0, 1.0.3, 1.2.0 and 1.5.0.
- **Size (V).** `pi-agent-core` 274 KB unpacked; `pi-coding-agent` 24 MB unpacked,
  178 MB installed with dependencies. Node ≥ 22.19. Install telemetry defaults on.
- **Features (V).** Custom tools with abort signals and argument coercion (1.5);
  hooks before and after provider requests and tool calls; JSONL session persistence;
  compaction; `steer()` lands only after the current turn's tool calls finish;
  an RPC mode in which clients cannot register tools; a QuickJS "codemode".
  **No plan mode, no scheduler, no task record** ("skips features like sub-agents
  and plan mode"). `pi-durable` (resumable runs) is labelled experimental.
- **Evidence with the same local model (V),** from a parked Pi-based Mineflayer
  harness: native tool calls parsed reliably once the reasoning budget was sent
  (14 of 14 requests). 49 tools were about 30.7 KB of schema JSON in a 13.4k-token
  prompt. Batch tools worked (31 blocks cleared in 3 calls, 16 planks in one). No
  house was completed in any trial. Most failures were in the Mineflayer body
  (protocol decoding, defense, scaffolding, inventory), then loop design, then
  model grounding (wall rows placed before a foundation; invented counts). The
  harness had to write its own scheduler of about 530 lines.
- No known project delivers gameplay results with Pi.

Alternatives in the same class (**V** versions, **R** features): Vercel `ai` 7.x
(tool loop, no persistence); OpenAI Agents JS 0.21 (sessions, guardrails); Mastra
1.82 (89 MB; workflows with suspend/resume); LangGraph.js 1.7 (checkpointers,
interrupts); or a plain `fetch` loop. None provides a game task layer.

**Conclusion used in SPEC §5:** Mindcraft already has the model-to-tool loop Pi
would provide; the missing parts (task memory, resume, building) Pi does not
provide either; Pi is the fast-moving dependency.

## 4. Prior art

| Work | What it shows |
|---|---|
| Voyager ([2305.16291](https://arxiv.org/abs/2305.16291)) | GPT-4 writes Mineflayer skills into a library; no building; GPT-3.5 much worse at code. |
| MINDcraft / MineCollab ([2504.17950](https://arxiv.org/html/2504.17950v1)) | 47 tools plus generated code; construction from procedural **blueprints**. Success (crafting / cooking / construction): claude-3.5-sonnet 0.47/0.64/0.36; gpt-4o 0.17/0.40/0.31; llama3.3-70b 0.16/0.36/0.19; **llama3-8b 0.00/0.01/0.00**; llama3-8b fine-tuned 0.28/0.18/0.20. |
| Odyssey ([2407.15325](https://arxiv.org/html/2407.15325v3)) | 40 primitive + 183 compositional skills, top-5 retrieval, JSON subgoal plans; open models "prone to generating hallucinations". |
| Plan4MC ([2303.16563](https://arxiv.org/abs/2303.16563)) | LLM-built skill graph searched for plans. |
| GITM ([2305.17144](https://arxiv.org/abs/2305.17144)) | Goals decomposed into structured actions; ObtainDiamond +47.5 %. |
| JARVIS-1 ([2311.05997](https://arxiv.org/abs/2311.05997)), Optimus-1 ([2408.03615](https://arxiv.org/abs/2408.03615)) | Multimodal planners over goal-conditioned controllers; not small local models. |
| MineAnyBuild ([2505.20148](https://arxiv.org/html/2505.20148v3)) | Spatial-plan scores out of 10: Gemini-1.5-Pro 3.53, **Qwen2.5VL-7B 1.29**, Qwen2.5VL-3B 0.63: "severe limitations" in spatial planning. |
| APT ([review](https://www.themoonlight.io/review/apt-architectural-planning-and-text-to-blueprint-construction-using-large-language-models-for-open-world-agents)) | LLM text-to-blueprint with GPT backends (**R**). |
| Andy-4.2 ([model card](https://huggingface.co/Mindcraft-CE/Andy-4.2)) | A Qwen3.5-9B fine-tune for Mindcraft commands (2,748 examples); admits weakness in building. |

Builder libraries: [mineflayer-schem](https://github.com/AnonymoDGH/mineflayer-schem)
(builds `.schem/.litematic/.nbt` with pause/resume; survival correctness unknown);
[prismarine-schematic](https://github.com/PrismarineJS/prismarine-schematic)
(reads and writes schematics); [mineflayer-builder](https://github.com/PrismarineJS/mineflayer-builder)
("not an usable package"; creative and op); Baritone's `build` ([usage](https://github.com/cabaletta/baritone/blob/1.19.4/USAGE.md),
a client mod, reference only).

**What transfers:** every system that worked kept low-level control deterministic
and had the model choose among skills; every building success used a blueprint,
not model-generated per-block geometry; small models needed fine-tuning or a
reduced tool list; no paper describes resuming a task after combat.

## 5. Small models and tool calling

- Qwen's guidance ([function calling](https://qwen.readthedocs.io/en/latest/framework/function_call.html)):
  Hermes-style tool use for Qwen3; stop-word templates such as ReAct are not
  recommended for reasoning models; protocol adherence is "not guaranteed".
- Fewer tools help: Less-is-More ([2411.15399](https://arxiv.org/abs/2411.15399))
  reports better success and up to 70 % less execution time on edge hardware;
  RAG-MCP ([2505.03275](https://arxiv.org/abs/2505.03275)) raises tool selection
  accuracy from 13.62 % to 43.13 % by retrieving tools first.
- CodeAct ([2402.01030](https://arxiv.org/abs/2402.01030)): code actions up to 20 %
  better than JSON/text actions across 17 models.
- Hence SPEC §12: about 16 tools, schemas under 8 KB, plans as typed JSON, no
  generated code on the tool path.

## 6. What a vanilla client can know

- **Blocks (V).** Full chunk sections inside the server's view distance, including
  underground ores, caves, lava and spawners. Mineflayer requests view distance
  "far" (12); the vanilla server default is 10 chunks, so the effective radius is
  about 160 blocks. `findBlocks` uses a spherical radius test.
- **Biomes (V).** Per loaded chunk, through the negotiated registry.
- **Entities (R).** Only those the server tracks: vanilla ranges depend on type
  (roughly 96–160 blocks); Spigot/Paper defaults are about 48. Villager profession
  is in entity metadata (**V**).
- **Structures (V).** No structure data is sent. `/locate` needs operator level 2.
  Recognition from loaded marker blocks is possible but heuristic.
- **Anti-xray (R).** A Paper/Purpur option, off by default; engine mode 1 hides
  ores outright. Not applicable to a vanilla server.

## 7. Council process and probe results

The design was reached by three blind proposals, an independent review and an
adversarial review with confirm rounds, then a second council for the extensions
(any structure; find and gather anything). The owner approved it on 2026-11-08
([DECISIONS.md](DECISIONS.md)).

Adversarial probes (**M**), all offline, no model or game:

| Probe | Result |
|---|---|
| Resumable runner interrupted by a mode (real ActionManager, copied mode `execute`) | finished 20/20 over 2 runs, no model call |
| Same with the self-prompter active | stuck at 5/20 with the resume function still set |
| Resumed run hitting its timeout (shortened to 300 ms) | stuck at 8/20: no `idle` after an interrupted run |
| Nested `runAction` inside a running action | process kill after exactly 10.0 s (stop watchdog) |
| Existing site check, 5×5 shell: plain grass | rejected (`short_grass`); accepted with a `solid` class |
| … natural stone where a wall cell is | rejected; accepted with `solid` |
| … dug into a hill | rejected; accepted with `solid` |
| … tree trunk in the footprint | rejected in both (correct) |
| … chest in a floor cell | accepted in both, and then broken by placement: needs a protection rule |
| 180k prismarine-world `getBlock` calls | 52 ms (0.29 µs each): fit search costs well under a second |

Claims the council found false or overstated: `!goal` is not blockable (it is in
the unblockable list); the "13,384 of 13,389 tokens cached" figure came from
re-sending an identical request, not from consecutive turns; the resumed-run
timeout is a missing stored timeout, not an argument-order bug; `digDown` checks
only the target and the block below for liquid; orange terracotta alone does not
mark a desert temple (badlands are made of it); "dark oak ≥ 150" would match the
dark forest itself unless it means planks.

Unprobed predictions (to be measured in S0, PLAN §4): door facing follows the
bot's yaw at placement (from reading `placeBlock`, which looks at the support block
before placing), so a verifier must check it (probe P8); the client inventory may
go stale after furnace use, since upstream restarts after every smelt (probe P9).

Code facts found during the doc reviews: minecraft-data ships crafting recipes but
no furnace recipes, so smelting needs its own table; `collectBlock` and the collect
plugin turn the pathfinder's liquid and falling-block safety flags off, and both
flags are read only inside `Movements.safeToBreak`; MindServer's "start agent"
starts the process the same way as a crash restart; a command's result is
written to history as a system string, so structured results must be serialized;
Mineflayer's `blockPlaced` event reports only the destination cell, so the second
cell of a door or bed is not seen.

## 8. Measurements from S0

To be added after the S0 probes (PLAN §4), sanitized: tool-call parse rate,
cache behaviour, R_load, entity ranges, ladder and door behaviour, post-furnace
inventory, signature block presence, baselines.
