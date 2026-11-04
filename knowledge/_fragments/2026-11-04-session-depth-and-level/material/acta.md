# Session record: depth and technical level before the grill

Claude Code session of 2026-11-04, working bead `gr-2sw` (Pipe's Grill Room ideas, meeting of 2026-09-29), theme "Scope how deep to grill". The owner (Jeremias De Isequilla) with Claude (claude-opus-5-5), run in the Grill Room app itself: session `73896582-d9fc-4c3c-bf82-c20106c906f2`, real interviewer, project `poc-grill-me`. Claude put each of the app's cards to the owner as a multiple-choice question, the interviewer's recommendation first. Written by Claude at the time of capture. The owner's choices are quoted as the option labels they picked; everything else is Claude's summary.

## Before round 1

Readiness judged the idea ready. The scout proposed eight repo decisions; the owner kept all eight, including "the scope use case is where technical level is captured, asked once at first setup". Claude recommended dropping that one, since it pre-answered a question the grill was meant to settle; the owner chose "Keep it".

## The owner's choices

Rounds 1 to 4 (20 cards):

1. Depth is asked per session: "Per session (Recommended)".
2. Technical level is stored in a new owner profile table that sessions reference, against the recommendation to carry it on the session: "New owner profile table".
3. Depth has three steps, proof of concept / first working version / full spec: "Three steps (Recommended)".
4. Technical level has three values, builder / technical but not building / not technical: "Three levels (Recommended)".
5. Both can change at any round and apply from the next round: "Both, from next round (Recommended)".
6. Technology questions for a non-technical owner are asked in outcome terms with a recommendation; the owner accepts it or leaves it to the builder: "Ask in outcome terms (Recommended)".
7. Technical level changes nothing after the interview: "Nothing downstream (Recommended)".
8. The owner is identified by real sign-in, against the recommendation of a named owner picked at session creation: "Real sign-in". Claude checked the code: the agent-native framework already ships Better Auth login, on unless `AUTH_DISABLED` is set, so the card's cost ("an authentication layer the app has never needed") was wrong, and the answer carried that note.
9. The two values are asked in a setup step at session creation, before readiness: "Setup at creation (Recommended)".
10. Skipping the step assumes first working version and not technical: "Middle depth, not technical (Recommended)".
11. Depth sets the done threshold and which branches open: "Done point + branches (Recommended)".
12. Level sets card wording, recommendations in consequences, and "Leave it to the builder" recommended for pure technology choices: "Wording + consequences (Recommended)".
13. Depth also sets the spec check's bar: "Interview + spec check bar (Recommended)".
14. A level change writes to the profile, read live: "Profile only, read live (Recommended)".
15. Readiness reads depth and scales its bar: "Reads depth, scales bar (Recommended)".
16. Existing sessions go to one migrated owner: "Assign to migrated owner (Recommended)".
17. The level lives in a separate table keyed by the auth user id, not on Better Auth's tables: "Separate profile table (Recommended)".
18. With `AUTH_DISABLED`, a fixed local owner is used: "Fixed local owner (Recommended)".
19. The setup step always shows the level, pre-filled: "Always, pre-filled (Recommended)".
20. A depth change before round 1 re-judges readiness; after round 1 the judgment stays and records its depth: "Re-judge before round 1 (Recommended)".

The owner confirmed the done summary: "Confirm (Recommended)".

## After the consistency check

The first export carried seven open consistency findings. Asked how to settle them, the owner chose "Ask them in the app (Recommended)": they went back into the interview as decisions.

21. The first user who signs in after the migration inherits the migrated sessions, against the recommendation of a named email: "First user to sign in".
22. First working version opens edge cases and skips scale and operations: "Edge cases yes, scale no (Recommended)".
23. First working version proposes done once every user-facing flow and its data are settled: "User flows + data (Recommended)".
24. A depth change made while a turn is working is stored and re-judged when the turn ends, against the recommendation to refuse it: "Store, re-judge after".
25. A depth change clears a "Grill it as is" override: "Clear it (Recommended)".
26. A re-judge that finds the idea ready mid-Sharpening lets the open round finish: "Finish the round (Recommended)".
27. A profile with no level shows nothing selected and saves nothing until the owner picks: "Nothing; save nothing (Recommended)".
28. Follow-up to 24: the latest queued value wins, one re-judge, and the control says it applies when the step finishes: "Latest wins + note (Recommended)".
29. Follow-up to 21: with `AUTH_DISABLED`, the local owner is the migration placeholder: "Local owner = placeholder (Recommended)".

The second check found two more:

30. A level set on the placeholder moves to the inheriting user if theirs is empty: "Move it if empty (Recommended)".
31. Depth stays editable once a spec exists; the spec, its check and the tickets are marked stale: "Editable, spec marked stale (Recommended)".

The third check found four more. Claude noted the count going 7, 2, 4 and asked how to end the loop; the owner chose "One more pass, then export (Recommended)".

32. Sharpening's cards follow the same level rules as the grill: "Both, same rules (Recommended)".
33. A depth change after done is proposed but before a spec exists withdraws the done proposal and reopens the frontier: "Yes, withdraw done (Recommended)".
34. Migrated readiness judgments carry no depth and the panel labels them as judged before depth existed: "Leave empty, label it (Recommended)".
35. Sessions created under the local owner after the inheritance go to the user who inherited first: "User who inherited first (Recommended)".

The fourth check found five more, exported open as the owner chose: three sit in briefs 02, 04 and 05 as questions the builder stops on, and two are attached to no brief (whether a level change after done withdraws it and marks the spec stale, and whether the briefs and handoff go stale with the spec).

## What it produced

The bundle `docs/specs/depth-and-technical-level/` and `.grill-room/depth-and-technical-level/`: spec, decisions, nine tickets in four waves, eight grounded briefs and four ADR suggestions. The owner chose to record the grill in this bundle in the same session, so ticket 08 (Record the decisions in the knowledge bundle) is covered by this capture.
