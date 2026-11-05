# 03 Readiness takes depth; Sharpening takes depth and level

Status: ready-for-agent
Blocked by: 01, 06
Implements: user stories 22, 28, 36, 54
Implements decisions: `readiness-reads-depth`, `readiness-warns-never-blocks`, `readiness-only-before-first-round`, `sharpening-pre-round-one-in-session`, `do-sharpening-s-cards-also-take-the-owne-7e84439c`, `for-migrated-sessions-whose-readiness-ju-f836229c`

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

## Behaviour

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
