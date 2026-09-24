# 03 Scout report storage, the scout action, citation check and staleness

Status: ready-for-agent
Blocked by: 01, 02
Suggested model: opus

## What to build

- Storage for the scout report on the session (additive migration, next free number in `server/db/migrations.ts`): server facts, result, commit and idea read, model, run time, turn record link, and keep/drop state per proposal (initially undecided).
- A `scout-project` action: refuses when the session has no project, the project is not a repo (ticket 01's refusal), the session is not interviewing, or a turn is working. Collects facts, runs the scout through `runTurn` / `askUntilAccepted` (`server/turn.ts`) as its own turn kind with a turn record (turn visibility), stores the report.
- The rejection check (`reasonsToRefuse`): every cited path exists at HEAD and every cited line is within the file; proposal keys are unique; on a re-run every previous decision appears in `previousDecisions`.
- Staleness computed on read: current only while the session's idea and the project's HEAD match what was read. A `get-scout-report` read action returns the report with `stale`.
- Remote URLs never carry credentials: `collectProjectFacts` (`server/project-facts.ts`) strips any userinfo (`user:token@`) from each remote URL before the facts are stored or sent to the scout. A remote URL can hold a token, and the facts go to a model.
- One facts type: `server/interviewer/types.ts` declares a copy of `ProjectServerFacts` that mirrors `server/project-facts.ts`; replace the copy with an import from the one module.

## Builds on

Tickets 01 and 02, the turn-visibility turn record, `server/readiness.ts` (its `currentReadiness` staleness pattern), `actions/assess-readiness.ts` (its own-conversation turn). Confirm they exist first.

## Shares a boundary with

The citation check is reused by ticket 04 for repo evidence: export it as one function. Ticket 05 reads proposal keys and keep/drop state; ticket 06 replaces the report on a re-run.

## How it will be judged

- A remote added as `https://user:secret@example.invalid/x.git` appears in the stored facts, and in the scout request the fake records, as `https://example.invalid/x.git`, with no trace of the secret.
- Action tests with a temporary git repo and the scripted fake: a valid report is stored and read back current; a citation to a missing file or an out-of-range line is refused and retried, and three refusals stop the turn with its own code; the report goes stale after a new commit in the fixture repo and after an idea edit; the turn record shows model `sonnet` for a session on another model; each refusal case above.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
