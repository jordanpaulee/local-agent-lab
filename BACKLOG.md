# Backlog

One file and three lists. Every item links to evidence, or it doesn't go here yet.

## OSS candidates

Status: `idea → repro → filed → PR → merged`, or `dropped`. Search existing issues before filing anything.

| # | Project / ref | What | Why it matters | Evidence | Status |
|---|---|---|---|---|---|
| 1 | ollama #18528 → llama.cpp #29092 | qwen3.5-family hybrid GDN models leak recurrent state across requests on ROCm | Blocks stronger qwen3.5:9b-class workers on the fastest backend here | Report is gfx1151; need a gfx1201 repro | idea |
| 2 | ollama #17347 | Quantized KV cache on qwen35 arch under ROCm stops instead of emitting a tool call | Blocks q8 KV (more context per GB) | none yet | idea (only if we adopt qwen3.5) |
| 3 | ollama #16383 | qwen3.5 tool parser returns HTTP 500 on template drift | Tool-call reliability for qwen3.5 workers; Go parser code, approachable | none yet | idea (check in eval) |
| 4 | ollama `docs/gpu.mdx` | Docs say RX 9070 XT ROCm is Linux-only; 0.35.1 on Windows runs it fully offloaded | Steers RDNA4 Windows users to Vulkan (2.6× slower prefill) | [rocm-vs-vulkan](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) | repro (easy first PR) |
| 5 | StarNet Ollama provider | `/v1` can't set `num_ctx`; Ollama default ctx is 4096 → ~13k-token prompts silently truncated | Plausible cause of upstream "local models make 0 tool calls" | [rocm-vs-vulkan](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) pitfalls | idea → next experiment |
| 6 | StarNet readiness | `index.js:6595` drops `internal`, so onboarding calls count as user runs | Truthfulness bug; one field + test | [investigation](investigations/2026-10-03-starnet-readiness-counts-internal-runs/) | repro (parked) |

## Writing ideas

- "Your local-LLM benchmark is measuring the wrong phase": prefill vs decode for agent workloads. Backed by
  [rocm-vs-vulkan](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) and [notes/prefill-vs-decode](notes/prefill-vs-decode.md).
- "How I decided not to file a bug": the libuv `st_dev` investigation as a worked example.
  Backed by [investigation](investigations/2026-10-03-node22-libuv-stat-dev/).

## Open questions

- Next experiment: StarNet tool-call reliability on qwen3:8b (ROCm) at 4k vs 32k server context. 5 tasks × ≥10
  trials: simple reply, one `fs.write`, write-then-read, missing-file recovery, MCP read. Track tool-call
  success, end-to-end success, malformed calls (`tool.args.repaired`), retries and latency. Recipe:
  [notes/starnet-headless-eval](notes/starnet-headless-eval.md). The MCP task is blocked until the context server's transport and URL are known.
- Then: qwen3.5:9b on the same eval, plus a cross-request state-leak check (#1).
- Then: the same eval against a cloud model (baseline) and a 27B model on Apple Silicon. Observed but unmeasured:
  qwen3.8:27b on an M3 Max ≈ 11 tok/s decode, ≈ 130 tok/s prefill (a 13k prompt takes ~99 s). This needs a proper run before it's a claim.
- Does StarNet's `isTask` system prompt alone exceed what an 8B model handles well, independent of truncation?
