// Summarize data/trials-ctx*.jsonl. Usage: node analyze.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
// one condition per data file: trials-ctx<ctx>[-<label>].jsonl
const files = fs.readdirSync(dir).filter(f => /^trials-ctx\d+(-[\w.]+)?\.jsonl$/.test(f))
  .sort((a, b) => parseInt(a.slice(10)) - parseInt(b.slice(10)) || a.localeCompare(b));
const rows = files.flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')
  .map(JSON.parse).map(r => ({ ...r, cond: f.slice('trials-'.length, -'.jsonl'.length) })));
const FILE_TOOL = /^fs_/;
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (k, n) => `${k}/${n}`;

// "main" calls are the full agent prompt (~70k chars incl. 40 tools); StarNet also makes small side calls, one of which carries tools.
const mainIdx = r => r.requestChars.map((c, i) => (c > 30000 ? i : -1)).filter(i => i >= 0);

for (const cond of [...new Set(rows.map(r => r.cond))]) {
  const rs = rows.filter(r => r.cond === cond);
  const ctx = rs[0].ctx;   // the Ollama server's OLLAMA_CONTEXT_LENGTH
  const main = rs.flatMap(r => mainIdx(r).map(i => ({ pt: r.promptTokens[i], chars: r.requestChars[i], numCtx: r.numCtx ? r.numCtx[i] : null })));
  const asked = [...new Set(main.map(m => m.numCtx).filter(Boolean))];
  const limit = ctx - Math.floor((ctx - 4) / 2);   // Ollama context-shift limit with num_keep 4
  const truncated = main.filter(m => m.pt === limit).length;
  console.log(`\n## ${cond}: ${rs.length} trials, ${main.length} main (full agent prompt) provider calls` +
    (asked.length ? ` · StarNet-requested num_ctx: ${asked.join(', ')}` : ' · no num_ctx sent (/v1)'));
  console.log(`main-call prompt_tokens median ${med(main.map(m => m.pt))} [${Math.min(...main.map(m => m.pt))}–${Math.max(...main.map(m => m.pt))}], request chars median ${med(main.map(m => m.chars))}; prompt_tokens == truncation limit (${limit}): ${truncated}/${main.length}`);
  console.log('| task | success | any file-tool call | non-file tool calls | end reasons | median wall s |');
  console.log('|---|---|---|---|---|---|');
  for (const t of ['t1', 't2', 't3', 't4']) {
    const tr = rs.filter(r => r.task === t);
    if (!tr.length) continue;
    const ends = {};
    for (const r of tr) ends[r.endReason || 'none'] = (ends[r.endReason || 'none'] || 0) + 1;
    const other = tr.flatMap(r => r.toolCalls.filter(n => !FILE_TOOL.test(n)));
    const otherCounts = {};
    for (const n of other) otherCounts[n] = (otherCounts[n] || 0) + 1;
    console.log(`| ${t} ${tr[0].taskName} | ${pct(tr.filter(r => r.ok).length, tr.length)} | ${pct(tr.filter(r => r.toolCalls.some(n => FILE_TOOL.test(n))).length, tr.length)} | ${Object.entries(otherCounts).map(([k, v]) => `${k}×${v}`).join(', ') || '—'} | ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(', ')} | ${(med(tr.map(r => r.wallMs)) / 1000).toFixed(1)} |`);
  }
  const tools = rs.flatMap(r => r.toolCalls).length;
  console.log(`total tool calls ${tools}; args repaired ${rs.reduce((a, r) => a + r.argsRepaired, 0)}; consent prompts ${rs.reduce((a, r) => a + r.consentPrompts, 0)}; run errors ${rs.filter(r => r.runError).length}`);
}
