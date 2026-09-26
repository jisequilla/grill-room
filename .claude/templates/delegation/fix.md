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

For each finding, write or extend a test that fails without your fix and passes with it. Report each one. A test that encodes a ticket rule may not be changed to match the code. If the rule seems wrong, stop and report. To show it failing, revert with a temporary commit or a copy of the file, never `git stash`.

Run the ticket's Verify commands in the foreground, and let each one finish before you report. A result that says verification is still running is not a result.

Push to the PR branch as a fast-forward: `git push origin HEAD:{{branch}}`. Never force-push. Keep the PR a draft.

The builder rules in `.claude/templates/delegation/builder.md` also apply: gh account, blocks, processes, ports.

Report the commit, each finding's test, and the exact verification output.
