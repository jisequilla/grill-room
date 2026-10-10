# 1. A surviving mutant blocks only on lines an acceptance line covers

- **Status:** Accepted, on condition. The gate stays only once gr-g4v.9 and gr-g4v.10 land; until then the pilot found it judged none of the tickets' own code (see Pilot outcome).
- **Decision key:** `mutation-role`

## Context

Stryker runs on the lines a PR changes. The question is what its result does to the review verdict:
- **A gate:** a surviving mutant blocks the PR on its own.
- **A report:** survivors are listed, and the reviewer decides by hand which are real findings.
- **A scoped gate:** a survivor blocks only when it sits on a line an acceptance line claims to cover. That is where the PR body's Evidence section already promises a test.

## Decision

Gate on Evidence-covered lines, report elsewhere.

`.claude/templates/delegation/reviewer.md` ("Judging survivors") states the rule:
- A survivor inside any Evidence range on the same path, ends included, is a `blocker`.
- A survivor outside every range is a `nit`.
- A covered survivor stays a `nit` only when the reviewer records why no test can kill it, in `equivalentMutant`. A fixer's claim alone changes nothing.

## Alternatives

- **Report only.** Nothing new can block a PR, so a pilot measures the tool without the tool distorting it. It costs the discipline: a reviewer under pressure can wave survivors through, and nothing stops them.
- **Hard gate on every surviving mutant.** The strongest guarantee of test strength, and the simplest to explain. It costs false blocks on equivalent mutants and on incidental changes like logging or formatting, which burn the two fix rounds on noise.

## Consequences

- Every PR body maps its acceptance lines to changed line ranges (the Evidence section of `builder.md`).
- A surviving mutant on those lines is a blocking finding by rule.
- A plain score threshold is ruled out as the gate. The score is recorded, never gated.
- Moving later to a whole-diff gate is a template change, not a new mechanism.

## Pilot outcome

The delivery-loop pilot (gr-g4v.7, `docs/benchmarks/hand-loop-vs-workflow.md`) ran three test-coverage tickets through the gate. It judged none of their code:
- **gr-6uc and gr-930 changed tests only.** For a PR like that, `test:mutate` takes every line the changed tests cover, in path order, up to its 100-mutant cap. The cap filled with unrelated files, and every Evidence range was dropped unjudged.
- **gr-x6w's run failed Stryker's dry run** although the suite was green, so its gate was skipped.

The owner kept the gate on condition:
- **gr-g4v.9:** rank the code the changed tests target ahead of the cap.
- **gr-g4v.10:** make the dry run reproduce the green suite.

If those cannot make the gate judge a ticket's own code, this decision is reopened.

## Tickets

- gr-g4v.4: reviewer template, re-run Evidence, judge survivors, three finding levels (PR #186)
- gr-g4v.7: pilot and benchmark (PRs #190, #191, #192, #193)
