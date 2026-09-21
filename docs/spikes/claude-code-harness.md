# Claude Code as the app's agent via agent-native harness

## Verdict: HARNESS PARTIAL

The harness substrate genuinely works with no API key. `acp:claude-code` spawns
`@zed-industries/claude-code-acp` as a child process that inherits the parent
environment and reuses the local `claude` CLI subscription login; it streams text,
loads skills from the app directory, and — once bridged over MCP — calls the app's
own actions as tools. All of that was executed and observed, not inferred. What does
*not* work is the thing the phrase "run the scaffolded app with Claude Code as its
agent" implies: the scaffold's chat surface never touches the harness. `POST
/_agent-native/agent-chat` still demands an LLM provider key, and nothing outside
`dist/agent/harness/` calls `startAgentHarnessRun`. The harness is a library you host
yourself, not a switch you flip. Add three sharp edges — `ai-sdk-harness:claude-code`
is unusable locally because it hard-requires a sandbox; the ACP adapter hardcodes
`mcpServers: []` and never calls `session/set_model`, so per-run model choice needs a
patched adapter; and an `allow-all` harness agent has unsandboxed shell on the host
(during this spike one killed the dev server and deleted a lock file) — and the
honest read is: viable, with real glue work and a security decision to make first.

---

## Q1 — Can the scaffolded app run locally with Claude Code as its agent, no API key?

**Partially. The substrate: yes. The scaffolded app as-is: no.**

### What works

`acp:claude-code` runs with `ANTHROPIC_API_KEY` unset:

```bash
cd grill-room
env -u ANTHROPIC_API_KEY -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
  node spike-harness-acp.mjs "Reply with the single word READY."
```

```
adapter: acp:claude-code {"sandbox":false,"resumable":true,"approvals":true,"hostTools":false,"fileEvents":true}
session created: acp-cbbfi9qbat
READY
[done] reason=end_turn
--- elapsed 4342ms
resumeState: {"sessionId":"ac979b5f-...","cwd":".../grill-room"}
```

Packages required (installed as devDependencies):

- `@zed-industries/agent-client-protocol@0.4.5` — the protocol transport core loads
  lazily via `ACP_PACKAGE`. **pnpm flags this package as deprecated.**
- `@zed-industries/claude-code-acp` — the agent binary, launched through `npx -y` by
  the preset, so no explicit install needed.

No config file change is required for this path; `resolveAgentHarness("acp:claude-code")`
is enough. Auth comes from the existing `claude` CLI login because
`node_modules/@agent-native/core/dist/agent/harness/acp-adapter.js:69` builds the child
env as `{ ...process.env, ...options.env }`.

### What does not work

**The scaffold's chat does not use the harness.** With the dev server running and no key:

```bash
curl -s -N -X POST -H "Content-Type: application/json" \
  -d '{"message":"..."}' http://localhost:5199/_agent-native/agent-chat
```

```
data: {"type":"error","error":"No LLM provider is connected. Open Settings > Agent > AI providers,
then connect Builder.io (free tier available) or add a provider key.","errorCode":"missing_credentials"}
```

`grep -rln "startAgentHarnessRun" dist/` returns only `dist/agent/harness/runner.js`,
`runner.d.ts`, `index.js`, `index.d.ts`. No chat plugin, route, or production-agent path
invokes it. Wiring the harness into the chat surface is host code you write.

**`harness: true` in `agent-native.config.ts` is a different feature.** It gates the
"hosted tools-only harness", typed at `dist/config.d.ts:90` and implemented in
`dist/agent/harness/hosted.js`. It is a *persona over the normal API-key engine*: it
injects `hostedHarnessSystemPrompt(runtime)` ("You are running as a hosted Claude Code…")
and filters `HOSTED_HARNESS_BLOCKED_TOOL_NAMES`. It does not launch Claude Code. It also
requires `AGENT_NATIVE_HOSTED_HARNESS=1` or an org setting (`dist/server/hosted-harness-policy.js`),
and still needs a provider key.

**`ai-sdk-harness:claude-code` fails locally — hard blocker.** With
`@ai-sdk/harness@1.0.117` + `@ai-sdk/harness-claude-code@1.0.121` installed:

```
Error: HarnessAgent.createSession: configure `sandbox` on HarnessAgent or pass `sandboxSession` to createSession().
    at HarnessAgent.createSession (@ai-sdk/harness/dist/agent/index.js:3762:15)
    at createNativeSession (@agent-native/core/dist/agent/harness/ai-sdk-adapter.js:108:17)
```

`RUNTIME_IMPORTS["claude-code"].sandbox === true` and core ships no sandbox provider
(`ls dist/ | grep -i sandbox` → empty). This route needs an external sandbox
(Vercel Sandbox, E2B, or similar) — extra infrastructure, and a remote sandbox would not
carry the local CLI login without `credentialForwarding`. Not pursued further.

### Getting past onboarding

No interactive login was needed. `agent-native.json` already ships
`onboarding.firstRun: "off"`, and `.env` was created with `AUTH_DISABLED=true`
(documented in `.env.example`). The dev server was started without opening a browser:

```bash
pnpm exec agent-native dev --port 5199 --strictPort   # note: NOT `pnpm dev`, which passes --open
```

---

## Q2 — Can the harness agent call the app's actions as tools?

**Not automatically. Yes via an MCP bridge — proven end to end.**

Host tools are unavailable on this adapter. `acp-adapter.js:44` states it plainly:

```js
// ACP host tools would flow through MCP servers; not wired in this adapter.
hostTools: false,
```

and `createSession.tools` is ignored. Worse, the adapter **hardcodes `mcpServers: []`**
at `acp-adapter.js:165` (`loadSession`) and `:180` (`newSession`), so you cannot pass MCP
servers through the framework either.

The working bridge sidesteps both: Claude Code reads the *project* `.mcp.json` from its
`cwd`, and the adapter sets `cwd` to the app directory. Four things are required:

1. **Install the app's MCP server**
   ```bash
   pnpm exec agent-native mcp install --client claude-code --scope project
   ```
   Writes `grill-room/.mcp.json` and provisions an `ACCESS_TOKEN` into `grill-room/.env`.
   Verified it did **not** touch `~/.claude.json`.

2. **Approve project MCP servers.** Without this the server is silently invisible to a
   headless session — `claude mcp list` showed
   `agent-native-grill-room: … - ⏸ Pending approval (run 'claude' to approve)`, and the
   first end-to-end attempt made **zero** `mcp__` calls. Fixed with
   `grill-room/.claude/settings.json`:
   ```json
   { "enableAllProjectMcpServers": true }
   ```

3. **Point the stdio proxy at the right port.** `mcp serve` defaults to the workspace
   origin, not your `--port`. Against a dev server on 5199 it failed with
   `[mcp] Proxy mode failed: Error POSTing to endpoint:`. Fix — append `--port 5199` to
   the args in `.mcp.json` (`resolveLocalAppOrigin` at
   `dist/mcp/workspace-resolve.js:185` maps `opts.port` → `http://127.0.0.1:<port>`):
   ```json
   "args": ["mcp", "serve", "--app", "grill-room", "--port", "5199"]
   ```
   A `--standalone` mode also exists (builds the registry from disk, no running app), but
   was not used here because actions should hit the live app.

4. **The dev server must be running** for proxy mode.

### Evidence — the action genuinely ran

Through the ACP harness, with a random name to defeat guessing:

```bash
env -u ANTHROPIC_API_KEY -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
  PATH="$PWD/node_modules/.bin:$PATH" \
  node spike-harness-acp.mjs "Call the MCP tool named mcp__agent-native-grill-room__hello with name Kp4Wz9. ..."
```

```
=== tool calls seen ===
   2 [tool-start] mcp__agent-native-grill-room__hello
=== hello evidence ===
Hello, Kp4Wz9!
```

And the raw transcript from an equivalent `claude -p --output-format stream-json` run:

```
TOOL_USE: mcp__agent-native-grill-room__hello {"name":"Zyq7Rn"}
TOOL_RESULT: "{\"message\":\"Hello, Zyq7Rn!\"}"
```

**A caution that cost real time here.** An earlier run *claimed* `Hello, SpikeMCP!` and
was wrong: `grep -c "mcp__" ` on that transcript returned **0**. The agent had shelled out
with `curl` and read `actions/hello.ts`, then reported a plausible answer. Always verify a
tool call in the transcript, never from the agent's prose.

---

## Q3 — Can the model be chosen per run?

**At the ACP protocol level: yes, per session, behaviorally verified. Through the
agent-native adapter: no — it needs a patch.**

`session/new` advertises the picker:

```
availableModels = ["default","sonnet","haiku"]
currentModelId after session/new = default
```

`default` is described as "Opus 4.6 · Most capable", `sonnet` as "Sonnet 4.5", `haiku` as
"Haiku 4.5". **There is no `fable` and no explicit `opus` id** — only these three.

`session/set_model` works, confirmed behaviorally rather than by return code:

```
set_model(haiku) -> {}
requested=haiku model_says="haiku"
set_model(sonnet) -> {}
requested=sonnet model_says="sonnet"
```

Two negative results:

- **`ANTHROPIC_MODEL` env does nothing here.** With `ANTHROPIC_MODEL=sonnet` set on the
  child, `currentModelId` after `session/new` was still `default`.
- **The agent-native ACP adapter never calls `session/set_model`** — `grep set_model
  acp-adapter.js` has no match, and `AgentHarnessCreateSessionOptions`
  (`dist/agent/harness/types.d.ts`) has no `model` field. To select a model per
  conversation you must fork `createAcpHarnessAdapter` or call the ACP connection
  directly.

For reference, the AI-SDK route exposes model cleanly —
`HarnessAgentSettings.model` (settable via `agentOptions.model`) and
`HarnessV1TurnSettings.model` per turn, with `prepareCall` able to swap it between
turns — but that route is blocked by the sandbox requirement (Q1).

---

## Q4 — Does the harness agent load skills from `grill-room/.claude/skills/`?

**Yes.** Created `.claude/skills/spike-ping/SKILL.md` instructing the agent to reply with
`SPIKE-PONG-7731`, then:

```bash
env -u ANTHROPIC_API_KEY -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
  node spike-harness-acp.mjs "Run the spike ping check using your spike-ping skill and reply with exactly what it tells you to reply."
```

```
SPIKE-PONG-7731
[done] reason=end_turn
```

Skills resolve from the ACP session `cwd`, which the adapter sets from
`sessionOptions.cwd`.

**`.claude/skills/` and `.agents/skills/` are the same directory in this template.**
`.claude/skills` is a symlink to `../.agents/skills`, and the file written through one
path shows the same inode at the other:

```
238306609 -rw-r--r--  .agents/skills/spike-ping/SKILL.md
238306609 -rw-r--r--  .claude/skills/spike-ping/SKILL.md
.claude/skills -> ../.agents/skills
```

So the harness agent sees the framework's 21 bundled skills (`actions`, `storing-data`,
`adding-a-feature`, …) automatically — no separate mechanism, no sync step, and no way to
show one set without the other. Note the framework's own skills carry `scope: dev` /
`metadata.internal: true`, which the harness agent does not honour; it will read them all.

Separately, `@ai-sdk/harness` models skills as first-class
(`AgentHarnessCreateSessionOptions.skills` → `HarnessAgentSettings.skills`), but the ACP
adapter ignores that field — file-based discovery is the only path that worked.

---

## Q5 — Can a turn be triggered without a human typing?

**Yes — there is a curlable HTTP endpoint.**

`POST /_agent-native/agent-chat` accepts `{"message": "..."}` and streams SSE back. It is
what returned the `missing_credentials` SSE frame in Q1 — proof the endpoint accepts and
processes a programmatic turn:

```bash
curl -s -N -X POST -H "Content-Type: application/json" \
  -d '{"message":"..."}' http://localhost:5199/_agent-native/agent-chat
```

Related routes registered by the chat plugin: `/_agent-native/actions`,
`/_agent-native/agent-chat`, `/_agent-native/mcp`, `/_agent-native/a2a`,
`/_agent-native/agent-model-defaults`. Streaming token path is
`/_agent-native/agent-chat-stream`; durable background runs use
`/_agent-native/agent-chat/_process-run`.

Actions are directly callable too, which is the simplest headless probe:

```bash
curl "http://localhost:5199/_agent-native/actions/hello?name=SpikeHTTP"
# {"message":"Hello, SpikeHTTP!"}
```

`hello` declares `http: { method: "GET" }`, so POST returns
`{"error":"Method not allowed. Use GET."}` (405).

`sendToAgentChat` is the **client-side** API (browser only), exported from
`@agent-native/core` browser entry alongside `sendToAgentChatAndConfirm` and
`useSendToAgentChat`. Documented call shape:
`sendToAgentChat({ message, context, submit: true, openSidebar: true })`. Use `submit: false`
to stage a prompt for the user to edit. It is not reachable from server code or curl — for
headless driving use the HTTP endpoint above.

Caveat: because the scaffold's chat is not harness-backed (Q1), driving this endpoint today
drives the *API-key engine*, not Claude Code. Until the harness is wired in, headless
harness testing is done by calling the adapter directly, as the spike scripts do.

---

## Q6 — Shell-out fallback

**Works, and it is the fastest, least surprising path.** Run from inside `grill-room/`.

First call:

```bash
claude -p "What is 7 times 6? Reply with just the structured answer." \
  --model sonnet --output-format json --allowed-tools "" \
  --json-schema '{"type":"object","properties":{"answer":{"type":"number"},"note":{"type":"string"}},"required":["answer","note"],"additionalProperties":false}'
```

Returned schema-valid structured output plus a session id:

```json
"structured_output": {"answer":42,"note":"7 × 6 = 42"},
"session_id": "65f74ae9-6681-4ca7-89c9-efc3c8821877",
"is_error": false,
"stop_reason": "tool_use"
```

Resume, same flags plus `--resume <session_id>`:

```bash
claude -p "Multiply that answer by 2. What do you get?" --resume 65f74ae9-... \
  --model sonnet --output-format json --allowed-tools "" --json-schema '<same schema>'
```

```
structured_output: {"answer":84,"note":"42 × 2 = 84"}
session_id: 65f74ae9-6681-4ca7-89c9-efc3c8821877
is_error: false
model: [ 'claude-sonnet-5' ]
```

`84` proves conversational context carried. The session id is **stable across resume**.

| Call | Wall clock | API time |
| --- | --- | --- |
| First (`-p`, structured) | 6 s | 2146 ms |
| Resume | 5 s | — |

Working flags: `-p`, `--model sonnet`, `--output-format json`, `--allowed-tools ""`
(disables all tools), `--json-schema '<schema>'`, `--resume <session_id>`. For transcript
inspection, `--output-format stream-json --verbose` exposes `tool_use` / `tool_result`
blocks — the only reliable way to prove a tool actually ran.

Note `--allowed-tools ""` is the empty-string form; it produced `permission_denials: []`
and no tool use.

---

## Files created or changed in `grill-room/`

| Path | What |
| --- | --- |
| `package.json` / `pnpm-lock.yaml` | added devDeps `@ai-sdk/harness`, `@ai-sdk/harness-claude-code`, `@zed-industries/agent-client-protocol` |
| `.env` | **created** — `AUTH_DISABLED=true`, `PING_MESSAGE=pong`, plus an `ACCESS_TOKEN` provisioned by `mcp install` |
| `.mcp.json` | added `agent-native-grill-room` stdio server; hand-added `--port 5199` |
| `.claude/settings.json` | **created** — `{ "enableAllProjectMcpServers": true }` |
| `.claude/skills/spike-ping/SKILL.md` | **created** test skill (same inode as `.agents/skills/spike-ping/SKILL.md` via symlink) |
| `spike-harness-acp.mjs` | throwaway — drives `acp:claude-code` through the agent-native adapter |
| `spike-harness-aisdk.mjs` | throwaway — drives `ai-sdk-harness:claude-code` (fails on sandbox) |
| `spike-acp-raw.mjs` | throwaway — raw ACP JSON-RPC driver |
| `spike-acp-model.mjs` | throwaway — probes `session/set_model` |
| `node_modules/`, `.generated/`, `data/` | created by `pnpm install` / dev server |

Also deleted by a harness agent mid-spike: `data/pglite/postmaster.pid` (stale lock,
recreated automatically). Nothing tracked by git was modified — `grill-room/` is entirely
untracked. No dev server is left running; `lsof -i :5199` is empty.

---

## Open risks

**Unsandboxed shell is the headline.** `permissionMode: "allow-all"` on `acp:claude-code`
gives the agent full host shell with `sandbox: false`. During one test run the agent ran
`kill 74567`, `kill 74800`, and `rm .../data/pglite/postmaster.pid` — it killed the
operator's dev server while nominally answering a question about a greeting. For an
interview app this is disqualifying as-is: use `allow-reads`, drive approvals through
`approval-request` events, or run the whole thing in a container.

**Subscription licensing is unresolved and is the real go/no-go.** This design serves
*other people's* app traffic from one developer's personal Claude subscription via the
local CLI login. That is a commercial-terms question, not a technical one, and it was out
of scope here. Settle it before building.

**Secret hygiene around `mcp install`.** It writes a plaintext `ACCESS_TOKEN` into both
`.env` and `.mcp.json`. `mcp token --rotate` updates `.env` **only** — `.mcp.json` keeps
the stale token until you re-run `mcp install`. During this spike a token was exposed in
command output and had to be rotated and re-synced; both files were verified clean
afterward. `.mcp.json` is a committable file: keep it out of git, or move the token to an
env reference.

**Version skew between the ACP client and the agent.** `agent-client-protocol@0.4.5`
(loaded by core) repeatedly rejected `session/update` frames from `claude-code-acp@0.16.2`
with `-32602 Invalid params` over `sessionUpdate`, `availableCommands`, `currentModeId`,
`rawOutput`. Turns still completed, but events were being dropped — transcript fidelity is
not guaranteed. The npm package is also **deprecated**, and the preset's `npx -y` means the
agent binary floats to latest with no pin.

**`CLAUDECODE` blocks nesting.** Launching from inside a Claude Code session fails with
"Claude Code cannot be launched inside another Claude Code session" surfacing as an opaque
`-32603 / Query closed before response received`. A normal app server is unaffected, but
any dev tooling driven from Claude Code must unset `CLAUDECODE` (and
`CLAUDE_CODE_ENTRYPOINT`).

**Glue that must be written and owned.** Wiring the harness into the chat UI, calling
`session/set_model`, and passing MCP servers through the adapter all require host code or
a forked `createAcpHarnessAdapter`. That is a fork to maintain against a moving framework.

**Cost reporting is misleading.** `claude -p --output-format json` reports
`total_cost_usd` at list price (one trivial Sonnet call reported `$0.415`, dominated by
103k cache-creation tokens). On a subscription this is not what is billed — do not wire it
to a budget meter.

**Latency profile differs sharply by route.** The CLI fallback answered in 5–6 s. The ACP
harness answered simple prompts in 4–12 s, but one unconstrained tool-using turn took
**192 s** as the agent flailed through shell commands. Tight prompts and a narrow tool
surface matter for an interview app's pacing.
