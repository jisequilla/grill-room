# Delivery recipe and the review gate

Status: ready-for-agent

## Problem Statement

The exported HANDOFF.md tells the building session how each ticket reaches the main branch. It always gives the same recipe, the one this repository uses:
1. Build the ticket in a worktree.
2. Push the branch.
3. Open a pull request with `gh`.
4. Merge on the forge.

The recipe is pasted whole into every project. When a session was exported into a repository with no remote, the handoff told the building session to push and open pull requests that could not exist.

The recipe also leaves review to a single reader. The main session wrote the delegation prompt, then reviews the diff against what it meant, not against the spec. Nothing independent checks a ticket against its acceptance criteria before it merges.

## Solution

Each project has a delivery recipe:
- **Pull request:** for repositories with a remote.
- **Local merge:** for repositories without one. Each ticket is still built on a worktree branch, but it reaches main with a local `git merge`: no push, no forge.

A new project's recipe is guessed from its git remotes, and the user can change it. HANDOFF.md renders the fixed template for the project's recipe.

Both recipes carry an adversarial review gate, on by default and switchable per project. Before a ticket merges, the building session sends a second, fresh-context reviewer. The reviewer sees only the spec, the ticket, its brief and the diff, never the builder's report, and tries to break the change.

The verdict is recorded where the recipe allows it:
- **Pull request:** the builder opens the pull request as a draft. The reviewer comments with its verdict and marks the pull request ready on approval.
- **Local merge:** the verdict goes on the ticket.

The main session merges only approved work, and still re-runs the verification itself.

## User Stories

1. As a session owner, I want each project to have a delivery recipe, so that the handoff describes how work actually reaches that project's main branch.
2. As a session owner, I want a new project's recipe guessed from its git remotes, so that I rarely have to choose.
3. As a session owner, I want a repository with a remote to default to pull request, so that projects on a forge keep the reviewed-PR flow.
4. As a session owner, I want a repository with no remote to default to local merge, so that the handoff never asks for a push or a pull request that cannot exist.
5. As a session owner, I want to change a project's recipe in its settings, so that I decide when the guess is wrong.
6. As an existing user, I want projects registered before this feature to keep the pull request recipe, so that nothing changes for them.
7. As a building session, I want the pull request recipe to tell me to open each pull request as a draft, so that unreviewed work cannot be merged by mistake.
8. As a building session, I want the local merge recipe to tell me to review and verify a worktree branch, then merge it into main locally, so that I can deliver without a forge.
9. As a building session, I want the local merge recipe to tell me to commit on main before delegating, so that each new worktree starts from the latest merged work.
10. As a session owner, I want an adversarial review gate on by default, so that every ticket is checked against its spec by someone other than its builder.
11. As a session owner, I want to switch the review gate off per project, so that tiny repositories do not pay for an extra agent per ticket.
12. As a building session, I want HANDOFF.md to include a "Reviewing a ticket" section when the gate is on, so that I know how to brief the reviewer.
13. As a reviewer, I want only the spec, the ticket, its brief and the diff, so that I judge the change against what was asked, not against the builder's account of it.
14. As a reviewer, I want to be told what to try to break, so that my review is adversarial and not a summary: unmet acceptance criteria, changes outside the file boundaries, untested edge cases, seams with the tickets this one builds on, and claims in the pull request the diff does not support.
15. As a reviewer on the pull request recipe, I want to post my verdict as a comment and mark the pull request ready only on approval, so that the forge shows the gate's state.
16. As a reviewer on the local merge recipe, I want to record my verdict on the ticket, so that the gate works without a forge.
17. As a session owner, I want an approval to be the draft becoming ready, not a forge review, so that the gate works when every agent pushes as the same account, which the forge will not let approve its own pull request.
18. As a building session, I want changes requested to go back to the builder on the same branch and be reviewed again, so that fixes are checked by the same standard.
19. As a session owner, I want the operator to decide after two rejected review rounds, so that a ticket never loops forever.
20. As a building session, I want the recipe to say the main session never merges a draft or an unapproved branch, so that the gate cannot be skipped by accident.
21. As a building session, I want the recipe to keep the rule that the main session re-runs verification before merging, so that the review never replaces evidence.
22. As a building session, I want the recipe to stay a fixed template, so that no model ever writes the git workflow.
23. As a building session, I want HANDOFF.md to carry no copy of the project's own rules, so that nothing duplicates what the project already loads into my context.
24. As an agent, I want the project actions to read and set the recipe and the review switch, so that I can do what the settings screen does.
25. As a developer, I want each recipe's HANDOFF.md text pinned by tests at the pure renderer, so that a template change is visible in review.

## Implementation Decisions

- **Two new project settings:**
  - `deliveryRecipe`: `pull-request` or `local-merge`.
  - `adversarialReview`: a boolean, default true.
  - Both are additive columns. Existing rows migrate to `pull-request` and review on.
- **Registration** sets the recipe from the repository's remotes, using the read-only git wrapper, when the caller gives none: any remote means `pull-request`, none means `local-merge`. Updating a project can change either setting. Both appear wherever project settings are shown and edited.
- **The pure handoff renderer** selects the "before delegating" and "delegation lifecycle" sections by recipe:
  - **Pull request:** today's text, with the pull request opened as a draft and the rule that a draft is never merged.
  - **Local merge:** commit on main before delegating; each ticket on its worktree branch; the main session reads the branch diff, re-runs verification, and merges locally after approval; the verdict is recorded on the ticket per the project's tracker.
- **"Reviewing a ticket" section.** When the review switch is on, the renderer adds this one fixed section to HANDOFF.md. It covers:
  - the reviewer's inputs;
  - what to try to break;
  - how to record the verdict per recipe;
  - the same-branch fix loop and the two-round cap.
  When the switch is off, the section is absent and the lifecycle text has no review step.
- **Staleness.** Both settings join the handoff's fingerprint, so changing either marks an existing handoff stale, like the other project fields.
- **No model is involved.** The templates are fixed text with project values filled in.

## Testing Decisions

- Good tests assert the rendered HANDOFF.md text and the stored project fields, never internal helpers.
- **Handoff renderer** (the existing pure tests), with exact text for:
  - the pull request recipe with review on;
  - the pull request recipe with review off;
  - the local merge recipe with review on;
  - the local merge recipe with review off.
- **Project actions** (the existing temp-git-repo tests): registration defaults the recipe from remotes (with and without a remote), an explicit recipe wins, update changes both settings, and existing rows read as pull request with review on.
- **Handoff staleness:** changing either setting marks the handoff stale.

## Out of Scope

- The handoff scout that fills the briefs: its own spec, `.scratch/handoff-scout/`.
- Copying the project's own rules into HANDOFF.md.
- A forge-side approval or required reviews: the forge refuses approvals from a pull request's author.
- Running the reviewer from Grill Room: Grill Room writes the recipe, and the building session runs it.

## Further Notes

- This repository adopted the same gate in its own worktree rule before this spec, so the recipe Grill Room writes is the one being used to build it.
