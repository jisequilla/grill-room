# grill-room — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework:** @agent-native/core + React Router v8 (framework mode)
- **Frontend:** React 19, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)

## Commands

- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Start:** `node .output/server/index.mjs` (production)
- **Unit/action tests:** `pnpm test` (vitest, the action boundary — see "Testing Decisions" in `.grill-room/grill-room/spec.md`)
- **Browser smoke test:** `pnpm test:e2e` (Playwright — see below)
- **Both:** `pnpm test:all`

## Testing

Everything except one thing is tested at the action boundary with vitest —
`pnpm test`, which never opens a browser and never calls the real Claude CLI.

The one exception is `e2e/smoke.spec.ts`, a single Playwright test that walks
a full grilling session through the real UI: create a session, answer a round
(accepting a recommendation and using one steering move), submit it, resolve
the loose end that leaves, confirm, write the spec, and break it into
tickets. Run it with `pnpm test:e2e`.

It starts its own dev server (`playwright.config.ts`'s `webServer`) rather
than reusing anything already running, with two things forced regardless of
your shell's environment:

The port defaults to `5240` but is overridable via `E2E_PORT`; `just e2e`
(run from the repo root) picks a free one automatically so two worktrees can
run it at the same time without colliding.

- `GRILL_ROOM_INTERVIEWER=fake` — the scripted interviewer
  (`server/interviewer/fake.ts`) serves a fixed, canned interview
  (`cannedInterviewTurns()`) instead of calling the real `claude` CLI. The
  config asserts this before it will even start the server.
- `DATABASE_URL=pglite:<a fresh temp directory>` — a brand-new, empty
  database for the run, never `grill-room/data/pglite`.

**The fake interviewer's turn queue lives once per server process, not once
per session** — it is a plain in-memory queue, consumed in order by whichever
session asks next. That is why this suite is one test file, one test, one
Playwright worker, no retries: a second test, a retry, or a second session in
the same run would ask the interviewer for a turn that was already handed to
someone else and get a "next queued turn is X but the request was Y" error.
If you need another end-to-end scenario, either script its own turns onto a
second `webServer` (a second config, a different port) or extend the existing
test's one session rather than starting a second one.

The suite runs headless Chromium at a pinned `@playwright/test` version
whose bundled Chromium build matches what was already cached on this
machine (`~/Library/Caches/ms-playwright`), so it never triggers a browser
download. Screenshots on failure and the HTML report are written to
`e2e/artifacts/` and `playwright-report/`, both gitignored.

## The docs folder, and what the CLI actually enforces

A session's optional docs folder is the only path the app ever lets the
interviewer read. `server/interviewer/claude-cli.ts` builds the narrowed
invocation and `server/interviewer/claude-cli.test.ts` is its contract: the
argument list without a folder is asserted whole, so the tool-less turn cannot
drift, and every flag of the narrowed turn is asserted individually.

What the CLI enforces:

- **The tool set.** `--tools Read,Grep,Glob` is the whole set of built-in tools
  that exist for the turn. Nothing that writes, runs a command, or reaches the
  network is in it, and `--restricted` removes those categories again anyway.
- **The directory.** There is no flag that scopes a single tool to a path.
  Confinement comes from `--restricted`, which limits the file tools to the
  working directories — the child's `cwd` (the folder) plus `--add-dir`, which
  names the same folder. Without `--restricted`, `--add-dir` only *widens*.
- **Permission escalation.** `--permission-prompts none` denies anything that
  would prompt rather than waiting on a terminal nobody is watching. No
  `--permission-mode` is passed, so nothing is pre-granted.
- **The folder's own configuration.** `--restricted` ignores the user, project
  and local settings files; `--strict-mcp-config` ignores a `.mcp.json` in the
  folder; `--disable-slash-commands` stops its `.claude/skills` from loading
  (skills resolve from the working directory — see
  `../docs/spikes/claude-code-harness.md`, Q4).

What it does **not** enforce: a `CLAUDE.md` or `AGENTS.md` in the docs folder is
still auto-discovered and prepended to the turn's context. The only flag that
skips memory discovery is `--bare`, and `--bare` reads Anthropic credentials
strictly from `ANTHROPIC_API_KEY` or an `apiKeyHelper` — never OAuth or the
keychain — so it cannot be used with the subscription login this app runs on.
Treat a docs folder's memory files as text the interviewer will read.

## Directory Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  entry.client.tsx     # Client hydration entry
  routes.ts            # Route config — flatRoutes()
  routes/              # File-based page routes (auto-discovered)
    _index.tsx         # / (chat page)
  components/          # UI components
  hooks/               # React hooks
  lib/                 # Utilities (cn, etc)

server/                # Nitro API server
  routes/
    api/               # Route-only endpoints (uploads, webhooks, OAuth, streaming)
    [...page].get.ts   # SSR catch-all (delegates to React Router)
  plugins/             # Server plugins (startup logic)
  lib/                 # Shared server modules

shared/                # Isomorphic code (imported by both client & server)

actions/               # Shared app operations (defineAction; UI uses action hooks)
  run.ts               # Script dispatcher
  *.ts                 # Individual actions (pnpm action <name>)

data/pglite/           # Local PGlite data directory

react-router.config.ts # React Router framework config
.agents/skills/        # Agent skills — detailed guidance for each rule
```

## Framework Basics

**SSR-first framework, CSR-by-default content:** This app uses React Router v8 framework mode with `ssr: true`. But virtually every route renders only an SSR shell (loading spinner + meta tags). Normal app data fetching happens on the client via action hooks. Server-side data fetching is the exception — only used for public pages that need SEO/OG tags.

## Chat-First Shape

Agent-Native is the application framework and execution platform. AgentKit is
its agent interaction and experience layer. Toolkit supplies the semantic
composer, design-system primitives, and workspace UI used around the
conversation.

The `/` route is the app's primary AgentKit surface. Its default integration is:

- `createAgentNativeAgentKitTransport()` from
  `@agent-native/core/client/agent-chat` for the production Agent-Native
  runtime.
- `AgentKitRoot` for one managed controller and thread context.
- `AgentKitChat` for the reference transcript, composer, queue, approvals,
  activities, and suggestions.
- `CoreComposerRuntimeProvider` for Agent-Native composer capabilities.

The surrounding Core app shell owns the full-height canvas, global navigation,
durable thread routing, and route-level chrome. `AgentKitChat` owns the
conversation column. Pass route controls through its `toolbar` prop. Use
`slots` and `registry` on `AgentKitRoot` for presentation overrides without
forking conversation state.

This template is also the canonical AgentKit reference surface. Develop and
verify shared chat UX here first, then use domain apps such as Dispatch as
consumer smoke tests. Queue behavior can be exercised by submitting follow-ups
while a run is active. The shared composer remains mounted throughout these
states. The route does not provide fallback suggestions: contextual next
actions appear only when the agent injects them through AgentKit's structured
`suggestions` input.

For a headless app that later needs UI, this template is the intended landing
zone: bring the existing actions over, keep their names stable, and let the chat
call them before adding extra screens. For a custom agent backend, keep the app
shell and implement `AgentTransport`, or adapt an existing Core
`AgentChatRuntime` with `createAgentKitProtocolAdapter()` from
`@agent-native/core/client/chat`.

### Package and scaffold path

The Chat template depends on `@agent-native/core`,
`@agent-native/agentkit`, and `@agent-native/toolkit` through workspace
specifiers in this repository. The CLI resolves them for the generated shape:

- A normal standalone scaffold receives published package ranges.
- A local framework-development scaffold packages the local Core, AgentKit,
  and Toolkit implementations. Missing compiled package exports are built
  before the tarballs are created.
- A workspacified Chat app inherits a concrete package version already pinned
  by the workspace root. Otherwise it uses the compatible range supplied by
  the running CLI.

Do not replace these dependencies with direct `dist` paths or deep source
imports. Install the generated manifest as written.

### Migrate an older Core chat surface

Migrate the presentation boundary while keeping application contracts stable:

1. Keep actions, application-state keys, thread routes, auth, access checks,
   and the Core agent runtime.
2. Create one `createAgentNativeAgentKitTransport()` and pass it to
   `AgentKitRoot` or `AgentChat`.
3. Replace the old Core transcript component. Move visual overrides to AgentKit
   slots and kind registries, and move commands to `useAgentKitControl()`.
4. Remove the old controller, queue, approval store, and stream subscription.
   One conversation must have one behavioral owner.

Widgets invoke stable action ids through the transport. Map them to the same
`defineAction` surface used by the app and agent. Smart objects and client
effects request host navigation or context changes. They do not bypass action
validation, application-state helpers, request context, or ownable-data access
checks.

## Adding a Page

Create a file in `app/routes/`. The filename determines the URL path:

```
app/routes/_index.tsx              → /
app/routes/settings.tsx            → /settings
app/routes/inbox.tsx               → /inbox
app/routes/inbox.$threadId.tsx     → /inbox/:threadId
app/routes/$id.tsx                 → /:id (dynamic param)
```

Each route file exports a default component, optional `meta()`, and optional `HydrateFallback()`:

```tsx
import MyPage from "@/pages/MyPage";

export function meta() {
  return [{ title: "My Page" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function MyPageRoute() {
  return <MyPage />;
}
```

**Do NOT fetch data server-side** in route loaders unless the page genuinely needs SEO/OG content. The standard pattern is: SSR renders the shell, client hydrates, and React reads/writes normal app data through actions with `useActionQuery` / `useActionMutation`.

## Adding App Data

Normal app data starts as an action, not a custom route. Add `actions/<verb>-<resource>.ts` with `defineAction`, mark reads with `http: { method: "GET" }`, and call reads/writes from React with `useActionQuery` / `useActionMutation` from `@agent-native/core/client`. This keeps the UI and agent on one contract and lets mutating actions refresh action-backed queries automatically.

## Adding a Route-Only Endpoint

Use `server/routes/api/` only for protocols that cannot be modeled as JSON actions: multipart uploads, streaming/SSE/WebSocket, webhooks, OAuth callbacks/redirects, public SEO/OG endpoints, or binary/static asset serving. Do not add `/api/*` routes for normal CRUD, data queries, or pass-through wrappers around actions; the action endpoint already exists at `/_agent-native/actions/:name`.

Each route-only endpoint still exports a default `defineEventHandler`, but keep shared app logic in actions or server libraries so agent and UI behavior do not fork.

## Adding a Server Plugin

Startup logic (auth, SSE, etc.) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

## Key Imports from `@agent-native/core`

| Import                                       | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)                            |
| `createDefaultSSEHandler`                    | Create SSE endpoint for DB change events (server)                          |
| `readAppState`, `writeAppState`              | Read/write application state (from `@agent-native/core/application-state`) |
| `readSetting`, `writeSetting`                | Read/write settings (from `@agent-native/core/settings`)                   |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)                                   |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)                               |
| `agentChat`                                  | Send messages to agent from scripts (server-side)                          |

## Adding an Action

Create `actions/<verb>-<resource>.ts` with `defineAction`. Run with `pnpm action <name> --id value`; React callers should use `useActionQuery` for GET actions and `useActionMutation` for mutating actions, not a matching `/api/*` wrapper.

**Sending to agent chat from UI:**

```ts
import { sendToAgentChat } from "@agent-native/core/client";
sendToAgentChat({
  message: "Generate something",
  context: "...",
  submit: true,
});
```

**Sending to agent chat from scripts:**

```ts
import { agentChat } from "@agent-native/core";
agentChat.submit("Generate something");
```

## Database & Environment Variables

Local development uses PGlite at `data/pglite`. For production and shared environments, set `DATABASE_URL` to a persistent hosted PostgreSQL database.

Real credential values belong only in local `.env` files, deployment configuration, or registered secrets/settings UI. Never commit, document, log, return, paste, or include real keys, tokens, webhook URLs, signing secrets, or private data in examples; use empty values or obvious placeholders.

When adding app data, define tables with `@agent-native/core/db/schema` helpers and use Drizzle's query builder for reads/writes. Keep SQL PostgreSQL-compatible and reserve raw SQL for additive migrations, health checks, or carefully scoped maintenance.

### App tables carry a `gr_` prefix

The app shares its database with the framework, which creates well over a hundred generically named tables of its own — `sessions`, `settings`, `documents`, `resources`, `tools`. A collision is silent: the app's `CREATE TABLE IF NOT EXISTS` becomes a no-op against the framework's table, and the failure surfaces migrations later as a foreign key to a column that does not exist.

Every app table, index, and the migrations bookkeeping table therefore carries the SQL name prefix `gr_`. Drizzle's export names in `server/db/schema.ts` do not — `schema.sessions` is the `gr_sessions` table — so query code is unaffected. `test/table-names.test.ts` fails if a new table breaks the rule.

### Migrations

`server/db/migrations.ts` holds the schema as an ordered list of additive entries. Append with a new `version` and a stable `name`; never renumber, rename, or edit an entry that has shipped. An entry may contain several statements separated by semicolons: both the startup plugin and the test harness apply the list through the framework's migration runner, which splits them.

| Variable        | Required                     | Description                                                                   |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`  | Production yes, local dev no | PostgreSQL or PGlite database URL (local dev default: `pglite:./data/pglite`) |
| `AUTH_DISABLED` | Optional                     | Set to `true` or `1` to skip login/signup (local dev/preview only)            |

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
