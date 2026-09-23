# Harvest: the AI LABS eight-repo Claude Code roundup

Source: "Insane GitHub Repos That 10x Your Codex And Claude Code Setup" (AI LABS, youtube.com/watch?v=Ua0APTMVcb8). Eight repos assessed read-only through the adoption gate, one sonnet session per repo with a fixed five-question brief (what it does from its own code; overlap with our loop, cited; what it adds; verdict; integration cost). Two were ruled skip without a session as off-domain. Nothing was installed and no repo was changed.

## Verdicts

| Repo | Verdict | What it adds that we lack | Snag |
|---|---|---|---|
| Reticle | adapt into workflow | Persisted, replayable browser checks with a yes / no / unknown / no-fault verdict and file:line on failure. Our agent-browser checks are re-driven by a model on every PR and nothing is kept. | Installer writes MCP config straight into agent configs; project rule routes MCP through mcp-cli. Dev-only SDK in the app build plus a local daemon. |
| Ouroboros | adapt into workflow | An adversarial closure pass (contrarian, gap-hunter) before the frontier is declared empty. Grilling ends on "frontier empty, user confirms" with no self-check. | Everything else (Rust/Python stack, event store, 30-generation evolve loop, AC tree) is out of scope. |
| Chisle | adapt into workflow, compression hook only | A deterministic PostToolUse hook that scrubs, elides and dedups oversized tool and sub-agent output, spilling the original to disk. | Error salvage is regex-based and capped at 12 lines; could cut verification output the deed-gate needs. Its terse-persona half conflicts with the interview and is rejected. |
| Anti-Slop | adapt into workflow | 18 syntactic Oxlint rules against type escape hatches, unsafe casts, module mocking and quadratic accumulation. grill-room has no linter at all today. | Would have caught zero of the roughly 35 logged delegation failures, which were spec, migration, process and seam failures. Needs Oxlint stood up from nothing. |
| Caliper | skip | With/without skill comparison. | Already native: `claude plugin eval --ablation with-without`, MCP included. |
| UI-Skills | skip | Routing over a hosted registry of 307 third-party skill files. | Three of its sources were already in the September design-skill harvest and ruled on. |
| img2threejs | skip (no session) | Image to Three.js model. | Off-domain for an interview tool and a TypeScript delegation loop. |
| FWC SwiftUI Skills | skip (no session) | iOS 26 Liquid Glass and iPhone Duo layouts. | Off-domain. |

Full reports and the fetched sources sit in the session scratchpad under `harvest/`.

## Reading

Two of the four "adapt" verdicts point at the same gap from opposite ends: the interview has no check on itself. Ouroboros supplies the closing check. The readiness calibration below supplies the opening one. Together they bracket a session. Reticle and Chisle are delegation-loop changes, not app changes; Anti-Slop is a linter decision for grill-room independent of the roundup.

Process findings: the gh-identity hook fires on read-only clones of public repos (two agents switched to curl + tar); an "adopt everything" prompt with no context on Grill Room or the loop would have found every one of the eight new.

## Readiness calibration

A one-page judge prompt (`readiness/prompt.md` in the scratchpad) run with `claude -p --model sonnet` on four past ideas, to test whether an idea's grill-readiness can be judged from its text before the first round:

| Idea | Observed outcome | Judge verdict | Objective is process | Evidence items | Unknowns |
|---|---|---|---|---|---|
| Export anywhere and generate a handoff | grilled well, eight tickets shipped | ready | no | 7 | 4 |
| Change a session's model before its first round | grilled well, five tickets shipped | ready | no | 7 | 5 |
| Reading list app | one-line idea | not ready: no motivating problem | no | 0 | 0 |
| Evaluate the 8-repo roundup | first round overwhelming and off-focus, session deleted | not ready: objective is a method, no stated outcome, seven unknowns | yes | 2 | 7 |

All four match. This is the evidence for a readiness step in Grill Room: a turn on a session with no rounds that returns evidence, objective, process flag, expected outcome, unknowns, verdict and what is missing, with the idea editable in place until the first round runs.

## Candidate ideas for Grill Room, in order

1. Readiness turn before the first round (evidence above).
2. Adversarial closure pass before a done proposal is accepted (Ouroboros).
3. Reticle-style replayable browser check recorded on the ticket after export (delegation loop first, app later).
