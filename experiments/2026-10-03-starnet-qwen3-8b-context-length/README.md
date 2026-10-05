# Ollama's 4k default context silently truncated StarNet's agent prompt; fixed upstream in v0.13.0, verified here (file-tool use 0/30 → 30/30)

2026-10-03/04 · Status: concluded · StarNet `fbddbf992` (v0.12.5) and `6a4805361` (v0.13.0) · Ollama 0.35.1 · qwen3:8b Q4_K_M · RX 9070 XT (ROCm), Windows 11

## Question

Why does StarNet fail to make tool calls with a local Ollama model, and is the server-side context length the cause?
The answer decides how a local worker must be configured, and whether StarNet should handle this itself.

## Hypothesis

StarNet v0.12.5 talks to Ollama through the OpenAI-compatible `/v1` endpoint, which has no per-request `num_ctx`.
Ollama's context then comes from the server: on this 16 GB card the VRAM-based default is **4096** tokens. StarNet's
task prompt (system prompt + 40 tool schemas) is ~15k tokens. If Ollama truncates instead of erroring, the model never
sees most of the instructions or tools and will not call them, which matches upstream issue
[#20](https://github.com/androoAGI/starnet/issues/20) ("Ollama agent runs complete with 0 tool calls").

Prediction: at 4096, file-tool tasks fail with no file-tool calls. At 32768 (prompt fits), they mostly succeed.

## Setup

- Hardware and driver: as in [rx9070xt-rocm-vs-vulkan/env.md](../2026-10-03-rx9070xt-rocm-vs-vulkan/env.md). Node 22.23.2.
- Model `qwen3:8b`, fully on GPU in every condition (`/api/ps` 100%).
- A dedicated `ollama serve` per condition on its own port, with `OLLAMA_CONTEXT_LENGTH` set and everything else default.
  The loaded context was verified from `/api/ps` before trials.
- Three conditions:

  | condition | StarNet | Ollama server context | StarNet → Ollama wire |
  |---|---|---|---|
  | `ctx4096` | v0.12.5 | 4096 (= this card's default) | `/v1/chat/completions`, no `num_ctx` |
  | `ctx32768` | v0.12.5 | 32768 | `/v1/chat/completions`, no `num_ctx` |
  | `ctx4096-v0.13.0` | v0.13.0 (separate git worktree) | 4096 (= default) | native `/api/chat` with StarNet-chosen `num_ctx`, `truncate: false` |

- StarNet sidecar booted with the repo's hermetic test fixture (temp workspace + temp app-data; a real station
  is never read or written). Background model traffic is off (`QUEST_REFRESH=0`, `AUX_BUDGET=0`).
- A recording proxy between StarNet and Ollama logs each request's size, any `num_ctx` it carries, and the prompt
  tokens Ollama reports (`usage.prompt_tokens` on `/v1`, `prompt_eval_count` on `/api/chat`). Bodies are forwarded unmodified.

## Method

- Four tasks, sent to `POST /api/run` as `isTask: true` with a file cabinet placed (grants `fs_*` tools):
  `t1` reply with a word (no tools) · `t2` write a file · `t3` write, read back, report · `t4` read a missing file, then create it.
- 10 trials per task per condition (120 runs), interleaved t1..t4 per trial. Each trial uses a fresh agent id, so
  there is no memory carry-over. Unique file names per trial.
- Tool consent auto-answered `once` (persists nothing).
- Success is checked **on disk**: the file exists with exact content (t2–t4), plus a read call (t3/t4) and the
  content echoed (t3). t1 needs the word and no tool calls.
- Truncation is checked two ways: the prompt-token count in the provider response, and Ollama's own
  `truncating input prompt` warning in the server log.
- Conditions ran as blocks: the two v0.12.5 blocks overnight, the v0.13.0 block the next morning.

```sh
node eval.mjs 4096 10                                    # data/trials-ctx4096.jsonl
node eval.mjs 32768 10                                   # data/trials-ctx32768.jsonl
STARNET_DIR=<v0.13.0 checkout> OUT_LABEL=v0.13.0 \
  node eval.mjs 4096 10                                  # data/trials-ctx4096-v0.13.0.jsonl
node analyze.mjs
```

## Results

**Truncation.** StarNet's full agent prompt is ~71–72k characters (35k system prompt, 34k of tool schemas) and
15,360–19,808 tokens.

| | v0.12.5 @ 4096 | v0.12.5 @ 32768 | v0.13.0 @ 4096 |
|---|---|---|---|
| full-prompt provider calls | 70 | 226 | 194 |
| `num_ctx` sent by StarNet | none | none | 32768 (every call) |
| prompt tokens evaluated (median) | **2,050** (all 70) | 15,936 [15,360–19,808] | 16,068 [15,587–18,111] |
| Ollama `truncating input prompt` warnings | **70** (`limit=2050 prompt≈15.4k keep=4`) | 0 | 0 |
| HTTP status | 200 | 200 | 200 |

**Task outcomes** (10 trials each):

| task | v0.12.5 @ 4096 | v0.12.5 @ 32768 | v0.13.0 @ 4096 |
|---|---|---|---|
| t1 reply (no tools) | 10/10 | 10/10 | 10/10 |
| t2 write | **0/10** | 10/10 | 10/10 |
| t3 write → read | **0/10** | 3/10 | 4/10 |
| t4 missing → create | **0/10** | 6/10 | 8/10 |
| **file tasks succeeded** | **0/30** | **19/30** | **22/30** |
| **file tasks with any `fs_*` call** | **0/30** | **30/30** | **30/30** |

On v0.12.5 at 4096, the model's first tool in t2 was `routine_create` in 8/10 trials (no tool in the other 2). In t4 it
answered, for example, *"I cannot read files, write files, or check file existence. My capabilities are limited to …"*.
The tools it describes having are the last ones in StarNet's tool array (team config, station layout, routines,
loops). t3 ended `empty` in 6/10. No 4k run surfaced an error: StarNet ended each as `done` or `empty`.

**Remaining failures are a different mechanism.** In both full-context conditions, failures were not truncation (0 warnings).
With tool-result capture (a 6-trial diagnostic on v0.12.5, [data/trials-ctx32768-diag.jsonl](data/trials-ctx32768-diag.jsonl),
and the full v0.13.0 block), the **first write in every file task** is refused by StarNet's Task Brief gate (`task-brief-gate`:
"settle the Task Brief with brief_proceed … before consequential work"). On v0.13.0 that was 30/30 file tasks and 74 refusals in total.
The model retries; some retries succeed, others loop on `fs_write`/`fs_read` until StarNet's loop guard stops the run.
All 8 v0.13.0 failures contain gate refusals. In 2 failed t4 runs per StarNet version, the model **claimed it had created a
file that does not exist**.

Median wall time per task fell on v0.13.0 (t1: 38 s → 10.5 s). That's consistent with its "background calls do not think"
change, but it wasn't isolated here.

Raw rows: [data/](data/). Run metadata: `meta-*.json`.

## Interpretation

- **CONFIRMED: Ollama's default context silently truncated StarNet v0.12.5's prompt.** Ollama keeps the first `num_keep` (4) tokens and the
  newest tokens, and frees half the window (`limit = ctx − (ctx − 4)/2` = 2050 at 4k; `llm/llama_server.go`,
  `contextShiftPromptLimit`). The request still returns 200, so StarNet gets no error, and the model sees ~13% of its
  prompt: the user message and the tail of the tool list, without the file tools or the operator manual.
- **CONFIRMED: context alone takes file-tool use from 0/30 to 30/30** (and success from 0/30 to 19/30) with the same
  model, prompt and harness. The only variable was `OLLAMA_CONTEXT_LENGTH`.
- **CONFIRMED (by the maintainer): this is issue #20.** Upstream commit `0e25b955f` (2026-09-29) diagnoses the same
  mechanism on Ollama 0.34.4 + qwen3:8b ("kept 2050 of them, the tail of the tool list") and moves StarNet to
  Ollama's native `/api/chat` with a request-sized `num_ctx` and `truncate: false`.
- **CONFIRMED: the fix works on stock Ollama defaults.** With the server still at 4096, v0.13.0 requested 32768 itself:
  0/194 truncations, 30/30 file-tool use, 22/30 success. That's statistically indistinguishable from manually raising the
  server context (19/30) at this n.
- **The Task Brief gate is not the bug; the remaining failures are model planning.** See the trace below.

### Task Brief gate trace

Done 2026-10-05 from the existing v0.13.0 proxy log (no new run). The proxy records each provider call's message roles
and whether the response carried a tool call; StarNet's event stream hides `brief_*` calls. Comparing the two per trial
(R = gate refusal, + = tool ok, x = tool error, in StarNet's visible order):

- **t2 write, 10/10 `R+`.** Every trial has exactly one more tool-calling turn in the proxy than StarNet shows, between the
  refusal and the successful write. The model settles the brief after one refusal; the gate opens as designed.
- **t4 missing → create.** Same shape (`xR…+`): one hidden turn after the refusal, then success in 8/10.
- **t3 write → read.** The proxy shows *fewer* tool-calling turns than StarNet shows calls: qwen3:8b sends `fs_write` and
  `fs_read` in the same turn. The write is refused, the read fails on the missing file, and it repeats the pair
  (`RxRxRx…`) without a separate brief call, until the loop guard ends the run (6/10 failed, 5 of them `error`).

So the gate behaves as intended and costs one extra round trip when the model handles it. The t3 failures come from
qwen3:8b's planning (batching a dependent read with a gated write), not from StarNet. **Not filed.**

Limits: the proxy counts tool-calling turns, not calls, and logged no tool names, so "the hidden call is `brief_proceed`"
is inferred. Some t3 runs are refused again after a success (`+R`); that's unexplained, and not pursued.

### Timeline: diagnosed independently, fixed upstream first

The fix (`0e25b955f`, Sep 29) sat on an internal branch while the public `feat/harness-backend` stayed at `fbddbf992`
(Sep 28). Upstream published 1,600 commits at once with v0.13.0 (release published 2026-10-03 19:10 EDT). Our
checkout was current when we pinned it that afternoon, and the eval ran on v0.12.5 a few hours after the release.
Issue #20 is still open with no comments, so neither the issue tracker nor the public branch showed the fix when we started.

What this does **not** show:

- One model (8B), one quant, one machine, n=10 per cell. Success rates of 19/30 vs 22/30 have wide uncertainty; the
  0/30 vs 30/30 file-tool-use contrast is the robust result.
- Conditions ran as blocks, not interleaved, and the v0.13.0 block ran on a different day. Success here is a
  model-behavior metric, not a timing one.
- Only two server contexts (4k, 32k). The threshold isn't located, and v0.13.0's ladder only exercised 32768.
- v0.13.0 differs from v0.12.5 in 1,600 commits, not just the context fix. Its t3/t4 numbers aren't attributable to the fix alone.
- No comparison with other runtimes (LM Studio, llama.cpp) or cloud models on the same tasks.

Pitfalls:

- StarNet makes several small side calls per task (~1–6k characters each, one of which carries tools), so a
  per-run "prompt tokens" average is misleading. Classify calls by request size.
- Before an eval against an actively developed upstream, fetch right before running and check the default branch's
  latest commit and the releases page, not just open issues. A fix can be public in a release while its issue is still open.

## Next step

- Done: [before/after evidence posted on #20](https://github.com/androoAGI/starnet/issues/20#issuecomment-5997806336) (2026-10-05).
- Done: [Task Brief gate trace](#task-brief-gate-trace) (2026-10-05): gate works as designed; dropped.
- If this harness is reused: log tool names from provider responses in the proxy, so hidden calls are named, not inferred.
- Repeat on qwen3.5:9b and a cloud baseline with the same harness.
