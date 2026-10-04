# Spike: a fourth real grounding run, against ngine-monitor

Bead gr-c0t.20, the closing measure for epic gr-c0t (grounded brief quality). The third run (`docs/spikes/handoff-scout-third-run.md`) gave 3 of 6 briefs usable as-is. This run grounds a real ngine-monitor session after gr-c0t's waves and the repository-rules work (gr-c0t.26 to .34) landed, and scores the briefs the same way. The checks keep the third run's numbering and criteria.

## Verdicts

| # | Check | Third run (marathon tracker) | This run (ngine-monitor) |
|---|-------|------------------------------|--------------------------|
| 1a | Every edit target exists, or a blocker creates it | **Pass**: 6 of 6 | **Pass**: 7 of 7, all tracked at HEAD |
| 1b | Every create target is new, inside the repo and not ignored | **Pass**: 4 of 4 | **Pass**: no create targets |
| 1c | Nothing important missing from File boundaries | **Fail**: 2 gaps | **Pass**: no gap. Ticket 01 also lists `plugin/tests/test_masking_corpus.py` for edit while a fact says it stays unchanged (see "The refusal") |
| 2 | Codebase facts true at the cited line | **Pass, with caveats**: 21 facts, 16 true, 5 partly, 0 false | **Pass**: 18 facts, 18 true, 0 false. Three cite a span a few lines wider than the statement |
| 3 | Builds on names what the blocker produces; the check fails before and passes after | **Partial**: 2 of 5 sure to pass after | **Partial**: 1 of 1 fails today, but it passes after only if ticket 01's builder writes the literal `Proxy-Authorization` in `constants.py`; a correct `(?:proxy-)?authorization` under `(?i)` fails it |
| 4 | Proved by: a test in the ticket's own files, and a command that runs this ticket's test | **Partial**: 2 of 6 sound | **Partial**: 1 of 2 sound. Ticket 01's corpus test is right and passes today (68 passed), as it should before the new cases. Ticket 02 (docs only) is proved by `grep -q '0.23.2' docs/EVENT_SCHEMA.md`, which fails today but passes on any mention of the version |
| 5 | HANDOFF.md says grounded only if every brief was | **Pass** (6 of 6 grounded) | **Pass** (2 of 2 grounded) |
| 6 | Cost | 1 turn, 1 run, 2 attempts, 1 refusal, 133.2 s | **1 turn, 1 run, 2 attempts, 1 refusal, 54.3 s** (35.5 s refused, 18.7 s stored), $0.52 on sonnet |
| 7 | Repository rules (new) | n/a | **Pass**: ticket 01 carries the versioning rule as a claim requiring both version files, both inside its boundaries, so no conflict. Ticket 02 (docs only) carries none |

**Usable as-is: 1 of 2.** Brief 01 is usable once the delegation prompt carries the owner's four answers to the consistency check's questions; the brief says to stop without them, which is the intended path, not a defect. Brief 02 needs one fix: a proof that checks the documented rule rather than one version string, and a Builds-on check that does not depend on how ticket 01 spells the header name.

## Setup

- **Project.** The real ngine-monitor checkout, registered on the owner's server (`8082`), recipe `local-merge`, verify command `just test`. HEAD `9379b0a`, unchanged from scout to export.
- **Server.** The owner's server, restarted on main `f4bc52d` so the rule-conflict code (gr-c0t.28 to .30) was live. Real interviewer.
- **Driver.** The app's actions through `.claude/skills/drive-grill-room/scripts/grill.py`. The owner answered every card and kept every scout proposal through the question tool.
- **Idea.** ngine-monitor's own backlog bug nmon-bsh: the plugin's `bearer_token` mask redacts ordinary prose ("a bearer authentication scheme"). Chosen because a plugin change triggers the plugin version rule.

The original ngine-monitor rule conflict could not recur: the versioning rule changed since then. The four system `package.json` files no longer carry a version, and the system `VERSION` file is bumped only when a branch merges. The plugin track still requires `plugin.json` and `marketplace.json` in the same commit as the fix, which is the rule this run exercised.

## The interview

Readiness: ready, no missing items. The scout proposed nine repository decisions (two recorded in `.claude/rules/versioning.md`, the rest from the corpus test, the masking code and `EVENT_SCHEMA.md`); the owner kept all nine. Two rounds of four cards each, all eight accepted as recommended, then a done proposal the owner confirmed. Synthesis 45 s, breakdown 58 s.

| # | Title | Blocked by |
|---|-------|------------|
| 01 | Tighten bearer_token masking, pin it in the corpus, bump to 0.23.2 | none |
| 02 | Document the tightened bearer rule and its limits in EVENT_SCHEMA.md | 01 |

The consistency check left four questions to the owner (three quote ticket 01, one quotes the spec). The owner answered them; the answers are in nmon-bsh's notes for the ticket 01 delegation prompt.

## The refusal

The first attempt proved ticket 01 by `plugin/tests/masking_corpus.json`, a file it edits that is not a test by its name. The app refused it. The retry, carrying the previous answer, kept every other field and made `plugin/tests/test_masking_corpus.py` the proof, adding it to `filesToChange`. That is why the brief lists the test file for edit while a fact says no test code changes. The corpus JSON is where this project's masking tests live; the name rule does not know that, so a data-driven test suite costs one refusal and leaves a spurious edit target.

## Repository rules

What gr-c0t.26 to .34 added, on a real repository:

- **Rule claims.** Ticket 01's grounding entry carries one claim, citing `.claude/rules/versioning.md:57-60`, requiring `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. Brief 01 renders it as a Codebase fact: `Repository rule: ... It requires ...`.
- **Conflicts.** Both required files are in ticket 01's boundaries, so `ruleConflicts` is empty in the preview, the brief and HANDOFF. The conflict path did not run; the unit and action tests of gr-c0t.28 to .30 remain its only proof. A run whose scout leaves a required file out is needed to see it end to end.
- **Delegation values.** The grounding proposed none (all four slots null) and HANDOFF says so: ngine-monitor's rule sources state no in-flight cap, prune command, review rule or pre-flight procedure. True of the repo.
- **Two-lens flags.** None. Neither ticket touches a server check, a schema or a model prompt.

## Findings

Findings 2 to 4 are filed as gr-c0t.36 and gr-c0t.37.


1. **Step 0 assumes a committed bundle, and the export says to commit it.** Both briefs say "The bundle is committed in this repository, so your worktree has it." The export leaves the bundle untracked, as designed, and says so twice: `export-session` returned `visibility.hasUntracked: true` with the warning that worktree agents will not see untracked files and the exact `git add`/`commit` remedy, which the UI shows as an "Agents may not see these files" alert; and HANDOFF.md's lifecycle has the operator commit the bundle once before delegating. The briefs' sentence holds once that step is done. Nothing to fix.
2. **The test-name rule refuses data-driven suites.** See "The refusal". It cost 35.5 s and $0.32 and left a misleading edit target.
3. **A Builds-on check that greps for a spelling.** Ticket 02's check passes only if ticket 01 writes the literal `Proxy-Authorization`. The check should test behaviour (run the corpus) or the ticket that produces the symbol should name its spelling.
4. **A docs ticket's proof is a version grep.** `grep -q '0.23.2'` proves a version is mentioned, not that the rule, the 20-versus-32 departure or the residue are documented.

## The question that decides epic gr-c0t

The third run gave 3 of 6 briefs usable as-is, and its failures were boundaries (1c) and proofs (3, 4). This run has no boundary gap and no false fact, and its one unusable-as-is brief needs one fix in proof and check wording, the same family of weakness the third run had. The facts and boundaries are now reliable; proofs for tickets with no code (docs) and Builds-on checks that depend on a blocker's exact text are what still need a human eye. Two tickets are a small sample, against six last time, and the rule-conflict path is still unproven on a real repository.
