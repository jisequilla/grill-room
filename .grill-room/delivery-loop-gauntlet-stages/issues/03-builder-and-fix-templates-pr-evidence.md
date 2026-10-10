# 03 Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip

Status: ready-for-agent
Blocked by: none
Implements: user stories 1-14, 19, 40, 48-51
Implements decisions: `tdd-evidence`, `revert-method`, `acceptance-range-mapping`, `screenshot-storage`, `fix-round-evidence-update`

Rewrite the PR body section of `.claude/templates/delegation/builder.md` to require Summary (smallest of diff sketch, call tree, file tree or Mermaid), Evidence (per acceptance line: named test, path:start-end ranges it covers, quoted red run with the change reverted and green run with it) and Merge danger (one-way or two-way door, migration is one-way, blast radius). Replace the temporary-commit-or-file-copy revert rule with the single patch round trip, written out verbatim: diff of source paths against main to a patch, reverse-apply, run the named test, re-apply. State that the quoted red run is sufficient TDD proof. For UI tickets, require before and after screenshots via the playwright-core script into the main checkout's `.scratch/evidence/<bead>/` by absolute path, nothing committed, with the path and regenerating command in the PR body. Update `.claude/templates/delegation/fix.md` with the same revert commands and the fix-round duties: re-quote only Evidence entries whose test or ranges changed, add an entry per new test, add a round line under Merge danger if blast radius changed, include should-fix items when a blocker already forced the round, and allow proposing a mutant as equivalent.

Judged by: templates read end to end with no contradiction to `.claude/rules/worktrees.md`; the revert commands are identical in both files and in ticket 4's reviewer template.