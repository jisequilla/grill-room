---
type: Index
title: Project knowledge
description: "The Project knowledge context (supporting): its ubiquitous language and the use cases that touch it."
tags: [context, project-knowledge]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
---

# Project knowledge

**Supporting context.** What a registered project's repository already says: its decisions, its rules, how it delegates work. How it relates to the others is in the [context map](/context-map.md); its decisions and open questions are in [memory](/memory/index.md).

## Language

Each word has one meaning here. A Term's words to avoid include the meanings it has in other contexts.

| Term | Meaning |
|---|---|
| [Delegation value](language/delegation-value.md) | How the repository itself says work is delegated (tickets in flight, review rule, pre-flight, prune command), with its citation; while unconfirmed, a delegation proposal. |
| [Project facts](language/project-facts.md) | What the server itself knows about a repository without asking a model: its files, its tracked decisions.md files, its HEAD. |
| [Project](language/project.md) | A registered Git repository that sessions belong to and export into. |
| [Repo decision](language/repo-decision.md) | A decision the repository already holds, recorded in its decisions.md files or inferred from its code, carried into a session as settled. |
| [Repo rules](language/repo-rules.md) | The repository's own instructions to agents (its root CLAUDE.md, AGENTS.md and the files in .claude/rules), read as rules a brief must respect. |
| [Scout proposal](language/scout-proposal.md) | A decision the project scout says the repository already holds, which the Idea owner keeps or drops. |
| [Scout report](language/scout-report.md) | What the project scout found for an idea: what is built, partial or a gap, and the decisions the repository already holds. |
| [Scout](language/scout.md) | A read-only agent that reads a project's repository; the project scout reads it against an idea, the handoff scout against tickets. |

## Use cases that touch it

- [Export into the project](/product/use-cases/export/export-into-the-project.md) (built)
- [Set up the project repository](/product/use-cases/export/set-up-the-project-repository.md) (wanted, owned here)
- [Grill the next thing from what was built](/product/use-cases/follow-up/grill-the-next-thing.md) (partial)
- [Organise sessions by project](/product/use-cases/idea/organise-sessions-by-project.md) (partial, owned here)
- [Know whether the idea is ready, and what to do if not](/product/use-cases/readiness/know-whether-the-idea-is-ready.md) (partial)
