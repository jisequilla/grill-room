---
name: run-wave
description: Use when launching, verifying and merging a wave of cleared tickets from the main session, from the stored ticket to the closed bead.
---

# Running a wave

The main session runs this procedure. `.claude/rules/worktrees.md` holds the rules behind each step (the templates, the reviewers, the nits bead); this skill is only the order of the commands.

1. Once a ticket is cleared by pre-flight (`PREFLIGHT: clear`), store its final text in the bead so it outlives the session: `bd update <bead> --design-file <ticket>`.
2. Make sure `.scratch/` is git-excluded (required, once per clone): `grep -qx '.scratch/' .git/info/exclude || echo '.scratch/' >> .git/info/exclude`.
   Write the wave spec JSON, a list of `{bead, ticket, title, lenses, model?}`, then run `python3 scripts/gen-wave.py <spec.json> .scratch/waves/<name>.js`.
3. Launch only on the owner's typed message naming the tickets.
4. Verify on main merged with every branch: `scripts/verify-wave.sh [--e2e] <branch>...`. It prints `pid: <n>` on stderr and keeps its logs under `.scratch/verify-wave/<n>/`.
5. Merge each PR, one `gh` write per command:
   - Mark it ready (`gh pr ready <n>`) only once every reviewer lens approved: on `approved-mark-ready`. On `approved-with-should-fix`, ask the owner (see `.claude/rules/worktrees.md`).
   - If the PR body's Merge danger says `One-way door`, stop and merge only after the owner's typed confirmation (AskUserQuestion is not enough); a `Two-way door` merges without asking. See "The main session" in `.claude/rules/worktrees.md`.
   - Start each write with `gh auth switch -u jisequilla && gh api user --jq .login` in the same command, and check it prints `jisequilla`.
   - Merge with `gh pr merge <n> --merge --delete-branch`.
6. Run `git pull` and the suite on merged main, then `bd close` naming the PR, the nits bead (the script in `.claude/rules/worktrees.md`), `just prune-worktrees`, and add the row to `docs/delegation-log.md`.

## Failure modes

**zsh does not word-split a variable.**
Run the script directly, never as a command held in a variable.
**e2e can hang on its own PGlite lock (gr-tte).**
Stop only the PIDs your run started (the `pid:` line the verify script prints to stderr, and its descendants), never by process name, then rerun.
**Agent replies arrive truncated.**
Re-read the PR and the result file, never the reply, for the state.
**The classifier blocks chained gh writes.**
One `gh` write per Bash call.
