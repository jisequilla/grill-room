# Handoff: Depth and technical level before the grill

## Problem Statement

Grill Room was built for one technical Idea owner who makes the technology calls and wants an exhaustive interview. Its second real user is not technical, will not say what to build, and does not always want a full spec. Nothing in the session, the schema or the interviewer's instructions records how deep to grill or how technical the owner is, so every owner gets the same technical, full-length interview. A non-technical owner meets cards they cannot answer and a grill that does not stop where their ambition stops. A technical owner cannot ask for a quick proof of concept without being grilled as if for a full spec.

## Solution

Grill Room captures two values and pitches the interview to both. Technical level is a trait of the one Idea owner role, stored once per signed-in owner in an owner profile. Depth is a property of each session, chosen when the idea is opened. A setup step at session creation, before readiness runs, asks depth and shows the level pre-filled for correction. Both can be changed at any round and apply from the next one. The interviewer, including Sharpening, reads both every turn: depth decides which branches open and when done is proposed; level decides card wording, how recommendations are phrased, and whether technology choices default to the builder. Readiness and the spec check read depth so a proof-of-concept owner is neither warned about full-spec gaps nor nagged about decisions they chose to leave to the builder.

## The original idea, before the interview

Grill Room should let the Idea owner say how deep to grill and how technical they are, and pitch the interview to both.

Today nothing in the session, the schema or the interviewer's instructions records either. Grill Room was built for a technical owner; its second real user is not technical, will not tell the interviewer what to build, and asked to be asked their technical level up front and how big to go: a quick proof of concept or a full spec.

Ground truth is the knowledge/ bundle in this repo. Read knowledge/context-map.md, knowledge/interview/index.md (use its Terms: "readiness", never "preflight"), knowledge/product/roles/idea-owner.md, knowledge/product/decisions/one-idea-owner-technical-level-is-a-trait.md and knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md. Technical level is a trait of the one Idea owner role, not a second role.

What needs settling:
- Where and when depth and technical level are asked: once per owner at first setup, per session, or inside readiness or Sharpening (see knowledge/interview/decisions/ for both), and whether either can change mid-session.
- What each value is: the scale or choices for depth and for technical level, and the default when the owner skips it.
- What they change in the interview: which questions get asked, how cards are worded, how many rounds, when the interviewer proposes being done, what the recommendation looks like for a non-technical owner who will not choose the technology.
- What they change downstream, if anything: readiness, the spec, the tickets, the handoff.
- Who answers the technical questions a non-technical owner cannot: builder's calls (knowledge/interview/language/builders-call.md), the interviewer's recommendation, or something else.

## Where things are

This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.

Paths below are relative to the repository root (`/Users/jeremiasdeisequilla/repos/personal/poc-grill-me`). The bundle lives in `.grill-room`, which git tracks.

- Spec: `docs/specs/depth-and-technical-level/spec.md`
- Tickets: `.grill-room/depth-and-technical-level/issues/`
- Briefs: `.grill-room/depth-and-technical-level/briefs/`, one per ticket except the ADR ticket, grounded and ready to paste as a delegation prompt
- Grill Room session: `73896582-d9fc-4c3c-bf82-c20106c906f2`

## Verify command

```bash
just check
```

Run from the repository root: once by the subagent before it hands the ticket back, and again by you before you merge it in.

## Before delegating the first ticket

Worktree agents start from `origin/main`, so they see the bundle only once it is committed and pushed. Grill Room never commits in this repository; do it yourself, once, before delegating:

```bash
git add docs/specs/depth-and-technical-level .grill-room/depth-and-technical-level
git commit -m "Add the Depth and technical level before the grill handoff bundle"
git push
```

Commit and push again whenever the bundle is re-exported.

## Execution plan

- Longest chain: 5 build tickets, built one after another: 01 → 02 → 04 → 05 → 09.
- Wave widths, in build tickets: 2, 2, 2, 2, 1 (wave 1 first).
- Run at most 3 tickets at a time, even when a wave is wider. The repository sets this cap: `.claude/rules/worktrees.md:44`. Every ticket in flight draws on the same subscription's rate limit, and a rate-limited failure reads like a failed ticket; each one's reports also need your attention before it can merge.

## Waves

Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most 3 at a time. Start a wave only once every ticket of the previous wave is merged and verified.

- Ticket 06 waits for ticket 03: both change `grill-room/server/interviewer/prompt.ts` and `grill-room/server/interviewer/types.ts`.
- Ticket 07 waits for ticket 06: both change `grill-room/server/interviewer/prompt.ts` and `grill-room/server/interviewer/types.ts`.

### Wave 1

- **01 Owner profile table, session owner reference, depth columns and migration**
  - Ticket: `.grill-room/depth-and-technical-level/issues/01-owner-profile-schema-and-session-columns.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/01-owner-profile-schema-and-session-columns.md`](briefs/01-owner-profile-schema-and-session-columns.md)
- **08 Record the decisions in the knowledge bundle and an ADR**
  - Ticket: `.grill-room/depth-and-technical-level/issues/08-knowledge-bundle-and-adr.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/08-knowledge-bundle-and-adr.md`](briefs/08-knowledge-bundle-and-adr.md)

### Wave 2

- **02 Resolve the current owner and hand local sessions and level to the inheriting user** (blocked by 01)
  - Ticket: `.grill-room/depth-and-technical-level/issues/02-current-owner-and-migrated-inheritance.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/02-current-owner-and-migrated-inheritance.md`](briefs/02-current-owner-and-migrated-inheritance.md)
- **03 Readiness takes depth; Sharpening takes depth and level** (blocked by 01)
  - Ticket: `.grill-room/depth-and-technical-level/issues/03-readiness-and-sharpening-read-depth-and-level.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/03-readiness-and-sharpening-read-depth-and-level.md`](briefs/03-readiness-and-sharpening-read-depth-and-level.md)

### Wave 3

- **04 Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking** (blocked by 01, 02, 03)
  - Ticket: `.grill-room/depth-and-technical-level/issues/04-depth-and-level-actions.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/04-depth-and-level-actions.md`](briefs/04-depth-and-level-actions.md)
- **06 Interviewer prompt pitched to depth and technical level** (blocked by 01)
  - Ticket: `.grill-room/depth-and-technical-level/issues/06-prompt-builder-depth-and-level.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/06-prompt-builder-depth-and-level.md`](briefs/06-prompt-builder-depth-and-level.md)

### Wave 4

- **05 Setup step at session creation and the mid-grill settings control** (blocked by 01, 04)
  - Ticket: `.grill-room/depth-and-technical-level/issues/05-setup-step-and-settings-control-ui.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/05-setup-step-and-settings-control-ui.md`](briefs/05-setup-step-and-settings-control-ui.md)
- **07 Spec names the depth and the spec check scales its builder-alone bar** (blocked by 01)
  - Ticket: `.grill-room/depth-and-technical-level/issues/07-spec-check-depth-bar.md`
  - Brief: [`.grill-room/depth-and-technical-level/briefs/07-spec-check-depth-bar.md`](briefs/07-spec-check-depth-bar.md)

### Wave 5

- **09 Record ADRs from suggestions** (blocked by 01, 02, 03, 04, 05, 06, 07, 08; self-contained: delegate it from its ticket file; it has no brief)
  - Ticket: `.grill-room/depth-and-technical-level/issues/09-record-adrs-from-suggestions.md`

## Recording the repo's ADRs

Grill Room wrote one suggestion per ADR-worthy decision in `.grill-room/depth-and-technical-level/adr-suggestions/`. Ticket 09 records them as the repo's own ADRs, last, once every other ticket has merged.

Detected convention, a hint to check against the folder: ADRs live in `docs/adr/`, named like `0002-mutation-run-as-a-workflow-step.md`; the next free number looks like `0003`. The newest ADR's sections are Context, Decision, Alternatives, Consequences, Tickets (from `docs/adr/0002-mutation-run-as-a-workflow-step.md`).

Close ticket 09 before the working folder is deleted: the suggestions are deleted with it.

## Questions the spec and tickets leave open

The consistency check found these statements, which leave a builder to decide something the owner never decided. Before delegating a ticket a question quotes, get the owner's answer and put it in the delegation prompt; the question is also in that ticket's brief. Answer the rest before calling the feature done.

- When the owner changes technical level after done has been proposed or a spec exists, is the done proposal withdrawn and the spec marked stale as for depth, or does level only affect wording from the next round? (spec, Implementation Decisions: "After done has been proposed, a depth change withdraws the done proposal and reopens the frontier at the new depth.")
- If the working turn that the depth change queued behind is the one producing round 1, so the session has rounds when it ends, is the pending depth applied without a re-judge, applied with a re-judge, or discarded? (ticket 04: "when a pre-round-1 turn finishes and `pendingDepth` is set, move it to `depth`, clear it and the override, and run one re-judge.")
- When later local sessions are reassigned to the recorded inheritor, does a technical level set on the recreated local profile also move to the inheritor if theirs is empty, and is the local profile row deleted again? (ticket 02: "reassign them to the recorded inheritor.")
- Is a level pick in the setup step saved to the profile the moment it is picked, or only when the session is created, so that picking a level and then cancelling or skipping leaves the profile untouched? (ticket 05: "A level pick writes through `set-owner-technical-level`.")
- When depth changes after a spec exists, are the builder briefs and handoff also marked stale, or only the spec, its check and the tickets? (spec, Implementation Decisions: "the spec, its consistency check and the tickets are marked stale")

## Delegation lifecycle

Every ticket runs in its own worktree (Agent tool, `isolation: "worktree"`) and reaches `main` only through a pull request you have reviewed and verified. Worktrees are created from `origin/main`, not from local `main`, so work merged only locally is invisible to the next worktree.

Where this lifecycle differs from the repository's own rules, the repository's rule wins: `.claude/rules/worktrees.md`.

### Before launching a ticket

- Local `main` holds nothing unpushed (`git status`, `git log origin/main..main`). Push it first if it does, so the worktree's base includes it.
- The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand. Then paste the whole brief as the delegation prompt.
- Pre-flight the ticket before launching it, following the repository's own procedure at `.claude/rules/worktrees.md:43`. Launch the ticket only when that procedure clears it.

### The subagent

- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.
- Runs `just check`; it must pass.
- Checks `gh auth status`. If the active account is not the one this repository expects, it stops before pushing and reports "push pending: gh account" with its commit hash.
- Otherwise pushes its branch (`git push -u origin HEAD`) and opens a **draft** pull request against `main` with `gh pr create --draft`. The title names the ticket; the body carries the ticket path, files changed, the exact verification output, and anything the brief left ambiguous.
- Reports the PR, then stops. It never merges, and a draft is never merged by anyone.

### You, the main session

1. Read the PR diff (`gh pr diff <n>`) against the brief's file boundaries.
2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below) and wait for its verdict comment on the pull request.
3. Once the reviewer approves and marks the pull request ready, re-run `just check` yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.
4. If it fails, run `gh pr ready --undo <n>` to put the pull request back in draft, then send the failure back to the same agent on its branch; the fix lands as a new commit on the same PR, and goes back to the reviewer.
5. Merge only a ready, approved pull request whose re-verification in step 3 has passed: `gh pr merge <n> --merge --delete-branch`. Never merge a draft.
6. `git pull` on local `main` and re-run `just check` on the merged result.
7. Close the ticket's bead with a comment naming the PR.
8. Prune merged worktrees with the repository's command: `just prune-worktrees` (`.claude/rules/worktrees.md:86`).

## Reviewing a ticket

Every ticket is reviewed by a second, fresh-context agent before it can be merged.

**The repository's review rule.** `.claude/rules/worktrees.md:75` sets how this repository reviews tickets; where it differs from this section, it wins.

**Two lenses.** These tickets get two reviewers instead of one, each with fresh context and its own lens, because the repository's review rule says so for them:

- **01 Owner profile table, session owner reference, depth columns and migration** (`.claude/rules/worktrees.md:81`)
- **03 Readiness takes depth; Sharpening takes depth and level** (`.claude/rules/worktrees.md:81`)
- **06 Interviewer prompt pitched to depth and technical level** (`.claude/rules/worktrees.md:81`)
- **07 Spec names the depth and the spec check scales its builder-alone bar** (`.claude/rules/worktrees.md:81`)

Each of the two reviewers takes one lens:

- **Correctness lens.** Tries to break the change against the spec and the ticket: every example the ticket gives, the seams with the tickets it builds on, files changed outside its boundaries, and claims the diff does not support.
- **Tests lens.** Checks that every acceptance criterion has a test that fails with its change reverted, that every example the ticket gives is tested, and, when the change touches both a model prompt and the check that enforces it, that a seam test shows every answer the prompt describes passes the check.

For these tickets, neither reviewer runs `gh pr ready`: you mark the pull request ready once both approve, and merge only then.

**Inputs.** The reviewer gets the spec, the ticket, its delegation brief and the diff — never the builder's report.

**What to try to break.** Unmet acceptance criteria, changes outside the file boundaries, untested edge cases, seams with the tickets this one builds on, and claims the diff does not support.

**Verdict.** It posts its verdict as a pull request comment, starting "Review verdict: approved" or "Review verdict: changes requested" with each finding, then runs `gh pr ready <n>` on approval.

**Changes requested.** They go back to the builder on the same branch, and the same reviewer reviews again. After two rejected rounds, the operator decides.

The reviewer changes no code and never merges.

## What to record per ticket

When a ticket closes, record:

- the model the subagent ran on;
- whether its first attempt passed verification;
- whether it escalated to a stronger model;
- what the delegation prompt was missing, when an attempt failed.

An escalation is the most useful data point: it shows where the brief, not the model, was the weak link.

## Tracking with beads

Create one bead per ticket. Claim a bead before delegating its ticket, and close it only after you have verified and merged the change, naming the merge in the close comment. Recover state with `bd ready` and `git log`, never from memory. Ticket 09, Record ADRs from suggestions, gets a bead like every other ticket.

The repository's declared tracker commands:

- `ready`: `bd ready`
- `claim`: `bd update {id} --claim`
- `close`: `bd close {id}`

## Build records

Log each ticket's outcome in Grill Room once it closes. Run this command from the Grill Room app folder (it reaches its running dev server), once per ticket: set `<ticket-number>` to the ticket's number and fill in the other placeholders.

```bash
pnpm action set-build-record --sessionId 73896582-d9fc-4c3c-bf82-c20106c906f2 --ticketNumber <ticket-number> --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
```

Ticket 09 records the repo's ADRs and gets no build record: it is not stored in Grill Room, so `set-build-record` refuses its number.
