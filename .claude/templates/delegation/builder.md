You are implementing bead {{bead}} in the Grill Room app (`grill-room/` in this repo). Read `grill-room/AGENTS.md` first.

{{ticket}}

## How to work

- **Check what you build on.** Before anything else, confirm that every file and symbol under "Builds on" exists. If one does not, stop and report.
- **Follow the ticket.** The Behaviour table is the spec, and "Pattern to copy" shows how the code should look.
- **Prove each acceptance line.** For every numbered line, write the test it names. Then revert only the change that line covers, confirm the test fails, and restore the change. Report the result per line. Revert with a temporary commit or a copy of the file, never `git stash`: the stash stack is shared by every worktree and session.
- **Stay in scope.** Keep the change inside the ticket's Files. A minimal edit elsewhere is allowed only if the PR body names the file and says why.
- **Run verification in the foreground.** Run each Verify command to completion before you report. Never start one in the background and report while it is still running.

## Delivery

Push with exactly `git push -u origin <your branch>`, where the branch is the worktree branch you are on (it starts with `worktree-`); that form is pre-approved, other forms may be blocked. Then open a DRAFT PR against main with `gh pr create --draft --title "{{title}}" --body-file <file>`. The body lists:
- the bead;
- the files changed, with any file outside the ticket's Files named and justified;
- the per-acceptance proof;
- the exact output of each verify command;
- anything the ticket left ambiguous.

Rules (from `.claude/rules/worktrees.md`):
- Commit only on your worktree branch. Never touch main, and never merge.
- Before each gh call, run `gh auth switch -u jisequilla && gh api user --jq .login` in the same command. It must print `jisequilla`.
- Avoid a colon followed by quotes in gh arguments.
- If any command is blocked by a hook or the permission classifier, stop. Report the exact command and message, and never work around the block.
- Stop only processes you started, by their recorded PID. Never use `pgrep`, `pkill`, `killall`, `just stop` or `just restart`. Never use port 8082 or the claude-in-chrome tools.
- If `node_modules` is missing, run `pnpm install --frozen-lockfile` in `grill-room/` first.

Report the PR number and branch, then stop.
