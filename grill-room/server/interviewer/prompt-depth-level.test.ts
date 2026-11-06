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

/** The last line of each task's own text, before any section is appended. */
const PROPOSE_ROUND_END = "than moving past it.";
const REVIEW_STALE_END = "the point of this step.";

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
    const text = prompt("propose-round", { depth });
    expectOnlyDepth(text, depth);
    expect(text).toContain(`${PROPOSE_ROUND_END}\n\n${DEPTH_SECTIONS[depth]}`);
  });

  it.each(TECHNICAL_LEVELS)(
    "P2: carries the %s level section and no other",
    (level) => {
      const text = prompt("propose-round", { technicalLevel: level });
      expectOnlyLevel(text, level);
      expect(text).toContain(`${PROPOSE_ROUND_END}\n\n${LEVEL_SECTIONS[level]}`);
    },
  );

  it("P1/P2: appends the depth section, then the level section, each after a blank line", () => {
    const text = prompt("propose-round", {
      depth: "proof-of-concept",
      technicalLevel: "builder",
    });
    expect(
      text.endsWith(
        `${PROPOSE_ROUND_END}\n\n${DEPTH_SECTIONS["proof-of-concept"]}\n\n${LEVEL_SECTIONS.builder}`,
      ),
    ).toBe(true);
  });

  it("P3: renders a section only when its field is set, and a null level as none", () => {
    const plain = prompt("propose-round", {});
    for (const section of ALL_SECTIONS) expect(plain).not.toContain(section);
    expect(plain.endsWith(PROPOSE_ROUND_END)).toBe(true);

    const nullLevel = prompt("propose-round", {
      depth: "full-spec",
      technicalLevel: null,
    });
    expectOnlyDepth(nullLevel, "full-spec");
    expectOnlyLevel(nullLevel, null);
    expect(nullLevel.endsWith(`${PROPOSE_ROUND_END}\n\n${DEPTH_SECTIONS["full-spec"]}`)).toBe(
      true,
    );
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
    expect(text.endsWith(`${REVIEW_STALE_END}\n\n${LEVEL_SECTIONS["not-technical"]}`)).toBe(true);
  });

  it("P3: renders today's review-stale task when the level is absent or null", () => {
    for (const technicalLevel of [undefined, null]) {
      const text = prompt("review-stale", { depth: "full-spec", technicalLevel });
      for (const section of ALL_SECTIONS) expect(text).not.toContain(section);
      expect(text.endsWith(REVIEW_STALE_END)).toBe(true);
    }
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

  it.each([
    ["proof-of-concept", "## How deep to grill: a proof of concept\n\n"],
    ["first-working-version", "## How deep to grill: a first working version\n\n"],
    ["full-spec", "## How deep to grill: a full spec\n\n"],
  ] as const)("P1: the %s depth section opens with its own heading", (depth, heading) => {
    expect(DEPTH_SECTIONS[depth].startsWith(heading)).toBe(true);
  });

  it.each([
    ["builder", "## The owner's technical level: builder\n\n"],
    ["technical-not-building", "## The owner's technical level: technical, not building\n\n"],
    ["not-technical", "## The owner's technical level: not technical\n\n"],
  ] as const)("P2: the %s level section opens with its own heading", (level, heading) => {
    expect(LEVEL_SECTIONS[level].startsWith(heading)).toBe(true);
  });

  it.each([
    [
      "proof-of-concept",
      "Do not propose decisions about scale, edge cases or operations (hosting, monitoring, backups, on-call): the builder makes those calls. Propose `done` once the core thing to try is settled.",
    ],
    [
      "first-working-version",
      "Ask about edge cases: odd inputs, empty states and failures a user would meet.",
    ],
    ["full-spec", "Open every branch, scale, edge cases and operations included."],
  ] as const)("P1: the %s depth section carries its own body", (depth, sentence) => {
    expect(DEPTH_SECTIONS[depth]).toContain(sentence);
  });

  it.each([
    [
      "builder",
      "The owner builds software and makes the technology calls. Keep technical wording, and name technologies, paths and products where they help.",
    ],
    [
      "technical-not-building",
      "The owner follows technical talk but will not build this. Keep technical wording, but phrase every recommendation by its consequences for the owner: cost, speed, lock-in, what users see.",
    ],
    [
      "not-technical",
      "The owner is not technical. Write every card in plain words: no file paths, and no product or technology names in a card's title or body unless the idea itself uses them. Put every technology question as its consequences for the owner: cost, speed, lock-in, what users see.",
    ],
  ] as const)("P2: the %s level section carries its own body", (level, sentence) => {
    expect(LEVEL_SECTIONS[level]).toContain(sentence);
  });

  it.each([
    [
      "proof-of-concept",
      `## How deep to grill: a proof of concept\n\nThe owner wants a proof of concept: the smallest thing that tries the idea. Do not propose decisions about scale, edge cases or operations (hosting, monitoring, backups, on-call): the builder makes those calls. Propose \`done\` once the core thing to try is settled. ${DONE_WHILE_ASKED_RULE}`,
    ],
    [
      "first-working-version",
      `## How deep to grill: a first working version\n\nThe owner wants a first working version that real users can use. Ask about edge cases: odd inputs, empty states and failures a user would meet. Do not propose decisions about scale or operations (hosting, monitoring, backups, on-call): the builder makes those calls. Still ask every technology decision. Propose \`done\` once every user-facing flow and the data it keeps are settled. ${DONE_WHILE_ASKED_RULE}`,
    ],
    [
      "full-spec",
      `## How deep to grill: a full spec\n\nThe owner wants a full spec. Open every branch, scale, edge cases and operations included. Propose \`done\` only when nothing is left to the builder's guesswork. ${DONE_WHILE_ASKED_RULE}`,
    ],
  ] as const)("P1: the %s depth section is exactly the ticket's text", (depth, text) => {
    expect(DEPTH_SECTIONS[depth]).toBe(text);
  });

  it.each([
    [
      "builder",
      "## The owner's technical level: builder\n\nThe owner builds software and makes the technology calls. Keep technical wording, and name technologies, paths and products where they help.",
    ],
    [
      "technical-not-building",
      "## The owner's technical level: technical, not building\n\nThe owner follows technical talk but will not build this. Keep technical wording, but phrase every recommendation by its consequences for the owner: cost, speed, lock-in, what users see. For a pure technology choice with no consequence the owner would see, offer a choice labelled exactly `Leave it to the builder` and point `recommendedChoice` at it. Still ask every technology question, and still show the owner every choice whose consequence they would see. Never treat your recommendation as the owner's answer: only the owner's answer settles a decision.",
    ],
    [
      "not-technical",
      "## The owner's technical level: not technical\n\nThe owner is not technical. Write every card in plain words: no file paths, and no product or technology names in a card's title or body unless the idea itself uses them. Put every technology question as its consequences for the owner: cost, speed, lock-in, what users see. For a pure technology choice with no consequence the owner would see, offer a choice labelled exactly `Leave it to the builder` and point `recommendedChoice` at it. Still ask every technology question, and still show the owner every choice whose consequence they would see. Never treat your recommendation as the owner's answer: only the owner's answer settles a decision.",
    ],
  ] as const)("P2: the %s level section is exactly the ticket's text", (level, text) => {
    expect(LEVEL_SECTIONS[level]).toBe(text);
  });

  it("P7: the done rule is exactly the ticket's text", () => {
    expect(DONE_WHILE_ASKED_RULE).toBe(
      "A decision already in the tree, a technology decision included, must still be answered or set aside before `done`: never propose `done` while one would still be asked.",
    );
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
