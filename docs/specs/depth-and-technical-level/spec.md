# Depth and technical level before the grill

Status: ready-for-agent

## Summary

- Every person who signs in to Grill Room is an Idea owner with one saved technical level: builder, technical but not building, or not technical. It is asked at first setup and shown again, pre-filled, at the start of every session so it can be corrected.
- When an owner opens an idea, a short setup step asks how deep to grill: a proof of concept, a first working version, or a full spec. The step can be skipped; skipping assumes a first working version and plain wording, without recording a level the owner never chose.
- The interviewer pitches every card to both values, including the Sharpening cards that come before the first round. A proof of concept skips scale, edge-case and operations questions; a first working version takes edge cases but not scale or operations; a full spec asks everything. Done is proposed sooner at shallower depths.
- A non-technical owner is never forced to pick technology. Technology questions still appear, phrased as consequences such as cost or speed, and the recommended answer is to leave them to the builder.
- Depth and level can be changed at any time from a settings control. Changing depth before the first round re-runs the readiness check and clears any 'Grill it as is' override. Changing depth after done was proposed withdraws that proposal and reopens the grill; if a spec exists it and the tickets are marked stale for regeneration on request.
- Readiness, the opening check of whether the idea is clear enough, lowers its bar for shallower depths and still only warns, never blocks.
- The spec names the depth and allows more to be left to the builder at shallower depths. Tickets and handoff are otherwise unchanged, and nothing after the interview varies with technical level.
- Sign-in uses the login the framework already ships; no new accounts system is built. A local install with login switched off has one fixed owner. Existing sessions, and any level set locally, pass to the first real user who signs in, and later local sessions follow that same user.
- Out of scope: a per-owner default depth, a plain-language handoff document, coarser tickets at low depth, any change to readiness after round 1, automatic regeneration after a depth change, and free-text depth or level.

## Problem Statement

Grill Room was built for one technical Idea owner who makes the technology calls and wants an exhaustive interview. Its second real user is not technical, will not say what to build, and does not always want a full spec. Nothing in the session, the schema or the interviewer's instructions records how deep to grill or how technical the owner is, so every owner gets the same technical, full-length interview. A non-technical owner meets cards they cannot answer and a grill that does not stop where their ambition stops. A technical owner cannot ask for a quick proof of concept without being grilled as if for a full spec.

## Solution

Grill Room captures two values and pitches the interview to both. Technical level is a trait of the one Idea owner role, stored once per signed-in owner in an owner profile. Depth is a property of each session, chosen when the idea is opened. A setup step at session creation, before readiness runs, asks depth and shows the level pre-filled for correction. Both can be changed at any round and apply from the next one. The interviewer, including Sharpening, reads both every turn: depth decides which branches open and when done is proposed; level decides card wording, how recommendations are phrased, and whether technology choices default to the builder. Readiness and the spec check read depth so a proof-of-concept owner is neither warned about full-spec gaps nor nagged about decisions they chose to leave to the builder.

## User Stories

1. As an Idea owner, I want to be asked my technical level at first setup, so that the interviewer never assumes I will choose technology I do not understand.
2. As an Idea owner, I want three technical levels (builder, technical but not building, not technical), so that the interviewer knows both how to word cards and whether I make technology calls.
3. As an Idea owner who follows technical talk but will not build, I want the middle level, so that I get technical wording without being asked to pick the stack.
4. As an Idea owner, I want to be asked how deep to grill each time I open an idea, so that a quick experiment and a full product get different interviews.
5. As an Idea owner, I want three depth steps (proof of concept, first working version, full spec), so that I can name a usable first version without choosing an extreme.
6. As an Idea owner, I want the setup step to appear at session creation before anything is judged, so that readiness already knows my depth.
7. As an Idea owner, I want the setup step to be skippable, so that nothing stops me opening a round.
8. As an Idea owner who skips the setup step, I want the interviewer to assume a first working version and plain wording, so that a wrong guess costs me little.
9. As a first-time Idea owner, I want the level shown with nothing selected, so that the profile only ever records a choice I actually made.
10. As a first-time Idea owner who creates a session without picking a level, I want to be asked again next session, so that the skip default stays a runtime assumption rather than a recorded fact.
11. As a returning Idea owner, I want my level shown pre-filled on every session start, so that I can see what the interviewer assumes and fix it in place.
12. As an Idea owner, I want a level change in the setup step to save to my profile, so that the correction follows me to later sessions.
13. As an Idea owner, I want to change depth in the middle of a grill, so that I can go deeper or shallower once I see where the questions lead.
14. As an Idea owner, I want to change my level in the middle of a grill, so that cards that are too technical or too simple are corrected from the next round.
15. As an Idea owner, I want a mid-session level change to update my profile, so that my next session does not ask me again.
16. As an Idea owner, I want already-asked cards to stay as they were after a change, so that my earlier answers are not disturbed.
17. As an Idea owner, I want the settings control to say a change applies from the next round, so that I am not confused when the current round does not move.
18. As a non-technical Idea owner, I want technology questions put to me as consequences such as cost, speed and lock-in, so that I can weigh them without knowing the technologies.
19. As a non-technical Idea owner, I want 'Leave it to the builder' recommended for pure technology choices, so that I can move on in one action.
20. As a non-technical Idea owner, I want choices with owner-visible consequences still shown to me, so that nothing with a cost or hosting implication is decided behind my back.
21. As an Idea owner, I want the interviewer never to record its own recommendation as my settled decision, so that the spec holds only choices I made.
22. As a non-technical Idea owner whose idea is not ready, I want Sharpening cards worded to my level with the same recommendation shape, so that the first thing I meet is not a technical card.
23. As a proof-of-concept Idea owner, I want scale, edge-case and operations branches skipped, so that my early rounds go to what matters for the experiment.
24. As a proof-of-concept Idea owner, I want the interviewer to propose being done once the core thing to try is settled, so that the grill ends where my ambition ends.
25. As a first-working-version Idea owner, I want edge-case branches opened but scale and operations skipped, so that my first release survives odd inputs without being grilled about load or on-call.
26. As a first-working-version Idea owner, I want done proposed when every user-facing flow and its data are settled, with technology and operations allowed as builder's calls, so that the grill matches a real first release.
27. As a full-spec Idea owner, I want every branch opened and done held until nothing is left to the builder's guesswork, so that the builder has no gaps.
28. As a proof-of-concept Idea owner, I want readiness to judge my idea against a lower bar, so that I am not sent into Sharpening for a full-spec gap.
29. As an Idea owner who changes depth before round 1, I want readiness re-run automatically, so that its warning matches the depth I chose.
30. As an Idea owner who had chosen 'Grill it as is' and then changes depth before round 1, I want that override cleared so the new judgment decides again, with the option to override again in one tap.
31. As an Idea owner who changes depth while a readiness or Sharpening turn is working, I want the change stored and the re-judge run when the turn ends, so that I am never blocked.
32. As an Idea owner who changes depth twice while a turn is working, I want only the latest value applied and one re-judge run, so that stale judgments are not produced.
33. As an Idea owner with a pending depth change, I want the control to say it applies when the current step finishes, so that I know the change took.
34. As an Idea owner in Sharpening whose depth change makes the idea ready, I want the open Sharpening round to finish and then stop, so that my in-progress answers are kept and seed decisions.
35. As an Idea owner who changes depth after round 1, I want the stored readiness judgment left as it was and marked with the depth it was made at, so that I can tell it may be stale.
36. As an Idea owner with a session from before depth existed, I want its readiness judgment shown as judged before depth existed rather than stamped with a depth it never saw, so that the record stays honest.
37. As an Idea owner who changes depth after the interviewer proposed done but before any spec exists, I want the done proposal withdrawn and the frontier reopened at the new depth, so that the branches the new depth opens actually get asked.
38. As an Idea owner who changes depth after a spec exists, I want depth to stay editable and the spec, its check and the tickets marked stale, so that I can widen a proof of concept into a full spec without starting over.
39. As an Idea owner with a stale spec after a depth change, I want to trigger regeneration myself rather than have it run unasked, so that an expensive turn is never started by a settings change.
40. As a proof-of-concept Idea owner, I want the spec check to allow more to be left to the builder, so that it does not flag gaps I chose to leave.
41. As a builder reading the spec, I want the depth named in it, so that I know how much was deliberately left to me.
42. As a builder, I want the 'Left to the builder' list to carry a non-technical owner's set-asides, so that I know which calls are mine.
43. As a non-technical Idea owner, I want the spec Summary in plain words, so that I can read what was decided without technical knowledge.
44. As a builder, I want the spec and tickets written for me regardless of the owner's level, so that I never receive an under-specified spec.
45. As an Idea owner, I want to sign in with the login Grill Room already has, so that my technical level follows me across sessions and devices.
46. As a second Idea owner on the same deployment, I want my own technical level, so that I am not grilled at someone else's level.
47. As a developer running Grill Room locally with login switched off, I want a single fixed owner created on first run, so that I can still set a level once and keep it.
48. As the existing owner, I want my past sessions to belong to the first real user who signs in after the migration, once, so that my history lands under my account without configuration.
49. As the existing owner who set a level while login was off, I want that level to move to my real profile when I first sign in and my profile is still empty, so that I am not asked again.
50. As a developer running locally, I want migrated sessions to belong to the fixed local owner directly, so that no hand-off step is needed in local mode.
51. As the owner who inherited the migrated sessions, I want sessions created later with login switched off to come to me when login returns, so that no local work is stranded or handed to a stranger.
52. As an operator, I want the technical level kept in its own profile table rather than on the framework's user table, so that framework upgrades do not break it.
53. As a developer, I want sessions to reference the owner and read the level live rather than copying it, so that there is one source of truth.
54. As an Idea owner, I want readiness to keep warning and never blocking, so that depth and level never stop a round from opening.
55. As an Idea owner, I want the terms 'readiness' and 'builder's call' used consistently in the setup step and settings control, so that the words match the rest of the product.

## Implementation Decisions

Values

- Technical level is an enumerated trait of the one Idea owner role with three values: builder, technical but not building, not technical. It is not a second role.
- Depth is an enumerated per-session value with three steps: proof of concept, first working version, full spec.
- Runtime defaults when nothing is picked: depth is first working version, level is not technical. The level default is never written to the profile.

Identity and storage

- The owner is the signed-in user from the Better Auth login the agent-native framework already ships. No new authentication layer is built.
- Technical level lives in a separate owner profile table keyed by the auth user id, created lazily. The framework's own user table is not modified.
- Sessions carry a non-nullable owner reference, a depth column, and a pending-depth column for a change queued behind a working turn. Sessions carry no technical-level column; the level is read live from the profile every turn.
- The stored readiness judgment carries the depth it was made at. Judgments that predate depth keep the field empty and the readiness panel labels them as judged before depth existed.
- With AUTH_DISABLED, a fixed local owner profile is created on first run and used for every session.
- Migration assigns all existing sessions to a placeholder owner whose id is the fixed local owner id. With login on, the first user who signs in after the migration inherits the placeholder's sessions; if that user's profile has no level and the placeholder has one, the level moves too; the placeholder row is removed and the inheriting user id is recorded. If login is later switched off and sessions are created under the fixed local owner, they are reassigned to that recorded inheritor when a user next signs in. With login off, the fixed local owner simply owns them.

Capture and change

- A setup step runs at session creation, before readiness, for every session. It asks depth and shows technical level pre-filled from the profile and editable in place. With no stored level, nothing is preselected. The step is skippable; creating a session without a level pick leaves the profile empty.
- Sharpening and the readiness view are not the capture point.
- Both values are editable at any round from a settings control and apply from the next round. A level change writes to the profile; a depth change writes to the session.
- A depth change before round 1 re-judges readiness automatically and clears any 'Grill it as is' override. If a turn is working, the change is stored as pending, the latest value wins, the control shows that it applies when the current step finishes, and one re-judge runs when the turn ends. If that re-judge lands during Sharpening and finds the idea ready, Sharpening finishes its open round and then stops.
- After round 1 a depth change does not touch the stored judgment.
- After done has been proposed, a depth change withdraws the done proposal and reopens the frontier at the new depth. If a spec has been synthesized, the spec, its consistency check and the tickets are marked stale; regeneration runs only when the owner triggers it.
- This departs from the recorded use case only in that depth is per session rather than once at first setup.

Interviewer

- The prompt builder takes depth and technical level as inputs every turn, for grill rounds and for Sharpening alike.
- Depth rules: proof of concept skips scale, edge-case and operations branches and proposes done once the core thing to try is settled; first working version opens edge-case branches, skips scale and operations, and proposes done when every user-facing flow and its data are settled, with technology and operations allowed as builder's calls; full spec opens every branch and holds done until nothing is left to the builder's guesswork.
- Level rules: builder keeps technical wording; technical but not building keeps technical wording but phrases recommendations as consequences and recommends 'Leave it to the builder' for pure technology choices with no owner-visible consequence; not technical uses plain wording with the same recommendation shape. Technology cards are never suppressed. The interviewer never records its own recommendation as settled. When the owner accepts the recommendation or picks the choice labelled 'Leave it to the builder', the app records that decision as a builder's call, exactly as setting it aside as the builder's call does.

Readiness and downstream

- Readiness takes depth as an input and scales what counts as ready. It still warns and never blocks and is only requested before round 1. Sharpening receives the same depth and level.
- The spec check takes depth as an input: at lower depths more may be left to the builder. The spec names the depth. Tickets derive from the spec with no branch of their own.
- Technical level changes nothing downstream; the plain-words Summary and 'Left to the builder' list already serve a non-technical owner.

Knowledge bundle

- The scope-how-deep use case and the Idea owner role record depth as per session and level as per owner; the owner profile table and the no-level-on-sessions rule are recorded as architectural decisions.

## Testing Decisions

- A good test exercises external behaviour: given an owner level and session depth, the prompt the interviewer receives, the readiness verdicts the server accepts, the stale marks, the done-proposal state and the stored rows. Each depth and level section of a prompt is held in an exported constant, and tests assert that it is present for its value and absent for the others, never a snapshot of the whole prompt. Which findings the spec check reports is the model's judgment, so tests assert the bar its prompt carries, not the findings.
- Modules under test: session creation with the setup step and its defaults, the owner profile table and lazy creation, the AUTH_DISABLED fixed owner, the migration placeholder with first-sign-in inheritance of sessions and level and the later reassignment of local sessions to the recorded inheritor, the prompt builder's depth and level inputs per step and per level for both grill and Sharpening, readiness with depth and the empty-depth label for pre-existing judgments, the pre-round-1 re-judge including override clearing and queued latest-wins behaviour, Sharpening finishing its round on a ready re-judge, the post-done depth change withdrawing the proposal and marking artifacts stale, the spec check's depth-scaled bar, and the mid-session change path with profile write-back.
- Prior art: the existing readiness tests that judge an idea before round 1, the existing spec check tests that validate a finding's shape, and the existing stale-review tests, each extended with a depth parameter.

## Out of Scope

- A per-owner default depth or precedence rule between owner and session depth.
- A session-level override of technical level separate from the profile.
- A plain-language handoff document or a spec rewritten to the owner's level.
- Coarser tickets at lower depth beyond what follows from the spec.
- Re-judging readiness after round 1 or lifting the pre-round-1 lock.
- Automatic regeneration of the spec or tickets after a depth change.
- Recording a builder's call the owner did not choose: only accepting or picking 'Leave it to the builder', or setting a decision aside as the builder's call, records one.
- Free-text technical level or depth.
- Any new authentication beyond the framework's existing login.
- A configured email for migrated-session inheritance.

## Further Notes

- The owner profile table keyed by the Better Auth user id, with sessions referencing the user and carrying no level column, is the architecturally significant decision and should be recorded as an ADR.
- Inheritance of migrated sessions and level by the first user to sign in is a one-time, unconfigured hand-off; on a shared deployment the operator should ensure the intended owner signs in first. Later local sessions follow that recorded inheritor.
- The vocabulary is 'readiness', never 'preflight', and 'builder's call', never 'open question'.