# 05 A real grounding run

Status: ready-for-agent
Blocked by: 04
Suggested model: opus

## What to build

Nothing in the app. One real run on a temp clone of a real project:
1. Take a session through to tickets and a handoff.
2. Ground the briefs with the real interviewer.
3. Check every brief's claims against the code: files, facts, builds-on and proved-by.
4. Report under `docs/spikes/`, with each check's verdict and evidence.

The main session then checks the claims itself.

## How it will be judged

- The report exists, and each claim is checked with evidence.
- Every failure is filed as a bead.
- Servers run only on free ports, and are stopped only by their recorded PIDs. The user's server and Chrome are never touched.
