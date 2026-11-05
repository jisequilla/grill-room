import { describe, expect, it } from "vitest";

import messages from "@/i18n/en-US";

import {
  DEPTHS,
  TECHNICAL_LEVELS,
  type Depth,
  type TechnicalLevel,
} from "../../shared/session-constants.js";
import {
  type KeyedTreeDecision,
  type ProposedDecision,
  recommendedChoiceRejection,
  validateProposal,
} from "../tree.js";
import {
  buildPrompt,
  DEPTH_SECTIONS,
  DONE_WHILE_ASKED_RULE,
  LEAVE_IT_TO_THE_BUILDER,
  LEVEL_SECTIONS,
} from "./prompt.js";
import {
  aContext,
  aFindSupersededRequest,
  anAssessReadinessRequest,
  aProposeRoundRequest,
  aReviewStaleRequest,
  aSynthesizeSpecRequest,
} from "./test-fixtures.js";
import type { CheckConsistencyRequest, InterviewContext } from "./types.js";

const ALL_SECTIONS = [
  ...DEPTHS.map((depth) => DEPTH_SECTIONS[depth]),
  ...TECHNICAL_LEVELS.map((level) => LEVEL_SECTIONS[level]),
];

function prompt(
  kind: "propose-round" | "review-stale",
  ctx: Partial<InterviewContext>,
): string {
  const context = aContext(ctx);
  return kind === "propose-round"
    ? buildPrompt(aProposeRoundRequest({ context }))
    : buildPrompt(aReviewStaleRequest({ context }));
}

function expectOnlyDepth(text: string, depth: Depth | null) {
  for (const other of DEPTHS) {
    if (other === depth) expect(text).toContain(DEPTH_SECTIONS[other]);
    else expect(text).not.toContain(DEPTH_SECTIONS[other]);
  }
}

function expectOnlyLevel(text: string, level: TechnicalLevel | null) {
  for (const other of TECHNICAL_LEVELS) {
    if (other === level) expect(text).toContain(LEVEL_SECTIONS[other]);
    else expect(text).not.toContain(LEVEL_SECTIONS[other]);
  }
}

describe("the propose-round prompt pitched to depth and level", () => {
  it.each(DEPTHS)("P1: carries the %s depth section and no other", (depth) => {
    expectOnlyDepth(prompt("propose-round", { depth }), depth);
  });

  it.each(TECHNICAL_LEVELS)(
    "P2: carries the %s level section and no other",
    (level) => {
      expectOnlyLevel(prompt("propose-round", { technicalLevel: level }), level);
    },
  );

  it("P3: renders a section only when its field is set, and a null level as none", () => {
    const plain = prompt("propose-round", {});
    for (const section of ALL_SECTIONS) expect(plain).not.toContain(section);

    const nullLevel = prompt("propose-round", {
      depth: "full-spec",
      technicalLevel: null,
    });
    expectOnlyDepth(nullLevel, "full-spec");
    expectOnlyLevel(nullLevel, null);
  });
});

describe("the review-stale prompt pitched to level only", () => {
  it("P4: carries the level section and no depth section", () => {
    const text = prompt("review-stale", {
      depth: "proof-of-concept",
      technicalLevel: "not-technical",
    });
    expectOnlyLevel(text, "not-technical");
    expectOnlyDepth(text, null);
  });
});

describe("the prompts that are not pitched", () => {
  const context = aContext({
    depth: "proof-of-concept",
    technicalLevel: "not-technical",
  });
  const consistency: CheckConsistencyRequest = {
    kind: "check-consistency",
    context,
    specMarkdown: "# Spec\n\nA spec.",
    tickets: [
      { number: 1, title: "Build it", body: "Build it.", kind: "build", waitsFor: null },
    ],
    previousResult: null,
    rejectionReason: null,
  };

  it.each([
    ["find-superseded", () => buildPrompt(aFindSupersededRequest({ context }))],
    ["synthesize-spec", () => buildPrompt(aSynthesizeSpecRequest({ context }))],
    ["assess-readiness", () => buildPrompt(anAssessReadinessRequest({ context }))],
    ["check-consistency", () => buildPrompt(consistency)],
  ])("P5: the %s prompt carries no depth or level section", (_kind, build) => {
    const text = build();
    for (const section of ALL_SECTIONS) expect(text).not.toContain(section);
  });
});

describe("the section texts", () => {
  it.each(["technical-not-building", "not-technical"] as const)(
    "P6a: the %s level offers the builder's call and keeps every technology question",
    (level) => {
      const text = LEVEL_SECTIONS[level];
      expect(text).toContain("`Leave it to the builder`");
      expect(text).toContain(
        "Still ask every technology question, and still show the owner every choice whose consequence they would see.",
      );
      expect(text).toContain(
        "Never treat your recommendation as the owner's answer: only the owner's answer settles a decision.",
      );
    },
  );

  it("P6b: a first working version still asks every technology decision", () => {
    expect(DEPTH_SECTIONS["first-working-version"]).toContain(
      "Still ask every technology decision.",
    );
  });

  it("P6c: the builder level is never told to leave technology to the builder", () => {
    expect(LEVEL_SECTIONS.builder).not.toContain(LEAVE_IT_TO_THE_BUILDER);
  });

  it.each(DEPTHS)("P7: the %s depth section ends with the done rule", (depth) => {
    expect(DEPTH_SECTIONS[depth].endsWith(DONE_WHILE_ASKED_RULE)).toBe(true);
  });

  it("P8: the set-aside dialog labels the builder's call as the card choice does", () => {
    expect(messages.workspace.targetBuildersCall).toBe(LEAVE_IT_TO_THE_BUILDER);
  });
});

describe("the server checks the sections rely on", () => {
  it("S1: accepts a recommendation that points at the Leave-it choice", () => {
    const proposed: ProposedDecision = {
      key: "database",
      title: "Which database?",
      body: "Where the data is kept.",
      dependsOn: [],
      ask: true,
      choices: [
        { label: "Use Postgres", rationale: "A well-known relational store." },
        {
          label: LEAVE_IT_TO_THE_BUILDER,
          rationale: "No consequence the owner would see.",
        },
      ],
      recommendedChoice: 1,
      adrWorthy: false,
      consequences: null,
    };
    expect(recommendedChoiceRejection(proposed)).toBeNull();
    expect(validateProposal([], [proposed]).ok).toBe(true);
  });

  it("S2: accepts done over a tree that never opened a scale, edge-case or operations branch", () => {
    const existing: KeyedTreeDecision[] = [
      {
        id: "id-shape",
        key: "shape",
        title: "What shape should this take?",
        body: "The first thing to settle.",
        dependsOn: [],
        answerKind: "own-answer",
        settledAt: "2026-01-01T00:00:00.000Z",
        reopenedAt: null,
      },
      {
        id: "id-database",
        key: "database",
        title: "Which database?",
        body: "Where the data is kept.",
        dependsOn: ["id-shape"],
        answerKind: "dispositioned",
        settledAt: "2026-01-01T00:00:00.000Z",
        reopenedAt: null,
      },
    ];
    expect(validateProposal(existing, [], { done: true })).toEqual({
      ok: true,
      reasons: [],
    });
  });

  it("S3: refuses done while a technology card would still be asked", () => {
    const existing: KeyedTreeDecision[] = [
      {
        id: "id-database",
        key: "database",
        title: "Which database?",
        body: "A technology choice still on the frontier.",
        dependsOn: [],
        answerKind: null,
        settledAt: null,
        reopenedAt: null,
      },
    ];
    const validation = validateProposal(existing, [], { done: true });
    expect(validation.ok).toBe(false);
    expect(validation.reasons.join("\n")).toContain(
      "would still be asked in a round",
    );
  });
});
