# {{bead}}: {{title}}

## Intent

One or two sentences on why this ticket exists, with the evidence behind it (a spike section, a review finding, a failing case).

## Behaviour

Each rule the change must satisfy, written as input and expected output. Wherever a rule can be shown, show it: a line of prose stays the spec only when no example can express it.

| Input | Expected |
|---|---|
| `inlineCode("x`y")` | `` ``x`y`` `` |
| `inlineCode("`x")` | `` `` `x `` `` (padded on both sides) |

## Pattern to copy

The existing code this change should follow, by file and line (for example "the retry loop in `actions/ground-briefs.ts:139-170`"). Leave out implementation steps the pattern already shows.

## Acceptance

Numbered. Each line names the test that proves it. That test must fail when the change is reverted.

1. …: proved by `path/to/test.ts` › "test name".

When the ticket changes both a model prompt and the server check that enforces it, one acceptance line is always the seam test: every answer shape the prompt describes passes the check.

## Files

The files the change may touch. A minimal edit to any other file is allowed only when the PR body names it and says why it was needed. An edit outside this list that the PR body does not name blocks the review.

## Builds on

Files and symbols the ticket depends on. The builder's first step is to confirm they exist, and to stop and report if they do not.

## Verify

The exact commands, run from `grill-room/`, and what passing looks like. Include `just e2e` when the ticket changes what the user sees.

## Open questions

Must be empty before launch. Anything here is a decision for the owner, so ask it before building.
