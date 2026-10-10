# 06 Extend the benchmark with mutation and evidence columns

Status: ready-for-agent
Blocked by: none
Implements: user stories 64-65
Implements decisions: `pilot-success`

Extend `docs/benchmarks/hand-loop-vs-workflow.md` with per-ticket columns: Stryker time per run, score, surviving mutants, findings proved only by tool, nit beads filed, evidence re-run result, and the keep criterion (at least one tool-only survivor, every Evidence pair re-ran, per-ticket cost within $3 to $17). Leave rows for gr-6uc, gr-930 and gr-x6w empty for the pilot to fill.

Judged by: the table renders and the criterion is stated once, unambiguously.