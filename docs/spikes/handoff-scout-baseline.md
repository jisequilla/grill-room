# Spike: handoff-scout baseline vs. a deterministic pre-pass (gr-c0t.13)

## Where the data actually came from

`gr_turns`/`gr_turn_attempts` store **no** tool-call counts and **no** token
usage — `rawOutput` is only the parsed `structured_output` JSON
(`claude-cli.ts:394`, `turn-records.ts`). The database gave only turn kind,
model, timestamps and outcome.

The real data came from `claude -p` session transcripts under
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`: the scout's cwd is
`request.projectRoot` and it never resumes a conversation, so every
attempt — including a retry — is a brand-new session file. No session id is
stored anywhere in the app, so I matched files to `gr_turn_attempts` rows by
timestamp (attempt start/end vs. file mtime, within ~1s). That worked for
all 5 real `handoff-scout` turns found (2 retried once), 7 transcripts total,
across two registered projects (`poc-grill-me`, `ngine-monitor`). No
`docs/spikes/handoff-scout-*.md` existed yet.

**This matching is incidental, not a stable join** — it depends on
transcripts not being pruned and no clock skew. That's itself the strongest
argument for instrumenting properly (see recommendation).

## Baseline: 7 real attempts, 5 turns

| Attempt | Turn (project, tickets) | Outcome | Grep | Glob | Read | Output+thinking tok | Cache read tok | Cache create tok | Wall (s) |
|---|---|---|---|---|---|---|---|---|---|
| A1 | ngine-monitor, 13 | refused (bad citation) | 10 | 17 | 54 | 74,590 | 6,298,635 | 188,307 | 472 |
| A2 | same turn, retry | success | 0 | 0 | 0 | 11,917 | 8,934 | 28,751 | 78 |
| B1 | ngine-monitor, 13 | success | 13 | 11 | 43 | 46,368 | 3,705,756 | 153,993 | 395 |
| C1 | ngine-monitor, 13 | refused (bad citation) | 21 | 16 | 42 | 66,723 | 5,343,288 | 160,405 | 417 |
| C2 | same turn, retry | success | 0 | 0 | 1 | 12,105 | 48,626 | 31,670 | 73 |
| D1 | poc-grill-me, 11 | success | 19 | 17 | 45 | 79,313 | 13,806,057 | 283,890 | 661 |
| E1 | poc-grill-me, 11 | success | 10 | 17 | 46 | 101,326 | 9,001,515 | 240,709 | 859 |

All turns ran on `sonnet` (`SCOUT_MODEL`). Cache-read is the sum across
every sequential API call inside the turn (a fresh, non-resumed conversation
re-sends its growing history each round trip, so this scales with the number
of tool calls as much as with tokens per call — e.g. turn B's 104 API calls
averaged ~35.6K cache-read tokens each). Two of five turns needed a retry
because the model cited a line range past the file's actual length — an
existing failure mode, unrelated to this spike.

## Classifying the 382 tool calls (7 attempts)

- **Glob**: 78 total — 17 broad tree-listing calls (`**/*`, `*`) that a
  server-computed file list would fully replace (class **a**); 61 narrower
  globs (`server/src/**/*.ts`) that still map to "list this subtree," cheap
  but not literally named anywhere (borderline a/b, counted judgment here).
- **Read**: 231 total — 16 reads of a name a pre-pass could supply outright
  (`CLAUDE.md`, `AGENTS.md`, `package.json`, `docs/PRD.md`,
  `docs/ubiquitous-language.md`) (class **a**); 215 reads of a path the model
  found via a prior Grep/Glob result — pure judgment (class **b**).
- **Grep**: 73 total, **effectively all class b**. The premise — "grep the
  identifiers the spec and tickets name in backticks" — barely holds: across
  both sessions' spec + 24 ticket bodies combined, exactly **one** backticked
  token exists (`` `.grill-room` ``, a folder name, not a symbol). Two
  camelCase identifiers appear as **plain, unbackticked prose** —
  `exportFolder` (poc-grill-me), `sessionStartedAt` (ngine-monitor) — and only
  8 of 73 Grep calls reference either, always OR'd with a symbol name the
  model invented itself (`SessionKPICards|sessionStartedAt`,
  `exportFolder|slugPattern`). A literal backtick-grep pre-pass replaces
  maybe 3–4 calls total.

Of 382 calls: **33 (~9%)** are class (a) — tree listing plus named docs —
and **~349 (~91%)** are class (b): following a lead or guessing a symbol from
prose. Class-(a) example: `Read AGENTS.md`. Class-(b) example:
`Grep "SessionKPICards|ProjectStatsBar"`, guessed from a ticket title.

## Estimated saving if class (a) came pre-computed

**Round-trips saved**: ~4.7 tool calls/turn on average (33/7) out of ~55
average calls/turn — roughly a **9% cut**, not a dent in the long grep/read
chains that dominate wall time. **Tokens added**: `git ls-files` for the two
real project roots is 654 files/30 KB (poc-grill-me) and 443 files/17 KB
(ngine-monitor) — ~4,000–7,500 tokens raw. `git grep -lw exportFolder` (run
read-only for this spike) returns 4 files today; `sessionStartedAt` in
ngine-monitor returns 9 — both trivial. Runner detection (`package.json`
scripts) is a few hundred bytes. Total added: low thousands of tokens against
a per-turn cache-creation cost already at 150K–290K — small, and it buys
back only the ~9% above, since the backtick convention the ticket assumes
isn't actually used.

## Where the estimate is weak

N=5 turns, 2 projects, one model — thin, no variance data. Tool-call
and token counts are exact (real transcripts), but the savings estimate is a
by-inspection classification, not a replay with the pre-pass actually
removed. Timestamp matching could mismatch two scouts running the same
minute in the same project; didn't happen here but isn't guarded against.

## Recommendation: **instrument first, then reconsider**

The fact pack's premise — spec/tickets naming identifiers in backticks — is
nearly absent in real tickets today, so it would recover only ~9% of round
trips for a few thousand added prompt tokens: real but modest, not obviously
worth new server surface (a `ProjectServerFacts` field, prompt wiring, tests)
yet. Cheaper first step: store the scout's tool-call count (by name) and
`usage` on `gr_turn_attempts` (from the CLI's own summary line — the same
data this spike had to reconstruct from `~/.claude/projects` by timestamp
guesswork). That makes every future `ground-briefs` run free baseline data,
with no incidental matching, and shows whether class (a) grows as tickets
accumulate concrete identifiers (which gr-c0t.10's own "grep-defined reach"
decision will start adding for renames/reshapes). If it later passes
~20–25% of calls, build the fact pack; the file-list and named-doc slices
are the safe, always-a-win part regardless.
