You are implementing bead {{bead}} in the Grill Room app (`grill-room/` in this repo). Read `grill-room/AGENTS.md` first.

{{ticket}}

## How to work

- **Check what you build on.** Before anything else, confirm that every file and symbol under "Builds on" exists. If one does not, stop and report.
- **Follow the ticket.** The Behaviour table is the spec, and "Pattern to copy" shows how the code should look.
- **Prove each acceptance line.** For every numbered line, write the test it names. Then run that line's test with the PR's source reverted by the Revert block below (the block reverts every non-test file the PR changes), confirm the test fails, and confirm it passes again once the source is re-applied. Report the result per line.
- **Prove a planted-bug line by planting it.** When an acceptance line names a planted bug, do not use the Revert block for it. Commit the change first. Then apply that edit in your working tree without committing it, run the line's test and confirm it fails on its own assertion, then undo the edit with `git checkout -- <file>` and run the test again. The Evidence entry quotes the planted edit as a diff, the red run and the green run.
- **Keep the ticket's rules in the tests.** A test that encodes a ticket rule may not be changed to match the code. If the rule seems wrong, stop and report.
- **Stay in scope.** Keep the change inside the ticket's Files. A minimal edit elsewhere is allowed only if the PR body names the file and says why.
- **Screenshot UI changes.** When the ticket changes what the user sees, add before and after screenshots.
  - Write a one-off script that imports `chromium` from `@playwright/test`. `playwright-core` is not resolvable from `grill-room/` under pnpm, and `agent-browser`'s screenshot command fails in this environment.
  - Run it against your own server on a free port, with `AUTH_DISABLED`, the fake interviewer and an isolated `DATABASE_URL`.
  - Take "before" by running your screenshot script as the Revert block's test command, and "after" by running it again once the block finishes.
  - Save the PNGs under `.scratch/evidence/<bead id>/` in the main checkout, by absolute path. The main checkout's path is the first `worktree` line of `git worktree list --porcelain`. Your worktree's own `.scratch/` is deleted when it is pruned after merge.
  - Commit no PNG: `git status` must show none.
- **Run verification in the foreground.** Run each Verify command to completion before you report. Never start one in the background and report while it is still running.

### Revert

```bash
scripts/revert-check.sh '<the Evidence entry test command>'
```

The script reads commits, not the working tree, so commit the change on the worktree branch before running it. Put your own test command in place of the marker, inside the single quotes, and run the line as one plain command from the worktree root. The script moves to the worktree root, reverts every non-test file the branch changes against `origin/main`, runs your command there with `bash -c`, and re-applies the source even when the test fails or the run is interrupted. If the test command needs `grill-room/`, write it as `(cd grill-room && <test command>)`. Inside the command, use only double quotes. The red run is the script's output; the green run is a separate run of the same test command afterwards. A planted-bug line is the exception: its red run is the test with the planted edit applied.

- Test files, snapshots and anything under an `e2e/` or `test/` folder stay in place while the source is reverted, so the new test runs against the old source.
- If the test still passes with the source reverted, the line is not proved. Fix the test, never the rule it encodes.
- If the script prints `git apply -R failed` (exit 3) or `git apply failed` (exit 4), stop and report, quoting git's error. Never rebuild the change by hand.
- If the PR changes only test-side files, the patch is empty and the block prints `test-only PR: no source to revert`. The Evidence entry quotes that line and gives the covered ranges.
- Paths containing spaces are not supported.
- Never use `git stash`: the stash stack is shared by every worktree and session.

## Delivery

Push with exactly `git push -u origin <your branch>`, where the branch is the worktree branch you are on (it starts with `worktree-`); that form is pre-approved, other forms may be blocked. Then open a DRAFT PR against main with `gh pr create --draft --title "{{title}}" --body-file <file>`, where the file's name carries the bead id (for example `pr-body-{{bead}}.md`): builders share the scratchpad, and a generic name has overwritten another builder's body. The body opens with three sections, in this order:
- `## Summary`: the smallest of a diff sketch, a call tree, a file tree or a Mermaid diagram that shows the change's shape. One, never more.
- `## Evidence`: one entry per numbered acceptance line. Each entry gives the acceptance number, the test file and test name, the source ranges the test covers (written as under "Evidence ranges" below), the quoted red run and the quoted green run. For a test-only PR, the entry quotes that line from the Revert block and gives the covered ranges. For a UI change, it also names the absolute folder of the screenshots and the exact command that regenerates them. For a planted-bug line, the red run is the run with the planted edit applied, and the entry quotes that edit as a diff.
- `## Merge danger`: `One-way door` or `Two-way door`, plus the blast radius: what else reads or depends on what changed. A database migration is always a one-way door. A migration plus a UI toggle is a one-way door; a UI toggle alone, or a prompt's wording alone, is a two-way door.

Then the body lists:
- the bead;
- the files changed, with any file outside the ticket's Files named and justified;
- the exact output of each verify command;
- anything the ticket left ambiguous.

The red run alone is TDD proof; there is no rule about commit order.

### Evidence ranges

Write each covered range as `<path>:<start>-<end>`, with the path relative to the repository root: `grill-room/server/a.ts:10-20`, never `a.ts:10-20`. A single line N is `N-N`. One range names one file; for two ranges in one file, write the path twice, comma-separated. A file outside `grill-room/` is written from the repository root in the same shape; mutation testing covers only `grill-room/`, so such a range is never mutated, which is expected.

| Range as written | Accepted |
|---|---|
| `grill-room/server/a.ts:10-20` | yes |
| `grill-room/server/a.ts:7-7` | yes |
| `grill-room/server/a.ts:10-20,grill-room/server/a.ts:40-52` | yes |
| `.claude/workflows/ticket-build-review-loop.js:102-107` | yes |
| `grill-room/server/a.ts:7` | no |
| `brief-grounding.ts:701-705` | no |
| `:663-667` | no |
| `grill-room/x.ts:1-5,9-12` | no |
| `/Users/me/repo/grill-room/x.ts:1-5` | no |

Rules (from `.claude/rules/worktrees.md`):
- Commit only on your worktree branch. Never touch main, and never merge.
- Before each gh call, run `gh auth switch -u jisequilla && gh api user --jq .login` in the same command. It must print `jisequilla`.
- Avoid a colon followed by quotes in gh arguments.
- If any command is blocked by a hook or the permission classifier, stop. Report the exact command and message, and never work around the block.
- Stop only processes you started, by their recorded PID. Never use `pgrep`, `pkill`, `killall`, `just stop` or `just restart`. Never use port 8082 or the claude-in-chrome tools. Other builders run their own servers at the same time. A server you did not record when you started it is theirs, not an orphan: report it, and never stop it.
- If `node_modules` is missing, run `(cd grill-room && pnpm install --frozen-lockfile)` first.
- Never pass `--pm-on-fail` to pnpm. If pnpm says the project is configured to use a different pnpm version, stop and report the message: another pnpm version rewrites `grill-room/pnpm-workspace.yaml`.

Report the PR number and branch, then stop.
