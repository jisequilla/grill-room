# Handoff: Export by lifetime + ADR drafts

Split Grill Room's export by lifetime, and export ADR-worthy decisions as draft ADRs.

Today export-session writes one bundle into one project export folder: spec.md, decisions.md, intent.md (durable: they explain the system after it is built) next to issues/, HANDOFF.md, briefs/ and the manifest (working files that go stale once the tickets merge). The owner decided the export should not default to .scratch/, which is for impermanent work and is often gitignored, hiding the bundle from worktrees.

Part 1 (gr-0hy): durable files go to the repo's docs folder (e.g. docs/specs/<slug>/), working files go to a tracked .grill-room/<slug>/ with the manifest, so .grill-room/<slug>/ can be deleted after the build without losing anything anyone reads. Touches project settings (two folders, or one folder plus a docs folder), the export plan and manifest (files across two roots), the edited-file guard, visibility checks, HANDOFF paths and briefs.

Part 2 (gr-2f9): on ngine-monitor the architecturally significant decisions (read model, liveness, labels/roles, benchmark semantics) had to be written into an ADR (NMON-019) by a ticket, from scratch. Idea: Grill Room marks each settled decision ADR-worthy or not (significant and costly to reverse vs product/delivery detail), and the export writes draft ADRs in the repo's own convention, detected by the scout (decisions folder, numbering like NMON-###, template), with Status Proposed, Context from the question and evidence, Decision from the answer, Alternatives from the unchosen options and superseded answers, Consequences, and links to the tickets that build it. The building session accepts the drafts when tickets land. Open: one decision per ADR vs bundled (a single NMON-019 bundling read model, liveness and labels makes partial supersession awkward; liveness also amends NMON-012).


This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.

Paths below are relative to the repository root (`/Users/jeremiasdeisequilla/repos/personal/poc-grill-me`). The bundle lives in `.grill-room`, which git tracks.

## Where things are

- Spec: `.grill-room/export-by-lifetime-adr/spec.md`
- Tickets: `.grill-room/export-by-lifetime-adr/issues/`
- Briefs: `.grill-room/export-by-lifetime-adr/briefs/`, one per ticket, grounded and ready to paste as a delegation prompt
- Grill Room session: `a0c5709c-ceab-4024-8a27-bf166754dbaa`

## Verify command

```bash
just check
```

Run from the repository root: once by the subagent before it hands the ticket back, and again by you before you merge it in.

## Before delegating the first ticket

Worktree agents start from `origin/main`, so they see the bundle only once it is committed and pushed. Grill Room never commits in this repository; do it yourself, once, before delegating:

```bash
git add .grill-room/export-by-lifetime-adr
git commit -m "Add the Export by lifetime + ADR drafts handoff bundle"
git push
```

Commit and push again whenever the bundle is re-exported.

## Waves

Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most two at a time. Start a wave only once every ticket of the previous wave is merged and verified.

### Wave 1

- **01 Replace exportFolder with durable and working export roots**
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/01-two-export-roots-settings.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/01-two-export-roots-settings.md`](briefs/01-two-export-roots-settings.md)
- **09 Detect the repo's ADR convention in the scout**
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/09-adr-convention-detection.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/09-adr-convention-detection.md`](briefs/09-adr-convention-detection.md)

### Wave 2

- **02 Migrate existing projects to two roots and re-check visibility** (blocked by 01)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/02-export-root-migration.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/02-export-root-migration.md`](briefs/02-export-root-migration.md)
- **03 Plan and write the export bundle across two roots with one manifest per root** (blocked by 01)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/03-export-plan-two-roots.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/03-export-plan-two-roots.md`](briefs/03-export-plan-two-roots.md)

### Wave 3

- **04 Refuse export on an ignored durable root, warn on an ignored working root** (blocked by 03)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/04-visibility-policy-per-root.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/04-visibility-policy-per-root.md`](briefs/04-visibility-policy-per-root.md)
- **05 Detect a deleted working folder, mark the export retired, gate re-export** (blocked by 03)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/05-retirement-and-reexport.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/05-retirement-and-reexport.md`](briefs/05-retirement-and-reexport.md)
- **06 Add the ADR-worthy flag and consequences to decisions and proposals** (blocked by 03)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/06-adr-worthy-flag-and-consequences.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/06-adr-worthy-flag-and-consequences.md`](briefs/06-adr-worthy-flag-and-consequences.md)

### Wave 4

- **07 Link issues to the decisions they implement** (blocked by 06)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/07-issue-decision-keys.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/07-issue-decision-keys.md`](briefs/07-issue-decision-keys.md)
- **08 Render ADR-worthy mark, Amends target and Consequences in decisions.md** (blocked by 06)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/08-decisions-md-adr-marks.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/08-decisions-md-adr-marks.md`](briefs/08-decisions-md-adr-marks.md)

### Wave 5

- **10 Render one ADR suggestion file per ADR-worthy decision into the working root** (blocked by 07, 08)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/10-adr-suggestion-files.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/10-adr-suggestion-files.md`](briefs/10-adr-suggestion-files.md)

### Wave 6

- **11 Generate the final 'record ADRs' ticket and the HANDOFF convention section** (blocked by 09, 10)
  - Ticket: `.grill-room/export-by-lifetime-adr/issues/11-adr-record-ticket-and-handoff.md`
  - Brief: [`.grill-room/export-by-lifetime-adr/briefs/11-adr-record-ticket-and-handoff.md`](briefs/11-adr-record-ticket-and-handoff.md)

## Delegation lifecycle

Every ticket runs in its own worktree (Agent tool, `isolation: "worktree"`) and reaches `main` only through a pull request you have reviewed and verified. Worktrees are created from `origin/main`, not from local `main`, so work merged only locally is invisible to the next worktree.

### Before launching a ticket

- Local `main` holds nothing unpushed (`git status`, `git log origin/main..main`). Push it first if it does, so the worktree's base includes it.
- The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand. Then paste the whole brief as the delegation prompt.

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
8. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).

## Reviewing a ticket

Every ticket is reviewed by a second, fresh-context agent before it can be merged.

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

Create one bead per ticket. Claim a bead before delegating its ticket, and close it only after you have verified and merged the change, naming the merge in the close comment. Recover state with `bd ready` and `git log`, never from memory.

The repository's declared tracker commands:

- `ready`: `bd ready`
- `claim`: `bd update {id} --claim`
- `close`: `bd close {id}`

## Build records

Log each ticket's outcome in Grill Room once it closes. Run these from the Grill Room app folder (they reach its running dev server); fill in the placeholders.

```bash
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 1 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 2 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 3 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 4 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 5 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 6 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 7 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 8 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 9 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 10 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
pnpm action set-build-record --sessionId a0c5709c-ceab-4024-8a27-bf166754dbaa --ticketNumber 11 --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
```
