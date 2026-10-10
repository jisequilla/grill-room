# 05 Rules: post-merge nits bead, one-way-door confirmation, evidence cleanup

Status: ready-for-agent
Blocked by: 02
Implements: user stories 15, 55-62, 66-67
Implements decisions: `nit-bead-granularity`, `nit-bead-priority`, `nit-bead-filer`, `nit-bead-contents`, `merge-danger-gate`, `evidence-retention`

Update `.claude/rules/worktrees.md` main-session steps: after merge, file one bead per PR from the workflow's returned non-blocking findings at priority 3, label `pr-nits`, title `PR #N nits: <ticket id>`, each entry formatted as level, file:line, one-line fix, evidence command for should-fix, and 'addressed in round N' where applicable; never before merge and never by a reviewer. Before merge, a one-way door in Merge danger stops for the owner's typed confirmation, like a launch. Add `.scratch/` to `.git/info/exclude` as a documented setup step and delete `.scratch/evidence/<bead>/` when that PR's nits bead closes. Restate that pre-flight, merged-with-main verification and merge stay in the main session and a launch still needs the owner's typed message. Provide a small bead-entry formatting helper (new, under `scripts/`) with a shell test alongside `scripts/test-prune-worktrees.sh` style.

Judged by: the formatter test passes; the rules file reads as a single coherent checklist.