# 11 List tickets flagged for two review lenses in HANDOFF

Status: ready-for-agent
Blocked by: 02, 03, 09, 10
Bead: `gr-c0t.34`

## What to build

In the review section of `grill-room/server/handoff.ts`, for each ticket the scout flagged as qualifying for two review lenses (stored with the grounding by ticket 3):

- list the ticket with two embedded generic lenses, one on correctness and one on tests. The wording is HANDOFF's own; use `.claude/templates/delegation/reviewer.md` and the two-lens line in `.claude/rules/worktrees.md` as the reference;
- cite the repository's review rule next to the flagged tickets, from the flag's citation;
- unflagged tickets keep the existing single fresh-context reviewer.

When the review switch (`adversarialReview`) is off, render nothing about two-lens review. Check the flag's citation against the collected rule sources when the report is accepted, like other rule citations. Rule text is not copied.

## How it will be judged

In `grill-room/server/handoff.test.ts`:

- a flagged ticket is listed with both lenses and the cited review rule, in both recipes;
- an unflagged ticket gets the single reviewer as before;
- with the review switch off, no two-lens text renders even when tickets are flagged;
- with no flags, the review section renders as before.

A grounding test shows a flag with a citation outside the collected rule sources is refused with the report.
