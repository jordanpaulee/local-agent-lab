# ROCm prefills 2.6× faster than Vulkan on an RX 9070 XT; decode is a tie

2026-10-03 · Status: concluded · Ollama 0.35.1 · qwen3:8b Q4_K_M · Adrenalin 26.8.1 · Windows 11 (26200)

## Question

Which Ollama backend, ROCm or Vulkan, should a local agent worker use on an RX 9070 XT (gfx1201) under Windows?
The answer decides the default backend for every later local-model eval on this machine.

## Hypothesis

Prior claims pointed both ways:

- Ollama's GPU docs list the RX 9070 XT for ROCm on **Linux only**; Windows AMD support lists 7000-series cards. That suggests Vulkan is the only Windows option.
- Secondary benchmarks (RDNA4 blogs, mostly Linux) report Vulkan **faster** than ROCm on 7–14B models (e.g. 137 vs 101 tok/s, Llama 2 7B Q4_0).

My hypothesis: those blog numbers are decode (generation) speed. Decode is memory-bandwidth-bound, so both
backends should tie there. Prefill (prompt processing) is compute-bound, so a backend with better matrix
kernels should win it. Agent turns are prefill-heavy (system prompt + tool schemas + history ≈ 13k tokens),
so prefill is the number that matters.

## Setup

- Hardware and versions: [env.md](env.md).
- Ollama 0.35.1 for Windows. On first start it selected **ROCm** (`library=ROCm compute=gfx1201 libdirs=ollama,rocm_v7_1`)
  despite the docs. Evidence: [data/ollama-log-excerpts.txt](data/ollama-log-excerpts.txt).
- Model `qwen3:8b` (Q4_K_M, 8.2B dense). 32k context, f16 KV cache.
- Vulkan run: same binary, forced with `OLLAMA_LLM_LIBRARY=vulkan OLLAMA_VULKAN=1 HIP_VISIBLE_DEVICES=-1 ollama serve`.

## Method

Same script for both backends ([bench.mjs](bench.mjs)), calling `/api/generate` directly:

- `num_ctx 32768`, `temperature 0`, `seed 42`, `think: false`.
- Two prompts: **short** (39 tokens, 256 out) and **long13k** (12,952 tokens, 128 out).
- 1 warmup + 3 measured runs per prompt. A unique `[run n]` prefix defeats prompt-cache reuse.
- Prefill and decode rates come from Ollama's own `prompt_eval_*` / `eval_*` timings; total is client wall time.
- Validity check before each backend: `offloaded 37/37 layers` in the server log and 100% GPU in `/api/ps`.

```sh
node bench.mjs rocm qwen3:8b          # default Ollama (ROCm selected)
node bench.mjs vulkan qwen3:8b        # after restarting Ollama with the Vulkan env above
```

## Results

Median of 3, with [min–max] ranges. Raw rows: [data/](data/).

| metric | ROCm (rocm_v7_1) | Vulkan |
|---|---|---|
| decode tok/s, short | 96.7 [96.3–97.0] | 102.0 [101.3–102.5] |
| decode tok/s, long13k | 75.5 [75.4–76.8] | 77.6 [76.6–79.1] |
| prefill tok/s, short (39 tok) | 1,336 [1,315–1,344] | 781 [763–822] |
| **prefill tok/s, long13k** | **3,140 [3,139–3,142]** | **1,216 [1,176–1,223]** |
| **total latency, long13k** | **5.8 s [5.5–5.9]** | **11.7 s [11.6–12.3]** |
| GPU share / errors | 100% / 0 | 100% / 0 |

Memory: weights 4,643 MiB + KV 4,608 MiB. `/api/ps` reports 9.97 GB for ROCm and 9.95 GB for Vulkan. The Windows
adapter-level counter read higher (11.44 vs 10.93 GB), likely because it includes runtime and driver overhead.

## Interpretation

- **CONFIRMED:** decode is a near-tie, with Vulkan 3–5% ahead. Prefill is not: ROCm is 2.6× faster at 13k tokens.
  For a 13k-token agent turn that halves latency (5.8 s vs 11.7 s).
- **CONFIRMED:** stock Ollama 0.35.1 on Windows runs ROCm on gfx1201 fully offloaded. The GPU docs are out of date.
- **INFERRED:** the "Vulkan is faster" claims I found report generation throughput, which matches the decode tie here.
- **Decision:** ROCm is the worker backend. Vulkan is a verified fallback.

What this does **not** show:

- One model, one quant, one machine, n=3. The spread is tight (<4% within each cell), but this is not a general RDNA4 result.
- The long test produced only 23–43 output tokens, so its decode rate is a weaker measurement than the short test's.
- No llama.cpp, LM Studio or Lemonade comparison; it is Ollama's bundled builds only.
- Prefill on short prompts includes fixed overhead, so the short-prompt prefill ratio (1.7×) is not meaningful.

Pitfalls that would have corrupted the numbers:

- Killing `ollama.exe` left orphan `llama-server.exe` runners holding ~4.3 GB VRAM each. The first Vulkan load got
  20/37 layers (54% GPU). Always verify full offload before measuring.
- The per-process GPU memory counter in Task Manager (dwm) over-reports; use the adapter-level counter.
- Ollama's VRAM-based default context on this card is **4096**. Clients that use the OpenAI-compatible `/v1`
  endpoint cannot set `num_ctx` per request, so long prompts are silently truncated unless
  `OLLAMA_CONTEXT_LENGTH` is set on the server.

## Next step

The 4096-token default leads straight to the next experiment. StarNet talks to Ollama over `/v1` and sends ~13k-token
agent prompts, so local models probably see a truncated prompt, which may explain StarNet's upstream report of local models
making 0 tool calls. The next experiment is a StarNet tool-call reliability eval on qwen3:8b (ROCm) at 4k vs 32k server context. See
[notes/starnet-headless-eval.md](../../notes/starnet-headless-eval.md) and [BACKLOG.md](../../BACKLOG.md).

Also a candidate docs PR to Ollama (`docs/gpu.mdx`), using the log evidence above.
