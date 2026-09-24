# 07 Show the attempt log for readiness, stale reviews, supersession, spec synthesis and ticket breakdown

Status: ready-for-agent
Blocked by: 04, 06
Suggested model: sonnet

## What to build

Reuse the attempt log component from ticket 6. Don't write a new one.

- **Readiness**: in the live turn status while the judgment runs, and collapsed in the readiness panel (`app/components/workspace/readiness-panel.tsx`) afterwards.
- **Supersession check**: in the live turn status while the check runs, and collapsed in the done panel (`app/components/workspace/done-panel.tsx`) next to the loose ends it proposes.
- **Stale reviews**: show it in the live turn status while the review runs, and collapsed next to the review's what-changed digest afterwards.
- **Spec synthesis**: show it on the session output surface, live and then collapsed, next to the spec.
- **Ticket breakdown**: show it on the session output surface, live and then collapsed, next to the ticket list.
- Results that have no turn record show no attempt log.

## How it will be judged

- Each of the five turn kinds shows its live attempts while running and a collapsed, expandable log beside its result afterwards.
- It is the same component used for rounds.
- Nothing shows for results from before this change.
- Verification: the project's test command plus its type check.
