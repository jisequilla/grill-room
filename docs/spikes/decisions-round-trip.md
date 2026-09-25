# Spike: a real decisions.md round trip

Bead gr-qs7.5, ticket `.grill-room/decisions-export/issues/05-real-round-trip.md`. One run with the real interviewer and scout against a temp clone of the marathon tracker. It checks that an exported, committed `decisions.md` is read back by the next scout.

## Verdicts

| # | Check | Verdict |
|---|-------|---------|
| 1 | Session 2's facts list the exported decisions.md; session 1's re-scout facts do not | **Pass** |
| 2 | Session 2 proposes at least one exported decision as `recorded`, cited to a decisions.md line | **Pass** (six of them) |
| 3 | For the reopened ADR decision, session 2 proposes the new answer, cited to decisions.md, and not the original ADR statement | **Partial: fails as written.** The new answer is proposed from decisions.md, but the original ADR-003 statement is proposed as well, verbatim |
| 4 | Session 1's re-scout does not propose its own decisions back from decisions.md | **Pass** |
| 5 | Session 2's citations pass the app's citation check | **Pass**: accepted on the first attempt, with no refusals |

## Setup

- **Project:** `git clone --no-hardlinks` of the marathon tracker into `<tmp>/marathon-rt`, with a local git user set in the clone. The original repository was never written to. At HEAD `52b6bf2` the clone has `CLAUDE.md` and `docs/adr/001..004`, and no tracked `decisions.md`.
- **Server:** one `pnpm exec agent-native dev --port 5391 --strictPort`, started from this worktree's `grill-room/` with `AUTH_DISABLED=true`, `DATABASE_URL=pglite:<scratch>/db` and `GRILL_ROOM_INTERVIEWER` unset, so the real interviewer ran. I recorded its PID and stopped only that PID and its two children at the end. The user's server on 8082 was not touched.
- **Driver:** every step went through the action endpoints (`POST`/`GET /_agent-native/actions/<name>`), the same way `e2e/support.ts` calls them.
- **Project registration:** `register-project` with root `<tmp>/marathon-rt`, export folder `.scratch` and verify command `make test`.
- **Branch checked:** it has `renderDecisionsFile` (`server/export.ts`), `decisionFiles` (`server/project-facts.ts`), the decisions.md lines in `buildScoutPrompt` (`server/interviewer/prompt.ts`) and `lastExportFolder` (`server/db/schema.ts`).

## Session 1: grill, export, commit

**Settings:** model `sonnet`, whole-round answering, project set.

**Idea (title "Simpler API error responses"):**

> The React frontend only ever shows a one-line toast when an API call fails, and it has to dig through RFC 7807 problem details plus HATEOAS links to find the message. Replace the Go backend's error responses with a flat JSON body, {"error": {"code": "...", "message": "..."}}, for the workout complete and uncomplete endpoints first, and update the frontend's error toast to read it. Keep the HTTP status codes as they are.

This overturns ADR 003 (RFC 7807 for all errors) for two endpoints.

### Scout (run by assess-readiness)

The readiness verdict was `not-ready`. It asked how the idea squares with ADR 002/003, among other things. This does not block anything. The scout proposed seven repo decisions:

| Key | Source | Citation | What I did |
|-----|--------|----------|------------|
| `rfc7807-problem-details-for-all-errors` | recorded | `docs/adr/003-rfc7807-problem-details.md:19` | **Kept**, then **reopened** with a different answer |
| `api-first-openapi-source-of-truth` | recorded | `docs/adr/001-api-first-openapi.md:25` | **Kept** |
| `hateoas-links-in-all-responses` | recorded | `docs/adr/002-hateoas-hypermedia.md:19` | Dropped |
| `problem-content-type-application-problem-json` | recorded | `docs/adr/003-rfc7807-problem-details.md:79` | Dropped |
| `defined-problem-type-catalog` | recorded | `docs/adr/003-rfc7807-problem-details.md:104-112` | Dropped |
| `generated-code-do-not-edit` | inferred | `backend/generated/api/api.gen.go:1-3` | Dropped |
| `keep-backend-restful-stateless` | recorded | `CLAUDE.md:102` | Dropped |

### Rounds

The session took four rounds before the done proposal, not the two or three I aimed for. The interviewer kept opening follow-ups: the toast library, where it mounts, where the toast fires, and ValidationProblem.

- **Round 1** had three cards. With the round open, I reopened `rfc7807-problem-details-for-all-errors`, which added it as a fourth card on the same round. Answers:
  - reconcile-with-ADRs: accepted the recommendation.
  - toast component: picked a non-recommended offered option ("Install a toast library").
  - page wiring: accepted the recommendation.
  - the reopened ADR decision: my own answer, the flat body for complete/uncomplete only.
- **Round 2** had seven cards. Answers:
  - Accepted the recommendation for code source, content type, toast library and data-wiring scope.
  - Picked the non-recommended "Drop `_links` entirely".
  - Picked the non-recommended "Add coverage later, as a follow-up" for Postman.
  - Gave my own answer on ADR documentation: no ADR edits; the exported decisions.md records the exception.
- **Round 3** had two cards. I accepted the recommendation on where the toast mounts, and picked "Leave TODO.md untouched", a non-recommended option.
- **Round 4** had two cards: where the toast fires and ValidationProblem scope. I accepted both recommendations. The interviewer then proposed done. There were no loose ends. I confirmed.

After that: `synthesize-spec`, `break-into-tickets` (7 tickets), `generate-handoff`, `preview-export`, then `export-session` with slug `simpler-api-error-responses`. The preview listed `decisions.md`, and the export wrote it. The session's `lastExportFolder` became `.scratch/simpler-api-error-responses`. Then in the clone: `git add .scratch && git commit`, giving `e9771bd Export: Simpler API error responses`.

### The exported decisions.md (in full, with line numbers)

```
  1	# Decisions: Simpler API error responses
  2	
  3	Generated by the Grill Room export from this session's settled design tree.
  4	
  5	## Decisions
  6	
  7	<a id="reconcile-flat-error-with-adrs"></a>
  8	### Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts
  9	
 10	- **Decision:** Scoped override — flat body for complete/uncomplete only
 11	- **Why (interviewer's case):** Matches the idea exactly as written; RFC 7807 + HATEOAS stay the project default everywhere else, and this becomes one documented, deliberate exception. Cost: the ADRs now say 'always' when reality is 'always, except these two' — they need an amendment note or the project accrues silent drift between doc and code.
 12	- **Recommendation note (interviewer's):** The idea names exactly two endpoints and says 'first' — implying room to expand later, but deciding nothing about that now, and nothing about the rest of the API or the ADRs in general. Read literally, this is a scoped, deliberate exception, not a repeal, so a documented override on just these two endpoints keeps the blast radius honest and matches what you actually described.
 13	- **Origin:** interviewer · accepted recommendation
 14	
 15	<a id="adr-amendment-scope"></a>
 16	### Should the scoped ADR exception be written down anywhere?
 17	
 18	- **Decision:** No edits to ADR-002 or ADR-003 in this change. The exception is recorded in this session's exported decisions.md, committed with the spec, which supersedes the ADR statement for these two endpoints.
 19	- **Origin:** interviewer · own answer
 20	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs)
 21	
 22	<a id="error-code-field-source"></a>
 23	### What populates the flat error's `code` field?
 24	
 25	- **Decision:** Reuse the catalog's URI slug
 26	- **Why (interviewer's case):** Keeps a single source of truth for error identity — the existing catalog — and gives the frontend a short, stable string to switch on. Cost: couples the flat `code` values to URI-shaped naming even though they're no longer URIs, which can read oddly in client code.
 27	- **Recommendation note (interviewer's):** The catalog already exists and is the project's canonical list of error identities for these flows; deriving `code` from its slug avoids inventing a parallel catalog while still giving the frontend a short, switchable string.
 28	- **Origin:** interviewer · accepted recommendation
 29	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs)
 30	
 31	<a id="error-content-type"></a>
 32	### Does the response content-type change along with the body shape?
 33	
 34	- **Decision:** Switch to `application/json`
 35	- **Why (interviewer's case):** Content-type honestly describes the body; any HTTP-level tooling that content-sniffs error responses won't be misled into parsing it as RFC 7807. Cost: any client or middleware that currently branches on `application/problem+json` to detect errors on these endpoints needs updating too.
 36	- **Recommendation note (interviewer's):** An honest content-type is worth the small downstream update; keeping `application/problem+json` on a non-Problem body reintroduces the same doc/code mismatch this whole session exists to close.
 37	- **Origin:** interviewer · accepted recommendation
 38	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs)
 39	
 40	<a id="error-links-fate"></a>
 41	### What happens to the HATEOAS recovery `_links` on these endpoints' error responses?
 42	
 43	- **Decision:** Drop `_links` entirely
 44	- **Why (interviewer's case):** Matches the idea's body literally as described — nothing but `error`. Cost: the frontend loses the one piece of structured recovery data (the plan link) it currently has, with no replacement unless the caller re-derives it.
 45	- **Origin:** interviewer · another offered option
 46	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs)
 47	
 48	<a id="postman-test-coverage-for-new-error-shape"></a>
 49	### Should Postman/Newman coverage be added for the new flat error shape?
 50	
 51	- **Decision:** Add coverage later, as a follow-up
 52	- **Why (interviewer's case):** Keeps this change scoped to the code, not the test suite, while still committing to coverage eventually. Cost: the new error contract ships untested for however long the follow-up takes, during which a regression would be invisible to the test suite.
 53	- **Origin:** interviewer · another offered option
 54	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs)
 55	
 56	<a id="rfc7807-problem-details-for-all-errors"></a>
 57	### RFC 7807 Problem Details for all error responses
 58	
 59	- **Decision:** The workout complete and uncomplete endpoints return errors as a flat JSON body, {"error": {"code": "...", "message": "..."}}, with Content-Type application/json and the same HTTP status codes; every other endpoint keeps RFC 7807 Problem Details until it is migrated.
 60	- **Origin:** repo (recorded) · reopened
 61	- **Source:** docs/adr/003-rfc7807-problem-details.md:19
 62	- **Supersedes:** "We will use RFC 7807 Problem Details for all error responses, extended with HATEOAS links for recovery navigation."
 63	
 64	<a id="toast-component-choice"></a>
 65	### No toast infrastructure exists yet — how should the frontend surface the error message?
 66	
 67	- **Decision:** Install a toast library (react-hot-toast, sonner, etc.)
 68	- **Why (interviewer's case):** Battle-tested accessibility, animation, and stacking behavior; likely reusable for other toasts elsewhere in the app later. Cost: a new dependency and its own API surface for what is, right now, exactly one call site.
 69	- **Origin:** interviewer · another offered option
 70	
 71	<a id="toast-library-selection"></a>
 72	### Which toast library should be installed?
 73	
 74	- **Decision:** react-hot-toast
 75	- **Why (interviewer's case):** Minimal footprint (~5KB) and a plain imperative API that doesn't assume any particular design system is already in place — safest default when the project's styling stack isn't confirmed. Cost: default visual style is plainer, so it may need more manual styling to match the app's look.
 76	- **Recommendation note (interviewer's):** Without confirmation that the project already uses a design system sonner's defaults are built for, react-hot-toast is the safer choice — it imposes the fewest visual assumptions and is trivial to restyle either way.
 77	- **Origin:** interviewer · accepted recommendation
 78	- **Depends on:** [No toast infrastructure exists yet — how should the frontend surface the error message?](#toast-component-choice)
 79	
 80	<a id="toaster-mount-location"></a>
 81	### Where should the toast library's provider/renderer be mounted?
 82	
 83	- **Decision:** Mount at the app root
 84	- **Why (interviewer's case):** Delivers on the reuse case that justified picking a library in the first place — the next toast anywhere in the app is a one-line `toast.error()` call away, no new plumbing. Cost: a global mount is a small footprint increase outside the two endpoints this change is otherwise scoped to, and it's now 'always there' even on screens that never show an error.
 85	- **Recommendation note (interviewer's):** The library was chosen over a custom component specifically for future reuse; scoping the mount to one page would make that reuse unavailable until someone moves it later, which defeats the reason a library was picked at all.
 86	- **Origin:** interviewer · accepted recommendation
 87	- **Depends on:** [Which toast library should be installed?](#toast-library-selection)
 88	
 89	<a id="validation-problem-scope"></a>
 90	### Does the flat error shape also replace ValidationProblem responses on these two endpoints, or just the Problem (404/409) ones?
 91	
 92	- **Decision:** Flat body replaces ValidationProblem too
 93	- **Why (interviewer's case):** A single, consistent error shape per endpoint is exactly what the idea is trying to achieve — if the frontend's toast-reading code has to branch on which of two shapes it got back depending on the failure kind, that reintroduces the 'dig through structure' problem this whole change exists to remove. Cost: if `ValidationProblem` currently carries structured per-field validation detail beyond a single message, that structure has to collapse into one `message` string, which may lose information — unmeasured here since no per-field detail was found in the scout report for these two endpoints specifically.
 94	- **Recommendation note (interviewer's):** A two-shape error surface on the same two endpoints undercuts the idea's own goal — one flat, predictable place to find the message — more than it preserves architectural purity for a case (validation failures) that's likely rare on these two specific endpoints (mark-complete/uncomplete take little to no body).
 95	- **Origin:** interviewer · accepted recommendation
 96	- **Depends on:** [Reconcile the flat error idea with the RFC 7807 and HATEOAS ADRs it contradicts](#reconcile-flat-error-with-adrs), [What populates the flat error's `code` field?](#error-code-field-source), [Does the response content-type change along with the body shape?](#error-content-type), [What happens to the HATEOAS recovery `_links` on these endpoints' error responses?](#error-links-fate)
 97	
 98	<a id="workout-detail-page-wiring-scope"></a>
 99	### WorkoutDetailPage has no live API calls — is wiring it up part of this change?
100	
101	- **Decision:** Wire the two handlers now
102	- **Why (interviewer's case):** The only way to actually trigger and see the new error toast through the real user flow, rather than in isolation. Cost: pulls a second gap (API wiring) into this change's diff — one that TODO.md already (incorrectly) marks as done.
103	- **Recommendation note (interviewer's):** An error-format change that can't be triggered from the running app isn't verifiable end-to-end. Wiring just the two handlers named in the idea is a small, contained addition to the same page the idea already points at.
104	- **Origin:** interviewer · accepted recommendation
105	
106	<a id="error-to-toast-trigger-location"></a>
107	### Should the toast fire from inside useWorkout, or from WorkoutDetailPage after calling it?
108	
109	- **Decision:** Page triggers the toast after calling the hook
110	- **Why (interviewer's case):** Keeps `useWorkout` a plain data/mutation hook that returns structured results, matching how it already behaves today (checking truthiness, returning a boolean, no side effects) — the page, which already owns UI decisions for these two actions, decides how to present failure. Cost: every future caller of `useWorkout` has to remember to wire up its own toast call, or errors go the way they do today — silently swallowed behind a boolean.
111	- **Recommendation note (interviewer's):** useWorkout was already written as a side-effect-free hook — it only checks truthiness and returns a boolean today. Keeping the toast call in the page preserves that existing pattern instead of introducing a UI dependency into the data layer for the sake of one call site.
112	- **Origin:** interviewer · accepted recommendation
113	- **Depends on:** [What populates the flat error's `code` field?](#error-code-field-source), [Where should the toast library's provider/renderer be mounted?](#toaster-mount-location), [WorkoutDetailPage has no live API calls — is wiring it up part of this change?](#workout-detail-page-wiring-scope)
114	
115	<a id="workout-detail-page-data-wiring-scope"></a>
116	### Does wiring the two handlers also mean switching WorkoutDetailPage off static sample data?
117	
118	- **Decision:** Minimal — wire only the two handlers, leave display data static
119	- **Why (interviewer's case):** Stays true to the 'small, contained addition' framing already agreed on — the error toast is fully testable end-to-end without needing the rest of the page to be live too. Cost: the page will look inconsistent after a successful action (toast never fires, but the completion badge won't move either), which could read as a half-finished feature if anyone clicks through the happy path.
120	- **Recommendation note (interviewer's):** The idea and the settled wiring decision are both scoped to the error path specifically; going further and fetching real data for the whole page is a second, larger gap (already misleadingly marked done in TODO.md) that deserves its own decision rather than riding along here.
121	- **Origin:** interviewer · accepted recommendation
122	- **Depends on:** [WorkoutDetailPage has no live API calls — is wiring it up part of this change?](#workout-detail-page-wiring-scope)
123	
124	<a id="todo-md-correction"></a>
125	### Should TODO.md's inaccurate completion claims be corrected as part of this change?
126	
127	- **Decision:** Leave TODO.md untouched
128	- **Why (interviewer's case):** Keeps the diff strictly to the error-response change; TODO.md accuracy is a pre-existing problem this idea didn't create. Cost: the doc keeps claiming Phase 2/3 completion that still isn't true after this change lands, and the two explicit follow-ups just decided (full page wiring, Postman coverage) have no durable home once this session ends.
129	- **Origin:** interviewer · another offered option
130	- **Depends on:** [Should Postman/Newman coverage be added for the new flat error shape?](#postman-test-coverage-for-new-error-shape), [Does wiring the two handlers also mean switching WorkoutDetailPage off static sample data?](#workout-detail-page-data-wiring-scope)
131	
132	## Built under
133	
134	- `api-first-openapi-source-of-truth`: docs/adr/001-api-first-openapi.md:25
```

### Against the spec's layout

- The file opens with `# Decisions: <title>` and the generated-by line.
- Each entry is an anchor named by the decision key, then an `###` title, then the field list.
- Origin labels are plain phrases, and all three kinds of answer appear:
  - accepted recommendation (for example line 13);
  - another offered option (lines 45, 53, 69, 129), each with the "Why (interviewer's case)" of the matching choice;
  - own answer, with no "Why" (line 19).
- The reopened repo decision (lines 56–62) reads `repo (recorded) · reopened` and carries a **Source** and a **Supersedes** line that quotes the ADR-003 statement.
- The kept decision appears only under Built under, as key and citation (line 134). The five dropped decisions appear nowhere.
- The order is topological, with key ties:
  - `reconcile-…` comes before `adr-amendment-scope`, which depends on it;
  - `toast-library-selection` comes before `toaster-mount-location`;
  - `error-to-toast-trigger-location` comes after `workout-detail-page-wiring-scope`.
- Depends-on links go only to entries in the file.
- There is no Out of scope section. The session ended with no loose ends, so nothing was dispositioned out of scope. That section was not exercised in this run.
- One deviation: my round-3 answer "Leave TODO.md untouched" was typed as my own answer. It is labelled "another offered option" because its text equals an offered choice's label. The spec defines it that way, so this is correct.

## Session 2: scout again

**Settings:** a new session on the same project, model `sonnet`, whole-round answering. I ran `scout-project` directly, not assess-readiness.

**Idea (title "Flat errors for the plan endpoints"):**

> Follow-up to the complete/uncomplete error change: bring the plan endpoints (GET /api/plan, /api/plan/today, /api/plan/week/{n}) and GET /api/workout/{id} onto the same error response format the complete and uncomplete endpoints now use, so the frontend's toast reads every workout and plan error the same way. Add the Postman assertions for the error shape that were deferred last time.

The scout read commit `e9771bd`, the export commit.

**Server facts:** `decisionFiles: [".scratch/simpler-api-error-responses/decisions.md"]`

**Proposed repo decisions:**

| Key | Source | Citation | Statement |
|-----|--------|----------|-----------|
| `rfc7807-scoped-override-complete-uncomplete-only` | recorded | `.scratch/simpler-api-error-responses/decisions.md:56-62` | The workout complete and uncomplete endpoints return errors as a flat JSON body ({error:{code,message}}, application/json); every other endpoint, including the plan and workout-detail GETs this idea targets, keeps RFC 7807 Problem Details until migrated. |
| `adr003-rfc7807-default` | recorded | `docs/adr/003-rfc7807-problem-details.md:19` | We will use RFC 7807 Problem Details for all error responses, extended with HATEOAS links for recovery navigation. |
| `adr-amendment-scope` | recorded | `.scratch/simpler-api-error-responses/decisions.md:15-20` | No edits to ADR-002 or ADR-003 for the complete/uncomplete exception; the override lives only in the exported decisions.md, which supersedes the ADR statement for those two endpoints. |
| `error-code-field-source` | recorded | `.scratch/simpler-api-error-responses/decisions.md:22-29` | The flat error's code field reuses the existing Problem-type catalog's URI slug as a single source of truth for error identity. |
| `error-links-fate` | recorded | `.scratch/simpler-api-error-responses/decisions.md:40-46` | On the flat-error endpoints, HATEOAS recovery `_links` are dropped entirely from the error body. |
| `postman-coverage-deferred` | recorded | `.scratch/simpler-api-error-responses/decisions.md:48-54` | Add Newman/Postman coverage for the new flat error shape later, as a follow-up, rather than in the same change as the format switch. |
| `validation-problem-scope` | recorded | `.scratch/simpler-api-error-responses/decisions.md:89-96` | On the flat-error endpoints, the flat body replaces ValidationProblem (422) responses too, not only the Problem (404/409) ones. |
| `api-first-openapi-source-of-truth` | recorded | `docs/adr/001-api-first-openapi.md:25` | The OpenAPI spec (api/openapi.yaml) is the contract; both backend and frontend derive their types from it via oapi-codegen and generated TypeScript types. |

The scout's reason for `adr003-rfc7807-default`:

> Extending flat errors to these four GET endpoints would need its own scoped-override decision or ADR amendment, the same way complete/uncomplete's did.

**Current state:**

| Status | Citations | Summary |
|--------|-----------|---------|
| gap | `backend/server/server.go:228-234`, `api/openapi.yaml:189-201` | The 'complete/uncomplete error change' the idea calls a follow-up to was only decided in a Grill Room export, not implemented: CompleteWorkout/UncompleteWorkout still return the old RFC 7807 Problem shape … not a flat {error:{code,message}} body. |
| gap | `backend/server/server.go:54-202` | GetPlan, GetTodayWorkout, GetWeek and GetWorkout all build and return RFC 7807 Problem responses … none of them use any flat error body. |
| built | `api/openapi.yaml:50-98`, `api/openapi.yaml:119-159` | The OpenAPI spec defines these four endpoints' error responses as application/problem+json referencing the Problem/ValidationProblem schemas … |
| built | `docs/adr/003-rfc7807-problem-details.md:17-19` | ADR-003 is the recorded, canonical statement that RFC 7807 Problem Details is the default error format for every endpoint until migrated … |
| built | `.scratch/simpler-api-error-responses/decisions.md:56-62` | A prior Grill Room decisions export records a scoped override that puts complete/uncomplete errors on a flat {error:{code,message}} shape (application/json) and explicitly leaves every other endpoint … on RFC 7807 for now. |
| gap | `.scratch/simpler-api-error-responses/decisions.md:48-54`, `api/marathon-tracker-api.postman_collection.json:297-301` | Postman assertions for the flat error shape were explicitly deferred as a follow-up in the prior session and none exist yet … |
| built | `api/marathon-tracker-api.postman_collection.json:61-154`, `…:287-357` | The Postman collection already has request items for the plan endpoints and GET /api/workout/:id … |
| gap | `frontend/src/hooks/useWorkout.ts:30-33`, `…:52-59` | The frontend's toast-based error surfacing (react-hot-toast, mounted at app root, triggered from WorkoutDetailPage …) was also only decided, not built … |
| partial | `frontend/src/hooks/useWorkout.ts:30-33` | useWorkout reads errors the same generic way for every request it makes … |
| built | `TODO.md:69-79`, `.scratch/simpler-api-error-responses/decisions.md:124-130` | TODO.md still marks Phase 2/3 as fully complete … and the prior session explicitly decided to leave TODO.md untouched. |

**Turn record:** turn `e5c68e02…`, `scout-project`, `sonnet`, outcome `succeeded`. One run with one attempt, `kind: success` and `reason: null`, in 112 s.

## Session 1 re-scout

Scouting refuses a session outside `interviewing` (`wrong-session-state`), and session 1 was `confirmed`. To return it to interviewing I used `add-decision`, which adds one unplaced user decision and makes no interviewer turn. Then I ran `scout-project` on session 1. It read commit `e9771bd`. The session's stored `lastExportFolder` was `.scratch/simpler-api-error-responses`.

**Server facts:** `decisionFiles: []`

**Previous decisions passed to the scout:** all seven keys from the first report, each `unchanged`.

**Proposed repo decisions:**

| Key | Source | Citation | Statement |
|-----|--------|----------|-----------|
| `hateoas-links-in-all-responses` | recorded | `docs/adr/002-hateoas-hypermedia.md:19` | We will implement HATEOAS with _links objects in all resource responses, and error responses include recovery links. |
| `problem-content-type-application-problem-json` | recorded | `docs/adr/003-rfc7807-problem-details.md:79` | Error responses use application/problem+json to signal RFC 7807 format. |
| `defined-problem-type-catalog` | recorded | `docs/adr/003-rfc7807-problem-details.md:104-112` | The project defines specific problem type URIs … mapped to HTTP statuses for the complete/uncomplete flows. |
| `generated-code-do-not-edit` | inferred | `backend/generated/api/api.gen.go:1-3` | backend/generated/api/api.gen.go is marked 'Code generated ... DO NOT EDIT'. |
| `keep-backend-restful-stateless` | recorded | `CLAUDE.md:102` | Always keep backend API RESTful and stateless. |
| `frontend-error-handling-not-yet-message-aware` | inferred | `frontend/src/hooks/useWorkout.ts:46-75` | useWorkout's markComplete and markIncomplete return only a boolean and set no message from the Problem body on apiError. |

**Current state:** nine items, cited to these files:

- `backend/server/server.go`
- `api/openapi.yaml`
- `backend/generated/api/api.gen.go`
- `frontend/src/api/schema.d.ts`
- `frontend/src/components/shell/AppShell.tsx`
- `frontend/src/hooks/useWorkout.ts`
- `frontend/src/pages/WorkoutDetailPage.tsx`
- `TODO.md`
- `docs/adr/002-…` and `docs/adr/003-…`

None cites `.scratch/`.

**Turn record:** turn `fe734878…`, `scout-project`, `sonnet`, outcome `succeeded`. One run with one attempt, `kind: success` and `reason: null`, in 150 s.

## The checks

### 1. Session 2's facts list the exported decisions.md; session 1's re-scout facts do not: **Pass**

- Session 2: `"decisionFiles": [".scratch/simpler-api-error-responses/decisions.md"]`.
- Session 1 re-scout: `"decisionFiles": []`. The file is tracked at `e9771bd` and sits under the session's `lastExportFolder` (`.scratch/simpler-api-error-responses`), so the exclusion in `collectProjectFacts` removed it.

### 2. Session 2 proposes at least one exported decision as `recorded`, cited to a decisions.md line: **Pass**

Six proposals are `recorded` and cite `.scratch/simpler-api-error-responses/decisions.md`. Every range covers exactly one entry, from its anchor to its last field:

- `56-62`: the reopened `rfc7807-problem-details-for-all-errors` entry, from line 56 (`<a id="rfc7807-problem-details-for-all-errors"></a>`) to line 62 (the Supersedes line).
- `15-20`: `adr-amendment-scope`, whose line 18 reads "No edits to ADR-002 or ADR-003 in this change …".
- `22-29`: `error-code-field-source`, whose line 25 reads "Reuse the catalog's URI slug".
- `40-46`: `error-links-fate`, whose line 43 reads "Drop `_links` entirely".
- `48-54`: `postman-test-coverage-for-new-error-shape`, whose line 51 reads "Add coverage later, as a follow-up".
- `89-96`: `validation-problem-scope`, whose line 92 reads "Flat body replaces ValidationProblem too".

Four proposals reuse the exported key exactly: `adr-amendment-scope`, `error-code-field-source`, `error-links-fate` and `validation-problem-scope`. Two renamed it: `rfc7807-scoped-override-complete-uncomplete-only` and `postman-coverage-deferred`. Each statement is a faithful paraphrase of its entry's Decision line.

The kept decision `api-first-openapi-source-of-truth` comes back cited to its original ADR (`docs/adr/001-api-first-openapi.md:25`), not to decisions.md. This is expected: Built under lists it only as a reference, so the ADR remains its source.

### 3. For the reopened ADR decision, session 2 proposes the new answer, cited to decisions.md, and not the original ADR statement: **Partial: fails as written**

- **The new answer is proposed, cited to decisions.md.** `rfc7807-scoped-override-complete-uncomplete-only` is cited to `decisions.md:56-62` and states the flat body for complete/uncomplete, which is line 59's Decision.
- **The original ADR statement is also proposed.** `adr003-rfc7807-default` is cited to `docs/adr/003-rfc7807-problem-details.md:19`, whose line reads "We will use **RFC 7807 Problem Details** for all error responses, extended with HATEOAS links for recovery navigation." Its statement repeats the text that decisions.md line 62 quotes as superseded, word for word.

So the scout did not fully follow the prompt's rule. `buildScoutPrompt` says: "A decisions.md entry that carries a Supersedes line overrides the source it quotes: propose the entry's own decision, cited to its line in decisions.md, and not the statement it supersedes."

There is a mitigating reading. The supersession is scoped: the entry's own Decision line says "every other endpoint keeps RFC 7807 Problem Details until it is migrated". Session 2's idea targets exactly those other endpoints, and for them ADR-003 still governs. The scout's reason says so, and its current-state item on ADR-003 frames it as "the default … until migrated".

Still, the proposal restates the superseded "all error responses" text verbatim, not a scoped version. A user who keeps both proposals gets two settled repo decisions that contradict each other on their face. Keeping only the ADR one would reinstate the statement that was overturned.

What would fix it, left open by this spike:

- The prompt could say what to do when a Supersedes entry is scoped. Proposing the ADR only as the scoped remainder ("every endpoint except …"), cited to the decisions.md line, would be one answer.
- Or the spec's rule could be relaxed for partial supersessions.

This is a finding for the main session to file as a bead. The app code was not changed.

### 4. Session 1's re-scout does not propose its own decisions back from decisions.md: **Pass**

- None of the six re-scout proposals cites `.scratch/`, and no current-state citation does either.
- None of its keys matches a session-1 entry key: `reconcile-flat-error-with-adrs`, `adr-amendment-scope`, `error-code-field-source`, `error-content-type`, `error-links-fate`, `postman-test-coverage-for-new-error-shape`, `toast-component-choice`, `toast-library-selection`, `toaster-mount-location`, `validation-problem-scope`, `workout-detail-page-wiring-scope`, `error-to-toast-trigger-location`, `workout-detail-page-data-wiring-scope`, `todo-md-correction`.
- It proposed only ADR, `CLAUDE.md` and code-inferred decisions.
- Nothing of the reopened answer leaks back either. It did not re-propose `rfc7807-problem-details-for-all-errors` or `api-first-openapi-source-of-truth` at all. Both are among the previous decisions it was given as `unchanged`.

### 5. Session 2's citations pass the app's citation check: **Pass**

- The report was accepted and stored: `get-scout-report` returns it with `stale: false`.
- Turn `e5c68e02…` succeeded on run 1, attempt 1, `kind: success`, `reason: null`. There was no refused attempt, so the turn record has no refusal to show.
- I also re-checked all 24 citations in the report (current state and proposals) against the clone. Every path exists, and no range runs past its file's last line.
- Session 1's re-scout gives the same result: 18 citations, all valid, accepted on the first attempt.

## Notes

- **Rounds:** the grill took four rounds, not two or three. The interviewer kept opening narrow follow-ups (toast library, where it mounts, where it fires, ValidationProblem). Accepting its recommendations did not shorten the session.
- **Out of scope section untested:** no loose end was left to disposition, so decisions.md's Out of scope section was not exercised by this real run. It is covered only by the export-plan tests.
- **Re-scout needs interviewing:** re-scouting a confirmed session needs it back in `interviewing` first. I used `add-decision` for that. A user who wants to re-scout after export has to reopen or add something, which moves the session out of `confirmed`.
- **Scout reads decisions, not code:** session 2's current state correctly reports the exported decisions as decided but not built. For example, "was only decided in a Grill Room export, not implemented". It did not mistake decisions.md for evidence of code.
