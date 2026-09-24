# 06 Build the attempt log component and show it for round proposals

Status: ready-for-agent
Blocked by: 03, 05
Suggested model: sonnet

## What to build

Build one reusable attempt log component from the project's existing component kit.

- **While a turn runs**, each attempt is one line:
  - "attempt N of the budget"
  - its elapsed time, ticking live for the running attempt
  - its kind
  - the one-line reason when there is one
  - A rate limit is labelled clearly distinct from an interviewer error.
- **Runs**: runs after the first are preceded by a visible "manual retry" separator.
- **After the turn**, the log renders collapsed and can be expanded.
- Raw output is not shown.

Wire the component into the workspace's live turn status for round proposals, and show it collapsed on each round in round history. Updates arrive through the framework's database sync hook, so the log updates live and survives navigation and reload. The rest of the workspace stays usable while it updates. Rounds without a turn record show no attempt log.

## How it will be judged

- A running propose-round turn shows its attempts live, and they are still there after a reload.
- A finished round shows a collapsed log that expands to every attempt, with manual-retry separators where they apply.
- Rounds from before this change show nothing.
- Verification: the project's test command plus its type check.
