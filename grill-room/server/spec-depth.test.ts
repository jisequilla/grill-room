import { describe, expect, it } from "vitest";

import { withDepthSentence } from "../actions/synthesize-spec.js";
import { DEPTHS, type Depth } from "../shared/session-constants.js";
import {
  buildPrompt,
  CONSISTENCY_DEPTH_BARS,
  DEPTH_SPEC_SENTENCES,
  DEPTH_SUMMARY_RULES,
  LEVEL_SECTIONS,
} from "./interviewer/prompt.js";
import {
  aCheckConsistencyRequest,
  aContext,
  aSynthesizeSpecRequest,
} from "./interviewer/test-fixtures.js";

const S = (depth: Depth) => DEPTH_SPEC_SENTENCES[depth];

function consistency(depth?: Depth): string {
  return buildPrompt(
    aCheckConsistencyRequest({ context: depth ? aContext({ depth }) : aContext() }),
  );
}

describe("the consistency check's bar follows the depth", () => {
  it("T1: a proof of concept carries its own bar, not the first-working-version bar", () => {
    const prompt = consistency("proof-of-concept");
    expect(prompt).toContain(CONSISTENCY_DEPTH_BARS["proof-of-concept"]!);
    expect(prompt).not.toContain(CONSISTENCY_DEPTH_BARS["first-working-version"]!);
  });

  it("T2: a first working version carries its own bar, not the proof-of-concept bar", () => {
    const prompt = consistency("first-working-version");
    expect(prompt).toContain(CONSISTENCY_DEPTH_BARS["first-working-version"]!);
    expect(prompt).not.toContain(CONSISTENCY_DEPTH_BARS["proof-of-concept"]!);
  });

  it("T3: a full spec is today's prompt exactly", () => {
    expect(consistency("full-spec")).toBe(consistency());
  });

  it.each(["proof-of-concept", "first-working-version"] as const)(
    "T4: at %s the bar is the only difference from the full-spec prompt",
    (depth) => {
      const bar = CONSISTENCY_DEPTH_BARS[depth]!;
      const prompt = consistency(depth);
      expect(prompt).toContain(`\n\n${bar}`);
      expect(prompt.replace(`\n\n${bar}`, "")).toBe(consistency("full-spec"));
    },
  );
});

describe("the synthesis prompt names the depth in the Summary", () => {
  it.each(DEPTHS)("T5: at %s it carries that depth's Summary rule and no other", (depth) => {
    const prompt = buildPrompt(aSynthesizeSpecRequest({ context: aContext({ depth }) }));
    for (const other of DEPTHS) {
      if (other === depth) expect(prompt).toContain(DEPTH_SUMMARY_RULES[other]);
      else expect(prompt).not.toContain(DEPTH_SUMMARY_RULES[other]);
    }
  });

  it("T5: with no depth it carries no Summary depth rule", () => {
    const prompt = buildPrompt(aSynthesizeSpecRequest());
    for (const depth of DEPTHS) expect(prompt).not.toContain(DEPTH_SUMMARY_RULES[depth]);
  });
});

describe("technical level reaches neither downstream prompt", () => {
  it.each(DEPTHS)("T6: at %s neither prompt carries a level section", (depth) => {
    const context = aContext({ depth, technicalLevel: "not-technical" });
    const prompts = [
      buildPrompt(aSynthesizeSpecRequest({ context })),
      buildPrompt(aCheckConsistencyRequest({ context })),
    ];
    for (const prompt of prompts) {
      for (const section of Object.values(LEVEL_SECTIONS)) {
        expect(prompt).not.toContain(section);
      }
    }
  });
});

describe("withDepthSentence", () => {
  it("W1: ends a last Further Notes section with the sentence", () => {
    expect(
      withDepthSentence("## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n", "full-spec"),
    ).toBe("## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n\n" + S("full-spec") + "\n");
  });

  it("W2: ends Further Notes, not the markdown, when a section follows", () => {
    expect(
      withDepthSentence("## Further Notes\n\n- A.\n\n## Appendix\n\nx\n", "proof-of-concept"),
    ).toBe("## Further Notes\n\n- A.\n\n" + S("proof-of-concept") + "\n\n## Appendix\n\nx\n");
  });

  it("W3: separates the sentence from a last line with no trailing newline", () => {
    expect(withDepthSentence("## Further Notes\n\n- None.", "first-working-version")).toBe(
      "## Further Notes\n\n- None.\n\n" + S("first-working-version") + "\n",
    );
  });

  it("W4: leaves a Further Notes that already holds the sentence unchanged", () => {
    const markdown = "## Further Notes\n\n- None.\n\n" + S("full-spec") + "\n";
    expect(withDepthSentence(markdown, "full-spec")).toBe(markdown);
  });

  it("W4: leaves markdown with no Further Notes heading unchanged", () => {
    const markdown = "## Summary\n\n- A.\n\n## Out of Scope\n\n- B.\n";
    expect(withDepthSentence(markdown, "full-spec")).toBe(markdown);
  });
});
