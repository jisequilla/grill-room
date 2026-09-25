# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

PoC of Matt Pocock's `grill-me` skill: turn a loose idea into a set of settled decisions through a rounds-of-frontier interview, then carry it into implementation. The experiment is the model split, not the product being built.

## Asking the User

When a decision or clarification is needed from the user, ask it with the AskUserQuestion tool: concrete options, the recommended one first. Never leave it as a trailing question at the end of a prose reply.

## The Skill

Installed project-locally, unmodified from `github.com/mattpocock/skills` (`skills/productivity/`):

- `.claude/skills/grill-me/` is the user-invoked front door (`/grill-me`); it only calls `grilling`.
- `.claude/skills/grilling/` holds the actual interview instructions.
- `.claude/skills/to-spec/` (`/to-spec`) synthesizes the grilled conversation into a spec and publishes it to the issue tracker. It does not interview.
- `.claude/skills/setup-matt-pocock-skills/` (`/setup-matt-pocock-skills`) is the one-time setup that `to-spec` depends on. Its output is `docs/agents/` and the `## Agent skills` block below; re-run it only to switch issue trackers.

Use these, not `/ngine-planner:grill`, which is a different implementation of the same idea and would contaminate the PoC. Keep all skill files verbatim; record any wished-for changes as findings instead of editing them.

Run `/grill-me` in a fresh conversation with plan mode off. Grilling is stateless and writes no files, so once the user confirms shared understanding, run `/to-spec` in the same conversation (not a fresh one: the conversation is its only input). The published spec is the only thing subagents will ever see; delegation prompts reference it and add file boundaries and the verifying command.

The skill dispatches sub-agents for fact-finding during the interview. Those follow the same model rule as execution (`sonnet` for lookups).

## Model Split

The main session runs on Fable and owns judgment: grilling, scoping, planning, reviewing results, deciding what is done. It does not write implementation code.

Execution is delegated through the Agent tool with an explicit `model` override:

| Work | Model |
|------|-------|
| Multi-file implementation, debugging, anything needing design judgment inside the task | `opus` |
| Well-specified single-file tasks, tests from a clear spec, mechanical edits, searches | `sonnet` |

Never use `subagent_type: "fork"` for execution: forks always inherit the parent model and ignore the override.

Subagents start with no conversation context. Each delegation prompt must carry the task spec, file boundaries, acceptance criteria, and the command that verifies it. If a task cannot be specified that tightly, it is not ready to delegate; grill or plan further.

The main session verifies each subagent's result itself (run the tests, read the diff) before reporting it as done. A subagent's completion report is a claim, not evidence.

## Build Flow

1. `/to-spec` publishes to local markdown: `.scratch/<feature>/spec.md`, tickets at `.scratch/<feature>/issues/NN-slug.md`.
2. Each ticket becomes a bead (`bd`). Claim a bead before delegating it; close it only after the main session has verified the work. Recover state with `bd ready` and `git log`, never from recollection.
3. Tickets that do not block each other may run in parallel, each subagent in its own git worktree (`isolation: "worktree"`). Each ticket reaches `main` through a pull request the main session reviews, verifies and merges; `.claude/rules/worktrees.md` holds the lifecycle. Run at most three at a time. The app under test, the subagents and the main session all draw on one Claude subscription pool, and a rate-limited failure is indistinguishable from a spec failure in the log. Six concurrent builders in the A/B hit no recorded rate limit, but the main session's attention to relays is the tighter limit. Delegations use the templates in `.claude/templates/delegation/`, and a pre-flight read clears each ticket before launch.
4. Spikes report to `docs/spikes/`.
5. Any MCP server used while building goes through `mcp-cli` (see the `mcp-cli` skill; config in `~/.config/mcp/mcp_servers.json`), not through a project `.mcp.json` loaded natively and not through `enableAllProjectMcpServers`. The scaffold's `grill-room/.mcp.json` was removed for this reason; its `shadcn` server is registered in `mcp-cli` instead (`MCP_STRICT_ENV=false mcp-cli shadcn` lists its tools; run it from `grill-room/` so it finds `components.json`). Delegation prompts must say so, because the scaffold's UI skills tell agents to expect a native shadcn MCP. The app itself uses no MCP: its Claude call is `claude -p` with zero tools.

## What the PoC Should Record

Each bead's close comment records the model used, whether the first attempt passed verification, whether it escalated, and what the delegation prompt was missing when it failed. `docs/delegation-log.md` summarizes these as a table. Escalations from `sonnet` to `opus` are the most useful data point: they show where the spec, not the model, was the weak link.

## The App

`grill-room/` is the app under construction: a local, single-user grilling UI on agent-native (`chat` template). It has its own `AGENTS.md` (symlinked as `CLAUDE.md`) and `DEVELOPING.md` with the framework's commands and conventions; read those before working inside it. The spec in `.scratch/` is the source of truth for what it should do.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
