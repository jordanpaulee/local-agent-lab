// StarNet tool-call reliability on a local Ollama model under one server-side context length.
// Usage: node eval.mjs <ctx> [trials=10] [tasks=t1,t2,t3,t4]
//   env STARNET_DIR (default C:/dev/starnet), RAW_DIR (default <STARNET_DIR>/.qa_tmp/starnet-ctx-eval),
//   OUT_LABEL (optional: writes data/trials-ctx<ctx>-<label>.jsonl instead of the main file)
//
// Per condition it starts a dedicated `ollama serve` (port 11435, OLLAMA_CONTEXT_LENGTH=<ctx>), a recording proxy
// in front of it, and a disposable StarNet sidecar (hermetic test fixture: temp workspace + temp app-data, so a
// real station is never read or written). Tool consent is answered 'once' (persists nothing).
// Curated per-trial rows -> data/trials-ctx<ctx>.jsonl. Raw logs and request bodies (contain local paths) -> RAW_DIR.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const STARNET = process.env.STARNET_DIR || 'C:/dev/starnet';
const { SidecarFixture } = require(path.join(STARNET, 'test/helpers/sidecar-fixture.js'));

const ctx = Number(process.argv[2]);
const trials = Number(process.argv[3] || 10);
const taskIds = (process.argv[4] || 't1,t2,t3,t4').split(',');
if (!ctx) throw new Error('usage: node eval.mjs <ctx> [trials] [tasks]');
const MODEL = 'qwen3:8b';
const OLLAMA_PORT = 11435;
const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = trials === 1;
const LABEL = process.env.OUT_LABEL ? '-' + process.env.OUT_LABEL : '';
const RAW = path.join(process.env.RAW_DIR || path.join(STARNET, '.qa_tmp/starnet-ctx-eval'), (smoke ? 'smoke-' : '') + 'ctx' + ctx + LABEL);
fs.mkdirSync(RAW, { recursive: true });
const OUT = smoke ? path.join(RAW, 'trials.jsonl') : path.join(here, 'data', `trials-ctx${ctx}${LABEL}.jsonl`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, '');
const REQLOG = path.join(RAW, 'proxy-requests.jsonl');
fs.writeFileSync(REQLOG, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findFile(root, name) {
  if (!fs.existsSync(root)) return null;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}
const fileHas = (dir, name, want) => {
  const f = findFile(dir, name);
  return { found: !!f, contentOk: !!f && fs.readFileSync(f, 'utf8').trim() === want };
};
const called = (r, re) => r.toolCalls.some(n => re.test(n));

const TASKS = {
  t1: { name: 'reply',
    prompt: n => `Reply with exactly the word READY-${n} and nothing else. Do not use any tools.`,
    check: (r, n) => ({ ok: r.text.includes(`READY-${n}`) && r.toolCalls.length === 0 }) },
  t2: { name: 'write',
    prompt: n => `Create a file named note-${n}.txt in your workspace containing exactly: alpha-${n}`,
    check: (r, n, dir) => { const f = fileHas(dir, `note-${n}.txt`, `alpha-${n}`); return { ...f, ok: f.contentOk }; } },
  t3: { name: 'write-read',
    prompt: n => `Write a file named echo-${n}.txt containing exactly: beta-${n}. Then read the file back with your file tools and tell me its exact contents.`,
    check: (r, n, dir) => { const f = fileHas(dir, `echo-${n}.txt`, `beta-${n}`);
      return { ...f, ok: f.contentOk && called(r, /read/i) && r.text.includes(`beta-${n}`) }; } },
  t4: { name: 'recover',
    prompt: n => `Read the file named missing-${n}.txt. If it does not exist, create it containing exactly: gamma-${n}, then confirm what you did.`,
    check: (r, n, dir) => { const f = fileHas(dir, `missing-${n}.txt`, `gamma-${n}`);
      return { ...f, ok: f.contentOk && called(r, /read/i) }; } }
};

// ---------- recording proxy ----------
let current = null;
function summarize(j) {
  const msgs = Array.isArray(j.messages) ? j.messages : [];
  const len = m => typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
  const roles = {};
  for (const m of msgs) roles[m.role] = (roles[m.role] || 0) + 1;
  const toolsChars = j.tools ? JSON.stringify(j.tools).length : 0;
  const msgChars = msgs.reduce((a, m) => a + len(m) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  return { model: j.model, nMessages: msgs.length, roles, sysChars: msgs.filter(m => m.role === 'system').reduce((a, m) => a + len(m), 0),
    msgChars, toolsCount: (j.tools || []).length, toolsChars, totalChars: msgChars + toolsChars,
    max_tokens: j.max_tokens ?? j.max_completion_tokens ?? null, stream: !!j.stream, reasoning_effort: j.reasoning_effort ?? null,
    numCtx: (j.options && j.options.num_ctx) || null, truncate: j.truncate ?? null,
    keys: Object.keys(j).sort() };
}
function parseResp(text) {
  const out = { usage: null, finish: null, toolCallDeltas: 0, contentChars: 0, reasoningChars: 0 };
  if (/^data: /m.test(text)) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      let c; try { c = JSON.parse(line.slice(6)); } catch { continue; }
      if (c.usage) out.usage = c.usage;
      if (c.error) out.error = String(c.error.message || c.error).slice(0, 300);
      const ch = c.choices && c.choices[0];
      if (!ch) continue;
      if (ch.finish_reason) out.finish = ch.finish_reason;
      const d = ch.delta || {};
      if (d.tool_calls) out.toolCallDeltas++;
      if (d.content) out.contentChars += d.content.length;
      if (d.reasoning || d.reasoning_content) out.reasoningChars += (d.reasoning || d.reasoning_content).length;
    }
  } else if (/"done":/.test(text)) {
    // Ollama native /api/chat NDJSON (StarNet >= 0.13): the final line carries the counts
    for (const line of text.split('\n')) {
      let c; try { c = JSON.parse(line); } catch { continue; }
      if (c.error) out.error = String(c.error).slice(0, 300);
      const m = c.message || {};
      if (m.tool_calls) out.toolCallDeltas += m.tool_calls.length;
      if (m.content) out.contentChars += m.content.length;
      if (m.thinking) out.reasoningChars += m.thinking.length;
      if (c.done) { out.finish = c.done_reason || 'stop'; out.usage = { prompt_tokens: c.prompt_eval_count, completion_tokens: c.eval_count }; }
    }
  } else {
    try { const j = JSON.parse(text); out.usage = j.usage || null; const ch = j.choices && j.choices[0];
      out.finish = ch && ch.finish_reason; out.toolCallDeltas = ch && ch.message && ch.message.tool_calls ? ch.message.tool_calls.length : 0;
      if (j.error) out.error = String(j.error.message || j.error).slice(0, 300);
    } catch { out.error = text.slice(0, 300); }
  }
  return out;
}
let savedBodies = 0;
const proxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let buf = Buffer.concat(chunks);
    const rec = { t: Date.now(), trial: current && current.agentId, method: req.method, path: req.url };
    const isChat = req.url.includes('/chat/completions') || req.url.startsWith('/api/chat');
    if (isChat) {
      let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
      if (j) {
        rec.req = summarize(j);
        if (savedBodies < 3) fs.writeFileSync(path.join(RAW, `request-body-${++savedBodies}.json`), JSON.stringify(j, null, 2));
        if (req.url.includes('/chat/completions') && j.stream && !(j.stream_options && j.stream_options.include_usage)) {
          j.stream_options = { ...(j.stream_options || {}), include_usage: true };
          rec.injectedIncludeUsage = true;
          buf = Buffer.from(JSON.stringify(j));
        }
      }
    }
    const headers = { ...req.headers, host: `127.0.0.1:${OLLAMA_PORT}`, 'content-length': buf.length };
    delete headers['transfer-encoding'];
    const up = http.request({ host: '127.0.0.1', port: OLLAMA_PORT, method: req.method, path: req.url, headers }, ur => {
      res.writeHead(ur.statusCode, ur.headers);
      let acc = '';
      ur.on('data', d => { res.write(d); if (isChat) acc += d.toString('utf8'); });
      ur.on('end', () => {
        res.end();
        rec.status = ur.statusCode; rec.ms = Date.now() - rec.t;
        if (isChat) Object.assign(rec, parseResp(acc));
        if (isChat && current) current.requests.push(rec);
        fs.appendFileSync(REQLOG, JSON.stringify(rec) + '\n');
      });
    });
    up.on('error', e => { rec.error = String(e); fs.appendFileSync(REQLOG, JSON.stringify(rec) + '\n'); try { res.writeHead(502); res.end(String(e)); } catch {} });
    up.end(buf);
  });
});

// ---------- one trial ----------
async function runTrial(fx, proxyPort, taskId, n) {
  const T = TASKS[taskId];
  const agentId = `e${ctx}-${taskId}-${n}`;
  current = { agentId, requests: [] };
  const r = { ctx, task: taskId, taskName: T.name, trial: n, agentId, text: '', toolCalls: [], toolArgs: [], toolResults: [], argsRepaired: 0,
    consentPrompts: 0, endReason: null, turns: null, finishReason: null, runError: null, tokensIn: null, tokensOut: null, events: {} };
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300000);
  let runId = null;
  try {
    const res = await fx.request('/api/run', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', model: MODEL, baseUrl: `http://127.0.0.1:${proxyPort}/v1`, agentId, streamId: agentId,
        isTask: true, placed: [{ objectType: 'cabinet' }], messages: [{ role: 'user', content: T.prompt(n) }] }) });
    r.httpStatus = res.status;
    if (res.status !== 200) { r.runError = (await res.text()).slice(0, 300); }
    else {
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          const p = ev.payload || {};
          r.events[ev.name] = (r.events[ev.name] || 0) + 1;
          switch (ev.name) {
            case 'agent.run.start': runId = p.runId; break;
            case 'agent.token': r.text += p.delta || ''; break;
            case 'agent.tool_call': r.toolCalls.push(p.name); r.toolArgs.push(String(p.argsSummary || '')); break;
            case 'agent.tool_result': r.toolResults.push({ ok: !!p.ok, isError: !!p.isError, summary: String(p.summary || '').slice(0, 200) }); break;
            case 'tool.args.repaired': r.argsRepaired++; break;
            case 'permission.prompt':
              r.consentPrompts++;
              await fx.json('POST', '/api/consent', { runId, promptId: p.promptId, decision: 'once' });
              break;
            case 'agent.cost': r.tokensIn = (r.tokensIn || 0) + (p.tokensIn || 0); r.tokensOut = (r.tokensOut || 0) + (p.tokensOut || 0); break;
            case 'agent.run.end': r.endReason = p.reason; r.turns = p.turns; r.finishReason = p.finishReason || null; break;
            case 'agent.run.error': r.runError = String(p.message || '').slice(0, 300); break;
          }
        }
      }
    }
  } catch (e) { r.runError = 'client: ' + String(e && e.message || e).slice(0, 200); }
  clearTimeout(timer);
  r.wallMs = Date.now() - t0;
  Object.assign(r, T.check(r, n, path.join(fx.workspace, agentId)));
  const reqs = current.requests;
  r.providerRequests = reqs.length;
  r.promptTokens = reqs.map(q => q.usage ? q.usage.prompt_tokens : null);
  r.completionTokens = reqs.map(q => q.usage ? q.usage.completion_tokens : null);
  r.requestChars = reqs.map(q => q.req ? q.req.totalChars : null);
  r.toolsSent = reqs.map(q => q.req ? q.req.toolsCount : null);
  r.requestPaths = reqs.map(q => q.path);
  r.numCtx = reqs.map(q => q.req ? q.req.numCtx : null);
  r.providerFinish = reqs.map(q => q.finish);
  r.providerErrors = reqs.map(q => q.error || null).filter(Boolean);
  // never publish local paths: the model may echo the workspace location
  // Also catch JSON-escaped and clipped forms (StarNet's argsSummary escapes backslashes and cuts at 80 chars).
  const scrub = s => [fx.workspace, os.tmpdir(), os.homedir()]
    .reduce((a, p) => a.split(p).join('<local>').split(p.replace(/\\/g, '/')).join('<local>'), s)
    .replace(/[A-Za-z]:(?:\\+|\/)Users(?:\\+|\/)[^"\s]*/g, '<local>');
  r.textChars = r.text.length;
  r.text = scrub(r.text).slice(0, 400);
  if (r.runError) r.runError = scrub(r.runError);
  r.toolArgs = r.toolArgs.map(scrub);
  for (const x of r.toolResults) x.summary = scrub(x.summary);
  current = null;
  return r;
}

// ---------- main ----------
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return; } catch {} await sleep(250); }
  throw new Error('timed out waiting for ' + what);
}
const ollamaUrl = p => `http://127.0.0.1:${OLLAMA_PORT}${p}`;

let srv = null, fx = null;
async function cleanup() {
  if (fx) { try { await fx.dispose(); } catch {} fx = null; }
  if (srv && srv.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(srv.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  proxy.close();
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  const logFd = fs.openSync(path.join(RAW, 'ollama-serve.log'), 'w');
  srv = spawn('ollama', ['serve'], { windowsHide: true, stdio: ['ignore', logFd, logFd],
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`, OLLAMA_CONTEXT_LENGTH: String(ctx), OLLAMA_KEEP_ALIVE: '30m' } });
  await waitFor(async () => (await fetch(ollamaUrl('/api/version'))).ok, 30000, 'eval ollama server');
  // load the model outside the measured trials and verify context + full GPU offload
  await fetch(ollamaUrl('/v1/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }) });
  const ps = (await (await fetch(ollamaUrl('/api/ps'))).json()).models[0] || {};
  const meta = { ctx, model: MODEL, ollamaVersion: (await (await fetch(ollamaUrl('/api/version'))).json()).version,
    loadedContext: ps.context_length, sizeVramGB: +((ps.size_vram || 0) / 1e9).toFixed(2), gpuPct: ps.size ? Math.round(100 * ps.size_vram / ps.size) : null,
    starnetCommit: execFileSync('git', ['-C', STARNET, 'rev-parse', '--short', 'HEAD']).toString().trim(), node: process.version,
    trials, tasks: taskIds, startedAt: new Date().toISOString() };
  console.log('meta', JSON.stringify(meta));
  if (meta.loadedContext !== ctx) throw new Error(`loaded context ${meta.loadedContext} != requested ${ctx}`);

  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port;
  fx = new SidecarFixture({ prefix: 'ctx-eval-', timeoutMs: 60000, env: {
    OLLAMA_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
    STARNET_QUEST_REFRESH: '0', SKYNET_QUEST_REFRESH: '0', STARNET_AUX_BUDGET: '0', SKYNET_AUX_BUDGET: '0' } });
  await fx.start();
  console.log('sidecar up', fx.baseUrl);

  for (let n = 1; n <= trials; n++) {
    for (const t of taskIds) {
      const r = await runTrial(fx, proxyPort, t, n);
      fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
      console.log(`${t} #${n} ok=${r.ok} end=${r.endReason} tools=[${r.toolCalls}] prompt_tokens=[${r.promptTokens}] chars=[${r.requestChars}] ${r.wallMs}ms${r.runError ? ' ERR ' + r.runError : ''}`);
    }
  }
  meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(smoke ? path.join(RAW, 'meta.json') : path.join(here, 'data', `meta-ctx${ctx}${LABEL}.json`), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(RAW, 'sidecar-output.log'), fx.output());
} finally {
  await cleanup();
}
