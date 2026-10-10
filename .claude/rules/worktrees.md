# Delegated Work in Worktrees

Every delegated ticket runs in its own Agent-tool worktree (`isolation: "worktree"`) and reaches `main` only through a pull request that an adversarial reviewer has approved and the main session has verified.

## Why pull requests

The Agent tool creates each worktree from `origin/main`, not from local `main`. Merging on GitHub keeps `origin/main` current, so every new worktree starts from the latest merged work. A ticket merged only locally is invisible to the next worktree, which is how a dependent ticket once started without the helper it was built on.

## The templates

Every delegation uses the templates in `.claude/templates/delegation/`:
- `ticket.md`, for the ticket itself;
- `preflight.md`, `builder.md`, `reviewer.md` and `fix.md`, one for each agent.

A hand-run loop fills them in. A Workflow script receives the filled-in text through `args`, because scripts cannot read files. Both loops send the same words, so neither drifts from the other. The saved workflow `.claude/workflows/ticket-build-review-loop.js` is that script:
- It takes one reviewer template per lens. With more than one lens, the main session marks the PR ready once every lens approves.
- A mutation agent runs `pnpm test:mutate` before every review round, a resumed one included.
- Findings have three levels, `blocker`, `should-fix` and `nit`, and the script routes them: blockers force a fix round, and should-fix items join it only when a blocker already forces one.
- The result returns every should-fix item and nit in `nonBlocking`, for the nits bead the main session files after the merge.
- A fix with no commit but an edited PR body, or a commit with a note, goes to the re-review. The fixer is asked once more only when it reports neither a commit nor a PR-body edit, or its verification is still running.
- A run that stops half way is continued by passing `start` (the PR, branch, stage and last findings), not by resuming, because a resume re-runs every agent after the first changed call.

A ticket's precision comes from examples, not from length:
- A behaviour rule goes in an input → expected-output table, and prose only where an example cannot show it.
- Implementation steps are replaced by a pointer to the existing pattern to copy.
- Each acceptance line names the test that proves it, and that test must fail with the change reverted.
- When a ticket changes both a model prompt and the server check that enforces it, it carries a seam test: every answer shape the prompt describes passes the check.

## Which loop

The workflow is the default for a ticket that is ready. The benchmark's weak point decides the exceptions: a judgment call in the middle of a workflow has nowhere to go (`docs/benchmarks/hand-loop-vs-workflow.md`).

| Bead | Route |
|------|-------|
| A ticket with its behaviour table, cleared by pre-flight | The workflow, with two lenses when it touches a server check, a schema or a model prompt |
| An open owner decision, or a design not yet settled | A grill (in the app or with `/grill-me`) first, then a ticket, then the workflow |
| Debugging with an unknown cause, or a spike | The hand loop, on `opus`, so judgment can enter mid-task |
| Work only the owner can do | No delegation |

Pre-flight, verification on the branch merged with `main`, and the merge stay in the main session in every route. A launch needs the user's typed message naming the tickets: a workflow agent takes the last typed message as its authority and refuses work approved only through the question tool.

## Before launching

- Local `main` holds nothing unpushed. Push it first if it does, so the worktree's base includes it.
- The ticket names the files it builds on. The agent's first step is to confirm they exist. If they do not, it stops and reports rather than recreating them.
- A sonnet pre-flight agent (`preflight.md`) reads the ticket against the code, and the ticket launches only on `PREFLIGHT: clear`. It looks for wrong premises, ambiguities, contradictions, boundary gaps and owner decisions. The owner's decisions are asked for before building, not discovered in review.
- Up to three tickets run at a time. The limit is the main session's attention to relays more than the shared subscription pool.
- `.scratch/` is listed in `.git/info/exclude`, so evidence never shows as untracked. This is a once-per-clone setup step: `grep -qx '.scratch/' .git/info/exclude || echo '.scratch/' >> .git/info/exclude`.

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
- Findings carry a level: `blocker`, `should-fix` or `nit`. Blockers force a fix round. Should-fix items go into a fix round only when a blocker already forces one. A reviewer never creates or edits a bead.
- It posts its verdict as a PR comment (`gh pr comment`): approved, or changes requested with each finding. On approval it runs `gh pr ready <n>`, then reports and stops.
- Changes requested go back to the builder, on the same branch, and the same reviewer reviews again. After two rejected rounds the operator decides.

## The main session

- Merges nothing that is still a draft.
- Reads the PR diff (`gh pr diff <n>`) against the ticket's file boundaries, and the reviewer's verdict.
- Re-runs the verification itself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.
- Sends failures back to the same agent on its branch; the fix lands as a new commit on the same PR.
- If the PR body's Merge danger says `One-way door`, stops, asks in plain text, and merges only after the owner's typed confirmation, as a launch needs. AskUserQuestion is not enough here. A `Two-way door` merges without asking.
- Merges only verified work: `gh pr merge <n> --merge --delete-branch`, then `git pull` on local `main` and re-runs the suite on the merged result before closing the bead. The close comment names the PR.
- Files one nits bead per merged PR, never before the merge. It writes the Workflow tool's returned array to `.scratch/results/<run id>.json`; in a hand loop it writes a JSON array holding one object of the same shape, built from the reviewer's verdict. `scripts/nits-bead.sh` formats the bead, and the steps run as one script (`bash -c`):

  ```bash
  mkdir -p .scratch/results
  # 1. the ticket's object (one per bead) from the saved result array
  jq 'first(.[] | select(.bead == "<bead>"))' .scratch/results/<run id>.json > .scratch/results/<bead>.json
  # 2. format it; a non-zero exit stops here, with nothing filed or deleted
  T=$(mktemp)
  scripts/nits-bead.sh .scratch/results/<bead>.json > "$T" || { echo "nits-bead.sh failed"; exit 1; }
  # 3. file it only when there is something to file
  if [ -s "$T" ]; then
    bd create --type=task --priority=3 --labels=pr-nits --title "$(sed -n 1p "$T")" --description "$(sed -n '3,$p' "$T")"
  fi
  rm -f "$T"
  ```

- Cleans up evidence. When the helper exited 0 with empty stdout, so no bead was filed, it deletes the main checkout's `.scratch/evidence/<bead>/` right after the merge. When the helper exited non-zero, it stops and reports: it files nothing and deletes nothing. Otherwise it deletes the folder when that PR's nits bead closes.
- Removes merged worktrees with `just prune-worktrees`.
