# Scenario-based browser regression tests and a recorded demo

Status: ready-for-agent

## Problem Statement

Every UI ticket is checked in a browser, but almost none of those checks survive the ticket. The one browser test Grill Room has walks a single canned interview from start to finish, and it can only ever be one test. The fake interviewer holds one queue of scripted answers for the whole server process. A second test would find that queue empty, and one click the script did not expect breaks it for every session until the server restarts.

That queue also only covers part of the app. It scripts round proposals, the supersession check, the spec and the tickets, but never readiness, a stale review or the project scout. Checking those means writing rows into the database by hand, which proves the screen renders but not that the flow reaches it. And it answers instantly, so a running turn is never on screen: the live attempt log, the part of turn visibility people actually watch, has no test at all.

There is also no way to show someone how the app is used. A recording made by hand goes stale with the next UI change, and the fake's canned questions ("What shape should this take?") do not show what the real interviewer is like.

## Solution

The fake interviewer becomes a set of named scenarios. A test chooses the scenario for a session, the fake keeps a separate queue per session, and a scenario can set how long each answer takes. Sessions no longer share state, so a mismatched request fails only its own session, and many tests can run against one server.

Scenarios cover every kind of request the app makes, including readiness, stale review, supersession and the project scout. Each flow gets its own short browser test: readiness, a reopen with its stale review, a refusal followed by a manual retry with the live attempt log visible, a rate limit shown apart from an interviewer error, and supersession. The existing end-to-end walk stays as the smoke test. `just e2e` runs them all.

The real interviewer can record its answers to a file as it runs. A recorded session loads as a scenario and replays exactly. One real session, recorded once, becomes the demo: a browser test that walks the whole app at a watchable pace with real questions and records a video. Re-running it after a UI change regenerates the video, and a small copy goes into the documentation.

## User Stories

1. As a developer, I want each browser test to choose its own scenario, so that tests do not depend on each other's order.
2. As a developer, I want the fake to keep a separate queue for each session, so that one test's session cannot consume another's answers.
3. As a developer, I want a request the scenario did not expect to fail only its own session with a clear message, so that one bad click does not break every later test.
4. As a developer, I want choosing a scenario to be impossible when the real interviewer is in use, so that a test hook can never reach a real session.
5. As a developer, I want a scenario to set a delay before each answer, so that a running turn stays on screen long enough to test.
6. As a developer, I want scenarios for readiness (ready and not ready), so that the readiness panel is tested through the real flow.
7. As a developer, I want a scenario for a reopen and its stale review, so that the what-changed digest and its attempt log are tested through the real flow.
8. As a developer, I want a scenario for the supersession check, so that the done panel's proposals are tested.
9. As a developer, I want a scenario that refuses a proposal and then succeeds, so that the attempt log's refusal row is tested.
10. As a developer, I want a scenario that is rate limited and then succeeds on a manual retry, so that the rate-limit panel, the manual-retry separator and the restarted budget counter are tested.
11. As a developer, I want a scenario for the project scout, so that the scout report and keep or drop are tested once they exist.
12. As a developer, I want the live attempt log tested while a turn is running, so that the part of turn visibility people watch is guarded.
13. As a developer, I want each flow in its own short test, so that a failure names the flow that broke.
14. As a developer, I want the existing end-to-end walk kept as the smoke test, so that the whole path is still covered in one place.
15. As a developer, I want `just e2e` to run every browser test, so that one command guards the UI before a merge.
16. As a developer, I want the browser tests to keep using their own port and a throwaway database, so that they never touch the app a person is using.
17. As a developer, I want the real interviewer to be able to record each answer it gives to a file, so that a real session can be replayed without the model.
18. As a developer, I want recording to be off unless explicitly switched on, so that normal use writes nothing extra.
19. As a developer, I want a recorded session to load as a scenario, so that real interviewer output drives a browser test.
20. As a developer, I want a recording validated against each request kind's schema when it loads, so that a stale recording fails loudly instead of misbehaving.
21. As someone learning the app, I want a video of the whole flow with real questions, so that I can see how Grill Room is used before trying it.
22. As someone learning the app, I want the demo paced so that each step can be followed, so that the video teaches rather than flashes past.
23. As a maintainer, I want one command to regenerate the demo video, so that it stays current after UI changes.
24. As a maintainer, I want the demo kept out of the regular test run, so that `just e2e` stays fast.
25. As a maintainer, I want the video small and linked from the README, so that the repository does not grow with every regeneration.
26. As a developer building a UI ticket, I want a scenario and a test pattern to copy, so that adding a regression test for my ticket is cheap.

## Implementation Decisions

### Scenarios in the fake interviewer

- Every interviewer request carries the session's id in its context, so the fake can tell sessions apart. The real adapter ignores it.
- Named scenarios live in one registry in the fake's module. A scenario is a list of scripted turns plus an optional delay in milliseconds before each answer.
- A test-only action chooses a scenario for a session. It exists and succeeds only when the fake interviewer is selected; with the real interviewer it is refused with its own code.
- The fake keeps one queue per session, created from the chosen scenario on the session's first request. A session with no chosen scenario uses the default scenario, today's canned interview, so the current smoke test and `just dev-fake` keep working unchanged.
- A request whose kind does not match the next scripted turn of its session fails that request with a clear message naming the expected and actual kinds. Other sessions are untouched.
- The existing scripted-turn builders (refusals, rate limits, schema-invalid output, resume fallbacks) are reused to build scenarios.

### Recording and replay

- An environment variable switches the real adapter into recording mode, naming a file. Each accepted model result is appended with its request kind. Off by default; nothing is recorded otherwise.
- A recording file loads as a scenario. Each entry is validated against its kind's result schema when it loads, and a mismatch refuses the whole scenario.
- A recording holds model output only: questions, recommendations, specs and tickets. It holds no session secrets, but it is reviewed before being committed, because it contains the idea and answers of the session recorded.

### Browser tests

- The smoke test keeps its end-to-end walk on the default scenario.
- New tests, one per flow, each create their own session and choose their scenario: readiness, reopen and stale review, refusal then manual retry with the live log, rate limit, and supersession. The project scout's test is added by the scout feature once its UI exists.
- The live-log test uses a scenario with a delay long enough to observe the running turn.
- The Playwright configuration can run several tests against one server now that sessions are isolated. It stays on one worker unless a test proves otherwise.

### Demo

- A demo test replays a committed recording of one real session and walks the whole app: idea, readiness, rounds, a reopen with its stale review, done, spec, tickets and export. It waits between steps so that each is visible.
- The demo runs only through its own command, `just demo`, never under `just e2e`. It records a video.
- The video is compressed to a small webm and written to the documentation folder, and the README links it. Regenerating it replaces the file.

## Testing Decisions

- Good tests assert what a user or a later action call can observe, never internal calls.
- The fake's scenario registry, per-session queues, mismatch handling, delay and recording loader are tested at the module level, in the style of the existing fake tests.
- The test-only scenario action is tested at the action boundary: it succeeds with the fake and is refused with the real interviewer selected.
- The recording mode of the real adapter is tested in the existing adapter contract test, with the process spawn stubbed.
- Each browser test is itself the check for its flow; `just e2e` must pass with all of them.
- Each ticket's verification is `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, and `just e2e` for any ticket that adds or changes browser tests.

## Out of Scope

- The project scout's own browser test: it belongs to the scout feature's smoke ticket, which builds on this harness.
- Running browser tests in continuous integration: there is no CI here yet.
- Visual regression (pixel comparison of screenshots).
- Narration or captions in the demo video beyond what the app itself shows.

## Further Notes

- The need comes from the turn-visibility feature: its UI tickets could check readiness and stale review only with hand-written rows, the live attempt log could not be tested at all, and one test's selector broke when a second attempt log appeared on the same page.
- Recording the demo session uses the real model once. Which idea the demo shows is the operator's choice, made when the demo ticket runs.
