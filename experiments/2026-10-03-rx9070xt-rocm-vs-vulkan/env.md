# Environment (2026-10-03)

| | |
|---|---|
| OS | Windows 11 Pro, build 26200 |
| CPU / RAM | Intel i5-12600KF / 32 GB |
| GPU | AMD Radeon RX 9070 XT (gfx1201, RDNA4), 16 GB (15.9 GiB reported) |
| Driver | AMD Software Adrenalin 26.8.1 (32.0.31041.1004); Vulkan driverInfo 26.8.1 (LLPC) |
| Vulkan | instance 1.4.341, device apiVersion 1.4.349, conformance 1.4.3.3, deviceID 0x7550 |
| HIP / ROCm SDK | not installed (Ollama ships its own `rocm_v7_1` libraries) |
| Runtime | Ollama 0.35.1 for Windows (tray app for ROCm runs; `ollama serve` with env overrides for Vulkan) |
| Model | `qwen3:8b`, Q4_K_M, 8.2B params, 37 layers |
| Client | Node.js 22.23.2 |
