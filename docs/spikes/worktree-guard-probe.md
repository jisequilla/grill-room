# Probe: which `revert-check.sh` forms the worktree guard refuses

**Verdict: the form decides, deterministically.** The guard refuses `scripts/revert-check.sh` when its quoted argument is a bare `bash <script>`, and allows every other form tried, the same script inside parentheses included. All 30 calls gave the same answer on each of their three attempts.

Bead gr-cln. Run `wf_1371671b-eca` (2026-11-02): one `sonnet` agent in a Workflow worktree (`isolation: "worktree"`), the same guard a builder sits under. It committed one comment line (`# gr-cln probe`) to `scripts/gen-wave.py` on its own branch first, so every `revert-check.sh` call did what it does for a builder: fetch, revert that line, run the quoted command, re-apply. It pushed nothing. Afterwards `git status --short` was empty and `git diff origin/main...HEAD --stat` listed only `scripts/gen-wave.py | 1 +`.

## Result

| # | Command | Attempts | Outcome |
|---|---|---|---|
| 1 | `scripts/revert-check.sh 'bash scripts/test-gen-wave.sh'` | 3 | refused, 3 of 3 |
| 2 | `scripts/revert-check.sh '(cd grill-room && pnpm exec vitest --run scripts/review-loop.test.ts)'` | 3 | allowed, 3 of 3 (exit 254: no `node_modules` in the fresh worktree, as expected) |
| 3 | `cd <worktree> && scripts/revert-check.sh 'bash scripts/test-gen-wave.sh'` (gr-ypz9's form) | 3 | refused, 3 of 3 |
| 4 | `scripts/revert-check.sh '(bash scripts/test-gen-wave.sh)'` | 3 | allowed, 3 of 3 (exit 0, `ok   real workflow anchors`) |
| 4b | `scripts/revert-check.sh '(cd grill-room && bash ../scripts/test-gen-wave.sh)'` | 3 | allowed, 3 of 3 (exit 0) |
| 5 | `scripts/revert-check.sh 'python3 scripts/gen-wave.py --help'` | 3 | allowed, 3 of 3 (exit 1, the usage line, as expected) |
| 6 | `scripts/revert-check.sh 'true'` | 3 | allowed, 3 of 3 (exit 0) |
| 7 | `bash scripts/revert-check.sh 'bash scripts/test-gen-wave.sh'` | 3 | allowed, 3 of 3 (exit 0) |
| 8 | `bash scripts/test-gen-wave.sh` (control) | 3 | allowed, 3 of 3 (exit 0) |
| 9 | `git status --short` (control) | 3 | allowed, 3 of 3 |

Every refusal carried the same message, word for word:

> This agent is isolated in the worktree …/.claude/worktrees/wf_1371671b-eca-1, but this command runs revert-check.sh with the text bash scripts/test-gen-wave.sh in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Run the plain command from …/wf_1371671b-eca-1.

It is the message gr-m1a (`'bash scripts/tgw-head.sh'`) and gr-ypz9 (`'bash scripts/test-gen-wave.sh'`) hit.

## What it means

- The two hypotheses were "the form decides" and "the guard varies". No row was allowed in one attempt and refused in another, so the guard does not vary: it is a rule on the command text.
- The rule bites only when `revert-check.sh` is the command and its argument is a plain `bash <script>`. The guard then reads the script as a command it cannot see into. A leading `cd <worktree> &&` does not change that (row 3).
- Wrapping the same text in parentheses (row 4), putting it after a `cd … &&` inside them (row 4b), or calling `revert-check.sh` through `bash` (row 7) is allowed. So are `pnpm`, `python3` and `true` (rows 2, 5, 6). That is why gr-ejh's and gr-r1zn's `(cd grill-room && pnpm …)` runs went through.
- `revert-check.sh` itself is not blocked (row 6), so its quoted-string interface can stay.

## Proposed fix (outline, not implemented)

`builder.md:24`, `fix.md:24` and `reviewer.md:35` show the call as `scripts/revert-check.sh '<the Evidence entry test command>'`. A later ticket changes each to `scripts/revert-check.sh '(<the Evidence entry test command>)'`, the parenthesised form row 4 proves allowed, and says why in one sentence. A template test in `grill-room/scripts/delegation-templates.test.ts` pins the parentheses in all three. Nothing in `revert-check.sh` changes: `bash -c '(cmd)'` runs `cmd` in a subshell, with the same exit status.
