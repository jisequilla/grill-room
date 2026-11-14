# 07 Spec names the depth and the spec check's bar follows it

Status: ready-for-agent
Blocked by: 01, 06
Implements: user stories 40-41, 43-44
Implements decisions: `depth-downstream`, `level-downstream`, `summary-in-plain-words-for-non-technical`

The spec says which depth it was grilled to, and the consistency check's bar for what a builder may decide alone follows that depth. Technical level reaches neither. Every name below is exact. This ticket uses the `InterviewContext` field `depth` from ticket 06 and never defines it.

- **Exported constants**, in `grill-room/server/interviewer/prompt.ts`, beside `READINESS_OVERRIDE_SENTENCE`:

  | Constant | `proof-of-concept` | `first-working-version` | `full-spec` |
  |---|---|---|---|
  | `DEPTH_SPEC_SENTENCES: Record<Depth, string>` | `This spec was grilled as a proof of concept: scale, edge cases and operations were left to the builder.` | `This spec was grilled as a first working version: scale and operations were left to the builder.` | `This spec was grilled as a full spec: every branch was asked.` |
  | `DEPTH_SUMMARY_RULES: Record<Depth, string>` | ``- One `## Summary` bullet says, in plain words, that this spec is for a proof of concept.`` | ``- One `## Summary` bullet says, in plain words, that this spec is for a first working version.`` | ``- One `## Summary` bullet says, in plain words, that this spec is for a full spec.`` |
  | `CONSISTENCY_DEPTH_BARS: Record<Depth, string \| null>` | `This spec was grilled as a proof of concept, so more is left to the builder on purpose. Report only a statement whose answer only the owner can give. A threshold, value, choice or target the builder can pick for the experiment is not a finding at this depth.` | `This spec was grilled as a first working version, so scale and operations are left to the builder. Report only a statement whose answer the owner would see or pay for: what a user can do, what they see, or what it costs. A gap only the builder would notice, such as a scale limit, an operational setting or an internal timeout, is not a finding at this depth.` | `null` |

- **The spec names its depth deterministically.** New `withDepthSentence(markdown: string, depth: Depth): string`, exported from `grill-room/actions/synthesize-spec.ts` beside `specRefusalReasons`. It puts `DEPTH_SPEC_SENTENCES[depth]` at the end of the spec's `## Further Notes` section, in three steps:
  1. Find the section the way `specSections` in `grill-room/server/consistency.ts` does: lines split on `\r?\n`, the first heading matching its heading regex whose name is `Further Notes`, and the section ending at the next line its section-end regex matches (`# ` or `## `), or at the end of the markdown. A `### ` subsection stays inside the section (W7). Export `SPEC_SECTION_HEADING` and `SPEC_SECTION_END` from `consistency.ts` and use them; do not copy them. With no such heading, return the markdown unchanged.
  2. Remove from the section every line that is exactly one of the three `DEPTH_SPEC_SENTENCES` values, this depth's included, each with the blank line that follows it when there is one (W4c, W9, W10).
  3. Trim the section's trailing blank lines, then add one blank line and the sentence. The section then ends with one blank line before the next heading, or with a single `\n` at the end of the markdown (W1–W3, W5, W6).

  The result is joined with `\n`. Markdown already in the form these steps produce comes back unchanged (W4); there is no early return. `synthesize-spec` stores `withDepthSentence(accepted.result.markdown, session.depth)` on both its update and its insert. `specRefusalReasons` still checks the model's own markdown, before the sentence is added. This takes the readiness override's pattern, an exact sentence held in an exported constant in `prompt.ts` and placed in Further Notes, but the server writes this sentence itself instead of refusing a spec that lacks it.
- **The synthesis prompt** names the depth in the Summary. The `synthesize-spec` task renders `DEPTH_SUMMARY_RULES[context.depth]` on the line right after its existing `` - The `## Summary` section holds … `` rule (`grill-room/server/interviewer/prompt.ts:590`), only when `context.depth` is set (row T5 checks the adjacency: the test finds the prompt line starting `` - The `## Summary` section holds `` and asserts the next line is the depth rule).
- **The consistency prompt.** `consistencyTaskSection` takes the depth from `request.context.depth`. When `CONSISTENCY_DEPTH_BARS[depth]` is not null, it renders it as a paragraph of its own after the closing "Be conservative" paragraph, one blank line between, and before any retry block `renderRetryWithPreviousResult` adds. At `full-spec`, or with no depth, the section is today's text exactly, which `grill-room/server/interviewer/claude-cli.test.ts` already pins in full; that test stays unedited. `consistencyReasons` in `grill-room/server/consistency.ts` is unchanged at every depth. The bar decides which findings the model reports, never the shape of a finding.
- **The actions** read `session.depth` once, from the session row each already loads before its turn, never `pendingDepth`:
  - `synthesize-spec` puts it in its `synthesize-spec` context literal and passes it to `withDepthSentence`;
  - `scan` in `grill-room/server/consistency.ts` puts it in its `check-consistency` context literal, read inside `scan` from whichever session row it receives, so both its callers, `runConsistencyTurn` and `checkConsistencyForBreakdown`, pass the depth without an edit of their own.

  Neither literal carries a `technicalLevel` key, not even one set to `undefined`: nothing after the interview varies with level, and the plain-words Summary rule stays as it is. `grill-room/actions/check-consistency.ts` needs no edit.
- **Fixture.** `grill-room/server/interviewer/test-fixtures.ts` gains `aCheckConsistencyRequest(overrides: Partial<Omit<CheckConsistencyRequest, "kind">> = {})`, using `consistencySpecMarkdown()` and `consistencyTickets()` from `fake.ts` mapped to `{ number, title, body, kind, waitsFor }`. `fake.ts` does not import `test-fixtures.ts`, so the import makes no cycle.

Files: `grill-room/server/interviewer/prompt.ts`, `grill-room/actions/synthesize-spec.ts`, `grill-room/server/consistency.ts`, `grill-room/server/interviewer/test-fixtures.ts`, and the test files under "Judged by". Ticket 03 lands first and also edits `prompt.ts` (readiness and Sharpening); the two regions are disjoint, and the only shared spot is the constant block near `READINESS_OVERRIDE_SENTENCE`.

At `first-working-version` the bar is a later paragraph than the kind examples and overrides them: the `undefaulted-value` example about a timeout stays as it is.

Whether a given finding appears is the model's call, so no test here claims a finding appears or disappears with depth. The fake interviewer ignores the prompt and is used only to capture requests.

## Behaviour

`S(d)` is `DEPTH_SPEC_SENTENCES[d]`. `consistency(d)` is `buildPrompt(aCheckConsistencyRequest({ context: aContext({ depth: d }) }))`, and `consistency()` is the same with no depth.

| # | Input | Expected | Mutation it catches |
|---|---|---|---|
| T1 | `consistency("proof-of-concept")` | contains `CONSISTENCY_DEPTH_BARS["proof-of-concept"]`, not the first-working-version bar | no bar at a proof of concept; a swapped mapping |
| T2 | `consistency("first-working-version")` | contains its own bar, not the proof-of-concept bar | the same, for a first working version |
| T3 | `consistency("full-spec")` | `toBe(consistency())` | a full-spec bar, or any change to today's text; planted bug: a non-null `full-spec` bar |
| T4 | Seam: for `proof-of-concept` and `first-working-version`, `consistency(d)` with `"\n\n" + CONSISTENCY_DEPTH_BARS[d]` removed | `toBe(consistency("full-spec"))` | the bar placed anywhere but as the one paragraph after "Be conservative"; any other change to the section at that depth |
| T4b | Seam: each non-null `CONSISTENCY_DEPTH_BARS` value | contains no backtick, none of the six kind names, and none of `kind`, `at.quote`, `against`, `decisionKey`, `findings` | a bar that adds a kind, a field or a rule `consistencyReasons` would refuse (its existing tests stay unedited) |
| T4c | `consistency(d)` for `proof-of-concept`, with `rejectionReason` and a previous result set (as the existing retry tests do) | the bar sits after the "Be conservative" paragraph and before the retry block: `prompt.indexOf("is the right answer when nothing is left open.") < prompt.indexOf(bar)` and `prompt.indexOf(bar) <` the index of the retry block's first line | the bar appended after the retry block |
| T7 | `DEPTH_SPEC_SENTENCES`, `DEPTH_SUMMARY_RULES` and `CONSISTENCY_DEPTH_BARS`, each value | `toBe` the literal in the table above | an empty or reworded value, which makes the `toContain` rows vacuous |
| T5 | `buildPrompt(aSynthesizeSpecRequest({ context: aContext({ depth: d }) }))`, for each depth | contains the Summary rule line + `"\n"` + `DEPTH_SUMMARY_RULES[d]`, and no other value; with no depth, none | the Summary rule missing, fixed to one depth, or placed elsewhere |
| T6 | the `synthesize-spec` and `check-consistency` prompts with `technicalLevel: "not-technical"` and a depth | neither contains any `LEVEL_SECTIONS` value | a level section rendered downstream; planted bug: `LEVEL_SECTIONS[context.technicalLevel]` added to the `synthesize-spec` prompt |
| W1 | `withDepthSentence("## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n", "full-spec")` | `"## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n\n" + S("full-spec") + "\n"` | a sentence not added; added elsewhere |
| W2 | `withDepthSentence("## Further Notes\n\n- A.\n\n## Appendix\n\nx\n", "proof-of-concept")` | `"## Further Notes\n\n- A.\n\n" + S("proof-of-concept") + "\n\n## Appendix\n\nx\n"` | appending to the end of the markdown instead of the section |
| W3 | `withDepthSentence("## Further Notes\n\n- None.", "first-working-version")` (no trailing newline) | `"## Further Notes\n\n- None.\n\n" + S("first-working-version") + "\n"` | a sentence glued to the last line |
| W4 | the W1 output, at `full-spec`; and markdown with no `## Further Notes` heading | each returned unchanged | a sentence added twice on a re-synthesis that kept it |
| W4c | `"## Further Notes\n\n- A.\n\n" + S("proof-of-concept") + "\n"`, at `full-spec` | `"## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n"` | an earlier depth's sentence kept beside the new one |
| W7 | `withDepthSentence("## Further Notes\n\n- A.\n\n### Later\n\n- B.\n", "full-spec")` | `"## Further Notes\n\n- A.\n\n### Later\n\n- B.\n\n" + S("full-spec") + "\n"` | the section ended at a `### ` subsection |
| W8 | `withDepthSentence("## Further Notes\n\n- A.\n\n# Appendix\n", "full-spec")` | `"## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n\n# Appendix\n"` | a `# ` heading not ending the section |
| W9 | `"## Further Notes\n\n" + S("full-spec") + "\n\n- B.\n"`, at `full-spec` | `"## Further Notes\n\n- B.\n\n" + S("full-spec") + "\n"` | this depth's sentence kept mid-section, so it appears twice |
| W10 | `"## Further Notes\n\n" + S("proof-of-concept") + "\n\n- B.\n"`, at `full-spec` | `"## Further Notes\n\n- B.\n\n" + S("full-spec") + "\n"` | another depth's sentence kept mid-section; a double blank line left where it was |
| W11 | `withDepthSentence("##  Further Notes  \n\n- A.\n", "full-spec")` | `"##  Further Notes  \n\n- A.\n\n" + S("full-spec") + "\n"` | a stricter heading match than the spec check's own |
| W5 | `withDepthSentence("## Further Notes\n\n- A.\n\n\n## Appendix\n", "full-spec")` | `"## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n\n## Appendix\n"` | extra blank lines kept before the sentence |
| W6 | `withDepthSentence("## Further Notes\n\n- A.\n\n", "full-spec")` | `"## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n"` | a trailing blank line doubled at the end of the markdown |
| A1 | Action: a confirmed session with `depth` `proof-of-concept` (set through `getDb()`, since no action sets it yet); the fake scripted with one valid spec `M` | the `synthesize-spec` request's `context.depth` is `proof-of-concept`; `"technicalLevel" in context` is false (key absent); the stored markdown is `toBe(withDepthSentence(M, "proof-of-concept"))` and `not.toBe(M)`; `M` is a valid spec with a `## Further Notes` section, as the test file's spec fixture is | the depth not passed; the sentence not stored; planted bug: the literal passes `technicalLevel` |
| A1b | Action: as A1 on a session that already has a spec row, regenerated with a second valid spec `M2` (extend `synthesize-spec.test.ts`' existing regenerate test) | the stored markdown is `toBe(withDepthSentence(M2, "proof-of-concept"))` | the update branch storing the raw markdown |
| A2 | As A1 with `depth` `first-working-version` and `pending_depth` `proof-of-concept` | the stored markdown contains `S("first-working-version")` and not `S("proof-of-concept")` | reading `pendingDepth` |
| A3 | Action: `check-consistency` on a session with `depth` `proof-of-concept` | the `check-consistency` request's `context.depth` is `proof-of-concept`; `"technicalLevel" in context` is false | the depth not passed; planted bug: the literal passes `technicalLevel` |

Judged by:
- the planted bugs named in T3 and T6 fail those rows;
- T1–T7, T4b, T4c and W1–W11 (W4c included) in the new `grill-room/server/spec-depth.test.ts`, through the exported constants (`toContain` for presence, `toBe` for T3, T4 and W1–W4);
- A1, A1b and A2 in `grill-room/actions/synthesize-spec.test.ts`; A3 in `grill-room/actions/check-consistency.test.ts`;
- the existing exact-markdown assertions that a stored spec now changes are updated to compare against `withDepthSentence(<scripted markdown>, "first-working-version")`, the default depth: `grill-room/actions/synthesize-spec.test.ts` › "a grilled-as-is session's spec must say so" (`expect(stored.markdown).toBe(retry)`) and `grill-room/actions/check-consistency.test.ts` › "the request" › "sends the spec and every ticket in number order, …" (`expect(requests[0]!.specMarkdown).toBe(consistencySpecMarkdown())`). Any other test that fails only because the stored spec gained the sentence gets the same edit, and the PR body names it. Likely candidates: `grill-room/actions/list-tickets.test.ts`, `break-into-tickets.test.ts`, `handoff.test.ts`, `ask-consistency-findings.test.ts`, `ground-briefs.test.ts` and `grill-room/e2e/smoke.spec.ts`;
- `grill-room/server/interviewer/claude-cli.test.ts` unedited and green;
- `pnpm test`, `pnpm typecheck` and `pnpm lint` green.
