# 01 Collect the repository's rule sources and match them to files by `paths:`

Status: ready-for-agent
Blocked by: none
Bead: `gr-c0t.24`

## What to build

A server module that collects a target repository's rule sources and decides which apply to a set of files.

- Collect a fixed list: the root `CLAUDE.md`, the root `AGENTS.md` and every file in `.claude/rules/`. Nested `CLAUDE.md` or `AGENTS.md` files are not collected. A repository with none yields an empty list.
- For each source, read its `paths:` frontmatter globs, if any, and its line count (so a later check can validate a cited line).
- Expose a pure matcher: given the collected sources and a list of file paths, return which sources are matched by a `paths:` glob and which apply because they have no `paths:` frontmatter. A source without frontmatter applies to every file list.
- Put this in a new module, for example `grill-room/server/repo-rules.ts`. Leave `hasRulesFolder` in `grill-room/server/project-facts.ts` as it is.

This ticket does not change the scout prompt or result.

## How it will be judged

- Tests with fixture repositories (see `grill-room/test/git-repos.ts`) show the collected list is exactly the root `CLAUDE.md`, root `AGENTS.md` and the files in `.claude/rules/`; nested files are left out; an empty repository yields an empty list.
- Tests show a rule file with `paths:` globs matches only when one of the given files matches a glob, and a source without frontmatter always applies. The ngine-monitor shape (globs `consumers/**`, `server/**`, `web/**`, `VERSION`) is one named case.
- Existing `grill-room/server/project-facts.test.ts` still passes.
