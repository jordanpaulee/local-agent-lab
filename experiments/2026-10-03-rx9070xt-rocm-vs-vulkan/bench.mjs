// Backend benchmark for one Ollama model: identical script for ROCm and Vulkan runs.
// Usage: node bench.mjs <label> [model] [baseUrl]
// Writes JSON lines to data/bench-<label>.jsonl and prints a median summary.
import { appendFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] || 'default';
const model = process.argv[3] || 'qwen3:8b';
const base = process.argv[4] || 'http://127.0.0.1:11434';
const out = new URL(`./data/bench-${label}.jsonl`, import.meta.url);
writeFileSync(out, '');

const PARA = 'The station runs agents that read files, write deliverables, call tools, and report results to the Commander. Each agent has a system prompt, a manual, tool schemas, and memory. ';
const tests = [
  { name: 'short', prompt: n => `[run ${n}] Explain in about 200 words what a KV cache is in LLM inference.`, predict: 256 },
  { name: 'long13k', prompt: n => `[run ${n}] ` + PARA.repeat(340) + '\n\nIn one sentence, what does the station do?', predict: 128 }
];

async function once(t, n) {
  const t0 = Date.now();
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model, prompt: t.prompt(n), stream: false, think: false,
      options: { num_ctx: 32768, num_predict: t.predict, temperature: 0, seed: 42 } })
  });
  const j = await res.json();
  const ps = await (await fetch(base + '/api/ps')).json();
  const m = (ps.models || [])[0] || {};
  return {
    label, model, test: t.name, run: n, http: res.status, error: j.error || null,
    prompt_tokens: j.prompt_eval_count, gen_tokens: j.eval_count,
    prefill_tok_s: +(j.prompt_eval_count / (j.prompt_eval_duration / 1e9)).toFixed(1),
    gen_tok_s: +(j.eval_count / (j.eval_duration / 1e9)).toFixed(1),
    load_s: +(j.load_duration / 1e9).toFixed(2),
    total_s: +((Date.now() - t0) / 1000).toFixed(2),
    vram_gb: +((m.size_vram || 0) / 1e9).toFixed(2), gpu_pct: m.size ? Math.round(100 * m.size_vram / m.size) : null,
    ctx: m.context_length
  };
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const t of tests) {
  await once(t, 'warmup');
  const rows = [];
  for (let n = 1; n <= 3; n++) { const r = await once(t, n); rows.push(r); appendFileSync(out, JSON.stringify(r) + '\n'); }
  const errs = rows.filter(r => r.error || r.http !== 200);
  console.log(JSON.stringify({ label, test: t.name, prompt_tokens: rows[0].prompt_tokens,
    prefill_tok_s: med(rows.map(r => r.prefill_tok_s)), gen_tok_s: med(rows.map(r => r.gen_tok_s)),
    total_s: med(rows.map(r => r.total_s)), vram_gb: rows[0].vram_gb, gpu_pct: rows[0].gpu_pct, ctx: rows[0].ctx,
    errors: errs.length }));
}
