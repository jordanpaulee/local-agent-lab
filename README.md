# local-agent-lab

A research-engineering notebook for local LLM agents: reproducible experiments, evals, root-cause
investigations of open-source systems, and the notes I wrote while learning. Each entry follows
Question → Hypothesis → Setup → Method → Results → Interpretation → Next step ([TEMPLATE.md](TEMPLATE.md)),
keeps its raw data, and separates what was confirmed from what was inferred.

## Findings

| Date | Type | Finding |
|---|---|---|
| 2026-10-03 | experiment | [ROCm prefills 2.6× faster than Vulkan on an RX 9070 XT; decode is a tie](experiments/2026-10-03-rx9070xt-rocm-vs-vulkan/) |
| 2026-10-04 | experiment | [Ollama's 4k default context silently truncated StarNet's agent prompt (#20); file-tool use 0/30 → 30/30, fix verified in v0.13.0](experiments/2026-10-03-starnet-qwen3-8b-context-length/) |
| 2026-10-03 | investigation | [A Windows-only StarNet test failure was a libuv bug in Node 22.12–22.16](investigations/2026-10-03-node22-libuv-stat-dev/) |

## Layout

- `experiments/`: I measured something. Each folder holds a writeup, its script and its raw data.
- `investigations/`: I root-caused a behavior in someone else's system, with an upstream issue or PR linked when filed.
- `notes/`: evergreen concept notes, such as [prefill vs decode](notes/prefill-vs-decode.md).
- [BACKLOG.md](BACKLOG.md): OSS contribution candidates, writing ideas, open questions.

## Lab hardware

| Role | Hardware | Runtime |
|---|---|---|
| Always-on local worker | AMD RX 9070 XT 16 GB, i5-12600KF, 32 GB, Windows 11 | Ollama (ROCm) |
| Large-model lab | Apple M3 Max, 36 GB unified | Ollama (Metal) |
| Planner / baseline | Cloud frontier models | via [StarNet](https://github.com/androoAGI/starnet) |

Agent orchestration under test is [StarNet](https://github.com/androoAGI/starnet). Evals drive it over its HTTP API at a pinned
commit, and fixes go upstream through [my fork](https://github.com/jordanpaulee/starnet).

## License

Code: MIT ([LICENSE](LICENSE)). Writing and data: CC BY 4.0.
