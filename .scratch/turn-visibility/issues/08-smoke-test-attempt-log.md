# 08 Extend the browser smoke test to cover the attempt log

Status: ready-for-agent
Blocked by: 06
Suggested model: sonnet

## What to build

Extend the existing Playwright smoke test, which runs against the app with the fake interviewer. Script the fake interviewer to refuse one round proposal for a tree-rule violation, then succeed. Submit a round and assert two things:

- the live turn status shows two attempts, the first a refusal with its one-line reason;
- once the round arrives, round history shows a collapsed attempt log that expands to both attempts.

## How it will be judged

- The extended smoke test passes against the running app with the fake interviewer.
- The existing smoke test flow still passes: create a session, answer and submit a round, see the tree update, confirm done, see the spec.
- Verification: the project's test command plus its type check.
