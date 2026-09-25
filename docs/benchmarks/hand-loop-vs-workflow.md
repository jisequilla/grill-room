# Hand loop vs workflow

Two ways to run the delivery loop in `.claude/rules/worktrees.md`: a builder in a worktree opens a draft PR, a fresh-context opus reviewer judges it, and failed reviews go back for up to two fix rounds. The main session verifies and merges either way.

- **Hand loop:** the main session launches each agent with the Agent tool, and relays reviews and fix briefs itself.
- **Workflow:** one Workflow script runs the loop per ticket and hands back a PR number and a verdict.

## Pilot

The two arms ran different tickets, so this pilot measures the mechanics, not quality. The A/B on shared tickets is bead gr-ijk.

| | Hand loop: PR #68 (gr-c0t.1–3) | Workflow: PRs #69 (gr-x2q), #70 (gr-as1) |
|---|---|---|
| Size | 3 beads, a schema change, and a scope widened mid-review | 2 small beads: wording nits, and moving two constants |
| Agents | builder (opus), reviewer (opus), each resumed for round 2 | 4: two sonnet builders, two opus reviewers |
| Subagent tokens | about 569k (builder 351k, reviewer 217k, both across two rounds) | 569k for both tickets |
| Agent time | 1,520 s in sequence (build 611, review 251, fix 490, re-review 168) | 797 s wall for both tickets, run in parallel |
| Review rounds | 2: round 1 requested changes, round 2 approved | 1 each, both approved |
| Owner decisions | 1: making `testPath` nullable changed the spec | 0 |
| Main-session interventions before verification | 4: launch, launch review, decision plus spec edit plus fix brief, launch round 2 | 1 launch |
| Found in main-session verification after approval | nothing | nothing blocking. #70's test checks `> 0` instead of pinning 40 and 15, which the reviewer noted and approved |
| Wasted runs | none | 1: the first launch cost 166k tokens and 47 s, and did nothing |

## Findings

1. **A workflow agent takes the user's last typed message as its authority.**
   - The first launch followed an approval the user gave through the question tool. The last typed message was a question ("should we try …?"), so both builders refused the scripted tickets as unrequested.
   - A launch needs a typed instruction from the user naming the work.
2. **The workflow's advantage is the orchestrator's attention, not the agents' work.**
   - The agents, prompts and models are the same in both arms.
   - The workflow removed the main session from the relay: no reading reports, no briefing reviewers, no forwarding findings.
   - Its cost is that a mid-loop judgment call has nowhere to go. In PR #68, the nullable `testPath` needed the owner's decision. A workflow reviewer that hit the same thing could only request changes, and a builder could only guess.
3. **Worktree hygiene held in both arms.** Every builder verified the gh account, and none worked around a block.

## Next

The A/B (gr-ijk): the same tickets in both arms, run in parallel and judged blind. The timing will be enriched with ngine-monitor events for session `88a26b29-0bff-41cf-9aff-d4ecd9b14fd4`, which are not queried yet.

## A/B: the same three tickets in both arms

Bead gr-ijk. The tickets were gr-c0t.4, gr-iiu and gr-5e7.13. Both arms got identical ticket text, verify commands and models (a sonnet builder and an opus reviewer), and ran in parallel. Only the orchestrator differed.

The two PRs for each ticket were judged blind by an opus judge. The judge saw only the ticket and two anonymised diffs, labelled A and B at random. Timings, tokens and gaps come from ngine-monitor events, transcript usage and GitHub's PR timeline. Cost is the monitor's catalog price for subagents. It leaves out the orchestrating session, which drove both arms and cannot be split between them.

### Time to ready (builder start → PR marked ready on GitHub)

| Ticket | Hand | Workflow |
|---|---|---|
| gr-c0t.4 | 7m00s (#72) | 7m00s (#73) |
| gr-iiu | 13m33s (#74) | 13m00s (#75) |
| gr-5e7.13 | 29m04s (#77), including a 10m19s wait on the owner for a push the classifier blocked | never ready (#76: changes requested in rounds 1 and 2, then closed) |

### Cost and tool calls (builder, reviewer and fixer)

| Ticket | Hand | Workflow |
|---|---|---|
| gr-c0t.4 | $5.67, 44 calls | $3.06, 34 calls |
| gr-iiu | $10.36, 85 calls | $10.36, 98 calls (including a $1.17 reviewer that re-ran needlessly on resume) |
| gr-5e7.13 | $12.38, 96 calls | $17.13, 182 calls |
| Total | $28.41, 225 calls | $30.55, 314 calls |

Almost all builder cost is cache reads, 5 to 36M tokens per builder.

### Quality (blind judge)

| Ticket | Winner | Why |
|---|---|---|
| gr-c0t.4 | hand, #72, 23 to 21 | Its wording matches the facts bullet's existing phrasing, and its test pins the rule to that bullet. |
| gr-iiu | workflow, #75 | Behaviour was identical. #75's tests fail on every revert: #74 left the session kinds' retry wording unguarded and did not assert the rejection reason. #75 also has one shared retry helper where #74 copies the block three times. |
| gr-5e7.13 | hand, #77, by default | The workflow arm did not converge. Its builder had also padded inline code on one side only, a defect the hand builder avoided under the same ambiguous ticket text. |

### What decided it

1. **The agents came out even.** On the two tickets both arms delivered, time to ready was the same and quality split one each. Wherever quality differed, the difference was in the tests, never in behaviour.
2. **The workflow lost on orchestration defects, all fixable:**
   - A fix agent in a fresh worktree could not check out a PR branch that the builder's worktree still held. Fixed: the fix agent now works on a local branch and pushes to `HEAD:<branch>`.
   - A fix agent returned a placeholder result while its `just e2e` was still running in the background, and the script took it as final. Not fixed yet.
   - Resuming the run re-ran two reviewers that had already finished, at $2.78. The cache replays only the longest unchanged prefix of agent calls in order, so one edited fix prompt invalidated every call after it in the run.
3. **The hand loop's one weak point was a person.** The classifier blocked a builder's push, and the ticket waited 10m19s for the owner. Six "waiting for your input" notifications fell during the run.
4. **Handoffs between steps took seconds in both arms:** 13–15 s by hand and 4–10 s in the workflow. Launching agents costs almost nothing. The real cost of the hand loop is the orchestrator's attention, which this benchmark cannot price.

### Verdict and next step

This is one run per arm, so it is a smoke test, not a verdict. A trustworthy A/B needs at least 5 paired repetitions per ticket per arm.

On this evidence the workflow is worth taking forward, once the fix step is hardened:
- the fix agent must not return while a background command is still running;
- a resume must not re-run finished reviewers.

It also needs a local-merge variant before it can deliver to a repository without a remote.

### Gaps found in ngine-monitor while measuring

The monitor session listed 13. They are for its owner to file:
- phantom SubagentStop rows (1,947 of 2,036);
- no workflow run id, even though the lineage is on disk under `subagents/workflows/<run>/`;
- workflow agents appear only when they stop;
- per-agent tokens are captured but not joined into the views;
- "active agents" undercounts;
- labels are stored but not rendered, and there is no grouping by arm or ticket;
- hook denials are not recorded as events;
- workflow resumes are not modelled;
- the orchestrator's cost cannot be split between arms;
- time spent waiting on a human is not surfaced;
- transcript output-token counts look low;
- there is no GitHub PR lifecycle;
- several UI issues.

## What the loop changed afterwards

Most failed review rounds in this project traced back to the ticket, not to the model. No ticket needed escalating from sonnet to opus. The process now answers the patterns that caused those rounds (`.claude/rules/worktrees.md`, `.claude/templates/delegation/`):

- **Behaviour is specified by example.** An input → expected-output table replaces prose where it can. One ambiguous sentence about backtick padding produced two different implementations under identical ticket text.
- **Each acceptance line names a test that fails without it.** Builders and reviewers both revert the change to prove it. Reviewers approved tests that guarded nothing (#70, #74), and the blind judge's reverts found it.
- **A seam test runs whenever a prompt and its enforcing check change together.** Three PRs (#63, #66, #68) shipped a prompt rule that contradicted a server check.
- **A disclosure valve covers edits outside the file list.** Two builders independently needed the same one-word export outside their files. One disclosed it and one did not, and the two reviewers treated it differently.
- **A sonnet pre-flight read clears each ticket before launch.** The owner decisions (a nullable `testPath`, a widened scope) and a wrong premise (run 2's "dead end") each surfaced a full review round too late.
- **Tickets that touch checks, schemas or prompts get two reviewer lenses.** The same commit reviewed twice produced different real findings.
- **One set of templates serves both loops,** and verification must finish in the foreground before an agent reports.

These changes are measured by the rate of first-round approvals on the next wave, against this session's baseline. Of the tickets through the review gate:
- first-round approvals: PRs #60, #61, #62, #69, #70, #72 to #75, #77;
- two rounds: #63, #64, #66, #68, #71;
- no convergence: #76.

## ngine-monitor live-run-observability: tickets 01 + 01b

The second A/B ran on another repository: ngine-monitor, driven by its own session with branches `ab/hand` and `ab/wf` from base `f3230e9`. Ticket 01 built the span read model. The spec gave no ticket the job of writing the table, so ticket 01b was added mid-build for the writer. Both arms got identical 01b text, including a premise that turned out false: that the plugin always sends `run_id = null` on the orchestrator's own events. Neither wave had a pre-flight.

An opus judge compared the two arms' cumulative diffs for 01 + 01b (`f3230e9..a4da9a7` for wf, `f3230e9..56757f7` for hand), labelled A and B at random. Comments that named the arms were reworded in both diffs, and the judge could not open the bead comments. It checked every premise against the plugin at the base commit.

| | Workflow arm | Hand arm |
|---|---|---|
| Score /30 (correctness, tests, scope and clarity) | **21** (7, 7, 7) | 15 (5, 5, 5) |
| Blocking defect | Orchestrator tool spans take the event's own run_id, so run grouping and trace grouping disagree when a run label is set. Costs no tokens | Parent usage that arrives on Stop or SessionEnd is dropped for sessions without a later tool event, and a session with no tool calls gets no root |
| Fixtures | Payloads stored as jsonb objects, as production does | Payloads double-encoded into jsonb strings. The builder then wrote production workarounds and recorded in NMON-019 that payloads are "not reliably a jsonb object", which is false |
| Where it was right and the other wrong | Per-model never-regress floor; refreshes every active session; deterministic cost ownership | Persisted watermark on arrival time; one TypeScript implementation that is also the writer; a top-level agent parented to its session root |

The judge preferred the workflow arm. Its tokens survive every data path the plugin produces, and the hand arm's writer loses orchestrator usage. Both arms were built on the same false premise and the same underspecified writer, and the owner sent both to a redesign ticket, 01c, whose design is fixed in advance. The comparison says less about the two loops than about the ticket: the arm whose fixtures matched production reasoned correctly about the data, and the other built on a fixture artifact (bead gr-c0t.12).
