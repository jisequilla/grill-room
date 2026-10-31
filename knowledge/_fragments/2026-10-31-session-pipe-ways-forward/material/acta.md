# Session record: the ways forward for Pipe's two points

Claude Code session of 2026-10-31, working bead `gr-2sw` (Pipe's Grill Room ideas, meeting of 2026-09-29). The owner (Jeremias De Isequilla) with Claude (claude-opus-5-5), through multiple-choice questions. Written by Claude at the time of capture. The owner's words are quoted literally; everything else is Claude's summary.

## The evidence

Claude read the code before asking. At finish, a loose end can be set aside as out of scope or as a named open question (`dispositionTarget` `open-question`, `grill-room/actions/synthesize-spec.ts:181`). Synthesis puts those under Further Notes, and the handoff lists them under "Questions the spec and tickets leave open" (`grill-room/server/handoff.ts:1511`), asking for the owner's answer before delegating.

The readiness panel (`grill-room/app/components/workspace/readiness-panel.tsx`) shows objective, evidence, expected outcome, unknowns and missing, and offers only Re-assess. Its copy says it only warns. "Edit idea" is a separate control.

## The owner's choices

Option labels are quoted as chosen.

1. Setting a loose end aside offers two kinds: "Two kinds". An open question stays an answer the owner still owes, and the handoff keeps asking for it before delegating. A new kind, the builder's call, goes to the builder and asks the owner nothing.
2. Builder's calls go in their own spec section the app adds, `## Left to the builder`, after Further Notes, enforced by the spec section check when any exist: "Own section". Owner-owed open questions stay in Further Notes.
3. Breaking into tickets attaches each builder's call to the tickets it concerns, and those briefs list it under "Your call". The handoff's open-questions section keeps only the owner-owed ones: "On the tickets it touches".
4. Stored open questions stay owner-owed. The owner can switch an item between the two kinds after finishing, through the existing change-their-mind path: "Yes, like any change".
5. The Term is "Builder's call". The finish option reads "Leave it to the builder". The spec section and the briefs say "Left to the builder": "Builder's call".
6. A not-ready idea has three ways forward: edit the idea (offered in the not-ready panel), Sharpening, and Grill it as is.
7. Claude proposed "answer a few questions" as fixed cards built from readiness's missing items, then re-assess. The owner answered: "i like the grill it as is option, but what if we had a mini session first to grill the idea i mean if the idea is too thin, how about we run a grill session to see the direction the user wants to go with the session, so grill the idea first, what do you think?" Claude agreed that an idea grill beats fixed cards because it can follow up, and warned that it must not become a second full grill, so it needs a clear end and output.
8. Sharpening produces a rewritten idea plus seed decisions: "Seed decisions too". It runs until readiness judges the idea ready: "Until ready". Stopping and choosing Grill it as is stays open every round. Each round, the owner answers direction cards, the interviewer proposes the rewritten idea, the owner accepts or edits it, and readiness judges it: "Round, rewrite, judge". It runs inside the same session, before round 1.
9. Seed decisions enter the main grill as settled decisions marked "from sharpening". The owner can change them like any decision and the interviewer builds on them: "Settled, marked".
10. The Term is "Sharpening" and the button reads "Sharpen the idea": "Sharpening".
11. Grill it as is is a button that starts the interview and records that the owner went past a not-ready verdict. Further Notes and the handoff state it, with what readiness found missing: "Recorded override", "Spec and handoff".
12. On how Sharpening relates to cards, the owner answered: "ok what if we pop-up like a helper agent, chat box, with suggestions, where the user can ask questions to this helper agent and this helper agent can suggest the sharpen the idea option, what do you think?" Claude noted that the framework ships an unused chat surface (`AgentChatSurface`, `grill-room/app/lib/agent-page.tsx`) while the interviewer is `claude -p` with no tools. It argued that structured choices serve a non-technical owner better than an empty chat box, while a helper that explains the verdict is useful. The owner chose "Ways now, helper later": the three ways ship as cards and buttons; the helper chat is its own item (bead `gr-ekbr`), starting with a spike.
13. About Pipe's pending verdicts on another page, the owner said: "let's keep going we are not wainting for pIPE".
14. The owner confirmed Claude's summary of all of the above: "Matches, go ahead".

## Choices after the code was mapped

A sonnet agent then mapped the code. The only way to change a set-aside decision today is Reopen, which clears its answer, makes its dependents stale and puts it back on a round. Nothing in the code records a start past a not-ready verdict. An opus agent drafted Sharpening's design (storage, turn shape, rounds before round 1), and the owner chose among its open points.

15. Switching a set-aside decision between its kinds is a direct "Move to…" control on its detail sheet: only the kind changes, the note is kept and nothing goes stale, because the answer did not change: "Direct switch". This replaces choice 4's path through Reopen.
16. Sharpening gets a design pass before it is ticketed, while the builder's call and the not-ready panel are ticketed first: "Design pass first".
17. Any start of round 1 while the current readiness verdict is not ready records the override, whatever starts it; "Grill it as is" is the panel's button for that start: "Any start records it".
18. After a not-ready verdict, the next Sharpening round opens on its own, with Stop beside it: "Opens on its own".
19. Stopping a Sharpening round before accepting its rewrite discards that round's answers: "Discarded".
20. Sharpening has no cap. After three not-ready rounds the panel says so and puts "Grill it as is" first: "Nudge after 3".
21. The export keeps the idea as first written and adds the Sharpening history, each accepted rewrite with its edits and verdict; the spec works from the final idea: "Original plus history".
22. After the first round, the direction cards are one to four, aimed at readiness's latest missing items and the earlier answers: "Aimed at what's missing".
