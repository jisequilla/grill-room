# Brief 08: Record the decisions in the knowledge bundle and an ADR

You are implementing ticket 08 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/08-knowledge-bundle-and-adr.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 08 Record the decisions in the knowledge bundle and an ADR

Update `knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md` to built: depth per session with three steps, level per owner with three values, skip defaults, the setup step before readiness, Sharpening pitched to both, and depth editable after done with the proposal withdrawn and artifacts marked stale. Update `knowledge/product/roles/idea-owner.md` with the three levels. Add decision records in `knowledge/interview/decisions/` in the style of `readiness-opens-the-interview.md`: owner profile keyed by the auth user id with no level on sessions; depth per session re-judging readiness before round 1 (override cleared, queued latest-wins, Sharpening finishes its round). Add `knowledge/interview/language/depth.md` and `technical-level.md`, linked from `knowledge/interview/index.md`. Add `docs/adr/0003-owner-profile-keyed-by-auth-user.md` following `docs/adr/0001-mutation-gate-on-evidence-covered-lines.md`. Use 'readiness', never 'preflight'.

Judged by: manifests list the new files and the repo's okf lint passes.

## File boundaries

Files to create:

- `knowledge/interview/decisions/owner-profile-keyed-by-auth-user.md`
- `knowledge/interview/decisions/depth-per-session-rejudges-readiness.md`
- `knowledge/interview/language/depth.md`
- `knowledge/interview/language/technical-level.md`
- `docs/adr/0003-owner-profile-keyed-by-auth-user.md`

Files to edit:

- `knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md`
- `knowledge/product/roles/idea-owner.md`
- `knowledge/interview/index.md`

Existing files it builds on:

- `knowledge/interview/decisions/readiness-opens-the-interview.md:1-28`
- `knowledge/interview/language/sharpening.md:1-25`
- `docs/adr/0001-mutation-gate-on-evidence-covered-lines.md:1-49`

## Codebase facts

- The use case is state: wanted with an empty code list and a 'Missing' paragraph, and its first line describes depth as asked once at first setup, which the built version replaces with per-session depth. (`knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md:15-30`)
- The Idea owner role says the technical level varies and that a use case says when it changes the outcome, with no list of levels, so the three levels are added there. (`knowledge/product/roles/idea-owner.md:26-28`)
- The interview index lists terms in an alphabetical Language table, decisions as a bullet list, and the use case as '(wanted, owned here)', all of which this ticket edits. (`knowledge/interview/index.md:20-65`)
- The interview manifest holds only context metadata (name, kind, question, status, owner, depends_on, common) and no file list, so no manifest edit lists the new files. (`knowledge/interview/manifest.yaml:1-8`)
- A decision file has frontmatter type Decision with sources, date, decided_by and state, then prose and a footnote, as readiness-opens-the-interview.md does. (`knowledge/interview/decisions/readiness-opens-the-interview.md:1-28`)
- A term file has frontmatter type Term with an avoid list and a one-paragraph body, as sharpening.md does; 'preflight' is in its avoid list. (`knowledge/interview/language/sharpening.md:1-25`)
- The ADR format is a numbered title, Status and Decision key lines, then Context, Decision, Alternatives, Consequences and Tickets sections; docs/adr holds 0001 and 0002 so 0003 is free. (`docs/adr/0001-mutation-gate-on-evidence-covered-lines.md:1-49`)
- The justfile check recipe runs typecheck, lint, test and e2e and defines no knowledge or OKF lint, so the ticket's 'repo's okf lint passes' names a command the code does not show; the proof here is a grep over the files. (`justfile:154-161`)
- Repository rule: Domain docs live in GLOSSARY.md and docs/adr/ at the repo root, so the ADR goes under docs/adr/. (`CLAUDE.md:67-69`).

## Proved by

```bash
test -f knowledge/interview/language/depth.md && test -f knowledge/interview/language/technical-level.md && test -f docs/adr/0003-owner-profile-keyed-by-auth-user.md && grep -q 'language/depth.md' knowledge/interview/index.md && grep -q 'language/technical-level.md' knowledge/interview/index.md && grep -q 'state: built' knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From the repository root in your worktree, this must exit 0:

```bash
just check
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Record the decisions in the knowledge bundle and an ADR`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
