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
