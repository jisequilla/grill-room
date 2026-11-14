# gr-bm7h: Setup step at session creation and the mid-grill settings control

Status: ready-for-agent
Blocked by: 01, 04
Implements: user stories 1-12, 17, 33, 55
Implements decisions: `capture-placement`, `setup-step-level-visibility`, `skip-defaults`, `scope-use-case-is-capture-point`, `readiness-opens-the-interview`, `when-the-profile-has-no-level-yet-is-the-a7d790b3`, `queued-depth-change-semantics`

## Intent

Tickets 01-04 store depth per session and level per owner and give actions to change both, but no screen asks for them: every session gets `DEFAULT_DEPTH` and the level stays empty. This ticket adds the setup step the owner sees when creating a session (`capture-placement`: "one more screen", before readiness runs) and a control in the session header to change both later.

Owner's choices for this ticket:
- Readiness stays a manual action. `create-session` stores the chosen depth; readiness judges at that depth when the owner clicks assess. No turn starts on create.
- The dialog has two screens. Screen 1 is today's form with its primary button renamed "Next". Screen 2, the setup step, has depth, level and the footer Cancel, Back, Skip, Create.
- The level is written to the profile only on Create, after the session is created, and only when the pick differs from the profile. Skip sends `DEFAULT_DEPTH` and writes no level, discarding picks. Cancel and Escape never change the profile.
- Decisions about what to send and which copy shows are pure functions in `app/lib/depth-level.ts`, unit-tested. Rendering is tested with static markup. Clicks are proved in Playwright. No DOM test environment and no new dependency.

## Behaviour

### The dialog's flow

- Opening the dialog always starts on screen 1. "Next" is screen 1's submit button and moves to screen 2; "Back" returns to screen 1 keeping the screen-2 picks for as long as the dialog stays open. Closing and reopening resets the picks: depth to `DEFAULT_DEPTH`, level to `levelOnProfileLoad`'s result.
- Screen 2's heading is `sessions.setupTitle`, with `sessions.setupDescription` under it. Screen 1 keeps "New session".
- A pick cannot be cleared: clicking the checked option again keeps it, as the answering-mode toggle's `if (value)` guard does (`create-session-dialog.tsx:279-283`).
- Escape keeps today's behaviour (`create-session-dialog.tsx:219-224`: blocked while title, idea or docs folder holds text, so always on screen 2); Cancel is screen 2's way out.
- Screen 2 has no submit button: Create, Skip and Back are `type="button"`, so Enter activates only the focused control. Next keeps today's `disabled={!canSubmit || isPending}` (`create-session-dialog.tsx:360`).
- Which screen-2 buttons are disabled comes from `setupActionsDisabled` (below): Create and Back wait for the profile and for a submission; Skip and Cancel wait only for a submission, since neither reads the profile. `profileLoaded` means the `get-owner-profile` query has settled, with data or with an error; on an error `profileLevel` is `null`, so a pick is written (a repeat of the stored level is harmless).
- `setLevel` goes through `useActionMutation("set-owner-technical-level")`, so the cached `get-owner-profile` refreshes and the next open pre-fills the new level.
- The `create-session` mutation keeps its `onError` (`create-session-dialog.tsx:185-195`), which sets the docs-folder hint or toasts as today. Its `onSuccess` work (clear the draft, close the dialog, `onCreated`) moves to after `submitSetup` resolves with `ok: true` or `failed: "level"`, so the session page opens only once the level write has landed or failed. `createSession` in `submitSetup` is the mutation's `mutateAsync`, resolving the created row `{ id }`. On `failed: "session"` the dialog only switches back to screen 1, so the error shows there and `e2e/session-draft.spec.ts`'s heading and error assertions hold unchanged. Nothing else toasts for it. On `failed: "level"` the session already exists and opens as on success; the dialog toasts `actionErrorMessage(error) ?? t("sessions.levelSaveFailed")`, and the level can be set from the header.
- The level on screen 2 always comes from `levelOnProfileLoad`, on open and when the profile arrives, never from `DEFAULT_TECHNICAL_LEVEL`. In `setupSubmission`, `pickedLevel` is the level screen 2 shows (pre-fill included); in `levelOnProfileLoad`, `pickedLevel` is the owner's own pick and `userPicked` says whether there is one.
- Depth and level are not stored in the unsent draft: `app/lib/session-draft.ts` is not in the Files list.

### `setupSubmission({ action, pickedDepth, pickedLevel, profileLevel })` → `{ depth, levelToWrite }`

| # | Input | Expected |
|---|---|---|
| S1 | `skip`, pickedDepth `full-spec`, pickedLevel `builder`, profileLevel `technical-not-building` | `{ depth: "first-working-version", levelToWrite: null }` |
| S2 | `create`, `proof-of-concept`, `technical-not-building`, `technical-not-building` | `{ depth: "proof-of-concept", levelToWrite: null }` |
| S3 | `create`, `first-working-version`, `builder`, `technical-not-building` | `{ depth: "first-working-version", levelToWrite: "builder" }` |
| S4 | `create`, `full-spec`, `null`, `null` | `{ depth: "full-spec", levelToWrite: null }` |
| S5 | `create`, `full-spec`, `not-technical`, `null` | `{ depth: "full-spec", levelToWrite: "not-technical" }` |
| S6 | `create`, `full-spec`, `null`, `builder` | `{ depth: "full-spec", levelToWrite: null }` (a level is never cleared) |
| S7 | `create`, `first-working-version`, `technical-not-building`, `technical-not-building` | `{ depth: "first-working-version", levelToWrite: null }` (Next then Create with nothing touched: the same as Skip) |

Mutations: S1 Skip keeping picks; S2 writing an unchanged level; S3 never writing; S4 writing `DEFAULT_TECHNICAL_LEVEL` for an empty profile; S5 comparing against `DEFAULT_TECHNICAL_LEVEL` instead of `profileLevel`; S6 `levelToWrite: pickedLevel ?? profileLevel`; S7 Create always sending `full-spec` or writing the pre-filled level.

### `levelOnProfileLoad({ userPicked, pickedLevel, profileLevel })` → the level screen 2 shows

The `modelIsUsersRef` guard (`create-session-dialog.tsx:104`, `:148`, `:159-163`), as a pure function.

| # | Input | Expected |
|---|---|---|
| P1 | `userPicked: false`, pickedLevel `null`, profileLevel `builder` | `"builder"` |
| P2 | `userPicked: true`, pickedLevel `not-technical`, profileLevel `builder` | `"not-technical"` |
| P3 | `userPicked: false`, pickedLevel `null`, profileLevel `null` | `null` |

Mutations: P1 ignoring the profile; P2 a late profile overwriting the pick; P3 `profileLevel ?? DEFAULT_TECHNICAL_LEVEL`.

### `submitSetup({ submission, setLevel, createSession })` → `Promise<{ ok: true, sessionId } | { ok: false, failed: "session", error } | { ok: false, failed: "level", sessionId, error }>`

The call order on Create and Skip, with the two action calls injected as closures: `createSession(depth)` wraps `mutateAsync` with the whole form plus `depth`, and `setLevel(level)` wraps the level mutation with `{ technicalLevel: level }`. The session is created first, so a refused create (a bad docs folder) never leaves the profile changed.

| # | Input | Expected |
|---|---|---|
| W1 | `levelToWrite: "builder"`, `createSession` resolves `{ id: "s1" }`, `setLevel` resolves | `createSession` called once with `"full-spec"` (the submission's depth), then `setLevel` once with `"builder"`; `{ ok: true, sessionId: "s1" }` |
| W2 | `levelToWrite: "builder"`, `createSession` rejects | `setLevel` not called; `{ ok: false, failed: "session", error }` |
| W3 | `levelToWrite: "builder"`, `setLevel` rejects | `{ ok: false, failed: "level", sessionId, error }` (the session exists) |
| W4 | `levelToWrite: null`, `createSession` succeeds | `setLevel` not called; `{ ok: true, sessionId }` |

Mutations: W1 the other order (assert `mock.invocationCallOrder`); W2 writing the level after a refused create; W3 dropping the session id on a level failure; W4 calling `setLevel` with null.

### `setupActionsDisabled({ profileLoaded, submitting })` → `{ create, back, skip, cancel }`

| # | Input | Expected |
|---|---|---|
| D1 | `profileLoaded: false, submitting: false` | `{ create: true, back: true, skip: false, cancel: false }` |
| D2 | `profileLoaded: true, submitting: true` | `{ create: true, back: true, skip: true, cancel: true }` |
| D3 | `profileLoaded: true, submitting: false` | `{ create: false, back: false, skip: false, cancel: false }` |

Mutations: D1 Create before the profile arrives (which would write a level the profile already holds), or Skip and Cancel waiting for a profile they never read; D2 a double submit, or a Cancel racing a write, while the first call is in flight; D3 buttons stuck disabled. `submitting` is a local flag set for the whole of `submitSetup`, not the create mutation's `isPending`.

### Screen 2 rendering

`SessionSetupStep` takes props `{ depth, level, onDepthChange, onLevelChange }` and queries nothing; the dialog owns the `get-owner-profile` query. Each depth option has test id `setup-depth-<value>`, each level option `setup-level-<value>`; a checked option carries `data-state="on"`.

| # | Input | Expected |
|---|---|---|
| R1 | `level: null` | no `setup-level-*` element carries `data-state="on"` (the assertion reads the three level elements only) |
| R2 | `level: "technical-not-building"` | only `setup-level-technical-not-building` carries `data-state="on"`; the three `setup-level-*` options render in `TECHNICAL_LEVELS` order, each with the exact label and help text of the Copy table, the help line inside its own option's `setup-level-<value>` element |
| R3 | `depth: "first-working-version"` | the three `setup-depth-*` options render in `DEPTHS` order, only `first-working-version` on, each with the exact label and help text of the Copy table, the help line inside its own `setup-depth-<value>` element |
| R4 | any | the markup holds the `sessions.depthLabel`, `sessions.levelLabel` and `sessions.setupDescription` text exactly |

Mutations: R1 a preselected `DEFAULT_TECHNICAL_LEVEL`; R2 a hard-coded level, or two levels' help texts swapped; R3 a missing help line or wrong order; R4 a missing description. `SessionSetupStep` renders the description and both group labels.

### `create-session` accepts depth

| # | Input | Expected |
|---|---|---|
| C1 | `depth: "full-spec"` | the row's `depth` is `full-spec` |
| C2 | no `depth` | the row's `depth` is `first-working-version` (passes on `main` today; planted bug: `depth: depth ?? "full-spec"` in the insert) |
| C3 | `depth: "deep"` | `createSession.run` rejects (as `set-owner-technical-level.test.ts`'s L3 calls `.run`) with a valid title and idea, so `depth` is the only invalid field, and the same call with `depth: "full-spec"` then succeeds; no row is inserted by the rejected call |

### Header control: `depthControlState(input)` → `{ shownDepth, disabled, noteKey, warningKeys }`

Input: `{ hasRound, state, turnStatus, depth, pendingDepth, specCurrent }`. `started` = `hasRound || state !== "interviewing"` (as `set-session-depth.ts:45`). `specCurrent` = `get-spec` returns a spec whose `current` is true. Rule: `shownDepth` = `pendingDepth ?? depth`; `disabled` = `started && turnStatus === "working"`; `noteKey` = pending note when `pendingDepth` is set, or before start while a turn is working (a pick then queues, `set-session-depth.ts:49-53`), else "applies now" before start, else "next round"; `depthReopensWarning` when `state` is `done-proposed` or `confirmed`; `depthStaleWarning` when `specCurrent` and `state` is not `done-proposed` (leaving `done-proposed` marks no spec: `server/session-state.ts:39-52`, `set-session-depth.ts:81-85`). Warnings render below the control whenever the list is non-empty, before any pick, with test ids `depth-warning-reopens` and `depth-warning-stale`; the note has test id `depth-control-note`.

| # | hasRound | state | turnStatus | depth | pendingDepth | specCurrent | Expected |
|---|---|---|---|---|---|---|---|
| H1 | false | interviewing | idle | first-working-version | null | false | `{ shownDepth: "first-working-version", disabled: false, noteKey: "workspace.depthAppliesNow", warningKeys: [] }` |
| H2 | false | interviewing | working | first-working-version | full-spec | false | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] }` |
| H3 | false | interviewing | working | first-working-version | null | false | `{ shownDepth: "first-working-version", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] }` |
| H4 | false | interviewing | failed | first-working-version | full-spec | false | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesWhenStepFinishes", warningKeys: [] }` |
| H5 | true | interviewing | idle | full-spec | null | false | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: [] }` |
| H6 | true | interviewing | working | full-spec | null | false | `{ shownDepth: "full-spec", disabled: true, noteKey: "workspace.depthAppliesNextRound", warningKeys: [] }` |
| H7 | false | done-proposed | working | proof-of-concept | null | false | `{ shownDepth: "proof-of-concept", disabled: true, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] }` |
| H8 | true | done-proposed | idle | full-spec | null | false | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] }` |
| H9 | true | interviewing | idle | full-spec | null | true | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthStaleWarning"] }` |
| H10 | true | confirmed | idle | full-spec | null | true | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning", "workspace.depthStaleWarning"] }` |
| H11 | true | done-proposed | idle | full-spec | null | true | `{ shownDepth: "full-spec", disabled: false, noteKey: "workspace.depthAppliesNextRound", warningKeys: ["workspace.depthReopensWarning"] }` |

Mutations: H2 showing `depth` while a change is queued; H3 keying the pending note on `pendingDepth` alone, so the note before a pick says "applies now" for a pick that will queue; H4 hiding the queue after a failed turn; H6 an enabled control the server refuses; H7 `disabled` tied to `state === "interviewing"` and `started` read from rounds alone; H8 and H9 each one warning with the other condition false; H10 a missing `confirmed` or a reversed order; H11 the stale warning on `done-proposed`.

### `changedValue(current, picked)` → `picked | null`

Used by both header controls: a pick equal to the current value makes no call. For depth, `current` is `shownDepth`, so picking the stored depth while another is queued makes a call, which clears the queue on the server (`set-session-depth.ts:49-53`).

| # | Input | Expected |
|---|---|---|
| X1 | `("full-spec", "full-spec")` | `null` |
| X2 | `("full-spec", "proof-of-concept")` | `"proof-of-concept"` |
| X3 | `(null, "builder")` | `"builder"` |

### Header control rendering

`SessionDepthLevelControl` takes props `{ sessionId, depth, pendingDepth, state, turnStatus, technicalLevel, hasRound, specCurrent, onChanged }`; the route owns the `list-rounds` and `get-spec` queries and passes `hasRound` (`rounds === undefined ? undefined : rounds.rounds.length > 0`, from `list-rounds`' `{ sessionId, rounds }`) and `specCurrent` (`spec === undefined ? undefined : spec.spec?.current === true`) as `undefined` until each has loaded. While either is `undefined` the whole control, level included, renders nothing. Once it renders, both `depth-control-note` and `level-control-note` always render. Test ids: `depth-control`, `level-control`, `depth-control-note`, `level-control-note`, `depth-warning-reopens`, `depth-warning-stale`. A depth change calls `set-session-depth` with `{ sessionId, depth }`; a level change calls `set-owner-technical-level` with `{ technicalLevel }`. Errors show inline with `actionErrorMessage(error) ?? t("workspace.depthChangeFailed")` (or `levelChangeFailed`), as `session-model-control.tsx` does.

| # | Input | Expected (static markup) |
|---|---|---|
| N1 | `hasRound: undefined`, everything else as H5 | the markup is empty (nothing guessed before load) |
| N2 | H10's inputs | `depth-warning-reopens` reads "Changing depth reopens the grill." and `depth-warning-stale` reads "Changing depth marks the spec, its tickets and the consistency check stale.", visible without opening the select; `depth-control-note` reads "Applies from the next round." |
| N4 | `specCurrent: undefined`, everything else as H9 | the markup is empty |
| N3 | H6's inputs, `technicalLevel: null` | `depth-control` is disabled; `level-control` is not disabled and shows "Not set"; `level-control-note` reads "Applies from the next round, in every session." |

Mutations: N1 rendering with `started` defaulted to false; N4 rendering with the stale warning defaulted off; N2 a warning list computed but not rendered; N3 the level control sharing the depth control's `disabled`.

### Copy (en-US, exact)

| Key | Text |
|---|---|
| `sessions.next` | Next |
| `sessions.back` | Back |
| `sessions.skip` | Skip |
| `sessions.setupTitle` | Set up the grill |
| `sessions.setupDescription` | How far to grill this idea, and how technical you are. You can change both later. |
| `sessions.depthLabel` | Depth |
| `sessions.levelLabel` | Your technical level |
| `sessions.levelSaveFailed` | Could not save your technical level. |
| `sessions.depthProofOfConcept` | Proof of concept |
| `sessions.depthProofOfConceptHelp` | Enough to see whether it works at all. |
| `sessions.depthFirstWorkingVersion` | First working version |
| `sessions.depthFirstWorkingVersionHelp` | Enough for people to use it. |
| `sessions.depthFullSpec` | Full spec |
| `sessions.depthFullSpecHelp` | Nothing left to the builder's call. |
| `sessions.levelBuilder` | I build software |
| `sessions.levelBuilderHelp` | Cards can name technologies and trade-offs. |
| `sessions.levelTechnicalNotBuilding` | Technical, not building this |
| `sessions.levelTechnicalNotBuildingHelp` | Cards can be technical; the builder makes the build calls. |
| `sessions.levelNotTechnical` | Not technical |
| `sessions.levelNotTechnicalHelp` | Cards stay in plain language; technology is the builder's call. |
| `workspace.depthSelectLabel` | Session depth |
| `workspace.levelSelectLabel` | Your technical level |
| `workspace.levelNotSet` | Not set |
| `workspace.depthAppliesNow` | Applies now; a readiness judgment already made is redone at the new depth. |
| `workspace.depthAppliesWhenStepFinishes` | Applies when this step finishes. |
| `workspace.depthAppliesNextRound` | Applies from the next round. |
| `workspace.levelAppliesNextRound` | Applies from the next round, in every session. |
| `workspace.depthReopensWarning` | Changing depth reopens the grill. |
| `workspace.depthStaleWarning` | Changing depth marks the spec, its tickets and the consistency check stale. |
| `workspace.depthChangeFailed` | Could not change the depth. |
| `workspace.levelChangeFailed` | Could not change your technical level. |

V1: no value of a key in this table contains "preflight", "pre-flight" or "open question" (case-insensitive). The check reads exactly these keys from `en-US.ts`, never the whole file, which already holds "Pre-flight" and "Open question" elsewhere. Planted bug: `sessions.depthFullSpecHelp` = "Nothing left for pre-flight."; V1 fails.

Label and help keys are reached through `DEPTH_LABEL_KEY`, `DEPTH_HELP_KEY`, `TECHNICAL_LEVEL_LABEL_KEY` and `TECHNICAL_LEVEL_HELP_KEY` in `app/lib/session-labels.ts`, each a `Record` over its union type.

## Pattern to copy

- The header select: `app/components/workspace/session-model-control.tsx`. Mount the new control after it in the header row at `app/routes/sessions.$sessionId.tsx:492-497`; `rounds` (`:274`) gives `hasRound`; `useActionQuery("get-spec", { sessionId })` as `app/components/output/spec-section.tsx:58`.
- The late-arriving default: `modelIsUsersRef` in `create-session-dialog.tsx:104`, `:148`, `:159-163`.
- The profile query: as `useActionQuery("list-projects", {})` at `create-session-dialog.tsx:98`.
- Label maps: `MODEL_LABEL_KEY` in `app/lib/session-labels.ts`.
- Static-markup tests that assert real copy: `app/components/workspace/decision-detail-sheet.test.tsx:15-45` mocks `@agent-native/core/client/hooks` and `useT`, but its `useT` resolves only `workspace.setAsideKind*` and two named keys. Generalize it: resolve any `section.key` path against `@/i18n/en-US`'s default export (`import messages from "@/i18n/en-US"`), copying the mock into each new test file and touching no existing test, so `sessions.*` and `workspace.*` keys render their English text. Without the mock keys render humanized (`brief-strip.test.tsx:10-24`).
- `create-session`'s schema and insert: `actions/create-session.ts:14-49`, `:75-87`.
- Fake scenarios over HTTP: `chooseScenario` in `e2e/support.ts:47`. A round opens with the default scenario through the start panel, as `smoke.spec.ts` does; `deferral` reaches `done-proposed` as `e2e/deferral.spec.ts:27-45` does; `answerRoundToDeferral` there is not exported, so copy it into the new spec.
- Setting the profile over HTTP: POST to `/_agent-native/actions/set-owner-technical-level`, as `chooseScenario` posts `use-fake-scenario`.

## Acceptance

1. S1-S7, P1-P3, H1-H11, X1-X3, D1-D3: proved by `app/lib/depth-level.test.ts` › "setupSubmission S1" … "S7", "levelOnProfileLoad P1" … "P3", "depthControlState H1" … "H11", "changedValue X1" … "X3", "setupActionsDisabled D1" … "D3", each a `toEqual` (or `toBe`) on the whole result.
2. W1-W4: proved by `app/lib/depth-level.test.ts` › "submitSetup W1" … "W4", with `vi.fn` fakes; W1 asserts the call order (`mock.invocationCallOrder`).
3. R1-R4: proved by `app/components/sessions/session-setup-step.test.tsx` › "R1" … "R4". N1-N4: proved by `app/components/workspace/session-depth-level-control.test.tsx` › "N1" … "N4".
4. C1-C3: proved by `actions/create-session.test.ts` › "C1 stores the chosen depth", "C2 defaults the depth", "C3 rejects an unknown depth".
5. V1: proved by `app/lib/depth-level.test.ts` › "V1 new copy avoids preflight and open question", with the planted bug above.
6. The wiring: proved by `e2e/depth-and-level.spec.ts`, `test.describe.configure({ mode: "serial" })`, each test setting its starting level over HTTP first:
   - "creates a session through the setup step": level set to `technical-not-building`; Next shows the heading "Set up the grill" and `setup-level-technical-not-building` on; pick Full spec and "I build software", Back, Next: `setup-depth-full-spec` and `setup-level-builder` are still on (planted bug: Back resets the picks); click `setup-level-builder` and `setup-depth-full-spec` again: both stay on (planted bug: drop either group's `if (value)` guard); press Escape: the "Set up the grill" heading is still visible (planted bug: screen 2 lets Escape close); Create; `get-session` returns `depth: "full-spec"`, `technicalLevel: "builder"`, `turnStatus: "idle"` and `readinessJson: null`, read again after `expect.poll` has waited 3 s for any change (no turn starts on create; planted bug: the dialog calls `assess-readiness` after create).
   - "create with nothing touched sends the defaults": level set to `builder`; Next, Create; `get-session` returns `depth: "first-working-version"` and `technicalLevel: "builder"`.
   - "skip keeps the defaults and the profile": level set to `builder`; Next, pick Proof of concept and Not technical, Skip; `get-session` returns `depth: "first-working-version"` and `technicalLevel: "builder"` (planted bug: Skip calls `setLevel` with the picked level).
   - "cancel leaves the profile and reopening resets": level set to `builder`; Next, pick Full spec and Not technical, Cancel; `get-owner-profile` returns `builder` (planted bug: Cancel saves the picked level); reopen, fill nothing new, Next: `setup-depth-first-working-version` and `setup-level-builder` are on (planted bug: the level initialized from `DEFAULT_TECHNICAL_LEVEL` instead of `levelOnProfileLoad`).
   - "a failed level save still opens the session": level set to `builder`; `page.route` holds the POST to `set-owner-technical-level` for 1.5 s, then aborts it; Next, pick Not technical, Create; at 1 s the "Set up the grill" heading is still visible and the URL unchanged (planted bug: `onCreated` fires before the level write settles); then the URL becomes the new session's and the toast "Could not save your technical level." shows (planted bug: the dialog swallows the failure or stays open).
   - "a failed profile load still allows Create": `page.route` aborts the GET of `get-owner-profile`; Next; nothing is checked in the level group; pick "I build software", Create; the session opens (planted bug: `profileLoaded = Boolean(data)`, so Create never enables).
   - "a double click on Create makes one session": level set to `builder`; Next, double-click Create; `list-sessions` holds exactly one more session than before (planted bug: `submitting` not set, so D2 is never reached).
   - "changes depth and level from the header": level set to `builder`; a session with one round; change depth to Proof of concept and level to Not technical; `get-session` returns `depth: "proof-of-concept"` and `technicalLevel: "not-technical"`, and `depth-control-note` reads "Applies from the next round.".
   - "warns before a depth change reopens a proposed grill": the `deferral` scenario to `done-proposed`; `depth-warning-reopens` reads "Changing depth reopens the grill." (planted bug: the reopen warning keyed on `confirmed` alone). The stale warning's absence on `done-proposed` is H11's, not this test's: the session has no spec.
7. Existing flows still pass: `just e2e` and `just e2e-demo` green, with `e2e/support.ts` `createSession` clicking Next then Skip, and one `Next` click added before each "Create" click that follows screen 1 in `adr-suggestions.spec.ts:61`, `demo.spec.ts:110`, `export-durable-ignored.spec.ts:68`, `export-retired.spec.ts:68` and `:191`, `export-visibility-unchecked.spec.ts:114`, `handoff-bundle-paths.spec.ts:78`, `handoff-regenerate.spec.ts:81`, `new-session-in-project.spec.ts:142`, `session-draft.spec.ts:53` and `:78`, `sidebar.spec.ts:39`, `smoke.spec.ts:155` (13 clicks in 11 files). Next then Create with nothing touched sends what Skip sends (S7), and a refusal returns to screen 1, so no other line of those specs changes. To find them, grep `e2e/` for `name: "Create", exact: true`; the grep only locates the clicks, and `just e2e` is the proof.

Accepted without a test of their own (the reviewer reads them in the diff):
- Next's disabling, which is today's code kept as it is (`create-session-dialog.tsx:360`).
- Enter on screen 2 activating only the focused control, which follows from `type="button"`.
- The header controls calling `changedValue` before a mutation, and their inline `depthChangeFailed` / `levelChangeFailed` text, which copy `session-model-control.tsx`.
- No second toast on `failed: "session"`.

## Files

- `grill-room/actions/create-session.ts`, `grill-room/actions/create-session.test.ts`
- `grill-room/app/lib/depth-level.ts` (new), `grill-room/app/lib/depth-level.test.ts` (new)
- `grill-room/app/lib/session-labels.ts`
- `grill-room/app/components/sessions/create-session-dialog.tsx`
- `grill-room/app/components/sessions/session-setup-step.tsx` (new), `grill-room/app/components/sessions/session-setup-step.test.tsx` (new)
- `grill-room/app/components/workspace/session-depth-level-control.tsx` (new), `grill-room/app/components/workspace/session-depth-level-control.test.tsx` (new)
- `grill-room/actions/set-session-depth.ts`: its `description` string only, corrected the same way as the `AGENTS.md` row below
- `grill-room/app/routes/sessions.$sessionId.tsx` (mount and the `get-spec` query only)
- `grill-room/app/i18n/en-US.ts` (the Copy table's keys; other locales fall back and are not edited)
- `grill-room/e2e/depth-and-level.spec.ts` (new), `grill-room/e2e/support.ts`, and the 11 spec files of acceptance 7 (only the added `Next` lines)
- `grill-room/AGENTS.md`: the `create-session` row gains the optional `depth` (one of `DEPTHS`, `DEFAULT_DEPTH` when omitted); the `set-session-depth` row's after-start sentence is corrected to say a `confirmed` or `interviewing` session's spec is marked not current, and a `done-proposed` one's is not (`server/session-state.ts:39-52`)

## Builds on

- Actions: `actions/get-owner-profile.ts`, `actions/set-owner-technical-level.ts`, `actions/set-session-depth.ts`, `actions/get-spec.ts`; `get-session` returning `depth`, `pendingDepth`, `turnStatus`, `state` and `technicalLevel` (`actions/get-session.ts:30-40`).
- Constants: `DEPTHS`, `DEFAULT_DEPTH`, `TECHNICAL_LEVELS`, `DEFAULT_TECHNICAL_LEVEL` in `shared/session-constants.ts:165-191`.
- `SessionModelControl` (`app/components/workspace/session-model-control.tsx`); `createSession` and `chooseScenario` (`e2e/support.ts:11`, `:47`); the `deferral` fake scenario (`server/interviewer/fake.ts:264`, turns at `:1122`).

## Verify

From `grill-room/`: `pnpm test`, `pnpm typecheck`, `pnpm lint` (exit 0, no findings), and from the repo root `just e2e` and `just e2e-demo` (all green). Look at screen 2 and the header control with `agent-browser` against the worktree's own server (free port, `AUTH_DISABLED`, fake interviewer, isolated `DATABASE_URL`); its screenshot subcommand is broken here, so take screenshots with a one-off `playwright-core` script against that server.

## Open questions

None.
