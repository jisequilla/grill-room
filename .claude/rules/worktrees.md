# Delegated Work in Worktrees

Every delegated ticket runs in its own Agent-tool worktree (`isolation: "worktree"`) and reaches `main` only through a pull request that an adversarial reviewer has approved and the main session has verified.

## Why pull requests

The Agent tool creates each worktree from `origin/main`, not from local `main`. Merging on GitHub keeps `origin/main` current, so every new worktree starts from the latest merged work. A ticket merged only locally is invisible to the next worktree, which is how a dependent ticket once started without the helper it was built on.

## The templates

Every delegation uses the templates in `.claude/templates/delegation/`:
- `ticket.md`, for the ticket itself;
- `preflight.md`, `builder.md`, `reviewer.md` and `fix.md`, one for each agent.

A hand-run loop fills them in. A Workflow script receives the filled-in text through `args`, because scripts cannot read files. Both loops send the same words, so neither drifts from the other.

A ticket's precision comes from examples, not from length:
- A behaviour rule goes in an input → expected-output table, and prose only where an example cannot show it.
- Implementation steps are replaced by a pointer to the existing pattern to copy.
- Each acceptance line names the test that proves it, and that test must fail with the change reverted.
- When a ticket changes both a model prompt and the server check that enforces it, it carries a seam test: every answer shape the prompt describes passes the check.

## Before launching

- Local `main` holds nothing unpushed. Push it first if it does, so the worktree's base includes it.
- The ticket names the files it builds on. The agent's first step is to confirm they exist. If they do not, it stops and reports rather than recreating them.
- A sonnet pre-flight agent (`preflight.md`) reads the ticket against the code, and the ticket launches only on `PREFLIGHT: clear`. It looks for wrong premises, ambiguities, contradictions, boundary gaps and owner decisions. The owner's decisions are asked for before building, not discovered in review.
- Up to three tickets run at a time. The limit is the main session's attention to relays more than the shared subscription pool.

## The subagent

- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.
- Runs the verification the prompt names in the foreground, and reports only once every command has finished. For grill-room that is `pnpm test` and `pnpm typecheck` from `grill-room/`, plus `just e2e` when the ticket touches the UI.
- Proves each acceptance line by reverting the change it covers, watching its test fail, and restoring it.
- Keeps inside the ticket's files. A minimal edit elsewhere is allowed only when the PR body names the file and says why it was needed.
- Pushes its branch and opens a **draft** pull request against `main` with `gh pr create --draft`. The title names the bead (`gr-xxx: <summary>`); the body carries the ticket path, files changed, the exact verification output, and anything the prompt left ambiguous. `gh` must be on the `jisequilla` account.
- Reports the PR number, then stops. It never merges.
- Stops only processes it started, by the PID it recorded when starting them. It never finds processes by name (`pgrep`, `pkill`, `killall`) or runs `just stop`/`just restart`: the user's own dev server runs the same command line and has been killed that way.

## Browser checks

A ticket that changes what the user sees is checked in two ways, and the delegation prompt names both.

- The agent looks at its own screens with `agent-browser`, against its worktree's own server on a free port with `AUTH_DISABLED`, the fake interviewer and an isolated `DATABASE_URL`, never the user's server or database. It never uses the claude-in-chrome tools, which drive the user's own Chrome.
- The agent adds or extends a Playwright scenario under `grill-room/e2e/` for the behaviour it built, so `just e2e` guards it from then on. An exploratory check that finds a defect becomes a scenario.

## The reviewer

Every PR is reviewed by a second agent before it can be merged. GitHub refuses an approval from the PR's own author, and every agent pushes as `jisequilla`, so the approval is the draft becoming ready, not a GitHub review.

- The main session launches it on `opus`, with fresh context: the spec, the ticket, the delegation prompt's acceptance criteria and the PR number. It never gets the builder's report.
- It reads `gh pr diff <n>` and tries to break the change against the spec. It changes no code. It looks for:
  - wrong premises in the ticket;
  - acceptance lines whose test still passes with the change reverted;
  - rows of the behaviour table the change gets wrong;
  - a missing seam test;
  - files outside the ticket that the PR body does not name;
  - claims in the PR body the diff does not support.
- A reviewer is stochastic: the same commit reviewed twice has produced different real findings. A ticket that touches a server check, a schema or a model prompt therefore gets two reviewers with different lenses, one on correctness and one on tests. Every other ticket gets one.
- It posts its verdict as a PR comment (`gh pr comment`): approved, or changes requested with each finding. On approval it runs `gh pr ready <n>`, then reports and stops.
- Changes requested go back to the builder, on the same branch, and the same reviewer reviews again. After two rejected rounds the operator decides.

## The main session

- Merges nothing that is still a draft.
- Reads the PR diff (`gh pr diff <n>`) against the ticket's file boundaries, and the reviewer's verdict.
- Re-runs the verification itself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.
- Sends failures back to the same agent on its branch; the fix lands as a new commit on the same PR.
- Merges only verified work: `gh pr merge <n> --merge --delete-branch`, then `git pull` on local `main` and re-runs the suite on the merged result before closing the bead. The close comment names the PR.
- Removes merged worktrees with `just prune-worktrees`.
