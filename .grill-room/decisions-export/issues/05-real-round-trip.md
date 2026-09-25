# 05 A real round trip: export, commit, scout again

Status: ready-for-agent
Blocked by: 01, 03
Suggested model: opus

## What to build

Nothing in the app. One real run with the real interviewer, on an isolated server and database:

- Copy a project into a temp git repo. Run a session on it that settles decisions of its own, keeps one repo decision, and reopens another repo decision with a different answer. Export, and commit the export.
- Open a second session on the same project and run the scout.
- Record the second scout's report: does it propose the exported decisions as recorded, cited to decisions.md lines? Does it propose the reopened decision's new answer rather than the original statement? Does it leave out the session's own file on a re-scout of the first session?
- Report under `docs/spikes/`, with the report's proposals and the checks. The main session then checks each claim against the code and the files.

## Builds on

Tickets 01 and 03, the scout, and the real interviewer adapter. Confirm they exist first.

## How it will be judged

- The spike report exists, the checks are answered with evidence, and any failure is filed as a bead.
- Browser servers run only on free ports the agent chose, and are stopped only by the PIDs the agent recorded. The user's own dev server is never touched.
