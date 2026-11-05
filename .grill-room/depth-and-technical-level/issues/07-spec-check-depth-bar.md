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

## Behaviour

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
