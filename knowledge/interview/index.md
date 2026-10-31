---
type: Index
title: Interview
description: "The Interview context (core): its ubiquitous language and the use cases that touch it."
tags: [context, interview]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
---

# Interview

**Core context.** Turning a loose idea into settled decisions the Idea owner commits to, from readiness to a confirmed shared understanding. How it relates to the others is in the [context map](/context-map.md); its decisions and open questions are listed below.

## Language

Each word has one meaning here. A Term's words to avoid include the meanings it has in other contexts.

| Term | Meaning |
|---|---|
| [Answer change](language/answer-change.md) | Any write that gives a decision a new answer state: settling, deferring, rewording, unsettling or withdrawing it. |
| [Builder's call](language/builders-call.md) | A loose end the owner sets aside on purpose because the choice belongs to whoever builds it, so the owner owes no answer. |
| [Card](language/card.md) | One question of a round as the Idea owner answers it, with the interviewer's recommended answer and any offered choices. |
| [Claim](language/claim.md) | Another decision's link to this decision's answer: a pending supersession by it, or a record of having been replaced by it. |
| [Decision](language/decision.md) | A node of the design tree: one thing to settle, with what it depends on and, once answered, its answer and history. |
| [Design tree](language/design-tree.md) | Every decision of a session with its dependencies, whose states the app works out so that nothing is asked before what it depends on is settled. |
| [Idea](language/idea.md) | The loose text the Idea owner starts a session with, before anything is decided. |
| [Loose end](language/loose-end.md) | A decision that blocks confirming the session: unknown, deferred, waiting for a prototype, or otherwise not settled. |
| [Proposal](language/proposal.md) | A pending suggestion about a decision's own answer, answered-by, replacement, deferral or restatement, that the owner accepts or dismisses. |
| [Readiness](language/readiness.md) | The interviewer's judgment, before the first round, of whether the idea holds enough to grill: ready or not ready, with what it found and what is missing. |
| [Round proposal](language/round-proposal.md) | What an interviewer turn returns for a round: new decisions, responses to push backs, placements of added decisions, and whether the tree is done. |
| [Round](language/round.md) | The set of questions the interviewer asks together, each on its own card, answered and submitted as a whole or one at a time. |
| [Session](language/session.md) | One grilling interview of one idea, from the idea to a confirmed shared understanding, with everything decided in it. |
| [Shared understanding](language/shared-understanding.md) | What the Idea owner confirms to end a session: the interviewer proposed being done, every loose end is resolved, and the owner agrees. |
| [Sharpening](language/sharpening.md) | A short grill of a not-ready idea, inside the session and before round 1, that rewrites the idea and leaves seed decisions until readiness judges it ready. |
| [Stale review](language/stale-review.md) | The interviewer's pass over the decisions downstream of a reopened one, reconfirming what still holds and re-asking the rest. |

## Decisions

- [A not-ready idea has three ways forward](decisions/a-not-ready-idea-has-three-ways-forward.md)
- [Readiness opens the interview](decisions/readiness-opens-the-interview.md)
- [Setting a loose end aside offers two kinds](decisions/setting-aside-offers-two-kinds.md)
- [Sharpening rewrites the idea and seeds decisions until it is ready](decisions/sharpening-rewrites-the-idea-until-ready.md)
- [The helper chat waits for its own grill and spike](decisions/the-helper-chat-waits-for-its-own-grill.md)

## Open questions

- [Two proposals in the Interview](questions/two-proposals-in-the-interview.md), held by Jeremias De Isequilla

## Use cases that touch it

- [Grill the next thing from what was built](/product/use-cases/follow-up/grill-the-next-thing.md) (partial, owned here)
- [Answer a round of cards](/product/use-cases/grill/answer-a-round-of-cards.md) (built, owned here)
- [Change their mind](/product/use-cases/grill/change-their-mind.md) (built, owned here)
- [Control the pace](/product/use-cases/grill/control-the-pace.md) (built, owned here)
- [Finish with a shared understanding](/product/use-cases/grill/finish-with-a-shared-understanding.md) (built, owned here)
- [See where the decisions stand](/product/use-cases/grill/see-where-the-decisions-stand.md) (built, owned here)
- [Stay oriented in a long session](/product/use-cases/grill/stay-oriented-in-a-long-session.md) (wanted, owned here)
- [Steer the interview](/product/use-cases/grill/steer-the-interview.md) (built, owned here)
- [Find and resume a session](/product/use-cases/idea/find-and-resume-a-session.md) (built, owned here)
- [Organise sessions by project](/product/use-cases/idea/organise-sessions-by-project.md) (partial)
- [Start a session from a loose idea](/product/use-cases/idea/start-a-session-from-a-loose-idea.md) (built, owned here)
- [Know whether the idea is ready, and what to do if not](/product/use-cases/readiness/know-whether-the-idea-is-ready.md) (partial, owned here)
- [Scope how deep to grill](/product/use-cases/readiness/scope-how-deep-to-grill.md) (wanted, owned here)
- [Get a spec from the settled decisions](/product/use-cases/spec/get-a-spec-from-the-decisions.md) (built)
- [Know which choices are left to the builder](/product/use-cases/spec/know-what-the-builder-decides.md) (partial)
