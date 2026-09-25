# Spike: a real grounding run

Bead gr-5e7.8, ticket `.scratch/handoff-scout/issues/05-real-run.md`. One run with the real interviewer and the real handoff scout against a temp clone of the marathon tracker. It takes a session through to a handoff, grounds the briefs, exports them, and checks every grounded claim against the clone's code by hand.

## Verdicts

| # | Check | Verdict |
|---|-------|---------|
| 1a | Every edit target exists | **Pass**: 7 of 7 |
| 1b | Every create target is new, inside the repo and not ignored | **Pass**: 2 of 2 |
| 1c | Nothing important missing from File boundaries | **Fail**: 3 gaps. Two tickets name a proof test they may not edit. Ticket 3 has no handler test. Ticket 3 cannot declare the 404 it must return |
| 2 | Codebase facts true at the cited line | **Pass, with caveats**: 22 facts. 19 true, 3 partly true, 0 false |
| 3 | Builds on names what the blocker produces, and the check is runnable | **Partial**: 1 of 3 edges is sound. Two cite existing code the blocker does not produce, and their checks pass before the blocker exists |
| 4 | Proved by fits the test layout and runs the right tests | **Partial**: 1 of 4 sound. Ticket 1 passes. Ticket 3's command never touches the handler. Ticket 2's test path is not a test. Ticket 4's test file sits outside its own boundaries |
| 5 | HANDOFF.md says grounded only if every brief was | **Pass** |
| 6 | Cost | 1 turn with 2 runs and 2 attempts. **The first run failed terminally on a schema refine and was never retried.** No check refusals. 276 s of model time |

The scout is good at facts. It read the code, cited real lines, and surfaced two things the grill got wrong: the model has no planned distance, and today's no-plan response is a 500, not a 404. Its weak spots are the parts that describe the future. It has no way to say "a symbol the blocker adds to a file it edits", and its checks do not prove that a blocker exists. Its proof commands also drift from the ticket's own acceptance criteria. None of these weak spots is caught by a server check today.

## Setup

- **Project:** `git clone --no-hardlinks` of the marathon tracker into `<tmp>/marathon`, with a local git user set in the clone. The original repository was never written to. HEAD is `52b6bf2`. There is no `_test.go` file and no `backend/export/`.
- **Server:** one `pnpm exec agent-native dev --port 5417 --strictPort`, started from this worktree's `grill-room/`. It ran with `AUTH_DISABLED=true`, `DATABASE_URL=pglite:<scratch>/db` and `GRILL_ROOM_INTERVIEWER` unset, so the real interviewer ran. I recorded its PID (pnpm, plus the agent-native and vite children). At the end I stopped exactly those three PIDs and confirmed the port was free. The user's server on 8082 was not touched.
- **Driver:** every step went through `POST`/`GET /_agent-native/actions/<name>`, the way `e2e/support.ts` calls them.
- **Project registration:** `register-project` with root `<tmp>/marathon`, export folder `.scratch` and verify command `make test-go`. It resolved to visibility `tracked`, recipe `pull-request` and adversarial review on.
- **Branch checked first:** it has `actions/ground-briefs.ts` and `actions/get-brief-grounding.ts`. It also has `planExportBundle` in `server/export-bundle.ts`, which renders grounded briefs, and `groundedBriefs`/`ungroundedBriefs` on `actions/preview-export.ts`.

## The idea

Title "Export training log as CSV", model `sonnet`, whole-round, project set:

> Let the runner download their training log as a CSV file from the Progress view. Backend: a new Go package backend/export with a pure function that turns the plan's workouts into CSV rows (date, week, type, title, planned distance, completed, actual distance, duration), with Go unit tests (the repo's first _test.go). Then a new API endpoint GET /api/plan/export.csv added API-first to api/openapi.yaml, the generated code regenerated, and a handler in backend/server/server.go that calls the export package. Frontend: a Download CSV button on the Progress view that hits the endpoint. Keep it small: no filters, whole plan only.

I chose it so that one ticket would build on a file another ticket creates (`backend/export/…`).

### Rounds

I aimed for two or three rounds. It took four before the done proposal, as in the decisions round trip. I accepted every recommendation except four cards, where I gave my own answer from the code:

- **Round 1 (12 cards).** Own answer on `openapi-codegen-tool`: oapi-codegen through `backend/oapi-codegen.yaml`, plus `npm run api:generate`. The interviewer had no file access and could not tell.
- **Round 2 (5 cards).** Own answers on `auth-transport-compatibility` (there is no auth) and `frontend-href-source` (a hard-coded relative `/api/plan/export.csv`).
- **Round 3 (2 cards).** Own answer on `ci-test-execution`: no CI, and `make test-go` picks up new tests.
- **Round 4 (1 card).** Header wording. After it, the session was `done-proposed` and I confirmed.

After that: `synthesize-spec`, `break-into-tickets`, `generate-handoff`, `ground-briefs`, `preview-export`, then `export-session` with slug `export-training-log-as`.

## The tickets

| # | Title | Blocked by | Wave |
|---|-------|------------|------|
| 01 | Pure CSV-generation function for the training log export | none | 1 |
| 02 | Add GET /api/plan/export.csv to the OpenAPI spec and regenerate code | none | 1 |
| 03 | Wire the real export handler into backend/server/server.go | 01, 02 | 2 |
| 04 | Add the Download CSV button to the Progress view | 03 | 3 |

Ticket 03 builds on a file that ticket 01 creates, which is the edge the idea was chosen for. Ticket 03 also replaces a placeholder handler that ticket 02 adds to an existing file. Ticket 04 builds on a handler that ticket 03 writes into an existing file.

The acceptance lines that the checks below measure against:

- 01: "`make test-go` passes and exercises every case listed above".
- 02: "`go build ./...` and the frontend build both succeed with the placeholder handler in place".
- 03: "hitting the endpoint against a backend with an existing plan returns 200, a text/csv content type, a dated Content-Disposition filename, … hitting it with no plan returns 404 with an error body".
- 04: "the button renders on the Progress view; clicking it while a plan exists triggers a browser download of a file named with the current date".

## The turn record

`get-latest-turn` with `turnKind: handoff-scout` returned turn `9dfbedb0`, model `sonnet`, outcome `succeeded`, `totalElapsedMs` 328733. That total includes about 52 s I spent between the two runs.

| Run | Manual retry | Attempt | Kind | Duration | Reason |
|-----|--------------|---------|------|----------|--------|
| 1 | no | 1 | `schema-invalid` | 125.7 s | `Schema mismatch at tickets.3.buildsOn.0: A dependency carries either a citation or a path to be created, never both and never neither.` |
| 2 | yes | 1 | `success` | 150.6 s | none |

- **Run 1 ended the action with HTTP 400 `malformed-output`.** It was not refused and retried. Its raw output gave ticket 04's dependency on ticket 03 with `"citation": null, "createdPath": null`. The dependency was "a working GET /api/plan/export.csv endpoint", a handler that ticket 03 writes into the existing `server.go`. The same output also gave ticket 03's dependency on ticket 02 as `"createdPath": "backend/generated/api/api.gen.go"`. That file exists, and ticket 02 lists it as an `edit`. The app's check would have refused this, but the schema failure came first.
- **Run 2** was a second `ground-briefs` call. The app recorded it as a manual retry on the same turn. The app accepted it on the first attempt, with no check refusals. The grounding was stored with commit `52b6bf2` and `current: true`.

Why run 1 was terminal: the "exactly one of `citation` / `createdPath`" rule is a zod `.refine`. `z.toJSONSchema` drops it. I printed `jsonSchemaFor("handoff-scout")`, and its `buildsOn` item allows both fields to be null. So `--json-schema` does not stop the model from breaking the rule. The second validation in `claude-cli.ts` then throws `malformed-output`. `askUntilAccepted` only retries refusals from `reasonsToRefuse`, and says anything thrown "stops the loop". A rule the model can easily break costs the whole turn instead of one retry.

## Export

`preview-export` returned `groundingState: "current"`, `groundingStaleReason: null`, `groundedBriefs: [1, 2, 3, 4]` and `ungroundedBriefs: []`. It also returned `exportBlocked: false` and 13 planned writes, none edited. `export-session` wrote those 13 files with the same `groundedBriefs`/`ungroundedBriefs` and nothing kept or removed.

## The grounded sections, as exported

Each brief is quoted from `## File boundaries` up to `## Rules`. The rest of each brief is the unchanged template.

### Brief 01

````markdown
## File boundaries

Files to create:

- `backend/export/export.go`
- `backend/export/export_test.go`

Existing files it builds on:

- `backend/generated/api/api.gen.go:226-244`
- `backend/generated/api/api.gen.go:272-283`
- `backend/go.mod:1`

## Codebase facts

- The generated Workout struct has a PlannedDuration field (duration in minutes) but no planned-distance field. (`backend/generated/api/api.gen.go:226-244`)
- Actual distance and actual duration for a completed workout live on WorkoutMetrics.DistanceKm (float32) and WorkoutCompletion's ActualDuration (via WorkoutMetrics), not directly on Workout. (`backend/generated/api/api.gen.go:272-283`)
- The repository builds workout.Completion.Metrics.ActualDuration as an int (minutes) only when the DB column is valid, leaving it nil for incomplete workouts. (`backend/db/repository.go:744-749`)
- workout.Completed is set from whether a completion row exists (completionID.Valid), independent of the metrics fields. (`backend/db/repository.go:728-729`)
- The Go module path is github.com/jeremiasdeisequilla/marathon-tracker, which a new backend/export package would import as .../marathon-tracker/export. (`backend/go.mod:1`)
- The project's Go test command is `cd backend && go test ./...`, run via `make test-go`. (`Makefile:50-51`)

## Proved by

Test: `backend/export/export_test.go`

```bash
make test-go
```
````

### Brief 02

````markdown
## File boundaries

Files to edit:

- `api/openapi.yaml`
- `backend/generated/api/api.gen.go`
- `frontend/src/api/schema.d.ts`
- `backend/server/server.go`

Existing files it builds on:

- `backend/oapi-codegen.yaml:1-7`
- `docs/adr/001-api-first-openapi.md:64-74`
- `frontend/package.json:11`
- `backend/main.go:50-72`

## Codebase facts

- oapi-codegen.yaml configures generation of a chi server, models, and a strict server into generated/api/api.gen.go. (`backend/oapi-codegen.yaml:1-7`)
- ADR-001 documents the exact regeneration commands: `oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml` from backend/, and `npx openapi-typescript ../api/openapi.yaml -o src/api/types.ts` from frontend/. (`docs/adr/001-api-first-openapi.md:66-73`)
- The frontend's actual generation script is `openapi-typescript ../api/openapi.yaml -o src/api/schema.d.ts`, run via `npm run api:generate`. (`frontend/package.json:11`)
- An existing GET endpoint (/api/plan/progress) is modeled with an application/json response referencing a component schema, the pattern a new text/csv response would deviate from. (`api/openapi.yaml:80-98`)
- StrictServerInterface currently declares one method per operationId, e.g. GetPlan(ctx, request) and GetProgress(ctx, request), which a new operation would extend. (`backend/generated/api/api.gen.go:986-997`)
- main.go wires the strict handler into the chi router generically via api.HandlerFromMux(strictHandler, r), so any interface method implemented on Server becomes a live route without further router edits. (`backend/main.go:72`)
- Server.NewServer wraps a *db.Repository and is the receiver type on which endpoint methods (and the new placeholder) are defined. (`backend/server/server.go:14-24`)

## Proved by

Test: `backend/generated/api/api.gen.go`

```bash
cd backend && go build ./... && cd ../frontend && npm run build
```
````

### Brief 03

````markdown
## File boundaries

Files to edit:

- `backend/server/server.go`

Existing files it builds on:

- `backend/db/repository.go:37-72`
- `backend/server/server.go:53-78`

## Codebase facts

- Repository.GetPlan queries training_plans, returns (nil, nil) on sql.ErrNoRows, and otherwise attaches all weeks/workouts before returning the plan. (`backend/db/repository.go:37-72`)
- The existing GetPlan handler resolves the plan via s.repo.GetPlan() and currently returns a 500 Problem response (not 404) when the plan is nil, which is the resolution logic this ticket is told to reuse. (`backend/server/server.go:54-72`)
- Other handlers in server.go use the api.*404ApplicationProblemPlusJSONResponse{...} shape (Type/Title/Status/Detail) to build RFC 7807 error bodies for 404s. (`backend/server/server.go:168-196`)
- stringPtr is an existing helper in server.go for building *string fields on generated response types. (`backend/server/server.go:454-456`)

## Builds on

- Ticket 01: pure CSV-generation function in the export package — created by ticket 01 at `backend/export/export.go` — check: `cd backend && go test ./export/...`
- Ticket 02: generated StrictServerInterface method and placeholder handler for GET /api/plan/export.csv to replace — `backend/generated/api/api.gen.go:986-997` — check: `cd backend && go build ./...`

## Proved by

Test: `backend/export/export_test.go`

```bash
make test-go
```
````

### Brief 04

````markdown
## File boundaries

Files to edit:

- `frontend/src/components/progress/ProgressView.tsx`

Existing files it builds on:

- `frontend/src/types/index.ts:236-251`
- `frontend/src/hooks/useProgress.ts:23`
- `backend/main.go:72`

## Codebase facts

- ProgressView is a functional component typed with ProgressProps and currently renders header, hero progress, statistics, streak, and weekly-summary sections with no download/export UI. (`frontend/src/components/progress/ProgressView.tsx:4-24`)
- ProgressProps (used by ProgressView) is defined in frontend/src/types/index.ts and has no field related to CSV export. (`frontend/src/types/index.ts:236-251`)
- Every existing frontend data call goes through the typed openapi-fetch client (e.g. api.GET('/api/plan/progress')) rather than a plain anchor or hardcoded fetch. (`frontend/src/hooks/useProgress.ts:23`)
- Once implemented, GET /api/plan/export.csv is automatically routed through chi via api.HandlerFromMux(strictHandler, r), so the frontend can hit it as a plain relative path. (`backend/main.go:72`)
- The frontend's existing Playwright e2e suite already navigates to the Progress route (`/progress`) and asserts on visible elements there. (`frontend/e2e/navigation.spec.ts:18-21`)

## Builds on

- Ticket 03: live GET /api/plan/export.csv endpoint returning text/csv with a dated Content-Disposition filename — `backend/main.go:72` — check: `curl -i http://localhost:8080/api/plan/export.csv`

## Proved by

Test: `frontend/e2e/navigation.spec.ts`

```bash
cd frontend && npm run test:e2e
```
````

## The checks

Every check below was done by reading the clone at `52b6bf2`. Commands were run read-only in the clone. Go wrote only to its own build cache, and `git status` in the clone shows only the exported `.scratch/`.

### 1. File boundaries

**1a. Edit targets exist: Pass (7 of 7).** `api/openapi.yaml`, `backend/generated/api/api.gen.go`, `frontend/src/api/schema.d.ts`, `backend/server/server.go` (in briefs 02 and 03), and `frontend/src/components/progress/ProgressView.tsx` all exist (`ls`).

**1b. Create targets: Pass (2 of 2).** `backend/export/export.go` and `backend/export/export_test.go`:
- Neither exists yet. `backend/export/` is absent.
- Both are inside the repo.
- `git check-ignore -v` prints nothing and exits 1 for both.
- The one tempting trap is `.gitignore`'s `*.test` line (Go test binaries). It does not match `_test.go`, and the scout did not trip on it.

**1c. Nothing important missing: Fail (3 gaps).**
- **The proof test sits outside its own brief's boundaries (tickets 03 and 04).**
  - Brief 04 says "Test: `frontend/e2e/navigation.spec.ts`". That file is not in its "Files to edit", and the brief's rule is "Create and edit files only within the file boundaries above". A builder who follows the rule cannot extend the test it is told proves the ticket.
  - Brief 03's proof test, `backend/export/export_test.go`, is ticket 01's create, not ticket 03's.
- **Ticket 03 has no test file at all.** Its acceptance criteria are HTTP behaviour: 200, text/csv, a dated Content-Disposition, and 404 with no plan. The repo has no `_test.go` anywhere (`find`), so nothing tests handlers today. The natural addition is a `backend/server/server_test.go` create, or an `httptest` test beside the handler. The brief lists only `server.go`.
- **Ticket 03 may not be able to return its 404.** Its facts correctly say that 404s are built from generated `api.<Op>404ApplicationProblemPlusJSONResponse` types (`server.go:173`, `:182`). Those types exist only for responses declared in `openapi.yaml`. Ticket 02's text says to model a `text/csv` response and says nothing about a 404. `openapi.yaml` and `api.gen.go` are outside ticket 03's boundaries. Unless ticket 02 happens to declare a 404, ticket 03 must widen its boundaries or hand-write a response visitor. The scout had both facts and did not connect them. This is partly a ticket-split problem and not only a scout one. Still, "Builds on 02" is exactly where it should have shown.
- For the record, nothing is missing from tickets 01 and 02 (02 correctly includes the placeholder in `server.go`). Ticket 04 needs nothing beyond `ProgressView.tsx` apart from its proof test: `ProgressPage.tsx` renders `ProgressView` with real API data.

### 2. Codebase facts: 19 true, 3 partly true, 0 false

Every citation resolves to real lines, as the app already checks. The question here is whether each statement is true at its citation.

| Brief | Fact (short) | Citation | Verdict | Evidence |
|-------|--------------|----------|---------|----------|
| 01 | Workout has `PlannedDuration`, no planned distance | `api.gen.go:226-244` | True | Lines 226–242 are `type Workout struct`. Line 238 is `PlannedDuration *int` "Duration in minutes". There is no distance field. (244 runs 2 lines into `WorkoutCompletion`: harmless.) This fact catches a real spec error: the idea's "planned distance" column has no data behind it. |
| 01 | Actual distance/duration live on `WorkoutMetrics` | `api.gen.go:272-283` | True | 274 `ActualDuration *int`, 277 `DistanceKm *float32`. The wording "WorkoutCompletion's ActualDuration (via WorkoutMetrics)" is clumsy but correct: `WorkoutCompletion.Metrics` (248) holds it. |
| 01 | `ActualDuration` set only when the column is valid | `repository.go:744-749` | True | 746–748: `if actualDuration.Valid { d := int(...); …ActualDuration = &d }`. |
| 01 | `Completed` from `completionID.Valid` | `repository.go:728-729` | True | 728: `workout.Completed = completionID.Valid`. |
| 01 | Module path and import path | `go.mod:1` | True | `module github.com/…/marathon-tracker`. |
| 01 | Go test command | `Makefile:50-51` | True | 50 `test-go:`, 51 `cd backend && go test ./...`. |
| 02 | oapi-codegen config | `oapi-codegen.yaml:1-7` | True | `chi-server`, `models`, `strict-server`, `output: generated/api/api.gen.go`. |
| 02 | ADR-001 regeneration commands, including `types.ts` | `adr/001…:66-73` | True | 69 `oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml`, 73 `npx openapi-typescript … -o src/api/types.ts`. Paired with the next fact, it exposes a real doc/code drift. |
| 02 | Actual script writes `schema.d.ts` | `frontend/package.json:11` | True | `"api:generate": "openapi-typescript ../api/openapi.yaml -o src/api/schema.d.ts"`. |
| 02 | `/api/plan/progress` is application/json with a `$ref` | `openapi.yaml:80-98` | True | 90–92. |
| 02 | StrictServerInterface has one method per operation | `api.gen.go:986-997` | True | 987 `type StrictServerInterface interface`, 993 `GetPlan`, 996 `GetProgress`. |
| 02 | `HandlerFromMux` makes any implemented method a route | `main.go:72` | True | 72 `api.HandlerFromMux(strictHandler, r)`. |
| 02 | "Server.NewServer wraps a *db.Repository and is the receiver type" | `server.go:14-24` | **Partly** | `Server` (15–17) is the receiver type and holds `repo *db.Repository`. `NewServer` (20–24) is its constructor, not a type. The sentence conflates the two. |
| 03 | `Repository.GetPlan` returns (nil, nil) on no rows, else attaches weeks/workouts | `repository.go:37-72` | True | 48–49 `if err == sql.ErrNoRows { return nil, nil }`. 61 `r.GetAllWeeks()`, which attaches workouts at 336–340. |
| 03 | GetPlan returns **500**, not 404, for no plan | `server.go:54-72` | True | 65–71: `GetPlan500ApplicationProblemPlusJSONResponse{… "no-plan" … Status: 500}`. This is a genuine catch: "reuse the resolution logic" and "return 404" disagree with today's code. |
| 03 | 404s use `api.*404ApplicationProblemPlusJSONResponse` | `server.go:168-196` | True | 173 and 182, `GetWorkout404ApplicationProblemPlusJSONResponse` with Type/Title/Status/Detail. |
| 03 | `stringPtr` helper | `server.go:454-456` | True | 454 `func stringPtr(s string) *string`. |
| 04 | ProgressView renders header, hero, statistics, streak, weekly summary, and no export UI | `ProgressView.tsx:4-24` | **Partly** | True of the file (section comments at 14, 26, 54, 81, 102; `grep -i "download\|export\|csv"` finds only line 4's `export function`). The cited 4–24 covers only the signature and the header, so the citation does not support most of the statement. |
| 04 | `ProgressProps` has no export field | `types/index.ts:236-251` | True | 236–251, 7 fields, none export-related. |
| 04 | Every frontend data call uses the typed openapi-fetch client | `useProgress.ts:23` | True | `grep` over `src/` finds only `api.GET/POST/PUT/DELETE` calls (8 of them), no `fetch(` and no `href="/api`. The citation shows one of them. |
| 04 | Routed by `HandlerFromMux`, "so the frontend can hit it as a plain relative path" | `main.go:72` | **Partly** | The routing half is true. The relative-path half depends on something else: in dev, `vite.config.ts` proxies `/api` to `:8080`, and in production the Go server serves the static bundle. The scout cites neither. It also misses a risk: `vite.config.ts` registers `VitePWA` with a generated service worker. A workbox navigation fallback could answer a plain-anchor navigation to `/api/plan/export.csv` with `index.html` in the installed PWA. I did not confirm this by running it, but it is the kind of fact this brief exists to surface. |
| 04 | e2e already visits `/progress` | `navigation.spec.ts:18-21` | True | 19 `page.goto('/progress')`, 21 asserts `nav` is visible. |

Totals: 22 facts, 19 true, 3 partly true, 0 false.

### 3. Builds on: 1 of 3 edges sound

| Edge | Entry | Names what the blocker produces? | Check runnable, and does it prove the dependency? |
|------|-------|----------------------------------|---------------------------------------------------|
| 03 ← 01 | "created by ticket 01 at `backend/export/export.go`" | **Yes.** It is ticket 01's `create`, and the server check enforces the match. It does not name the function, which is fair: nobody has named it yet. | **Yes.** `cd backend && go test ./export/...` fails today with `lstat ./export/: no such file or directory` and passes only once ticket 01 lands with its test. |
| 03 ← 02 | "generated StrictServerInterface method and placeholder handler … — `api.gen.go:986-997`" | **No.** The citation is the interface as it is today, which has no export method. What ticket 02 produces (a new interface method, and a placeholder in `server.go`) is not at those lines and does not exist yet. The citation passes the app's check while pointing at the wrong thing. | **Runnable, but proves nothing.** `cd backend && go build ./...` exits 0 today, before ticket 02. A discriminating check would be `grep -n "export.csv" backend/generated/api/api.gen.go`, or a grep for the placeholder method in `server.go`. |
| 04 ← 03 | "live GET /api/plan/export.csv endpoint … — `backend/main.go:72`" | **No.** It cites the generic router line, which exists today and which ticket 03 does not touch. What ticket 03 produces is a handler body in `server.go`. | **Weak.** `curl -i http://localhost:8080/api/plan/export.csv` needs a backend running (nothing in the brief starts one). It exits 0 whatever the status code, so it proves nothing unless someone reads the output. `curl -sf -o /dev/null` would at least fail on a 404. |

This is also exactly what broke run 1. A dependency on "code the blocker adds to a file it edits" fits neither form the schema offers. In run 1 the model left both fields null and the turn died. In run 2 it filled `citation` with a nearby existing line, which passes every check and is misleading.

### 4. Proved by: 1 of 4 sound

| Ticket | Test path | Command | Verdict |
|--------|-----------|---------|---------|
| 01 | `backend/export/export_test.go` | `make test-go` | **Pass.** Go's `_test.go`-beside-the-package layout. `make test-go` runs `cd backend && go test ./...`, which includes the new package. Today it runs and reports `[no test files]` for every package, exit 0. |
| 02 | `backend/generated/api/api.gen.go` | `cd backend && go build ./... && cd ../frontend && npm run build` | **Partial.** A generated source file is not a test path. A build is a fair proof for a codegen ticket, and it matches the ticket's "Judged by". `go build ./...` runs (exit 0). `npm run build` needs `npm install` first; the clone has no `frontend/node_modules`. |
| 03 | `backend/export/export_test.go` | `make test-go` | **Fail.** That test belongs to ticket 01 and tests the pure function. Nothing it runs touches the handler, so the command passes with the handler missing or wrong. The ticket's criteria (200/404, headers, body) have no test anywhere. `make test-go` is also the project verify command every brief already runs, so this "Proved by" adds nothing. |
| 04 | `frontend/e2e/navigation.spec.ts` | `cd frontend && npm run test:e2e` | **Partial.** The layout fits: `playwright.config.ts` has `testDir: './e2e'` and `*.spec.ts` files. The command runs the whole e2e suite, including this file. But: <ul><li>the file is outside the brief's boundaries (1c);</li><li>`webServer` starts only `npm run dev`, so a download test needs the Go backend running too;</li><li>the Makefile's own `test-e2e` comment says the suite needs the app running.</li></ul> A new `frontend/e2e/progress.spec.ts` as a create would fit better. |

### 5. HANDOFF.md: Pass

Grounding was current, and `groundedBriefs` was `[1, 2, 3, 4]` with no ungrounded briefs. HANDOFF.md says so in both places:

- line 13: "Briefs: `.scratch/export-training-log-as/briefs/`, one per ticket, grounded and ready to paste as a delegation prompt";
- line 72: "The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand."

This run did not exercise the negative case (stale grounding, or one ungrounded brief). The export tests cover it.

### 6. Cost

- One `handoff-scout` turn with two runs, each of one attempt, and **zero check refusals**. The app's claim checks never had to refuse anything. Every citation, create and edit in run 2 passed on the first try.
- Model time was 125.7 s (run 1, wasted) plus 150.6 s (run 2): 276.3 s for four tickets. The turn's wall time was 328.7 s, including my gap between runs.
- The failed run cost a full turn because a schema refine is terminal (see the turn record). With a retry it would have cost one extra attempt inside the same run.
- Grilling took four rounds (12, 5, 2 and 1 cards). With synthesis and ticketing, the session ran from 10:02 to 10:12 before grounding started.

## Scout-quality problems, with suggested fixes

Each item says whether the fix belongs in the prompt, a server check, or the schema.

1. **A schema refine the model can break ends the turn instead of retrying it.** The citation-xor-createdPath rule is lost in `z.toJSONSchema`, so the model is not constrained, and the zod failure is thrown as `malformed-output`.
   *Fix (server):* move the xor rule out of the zod refine and into `reasonsToRefuseHandoffGrounding`, so it becomes a refusal that is sent back and retried. More generally, have `askUntilAccepted` treat a `schema-invalid` result as a refusal with the schema reason (one retry) rather than a terminal failure. *Prompt:* keep the rule, since it is already there.
2. **There is no form for "a symbol the blocker adds to a file it edits".** `buildsOn` offers only a citation of existing code or a path the blocker creates. Two of three real edges were of the third kind: a method added to `api.gen.go`, and a handler body added to `server.go`. The model either leaves both null (run 1, fatal) or cites unrelated existing lines (run 2, which passes checks and misleads).
   *Fix (schema, plus a server check):* add a third form, such as `editedPath` plus a `symbol` name. The server checks that the path is one of that blocker's `edit` files, the same way `createdPath` is matched to a `create`.
3. **Builds-on checks that pass before the blocker exists.** `go build ./...` and `curl -i` both succeed today.
   *Fix (prompt):* "the check must fail before the blocker is merged and pass after it". Prefer a grep for the named symbol or path, or a test that exercises it. *Server (cheap):* for a `createdPath` edge, the check could at least be required to mention that path. A general "check must fail at the current commit" test would mean running commands, which the scout's read-only design rules out.
4. **The Proved-by test sits outside the brief's own file boundaries.** Brief 04 tells the builder to extend `navigation.spec.ts` but lists it nowhere in its boundaries. Brief 03 names ticket 01's test.
   *Fix (server check):* `provedBy.testPath` must be one of the ticket's `filesToChange`, as a create or an edit. The one exception is a spike ticket with no files. *Prompt:* "the test path is one of this ticket's files to change".
5. **A Proved-by command that does not exercise the ticket's change.** Ticket 03's `make test-go` runs only ticket 01's test. Ticket 02's test path is a generated source file.
   *Fix (prompt):* "the command must run a test that fails without this ticket's change, and the test path must be a test file. For a ticket proved only by a build, say so, and give the build command with the test path of the file that exercises it." *Server:* reject a `testPath` equal to another ticket's create. This is cheap and would have caught ticket 03.
6. **A missing test file for a ticket whose acceptance criteria are behavioural.** Ticket 03's criteria are all HTTP behaviour, and the repo has no handler test to extend. The scout proposed no `server_test.go`.
   *Fix (prompt):* "when no existing test covers the ticket's acceptance criteria, list a new test file as a create".
7. **Cross-ticket seams that the facts reveal but the brief does not flag.** The scout knew that 404s need generated `…404ApplicationProblemPlusJSONResponse` types, and that ticket 02 only declares text/csv. It never said that ticket 03 therefore needs ticket 02 to declare a 404, or needs `openapi.yaml` itself. The same pattern appears with the 500-vs-404 no-plan response and with the missing planned distance: correct facts, no consequence drawn.
   *Fix (prompt, or a new field):* when a fact contradicts the ticket or a blocker's scope, say so in `buildsOn.provides`, or in a short `risks` list the brief renders. Server-checking this is not realistic.
8. **Loose citations for broad statements.** "ProgressView … renders header, hero progress, statistics, streak, and weekly-summary sections" is cited to lines 4–24, which show only the header. The citation check passes because the lines exist.
   *Fix (prompt):* "a statement about a whole file cites the whole range it describes, or is split into facts with their own citations". A server check cannot judge coverage. This is the same class of finding as the earlier exclusivity finding: the check proves the lines exist, not that they say what the statement says.
9. **Minor: `buildsOnFiles` padding.** Brief 04 lists `backend/main.go:72` as something the frontend ticket "builds on without changing". It is backend routing that the frontend never touches.
   *Fix (prompt):* "builds-on files are code this ticket reads or calls".

## Follow-ups to file as beads

Items 1, 2, 4 and 5 are app changes with a clear server-side part, and each is worth its own bead. Items 3 and 6–9 are prompt changes that could share one bead. Of these, item 1 is the only one that made the action fail outright.
