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
git fetch origin
P=$(mktemp)
git diff --no-renames --name-only origin/main...HEAD | grep -v -E '\.(test|spec)\.[cm]?[jt]sx?$|\.snap$|(^|/)(e2e|test|__snapshots__)/' | xargs git diff --no-renames --binary origin/main...HEAD -- > "$P"
if [ -s "$P" ]; then
  git apply -R "$P"
  <the Evidence entry's test command>
  git apply "$P"
else
  echo "test-only PR: no source to revert"
fi
```

The block reads commits, not the working tree, so commit the change on the worktree branch before running it. Substitute your own test command for the marker line and run the whole block as one command: shell state, `P` included, does not survive between separate tool calls. A failing test does not stop the block, so the source is always re-applied. Run the block from the worktree root: `git diff --name-only` prints paths from the repo root, but `xargs git diff -- <paths>` reads them relative to the current directory, so from `grill-room/` the block would revert nothing and print the test-only line. If the test command needs `grill-room/`, put the `cd grill-room` in a subshell on the marker line, as `(cd grill-room && <test command>)`. The red run is that command's output between `git apply -R` and `git apply`; the green run is the same command after `git apply`.

- Test files, snapshots and anything under an `e2e/` or `test/` folder stay in place while the source is reverted, so the new test runs against the old source.
- If the test still passes with the source reverted, the line is not proved. Fix the test, never the rule it encodes.
- If `git apply -R` or `git apply` fails, stop and report, quoting the error. Never rebuild the change by hand.
- If the PR changes only test-side files, the patch is empty and the block prints `test-only PR: no source to revert`. The Evidence entry quotes that line and gives the covered ranges.
- Paths containing spaces are not supported.
- Never use `git stash`: the stash stack is shared by every worktree and session.

## Evidence and the PR body

- Re-quote only the Evidence entries whose test or covered ranges changed in this round, and add an entry for each new test.
- Add a line `Round N: <what changed>` under Merge danger only when the blast radius changed. Write N as the round you are in.
- When the findings include a blocker, fix the should-fix items too. Today the workflow passes only blocking findings; gr-g4v.2 reshapes the review schema so that should-fix items reach you. Until then this rule has nothing to act on.
- You may propose that a surviving mutant is equivalent instead of writing a test. Give the mutant and why no test can kill it; the reviewer decides.
- Update the PR body with `gh pr edit {{pr}} --body-file <file>`, where the file's name carries the bead, for example `pr-body-{{bead}}.md`.

Run the ticket's Verify commands in the foreground, and let each one finish before you report. A result that says verification is still running is not a result.

Push to the PR branch as a fast-forward: `git push origin HEAD:{{branch}}`. Never force-push. Keep the PR a draft.

The builder rules in `.claude/templates/delegation/builder.md` also apply: gh account, blocks, processes, ports.

Report the commit, each finding's test, and the exact verification output.
