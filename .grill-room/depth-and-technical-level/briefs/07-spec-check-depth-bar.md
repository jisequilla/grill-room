# Brief 07: Spec names the depth and the spec check's bar follows it

You are implementing ticket 07 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries and Builds on, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/07-spec-check-depth-bar.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01, 06 (merged before this brief was delegated)

### 07 Spec names the depth and the spec check's bar follows it

The spec says which depth it was grilled to, and the consistency check's bar for what a builder may decide alone follows that depth. Technical level reaches neither. Every name below is exact. This ticket uses the `InterviewContext` field `depth` from ticket 06 and never defines it.

- **Exported constants**, in `grill-room/server/interviewer/prompt.ts`, beside `READINESS_OVERRIDE_SENTENCE`:

  | Constant | `proof-of-concept` | `first-working-version` | `full-spec` |
  |---|---|---|---|
  | `DEPTH_SPEC_SENTENCES: Record<Depth, string>` | `This spec was grilled as a proof of concept: scale, edge cases and operations were left to the builder.` | `This spec was grilled as a first working version: scale and operations were left to the builder.` | `This spec was grilled as a full spec: every branch was asked.` |
  | `DEPTH_SUMMARY_RULES: Record<Depth, string>` | ``- One `## Summary` bullet says, in plain words, that this spec is for a proof of concept.`` | the same with `a first working version` | the same with `a full spec` |
  | `CONSISTENCY_DEPTH_BARS: Record<Depth, string \| null>` | `This spec was grilled as a proof of concept, so more is left to the builder on purpose. Report only a statement whose answer only the owner can give. A threshold, value, choice or target the builder can pick for the experiment is not a finding at this depth.` | `This spec was grilled as a first working version, so scale and operations are left to the builder. Report only a statement whose answer the owner would see or pay for: what a user can do, what they see, or what it costs. A gap only the builder would notice, such as a scale limit, an operational setting or an internal timeout, is not a finding at this depth.` | `null` |

- **The spec names its depth deterministically.** New `withDepthSentence(markdown: string, depth: Depth): string`, exported from `grill-room/actions/synthesize-spec.ts` beside `specRefusalReasons`. It puts `DEPTH_SPEC_SENTENCES[depth]` at the end of the spec's `## Further Notes` section. That section runs from its heading to the next line starting `# ` or `## `, or to the end of the markdown. `synthesize-spec` stores `withDepthSentence(accepted.result.markdown, session.depth)` on both its update and its insert. `specRefusalReasons` still checks the model's own markdown, before the sentence is added. This takes the readiness override's pattern, an exact sentence held in an exported constant in `prompt.ts` and placed in Further Notes, but the server writes this sentence itself instead of refusing a spec that lacks it.
- **The synthesis prompt** names the depth in the Summary. The `synthesize-spec` task renders `DEPTH_SUMMARY_RULES[context.depth]` on the line right after its existing `## Summary` rule, only when `context.depth` is set.
- **The consistency prompt.** `consistencyTaskSection` takes the depth from `request.context.depth`. When `CONSISTENCY_DEPTH_BARS[depth]` is not null, it renders it as a paragraph of its own after the closing "Be conservative" paragraph. At `full-spec`, or with no depth, the section is today's text exactly. `consistencyReasons` in `grill-room/server/consistency.ts` is unchanged at every depth. The bar decides which findings the model reports, never the shape of a finding.
- **The actions** read `session.depth` once, from the session row each already loads before its turn, never `pendingDepth`:
  - `synthesize-spec` puts it in its `synthesize-spec` context literal and passes it to `withDepthSentence`;
  - `scan` in `grill-room/server/consistency.ts` puts it in its `check-consistency` context literal.

  Neither literal carries `technicalLevel`: nothing after the interview varies with level, and the plain-words Summary rule stays as it is. `grill-room/actions/check-consistency.ts` needs no edit.
- **Fixture.** `grill-room/server/interviewer/test-fixtures.ts` gains `aCheckConsistencyRequest(overrides: Partial<Omit<CheckConsistencyRequest, "kind">> = {})`, using `consistencySpecMarkdown()` and `consistencyTickets()` from `fake.ts` mapped to `{ number, title, body, kind, waitsFor }`.

Whether a given finding appears is the model's call, so no test here claims a finding appears or disappears with depth. The fake interviewer ignores the prompt and is used only to capture requests.

#### Behaviour

`S(d)` is `DEPTH_SPEC_SENTENCES[d]`. `consistency(d)` is `buildPrompt(aCheckConsistencyRequest({ context: aContext({ depth: d }) }))`, and `consistency()` is the same with no depth.

| # | Input | Expected | Mutation it catches |
|---|---|---|---|
| T1 | `consistency("proof-of-concept")` | contains `CONSISTENCY_DEPTH_BARS["proof-of-concept"]`, not the first-working-version bar | no bar at a proof of concept; a swapped mapping |
| T2 | `consistency("first-working-version")` | contains its own bar, not the proof-of-concept bar | the same, for a first working version |
| T3 | `consistency("full-spec")` | `toBe(consistency())` | a full-spec bar, or any change to today's text |
| T4 | Seam: for `proof-of-concept` and `first-working-version`, `consistency(d)` with `"\n\n" + CONSISTENCY_DEPTH_BARS[d]` removed | `toBe(consistency("full-spec"))`. The bar is the only difference, so every finding shape the prompt describes at any depth is today's shape, which `consistencyReasons` accepts (its existing tests, unedited) | a bar that adds a kind, a field or a rule `consistencyReasons` would refuse |
| T5 | `buildPrompt(aSynthesizeSpecRequest({ context: aContext({ depth: d }) }))`, for each depth | contains `DEPTH_SUMMARY_RULES[d]` and no other value; with no depth, none | the Summary rule missing or fixed to one depth |
| T6 | the `synthesize-spec` and `check-consistency` prompts with `technicalLevel: "not-technical"` and a depth | neither contains any `LEVEL_SECTIONS` value | a level section rendered downstream |
| W1 | `withDepthSentence("## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n", "full-spec")` | `"## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n\n" + S("full-spec") + "\n"` | a sentence not added; added elsewhere |
| W2 | `withDepthSentence("## Further Notes\n\n- A.\n\n## Appendix\n\nx\n", "proof-of-concept")` | `"## Further Notes\n\n- A.\n\n" + S("proof-of-concept") + "\n\n## Appendix\n\nx\n"` | appending to the end of the markdown instead of the section |
| W3 | `withDepthSentence("## Further Notes\n\n- None.", "first-working-version")` (no trailing newline) | `"## Further Notes\n\n- None.\n\n" + S("first-working-version") + "\n"` | a sentence glued to the last line |
| W4 | markdown whose Further Notes already holds `S("full-spec")`; and markdown with no `## Further Notes` heading | each returned unchanged | a sentence added twice on a re-synthesis that kept it |
| A1 | Action: a confirmed session with `depth` `proof-of-concept`; the fake scripted with one valid spec `M` | the `synthesize-spec` request's `context.depth` is `proof-of-concept`; `"technicalLevel" in context` is false; the stored markdown is `toBe(withDepthSentence(M, "proof-of-concept"))` | the depth not passed; the sentence not stored; planted bug: the literal passes `technicalLevel` |
| A2 | As A1 with `depth` `first-working-version` and `pending_depth` `proof-of-concept` | the stored markdown contains `S("first-working-version")` and not `S("proof-of-concept")` | reading `pendingDepth` |
| A3 | Action: `check-consistency` on a session with `depth` `proof-of-concept` | the `check-consistency` request's `context.depth` is `proof-of-concept`; `"technicalLevel" in context` is false | the depth not passed; planted bug: the literal passes `technicalLevel` |

Judged by:
- T1–T6 and W1–W4 in the new `grill-room/server/spec-depth.test.ts`, through the exported constants (`toContain` for presence, `toBe` for T3, T4 and W1–W4);
- A1 and A2 in `grill-room/actions/synthesize-spec.test.ts`; A3 in `grill-room/actions/check-consistency.test.ts`;
- the existing exact-markdown assertions that a stored spec now changes are updated to compare against `withDepthSentence(<scripted markdown>, "first-working-version")`, the default depth: `grill-room/actions/synthesize-spec.test.ts` › "a grilled-as-is session's spec must say so" (`expect(stored.markdown).toBe(retry)`) and `grill-room/actions/check-consistency.test.ts` › "the request" › "sends the spec and every ticket in number order, …" (`expect(requests[0]!.specMarkdown).toBe(consistencySpecMarkdown())`). Any other test that fails only because the stored spec gained the sentence gets the same edit, and the PR body names it;
- `pnpm test`, `pnpm typecheck` and `pnpm lint` green.

## File boundaries

Files to create:

- `grill-room/server/spec-depth.test.ts`

Files to edit:

- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/interviewer/test-fixtures.ts`
- `grill-room/actions/synthesize-spec.ts`
- `grill-room/actions/synthesize-spec.test.ts`
- `grill-room/server/consistency.ts`
- `grill-room/actions/check-consistency.test.ts`

Existing files it builds on:

- `grill-room/server/interviewer/prompt.ts:41-43`
- `grill-room/server/interviewer/prompt.ts:446-518`
- `grill-room/server/interviewer/prompt.ts:1563-1644`
- `grill-room/actions/synthesize-spec.ts:60-110`
- `grill-room/actions/synthesize-spec.ts:219-289`
- `grill-room/server/consistency.ts:320-381`

## Codebase facts

- `READINESS_OVERRIDE_SENTENCE` is an exported constant in `prompt.ts`, and the spec task asks for it in Further Notes "exactly". This is the pattern the depth constants follow. (`grill-room/server/interviewer/prompt.ts:41-43`, `grill-room/server/interviewer/prompt.ts:472-485`)
- The override sentence is enforced by `readinessOverrideReasons`: the action finds the Further Notes section with `specSections` and refuses a spec without the sentence. This ticket writes its sentence itself instead, so no scripted spec is refused for lacking it. (`grill-room/actions/synthesize-spec.ts:60-74`)
- `specRefusalReasons` requires `## Further Notes` among the seven template headings, so every stored spec has the section `withDepthSentence` writes into. (`grill-room/actions/synthesize-spec.ts:35-43`, `grill-room/actions/synthesize-spec.ts:83-110`)
- `specSections` runs a section to the next level-1 or level-2 heading, the boundary `withDepthSentence` uses. (`grill-room/server/consistency.test.ts:109-124`)
- `synthesize-spec` reads the session row once, builds its context literal inside `ask`, checks the result with `specRefusalReasons`, then writes `accepted.result.markdown` on update or insert. (`grill-room/actions/synthesize-spec.ts:164-170`, `grill-room/actions/synthesize-spec.ts:219-248`, `grill-room/actions/synthesize-spec.ts:256-289`)
- The spec task's Summary rule is one line, the place `DEPTH_SUMMARY_RULES` follows. (`grill-room/server/interviewer/prompt.ts:501`)
- `consistencyTaskSection()` takes no argument, lists the six finding kinds and fields, and ends with the "Be conservative" paragraph. (`grill-room/server/interviewer/prompt.ts:1563-1619`)
- `buildConsistencyPrompt` renders `renderContext`, the spec, the tickets, the task section and the retry section, then trims the end. (`grill-room/server/interviewer/prompt.ts:1626-1644`)
- The consistency turn loads the full session row and builds the `check-consistency` context literal in `scan` in `consistency.ts`; `check-consistency.ts` only calls `runConsistencyTurn(sessionId)`. (`grill-room/server/consistency.ts:56`, `grill-room/server/consistency.ts:320-381`, `grill-room/actions/check-consistency.ts:80`)
- `consistencyReasons` validates a finding's quotes, places, fields, decision key and question against the request as sent, with no depth input. (`grill-room/server/consistency.ts:212`)
- There is no "builder-alone" finding kind: the six kinds are `unquantified-threshold`, `one-case-rule`, `spec-ticket-contradiction`, `open-choice`, `undefaulted-value` and `unnamed-target`. (`grill-room/server/interviewer/prompt.ts:1572-1589`)
- `CheckConsistencyRequest` carries `specMarkdown`, `tickets` (`{ number, title, body, kind, waitsFor }`) and `previousResult`. (`grill-room/server/interviewer/types.ts:482-493`)
- `consistencySpecMarkdown()`, `consistencyTickets()` and `consistencyFindingsResult()` are the fake's fixtures for the check. The spec ends with `## Further Notes`. (`grill-room/server/interviewer/fake.ts:1399-1444`, `grill-room/server/interviewer/fake.ts:1495`)
- `check-consistency.test.ts` creates its spec through `synthesizeSpec.run` and asserts the spec it sends byte for byte, so the stored sentence changes that assertion. (`grill-room/actions/check-consistency.test.ts:119-126`, `grill-room/actions/check-consistency.test.ts:202-240`)
- `synthesize-spec.test.ts` asserts a stored spec equal to its scripted retry. (`grill-room/actions/synthesize-spec.test.ts:594-623`)
- Prompt tests import exported constants and assert with `toContain`, as the readiness-override tests do. (`grill-room/server/interviewer/instructions.test.ts:128-170`)
- Repository rule: each acceptance line names a test that fails with the change reverted, and a "never" line names a planted bug. (`.claude/rules/worktrees.md:28`)
- Repository rule: a ticket that changes a model prompt and the server check behind it carries a seam test (T4: the check is unchanged and the prompt's finding shapes are today's). (`.claude/rules/worktrees.md:29`)

## Builds on

- Ticket 01: `DEPTHS`, `Depth` in `grill-room/shared/session-constants.ts`, `sessions.depth` and `sessions.pendingDepth`. Merged in PR #277. Check: `grep -q "export const DEPTHS" grill-room/shared/session-constants.ts`
- Ticket 06: `depth` and `technicalLevel` on `InterviewContext` in `grill-room/server/interviewer/types.ts`, and `LEVEL_SECTIONS` in `grill-room/server/interviewer/prompt.ts` (for T6). Check: `grep -q "depth?: Depth" grill-room/server/interviewer/types.ts && grep -q "export const LEVEL_SECTIONS" grill-room/server/interviewer/prompt.ts`

## Proved by

Test: `grill-room/server/spec-depth.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/spec-depth.test.ts actions/synthesize-spec.test.ts actions/check-consistency.test.ts server/consistency.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them. The one exception is the Judged-by line on existing exact-markdown assertions; name every such file in the PR body.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Use the `depth` context field from ticket 06; never define it again.
- Prove each Behaviour row by reverting the change it covers (or applying the mutation it names), watching its test fail, and restoring it.
- Never claim a prompt's effect through the fake interviewer: it ignores the prompt.
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From `grill-room/` in your worktree, each must exit 0. The ticket changes no UI, so e2e is not run.

```bash
pnpm test && pnpm typecheck && pnpm lint
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Spec names the depth and the spec check's bar follows it`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of the verify commands;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
