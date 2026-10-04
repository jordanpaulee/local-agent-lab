# Driving StarNet headlessly for evals

Reference for running scripted evals against a **disposable** StarNet sidecar. Line numbers are pinned to
StarNet `fbddbf992` (branch `feat/harness-backend`) and will drift. Never point an eval at a real station.

---


Paths relative to C:\dev\starnet. Line numbers from the current checkout (branch feat/harness-backend).

## 1. Run route
- POST /api/run -> handleRun, sidecar/index.js:15780 (route table :9637). Response is application/x-ndjson, one line per event: {"name","payload"} (:15893-15900; payloads secret-redacted). Skip blank keepalive lines.
- Body fields read (index.js:15784-15840): model (REQUIRED, else 400 at :15832), provider (e.g. "ollama"), baseUrl (explicit override, honored first: :2249-2266), key (not needed for ollama), system, messages[{role,content}], agentId (default "agent"), isTask (true is what advertises tools; see test/e2e.mcp-connector.test.js ~:528 comment), internal, evidence, streamId (/^[A-Za-z0-9_-]{1,64}$/), placed[{objectType}], stationPlaced, reasoningEffort, fallbackModels/fallbackProviders, projectRoot, preloadSkills, recovery, postconditions, recurring.
- provider=ollama is registry id 'ollama' (sidecar/providers/registry.js:515-548): default baseUrl http://127.0.0.1:11434/v1, env OLLAMA_BASE_URL, keyRequired false, supportsTools null, connectTimeoutMs 300000, max_tokens 4096 (env SKYNET_OLLAMA_MAX_TOKENS), greeting/chat cap 512 (SKYNET_OLLAMA_MAX_CHAT_TOKENS). Greetings (isTask false) get the 512 cap and NO tools; use isTask:true for tool tasks (test/casual-response-safety.e2e.test.js asserts this).
- Events (shared/events.js:22-75): agent.run.start{runId,model,trigger}; agent.token{delta}; agent.reasoning{on}; agent.tool_call{callId,name,argsSummary - CLIPPED to 80 chars, sidecar/loop.js:51,340}; agent.tool_result{callId,ok,isError,ms,summary - short; full result content is NOT streamed}; tool.args.repaired{callId,name,before,after} (malformed tool-call JSON auto-repaired, loop.js:63-85; unrepairable gives internal parseError "invalid tool arguments JSON"); agent.cost{usd,tokensIn,tokensOut,model}; agent.waiting (15s heartbeat); permission.prompt{promptId,tool,scope,argsSummary}; agent.run.end{reason: done|max_iters|budget|cancelled|error|refusal|empty|clarifying, turns, usd, finishReason?}; agent.run.error{message,transient}.
- Raw args / raw provider wire are NOT in the stream. Use a recording reverse proxy as body.baseUrl. Durable history: GET /api/runs?agent=<id>&runId=<id> (index.js:21644) and GET /api/transcript?agent=..&stream=.. (how much tool detail they keep: UNCERTAIN, not inspected).

## 2. Auth
- index.js:371: API_TOKEN = ENV('API_TOKEN') || random. ENV() = STARNET_X first then SKYNET_X (:367). For a scratch sidecar you spawn, set STARNET_API_TOKEN yourself and send header X-StarNet-Token.
- Otherwise scrape: GET / with Origin: http://127.0.0.1:<port>, regex window.__STARNET_API_TOKEN__=("...") (injected at index.js:22739; helper bootToken in test/_httpToken.js). Not printed at boot. Requests also need valid Host/Origin (apiauth.js; fixture sends Origin = base URL). A master token in a query string is refused.
- Only do this against your own scratch sidecar, never the live station.

## 3. Approvals
- /api/run is surface 'interactive': an ungranted mutation (fs.write has requiresConsent:true, sidecar/tools/builtin/fs.js:293) emits permission.prompt and BLOCKS until POST /api/consent {runId, promptId, decision:'once'|'session'|'always'|'full'|'deny'} (handleConsent index.js:19198). Auto-denies on timeout/disconnect.
- Recommended for the harness: auto-answer decision:'once' on each permission.prompt (persists nothing; lets you count prompts). Pattern: test/e2e.mcp-connector.test.js:520-548 (driveWatched).
- Scratch-only alternatives: env STARNET_FULL_ACCESS=1 (frozen at boot, index.js:3170; used by most e2e tests); roster approvalMode:'full' for that agent (index.js:1634, via POST /api/roster); consent decision 'full' persists approvalMode:full into the roster (index.js:1710) so it would weaken a real station. Hardline file floor (.env/.git) still applies. Master bypass is a file WORKSPACES/permissions.bypass.json (index.js:3180) - leave alone.

## 4. Boot a disposable sidecar
- Cleanest reuse: test/helpers/sidecar-fixture.js SidecarFixture (CommonJS; require by absolute path from outside the repo). It makes a temp workspace plus a hermetic APPDATA/LOCALAPPDATA/XDG_DATA_HOME profile (IMPORTANT: boot-time station auto-recovery scans the real per-user app-data and would otherwise copy the real station into a fresh temp workspace; see the comment in the constructor), picks a free port, sets SKYNET_/STARNET_PORT and _WORKSPACES, spawns node sidecar/index.js, polls /api/health, scrapes the token, and offers .json(method,route,body), .request(), .restart(), .dispose() (deletes temp dirs). Options {env, timeoutMs}.
- Closest template with the Ollama provider: test/casual-response-safety.e2e.test.js (fake upstream HTTP server, POST /api/roster with provider:'ollama', POST /api/run with provider/baseUrl/model).
- Hand-rolled alternative: env STARNET_PORT, STARNET_WORKSPACES=<scratch>, STARNET_API_TOKEN=<fixed>, and APPDATA/LOCALAPPDATA/XDG_DATA_HOME pointed at scratch dirs; node sidecar/index.js; ready on GET /api/health. No provider preselect is needed: provider is per request (body.provider) and per roster agent. Avoid dev/seed.js / STARNET_DEV (browser auto-boot hook, not needed).
- Suppress background model traffic that would hit Ollama and distort timing: STARNET_QUEST_REFRESH=0, SKYNET_AUX_BUDGET=0 (used in test/auxmodel.e2e.test.js:127, test/delegated-connectors.e2e.test.js:37). handleRun sets reflect:true so post-run memory-reflection aux calls can occur; AUX_BUDGET=0 is the knob tests use (exact effect UNCERTAIN).
- GET /api/runtime/agent (index.js:11702) is hardwired to openrouter; not useful for ollama.

## 5. Filesystem tools and errors
- sidecar/tools/builtin/fs.js: fs.write (:293, write, consent), fs.read (:315), fs.list (:416), fs.append (:433), fs.edit (:472), fs.patch (:509), fs.search (:927). Capability 'cabinet' -> send placed:[{objectType:'cabinet'}] (index.js:15814-15830). If placed is omitted the run uses the saved floor placement, which is empty in a scratch station, so fs tools may be absent. Always pass placed.
- Wire names replace '.' with '_': fs_write, fs_read, station_inspect, mcp__demo__lookup (seen in tests).
- Jail root: <WORKSPACES>/<agentId>/ (e.g. <fx.workspace>/eval/hello.txt). Absolute or escaping paths are refused unless path-trust is granted.
- Errors: a throwing tool yields tool_result ok:false isError:true and the model receives the message text; fs.read on a missing file throws "no such file: <path>" (fs.js ~:320). fs.write has a stale-write guard (fs.js ~:285): overwriting a file that changed on disk after the agent read it is refused with "stale write refused ... read it again", which matters for write-read-rewrite trials. The stream shows only summary strings; full content is visible only in the provider request messages (via the proxy).

## 6. MCP
- Configure with POST /api/connectors (handleConnectorUpsert index.js:12038). HTTP shape: {id:/^[A-Za-z0-9_-]{1,40}$/, label, transport:'http', url:'http://host:port/mcp', token?:'bearer', headers?:{k:v}, timeoutMs?:1000..600000, enabled?:false}. Plain http:// is allowed (oauth:true requires https). Response carries state:'up', toolCount, status (token never echoed). GET /api/connectors lists tools; POST /api/connectors/remove {id}. Persisted at <ws>/connectors/state.json. stdio transport needs a Safe Cell docker agent (skip).
- Tool name to the model: mcp__<connectorId>__<tool> (sidecar/mcp/translate.js:47-57), e.g. mcp__demo__lookup. Account-level: advertised on interactive isTask runs without a placed entry (test comment ~:526). Consent per call unless full access (prompt.tool equals the wire name). Autonomous/cron runs do not expose unknown MCP tools until granted, so use /api/run.
- Mock MCP server template (streamable-HTTP JSON-RPC: initialize, notifications/initialized -> 202, tools/list, tools/call): test/e2e.mcp-connector.test.js ~:20-60.

## 7. Existing e2e templates
- test/e2e.run.test.js (boot + mock OpenRouter + NDJSON asserts), test/e2e.mcp-connector.test.js (MCP + tool call + /api/consent loop; readNdjson ~:188), test/full-access.e2e.test.js, test/casual-response-safety.e2e.test.js. Mock provider tool-call SSE: delta.tool_calls[{index:0,id,type:'function',function:{name,arguments}}] then finish_reason 'tool_calls' with usage.

## RECIPE
(a) Boot (Node, outside repo):
  const { SidecarFixture } = require('C:/dev/starnet/test/helpers/sidecar-fixture.js');
  const fx = new SidecarFixture({ timeoutMs: 20000, env: { STARNET_API_TOKEN: 'evaltoken', STARNET_QUEST_REFRESH: '0', SKYNET_QUEST_REFRESH: '0', SKYNET_AUX_BUDGET: '0', SKYNET_OLLAMA_MAX_TOKENS: '4096' } });
  await fx.start();  // fx.baseUrl, fx.token, fx.workspace; always await fx.dispose() in finally
  Leave FULL_ACCESS unset if you want to measure approvals.
(b) Token: fx.token (or scrape GET /). With STARNET_API_TOKEN preset the scrape returns that value (should; UNCERTAIN, untested).
(c) Request:
  POST fx.baseUrl + '/api/run'  headers {Content-Type: application/json, X-StarNet-Token: tok, Origin: fx.baseUrl}
  {"provider":"ollama","model":"qwen3:8b","baseUrl":"http://127.0.0.1:<proxyport>/v1","agentId":"eval","streamId":"t1","isTask":true,"placed":[{"objectType":"cabinet"}],"messages":[{"role":"user","content":"Write hello.txt containing hi, then read it back."}]}
  Use a fresh streamId (and/or agentId) per trial to avoid carried-over history/memory. Optionally seed POST /api/roster {updatedAt:Date.now(), agents:[{agentId:'eval',name:'Eval',system:'..',provider:'ollama',model:'qwen3:8b'}]} first. Caveat: an isTask run injects a large operator manual / orchestration system prompt (prompt-size and tool-count heavy for an 8B model, itself a relevant finding). internal:true keeps a custom system prompt verbatim but probably drops tools: UNCERTAIN, test it.
(d) Parse: agent.run.start (runId), agent.tool_call (name, argsSummary), tool.args.repaired (malformed-call metric), agent.tool_result (ok/isError/ms/summary), agent.token deltas (final text), agent.waiting, permission.prompt, agent.cost (tokensIn/Out), agent.run.end (reason, turns), agent.run.error. Wall time on the client clock. Raw wire: tiny reverse proxy to http://127.0.0.1:11434 passed as body.baseUrl; log each /chat/completions request body (messages, tools, max_tokens) and the SSE response (full tool args, finish_reason).
(e) Approvals: on permission.prompt POST /api/consent {runId, promptId, decision:'once'}. Scratch-only alternative: STARNET_FULL_ACCESS=1.
(f) MCP: start the http MCP server, POST /api/connectors {id:'demo',label:'Demo',transport:'http',url:'http://127.0.0.1:<p>/mcp'}; check state 'up' and toolCount; then /api/run with isTask:true; the tool is mcp__demo__<tool>.
