# Intent: Depth and technical level before the grill

## Problem Statement

Grill Room was built for one technical Idea owner who makes the technology calls and wants an exhaustive interview. Its second real user is not technical, will not say what to build, and does not always want a full spec. Nothing in the session, the schema or the interviewer's instructions records how deep to grill or how technical the owner is, so every owner gets the same technical, full-length interview. A non-technical owner meets cards they cannot answer and a grill that does not stop where their ambition stops. A technical owner cannot ask for a quick proof of concept without being grilled as if for a full spec.

## Solution

Grill Room captures two values and pitches the interview to both. Technical level is a trait of the one Idea owner role, stored once per signed-in owner in an owner profile. Depth is a property of each session, chosen when the idea is opened. A setup step at session creation, before readiness runs, asks depth and shows the level pre-filled for correction. Both can be changed at any round and apply from the next one. The interviewer, including Sharpening, reads both every turn: depth decides which branches open and when done is proposed; level decides card wording, how recommendations are phrased, and whether technology choices default to the builder. Readiness and the spec check read depth so a proof-of-concept owner is neither warned about full-spec gaps nor nagged about decisions they chose to leave to the builder.

## The original idea, before the interview

Grill Room should let the Idea owner say how deep to grill and how technical they are, and pitch the interview to both.

Today nothing in the session, the schema or the interviewer's instructions records either. Grill Room was built for a technical owner; its second real user is not technical, will not tell the interviewer what to build, and asked to be asked their technical level up front and how big to go: a quick proof of concept or a full spec.

Ground truth is the knowledge/ bundle in this repo. Read knowledge/context-map.md, knowledge/interview/index.md (use its Terms: "readiness", never "preflight"), knowledge/product/roles/idea-owner.md, knowledge/product/decisions/one-idea-owner-technical-level-is-a-trait.md and knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md. Technical level is a trait of the one Idea owner role, not a second role.

What needs settling:
- Where and when depth and technical level are asked: once per owner at first setup, per session, or inside readiness or Sharpening (see knowledge/interview/decisions/ for both), and whether either can change mid-session.
- What each value is: the scale or choices for depth and for technical level, and the default when the owner skips it.
- What they change in the interview: which questions get asked, how cards are worded, how many rounds, when the interviewer proposes being done, what the recommendation looks like for a non-technical owner who will not choose the technology.
- What they change downstream, if anything: readiness, the spec, the tickets, the handoff.
- Who answers the technical questions a non-technical owner cannot: builder's calls (knowledge/interview/language/builders-call.md), the interviewer's recommendation, or something else.

## Readiness before the interview

Judged at 2026-11-04T17:45:08.998Z, on the idea as first written, before any question was asked.

- **Objective:** Let the Idea owner record how deep to grill and how technical they are, store both on the session, and have the interviewer pitch its questions, cards, pacing and recommendation to those two values.
- **Expected outcome:** A non-technical owner is asked their technical level and desired depth up front, both are recorded in the schema and interviewer instructions, and the interview adapts to them instead of assuming a technical owner.
- **Verdict:** ready

**Evidence**

- Today nothing in the session, the schema or the interviewer's instructions records either. · the user said
- Grill Room was built for a technical owner; its second real user is not technical, will not tell the interviewer what to build, and asked to be asked their technical level up front and how big to go: a quick proof of concept or a full spec. · the user said
- Technical level is a trait of the one Idea owner role, not a second role. · the user said
- The sessions table has no depth or technical-level column; it holds idea readiness JSON, a readiness override, and turn status, so the new values would belong beside them. · the repo shows (grill-room/server/db/schema.ts:198-220)
- Readiness is built as the interview's opening move: judged once before round 1, stored on the session, warns and never blocks. It judges the idea and the scout report only, and takes no depth or level input. · the repo shows (grill-room/server/readiness.ts:1-11)
- Sharpening is a pre-round-1 short grill that rewrites the idea and seeds decisions. It is the closest existing place for a setup question, but it runs only for a not-ready idea. · the repo shows (knowledge/interview/decisions/sharpening-rewrites-the-idea-until-ready.md:22-24)
- The interviewer prompt builder (buildPrompt) has no depth or technical-level input, so card wording, round count, and when to propose being done are not pitched to either. · the repo shows (grill-room/server/interviewer/prompt.ts:1652)
- Builder's call exists: the owner sets a loose end aside with 'Leave it to the builder', and the spec lists it under 'Left to the builder' and the briefs under 'Your call'. It is a candidate path for technical questions a non-technical owner cannot answer. · the repo shows (knowledge/interview/language/builders-call.md:22)
- The scope use case is where technical level is captured, asked once at first setup; every later use case that adapts to the level reads it from there. The interviewer then pitches its questions to depth and level. · the repo shows (knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md:24-26)
- The spec Summary prompt already asks for plain words a non-technical owner can read, a fixed wording rather than one that varies with the owner. · the repo shows (grill-room/server/interviewer/prompt.ts:501)

**Unknowns**

- Where and when depth and technical level are asked: once per owner at first setup, per session, or inside readiness or Sharpening, and whether either can change mid-session.
- What each value is: the scale or choices for depth and for technical level, and the default when the owner skips it.
- What they change in the interview: which questions get asked, how cards are worded, how many rounds, when the interviewer proposes being done, and what the recommendation looks like for an owner who will not choose the technology.
- What they change downstream, if anything: readiness, the spec, the tickets, the handoff.
- Who answers the technical questions a non-technical owner cannot: builder's calls, the interviewer's recommendation, or something else.

## Project state

- **Gap:** The idea's own use case is marked wanted with no code, and states that nothing in the session, schema or interviewer instructions records a depth or technical level. (knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md:18-28)
- **Gap:** The sessions table has no depth or technical-level column; it holds idea readiness JSON, a readiness override, and turn status, so the new values would belong beside them. (grill-room/server/db/schema.ts:154, grill-room/server/db/schema.ts:198-220)
- **Partial:** Readiness is built as the interview's opening move: judged once before round 1, stored on the session, warns and never blocks. It judges the idea and the scout report only, and takes no depth or level input. (grill-room/server/readiness.ts:1-11, knowledge/interview/language/readiness.md:25)
- **Partial:** Sharpening is a pre-round-1 short grill that rewrites the idea and seeds decisions. It is the closest existing place for a setup question, but it runs only for a not-ready idea. (knowledge/interview/decisions/sharpening-rewrites-the-idea-until-ready.md:22-24)
- **Gap:** The interviewer prompt builder (buildPrompt) has no depth or technical-level input, so card wording, round count, and when to propose being done are not pitched to either. (grill-room/server/interviewer/prompt.ts:1652)
- **Partial:** The spec Summary prompt already asks for plain words a non-technical owner can read, a fixed wording rather than one that varies with the owner. (grill-room/server/interviewer/prompt.ts:501)
- **Built:** Builder's call exists: the owner sets a loose end aside with 'Leave it to the builder', and the spec lists it under 'Left to the builder' and the briefs under 'Your call'. It is a candidate path for technical questions a non-technical owner cannot answer. (knowledge/interview/language/builders-call.md:22)
- **Partial:** The Idea owner role and the technical-level-as-trait decision are recorded, but the trait is not captured anywhere in the app. (knowledge/product/roles/idea-owner.md:28, knowledge/product/decisions/one-idea-owner-technical-level-is-a-trait.md:25-27)
- **Partial:** Setting aside offers two kinds, and the spec check already looks for what a builder would have to decide alone, so downstream pieces exist but ignore depth. (grill-room/server/interviewer/prompt.ts:1565-1567, knowledge/interview/index.md:43)

- **Commit read:** c62ffadf24a2f3f6cdcc843df0008868cc18c971
