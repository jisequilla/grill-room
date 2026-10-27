---
type: Index
title: Product
description: The roles Grill Room serves and their use cases across the bounded contexts, in the present tense.
tags: [product]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T12:00:00+02:00
---

# Product

Who Grill Room serves and what each of them does with it, across the [bounded contexts](/context-map.md); the words are each context's language. The types are in [`manifest.yaml`](manifest.yaml).

- **Roles** (`roles/`):
  - [Idea owner](roles/idea-owner.md): brings an idea, answers, decides and exports; technical level varies.
  - [Orchestrating agent](roles/orchestrating-agent.md): the Idea owner's agent session that runs the build from HANDOFF.md.
  - [Build agent](roles/build-agent.md): implements one ticket inside its brief.
  - [Review agent](roles/review-agent.md): tries to break one change against the spec, without the builder's report.
- **Decisions** (`decisions/`):
  - [Grill Room has three bounded contexts](decisions/three-bounded-contexts.md)
  - [One Idea owner, with technical level as a trait](decisions/one-idea-owner-technical-level-is-a-trait.md)
  - [Three agents consume an export](decisions/three-agents-consume-an-export.md)
  - [Grill Room's developers are not a role](decisions/grill-room-developers-are-not-a-role.md)
  - Founding, from the founding spec:
    - [Grill Room runs on the owner's Claude subscription](decisions/runs-on-the-claude-subscription.md)
    - [The interviewer cannot touch the owner's machine](decisions/the-interviewer-cannot-touch-the-machine.md)
    - [Everything stays on the owner's machine](decisions/everything-stays-on-the-owners-machine.md), broken today by `gr-3u9i`
    - [The grilling skill is the method, unmodified](decisions/the-grilling-skill-is-the-method.md)
- **Open questions** (`questions/`):
  - [Is the pre-flight agent a role?](questions/is-the-pre-flight-agent-a-role.md), held by Jeremias De Isequilla
- **Use cases** (`use-cases/<stage>/`), with their state checked against the code: the Idea owner's 13 built, 6 partial, 4 wanted, and the Orchestrating agent's one, built.

  | Stage | Use case | Contexts | State |
  |---|---|---|---|
  | idea | [Start a session from a loose idea](use-cases/idea/start-a-session-from-a-loose-idea.md) | interview | built |
  | idea | [Find and resume a session](use-cases/idea/find-and-resume-a-session.md) | interview | built |
  | idea | [Organise sessions by project](use-cases/idea/organise-sessions-by-project.md) | project-knowledge, interview | partial |
  | readiness | [Know whether the idea is ready, and what to do if not](use-cases/readiness/know-whether-the-idea-is-ready.md) | interview, project-knowledge | partial |
  | readiness | [Scope how deep to grill](use-cases/readiness/scope-how-deep-to-grill.md) | interview | wanted |
  | grill | [Answer a round of cards](use-cases/grill/answer-a-round-of-cards.md) | interview | built |
  | grill | [Control the pace](use-cases/grill/control-the-pace.md) | interview | built |
  | grill | [Steer the interview](use-cases/grill/steer-the-interview.md) | interview | built |
  | grill | [See where the decisions stand](use-cases/grill/see-where-the-decisions-stand.md) | interview | built |
  | grill | [Change their mind](use-cases/grill/change-their-mind.md) | interview | built |
  | grill | [Stay oriented in a long session](use-cases/grill/stay-oriented-in-a-long-session.md) | interview | wanted |
  | grill | [Finish with a shared understanding](use-cases/grill/finish-with-a-shared-understanding.md) | interview | built |
  | spec | [Get a spec from the settled decisions](use-cases/spec/get-a-spec-from-the-decisions.md) | delivery, interview | built |
  | spec | [Read the spec quickly](use-cases/spec/read-the-spec-quickly.md) | delivery | partial |
  | spec | [Know which choices are left to the builder](use-cases/spec/know-what-the-builder-decides.md) | delivery, interview | partial |
  | tickets | [Get tickets ready to delegate](use-cases/tickets/get-tickets-ready-to-delegate.md) | delivery | built |
  | tickets | [Get tickets a builder can act on without guessing](use-cases/tickets/get-tickets-a-builder-can-act-on.md) | delivery, project-knowledge | partial |
  | export | [Set up the project repository](use-cases/export/set-up-the-project-repository.md) | project-knowledge, delivery | wanted |
  | export | [Export into the project](use-cases/export/export-into-the-project.md) | delivery, project-knowledge | built |
  | export | [Trust the exported bundle](use-cases/export/trust-the-exported-bundle.md) | delivery | built |
  | build | [Start building from the bundle](use-cases/build/start-building-from-the-bundle.md) | delivery | wanted |
  | build | [Learn from build outcomes](use-cases/build/learn-from-build-outcomes.md) | delivery | built |
  | build | [Record a build outcome without the browser](use-cases/build/record-a-build-outcome.md) (Orchestrating agent) | delivery | built |
  | follow-up | [Grill the next thing from what was built](use-cases/follow-up/grill-the-next-thing.md) | interview, project-knowledge, delivery | partial |

  Every founding-spec use case is built. Of Pipe's, only the export fixes from the review are built; the rest are partial or wanted. The code also does about twenty things no fragment describes yet (the project scout, supersession, consistency checks, grounded briefs, delivery settings, among others); they come from the feature specs, which are not fragments of this bundle.
