---
type: Context map
title: Context map
description: Grill Room's three bounded contexts, what each is for, and how they depend on and translate into each other.
tags: [ddd, context-map]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
---

# Context map

Grill Room has three bounded contexts, each a module of this bundle with its own [language](manifest.yaml).[^contexts]

| Context | Kind | What it is for |
|---|---|---|
| [Interview](interview/index.md) | core | Turning a loose idea into settled decisions the Idea owner commits to, from readiness to a confirmed shared understanding. |
| [Project knowledge](project-knowledge/index.md) | supporting | What a registered project's repository already says: its decisions, its rules, how it delegates work. |
| [Delivery](delivery/index.md) | supporting | Turning settled decisions into a spec, tickets and a bundle agents build from, and recording how building went. |

## How they relate

```
 Project knowledge ── scout proposal kept → decision ──▶ Interview
        ▲                                                  │
        │ decisions.md read back                 settled decisions
        │ by the next scout                                ▼
        └──────────── exported bundle ◀──────────────── Delivery
                         consistency finding asked → decision ──▶ Interview
```

- **Interview → Delivery: upstream and downstream.** Delivery conforms to the [design tree](interview/language/design-tree.md); the spec, tickets and decisions.md are written from settled decisions and never change them.
- **Project knowledge → Interview: translated at keep or drop.** A [scout proposal](project-knowledge/language/scout-proposal.md) becomes an Interview [decision](interview/language/decision.md) only when the Idea owner keeps it. The decision row carries the scout's provenance, so the two contexts share it as a kernel. [Readiness](interview/language/readiness.md) is judged with the [scout report](project-knowledge/language/scout-report.md).
- **Project knowledge → Delivery: grounding.** The handoff [scout](project-knowledge/language/scout.md) grounds each [brief](delivery/language/brief.md) in the repository, and [delegation values](project-knowledge/language/delegation-value.md) from the repository override the project's [delivery recipe](delivery/language/delivery-recipe.md).
- **Delivery → Interview: feedback.** A [consistency finding](delivery/language/consistency-finding.md) the owner asks becomes a decision.
- **Delivery → Project knowledge → Interview: the loop.** An exported [decisions.md](delivery/language/decisions-file.md) is read back by the next scout as repo decisions. Nothing yet starts a session from a [build record](delivery/language/build-record.md), so the loop is only half built.

## Outside the contexts

Interviewer turn bookkeeping (turns, runs, attempts) is a generic technical subdomain, not product knowledge. The [roles](product/index.md) and use cases cut across all three contexts; each use case names the contexts it touches.

[^contexts]: Session that drew the bounded contexts, with the vocabulary inventory and the seams checked in the code ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
