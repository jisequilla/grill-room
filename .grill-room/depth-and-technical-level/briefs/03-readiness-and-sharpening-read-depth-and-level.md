# Brief 03: Readiness takes depth; Sharpening takes depth and level

You are implementing ticket 03 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries and Builds on, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/03-readiness-and-sharpening-read-depth-and-level.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01, 06 (merged before this brief was delegated)

### 03 Readiness takes depth; Sharpening takes depth and level

Readiness judges an idea against the session's depth and records the depth it judged at. The Sharpening prompts carry the depth and level sections ticket 06 defines. Every name below is exact. This ticket imports `DEPTH_SECTIONS`, `LEVEL_SECTIONS` and the `InterviewContext` fields `depth` and `technicalLevel` from ticket 06, and never defines them.

- **The server check.** `reasonsToRefuseReadiness(result, idea, projectRoot = null, depth: Depth = DEFAULT_DEPTH)` in `grill-room/server/readiness.ts`:
  - at `proof-of-concept`, a `ready` verdict needs no evidence item, still needs a non-null objective that is not a process, and allows up to `MAX_READY_UNKNOWNS_PROOF_OF_CONCEPT` unknowns. That is a new export, `= 8`, beside `MAX_READY_UNKNOWNS = 5` in `grill-room/server/interviewer/schemas.ts`;
  - at `first-working-version` and `full-spec`, the check is today's, unchanged;
  - at every depth, the evidence citation checks run whatever the verdict, and so does the rule that an idea-sourced item restating the idea or the objective is not evidence.

  Its reason texts are today's, the unknowns cap naming the depth's number: `A ready verdict allows at most 8 unknowns; this one has 9.`
- **The readiness prompt.** `buildReadinessPrompt` in `grill-room/server/interviewer/prompt.ts` reads `request.context.depth`. Exported constants:
  - `READINESS_VERDICT_RULE`: today's three-line `verdict` bullet, byte for byte (`` - `verdict`: `ready` only when all three hold — at least one evidence `` / `  item, a non-null objective that is not process, and at most` / ``  ${MAX_READY_UNKNOWNS} unknowns. Otherwise `not-ready`.``, joined by `\n`);
  - `READINESS_VERDICT_RULE_PROOF_OF_CONCEPT` = ``- `verdict`: `ready` only when both hold — a non-null objective that is not process, and at most ${MAX_READY_UNKNOWNS_PROOF_OF_CONCEPT} unknowns. Evidence is not required at this depth: an empty evidence list can still be `ready`. Otherwise `not-ready`.``;
  - `READINESS_DEPTH_BARS: Record<Depth, string>`, rendered as its own section just before `## Your task: judge whether the idea is ready to grill`:

    | Depth | Text |
    |---|---|
    | `proof-of-concept` | `## The depth the owner chose: a proof of concept` / blank / `The owner wants to try the idea, not build it out. The bar is low: the idea is ready once it names one clear thing to try.` |
    | `first-working-version` | `## The depth the owner chose: a first working version` / blank / `The owner wants a first version real users can use. The idea is ready once it says who it is for and the core flows they go through.` |
    | `full-spec` | `## The depth the owner chose: a full spec` / blank / `The owner wants a full spec. Hold the idea to the full bar: what it is, who it is for, and the facts it rests on.` |

    "/ blank /" means `\n\n` between the heading and the paragraph.

  At `proof-of-concept` the `verdict` bullet is `READINESS_VERDICT_RULE_PROOF_OF_CONCEPT`; at the other two depths it is `READINESS_VERDICT_RULE`. The finer difference between first working version and full spec lives in the prompt text alone, since the server check is the same for both. With no `depth` in the context, the prompt is exactly today's: no bar, and `READINESS_VERDICT_RULE`.
- **The action.** `grill-room/actions/assess-readiness.ts` uses `session.depth` as read at the start of the action, never `pendingDepth`, in three places: as `context.depth` in its request, as the `depth` argument of `reasonsToRefuseReadiness`, and as the depth recorded with the judgment. The `has-rounds` and `turn-working` refusals stay. Readiness still warns and never blocks.
- **Recording the depth.** `storeReadiness(idea, result, judgedAt, scoutReportId, depth?: Depth)`. With `depth` absent, the stored JSON has no `depth` key at all, so the pre-depth migration test in `grill-room/server/db/migrations.test.ts`, which calls it with four arguments, stays byte-identical and unedited.
- **The panel.** `ReadinessPanel` in `grill-room/app/components/workspace/readiness-panel.tsx` shows a judgment whose `depth` is null or absent with the label `t("workspace.readinessJudgedBeforeDepth")`, `"Judged before depth existed"` in `grill-room/app/i18n/en-US.ts`, on an element with `data-testid="readiness-judged-before-depth"` beside the verdict badge. A judgment with a depth shows nothing extra. No judgment shows no label.
- **Sharpening.** `buildSharpenCardsPrompt` and `buildSharpenRewritePrompt` append `DEPTH_SECTIONS[context.depth]` and then `LEVEL_SECTIONS[context.technicalLevel]`, each only when its field is set, just before their `## Your task` heading. No action drives a Sharpening round today, so no action reads the level in this ticket. `grill-room/server/sharpening.ts`, which holds only the two refusal functions, is unchanged.

#### Behaviour

`ready(over)` is `anAssessReadinessResult({ verdict: "ready", ...over })`, and `IDEA` is the idea of `readiness.test.ts`. `NO_EVIDENCE` is `{ evidence: [] }`. "Contains X and no other value" means `toContain(X)` plus `not.toContain` for each other value of the same constant.

| # | Input | Expected | Mutation it catches |
|---|---|---|---|
| C1 | `reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE, unknowns: 8 items }), IDEA, null, "proof-of-concept")` | `[]` | evidence still required at a proof of concept; the cap of 5 applied there |
| C2 | as C1 with 9 unknowns | `["A ready verdict allows at most 8 unknowns; this one has 9."]` | no cap at a proof of concept |
| C3 | `ready({ ...NO_EVIDENCE, objective: null, objectiveIsProcess: false })`, `proof-of-concept` | `["A ready verdict needs an objective."]` | the objective rule dropped with the evidence rule |
| C4 | `ready({ ...NO_EVIDENCE, objectiveIsProcess: true })`, `proof-of-concept` | `["A ready verdict needs an objective that is not a process."]` | the process rule dropped at a proof of concept |
| C5 | `ready({ ...NO_EVIDENCE })`, `first-working-version` | `["A ready verdict needs at least one evidence item."]` | evidence dropped at every depth |
| C6 | as C5, `full-spec` | the same one reason | evidence dropped at a full spec |
| C7 | `ready({ unknowns: 6 items })` (with its one evidence item), `first-working-version` | `["A ready verdict allows at most 5 unknowns; this one has 6."]` | the proof-of-concept cap leaking to other depths |
| C8 | `ready({ evidence: [repoEvidence("Sessions are stored in PGlite", "server/db.ts:1")] })`, `projectRoot` null, `proof-of-concept` | exactly the existing "no project to check its citation against" reason for that item | citation checks skipped at a proof of concept |
| C9 | `anAssessReadinessResult({ verdict: "not-ready", evidence: [], objective: null })`, `proof-of-concept` | `[]`, and no throw | a not-ready verdict at a proof of concept that throws or is refused |
| C10 | `reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE }), IDEA)`, no depth argument | `["A ready verdict needs at least one evidence item."]` | a default depth other than `first-working-version` |
| C11 | Seam: for each depth, the `ready` shape its verdict rule describes. Proof of concept: `ready({ ...NO_EVIDENCE, unknowns: 8 items })`. The other two: `ready({ unknowns: 5 items })` with one evidence item | `[]` at that depth | a check stricter than the prompt it enforces |
| P1 | `buildPrompt(anAssessReadinessRequest({ context: aContext({ depth: d }) }))`, for each depth | contains `READINESS_DEPTH_BARS[d]` and no other bar | one bar for every depth; a swapped mapping |
| P2 | as P1 | at `proof-of-concept`: contains `READINESS_VERDICT_RULE_PROOF_OF_CONCEPT`, not `READINESS_VERDICT_RULE`; at the other two: the reverse | a verdict rule that contradicts the check (paired with C11) |
| P3 | as P1 with no `depth` | contains `READINESS_VERDICT_RULE` and no bar | a bar rendered by default |
| P4 | `buildPrompt` of `aSharpenCardsRequest()` with its context spread and `depth: d, technicalLevel: l` added, for each depth and each level | contains `DEPTH_SECTIONS[d]` and `LEVEL_SECTIONS[l]`, and no other value of either | Sharpening cards left unpitched, or pitched to one value only |
| P5 | the same with `aSharpenRewriteRequest` | the same | the rewrite left unpitched |
| P6 | both Sharpening prompts with neither field set | none of the six section values | a section rendered by default |
| S1 | `storeReadiness(IDEA, result, at, null)` | `"depth" in JSON.parse(stored)` is false | an absent depth written as `null` or a default, which breaks the byte-identical migration test |
| S2 | `storeReadiness(IDEA, result, at, null, "full-spec")`, read back with `parseStoredReadiness` | `depth` is `full-spec` | the depth not stored |
| A1 | Action: a session with `depth` `proof-of-concept`; the fake scripted with one `ready(NO_EVIDENCE)` turn | one `assess-readiness` request; its `context.depth` is `proof-of-concept`; the stored judgment's `depth` is `proof-of-concept`; the returned verdict is `ready` | the action not passing the depth to the check, the request or the store |
| A2 | Action: `depth` `full-spec`; scripted `ready(NO_EVIDENCE)`, then `anAssessReadinessResult()` | two requests; the second's `rejectionReason` contains `A ready verdict needs at least one evidence item.`; the stored `depth` is `full-spec` | the check run at a fixed depth |
| A3 | Action: `depth` `first-working-version`, `pending_depth` `proof-of-concept`; scripted as A2 | two requests; the stored `depth` is `first-working-version` | reading `pendingDepth` |
| U1 | `ReadinessPanel` with the panel test's `judged()` judgment (no `depth`), and with `{ ...judged(), depth: null }` | each renders `data-testid="readiness-judged-before-depth"` with `Judged before depth existed` | no label for a pre-depth judgment |
| U2 | `ReadinessPanel` with `{ ...judged(), depth: "proof-of-concept" }`, and with no judgment | neither renders `readiness-judged-before-depth` | a label shown for every judgment |
| E1 | e2e: a fresh session's idea is judged | the readiness panel shows the verdict and no `readiness-judged-before-depth` | a new judgment stored without its depth |

Judged by:
- C1–C11, P1–P3, S1 and S2 in `grill-room/server/readiness.test.ts`;
- P4–P6 in `grill-room/server/sharpening.test.ts`, through the exported constants, as its existing prompt tests do;
- A1–A3 in `grill-room/actions/assess-readiness.test.ts`, reading the captured requests with its `readinessRequests` helper;
- U1 and U2 in `grill-room/app/components/workspace/readiness-panel.test.tsx`;
- E1 in `grill-room/e2e/readiness.spec.ts`;
- the planted bug "assess-readiness drops its `has-rounds` refusal" fails `grill-room/actions/request-next-round.test.ts` › "idea readiness" › "assess-readiness" › "refuses once the session has a round", which stays unedited;
- the planted bug "a not-ready verdict at a proof of concept throws" fails C9;
- `pnpm test`, `pnpm typecheck`, `pnpm lint` and `just e2e` green.

## File boundaries

Files to edit:

- `grill-room/server/readiness.ts`
- `grill-room/server/readiness.test.ts`
- `grill-room/server/interviewer/schemas.ts`
- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/sharpening.test.ts`
- `grill-room/actions/assess-readiness.ts`
- `grill-room/actions/assess-readiness.test.ts`
- `grill-room/app/components/workspace/readiness-panel.tsx`
- `grill-room/app/components/workspace/readiness-panel.test.tsx`
- `grill-room/app/i18n/en-US.ts`
- `grill-room/e2e/readiness.spec.ts`

Existing files it builds on:

- `grill-room/server/readiness.ts:129-142`
- `grill-room/server/readiness.ts:230-294`
- `grill-room/actions/assess-readiness.ts:36-137`
- `grill-room/server/interviewer/prompt.ts:754-816`
- `grill-room/server/interviewer/prompt.ts:917-1000`
- `grill-room/app/components/workspace/readiness-panel.tsx:53-109`

## Codebase facts

- `reasonsToRefuseReadiness(result, idea, projectRoot = null)` runs the evidence citation checks for every verdict. For `ready` only, it adds: at least one evidence item, no idea-sourced item restating the idea or objective, a non-null non-process objective, and at most `MAX_READY_UNKNOWNS` unknowns. (`grill-room/server/readiness.ts:230-294`)
- `MAX_READY_UNKNOWNS = 5` is exported from the schemas module, which `server/interviewer/index.ts` re-exports whole. (`grill-room/server/interviewer/schemas.ts:331`, `grill-room/server/interviewer/index.ts:12`)
- `storeReadiness(idea, result, judgedAt, scoutReportId)` serializes `{ ideaJudged, result, judgedAt, scoutReportId }`; `storedReadinessSchema` already accepts `depth` absent or null. (`grill-room/server/readiness.ts:49-59`, `grill-room/server/readiness.ts:129-142`)
- The ticket 01 migration test builds a pre-depth judgment with the four-argument `storeReadiness` and checks it stays byte-identical. (`grill-room/server/db/migrations.test.ts:840-856`)
- `assess-readiness` reads the session row once at the start, refuses with `has-rounds`/`turn-working`, builds the request context inside `ask`, checks with `reasonsToRefuseReadiness`, and stores with `storeReadiness`. (`grill-room/actions/assess-readiness.ts:36-48`, `grill-room/actions/assess-readiness.ts:84-115`, `grill-room/actions/assess-readiness.ts:123-137`)
- The readiness prompt states one fixed bar; its `verdict` bullet is three lines interpolating `MAX_READY_UNKNOWNS`. (`grill-room/server/interviewer/prompt.ts:778-811`)
- The sharpen-cards and sharpen-rewrite prompts each open with their state, the tree and docs, then a `## Your task` heading. (`grill-room/server/interviewer/prompt.ts:917-963`, `grill-room/server/interviewer/prompt.ts:970-1000`)
- `server/sharpening.ts` exports only `reasonsToRefuseSharpenCards` and `reasonsToRefuseSharpenRewrite`. No action or app file sends a sharpen request, so no Sharpening round driver exists. (`grill-room/server/sharpening.ts:26`, `grill-room/server/sharpening.ts:89`)
- `get-current-round` returns `readiness` from `currentReadiness(session)`, so a `depth` on the stored judgment reaches the panel's `Readiness` type with no new field. (`grill-room/actions/get-current-round.ts:43`, `grill-room/app/components/workspace/readiness-panel.tsx:10-13`)
- `ReadinessPanel` renders the title and the verdict badge in one row, which is where the label goes. (`grill-room/app/components/workspace/readiness-panel.tsx:103-109`)
- The workspace's readiness strings live under `workspace` in `en-US.ts`. The other locales do not carry these keys, so only `en-US.ts` changes. (`grill-room/app/i18n/en-US.ts:248-270`, `grill-room/app/i18n/index.ts:5-19`)
- The panel test renders with `renderToStaticMarkup` from a `judged()` judgment that has no `depth`. (`grill-room/app/components/workspace/readiness-panel.test.tsx:11-48`)
- The readiness check's unit tests share an `IDEA` and the result fixtures. (`grill-room/server/readiness.test.ts:1-24`, `grill-room/server/interviewer/test-fixtures.ts:175-186`, `grill-room/server/interviewer/test-fixtures.ts:281-294`)
- `assess-readiness.test.ts` filters the fake's captured requests with `readinessRequests`. (`grill-room/actions/assess-readiness.test.ts:27-34`)
- The `has-rounds` refusal is already tested in `request-next-round.test.ts`. (`grill-room/actions/request-next-round.test.ts:2177-2184`)
- The readiness e2e drives the panel through the `readiness-not-ready` and `readiness-ready` fake scenarios. (`grill-room/e2e/readiness.spec.ts:11-30`)
- Sharpening prompt tests import `buildPrompt` and the sharpen fixtures; the fixtures set their own `context`, so a test spreads it and adds the fields. (`grill-room/server/sharpening.test.ts:1-24`, `grill-room/server/interviewer/test-fixtures.ts:462-494`)
- Repository rule: each acceptance line names a test that fails with the change reverted, and a "never" line names a planted bug. (`.claude/rules/worktrees.md:28`)
- Repository rule: a ticket that changes a model prompt and the server check enforcing it carries a seam test (C11 with P2). (`.claude/rules/worktrees.md:29`)

## Builds on

- Ticket 01: `DEPTHS`, `Depth` and `DEFAULT_DEPTH` in `grill-room/shared/session-constants.ts`, `sessions.depth` and `sessions.pendingDepth`, and the optional `depth` in `storedReadinessSchema`. Merged in PR #277. Check: `grep -q "depth: z.enum(DEPTHS).nullish()" grill-room/server/readiness.ts`
- Ticket 06: `DEPTH_SECTIONS` and `LEVEL_SECTIONS` exported from `grill-room/server/interviewer/prompt.ts`, and `depth` and `technicalLevel` on `InterviewContext` in `grill-room/server/interviewer/types.ts`. Check: `grep -q "export const DEPTH_SECTIONS" grill-room/server/interviewer/prompt.ts && grep -q "export const LEVEL_SECTIONS" grill-room/server/interviewer/prompt.ts && grep -q "technicalLevel?:" grill-room/server/interviewer/types.ts`

## Proved by

Test: `grill-room/server/readiness.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/readiness.test.ts server/sharpening.test.ts actions/assess-readiness.test.ts app/components/workspace/readiness-panel.test.tsx actions/request-next-round.test.ts server/db/migrations.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Import `DEPTH_SECTIONS`, `LEVEL_SECTIONS` and the context fields from ticket 06; never define them again.
- Prove each Behaviour row by reverting the change it covers (or applying the mutation it names), watching its test fail, and restoring it.
- Never claim a prompt's effect through the fake interviewer: it ignores the prompt.
- Look at the readiness panel with `agent-browser`, against your worktree's own server on a free port with `AUTH_DISABLED`, the fake interviewer and an isolated `DATABASE_URL`; never the user's server or database, and never the claude-in-chrome tools.
- Stop only processes you started, by the PID you recorded; never `pkill`, `killall`, `pgrep`, `just stop` or `just restart`.
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From `grill-room/` in your worktree, each must exit 0:

```bash
pnpm test && pnpm typecheck && pnpm lint
```

The ticket changes the readiness panel, so from the repository root in your worktree this must exit 0 too:

```bash
just e2e
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Readiness takes depth; Sharpening takes depth and level`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of the verify commands;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
