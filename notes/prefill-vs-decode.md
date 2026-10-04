# Prefill vs decode

LLM inference has two phases with different bottlenecks. Benchmarks that report one number usually report decode.

| | Prefill (prompt processing) | Decode (generation) |
|---|---|---|
| What happens | All prompt tokens go through the model in parallel and fill the KV cache | One token per forward pass, each reading all weights + KV cache |
| Bottleneck | **Compute** (big matrix–matrix multiplies) | **Memory bandwidth** (matrix–vector; weights re-read every token) |
| Scales with | Prompt length | Output length |
| Shows up as | Time to first token | Tokens/second while streaming |
| Backend sensitivity | High: matrix-core kernels matter | Low: same card, same bandwidth → similar speed |

## Why it matters for agents

An agent turn is mostly prompt: system prompt, tool schemas, conversation and tool results easily reach 10k+
tokens, while the reply (often a single tool call) is short. So agent latency is dominated by **prefill**, and
a chat-style "tok/s" benchmark predicts it badly.

Evidence: on an RX 9070 XT, ROCm and Vulkan tie on decode (~97 vs ~102 tok/s) but ROCm prefills 2.6× faster, which
halves a 13k-token turn (5.8 s vs 11.7 s). See
[experiments/2026-10-03-rx9070xt-rocm-vs-vulkan](../experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/).

## Rule of thumb

Rough decode ceiling ≈ memory bandwidth ÷ bytes read per token (model weights + active KV).
Prefill has no such simple ceiling; it depends on kernel quality, so measure it.

## Measuring with Ollama

`/api/generate` (non-streaming) returns `prompt_eval_count` / `prompt_eval_duration` (prefill) and
`eval_count` / `eval_duration` (decode), with durations in ns. Defeat prompt caching between runs (for example with a unique
prefix), or prefill will look impossibly fast.
