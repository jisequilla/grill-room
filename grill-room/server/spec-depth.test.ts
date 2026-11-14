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

  it.each(["proof-of-concept", "first-working-version"] as const)(
    "T4: at %s the bar is the one paragraph right after Be conservative",
    (depth) => {
      const bar = CONSISTENCY_DEPTH_BARS[depth]!;
      expect(consistency(depth)).toContain(
        `is the right answer when nothing is left open.\n\n${bar}`,
      );
    },
  );

  it.each(["proof-of-concept", "first-working-version"] as const)(
    "T4b: the %s bar names no kind, no field and no markup",
    (depth) => {
      const bar = CONSISTENCY_DEPTH_BARS[depth]!;
      const forbidden = [
        "`",
        "unquantified-threshold",
        "one-case-rule",
        "spec-ticket-contradiction",
        "open-choice",
        "undefaulted-value",
        "unnamed-target",
        "kind",
        "at.quote",
        "against",
        "decisionKey",
        "findings",
      ];
      for (const word of forbidden) expect(bar).not.toContain(word);
    },
  );

  it("T4c: the bar sits after Be conservative and before the retry block", () => {
    const bar = CONSISTENCY_DEPTH_BARS["proof-of-concept"]!;
    const prompt = buildPrompt(
      aCheckConsistencyRequest({
        context: aContext({ depth: "proof-of-concept" }),
        rejectionReason: "Finding 1 has an empty quote.",
        previousResult: { findings: [] },
      }),
    );
    const retry = prompt.indexOf("## Your previous answer was rejected");
    expect(retry).toBeGreaterThan(-1);
    expect(prompt.indexOf("is the right answer when nothing is left open.")).toBeLessThan(
      prompt.indexOf(bar),
    );
    expect(prompt.indexOf(bar)).toBeGreaterThan(-1);
    expect(prompt.indexOf(bar)).toBeLessThan(retry);
  });
});

describe("the synthesis prompt names the depth in the Summary", () => {
  it.each(DEPTHS)("T5: at %s the Summary rule's next line is that depth's rule, and no other", (depth) => {
    const prompt = buildPrompt(aSynthesizeSpecRequest({ context: aContext({ depth }) }));
    const lines = prompt.split("\n");
    const summaryRule = lines.findIndex((line) =>
      line.startsWith("- The `## Summary` section holds"),
    );
    expect(summaryRule).toBeGreaterThan(-1);
    expect(lines[summaryRule + 1]).toBe(DEPTH_SUMMARY_RULES[depth]);
    for (const other of DEPTHS) {
      if (other !== depth) expect(prompt).not.toContain(DEPTH_SUMMARY_RULES[other]);
    }
  });

  it("T5: with no depth it carries no Summary depth rule", () => {
    const prompt = buildPrompt(aSynthesizeSpecRequest());
    for (const depth of DEPTHS) expect(prompt).not.toContain(DEPTH_SUMMARY_RULES[depth]);
  });
});

describe("the depth constants are the ticket's literals", () => {
  it("T7: DEPTH_SPEC_SENTENCES", () => {
    expect(DEPTH_SPEC_SENTENCES["proof-of-concept"]).toBe(
      "This spec was grilled as a proof of concept: scale, edge cases and operations were left to the builder.",
    );
    expect(DEPTH_SPEC_SENTENCES["first-working-version"]).toBe(
      "This spec was grilled as a first working version: scale and operations were left to the builder.",
    );
    expect(DEPTH_SPEC_SENTENCES["full-spec"]).toBe(
      "This spec was grilled as a full spec: every branch was asked.",
    );
  });

  it("T7: DEPTH_SUMMARY_RULES", () => {
    expect(DEPTH_SUMMARY_RULES["proof-of-concept"]).toBe(
      "- One `## Summary` bullet says, in plain words, that this spec is for a proof of concept.",
    );
    expect(DEPTH_SUMMARY_RULES["first-working-version"]).toBe(
      "- One `## Summary` bullet says, in plain words, that this spec is for a first working version.",
    );
    expect(DEPTH_SUMMARY_RULES["full-spec"]).toBe(
      "- One `## Summary` bullet says, in plain words, that this spec is for a full spec.",
    );
  });

  it("T7: CONSISTENCY_DEPTH_BARS", () => {
    expect(CONSISTENCY_DEPTH_BARS["proof-of-concept"]).toBe(
      "This spec was grilled as a proof of concept, so more is left to the builder on purpose. Report only a statement whose answer only the owner can give. A threshold, value, choice or target the builder can pick for the experiment is not a finding at this depth.",
    );
    expect(CONSISTENCY_DEPTH_BARS["first-working-version"]).toBe(
      "This spec was grilled as a first working version, so scale and operations are left to the builder. Report only a statement whose answer the owner would see or pay for: what a user can do, what they see, or what it costs. A gap only the builder would notice, such as a scale limit, an operational setting or an internal timeout, is not a finding at this depth.",
    );
    expect(CONSISTENCY_DEPTH_BARS["full-spec"]).toBeNull();
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

  it("W4: leaves the W1 output unchanged at the same depth", () => {
    const markdown = "## Summary\n\n- A.\n\n## Further Notes\n\n- None.\n\n" + S("full-spec") + "\n";
    expect(withDepthSentence(markdown, "full-spec")).toBe(markdown);
  });

  it("W4: leaves markdown with no Further Notes heading unchanged", () => {
    const markdown = "## Summary\n\n- A.\n\n## Out of Scope\n\n- B.\n";
    expect(withDepthSentence(markdown, "full-spec")).toBe(markdown);
  });
  it("W4c: replaces an earlier depth's sentence", () => {
    expect(
      withDepthSentence("## Further Notes\n\n- A.\n\n" + S("proof-of-concept") + "\n", "full-spec"),
    ).toBe("## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n");
  });

  it("W5: drops extra blank lines before the sentence", () => {
    expect(withDepthSentence("## Further Notes\n\n- A.\n\n\n## Appendix\n", "full-spec")).toBe(
      "## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n\n## Appendix\n",
    );
  });

  it("W6: does not double a trailing blank line at the end of the markdown", () => {
    expect(withDepthSentence("## Further Notes\n\n- A.\n\n", "full-spec")).toBe(
      "## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n",
    );
  });

  it("W7: keeps a ### subsection inside the section", () => {
    expect(withDepthSentence("## Further Notes\n\n- A.\n\n### Later\n\n- B.\n", "full-spec")).toBe(
      "## Further Notes\n\n- A.\n\n### Later\n\n- B.\n\n" + S("full-spec") + "\n",
    );
  });

  it("W8: ends the section at a # heading", () => {
    expect(withDepthSentence("## Further Notes\n\n- A.\n\n# Appendix\n", "full-spec")).toBe(
      "## Further Notes\n\n- A.\n\n" + S("full-spec") + "\n\n# Appendix\n",
    );
  });

  it("W9: moves this depth's sentence from mid-section to the end", () => {
    expect(
      withDepthSentence("## Further Notes\n\n" + S("full-spec") + "\n\n- B.\n", "full-spec"),
    ).toBe("## Further Notes\n\n- B.\n\n" + S("full-spec") + "\n");
  });

  it("W10: removes another depth's sentence from mid-section, with its blank line", () => {
    expect(
      withDepthSentence("## Further Notes\n\n" + S("proof-of-concept") + "\n\n- B.\n", "full-spec"),
    ).toBe("## Further Notes\n\n- B.\n\n" + S("full-spec") + "\n");
  });

  it("W11: matches the heading the way the spec check does", () => {
    expect(withDepthSentence("##  Further Notes  \n\n- A.\n", "full-spec")).toBe(
      "##  Further Notes  \n\n- A.\n\n" + S("full-spec") + "\n",
    );
  });
});
