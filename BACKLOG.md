# Backlog

One file and three lists. Every item links to evidence, or it doesn't go here yet.

## OSS candidates

Status: `idea → repro → filed → PR → merged`, or `dropped`. Search existing issues before filing anything.

| # | Project / ref | What | Why it matters | Evidence | Status |
|---|---|---|---|---|---|
| 1 | ollama #18528 → llama.cpp #29092 | qwen3.5-family hybrid GDN models leak recurrent state across requests on ROCm | Blocks stronger qwen3.5:9b-class workers on the fastest backend here | Report is gfx1151; need a gfx1201 repro | idea |
| 2 | ollama #17347 | Quantized KV cache on qwen35 arch under ROCm stops instead of emitting a tool call | Blocks q8 KV (more context per GB) | none yet | idea (only if we adopt qwen3.5) |
| 3 | ollama #16383 | qwen3.5 tool parser returns HTTP 500 on template drift | Tool-call reliability for qwen3.5 workers; Go parser code, approachable | none yet | idea (check in eval) |
| 4 | ollama `docs/gpu.mdx` | Docs say RX 9070 XT ROCm is Linux-only; 0.35.1 on Windows runs it fully offloaded | Steers RDNA4 Windows users to Vulkan (2.6× slower prefill) | [rocm-vs-vulkan](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) | dropped as a PR (2026-10-05): ollama PR #18623 (open, by an AMD contributor) already adds the 9070 series to the Windows table; our run could back it as a tested-by comment |
| 5 | StarNet #20 (Ollama provider) | v0.12.5 sent no `num_ctx` over `/v1`; Ollama's 4096 default cut the ~15k-token agent prompt to 2,050 tokens, silently | Was the cause of #20; file-tool use 0/30 → 30/30. Fixed upstream in v0.13.0 (`0e25b955f`, native `/api/chat` + `num_ctx`), verified here | [experiment](experiments/2026-10-03-starnet-qwen3-8b-context-length/), [investigation](investigations/2026-10-04-starnet-ollama-context-truncation/) | fixed upstream; [evidence posted on #20](https://github.com/androoAGI/starnet/issues/20#issuecomment-5997806336) |
| 6 | StarNet readiness | `index.js:6595` drops `internal`, so onboarding calls count as user runs | Truthfulness bug; one field + test | [investigation](investigations/2026-10-03-starnet-readiness-counts-internal-runs/) | repro (parked) |
| 7 | StarNet Task Brief gate × small local models | First write refused in 30/30 file tasks on v0.13.0. Proxy logs show the gate working as designed: in t2/t4 the model makes one call hidden from the event stream (inferred `brief_*`) after the refusal, then succeeds. t3 failures are qwen3:8b batching `fs_write` + `fs_read` in one turn and repeating the pair until the loop guard stops it | Not a StarNet bug: a model-planning failure, costing one extra round trip when it works | [experiment](experiments/2026-10-03-starnet-qwen3-8b-context-length/#task-brief-gate-trace) | dropped (2026-10-05) |
| 8 | StarNet [PR #83](https://github.com/androoAGI/starnet/pull/83) | `sync-source-release` runs on every fork's quarter-hourly schedule and fails (`gh: Not Found (HTTP 404)`), emailing fork owners; one-line `if: github.repository == 'androoAGI/starnet'` guard | Removes CI noise for every StarNet contributor | `test:fast` green (1053 steps); fork run skipped: [37627366103](https://github.com/jordanpaulee/starnet/actions/runs/37627366103) | PR (opened 2026-10-07) |

## Writing ideas

- "Your local-LLM benchmark is measuring the wrong phase": prefill vs decode for agent workloads. Backed by
  [rocm-vs-vulkan](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) and [notes/prefill-vs-decode](notes/prefill-vs-decode.md).
- "How I decided not to file a bug": the libuv `st_dev` investigation as a worked example.
  Backed by [investigation](investigations/2026-10-03-node22-libuv-stat-dev/).

## Open questions

- Done 2026-10-04: [StarNet qwen3:8b 4k vs 32k, plus v0.13.0 verification](experiments/2026-10-03-starnet-qwen3-8b-context-length/). Still open from it:
  the MCP task (blocked until the context server's transport and URL are known). The Task Brief question (#7) is answered: model planning, not a StarNet bug.
- Process: before an eval against an active upstream, fetch right before running and check the default branch head and releases, not just issues.
- Then: qwen3.5:9b on the same eval (StarNet ≥ v0.13.0), plus a cross-request state-leak check (#1).
- Then: the same eval against a cloud model (baseline) and a 27B model on Apple Silicon. Observed but unmeasured:
  qwen3.8:27b on an M3 Max ≈ 11 tok/s decode, ≈ 130 tok/s prefill (a 13k prompt takes ~99 s). This needs a proper run before it's a claim.
- Does StarNet's `isTask` system prompt alone exceed what an 8B model handles well, independent of truncation?
