# StarNet's Ollama provider ran agents on a silently truncated prompt (issue #20): independently diagnosed, fixed upstream in v0.13.0, verified

2026-10-04 · Status: **fixed upstream** (`0e25b955f`, released in v0.13.0); verified here. Evidence [posted on #20](https://github.com/androoAGI/starnet/issues/20#issuecomment-5997806336) (2026-10-05); issue still open.
StarNet v0.12.5 `fbddbf992` (affected) and v0.13.0 `6a4805361` (fixed) · Ollama 0.35.1

## Question

Why do StarNet agents on a local Ollama model complete without making tool calls, even though Ollama emits tool calls
when called directly? This is upstream issue [#20](https://github.com/androoAGI/starnet/issues/20) (filed 2026-09-19 against 0.12.3, llama3.1:8b and qwen3:8b).

## Hypothesis (suspected cause)

StarNet's agent prompt is far larger than Ollama's default context, and Ollama truncates it without returning an error.

## Setup

- StarNet v0.12.5 source checkout, provider `ollama` (adapter `openai-compatible`, base URL `http://127.0.0.1:11434/v1`).
- Ollama 0.35.1 on Windows, RX 9070 XT 16 GB. The VRAM-based default context is **4096**
  (`msg="vram-based default context" default_num_ctx=4096`).
- Model qwen3:8b. Full measurement: [experiments/2026-10-03-starnet-qwen3-8b-context-length](../../experiments/2026-10-03-starnet-qwen3-8b-context-length/).

## Method

1. Read the v0.12.5 provider path for any context control (`num_ctx`, `options`, `keep_alive`).
2. Record StarNet → Ollama traffic with a proxy and compare request size with the prompt tokens Ollama evaluated.
3. Read Ollama's truncation code and match its arithmetic to the observed numbers.
4. Run the same tasks at `OLLAMA_CONTEXT_LENGTH` 4096 vs 32768 (10 trials × 4 tasks each).
5. After finding upstream's fix, rerun the 4096 condition against v0.13.0.

## Results

- **No context control in v0.12.5.** `sidecar/providers/registry.js:514-548` sets `max_tokens` (4096) and timeouts for
  Ollama, but nothing in `sidecar/` sends `num_ctx`. The `/v1` chat-completions API has no field for it.
- **Prompt size.** An `isTask` run with a file cabinet sends a ~35k-character system prompt plus 40 tool schemas
  (~34k characters): **15,360–19,808 tokens**.
- **Ollama truncates instead of erroring.** With context shift enabled (the default), `llm/llama_server.go` keeps
  `num_keep` tokens (4) and the newest tokens, so the prompt fills only half the window: `limit = ctx − (ctx − 4)/2` =
  **2,050** at 4096. The server logs `WARN "truncating input prompt" limit=2050 prompt=15356 keep=4 new=2050`. The
  response is 200 with `usage.prompt_tokens` = 2,050.
- **The model loses its tools and instructions.** What survives is the user message and the tail of the tool array.
  qwen3:8b says it cannot access files, or calls the wrong tool (`routine_create` in 8/10 write tasks). That matches
  #20: "That model stated that it did not have filesystem access", and llama3.1:8b emitting a `channel_send` call.
  The reporter's direct test worked because a short prompt fits in 4,096 tokens.
- **Controlled comparison** (same model, prompt and harness):

  | | v0.12.5, server 4096 | v0.12.5, server 32768 | **v0.13.0, server 4096** |
  |---|---|---|---|
  | full prompts truncated | 70/70 | 0/226 | 0/194 |
  | file tasks with any `fs_*` call | 0/30 | 30/30 | 30/30 |
  | file tasks succeeded (checked on disk) | 0/30 | 19/30 | 22/30 |

## Interpretation

- **CONFIRMED:** with Ollama's default context on a 16 GB GPU, every StarNet v0.12.5 agent turn ran on ~13% of its
  prompt, and file tools were effectively unavailable. This is the cause of #20.
- **CONFIRMED, independently by the maintainer:** upstream commit `0e25b955f` (2026-09-29, released in v0.13.0 on
  2026-10-03) describes the same mechanism and the same 2,050-token cut. It moves the Ollama provider to the native `/api/chat`
  with `options.num_ctx` sized to the request on a ladder (8k–64k, capped at the model's trained window from
  `/api/show`), plus `truncate: false`, so an under-estimate is refused and resent rather than cut. Overrides:
  `SKYNET_OLLAMA_NUM_CTX` and `SKYNET_OLLAMA_MAX_CTX`.
- **VERIFIED:** on v0.13.0 with Ollama still at its 4096 default, StarNet requested 32768 itself, no prompt was
  truncated, and outcomes matched manually raising the server context.

**How upstream's fix compares to the options I'd listed** (smallest first):

1. Docs only (tell users to set `OLLAMA_CONTEXT_LENGTH`): not chosen. It leaves the default broken.
2. Detect truncation from `prompt_tokens` and surface an error: superseded. `truncate: false` makes Ollama refuse instead, which is stronger.
3. Preflight the loaded context via `/api/ps` or `/api/show`: partly adopted. `/api/show` now supplies each model's trained window.
4. Native API with `num_ctx`: **adopted**. A ladder of fixed sizes avoids reloading the model on every distinct size.

## Next step

- Done: [comment on #20](https://github.com/androoAGI/starnet/issues/20#issuecomment-5997806336) with the before/after numbers. Watch for the maintainer closing it.
- A separate, unreported issue surfaced in the same data: qwen3:8b can't pass StarNet's Task Brief gate (first write
  refused in 30/30 file tasks on v0.13.0; two runs report success with no file written). See the experiment's next steps and BACKLOG #7.
