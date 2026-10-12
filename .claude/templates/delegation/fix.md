You are fixing review findings on PR #{{pr}} (bead {{bead}}) in the Grill Room app.

The PR branch `{{branch}}` is still checked out in the builder's worktree, so do not check it out by name. In your worktree, run:

```
git fetch origin && git checkout -B fix-{{bead}} origin/{{branch}}
```

Fix exactly these findings, as a new commit:

{{findings}}

The ticket, for context:

{{ticket}}

## How to work

For each finding, write or extend a test that fails without your fix and passes with it. Report each one. A test that encodes a ticket rule may not be changed to match the code. If the rule seems wrong, stop and report. To show it failing, use the Revert block below.

### Revert

```bash
scripts/revert-check.sh '<the Evidence entry test command>'
```

The script reads commits, not the working tree, so commit the change on the worktree branch before running it. Put your own test command in place of the marker, inside the single quotes, and run the line as one plain command from the worktree root. The script moves to the worktree root, reverts every non-test file the branch changes against `origin/main`, runs your command there with `bash -c`, and re-applies the source even when the test fails or the run is interrupted. If the test command needs `grill-room/`, write it as `(cd grill-room && <test command>)`. Inside the command, use only double quotes. The red run is the script's output; the green run is a separate run of the same test command afterwards. A planted-bug line is the exception: its red run is the test with the planted edit applied.

- Test files, snapshots, shell tests named `test-*.sh` and anything under an `e2e/` or `test/` folder stay in place while the source is reverted, so the new test runs against the old source.
- If the test still passes with the source reverted, the line is not proved. Fix the test, never the rule it encodes.
- If the script prints `git apply -R failed` (exit 3) or `git apply failed` (exit 4), stop and report, quoting git's error. Never rebuild the change by hand.
- If the PR changes only test-side files, the patch is empty and the block prints `test-only PR: no source to revert`. The Evidence entry quotes that line and gives the covered ranges.
- Paths containing spaces are not supported.
- Never use `git stash`: the stash stack is shared by every worktree and session.

## Evidence and the PR body

- Re-quote only the Evidence entries whose test or covered ranges changed in this round, and add an entry for each new test.
- Add a line `Round N: <what changed>` under Merge danger only when the blast radius changed. Write N as the round you are in.
- When the findings include a blocker, fix the should-fix items too. A restart after an approval may send should-fix items with no blocker; fix them the same way.
- You may propose that a surviving mutant is equivalent instead of writing a test. Give the mutant and why no test can kill it; the reviewer decides.
- Update the PR body with `gh pr edit {{pr}} --body-file <file>`, where the file's name carries the bead, for example `pr-body-{{bead}}.md`.

## Verify, push and report

Run the ticket's Verify commands in the foreground, and let each one finish before you report. A result that says verification is still running is not a result.

Push to the PR branch as a fast-forward: `git push origin HEAD:{{branch}}`. Never force-push. Keep the PR a draft.

The builder rules in `.claude/templates/delegation/builder.md` also apply: gh account, blocks, processes, ports.

Report the commit, each finding's test, and the exact verification output.
