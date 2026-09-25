# Spike: a third real grounding run

Bead gr-5e7.16. A third run with the real interviewer and the real handoff scout against a fresh temp clone of the marathon tracker, after PR #66. That PR changed four things. A retry now carries the scout's previous answer and says to keep what passed. A ticket may `edit` a file one of its blockers creates, directly or through a chain of blockers. Two tickets creating one path is refused. And the prompt says a later ticket may create its own test file beside its blocker's. The method, setup and scoring follow `docs/spikes/handoff-scout-real-run.md` (the first run) and `docs/spikes/handoff-scout-second-run.md` (the second run), and every verdict is set beside theirs.

## Verdicts

| # | Check | First run | Second run | This run |
|---|-------|-----------|------------|----------|
| 1a | Every edit target exists, or a blocker creates it | **Pass**: 7 of 7 | **Fail**: 5 of 6. Ticket 3 edited ticket 1's create, which the app refused | **Pass**: 6 of 6. Five exist, and ticket 4's `export_test.go` is ticket 3's create, the form PR #66 added |
| 1b | Every create target is new, inside the repo and not ignored | **Pass**: 2 of 2 | **Pass**: 5 of 5 | **Pass**: 4 of 4 |
| 1c | Nothing important missing from File boundaries | **Fail**: 3 gaps | **Fail**: 2 gaps | **Fail**: 2 gaps. Ticket 2 still breaks the backend build, and the fix is still outside its boundaries. Ticket 5 creates a handler test that the spec rules out of scope. The second run's test-ticket gap is gone |
| 2 | Codebase facts true at the cited line | **Pass, with caveats**: 22 facts, 19 true, 3 partly | **Pass, with caveats**: 21 facts, 18 true, 3 partly | **Pass, with caveats**: 21 facts, 16 true, 5 partly, 0 false |
| 3 | Builds on names what the blocker produces; the check fails before and passes after | **Partial**: 1 of 3 sound | **Partial**: 4 of 4 fail today, none sure to pass after | **Partial**: 5 of 5 fail today. 2 are sure to pass after. 2 pass only for some operationIds. 1 can never pass, because its grep path is wrong after its own `cd` |
| 4 | Proved by: a test in the ticket's own files, and a command that runs this ticket's test | **Partial**: 1 of 4 sound | **Partial**: 3 of 5 sound | **Partial**: 2 of 6 sound, 3 partial, 1 fail. Tickets 1 and 2 are "proved" by a spec file and a generated file again |
| 5 | HANDOFF.md says grounded only if every brief was | **Pass** (positive case) | **Pass** (negative case) | **Pass** (positive case, 6 of 6 grounded) |
| 6 | Cost | 1 turn, 2 runs, 2 attempts, 0 refusals, 276 s. Run 1 died on a schema refine | 1 turn, 2 runs, 6 attempts, 6 refusals, 1734.7 s. Nothing stored | **1 turn, 1 run, 2 attempts, 1 refusal, 133.2 s. Stored on the first run; no manual retry was needed** |

Column 3 keeps the second run's stricter criterion: a check must fail before the blocker lands and pass after it. The first run's verdict used the looser "the check is runnable".

The convergence fix worked. The scout was refused once, for three proof tests that sat outside their tickets' files. The retry took 27 s instead of 130–341 s. It left tickets 1 and 2 byte-for-byte as they were. In tickets 3, 5 and 6 it changed only `filesToChange`. It also changed ticket 4, which no reason named. That was needed: once ticket 3 created `export_test.go`, ticket 4 had to stop creating it too. The scout moved ticket 4 to an `edit` of ticket 3's file, the new form, and the app accepted it. The turn stored a grounding in 133 s of model time. The second run took 1735 s and stored nothing.

What the grounding is worth is a separate question. Of the six grounded briefs, three are usable as-is as delegation prompts (01, 03, 06). Two need one fix or one decision each (04, 05). One is not usable (02): its builder cannot pass its own Verify step without leaving its file boundaries. Details are under "The question that decides epic C".

## Setup

- **Project.** A `git clone --no-hardlinks` of the marathon tracker into `<scratch>/run3/marathon`, with a local git user set in the clone. The original repository was never written to. HEAD is `52b6bf2`, the commit of both earlier runs. There is no `_test.go` file and no `backend/export/`.
- **Server.**
  - One `pnpm exec agent-native dev --port 5633 --strictPort`, started from this worktree's `grill-room/` after `pnpm install --frozen-lockfile`.
  - It ran with `AUTH_DISABLED=true`, `DATABASE_URL=pglite:<scratch>/run3/db` and `GRILL_ROOM_INTERVIEWER` unset, so the real interviewer ran.
  - I recorded three PIDs: pnpm, the agent-native child and the vite grandchild. At the end I stopped exactly those three and confirmed port 5633 was free. Port 8082 was never touched.
- **Driver.** Every step went through `POST`/`GET /_agent-native/actions/<name>`, the way `e2e/support.ts` calls them.
- **Project registration.** `register-project` with root `<scratch>/run3/marathon`, export folder `.scratch` and verify command `make test-go`. It resolved to visibility `tracked`, recipe `pull-request` and adversarial review on, as in both earlier runs.
- **Checked first.** `server/brief-grounding.ts` has `doubleCreateReasons`. `HandoffScoutRequest` carries `previousResult` (`server/interviewer/types.ts`), and `ground-briefs` passes it on every retry within a run. A manual retry starts a new run with no previous result.

## The idea

Title "Export training log as CSV", model `sonnet`, whole-round, project set. The idea text is the first run's, verbatim.

### Rounds

The interview took six rounds (7, 5, 1, 2, 1 and 1 cards, 17 decisions). The first run took four rounds and the second took three. I accepted every recommendation except four cards:

- **Round 1, `openapi-codegen-tooling`.** The earlier runs' own answer: oapi-codegen through `backend/oapi-codegen.yaml`, plus `npm run api:generate`.
- **Round 1, `frontend-ux`.** The earlier runs' own answer on auth and href: there is no auth, so a plain anchor with a hard-coded relative `/api/plan/export.csv`. The card already recommended an anchor, but with a placeholder href.
- **Round 3, `error-response-format`.** The interviewer said it could not see the spec's error convention. I answered from the code: every error in `api/openapi.yaml` is `application/problem+json` with the `Problem` schema, the existing 404s included.
- **Round 4, `utf8-bom`.** This card had no recommendation. It turned on whether titles are free text. I answered from the code: the titles in `backend/data/training_plan.go` are Spanish with accents ("Carrera recuperación", "Media Maratón"), so add the BOM.

The last two cards did not exist in the earlier runs. Each asked a fact about the code, and I answered it from the code, which is the earlier runs' rule. The two answers opened rounds 4–6, one small card each: `completed-value-format`, `test-case-accented-title` and `bom-placement`. No card asked about CI, as in the second run. The no-plan case did come back this time: "no current plan → 404; zero-workout plan → 200 with a header-only CSV", accepted as recommended.

Interviewer time to open rounds 1–6 was 148.0, 110.1, 37.3, 54.5, 45.2 and 44.5 s, and 30.4 s for the done proposal. After that came `confirm-session`, `synthesize-spec` (93.4 s), `break-into-tickets` (51.6 s), `generate-handoff`, one `ground-briefs`, `preview-export`, and `export-session` with slug `export-training-log-as`.

## The tickets

The split differs from both earlier runs. The OpenAPI edit and the regeneration are separate tickets, and the unit tests are again a ticket of their own.

| # | Title | Blocked by | Wave |
|---|-------|------------|------|
| 01 | Add GET /api/plan/export.csv to the OpenAPI spec | none | 1 |
| 02 | Regenerate backend and frontend code from the updated OpenAPI spec | 01 | 2 |
| 03 | Implement the pure CSV-generation function in a new export package | none | 1 |
| 04 | Write the repo's first Go unit tests for the export package | 03 | 2 |
| 05 | Wire the export endpoint handler into the backend server | 02, 03 | 3 |
| 06 | Add the Download CSV button to the Progress view | 05 | 4 |

Tickets 3 and 4 have the same shape that broke the second run: a function in one ticket and its only unit tests in the next.

The acceptance lines that the checks below measure against:

- 01: the operation follows sibling conventions, the success response is `text/csv`, the 404 references `Problem`, and no other path changes.
- 02: re-running both generators gives no further diff, and the endpoint appears in both generated artifacts.
- 03: the function is pure, with the column order and formats of the spec, a header-only result for an empty plan, and no BOM.
- 04: "`go test` passes for the package", and there is one table entry for each of five scenarios.
- 05: 200 with the headers and a BOM-prefixed body, 404 problem+json with no plan, and a header-only 200 for an empty plan.
- 06: clicking the button downloads the file, with no fetch and no client state.

The spec's Out of Scope has one line that matters below: "Any handler-level or HTTP-integration-level automated tests — this spec covers only unit tests for the pure CSV-generation function."

## The turn record

`get-latest-turn` with `turnKind: handoff-scout` returned turn `5fb596fa`, model `sonnet`, outcome `succeeded`, `totalElapsedMs` 133251.

| Run | Manual retry | Attempt | Kind | Duration | Reason |
|-----|--------------|---------|------|----------|--------|
| 1 | no | 1 | `tree-rule-refusal` | 106.2 s | "Ticket 3 is proved by backend/export/export_test.go, which is not one of its filesToChange; list the test file as a create or an edit, so the ticket may write it." The same for ticket 5 (`backend/server/server_test.go`) and ticket 6 (`frontend/e2e/progress.spec.ts`) |
| 1 | no | 2 | `success` | 27.0 s | none |

`ground-briefs` returned HTTP 200 after 133.4 s. The grounding was stored with commit `52b6bf2` and `current: true`. The second run's manual retry was not needed.

## The question that decides epic C

### Was a grounding stored, and in how many attempts?

Yes, in two attempts in one run. The first run needed two runs and the second run failed after six attempts.

### Did the retry keep the entries that had passed?

I compared the two attempts' raw outputs ticket by ticket, field by field.

- **Tickets 1 and 2: identical.** No reason named them, and not one field changed.
- **Ticket 3: only the named change.** `filesToChange` went from `[export.go create]` to `[export.go create, export_test.go create]`. Builds-on files, facts and proof are unchanged.
- **Ticket 5: only the named change.** `filesToChange` gained `backend/server/server_test.go` as a create.
- **Ticket 6: only the named change.** `filesToChange` gained `frontend/e2e/progress.spec.ts` as a create.
- **Ticket 4: changed, although no reason named it.** In attempt 1 ticket 4 created `export_test.go`. Once ticket 3 created it, a second create would have been refused under the new double-create rule. The scout made four changes:
  - `filesToChange`: `export_test.go` went from `create` to `edit`.
  - `buildsOn`: `createdPath` went from `backend/export/export.go` to `backend/export/export_test.go`. `provides` changed from "the pure CSV-generation function in backend/export/export.go to exercise from the test table" to "…and its starter test file backend/export/export_test.go to extend with the required table cases". The check was rewritten (see check 3).
  - One fact was reworded, from "No _test.go file exists anywhere under backend, so this ticket's table-driven test establishes the repo's first Go test file" to "…prior to ticket 3's own test file, so this ticket's table-driven cases build on the repo's first Go test file".
  - `provedBy.command` gained `-v`: `cd backend && go test ./export/... -v`.

The first three of these follow from the named change. The `-v` is harmless drift. Every entry the reasons did not name and did not depend on came back unchanged. The retry did not re-explore: it took 27 s, against 130–341 s per retry in the second run.

Two limits on what this shows. The refusal was one rule class with an obvious fix, so it did not test the second run's hard case, two refusals that exclude each other. That case did not come up. The shape that caused it, ticket 4 editing ticket 3's test file, is now simply accepted. And this is one run.

### Is each grounded brief usable as-is as a delegation prompt?

Each brief ends with the same Verify step, `make test-go` from the repository root, and the rule "Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report."

| Brief | Verdict | Reason |
|-------|---------|--------|
| 01 | **Usable as-is** | Its boundary (`api/openapi.yaml`) and facts are right, and it names the `Problem` 404 convention the ticket needs. Its proof is weak, since it passes before the change (check 4). It also leaves the operationId to the builder, and two later checks depend on that name (check 3) |
| 02 | **Not usable** | Regenerating adds a method to `StrictServerInterface`, and `go build ./...` then fails at `main.go:50:40` (reproduced in a scratch copy). `make test-go` fails the same way, so the builder cannot pass Verify. The fix, a stub in `server.go`, is outside the brief's boundaries, so a builder following the rules must stop and report |
| 03 | **Usable as-is** | It creates `export.go` and `export_test.go`, is proved by `go test ./export/...`, and its facts give the exact struct fields. One fact says the fields "match" the planned-distance column, and another says no planned-distance field exists. The second is right, and the builder must still decide what that column holds. That gap comes from the spec, and the brief states it |
| 04 | **One fix needed** | Its boundary is an `edit` of `export_test.go` "(created by ticket 03)", which is what the ticket needs. But its Builds-on check `cd backend && go test ./export/... && grep -n 'func Test' backend/export/export_test.go` can never pass: after the `cd`, the grep looks for `backend/backend/export/export_test.go`. A builder that runs it at Step 0 sees its blocker as missing |
| 05 | **One decision needed** | Its boundaries, facts and 404 consequence are good. It creates `backend/server/server_test.go` and is proved by it, while the spec's Out of Scope excludes "handler-level … automated tests". The builder gets two opposite instructions. Its check on ticket 2 also depends on the operationId |
| 06 | **Usable as-is** | It edits `ProgressView.tsx`, creates `progress.spec.ts`, and its facts are true. The e2e proof needs the Go backend, or a `page.route` stub, which the brief does not mention. The brief's Verify (`make test-go`) does not run it |

So three of six briefs are ready to paste. Brief 02's failure is the second run's problem 5, unchanged, and it blocks the waves after it: from the moment ticket 2 lands until ticket 5 does, `make test-go` is red on `main`, and every brief's Verify fails.

## Export

`preview-export` returned `groundingState: "current"`, `groundingStaleReason: null`, `groundedBriefs: [1, 2, 3, 4, 5, 6]` and `ungroundedBriefs: []`. It also returned `exportBlocked: false` and 17 planned writes, none edited. `export-session` wrote those 17 files with the same `groundedBriefs`/`ungroundedBriefs`, and nothing kept or removed.

## The grounded sections, as exported

Each brief is quoted from `## File boundaries` up to `## Rules`. The rest of each brief is the unchanged template.

### Brief 01

````markdown
## File boundaries

Files to edit:

- `api/openapi.yaml`

Existing files it builds on:

- `api/openapi.yaml:80-98`
- `api/openapi.yaml:60-79`
- `api/openapi.yaml:277-315`

## Codebase facts

- The sibling GET /api/plan/progress operation under the Training Plan tag has no request parameters and returns a 200 application/json plus a 500 application/problem+json referencing the Problem schema. (`api/openapi.yaml:80-98`)
- The sibling GET /api/plan/today operation models its not-found case as a 404 response with content application/problem+json referencing '#/components/schemas/Problem'. (`api/openapi.yaml:73-78`)
- The Problem schema is defined once under components.schemas with type, title, status, detail, instance and _links fields, meant to be referenced rather than redefined. (`api/openapi.yaml:277-315`)
- No path in the spec currently declares a text/csv response content type; every existing response uses application/json or application/problem+json. (`api/openapi.yaml:25-273`)

## Proved by

Test: `api/openapi.yaml`

```bash
cd frontend && npx openapi-typescript ../api/openapi.yaml -o /dev/null
```
````

### Brief 02

````markdown
## File boundaries

Files to edit:

- `backend/generated/api/api.gen.go`
- `frontend/src/api/schema.d.ts`

Existing files it builds on:

- `backend/oapi-codegen.yaml:1-7`
- `docs/adr/001-api-first-openapi.md:66-73`
- `frontend/package.json:11`

## Codebase facts

- The Go generator is configured via backend/oapi-codegen.yaml to produce a chi-server, models and a strict-server into generated/api/api.gen.go. (`backend/oapi-codegen.yaml:1-7`)
- The ADR records the exact invocation 'oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml' run from backend/. (`docs/adr/001-api-first-openapi.md:66-69`)
- The frontend package.json defines an 'api:generate' script running 'openapi-typescript ../api/openapi.yaml -o src/api/schema.d.ts'. (`frontend/package.json:11`)
- The generated Go file is machine-generated with a 'DO NOT EDIT' header, so this ticket's diff must come only from re-running the generator, not hand edits. (`backend/generated/api/api.gen.go:1-4`)

## Builds on

- Ticket 01: the new GET /api/plan/export.csv operation and Problem-referencing 404 in api/openapi.yaml for the generators to consume — ticket 01 adds `GET /api/plan/export.csv path/operation` to `api/openapi.yaml` — check: `grep -n 'export.csv' api/openapi.yaml`

## Proved by

Test: `backend/generated/api/api.gen.go`

```bash
cd backend && oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml && grep -n ExportCsv generated/api/api.gen.go && cd ../frontend && npm run api:generate && grep -n 'export.csv' src/api/schema.d.ts
```
````

### Brief 03

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

## Codebase facts

- api.TrainingPlan carries Weeks []Week, and each Week carries WeekNumber int and Workouts []Workout, giving the pure function's input its week-index and per-workout grouping. (`backend/generated/api/api.gen.go:150-161`)
- api.Workout declares Completed bool, Completion *WorkoutCompletion, Date openapi_types.Date, Title string, Type WorkoutType, WeekNumber int and PlannedDuration *int, matching the ticket's required date/week/type/title/planned-distance/completed columns. (`backend/generated/api/api.gen.go:226-242`)
- Actual distance and duration only exist on WorkoutCompletion.Metrics (DistanceKm, ActualDuration), which is nil unless the workout is completed, matching the spec's blank-when-incomplete rule. (`backend/generated/api/api.gen.go:244-250`)
- WorkoutMetrics.DistanceKm is a *float32 and ActualDuration is a *int minutes value, so duration must be converted from minutes to HH:MM:SS by this ticket's function. (`backend/generated/api/api.gen.go:271-284`)
- Workout has no 'plannedDistance' field in the generated struct; only PlannedDuration (minutes) is modeled, so the code shows no distance unit for planned distance for this ticket to read from. (`backend/generated/api/api.gen.go:226-242`)

## Proved by

Test: `backend/export/export_test.go`

```bash
cd backend && go test ./export/...
```
````

### Brief 04

````markdown
## File boundaries

Files to edit:

- `backend/export/export_test.go` (created by ticket 03)

Existing files it builds on:

- `backend/generated/api/api.gen.go:226-242`
- `backend/generated/api/api.gen.go:244-250`

## Codebase facts

- No _test.go file exists anywhere under backend prior to ticket 3's own test file, so this ticket's table-driven cases build on the repo's first Go test file as the spec requires. (`backend/go.mod:1-21`)
- api.Workout.Title is a plain string field usable to construct the comma/quote/newline and accented-title test cases. (`backend/generated/api/api.gen.go:226-242`)

## Builds on

- Ticket 03: the pure CSV-generation function in backend/export/export.go and its starter test file backend/export/export_test.go to extend with the required table cases — created by ticket 03 at `backend/export/export_test.go` — check: `cd backend && go test ./export/... && grep -n 'func Test' backend/export/export_test.go`

## Proved by

Test: `backend/export/export_test.go`

```bash
cd backend && go test ./export/... -v
```
````

### Brief 05

````markdown
## File boundaries

Files to create:

- `backend/server/server_test.go`

Files to edit:

- `backend/server/server.go`

Existing files it builds on:

- `backend/server/server.go:53-78`
- `backend/db/repository.go:37-72`
- `backend/server/server.go:454-456`

## Codebase facts

- The existing GetPlan handler resolves the current plan via s.repo.GetPlan() and, when the repository returns a nil plan, responds with a 500 problem+json rather than a 404. (`backend/server/server.go:53-78`)
- Repository.GetPlan returns (nil, nil) when the training_plans query yields sql.ErrNoRows, which is the 'no current plan' condition this ticket must turn into a 404. (`backend/db/repository.go:37-50`)
- Because the cited GetPlan handler only models a 500 for a missing plan, this ticket cannot copy that handler's status code and must independently build the 404 problem+json response the spec requires. (`backend/server/server.go:65-72`)
- server.go defines a stringPtr helper already used by every other handler to build optional *string Problem fields. (`backend/server/server.go:454-456`)

## Builds on

- Ticket 02: the generated StrictServerInterface method and request/response types for the export operation in backend/generated/api/api.gen.go — ticket 02 adds `generated export-operation method on StrictServerInterface` to `backend/generated/api/api.gen.go` — check: `grep -n 'ExportCsv' backend/generated/api/api.gen.go`
- Ticket 03: the pure export function in backend/export/export.go to call from the handler — created by ticket 03 at `backend/export/export.go` — check: `grep -n 'func ' backend/export/export.go`

## Proved by

Test: `backend/server/server_test.go`

```bash
cd backend && go test ./server/...
```
````

### Brief 06

````markdown
## File boundaries

Files to create:

- `frontend/e2e/progress.spec.ts`

Files to edit:

- `frontend/src/components/progress/ProgressView.tsx`

Existing files it builds on:

- `frontend/src/components/progress/ProgressView.tsx:1-13`

## Codebase facts

- ProgressView is a functional component whose props (trainingPlan, overallProgress, statistics, streak, weeklyProgress, onWeekTap) carry no plan ID, so a hard-coded relative href needs no new prop threading. (`frontend/src/components/progress/ProgressView.tsx:1-13`)
- The view currently renders only a header, hero card, statistics grid, streak card and weekly summary section, with no existing download/export control. (`frontend/src/components/progress/ProgressView.tsx:12-144`)

## Builds on

- Ticket 05: a working GET export endpoint on the backend for the anchor's href to hit — ticket 05 adds `export endpoint handler method` to `backend/server/server.go` — check: `grep -n 'ExportCsv\|export.csv' backend/server/server.go`

## Proved by

Test: `frontend/e2e/progress.spec.ts`

```bash
cd frontend && npx playwright test progress.spec.ts
```
````

## The checks

Every check was done by reading the clone at `52b6bf2`, with commands run read-only in the clone. Go wrote only to its own build cache. `git status` in the clone shows only the exported `.scratch/`. Experiments that needed a changed file ran in separate scratch copies of `backend/` and `api/`, never in the clone.

### 1. File boundaries

**1a. Edit targets: Pass (6 of 6).** `api/openapi.yaml`, `backend/generated/api/api.gen.go`, `frontend/src/api/schema.d.ts`, `backend/server/server.go` and `frontend/src/components/progress/ProgressView.tsx` all exist (`ls`). `backend/export/export_test.go` (ticket 4) does not exist yet. It is ticket 3's create, and ticket 3 blocks ticket 4, so the new rule accepts it, and the brief renders it "(created by ticket 03)". The second run was refused on exactly this shape.

**1b. Create targets: Pass (4 of 4).** The creates are `backend/export/export.go`, `backend/export/export_test.go`, `backend/server/server_test.go` and `frontend/e2e/progress.spec.ts`.
- None exists yet (`ls`), and all four are inside the repo.
- `git check-ignore -v` prints nothing and exits 1 for all four.
- Each path has exactly one creator.

**1c. Nothing important missing: Fail (2 gaps).**
- **Ticket 2 breaks the build, and the fix is outside its boundaries. Unchanged from the second run.**
  - In a scratch copy I added the path to the spec and regenerated with oapi-codegen. `go build ./...` then fails: `./main.go:50:40: cannot use srv (variable of type *server.Server) as api.StrictServerInterface value … (missing method GetApiPlanExportCsv)`. It fails the same way for every operationId I tried.
  - Ticket 2's boundaries are the two generated files. The stub that would keep the build green belongs in `server.go`, which is ticket 5's.
  - The scout had the facts for both halves this time too. Brief 02 says the generator produces a strict server, and the interface is plainly wired in `main.go`. It drew no consequence.
- **Ticket 5 creates a test that the spec excludes.** The spec's Out of Scope says "Any handler-level or HTTP-integration-level automated tests". Attempt 1 gave ticket 5 a `server_test.go` proof without the file. The refusal said to list it, and attempt 2 made it a create. The proof-in-own-files rule and the spec disagree. The scout picked the rule, and the brief does not mention the conflict.
- **What is fixed from the second run.** Tickets 3 and 4 now have usable boundaries. Ticket 3 creates the package and its starter test. Ticket 4 edits that test.
- **What is fixed from the first run and stays fixed.** Ticket 5 has a handler test file (see above). Ticket 6 creates its own e2e spec. Every proving test is in its ticket's own files.

### 2. Codebase facts: 16 true, 5 partly true, 0 false

| Brief | Fact (short) | Citation | Verdict | Evidence |
|-------|--------------|----------|---------|----------|
| 01 | `/api/plan/progress`: no parameters, a 200 json and a 500 problem+json | `openapi.yaml:80-98` | True | 80–98: `getProgress`, no `parameters`, 200 `$ref Progress`, 500 `$ref Problem` |
| 01 | `/api/plan/today` models its 404 as problem+json with `Problem` | `openapi.yaml:73-78` | True | 73 `'404':`, 76 `application/problem+json`, 78 `$ref: '#/components/schemas/Problem'` |
| 01 | `Problem` is defined once, with six fields | `openapi.yaml:277-315` | True | 277 `Problem:`, then type, title, status, detail, instance and `_links` |
| 01 | No `text/csv` response exists | `openapi.yaml:25-273` | True | `grep -c text/csv` is 0. The only content types are `application/json` (11) and `application/problem+json` (13), all under `paths` (25–273) |
| 02 | oapi-codegen config | `oapi-codegen.yaml:1-7` | True | chi-server, models, strict-server, `output: generated/api/api.gen.go` |
| 02 | ADR invocation from `backend/` | `adr/001…:66-69` | True | 67 `cd backend`, 68 `oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml` |
| 02 | `api:generate` writes `schema.d.ts` | `package.json:11` | True | Line 11 |
| 02 | `api.gen.go` is `DO NOT EDIT` | `api.gen.go:1-4` | True | Line 3 |
| 03 | `TrainingPlan.Weeks`, and each `Week` has `WeekNumber` and `Workouts` | `api.gen.go:150-161` | **Partly** | 160 `Weeks []Week`. `Week` and its fields are at 196–207, outside the citation (but in `buildsOnFiles`) |
| 03 | `Workout`'s fields "match" the columns, planned distance included | `api.gen.go:226-242` | **Partly** | The field list is exact. But `PlannedDuration` does not match a planned-distance column, and fact 5 of the same brief says so. The two facts contradict each other |
| 03 | Actual distance and duration live on `Completion.Metrics`, "nil unless the workout is completed" | `api.gen.go:244-250` | **Partly** | 248 `Metrics *WorkoutMetrics`. "Nil unless completed" comes from `repository.go:728-745`, where `Completion` is set only when `completionID.Valid`. That is outside the citation |
| 03 | `DistanceKm *float32`, `ActualDuration *int` minutes, so convert to HH:MM:SS | `api.gen.go:271-284` | True | 274 "Actual duration in minutes", 277 `*float32` |
| 03 | No planned-distance field; only `PlannedDuration` | `api.gen.go:226-242` | True | 238 is the only planned field. The third run to catch this spec error, again as a positive claim |
| 04 | No `_test.go` exists under `backend` before ticket 3 | `go.mod:1-21` | **Partly** | True (`find … -name '*_test.go'` gives 0), but `go.mod` cannot show an absence. The citation supports nothing in the statement |
| 04 | `Workout.Title` is a plain string | `api.gen.go:226-242` | True | 239 `Title string` |
| 05 | `GetPlan` resolves via `s.repo.GetPlan()` and returns a 500, not a 404, for a nil plan | `server.go:53-78` | True | 55, and 65–71 `GetPlan500…{"no-plan", Status: 500}` |
| 05 | `Repository.GetPlan` returns (nil, nil) on `sql.ErrNoRows` | `repository.go:37-50` | True | 48–49 |
| 05 | So this ticket cannot copy the status code and must build its own 404 | `server.go:65-72` | True | The first run's missed consequence, now drawn |
| 05 | `stringPtr` is "already used by every other handler" | `server.go:454-456` | **Partly** | The helper is at 454–456. It is used 28 times, but not by `GetHealth` (36–52), and the usage is outside the citation |
| 06 | `ProgressView`'s props carry no plan ID | `ProgressView.tsx:1-13` | True | 4–11 destructure six props, none an ID. `TrainingPlanInfo` is `raceName` and `raceDate` only |
| 06 | Header, hero, statistics, streak, weekly summary; no export control | `ProgressView.tsx:12-144` | True | Section comments at 14, 26, 54, 81 and 102. The component closes at 143. `grep -i "download\|csv"` finds nothing. The first run's too-narrow citation for this fact is now wide enough |

Totals: 21 facts, 16 true, 5 partly true, 0 false. Four of the five partly-true facts have the second run's flaw: part of the statement is read from lines outside the citation. The fifth contradicts a sibling fact. The two best facts are the missing planned distance (brief 03) and the 500-vs-404 consequence (brief 05). The second of those is the seam the first run's scout saw and did not state.

### 3. Builds on: 5 of 5 fail today; 2 are sure to pass after

| Edge | Form | Names what the blocker produces? | Fails today? | Passes once the blocker lands? |
|------|------|-----------------------------------|--------------|--------------------------------|
| 02 ← 01 | `editedPath` `api/openapi.yaml`, `symbol` "GET /api/plan/export.csv path/operation" | **Yes**, though `symbol` is prose | **Yes**: `grep -n 'export.csv' api/openapi.yaml` exits 1 | **Yes.** The path is fixed by ticket 1's own title |
| 04 ← 03 | `createdPath` `backend/export/export_test.go` | **Yes.** It is ticket 3's create, and ticket 4 edits it | **Yes**: `go test ./export/...` fails with `lstat ./export/: no such file or directory` | **Never.** After `cd backend`, the grep looks for `backend/backend/export/export_test.go`. In a scratch copy with both files in place, `go test` printed `ok` and the grep failed (exit 2). The same check with the path relative to `backend/` exits 0. Attempt 1's check had the same bug |
| 05 ← 02 | `editedPath` `api.gen.go`, `symbol` "generated export-operation method on StrictServerInterface" | **Yes**, the right file. `symbol` is prose | **Yes**: `grep -n 'ExportCsv'` exits 1 | **Only for some operationIds.** Regenerated in scratch copies: no operationId gives `GetApiPlanExportCsv` (match); `getPlanExportCsv` gives `GetPlanExportCsv` (match); `exportPlanCsv` gives `ExportPlanCsv` and `exportTrainingLog` gives `ExportTrainingLog` (no match). Ticket 1 sets no operationId |
| 05 ← 03 | `createdPath` `backend/export/export.go` | **Yes** | **Yes**: exits 2 (no file) | **Yes.** `grep -n 'func '` matches any function in the file |
| 06 ← 05 | `editedPath` `server.go`, `symbol` "export endpoint handler method" | **Yes**, the right file. `symbol` is prose | **Yes**: exits 1 | **Only for some operationIds**, as for 05 ← 02. The alternation `export.csv` matches only if the builder writes the route in a comment |

Compared with the second run:
- **Better.** Two checks no longer guess a name: `'export.csv'` is fixed by ticket 1's title, and `'func '` needs no name. The `ExportCsv` grep is now a substring. It matches the no-operationId default that the second run's `GetPlanExportCsv` missed, and the `getPlanExportCsv` name that follows the siblings' `getX` pattern.
- **Worse.** One check can never pass. That is new: no earlier run had a check that fails after its blocker lands for a reason unrelated to naming.
- **Unchanged.** All three `symbol` values are prose, rendered in backticks as though they were names.

### 4. Proved by: 2 of 6 sound

| Ticket | Test path | Command | Verdict |
|--------|-----------|---------|---------|
| 01 | `api/openapi.yaml` (edit) | `cd frontend && npx openapi-typescript ../api/openapi.yaml -o /dev/null` | **Fail.** The test path is the spec, not a test. The command only parses the spec, so it passes on today's spec, before the change. I did not run it: the clone has no `frontend/node_modules`, and `npx` would download the package. A grep for the new path would have discriminated |
| 02 | `backend/generated/api/api.gen.go` (edit) | regenerate both sides, then grep for `ExportCsv` and `export.csv` | **Partial.** A generated file as the test path, which is the first run's pattern. The second run's `api.gen_test.go` is gone. The command does fail before and pass after, for most operationIds. But it never builds the module, so it passes while `go build ./...` and `make test-go` are broken (1c) |
| 03 | `backend/export/export_test.go` (create) | `cd backend && go test ./export/...` | **Pass.** Its own file, narrowed to the package. Today it fails with `setup failed` |
| 04 | `backend/export/export_test.go` (edit of ticket 3's create) | `cd backend && go test ./export/... -v` | **Partial.** The right file, and legal now. But the command passes as soon as ticket 3 lands, so it cannot fail without ticket 4's change. That is built into a tests-only ticket, which the second run's ticketing note already flagged |
| 05 | `backend/server/server_test.go` (create) | `cd backend && go test ./server/...` | **Pass, with a spec conflict.** Its own file, narrowed to the package. Today it reports `[no test files]`. The spec excludes handler tests (1c) |
| 06 | `frontend/e2e/progress.spec.ts` (create) | `cd frontend && npx playwright test progress.spec.ts` | **Partial.** As in both earlier runs, `webServer` starts only `npm run dev`, and nothing starts the Go backend. A `page.route` stub would work around it, and the brief says neither |

The second run scored 3 of 5 here. The drop comes from tickets 1 and 2. This split gives the spec edit and the regeneration tickets of their own, and the scout proved both with the file they change instead of a test. Nothing in the rules stops that, since the test path only has to be one of the ticket's files.

### 5. HANDOFF.md: Pass

Grounding was current, and `groundedBriefs` was `[1, 2, 3, 4, 5, 6]` with no ungrounded briefs. HANDOFF.md says so in both places:

- line 13: "Briefs: `.scratch/export-training-log-as/briefs/`, one per ticket, grounded and ready to paste as a delegation prompt";
- line 83: "The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand."

The claim is accurate as HANDOFF.md defines it: every brief has grounded slots. "Ready to paste" holds for three of the six (see the per-brief verdicts).

### 6. Cost

- **Attempts and refusals.** One `handoff-scout` turn, one run, two attempts, one check refusal. There was no manual retry, no `malformed-output` and no CLI failure.
- **Model time.** 106.2 + 27.0 = **133.2 s**, against 276.3 s in the first run and 1734.7 s in the second, for six tickets instead of four or five.
- **First attempts are faster too.** 106 s against 470 s in the second run. The retry prompt is not the only cause. This split's tickets are smaller, and there is less code to read per ticket.
- **Grilling and synthesis.** 440 s of interviewer time to open six rounds, and 30 s for the done proposal. Synthesis took 93 s and ticketing 52 s.

## The second run's new problems, one by one

1. **Retries do not converge. Fixed in this run.**
   - One refusal, one retry, accepted. The retry kept tickets 1 and 2 byte-identical, and changed tickets 3, 5 and 6 only in the named field. It changed ticket 4 only as far as the new double-create rule required, plus a `-v`.
   - It took 27 s, so the "do not re-read files" line appears to hold.
   - Not yet shown: behaviour under two refusals that exclude each other. This run never produced that case.
2. **The app cannot express "edits a file its blocker creates". Fixed.**
   - Ticket 4 edits `export_test.go`, which ticket 3 creates. The app accepted it, and the brief renders "(created by ticket 03)".
   - The scout reached this shape without being told to. No reason named ticket 4.
3. **Two tickets may both create one path. Fixed, and not triggered by the scout.**
   - No attempt had two creators of one path. To check the rule directly, I fed attempt 2 to `reasonsToRefuseHandoffGrounding`, with ticket 4 changed back to creating `export_test.go`. It refused with "Tickets 3 and 4 both mark backend/export/export_test.go as create; only one ticket may create a path. … Ticket 4 is blocked by ticket 3, so mark backend/export/export_test.go as edit in ticket 4". Attempt 2 as accepted returned no reasons.
4. **Dependency checks grep names the blocker's ticket does not fix. Improved, not fixed.**
   - `'export.csv'` and `'func '` depend on nothing the blocker might name differently.
   - `'ExportCsv'` still depends on an operationId that ticket 1 never sets. It passes for the default and for `getPlanExportCsv`, and fails for `exportPlanCsv`.
   - Nothing tells ticket 1's builder that later checks depend on the name.
5. **A codegen ticket whose proof skips the module build. Unchanged.**
   - Ticket 2's command regenerates and greps, but never builds. The regenerated interface breaks `main.go`, as reproduced, and the stub that would fix it is outside ticket 2's boundaries.
   - In this run the consequence is worse than in the second run. Ticket 2 is the first ticket of wave 2, and its brief cannot pass its own Verify step.
6. **`symbol` accepts prose. Unchanged.**
   - All three `editedPath` edges carry prose symbols: "GET /api/plan/export.csv path/operation", "generated export-operation method on StrictServerInterface" and "export endpoint handler method". Each renders in backticks, as though it were a name.

## The first run's items

Where this run differs from the second run's account:
- **Item 5, a proof command that does not exercise the ticket.** This regressed for the two codegen-side tickets (check 4).
- **Item 7, seams.** The 500-vs-404 seam is now drawn in brief 05. The seams between ticket 2 and `main.go`, and between ticket 1 and the operationId, are still not flagged.
- **Item 8, loose citations.** The count is up, 5 partly-true facts against 3.
- **Item 9, `buildsOnFiles` padding.** Gone. Every entry is code the ticket reads.

Items 1–4 and 6 stay fixed.

## New problems, with suggested fixes

1. **A Builds-on check that can never pass, because its path ignores its own `cd`.** Ticket 4's check, in both attempts, runs `cd backend && …` and then greps a repository-root path.
   *Fix (server check, cheap):* when a check starts with `cd <dir> &&` and a later word begins with `<dir>/`, refuse it: "after `cd <dir>`, paths are relative to `<dir>`". *Fix (prompt):* "a check runs from the repository root; after a `cd`, write paths relative to the new directory, or do not `cd`."
2. **The proof rule can force a test the spec excludes.** Ticket 5 was refused for a proof test outside its files. It then created one, although the spec puts handler tests out of scope.
   *Fix (prompt):* "when the spec rules out tests for a ticket's kind of change, prove it with a build or a command over files it owns, and say in a fact that the spec excludes tests." *Fix (server, optional):* let `provedBy.testPath` be null when the command is given, rather than forcing a file.
3. **Tickets whose proof is the file they change.** Ticket 1 is "proved" by `openapi.yaml` with a parse that passes before the change. Ticket 2 is "proved" by the generated file. The rule that the test path is one of the ticket's files is met trivially.
   *Fix (server check):* refuse a `provedBy.testPath` that is also an `edit` in the same ticket and is not a test file by the project's naming (`_test.go`, `.spec.ts`, `.test.ts`). The reason offers a build or a grep command instead. *Fix (prompt):* "the proof must fail on the current commit". For ticket 1 that means a grep for the new path.
4. **A fact that contradicts a sibling fact.** Brief 03 says the fields "match" the planned-distance column, and then that no planned-distance field exists.
   *Fix (prompt):* "do not claim a field matches a column unless it holds that column's data." This is minor, and the right fact is also present.
5. **Carried over: ticket 2 cannot pass Verify.** This is the second run's problem 5. It is listed again because it is now the one brief that is unusable.
   *Fix (prompt, as the second run proposed):* "a ticket proved by a build builds the whole module; when that build needs a file outside the ticket's boundaries, add the file and say why." *Upstream (ticketing):* keep a spec change, its regeneration and a stub handler in one ticket, or make the regeneration ticket own the stub.

## Follow-ups to file as beads

Problem 5 (the second run's problem 5) is the one thing between this grounding and six usable briefs, and it is the first bead. It is a prompt rule plus a ticketing hint. Problem 1 is a small server check that would have caught the only other defect a builder would trip on at Step 0, and it is the second. Problems 2 and 3 concern what counts as a proof, and they can share a bead. The second run's problems 4 (names the blocker does not fix) and 6 (prose `symbol`) remain open as filed. Problem 4 is optional.
