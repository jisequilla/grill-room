# 01 Readiness request kind, action, storage, idea editing

Status: ready

Build the server half of idea readiness (see ../spec.md).

## What to build

1. Interviewer request kind `assess-readiness` in server/interviewer: request carries the session's idea (and docs folder as other kinds do); result schema in schemas.ts is a strict object { evidence: string[], objective: string | null, objectiveIsProcess: boolean, expectedOutcome: string | null, unknowns: string[], verdict: "ready" | "not-ready", missing: string[] }. Prompt in prompt.ts: judge whether the idea is ready for a grilling interview, using the rules in the spec (ready needs ≥1 evidence, non-null non-process objective, ≤5 unknowns; evidence quotes the idea's own words; never invent facts). Add the method to the Interviewer interface, the CLI adapter, and the fake interviewer's scripting so tests can queue an `assess-readiness` turn.
2. Column on gr_sessions: `readiness_json` (nullable text) holding { ideaJudged: string, result: <result above>, judgedAt: iso }. Migration 42, additive.
3. Action `assess-readiness` ({ sessionId }): refuses when the session has any round, when a turn is working, or when the session is not interviewing; runs the turn through server/turn.ts like request-next-round does; stores the result; returns the readiness. Refusal codes: `has-rounds`, `turn-working`, plus the existing state refusals.
4. Action `update-session-idea` ({ sessionId, idea }): allowed only with zero rounds and no turn working; trims, refuses empty (`idea-required`); sets idea, clears readiness_json, bumps updatedAt.
5. `get-current-round` (or whichever action the session page already reads for its pre-round state) returns `readiness` (null when absent or when readiness.ideaJudged !== session.idea) and `canEditIdea` (zero rounds, turn idle). `list-sessions` rows gain `readinessVerdict`: "ready" | "not-ready" | null under the same staleness rule.
6. Document the kind, column and actions in grill-room/AGENTS.md following the existing table style.

## Judged by

- Unit tests with the fake interviewer: verdict stored and returned; refusal after a round exists; refusal while a turn works; idea edit clears readiness; stale readiness reads as null; list-sessions verdict column; empty idea refused.
- `pnpm test` and `pnpm typecheck` from grill-room pass.
- Migration applies on a fresh database (the test suite covers this as for migrations 40 and 41).
