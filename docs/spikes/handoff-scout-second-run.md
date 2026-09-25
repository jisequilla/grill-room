# Spike: a second real grounding run

Bead gr-5e7.14. A second run with the real interviewer and the real handoff scout against a fresh temp clone of the marathon tracker, after PR #61 (contract schema, refusals instead of refines, the `editedPath` + `symbol` form, the proof-test rule) and PR #63 (prompt wording). The method, setup and scoring follow `docs/spikes/handoff-scout-real-run.md` (the first run), and every verdict is set beside the first run's.

## Verdicts

| # | Check | First run | This run |
|---|-------|-----------|----------|
| 1a | Every edit target exists | **Pass**: 7 of 7 | **Fail**: 5 of 6. Ticket 3 edits `backend/export/export_test.go`, a file ticket 1 creates. This is what the app refused |
| 1b | Every create target is new, inside the repo and not ignored | **Pass**: 2 of 2 | **Pass**: 5 of 5 |
| 1c | Nothing important missing from File boundaries | **Fail**: 3 gaps | **Fail**: 2 gaps. Ticket 3 has no test file of its own, only an edit of ticket 1's. Ticket 2 breaks the backend build until ticket 4 lands, and `server.go` is outside its boundaries. The first run's handler-test gap and proof-outside-boundaries gap are gone |
| 2 | Codebase facts true at the cited line | **Pass, with caveats**: 22 facts, 19 true, 3 partly | **Pass, with caveats**: 21 facts, 18 true, 3 partly, 0 false |
| 3 | Builds on names what the blocker produces; the check fails before and passes after | **Partial**: 1 of 3 sound | **Partial**: all 4 edges use the right form, and all 4 checks fail today. None is sure to pass once the blocker lands: each greps a name the blocker's ticket never fixes. This run applies a stricter criterion than the first run's "the check is runnable": the check must fail before the blocker and pass after it, which is the rule PR #61 put in the prompt |
| 4 | Proved by: a test in the ticket's own files, and a command that runs this ticket's test | **Partial**: 1 of 4 sound | **Improved, partial**: 3 of 5 sound, 1 partial (ticket 5 needs the Go backend running), 1 invalid (ticket 3's test is its blocker's create) |
| 5 | HANDOFF.md says grounded only if every brief was | **Pass** (positive case) | **Pass** (negative case): nothing was grounded, and HANDOFF.md keeps the fill-the-slots wording |
| 6 | Cost | 1 turn, 2 runs, 2 attempts, 0 refusals, 276 s. Run 1 died on a schema refine | 1 turn, 2 runs, **6 attempts, 6 refusals, 0 malformed-output**, 1734.7 s. **Both runs spent their three attempts and ended `invalid-brief-grounding`; nothing was stored** |

What PR #61 set out to fix is fixed. The CLI accepted the contract with its `anyOf`, and no attempt broke a `buildsOn` form. Every rule violation came back as a refusal that retried, and none became `malformed-output`. The prompt changes show up in the content. Dependencies now use `editedPath` + `symbol` instead of nearby lines, and every check fails today. Tickets 4 and 5 get new test files of their own. Commands are narrowed to the ticket's package or spec file. The planned-distance contradiction is spelled out as a consequence.

The run still failed, this time because the retries never reached a shape the app accepts. The ticket split put the export function (ticket 1) and its tests (ticket 3) in separate tickets. The scout's natural shape was for ticket 3 to `edit` the `export_test.go` that ticket 1 creates. The app refuses that shape, because an `edit` must exist today, and it offers no way to say "edits a file its blocker creates". Legal shapes did exist:
- ticket 3 creates a test file of its own in the same package, such as `backend/export/export_cases_test.go`, and depends on ticket 1's `createdPath`;
- both tickets create `export_test.go`, which the app would accept because it never compares creates across tickets. That is a gap of its own.

The scout never tried either. It alternated between two refused shapes for six attempts and 29 minutes of model time, and the export went out with no grounding at all.

## Setup

- **Project:** `git clone --no-hardlinks` of the marathon tracker into `<scratch>/run2/marathon`, with a local git user set in the clone. The original repository was never written to. HEAD is `52b6bf2`, the same commit as the first run. There is no `_test.go` file and no `backend/export/`.
- **Server:** one `pnpm exec agent-native dev --port 5521 --strictPort`, started from this worktree's `grill-room/` after `pnpm install`. It ran with `AUTH_DISABLED=true`, `DATABASE_URL=pglite:<scratch>/run2/db` and `GRILL_ROOM_INTERVIEWER` unset, so the real interviewer ran. I recorded three PIDs: pnpm, the agent-native child and the vite grandchild. At the end I stopped exactly those three and confirmed port 5521 was free. Port 8082 was never touched.
- **Driver:** every step went through `POST`/`GET /_agent-native/actions/<name>`, the way `e2e/support.ts` calls them.
- **Project registration:** `register-project` with root `<scratch>/run2/marathon`, export folder `.scratch` and verify command `make test-go`. It resolved to visibility `tracked`, recipe `pull-request` and adversarial review on, as in the first run.
- **Checked first:** `server/brief-grounding.ts` handles `editedPath`, and `buildHandoffScoutPrompt` contains "narrow it to that".

## The idea

Title "Export training log as CSV", model `sonnet`, whole-round, project set. The idea text is the first run's, verbatim.

### Rounds

The interview took three rounds (8, 8 and 3 cards), against the first run's four (12, 5, 2 and 1). The cards were different. I accepted every recommendation except four cards, where I answered from the code, matching the first run's own answers:

- **Round 1.** `fetch()`-plus-blob versus a plain anchor: my own answer was no auth, a plain anchor, and a hard-coded relative `/api/plan/export.csv`. The interviewer had recommended fetch because it could not know the auth. This one card covered the first run's two own answers on auth and href.
- **Round 2, three cards.**
  - Frontend filename: my own answer was no client code, since the anchor takes the name from `Content-Disposition`. This follows from the round 1 answer.
  - The fixed unit: km, because the API already has `DistanceKm`.
  - How to declare the CSV in `openapi.yaml`: `format: binary`, with the first run's own answer on codegen, oapi-codegen through `backend/oapi-codegen.yaml` plus `npm run api:generate`.
- **Round 3.** All three accepted. The session was then `done-proposed`, and I confirmed.

No card asked about CI, so the first run's "no CI, `make test-go`" answer had nowhere to go. No card asked what happens when there is no plan at all. The spec therefore lost the first run's "404 with no plan" criterion.

After that: `synthesize-spec` (92 s), `break-into-tickets` (62 s), `generate-handoff`, `ground-briefs` twice, `preview-export`, then `export-session` with slug `export-training-log-as`.

## The tickets

The split differs from the first run: the tests are now their own ticket.

| # | Title | Blocked by | Wave |
|---|-------|------------|------|
| 01 | Build the backend/export pure CSV row-building function | none | 1 |
| 02 | Add the CSV export endpoint to openapi.yaml and regenerate generated code | none | 1 |
| 03 | Write Go unit tests for the export pure function | 01 | 2 |
| 04 | Implement the export handler in backend/server/server.go | 01, 02 | 2 |
| 05 | Add the Download CSV button to the Progress view | 04 | 3 |

The acceptance lines that the checks below measure against:

- 01: the function is pure, and given mixed sample data the rows match the column order, header text and cell rules; an empty plan returns only the header row.
- 02: `openapi.yaml` includes the new path; "the regenerated backend code compiles and exposes a strict-server interface method for the new operation"; `schema.d.ts` includes it.
- 03: "`go test` passes", each of five scenarios has a dedicated case, and a deliberate regression fails a test.
- 04: 200, `text/csv`, a dated `Content-Disposition`, a body that starts with the UTF-8 BOM, and a header-only 200 for an empty plan.
- 05: clicking the button downloads a file named by the server, in dev and in a production-style build.

## The turn record

`get-latest-turn` with `turnKind: handoff-scout` returned turn `e6a492c6`, model `sonnet`, outcome `invalid-brief-grounding`, `totalElapsedMs` 1766794. That total includes about 32 s between the two runs.

| Run | Manual retry | Attempt | Kind | Duration | Reason |
|-----|--------------|---------|------|----------|--------|
| 1 | no | 1 | `tree-rule-refusal` | 470.0 s | "Ticket 3 marks backend/export/export_test.go as edit, but no such file exists in the project; mark it create, or name a file that exists." |
| 1 | no | 2 | `tree-rule-refusal` | 129.9 s | "Ticket 1 is proved by backend/export/export_test.go, which is not one of its filesToChange; …" and the same for tickets 4 (`backend/server/server_test.go`) and 5 (`frontend/e2e/progress.spec.ts`) |
| 1 | no | 3 | `tree-rule-refusal` | 341.3 s | the same reason as attempt 1 |
| 2 | yes | 1 | `tree-rule-refusal` | 470.3 s | the same reason as attempt 1 |
| 2 | yes | 2 | `tree-rule-refusal` | 163.7 s | "Ticket 1 is proved by backend/export/export_test.go, which is not one of its filesToChange; …", and the same for ticket 4 |
| 2 | yes | 3 | `tree-rule-refusal` | 159.6 s | "Citation \"backend/export/export.go:1-1\" cites backend/export/export.go, which does not exist in the project.", plus the proof-test reason for tickets 1, 2 and 4 |

Each run ended the action with HTTP 400 and `invalid-brief-grounding`: "The handoff scout returned a grounding the app could not accept 3 times. Last reason: …" `get-brief-grounding` returned `grounding: null`.

The loop, attempt by attempt:
- **Attempts 1 and 3 of run 1, and attempt 1 of run 2.** Ticket 1 creates `export_test.go` and is proved by it. Ticket 3 `edit`s it. This was the only reason each of those attempts was refused. The other rules all passed on those three attempts.
- **The attempts in between.** Each followed the refusal's advice, "mark it create", but moved the file instead of adding one. Ticket 3 created `export_test.go`, and ticket 1 dropped it from its own files while still naming it as its proof. Nothing forced that drop: ticket 1 could have kept its create, or ticket 3 could have created a second `_test.go` in the package. At the same time the scout dropped the new test files of tickets 4 and 5 from their boundaries.
- **The last attempt.** It borrowed ticket 3's test for tickets 1, 2 and 4, and invented a citation of the not-yet-existing `export.go:1-1`.

Brief 03's `provides` in run 1 attempt 3 says what the scout wanted to express: "the export_test.go file it creates for this ticket to extend". The app has no form for that shape. Two shapes that pass every rule were available, and no attempt tried them:
- **Ticket 3 creates its own test file.** Ticket 1 creates `export.go` and `export_test.go` and is proved by `export_test.go`. Ticket 3 creates `backend/export/export_cases_test.go`, is proved by it with `cd backend && go test ./export/...`, and depends on ticket 1 through `createdPath` `backend/export/export.go`. Go allows any number of `_test.go` files per package, and a separate file meets all of ticket 3's criteria.
- **Both tickets create `export_test.go`.** `reasonsToRefuseHandoffGrounding` checks a `create` only against the filesystem: it must be inside the root, must not exist and must not be ignored. It never compares creates across tickets, so this passes too, although the second builder would then collide with the first.

## gr-5e7.13 item 4: the contract and the refusals

- **The CLI accepted `--json-schema` with the whole-object `anyOf`.** `jsonSchemaFor("handoff-scout")` gives each `buildsOn` item as an `anyOf` of three strict objects (I printed it with `tsx`). The first is `citation` with the citation pattern and the other three fields `null`. The second is `createdPath`. The third is `editedPath` plus `symbol`. No attempt failed at the CLI, and every attempt returned structured output.
- **The contract held.** Across all 6 raw outputs I checked every `buildsOn` entry, 4 per attempt and 24 in all. None violated its form: exactly one location field is set, and `symbol` is set exactly with `editedPath`.
- **Every violation arrived as a refusal that retried, never as `malformed-output`.** All six attempts are `tree-rule-refusal`, and the reasons are the app's own, quoted in the table above. The first run's terminal failure mode, a zod refine thrown as `malformed-output`, did not occur.
- **What this does not show.** Retrying is not converging. The retry budget is three attempts per run, and a scout that keeps alternating between refused shapes spends all three and ends the turn anyway, although a legal shape exists. Here that happened twice.

## Export

`preview-export` returned `groundingState: "absent"`, `groundedBriefs: []`, and `ungroundedBriefs` with reason `no-grounding` for tickets 1 through 5. It also returned `exportBlocked: false` and 15 planned writes, none edited. `export-session` wrote those 15 files with the same `groundedBriefs`/`ungroundedBriefs`, and nothing kept or removed. Every exported brief carries the two empty slots.

## The grounding that was refused, as it would have rendered

Nothing reached the bundle, so there are no grounded sections to quote. Below is run 1 attempt 3, rendered in the format `renderBrief` uses. It is the most complete attempt: its only refusal was ticket 3's edit. Every check that follows scores this attempt, and notes where the other attempts differ.

### Brief 01

````markdown
## File boundaries

Files to create:

- `backend/export/export.go`
- `backend/export/export_test.go`

Existing files it builds on:

- `backend/generated/api/api.gen.go:150-161`
- `backend/generated/api/api.gen.go:196-207`
- `backend/generated/api/api.gen.go:226-242`
- `backend/generated/api/api.gen.go:244-250`
- `backend/generated/api/api.gen.go:271-284`
- `api/openapi.yaml:521-534`

## Codebase facts

- api.Workout declares Completed, Date, DayNumber, PlannedDuration, Title, Type and WeekNumber but no distance field, so this ticket's pure function has no planned-distance value on the Workout type itself and needs another source for the Planned Distance column. (`backend/generated/api/api.gen.go:226-242`)
- WorkoutMetrics carries ActualDuration and DistanceKm as pointer fields, and it is only reachable through the optional Completion.Metrics field on WorkoutCompletion, so actual distance/duration are only available when a workout has completion data. (`backend/generated/api/api.gen.go:271-284`)
- The workouts table in the SQLite schema stores id, week fields, date, type, title, description and planned_duration but no distance column, confirming the persisted plan carries no planned-distance value for this ticket to read. (`backend/db/schema.hcl:83-140`)
- The WorkoutType enum lists exactly 11 values (rest, rest_active, easy_run, continuous_run, intervals, cross_training, long_run, hill_run, strength, race, activation) that this ticket's static label lookup table must cover. (`api/openapi.yaml:521-534`)
- The in-memory plan generator builds each api.Workout from WeekNumber, DayNumber, Date, Type, Title, PlannedDuration and Completed, setting no distance value, matching the DB schema's lack of a planned-distance column. (`backend/data/plan_generator.go:83-95`)

## Proved by

Test: `backend/export/export_test.go`

```bash
cd backend && go test ./export/...
```
````

### Brief 02

````markdown
## File boundaries

Files to create:

- `backend/generated/api/api.gen_test.go`

Files to edit:

- `api/openapi.yaml`
- `backend/generated/api/api.gen.go`
- `frontend/src/api/schema.d.ts`

Existing files it builds on:

- `api/openapi.yaml:40-58`
- `backend/oapi-codegen.yaml:1-7`
- `backend/generated/api/api.gen.go:986-1015`
- `docs/adr/001-api-first-openapi.md:66-69`
- `frontend/package.json:11`

## Codebase facts

- The existing GET /api/plan operation shows the pattern (operationId, tags, responses with a $ref schema) that a new /api/plan/export.csv operation should follow. (`api/openapi.yaml:40-58`)
- oapi-codegen.yaml configures chi-server, models and strict-server generation into generated/api/api.gen.go, confirming that file is the exact regeneration target for this ticket. (`backend/oapi-codegen.yaml:1-7`)
- api.gen.go is headed 'Code generated ... DO NOT EDIT', so this ticket's change to that file must come from rerunning oapi-codegen rather than hand-editing it. (`backend/generated/api/api.gen.go:1-4`)
- StrictServerInterface currently declares 9 methods (GetHealth, GetPlan, GetProgress, GetTodayWorkout, GetWeek, GetWorkout, UncompleteWorkout, CompleteWorkout, UpdateWorkoutMetrics) and none for a CSV export, so this ticket needs to add a tenth method for GET /api/plan/export.csv. (`backend/generated/api/api.gen.go:986-1015`)
- The ADR documents the exact regeneration command, `cd backend && oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml`, run whenever the spec changes. (`docs/adr/001-api-first-openapi.md:66-69`)
- frontend/package.json defines api:generate as `openapi-typescript ../api/openapi.yaml -o src/api/schema.d.ts`, the exact command this ticket must rerun to update the frontend types. (`frontend/package.json:11`)

## Proved by

Test: `backend/generated/api/api.gen_test.go`

```bash
cd backend && oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml && go test ./generated/api/...
```
````

### Brief 03

````markdown
## File boundaries

Files to edit:

- `backend/export/export_test.go`

Existing files it builds on:

- `backend/generated/api/api.gen.go:30-40`
- `backend/generated/api/api.gen.go:226-242`

## Codebase facts

- The WorkoutType constants block defines all 11 typed values (Activation, ContinuousRun, CrossTraining, EasyRun, HillRun, Intervals, LongRun, Race, Rest, RestActive, Strength) this ticket's test cases can use to cover distance-bearing versus non-distance types. (`backend/generated/api/api.gen.go:30-40`)
- api.Workout's fields (Completed, Date, PlannedDuration, Title, Type, WeekNumber, Completion) are what this ticket's table-driven test fixtures must populate to exercise blank-handling and ordering rules. (`backend/generated/api/api.gen.go:226-242`)

## Builds on

- Ticket 01: the pure CSV row-building function in backend/export/export.go to call from test cases, and the export_test.go file it creates for this ticket to extend — created by ticket 01 at `backend/export/export.go` — check: `grep -q 'func BuildRows' backend/export/export.go`

## Proved by

Test: `backend/export/export_test.go`

```bash
cd backend && go test ./export/...
```
````

### Brief 04

````markdown
## File boundaries

Files to create:

- `backend/server/server_test.go`

Files to edit:

- `backend/server/server.go`

Existing files it builds on:

- `backend/server/server.go:53-78`
- `backend/db/repository.go:37`
- `backend/main.go:71-81`
- `backend/main.go:119-138`

## Codebase facts

- The existing GetPlan handler fetches the plan via s.repo.GetPlan() and returns a typed JSON response, the pattern this ticket's export handler follows but returning a CSV byte response instead. (`backend/server/server.go:53-78`)
- Repository.GetPlan has signature func (r *Repository) GetPlan() (*api.TrainingPlan, error), which this ticket's handler calls to fetch the current plan. (`backend/db/repository.go:37`)
- main.go wires api.NewStrictHandler(srv, nil) into api.HandlerFromMux(strictHandler, r), so any new StrictServerInterface method this ticket implements on Server is automatically routed without further changes to main.go. (`backend/main.go:71-81`)
- spaHandler explicitly 404s any request path starting with /api/ before falling back to serving the SPA's index.html, confirming a request to /api/plan/export.csv reaches the API handler rather than the static frontend bundle in the single-binary production mode. (`backend/main.go:119-138`)

## Builds on

- Ticket 01: the pure export function in backend/export/export.go that turns plan workouts into structured rows for the handler to serialize — created by ticket 01 at `backend/export/export.go` — check: `grep -q 'func BuildRows' backend/export/export.go`
- Ticket 02: the generated StrictServerInterface method and request/response types for GET /api/plan/export.csv that this ticket implements — ticket 02 adds `GetPlanExportCsv` to `backend/generated/api/api.gen.go` — check: `grep -q 'GetPlanExportCsv' backend/generated/api/api.gen.go`

## Proved by

Test: `backend/server/server_test.go`

```bash
cd backend && go test ./server/...
```
````

### Brief 05

````markdown
## File boundaries

Files to create:

- `frontend/e2e/progress.spec.ts`

Files to edit:

- `frontend/src/components/progress/ProgressView.tsx`

Existing files it builds on:

- `frontend/src/components/progress/ProgressView.tsx:4-24`
- `frontend/vite.config.ts:51-58`
- `frontend/playwright.config.ts:16-17`
- `frontend/playwright.config.ts:32-37`
- `frontend/e2e/today.spec.ts:1-11`

## Codebase facts

- ProgressView's header section currently renders only a title and race-date badge with no download or export control, so this ticket adds the first such control to that JSX. (`frontend/src/components/progress/ProgressView.tsx:4-24`)
- Vite's dev server proxies any /api request to http://localhost:8080, so a plain relative href of /api/plan/export.csv resolves to the Go backend in local dev without client-side URL logic. (`frontend/vite.config.ts:51-58`)
- Playwright's baseURL is http://localhost:5173 and its webServer runs `npm run dev`, so e2e tests exercise the anchor against the Vite dev server described above. (`frontend/playwright.config.ts:16-17`)
- The existing today.spec.ts establishes the e2e convention of a test.describe block with a beforeEach that navigates and waits for networkidle before assertions, the pattern this ticket's new spec should follow. (`frontend/e2e/today.spec.ts:1-11`)

## Builds on

- Ticket 04: the live GET /api/plan/export.csv handler in backend/server/server.go for the anchor's href to hit and for the e2e test to exercise — ticket 04 adds `GetPlanExportCsv` to `backend/server/server.go` — check: `grep -q 'GetPlanExportCsv' backend/server/server.go`

## Proved by

Test: `frontend/e2e/progress.spec.ts`

```bash
cd frontend && npx playwright test e2e/progress.spec.ts
```
````

## The checks

Every check was done by reading the clone at `52b6bf2`, with commands run read-only in the clone. Go wrote only to its own build cache. `git status` in the clone shows only the exported `.scratch/`. One experiment needed a spec change. For it I copied `backend/` and `api/openapi.yaml` into a separate scratch folder, never the clone.

### 1. File boundaries

**1a. Edit targets exist: Fail (5 of 6).** `api/openapi.yaml`, `backend/generated/api/api.gen.go`, `frontend/src/api/schema.d.ts`, `backend/server/server.go` and `frontend/src/components/progress/ProgressView.tsx` all exist (`ls`). `backend/export/export_test.go` (ticket 3) does not. It is ticket 1's create, and the app refused it.

**1b. Create targets: Pass (5 of 5).** The creates are `backend/export/export.go`, `backend/export/export_test.go`, `backend/generated/api/api.gen_test.go`, `backend/server/server_test.go` and `frontend/e2e/progress.spec.ts`.
- None exists yet (`ls`), and all five are inside the repo.
- `git check-ignore -v` prints nothing and exits 1 for all five.

**1c. Nothing important missing: Fail (2 gaps).**
- **Ticket 3 has no test file of its own.** Ticket 3 is "write the repo's first `_test.go`" for ticket 1's function, and ticket 1 must also prove itself with a test in its own files. The scout gave ticket 3 an `edit` of ticket 1's `export_test.go`, which does not exist yet. The boundary a builder could actually use is a second test file in the same package, created by ticket 3, such as `backend/export/export_cases_test.go`. The rules accept that shape, but the scout never proposed it (new problem 1). The app also has no way to express the shape the scout wanted, an edit of a file the blocker creates (new problem 2).
- **Ticket 2 breaks the backend build, and the fix is outside its boundaries.**
  - I regenerated with ticket 2's change in the scratch copy. `StrictServerInterface` gains a method, and `go build ./...` then fails: `./main.go:50:40: cannot use srv (variable of type *server.Server) as api.StrictServerInterface value … (missing method GetApiPlanExportCsv)`.
  - `make test-go` (`go test ./...`) fails the same way on the root package, so the project's verify command stays red from ticket 2 until ticket 4 lands.
  - The first run's split put a placeholder handler in ticket 2's `server.go` boundary for exactly this reason. This split does not, and the scout did not add one, although its own facts hold both halves. Ticket 2's facts say the interface gains a method. Ticket 4's facts say `main.go` wires `Server` in through `NewStrictHandler`.
- **What is fixed from the first run.**
  - Ticket 4 now creates `backend/server/server_test.go`, the handler test the first run lacked.
  - Ticket 5 creates `frontend/e2e/progress.spec.ts` instead of naming a spec outside its boundaries.
  - Every proving test is in its ticket's own files, apart from the refused ticket 3.

### 2. Codebase facts: 18 true, 3 partly true, 0 false

| Brief | Fact (short) | Citation | Verdict | Evidence |
|-------|--------------|----------|---------|----------|
| 01 | Workout has no distance field; Planned Distance needs another source | `api.gen.go:226-242` | True | 226–242 is `type Workout struct`. 238 `PlannedDuration *int`, no distance field. The consequence is stated as a positive claim. |
| 01 | `WorkoutMetrics` has the pointer fields, reachable only via `Completion.Metrics` | `api.gen.go:271-284` | True | 274 `ActualDuration *int`, 277 `DistanceKm *float32`. The reachability half is at 230 and 248, just outside the range. The first run's equivalent fact was scored the same way. |
| 01 | `workouts` table has no distance column | `schema.hcl:83-140` | True | Columns id, week_id, week_number, day_number, date, type, title, description, planned_duration, details. No distance. |
| 01 | `WorkoutType` has exactly 11 values | `openapi.yaml:521-534` | True | 523–534, 11 enum values (521 is the tail of the previous schema). |
| 01 | The plan generator sets no distance | `plan_generator.go:83-95` | True | The `api.Workout{…}` literal sets no distance field. |
| 02 | `GET /api/plan` shows the operation pattern | `openapi.yaml:40-58` | True | 42–58: `operationId: getPlan`, tags, a 200 with a `$ref`, and a 500. |
| 02 | oapi-codegen config | `oapi-codegen.yaml:1-7` | True | chi-server, models, strict-server, `output: generated/api/api.gen.go`. |
| 02 | `api.gen.go` is `DO NOT EDIT` | `api.gen.go:1-4` | True | Line 3. |
| 02 | `StrictServerInterface` declares 9 methods | `api.gen.go:986-1015` | True | 987–1015, nine methods. (Run 1 attempt 1 said "exactly 10", which is false. This attempt corrected it.) |
| 02 | ADR regeneration command, "run whenever the spec changes" | `adr/001…:66-69` | **Partly** | 67–69 give `cd backend` and the `oapi-codegen` command. "Whenever the spec changes" is line 62, outside the range. |
| 02 | `api:generate` writes `schema.d.ts` | `package.json:11` | True | Line 11. |
| 03 | The 11 `WorkoutType` constants | `api.gen.go:30-40` | True | 30–40, eleven constants. |
| 03 | Workout's fields for fixtures | `api.gen.go:226-242` | True | As above. |
| 04 | `GetPlan` fetches via `s.repo.GetPlan()` and returns typed JSON | `server.go:53-78` | True | 55 `s.repo.GetPlan()`, 77 `GetPlan200JSONResponse`. It leaves out that a nil plan returns a 500 (65–71). That matters less than in the first run, because this spec never decided the no-plan case. |
| 04 | `Repository.GetPlan` signature | `repository.go:37` | True | Line 37. |
| 04 | `NewStrictHandler(srv, nil)` fed into `HandlerFromMux` | `main.go:71-81` | **Partly** | `HandlerFromMux` is at 72. `NewStrictHandler` is at line 50, outside the range. |
| 04 | `spaHandler` 404s `/api/` paths before the SPA fallback | `main.go:119-138` | True | 123–124 `strings.HasPrefix(r.URL.Path, "/api/")` then `http.NotFound`. This half-answers the first run's service-worker concern for the production binary. |
| 05 | ProgressView's header has only a title and a badge, no export control | `ProgressView.tsx:4-24` | True | 14–24 is the header: the title, the race name and the "Meta" badge. The statement is now scoped to what the range shows. |
| 05 | Vite proxies `/api` to `:8080` | `vite.config.ts:51-58` | True | 51–57. |
| 05 | Playwright's `baseURL` is 5173 and its `webServer` runs `npm run dev` | `playwright.config.ts:16-17` | **Partly** | `baseURL` is line 17. `webServer` is 32–37, which is in `buildsOnFiles` but not in this fact's citation. |
| 05 | `today.spec.ts` convention | `today.spec.ts:1-11` | True | `test.describe`, and a `beforeEach` with `goto` and `networkidle`. |

Totals: 21 facts, 18 true, 3 partly true, 0 false. All three partly-true facts have the same flaw: part of the statement is read from a line outside its own citation.

The best fact of the run is the planned-distance one. Three facts from three places (the generated type, the DB schema and the generator) show that no planned distance exists anywhere. The spec says the opposite ("kilometers — the unit the underlying workout data already uses"). The brief says this ticket needs another source.

### 3. Builds on: 4 of 4 fail before the blocker; none is sure to pass after it

| Edge | Form | Names what the blocker produces? | Fails today? | Passes once the blocker lands? |
|------|------|-----------------------------------|--------------|--------------------------------|
| 03 ← 01 | `createdPath` `backend/export/export.go` | **Yes.** It is ticket 1's create | **Yes**: `grep -q 'func BuildRows'` exits 2 (no file) | **Only if** ticket 1 names its function `BuildRows`. Ticket 1's text never names it, and `provides` does not say the name is a requirement |
| 04 ← 01 | `createdPath` `backend/export/export.go` | **Yes** | **Yes**, exits 2 | Same dependency on `BuildRows` |
| 04 ← 02 | `editedPath` `api.gen.go`, `symbol` `GetPlanExportCsv` | **Yes.** It is ticket 2's edit, and it names the method, not nearby lines | **Yes**: exits 1 | **Only if** ticket 2 sets `operationId: getPlanExportCsv`. Ticket 2's text sets no operationId. In the scratch copy, without one, oapi-codegen generates `GetApiPlanExportCsv`, which this grep never matches. With `operationId: getPlanExportCsv` it matched 19 times |
| 05 ← 04 | `editedPath` `server.go`, `symbol` `GetPlanExportCsv` | **Yes.** It is ticket 4's edit | **Yes**: exits 1 | The same operationId dependency as above |

Compared with the first run:
- The form problem is gone. Two edges use the new `editedPath` form, and none cites unrelated existing lines.
- The fail-before problem is gone too: every check is a grep that fails today.
- The remaining weakness is the other half of the rule. Each check greps a name the scout guessed, and a guessed name is not a promise. Run 2 attempt 1 did better on two of its edges:
  - it grepped `'export.csv'` in `api.gen.go`, which the generated path comments contain after regeneration (4 hits in the scratch copy);
  - it used `go build ./export/...` for ticket 1.

### 4. Proved by: 3 of 5 sound

| Ticket | Test path | Command | Verdict |
|--------|-----------|---------|---------|
| 01 | `backend/export/export_test.go` (create) | `cd backend && go test ./export/...` | **Pass.** The test is in its own files, the command is narrowed to the package, and today it fails with `setup failed` (no package). The catch: ticket 3 exists to write this same file (see 1c) |
| 02 | `backend/generated/api/api.gen_test.go` (create) | `cd backend && oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml && go test ./generated/api/...` | **Pass, with a caveat.** A real test file, and the build-then-test chain the new prompt asks for. `oapi-codegen` is on this machine (`~/go/bin`). But the chain builds only the generated package, so it passes while `go build ./...` is broken (1c). Chaining `go build ./...` would have exposed the missing stub |
| 03 | `backend/export/export_test.go` (edit) | `cd backend && go test ./export/...` | **Fail.** The right package, but the file is its blocker's create, which is why the app refused the attempt. A test file created by ticket 3 in the same package would have passed |
| 04 | `backend/server/server_test.go` (create) | `cd backend && go test ./server/...` | **Pass.** The first run's ticket 3 proved itself with another ticket's test. This is a handler test in its own files, narrowed to the package. Today the command reports `[no test files]` |
| 05 | `frontend/e2e/progress.spec.ts` (create) | `cd frontend && npx playwright test e2e/progress.spec.ts` | **Partial.** The file is in its own files and the command is narrowed to it. As in the first run, `webServer` starts only `npm run dev`, so a download test also needs the Go backend on `:8080`, and nothing in the brief starts it |

The first run scored 1 of 4 sound here. Under repeated refusals, though, the proofs got worse:
- In run 2 attempts 2 and 3, ticket 4 was proved by `go build ./... && go test ./export/...`, which runs ticket 1's test, not ticket 4's. That is the first run's item 5 again.
- Ticket 2's proof became `go generate ./...`, but the backend has no `//go:generate` directive, so that step does nothing.
- The only thing that stopped these attempts was the rule that the proving test must be in the ticket's own files.

### 5. HANDOFF.md: Pass (the negative case)

`groundingState` was `absent` and `ungroundedBriefs` listed all five tickets as `no-grounding`. HANDOFF.md keeps the ungrounded wording in both places:

- line 13: "Briefs: `.scratch/export-training-log-as/briefs/`, one per ticket, each ready to paste as a delegation prompt once its two slots are filled";
- line 76: "Fill the brief's **File boundaries** slot, … Fill the **Codebase facts** slot."

Each brief has the plain slot placeholders. This is the case the first run did not exercise.

### 6. Cost

- **Attempts and refusals.** One `handoff-scout` turn with two runs (the second a manual retry), six attempts and **six check refusals**. The reasons are quoted in the turn record. There was no `malformed-output` and no CLI failure.
- **Model time.** 470.0 + 129.9 + 341.3 + 470.3 + 163.7 + 159.6 = **1734.7 s**, 6.3 times the first run's 276.3 s, for five tickets instead of four. The turn's wall time was 1766.8 s.
- **First attempts are much slower.** Each run's first attempt took about 470 s, against 126 s and 151 s for the first run's attempts. Retries took 130 s to 341 s each. The retry prompt restates the rules, and the scout re-reads the code instead of fixing only the refused entry.
- **Nothing was stored.** All of that time produced no grounding.
- **Grilling and synthesis.** Grilling took three rounds, with 104 s, 162 s and 124 s of interviewer time to open rounds 1–3 and 48 s for the done proposal. Synthesis took 92 s and ticketing 62 s.

## The first run's items, one by one

1. **A schema refine ends the turn instead of retrying. Fixed.**
   - All six contract-level problems came back as `tree-rule-refusal` and were retried. None became `malformed-output`.
   - The contract (`handoffScoutContractSchema`) carries the three forms as an `anyOf`, the CLI accepted it, and no output broke it.
   - A new problem sits beside it: retries that do not converge still end the turn once the three attempts are spent, even when a legal shape exists (new problem 1).
2. **No form for a symbol the blocker adds to a file it edits. Fixed.**
   - Both edges of that kind use `editedPath` + `symbol` on the blocker's `edit` file: 04 ← 02 on `api.gen.go`, and 05 ← 04 on `server.go`.
   - No entry cites nearby existing lines.
   - One weakness: in run 2, `symbol` was sometimes prose, not a name, for example "a StrictServerInterface method (and response object/type) for the export.csv operation" (new problem 6).
3. **Builds-on checks that pass before the blocker exists. Fixed for "fails before".**
   - All four checks fail today.
   - "Passes after" is new problem 4: each grep names something the blocker's ticket does not fix.
4. **The proving test sits outside the brief's boundaries. Fixed.**
   - The server check refused it three times: run 1 attempt 2, and run 2 attempts 2 and 3.
   - Every attempt it let through lists the test among its own files.
5. **A proof command that does not exercise the ticket. Improved, and it regresses under pressure.**
   - In the scored attempt every command is narrowed to its own package or spec file. Ticket 2's test path is a test file, not generated source.
   - Run 2 attempt 1 went further, with `-run` names on every Go command.
   - Run 2 attempts 2 and 3 fell back to proving ticket 4 with ticket 1's test (section 4).
6. **No new test file for behavioural criteria. Fixed.** It created `server_test.go` for the handler, `progress.spec.ts` for the button, and `api.gen_test.go` for codegen.
7. **Seams the facts reveal but the brief does not flag. Improved.**
   - The planned-distance contradiction is now a positive claim, with its consequence named, across three citations.
   - One seam was missed, and its cost is concrete: ticket 2 regenerates an interface that `Server` then fails to satisfy, so the build stays broken until ticket 4. The scout had both halves as facts, in tickets 2 and 4, and drew no consequence (new problem 5).
   - Nobody flagged that the symbol name depends on an operationId ticket 2 does not set.
8. **Loose citations for broad statements. Improved in kind, unchanged in count.**
   - The ProgressView fact the first run faulted is now scoped to the header, which its range shows.
   - Three facts are still partly true, each because one clause is read from a line outside the citation: ADR line 62, `main.go:50`, and `playwright.config.ts:32-37`.
9. **Padding in `buildsOnFiles`. Improved.**
   - The frontend ticket no longer lists backend routing.
   - What remains is borderline: `backend/main.go:71-81` and `:119-138` in the handler ticket, which does not read `main.go` but does rely on its routing. Ticket 1 also cites `api/openapi.yaml:521-534`, when the function reads the generated constants.

## New problems, with suggested fixes

1. **Retries do not converge.** This ended both runs.
   - Legal shapes existed (see the turn record). Ticket 3 could create its own `_test.go` in the package and depend on ticket 1's `createdPath`, or both tickets could create `export_test.go`.
   - The scout alternated between two refused shapes instead:
     - ticket 3 edits a file that does not exist yet;
     - ticket 3 creates it and ticket 1 drops it, while ticket 1 still names it as its proof.
   - It never tried a test file of ticket 3's own.
   - Every retry got the whole prompt again with the reasons attached. The scout re-explored the code (130–341 s per retry) and changed entries that had already passed. By the last attempt it had invented a citation (`backend/export/export.go:1-1`) and moved proofs onto other tickets' tests.

   *Fix (prompt):* the retry text says to change only the entries the reasons name and to keep every other entry as it was. The main prompt says that a ticket which only adds tests creates its own test file beside its blocker's, for example a second `_test.go` in the same Go package, instead of editing the blocker's file. *Fix (retry mechanics):* when two refusals in a row name the same entry with reasons that exclude each other, the next retry names both reasons together and points at the shape that satisfies both. If that fails too, stop early and report both reasons to the operator instead of spending the last attempt. *Upstream (ticketing prompt):* avoid splitting a pure function from its only unit tests into separate tickets.
2. **The app cannot express "edits a file its blocker creates".** This was the scout's first choice every time, and it is how a builder would naturally extend a blocker's test file. An `edit` must exist today, so the app refuses it, and its refusal ("mark it create, or name a file that exists") offers no dependency-aware option. A separate create of the ticket's own was always available, so this form is a convenience, not a requirement.
   *Fix (server check, optional):* accept an `edit` of a path that one of the ticket's blockers (directly or transitively) lists as a `create`, matched the same way `createdPath` is. Word the refusal to offer that, or to offer a new file of the ticket's own. *Fix (prompt):* describe whichever shape the app accepts.
3. **Two tickets may both create the same path.** `reasonsToRefuseHandoffGrounding` checks a `create` only against the filesystem: inside the root, not existing, not ignored. It never compares creates across tickets. A grounding where tickets 1 and 3 both create `backend/export/export_test.go` would have been accepted, and the second builder would find the file already there and collide with the first.
   *Fix (server check):* refuse a path that more than one ticket marks as `create`. The reason tells the later ticket to edit it (once problem 2's form exists) or to create a file of its own.
4. **Dependency checks grep names the blocker's ticket does not fix.** `func BuildRows` and `GetPlanExportCsv` are guesses. Without an `operationId`, oapi-codegen generates `GetApiPlanExportCsv`, and the check would never pass.
   *Fix (prompt):* "grep for something the blocker's ticket text fixes: a path, a route string, a name it states. When the check needs a name the ticket does not state, say so in `provides`, since the builder of the blocker must then use that name." Run 2 attempt 1's `grep 'export.csv'` is the model to follow.
5. **A codegen ticket whose proof skips the module build.** Ticket 2's command builds only `./generated/api/...`, so the check passes while `go build ./...` and `make test-go` fail on `main.go`. The fix belongs in `server.go`, which is outside ticket 2's boundaries.
   *Fix (prompt):* "a ticket proved by a build builds the whole module or project, not only the package it regenerates. When that build fails without a file outside the ticket's boundaries, add that file, and say why in a fact." This would have pulled a placeholder into ticket 2's boundaries, as the first run's split did.
6. **`symbol` accepts prose.** Run 2 attempts gave `symbol` values like "handler method for GET /api/plan/export.csv", which the brief renders in backticks as though it were a name.
   *Fix (schema):* give `symbol` a pattern in the contract: an identifier, or a dotted or qualified name with no spaces. A refine is the wrong tool, since the contract would drop it. Alternatively, have the prompt move descriptive text to `provides`.

## Follow-ups to file as beads

Problem 1 ended both runs, and its fix is mostly prompt: the retry wording and the own-test-file hint. Together with the retry-mechanics change, it is the first bead. Problem 3 is a small server check that closes a real collision, and it is the second. Problems 4 and 5 are prompt changes that can share a bead with problem 1's wording, or follow it. Problem 2 is optional: it would let the scout's natural shape pass, but no split needs it. Problem 6 is a small schema change.
