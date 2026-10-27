---
type: Index
title: Delivery
description: "The Delivery context (supporting): its ubiquitous language and the use cases that touch it."
tags: [context, delivery]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
---

# Delivery

**Supporting context.** Turning settled decisions into a spec, tickets and a bundle agents build from, and recording how building went. How it relates to the others is in the [context map](/context-map.md). It has no decisions or open questions of its own yet.

## Language

Each word has one meaning here. A Term's words to avoid include the meanings it has in other contexts.

| Term | Meaning |
|---|---|
| [Adversarial review](language/adversarial-review.md) | A second, fresh-context agent's attempt to break one ticket's change against the spec, without the builder's report. |
| [Brief](language/brief.md) | The per-ticket delegation brief a Build agent works from: file boundaries, codebase facts, what it builds on and how it is proved. |
| [Build record](language/build-record.md) | The outcome of building one ticket: the model, whether the first attempt passed, whether it escalated, and what the prompt was missing. |
| [Bundle](language/bundle.md) | Everything an export writes into a project: spec, decisions.md, intent.md, tickets, HANDOFF.md and briefs. |
| [Consistency finding](language/consistency-finding.md) | A statement in the spec or tickets that leaves a builder to decide something the owner never decided. |
| [decisions.md](language/decisions-file.md) | The bundle's record of a session's settled decisions, with their provenance, dependencies and what they replaced. |
| [Delivery recipe](language/delivery-recipe.md) | How a ticket's work reaches the project's main branch, pull request or local merge, with the project's delivery settings that shape HANDOFF.md. |
| [Handoff](language/handoff.md) | HANDOFF.md: the Orchestrating agent's instructions for building the bundle, rendered from the session, spec, tickets and project. |
| [Pre-flight](language/pre-flight.md) | A read-only check of a ticket against the current code, just before it launches, for wrong premises, ambiguities and decisions only the owner can make. |
| [Spec](language/spec.md) | The document synthesized from a confirmed session's settled decisions, in the to-spec template's sections. |
| [Ticket](language/ticket.md) | A unit of work broken out of the spec, sized for one agent, saying what blocks it, which stories it implements, and what it consumes and produces. |
| [User story](language/user-story.md) | A numbered statement in the spec of what a role wants and why, which tickets say they implement. |

## Use cases that touch it

- [Learn from build outcomes](/product/use-cases/build/learn-from-build-outcomes.md) (built, owned here)
- [Record a build outcome without the browser](/product/use-cases/build/record-a-build-outcome.md) (built, owned here)
- [Start building from the bundle](/product/use-cases/build/start-building-from-the-bundle.md) (wanted, owned here)
- [Export into the project](/product/use-cases/export/export-into-the-project.md) (built, owned here)
- [Set up the project repository](/product/use-cases/export/set-up-the-project-repository.md) (wanted)
- [Trust the exported bundle](/product/use-cases/export/trust-the-exported-bundle.md) (built, owned here)
- [Grill the next thing from what was built](/product/use-cases/follow-up/grill-the-next-thing.md) (partial)
- [Get a spec from the settled decisions](/product/use-cases/spec/get-a-spec-from-the-decisions.md) (built, owned here)
- [Know which choices are left to the builder](/product/use-cases/spec/know-what-the-builder-decides.md) (partial, owned here)
- [Read the spec quickly](/product/use-cases/spec/read-the-spec-quickly.md) (partial, owned here)
- [Get tickets ready to delegate](/product/use-cases/tickets/get-tickets-ready-to-delegate.md) (built, owned here)
- [Get tickets a builder can act on without guessing](/product/use-cases/tickets/get-tickets-a-builder-can-act-on.md) (partial, owned here)
