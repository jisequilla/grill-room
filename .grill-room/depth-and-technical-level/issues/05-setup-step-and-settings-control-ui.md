# 05 Setup step at session creation and the mid-grill settings control

Status: ready-for-agent
Blocked by: 01, 04
Implements: user stories 1-12, 17, 33, 55
Implements decisions: `capture-placement`, `setup-step-level-visibility`, `skip-defaults`, `scope-use-case-is-capture-point`, `readiness-opens-the-interview`, `when-the-profile-has-no-level-yet-is-the-a7d790b3`, `queued-depth-change-semantics`

Extend `grill-room/app/components/sessions/create-session-dialog.tsx` with a setup step before the session is created: depth (three choices with one-line plain help) and technical level pre-filled from `get-owner-profile`, with nothing selected when the profile has none. Skip creates the session with `DEFAULT_DEPTH` and leaves the profile untouched. A level pick writes through `set-owner-technical-level`. Pass depth into `create-session` so readiness runs after it.

Add a header control beside `grill-room/app/components/workspace/session-model-control.tsx` to edit depth and level at any round via the ticket 4 actions, with copy 'applies from the next round'; when `pendingDepth` is set, show 'applies when this step finishes'; when done has been proposed or a spec exists, warn that changing depth reopens the grill and marks the spec and tickets stale. Use 'readiness' and 'builder's call'; never 'preflight' or 'open question'. Add i18n keys in `grill-room/app/i18n/en-US.ts`.

Judged by: component tests for skip defaults, empty first-time level, pre-fill and write-back, pending indicator and stale warning; a Playwright spec `grill-room/e2e/depth-and-level.spec.ts` creating a session through the step and changing both values mid-grill.