---
type: Index
title: Product
description: The roles Grill Room serves, the concepts it uses and its use cases, in the present tense.
tags: [product]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T12:00:00+02:00
---

# Product

Who Grill Room serves, what each of them does with it, and in which words. The types are in [`manifest.yaml`](manifest.yaml).

- **Roles** (`roles/`):
  - [Idea owner](roles/idea-owner.md): brings an idea, answers, decides and exports; technical level varies.
  - [Orchestrating agent](roles/orchestrating-agent.md): the Idea owner's agent session that runs the build from HANDOFF.md.
  - [Build agent](roles/build-agent.md): implements one ticket inside its brief.
  - [Review agent](roles/review-agent.md): tries to break one change against the spec, without the builder's report.
- **Concepts** (`concepts/`): none distilled yet.
- **Use cases** (`use-cases/<stage>/`), the Idea owner's, with their state checked against the code: 13 built, 5 partial, 4 wanted.

  | Stage | Use case | State |
  |---|---|---|
  | idea | [Start a session from a loose idea](use-cases/idea/start-a-session-from-a-loose-idea.md) | built |
  | idea | [Find and resume a session](use-cases/idea/find-and-resume-a-session.md) | built |
  | idea | [Organise sessions by project](use-cases/idea/organise-sessions-by-project.md) | partial |
  | readiness | [Know whether the idea is ready, and what to do if not](use-cases/readiness/know-whether-the-idea-is-ready.md) | partial |
  | readiness | [Scope how deep to grill](use-cases/readiness/scope-how-deep-to-grill.md) | wanted |
  | grill | [Answer a round of cards](use-cases/grill/answer-a-round-of-cards.md) | built |
  | grill | [Control the pace](use-cases/grill/control-the-pace.md) | built |
  | grill | [Steer the interview](use-cases/grill/steer-the-interview.md) | built |
  | grill | [See where the decisions stand](use-cases/grill/see-where-the-decisions-stand.md) | built |
  | grill | [Change their mind](use-cases/grill/change-their-mind.md) | built |
  | grill | [Stay oriented in a long session](use-cases/grill/stay-oriented-in-a-long-session.md) | wanted |
  | grill | [Finish with a shared understanding](use-cases/grill/finish-with-a-shared-understanding.md) | built |
  | spec | [Get a spec from the settled decisions](use-cases/spec/get-a-spec-from-the-decisions.md) | built |
  | spec | [Read the spec quickly](use-cases/spec/read-the-spec-quickly.md) | partial |
  | spec | [Know which choices are left to the builder](use-cases/spec/know-what-the-builder-decides.md) | partial |
  | tickets | [Get tickets ready to delegate](use-cases/tickets/get-tickets-ready-to-delegate.md) | built |
  | export | [Set up the project repository](use-cases/export/set-up-the-project-repository.md) | wanted |
  | export | [Export into the project](use-cases/export/export-into-the-project.md) | built |
  | export | [Trust the exported bundle](use-cases/export/trust-the-exported-bundle.md) | built |
  | build | [Start building from the bundle](use-cases/build/start-building-from-the-bundle.md) | wanted |
  | build | [Learn from build outcomes](use-cases/build/learn-from-build-outcomes.md) | built |
  | follow-up | [Grill the next thing from what was built](use-cases/follow-up/grill-the-next-thing.md) | partial |

  Every founding-spec use case is built; every one that comes from Pipe is partial or wanted. The code also does about twenty things no fragment describes yet (the project scout, supersession, consistency checks, grounded briefs, delivery settings, among others); they come from the feature specs, which are not fragments of this bundle.
