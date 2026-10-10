# 04 Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands

Status: ready-for-agent
Blocked by: 02, 03
Implements: user stories 15-18, 20, 35-39, 44-46, 59
Implements decisions: `mutation-role`, `survivor-finding-severity`, `equivalent-mutant-handling`, `evidence-rerun-failure`

Rewrite `.claude/templates/delegation/reviewer.md`: the reviewer re-runs every quoted Evidence pair with the same patch round trip commands as ticket 3 and regenerates UI screenshots from the named command. A test that passes with the change reverted is a blocker; a stale quote with a correct test is a nit about the PR body. The tests lens takes the survivor list as filled input and documents the `test:mutate` command for a hand loop. A survivor on a line inside an Evidence range defaults to blocker, elsewhere to nit; a downgrade requires the mutant quoted and the reason no test could kill it; the reviewer owns equivalent-mutant calls in the verdict. Findings use the three levels; every blocker and should-fix carries the command that shows it; every nit carries file:line and a one-line fix. The reviewer never writes beads. The verdict output must match the schema from ticket 2.

Judged by: a dry run of the template against a sample PR produces findings that validate against the ticket 2 schema; wording stays consistent with worktrees.md.