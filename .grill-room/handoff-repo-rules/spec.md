# Handoff: respect the target repository's own rules

Status: ready-for-agent

## Problem Statement

When I export a handoff bundle to a target repository, neither HANDOFF.md nor the per-ticket briefs treat that repository's own rules as rules. The handoff scout sees the root CLAUDE.md and AGENTS.md only as background documents, and it knows only whether a `.claude/rules/` folder exists, not what the rule files in it say.

Three real cases showed what this costs me:

- A repo rule that a brief's file boundaries make impossible. In ngine-monitor, the versioning rule requires a major version bump in all four `package.json` files for any migration. One of those files was outside the ticket's file boundaries. The builder skipped the bump and flagged it after the fact, so the conflict reached the builder instead of me.
- A delegation process in HANDOFF that contradicts the repo's own. Exported to a repo with its own worktree rule, HANDOFF stated a different in-flight cap, had no pre-flight step, had no two-lens review for tickets touching a schema, a server check or a model prompt, and named a different command for pruning merged worktrees.
- No pre-flight step before a ticket launches. Every measured pre-flight run on ngine-monitor found real problems, at roughly 210-230k tokens and 4-6 minutes per ticket. Grounding cannot replace it, because grounding goes stale as earlier waves merge.

As the owner, I learn about these conflicts too late, from a blocked or non-compliant builder. As the orchestrator, I follow a HANDOFF that disagrees with the repository I am working in.

## Solution

The handoff bundle reads the target repository's own rules and respects them.

- The server collects the repository's rule sources and hands them to the handoff scout as rules. It decides deterministically which rules apply to each ticket from the rule files' `paths:` frontmatter.
- For each applicable rule, the scout reports what the rule says and which files it requires touching. The server compares those files with the ticket's file boundaries. A required file outside the boundaries is a conflict.
- I see a conflict in the export preview, before export, while I can still fix the ticket. It also renders as an open question in HANDOFF and in the ticket's brief, so the orchestrator and the builder see it too. Export is never blocked.
- I close a conflict by fixing the ticket and re-grounding, or by accepting it as is with a reason that the orchestrator and builder can read.
- HANDOFF keeps its self-contained delegation lifecycle, but named steps take the repository's own values once I confirm them: the in-flight cap, the prune command, the review rule and the pre-flight procedure. One precedence line says the repository's rule wins where HANDOFF differs, and cites the file.
- HANDOFF gains a pre-flight step in both delivery recipes, on by default, with a project switch and the measured cost stated.

## User Stories

1. As an owner, I want the server to collect the root CLAUDE.md, AGENTS.md and every file in `.claude/rules/` as the repository's rule sources, so that the scout reads a known, complete list.
2. As an owner, I want the list of rule sources to be fixed and enumerated by the server, so that every rule citation the scout makes can be checked against a real file and a real line.
3. As an owner, I want the scout to read these sources as rules, so that a repository instruction is no longer treated as background.
4. As an owner, I want a rule to apply to a ticket when the rule file's `paths:` globs match the ticket's files, so that applicability is deterministic and needs no model judgement.
5. As an owner, I want the match made against the files the ticket will create or edit after grounding, so that the match and the conflict check use the same boundaries.
6. As an owner, I want reach and builds-on files left out of the match, so that briefs are not filled with rules about code the ticket only reads.
7. As an owner, I want a rule source without `paths:` frontmatter to apply to every ticket, so that a repository whose rules carry no frontmatter still benefits.
8. As an owner, I want the scout to read every frontmatter-less source for each ticket, so that a rule written in CLAUDE.md or AGENTS.md can still be reported.
9. As an owner, I want the scout to return, per ticket and per applicable rule, a citation plus the files the rule requires touching, so that the server can compute the conflict itself.
10. As an owner, I want the conflict computed as the required files outside the ticket's file boundaries, so that a conflict is a checkable fact and not a model's opinion.
11. As an owner, I want the scout to answer every rule that a `paths:` glob matched to a ticket, so that a matched rule is never silently skipped.
12. As an owner, I want the scout to be able to answer a matched rule with an explicit, cited "requires no files", so that a rule about naming or style is distinguishable from a rule the scout ignored.
13. As an owner, I want a report that is silent on a glob-matched rule to be refused and retried, so that the ngine-monitor failure cannot recur.
14. As an owner, I want silence allowed on rule sources without `paths:` frontmatter, so that reports do not carry a "requires no files" answer for every root document on every ticket.
15. As an owner, I want any claim the scout does make from a frontmatter-less source checked like every other claim, so that the relaxed rule on silence does not relax accuracy.
16. As an owner, I want a report refused when a rule citation points outside the collected rule sources, so that the scout cannot invent a rule file.
17. As an owner, I want a report refused when a rule citation names a line that does not exist, so that every cited rule can be opened and read.
18. As an owner, I want a report refused when it claims a rule whose `paths:` globs do not match the ticket, so that a rule cannot be attached to the wrong ticket.
19. As an owner, I want a report refused when a rule's required file does not exist, so that a hallucinated path never becomes a false conflict.
20. As an owner, I want a refused report retried in the same way as other refused scout reports, so that rule checks follow the existing acceptance flow.
21. As an owner, I want a rule conflict shown as an advisory line in the export preview, so that I see it while I can still fix the ticket.
22. As an owner, I want the preview line to name the ticket, the rule and the missing files, so that I know exactly what to fix.
23. As an owner, I want export to proceed even when conflicts exist, so that grounding stays advice and never blocks me.
24. As an orchestrator, I want each rule conflict listed in HANDOFF among the questions left open, so that I see it before launching the ticket.
25. As a builder, I want a rule conflict on my ticket listed in the brief's open questions with the instruction to stop and report, so that I do not choose between the rule and my file boundaries myself.
26. As a builder, I want every rule that applies to my ticket stated in the brief as a cited codebase fact, even when it can be satisfied inside my boundaries, so that I follow the rule without having to discover it.
27. As an owner, I want a hand-edited brief kept exactly as I left it, so that rule-derived text never overwrites my corrections.
28. As an owner, I want a conflict on a ticket with a hand-edited brief still shown in the preview and in HANDOFF, so that my edit does not hide the conflict from me or the orchestrator.
29. As an owner, I want to close a conflict by editing the ticket or brief and re-grounding, so that the real fix needs no new mechanism.
30. As an owner, I want to mark a conflict "accepted as is" with a reason, so that a deliberate exception stops showing as a warning.
31. As an owner, I want a waiver tied to the ticket, the rule file and the exact missing files, so that it covers only the gap I saw.
32. As an owner, I want a waiver to survive a re-grounding that finds the same conflict, so that I do not re-waive after every scout run.
33. As an owner, I want a waiver to lapse when the ticket, the rule file or the set of missing files changes, so that a different conflict is never waived without my seeing it.
34. As an orchestrator, I want a waiver's reason rendered in HANDOFF, so that I know the rule is deliberately not followed for that ticket.
35. As a builder, I want a waiver's reason rendered in my brief when the brief is not hand-edited, so that I know the rule is waived and why.
36. As an owner, I want waivers to join the handoff fingerprint only when one exists, so that stored handoffs do not go stale on upgrade.
37. As an orchestrator, I want HANDOFF to keep its full embedded lifecycle, so that it works in a repository with no rules file of its own.
38. As an orchestrator, I want the in-flight cap in HANDOFF to take the repository's value once confirmed, so that HANDOFF and the repository's rule agree.
39. As an orchestrator, I want the prune step in HANDOFF to name the repository's own prune command once confirmed, so that I do not run a command the repository forbids or replaces.
40. As an orchestrator, I want the review step in HANDOFF to follow the repository's review rule once confirmed, so that the right tickets get the right review.
41. As an orchestrator, I want the pre-flight step to point at the repository's own pre-flight procedure once confirmed, so that I run the procedure the repository defines.
42. As an owner, I want the scout to propose the repository's delegation values with citations, so that the values come from the repository and I can check where.
43. As an owner, I want to confirm proposed delegation values in the export preview, next to the grounding state, so that I decide where I already review the bundle.
44. As an owner, I want confirmed values stored as project settings, so that they are deterministic inputs to rendering and follow the existing fingerprint pattern.
45. As an owner, I want a confirmed in-flight cap to feed the existing in-flight cap setting, so that there is one cap and not two.
46. As an owner, I want an unconfirmed proposal never applied as a value, so that a misread rule cannot silently change the delegation process.
47. As an orchestrator, I want HANDOFF to render the default for an unconfirmed value plus a line naming the pending proposal and its citation, so that I know the repository says otherwise.
48. As an orchestrator, I want one precedence line in HANDOFF saying the repository's rule wins where HANDOFF differs, so that rules nobody anticipated are still covered.
49. As an orchestrator, I want the precedence line to cite the file or files the delegation values came from, so that I can open the governing rule directly.
50. As an orchestrator, I want HANDOFF to say in one line when no repository delegation rules were found, so that I can tell "no rules" from "rules not read".
51. As an owner, I want HANDOFF to take named values from repository rules and cite them without copying rule text, so that HANDOFF does not become a stale copy of the repository's rules.
52. As an owner, I want the scout to flag which tickets qualify for two review lenses under the repository's cited review rule, so that the review step is actionable per ticket.
53. As an orchestrator, I want HANDOFF to list each flagged ticket with two embedded lenses, one on correctness and one on tests, so that I can run both reviews without opening another file.
54. As an orchestrator, I want the repository's review rule cited next to the flagged tickets, so that I can find the repository's own lenses if they differ.
55. As an owner, I want nothing about two-lens review rendered when the review switch is off, so that my setting is not contradicted on the page.
56. As an orchestrator, I want a pre-flight step before each ticket launch in HANDOFF, so that stale grounding is caught before a builder starts.
57. As an orchestrator, I want the pre-flight step in both the pull-request and the local-merge recipe, so that the check does not depend on how work is delivered.
58. As an orchestrator, I want the pre-flight step to belong to the orchestrating session and not to the builder, so that it matches where pre-flight runs in every route.
59. As an orchestrator, I want the full read-only pre-flight prompt embedded in HANDOFF, so that I do not improvise the check.
60. As an orchestrator, I want the pre-flight prompt to ask for wrong premises, ambiguities, contradictions, boundary gaps and owner decisions, so that the check covers what the measured runs caught.
61. As an orchestrator, I want the pre-flight to end with a clear verdict of either clear or needs changes, so that I know whether to launch.
62. As an orchestrator, I want to launch a ticket only when its pre-flight is clear, so that known problems do not reach a builder.
63. As an owner, I want the pre-flight step to state its measured cost in tokens and minutes per ticket, so that keeping it on is an informed choice.
64. As an owner, I want the pre-flight step to name no model, so that HANDOFF works with any orchestrator and does not age with model names.
65. As an owner, I want pre-flight to be a project setting that is on by default, so that I get the protection without having to know about it.
66. As an owner, I want to switch pre-flight off for a small or cheap handoff, so that I do not pay the cost where it is not worth it.
67. As an owner of an existing project, I want the pre-flight step to appear at my next export, so that existing projects get the same protection as new ones.
68. As an owner of an existing project, I want my stored handoffs not to go stale when this ships, so that the upgrade costs me no re-export.
69. As an owner, I want the pre-flight setting to join the fingerprint only when it is off, so that it follows the existing pattern for new inputs.
70. As an owner, I want a repository's own pre-flight to replace the embedded prompt only after I confirm it, so that HANDOFF never shows two pre-flight procedures side by side.
71. As an owner, I want HANDOFF and the briefs to render the same text from the same stored inputs, so that rule handling adds no model call at render time.
72. As an owner, I want rule reading to happen inside the scout's existing single read-only turn, so that grounding keeps its cost and shape.
73. As an owner, I want delivery-recipe work kept separate from this change, so that the two can be planned and shipped independently.

## Implementation Decisions

**Rule sources**

- The server collects a fixed list of rule sources from the target repository: the root CLAUDE.md, the root AGENTS.md and every file in `.claude/rules/`. Nested CLAUDE.md or AGENTS.md files are not collected.
- The fact pack hands these to the handoff scout as the repository's rules. The scout prompt tells it to read them as rules.
- Rule reading happens inside the existing single scout turn: read-only, on the same model, with the project root.

**Applicability**

- A rule file applies to a ticket when its `paths:` frontmatter globs match at least one file in the ticket's grounded `filesToChange`.
- The server performs the match, after the scout reports the ticket's files. It does not match against reach or builds-on files.
- A rule source without `paths:` frontmatter applies to every ticket. This covers the root CLAUDE.md, the root AGENTS.md and any rule file without frontmatter.
- Because the match is known only after the scout reports files, the scout reads all collected rule sources in its turn.

**Scout result**

- The scout result gains, per ticket, a list of rule claims. Each claim carries a citation into a collected rule source (file and line), a statement of the rule, and the files the rule requires touching.
- A claim may state explicitly that the rule requires no files. That statement is a cited claim like any other.
- The scout also flags, per ticket, whether the ticket qualifies for two review lenses under the repository's review rule, with the rule cited.
- The scout proposes the repository's delegation values, each with a citation: the in-flight cap, the prune command, the review rule and the repository's own pre-flight procedure, where the rule sources state them.

**Server checks on rule claims**

- The server refuses and retries the whole report when:
  - a rule citation points outside the collected rule sources, or names a line that does not exist;
  - a claim cites a rule file whose `paths:` globs do not match the ticket;
  - a required file does not exist in the repository;
  - a rule file matched to the ticket by a `paths:` glob has no claim from the scout.
- Silence on a rule source without `paths:` frontmatter is allowed. Any claim made from such a source is checked against the first and third conditions above.
- A rule that requires creating a new file is refused under these checks. This is a known limit, accepted until a real case needs it.

**Conflicts**

- The server computes a conflict per rule claim as the set of required files that are not in the ticket's file boundaries. The scout does not declare conflicts.
- A conflict surfaces in three places:
  - an advisory line in the export preview, next to the grounding state;
  - an open question in HANDOFF, in the existing section for questions left open;
  - an open question in the ticket's brief, with the existing stop-and-report instruction.
- Export is never blocked by a conflict.
- An applicable rule with no conflict renders in the brief as a cited fact in the existing codebase-facts section.
- A hand-edited brief is kept unchanged. Its rule facts and conflict questions are not added to it. The conflict still shows in the preview and in HANDOFF.

**Resolving a conflict**

- The owner closes a conflict by editing the ticket or brief and re-grounding. No new mechanism is built for this path.
- The owner can mark a conflict "accepted as is" with a reason. This waiver is a new stored input.
- A waiver is keyed on the ticket, the rule file and the set of missing files. It survives a re-grounding that finds the same key. It lapses when any of the three changes.
- A waived conflict no longer shows as a warning. Its reason renders in HANDOFF always, and in the ticket's brief unless the brief is hand-edited.
- Waivers join the handoff fingerprint only when present.

**Lifecycle deferral in HANDOFF**

- The embedded lifecycle per recipe stays whole. Four named slots take stored values: the in-flight cap, the prune command, the review rule and the pre-flight procedure.
- Slot values come from the scout's proposals, confirmed by the owner in the export preview into project settings. A confirmed cap feeds the existing in-flight cap setting.
- An unconfirmed proposal is stored as a render input but not applied. HANDOFF renders the built-in default for that slot plus a line naming the pending proposal and its citation.
- New settings join the fingerprint only when they differ from their migration default.
- HANDOFF carries one precedence line: where HANDOFF differs from the repository's rule, the repository's rule wins. The line cites the file or files the delegation values were cited from.
- When the repository has no rule sources, or none that state delegation values, HANDOFF renders the embedded lifecycle plus one line saying no repository delegation rules were found.
- HANDOFF takes named values from repository rules and cites them. Rule text is never copied into HANDOFF. This replaces the earlier exclusion of copying project rules into HANDOFF, and narrows it instead of removing it.

**Two-lens review**

- For each ticket the scout flagged, HANDOFF lists the ticket with two embedded generic lenses, one on correctness and one on tests, and cites the repository's review rule.
- The lens wording is HANDOFF's own. A repository whose rule names different lenses is reachable through the citation and covered by the precedence line.
- When the review switch is off, HANDOFF renders nothing about two-lens review.

**Pre-flight**

- Pre-flight is a new project setting, on by default, rendered in both the pull-request and the local-merge recipe.
- The migration default is on. Existing projects gain the step at their next export. The fingerprint omits the setting while it is on, so no stored handoff goes stale.
- The step sits in the before-launch part of the lifecycle and belongs to the orchestrating session.
- The step embeds the full read-only pre-flight prompt. The prompt asks the agent to check the ticket against the code at the current head for wrong premises, ambiguities, contradictions, boundary gaps and owner decisions, and to end with a verdict of clear or needs changes. A ticket launches only on a clear verdict.
- The step states the measured cost: roughly 210-230k tokens and 4-6 minutes per ticket.
- The step names no model.
- A repository's own pre-flight procedure is one of the scout-proposed, owner-confirmed delegation values. Once confirmed, a cited pointer to it replaces the embedded prompt. Until confirmed, the embedded prompt renders with the pending-proposal line.

**Rendering**

- HANDOFF and the briefs stay deterministic templates. All rule-derived content enters as stored inputs: accepted rule claims, computed conflicts, waivers, two-lens flags, proposals and confirmed settings. No model runs during rendering.

## Testing Decisions

A good test here checks external behaviour: given a set of stored inputs or a scout report, what the server accepts or refuses, and what text HANDOFF, the briefs and the preview contain. Tests do not assert on template internals or helper structure.

Modules to test:

- **Rule source collection.** Given a repository layout, the collected list is exactly the root CLAUDE.md, the root AGENTS.md and the files in `.claude/rules/`. Nested files are not collected. A repository with none yields an empty list.
- **Path matching.** A rule file with `paths:` globs matches a ticket only through `filesToChange`. Reach and builds-on files do not cause a match. A source without frontmatter applies to every ticket.
- **Report acceptance.** One test per refusal condition: citation outside the collected sources, bad line, rule whose globs do not match the ticket, required file that does not exist, and silence on a glob-matched rule. One test that silence on a frontmatter-less source is accepted. One test that an explicit "requires no files" claim satisfies a glob-matched rule.
- **Conflict computation.** Required files inside the boundaries produce no conflict. Required files outside produce a conflict listing exactly the missing files. The ngine-monitor case, four required `package.json` files with one outside the boundaries, is a named test.
- **Waivers.** A waiver survives re-grounding with the same ticket, rule file and missing files. It lapses when the missing-file set changes, when the rule file changes identity, and when the ticket changes. A waived conflict produces no warning and renders its reason.
- **Brief rendering.** An applicable rule without conflict renders as a cited fact. A conflict renders as an open question with stop-and-report. A hand-edited brief is byte-identical before and after rule-derived inputs are added.
- **HANDOFF rendering.** Each slot renders its default with no stored value, its confirmed value when confirmed, and the default plus the pending-proposal line when proposed but unconfirmed. The precedence line cites the right files. The no-rules line appears only when no delegation rules were found. Two-lens entries appear per flagged ticket and disappear when review is off. The pre-flight step appears in both recipes when on and in neither when off, and is replaced by the cited pointer when a repository pre-flight is confirmed.
- **Fingerprint.** A project with all new inputs at their defaults has the same fingerprint as before this change. Each new input changes the fingerprint only when non-default.
- **Preview.** The preview lists conflicts and pending delegation proposals, and export remains available in every state.

Prior art: the existing acceptance checks on scout reports (citations, create and edit files, blocker names, reach symbols) are the model for the new refusal tests. The existing fingerprint behaviour for the delivery recipe, the review switch and the in-flight cap is the model for the new fingerprint tests. The existing deterministic rendering of HANDOFF and briefs, including the hand-edited brief baseline, is the model for the rendering tests.

## Out of Scope

- Delivery-recipe work. The two recipes stay as they are apart from the new slots and the pre-flight step.
- Collecting nested CLAUDE.md or AGENTS.md files along a ticket's paths.
- Letting the scout discover rule files outside the fixed list.
- Copying or quoting rule text into HANDOFF.
- Blocking export on a rule conflict or on an unconfirmed proposal.
- Conflicts for rules that are not about files. A rule claim expresses a conflict only through required files.
- Rules that require creating a new file. Such a claim is refused today.
- A one-action "add the file to this ticket's boundaries" control in the preview.
- Appending rule-derived text to hand-edited briefs.
- Naming or recommending a model for the pre-flight agent.
- Forcing the scout to answer rule sources without `paths:` frontmatter.
- Matching rules against a ticket's reach or builds-on files.
- Running pre-flight inside the app. The step is an instruction to the orchestrating session.

## Further Notes

- Known limit, accepted: a file-touching rule written in a source without `paths:` frontmatter is caught only if the scout reports it. Nothing forces an answer there. Adding `paths:` frontmatter to the rule file in the target repository makes it enforced.
- Broad globs make many rules mandatory to answer for many tickets, and a missed one costs a full grounding retry. This is the price of never skipping a matched rule.
- The stated pre-flight cost was measured on one repository and one model. With no model named in the step, the figure is indicative.
- An existing project's next export changes text and adds a pre-flight step without the owner having chosen it. The stated cost and the switch are what leave the owner in control.
- The three source cases are tracked as beads gr-c0t.7 (rule versus file boundaries), gr-c0t.11 (delegation process contradictions) and gr-7un (pre-flight).
- The repository's own worktree rule and pre-flight template are the reference for what the embedded pre-flight prompt and the two lenses should say.
