import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { buildPrompt } from "../server/interviewer/prompt.js";
import { aSynthesizeSpecRequest } from "../server/interviewer/test-fixtures.js";
import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import getSpec from "./get-spec.js";
import getTurn from "./get-turn.js";
import synthesizeSpec, { specRefusalReasons } from "./synthesize-spec.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

async function confirm(sessionId: string) {
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, sessionId));
}

/** A markdown document carrying every heading the app requires, in order. */
function goodSpecMarkdown(problem = "A settled idea."): string {
  return [
    "## Summary",
    "",
    "- Summary point 1.",
    "- Summary point 2.",
    "- Summary point 3.",
    "- Summary point 4.",
    "- Summary point 5.",
    "",
    "## Problem Statement",
    "",
    problem,
    "",
    "## Solution",
    "",
    "A workspace.",
    "",
    "## User Stories",
    "",
    "1. As a user, I want a workspace, so that I can see the shape of what I am deciding.",
    "",
    "## Implementation Decisions",
    "",
    "- The shape is a workspace.",
    "",
    "## Testing Decisions",
    "",
    "- Behaviour is tested at the action boundary.",
    "",
    "## Out of Scope",
    "",
    "- Anything not decided above.",
    "",
    "## Further Notes",
    "",
    "- None.",
  ].join("\n");
}

function specTurn(markdown: string): ScriptedTurn {
  return { kind: "synthesize-spec", result: { markdown } };
}

/** Inserts a decision row directly, bypassing the interviewer and any round. */
async function insertDecision(
  sessionId: string,
  overrides: Partial<typeof schema.decisions.$inferInsert> & {
    id: string;
    key: string;
    questionTitle: string;
  },
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      sessionId,
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

const oneUnblockedTicket: ScriptedTurn = {
  kind: "break-into-tickets",
  result: {
    tickets: [
      {
        number: 1,
        slug: "build-the-workspace",
        title: "Build the workspace",
        body: "Build the workspace shell.",
        blockedBy: [],
        implements: [1],
      },
    ],
  },
};

const TEMPLATE_SECTIONS = [
  "Problem Statement",
  "Solution",
  "User Stories",
  "Implementation Decisions",
  "Testing Decisions",
  "Out of Scope",
  "Further Notes",
];

function bullets(count: number, marker = "-"): string[] {
  return Array.from({ length: count }, (_, i) => `${marker} point ${i + 1}`);
}

function block(heading: string, body: string[]): string[] {
  return [heading, ...body, ""];
}

/** The eight sections in order, each template section followed by one plain line. */
function baseSections(summaryBody: string[], summaryHeading = "## Summary") {
  return [
    block(summaryHeading, summaryBody),
    ...TEMPLATE_SECTIONS.map((name) => block(`## ${name}`, ["", "Plain text."])),
  ];
}

function join(sections: string[][]): string {
  return sections.flat().join("\n");
}

function base(summaryBody: string[]): string {
  return join(baseSections(summaryBody));
}

const needs = (count: number) =>
  `The Summary section has ${count} top-level ${count === 1 ? "bullet" : "bullets"}; it needs 5 to 10.`;

describe("specRefusalReasons", () => {
  it("row 1: accepts 6 bullets", () => {
    expect(specRefusalReasons(base(bullets(6)))).toEqual([]);
  });
  it("row 2: accepts 5 bullets", () => {
    expect(specRefusalReasons(base(bullets(5)))).toEqual([]);
  });
  it("row 3: accepts 10 bullets", () => {
    expect(specRefusalReasons(base(bullets(10)))).toEqual([]);
  });
  it("row 4: refuses 4 bullets", () => {
    expect(specRefusalReasons(base(bullets(4)))).toEqual([needs(4)]);
  });
  it("row 5: refuses 11 bullets", () => {
    expect(specRefusalReasons(base(bullets(11)))).toEqual([needs(11)]);
  });
  it("row 6: says bullet for a count of 1", () => {
    expect(specRefusalReasons(base(bullets(1)))).toEqual([
      "The Summary section has 1 top-level bullet; it needs 5 to 10.",
    ]);
  });
  it("row 7: counts an empty Summary as 0 bullets", () => {
    expect(specRefusalReasons(base([]))).toEqual([needs(0)]);
  });
  it("row 8: counts - and * bullets alike", () => {
    const mixed = [0, 1, 2, 3, 4, 5].map((i) => `${i % 2 === 0 ? "-" : "*"} point ${i}`);
    expect(specRefusalReasons(base(mixed))).toEqual([]);
  });
  it("row 9: does not count indented bullets", () => {
    const nested = bullets(4).flatMap((line) => [line, "  - nested"]);
    expect(specRefusalReasons(base(nested))).toEqual([needs(4)]);
  });
  it("row 10: does not count numbered lines", () => {
    expect(
      specRefusalReasons(base([...bullets(4), "1. a", "2. b", "3. c"])),
    ).toEqual([needs(4)]);
  });
  it("row 11: counts bullets only inside the Summary section", () => {
    const sections = baseSections(bullets(4));
    sections[1] = block("## Problem Statement", ["", ...bullets(3)]);
    expect(specRefusalReasons(join(sections))).toEqual([needs(4)]);
  });
  it("row 12: requires a Summary section", () => {
    const sections = baseSections(bullets(6)).slice(1);
    expect(specRefusalReasons(join(sections))).toEqual([
      "The spec is missing the following required section: ## Summary.",
    ]);
  });
  it("row 13: refuses a Summary that does not open the spec", () => {
    const sections = baseSections(bullets(6));
    const [summary] = sections.splice(0, 1);
    sections.splice(2, 0, summary!);
    expect(specRefusalReasons(join(sections))).toEqual([
      "The spec must open with ## Summary; it opens with ## Problem Statement.",
    ]);
  });
  it("row 14: gives the position reason before the count reason", () => {
    const sections = baseSections(bullets(4));
    const [summary] = sections.splice(0, 1);
    sections.splice(2, 0, summary!);
    expect(specRefusalReasons(join(sections))).toEqual([
      "The spec must open with ## Summary; it opens with ## Problem Statement.",
      needs(4),
    ]);
  });
  it("row 15: keeps today's wording for one missing template section", () => {
    const sections = baseSections(bullets(6)).filter(
      (section) => section[0] !== "## Solution",
    );
    expect(specRefusalReasons(join(sections))).toEqual([
      "The spec is missing the following required section: ## Solution.",
    ]);
  });
  it("row 16: joins every missing heading in one reason, Summary first", () => {
    const sections = baseSections(bullets(6))
      .slice(1)
      .filter((section) => section[0] !== "## Solution");
    expect(specRefusalReasons(join(sections))).toEqual([
      "The spec is missing the following required sections: ## Summary, ## Solution.",
    ]);
  });
  it("row 17: does not take an indented heading for the Summary section", () => {
    expect(
      specRefusalReasons(join(baseSections(bullets(6), "  ## Summary"))),
    ).toEqual(["The spec is missing the following required section: ## Summary."]);
  });
  it("row 18: judges the first Summary section", () => {
    const sections = [...baseSections(bullets(4)), block("## Summary", bullets(6))];
    expect(specRefusalReasons(join(sections))).toEqual([needs(4)]);
  });
  it("row 19: names the section, not the raw heading line", () => {
    expect(
      specRefusalReasons(join(baseSections(bullets(6), "##  Summary"))),
    ).toEqual([]);
  });
});

describe("the bounds the prompt states are the bounds the check enforces", () => {
  it("accepts the stated minimum and maximum and refuses one outside each", () => {
    const prompt = buildPrompt(aSynthesizeSpecRequest());
    const match = /(\d+) to (\d+) top-level/.exec(prompt);
    expect(match).not.toBeNull();
    const min = Number(match![1]);
    const max = Number(match![2]);

    expect(specRefusalReasons(base(bullets(min)))).toEqual([]);
    expect(specRefusalReasons(base(bullets(max)))).toEqual([]);
    expect(specRefusalReasons(base(bullets(min - 1)))).toEqual([
      expect.stringContaining(`${min - 1} top-level`),
    ]);
    expect(specRefusalReasons(base(bullets(max + 1)))).toEqual([
      expect.stringContaining(`${max + 1} top-level`),
    ]);
  });
});

const SENTENCE =
  "The owner chose to grill this idea although readiness judged it not ready.";
const OVERRIDE_REASON = `## Further Notes must include this sentence: ${SENTENCE}`;
const M = ["A single buildable thing, not a method for deciding one"];

/** `base` with 6 Summary bullets, its section `name` holding `body` instead of its plain line. */
function baseWith(name: string, body: string[], summary = bullets(6)): string {
  const sections = baseSections(summary);
  const index = sections.findIndex((section) => section[0] === `## ${name}`);
  sections[index] = block(`## ${name}`, ["", ...body]);
  return join(sections);
}

describe("specRefusalReasons with a readiness override", () => {
  const override = { readinessOverride: true };

  it("row 11: accepts the sentence as Further Notes' line", () => {
    expect(specRefusalReasons(baseWith("Further Notes", [SENTENCE]), override)).toEqual([]);
  });
  it("row 12: refuses Further Notes without the sentence", () => {
    expect(specRefusalReasons(base(bullets(6)), override)).toEqual([OVERRIDE_REASON]);
  });
  it("row 13: refuses the sentence in another section only", () => {
    expect(
      specRefusalReasons(baseWith("Problem Statement", [SENTENCE]), override),
    ).toEqual([OVERRIDE_REASON]);
  });
  it("row 14: accepts the sentence broken over two lines", () => {
    const broken = [
      "The owner chose to grill this idea although",
      "readiness judged it not ready.",
    ];
    expect(specRefusalReasons(baseWith("Further Notes", broken), override)).toEqual([]);
  });
  it("row 15: asks for nothing without an override", () => {
    expect(specRefusalReasons(base(bullets(6)), { readinessOverride: false })).toEqual([]);
  });
  it("row 16: gives only the missing-section reason without Further Notes", () => {
    const sections = baseSections(bullets(6)).filter(
      (section) => section[0] !== "## Further Notes",
    );
    expect(specRefusalReasons(join(sections), override)).toEqual([
      "The spec is missing the following required section: ## Further Notes.",
    ]);
  });
  it("row 17: gives the override reason after the Summary count reason", () => {
    expect(specRefusalReasons(base(bullets(4)), override)).toEqual([
      "The Summary section has 4 top-level bullets; it needs 5 to 10.",
      OVERRIDE_REASON,
    ]);
  });
  it("row 17b: refuses a sentence that says the idea was judged ready", () => {
    expect(
      specRefusalReasons(
        baseWith("Further Notes", [
          "The owner chose to grill this idea although readiness judged it ready.",
        ]),
        override,
      ),
    ).toEqual([OVERRIDE_REASON]);
  });
  it("row 18: gives the override reason after the missing Summary", () => {
    const sections = baseSections(bullets(6)).slice(1);
    expect(specRefusalReasons(join(sections), override)).toEqual([
      "The spec is missing the following required section: ## Summary.",
      OVERRIDE_REASON,
    ]);
  });
});

describe("the sentence the prompt asks for passes the check", () => {
  it("the sentence the prompt asks for passes the check", () => {
    const prompt = buildPrompt(
      aSynthesizeSpecRequest({ readinessOverride: { missing: M } }),
    );
    const match = /Further Notes must include this sentence exactly: "([^"]+)"/.exec(prompt);
    expect(match).not.toBeNull();

    expect(
      specRefusalReasons(baseWith("Further Notes", [match![1]!]), {
        readinessOverride: true,
      }),
    ).toEqual([]);
  });
});

describe("synthesize-spec", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("refuses a session that is not confirmed", async () => {
    const session = await aSession();

    await expect(
      synthesizeSpec.run({ sessionId: session.id }),
    ).rejects.toThrow(/Only a confirmed session can synthesize a spec/);
  });

  it("refuses while a turn is working", async () => {
    const session = await aSession();
    await confirm(session.id);
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      synthesizeSpec.run({ sessionId: session.id }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("sends dispositioned decisions as out-of-scope and open-question entries, formatted with title, body and note", async () => {
    const session = await aSession();
    await confirm(session.id);
    await insertDecision(session.id, {
      id: "d-scope",
      key: "scope-key",
      questionTitle: "Should it support offline mode?",
      questionBody: "Came up mid-interview.",
      answerKind: "dispositioned",
      dispositionTarget: "out-of-scope",
      currentAnswer: "Later, once the core loop works.",
    });
    await insertDecision(session.id, {
      id: "d-scope-bare",
      key: "scope-bare-key",
      questionTitle: "Should it support plugins?",
      answerKind: "dispositioned",
      dispositionTarget: "out-of-scope",
      currentAnswer: "",
    });
    await insertDecision(session.id, {
      id: "d-open",
      key: "open-key",
      questionTitle: "Which auth provider?",
      questionBody: "Depends on what the user already has.",
      answerKind: "dispositioned",
      dispositionTarget: "open-question",
      currentAnswer: "Revisit once we know the target platform.",
    });
    const interviewer = scriptInterviewer([specTurn(goodSpecMarkdown())]);

    await synthesizeSpec.run({ sessionId: session.id });

    expect(interviewer.requests[0]).toMatchObject({
      kind: "synthesize-spec",
      outOfScope: [
        "Should it support offline mode? — Came up mid-interview. — Later, once the core loop works.",
        "Should it support plugins?",
      ],
      openQuestions: [
        "Which auth provider? — Depends on what the user already has. — Revisit once we know the target platform.",
      ],
    });
  });

  it("a builder's call is in neither the out-of-scope nor the open-questions list", async () => {
    const session = await aSession();
    await confirm(session.id);
    await insertDecision(session.id, {
      id: "d-scope",
      key: "scope-key",
      questionTitle: "Offline mode?",
      answerKind: "dispositioned",
      dispositionTarget: "out-of-scope",
      currentAnswer: "Later.",
    });
    await insertDecision(session.id, {
      id: "d-open",
      key: "open-key",
      questionTitle: "Which auth provider?",
      answerKind: "dispositioned",
      dispositionTarget: "open-question",
      currentAnswer: "Depends on the platform.",
    });
    await insertDecision(session.id, {
      id: "d-builder",
      key: "builder-key",
      questionTitle: "Where does the data live?",
      answerKind: "dispositioned",
      dispositionTarget: "builders-call",
      currentAnswer: "The builder picks the storage.",
    });
    const interviewer = scriptInterviewer([specTurn(goodSpecMarkdown())]);

    await synthesizeSpec.run({ sessionId: session.id });

    const request = interviewer.requests[0] as { outOfScope: string[]; openQuestions: string[] };
    expect(request.outOfScope).toEqual(["Offline mode? — Later."]);
    expect(request.openQuestions).toEqual(["Which auth provider? — Depends on the platform."]);
  });

  it("rejects a spec missing a required heading and stores the corrected retry", async () => {
    const session = await aSession();
    await confirm(session.id);
    const missingHeading = goodSpecMarkdown().replace(
      "## Testing Decisions\n\n- Behaviour is tested at the action boundary.\n\n",
      "",
    );
    const interviewer = scriptInterviewer([
      specTurn(missingHeading),
      specTurn(goodSpecMarkdown("The corrected spec.")),
    ]);

    const result = await synthesizeSpec.run({ sessionId: session.id });

    expect(interviewer.requests).toHaveLength(2);
    expect(interviewer.requests[1]).toMatchObject({
      rejectionReason: expect.stringContaining("## Testing Decisions"),
    });
    expect(result.markdown).toContain("The corrected spec.");
  });

  it("rejects a Summary with too few bullets and stores the corrected retry", async () => {
    const session = await aSession();
    await confirm(session.id);
    const shortSummary = goodSpecMarkdown().replace("- Summary point 5.\n", "");
    const interviewer = scriptInterviewer([
      specTurn(shortSummary),
      specTurn(goodSpecMarkdown("The corrected spec.")),
    ]);

    const result = await synthesizeSpec.run({ sessionId: session.id });

    expect(interviewer.requests).toHaveLength(2);
    expect(interviewer.requests[1]).toMatchObject({
      rejectionReason: expect.stringContaining("4 top-level bullets"),
    });
    expect(result.markdown).toContain("The corrected spec.");
  });

  it("gives up after exhausting retries, stores nothing, and records a failed turn", async () => {
    const session = await aSession();
    await confirm(session.id);
    const bad = specTurn("## Problem Statement\n\nIncomplete.");
    const interviewer = scriptInterviewer([bad, bad, bad]);

    await expect(
      synthesizeSpec.run({ sessionId: session.id }),
    ).rejects.toThrow(/failed its section check 3 times/);

    expect(interviewer.requests).toHaveLength(3);
    expect((await getSpec.run({ sessionId: session.id })).spec).toBeNull();
    expect(await getSession.run({ id: session.id })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-spec",
    });
  });

  it("regenerates the spec, replacing its markdown and marking any generated tickets out of date", async () => {
    const session = await aSession();
    await confirm(session.id);
    scriptInterviewer([specTurn(goodSpecMarkdown("First version."))]);
    await synthesizeSpec.run({ sessionId: session.id });

    scriptInterviewer([oneUnblockedTicket]);
    await breakIntoTickets.run({ sessionId: session.id });
    expect((await getSpec.run({ sessionId: session.id })).ticketsCurrent).toBe(
      true,
    );

    scriptInterviewer([specTurn(goodSpecMarkdown("Second version."))]);
    const result = await synthesizeSpec.run({ sessionId: session.id });

    expect(result.markdown).toContain("Second version.");
    expect(result.markdown).not.toContain("First version.");

    const after = await getSpec.run({ sessionId: session.id });
    expect(after.spec?.markdown).toContain("Second version.");
    expect(after.ticketsCurrent).toBe(false);
  });

  describe("turn records", () => {
    it("records a clean synthesis as one successful attempt, on the session's model, linked to the spec", async () => {
      const session = await aSession();
      await confirm(session.id);
      scriptInterviewer([specTurn(goodSpecMarkdown())]);

      await synthesizeSpec.run({ sessionId: session.id });

      const latest = await findLatestTurn({
        sessionId: session.id,
        turnKind: "synthesize-spec",
      });
      expect(latest).not.toBeNull();
      const turn = await getTurn.run({ turnId: latest!.id });
      expect(turn).toMatchObject({
        sessionId: session.id,
        turnKind: "synthesize-spec",
        model: session.model,
        outcome: "succeeded",
      });
      expect(turn.runs).toHaveLength(1);
      expect(turn.runs[0]!.attempts).toEqual([
        expect.objectContaining({ attemptNumber: 1, kind: "success" }),
      ]);
      expect((await getSpec.run({ sessionId: session.id })).spec?.turnId).toBe(
        turn.id,
      );
    });

    it("keeps no turn linked on the spec once retries are exhausted", async () => {
      const session = await aSession();
      await confirm(session.id);
      const bad = specTurn("## Problem Statement\n\nIncomplete.");
      scriptInterviewer([bad, bad, bad]);

      await expect(
        synthesizeSpec.run({ sessionId: session.id }),
      ).rejects.toThrow(/failed its section check 3 times/);

      const latest = await findLatestTurn({
        sessionId: session.id,
        turnKind: "synthesize-spec",
      });
      expect(latest).not.toBeNull();
      expect(latest!.outcome).toBe("invalid-spec");
      expect((await getSpec.run({ sessionId: session.id })).spec).toBeNull();
    });
  });

  it("a grilled-as-is session's spec must say so", async () => {
    const session = await aSession();
    await confirm(session.id);
    await getDb()
      .update(schema.sessions)
      .set({
        readinessOverrideJson: JSON.stringify({
          missing: M,
          verdictJudgedAt: "2026-10-31T09:00:00.000Z",
          at: "2026-10-31T10:00:00.000Z",
        }),
      })
      .where(eq(schema.sessions.id, session.id));
    const retry = goodSpecMarkdown().replace(
      "## Further Notes\n\n- None.",
      `## Further Notes\n\n${SENTENCE}\n\n- ${M[0]}`,
    );
    const interviewer = scriptInterviewer([
      specTurn(goodSpecMarkdown()),
      specTurn(retry),
    ]);

    const stored = await synthesizeSpec.run({ sessionId: session.id });

    expect(interviewer.requests[0]!.kind).toBe("synthesize-spec");
    expect(
      (interviewer.requests[0] as { readinessOverride?: unknown }).readinessOverride,
    ).toEqual({ missing: M });
    expect(interviewer.requests[1]?.rejectionReason).toContain(OVERRIDE_REASON);
    expect(stored.markdown).toBe(retry);
  });

  it("a session started without an override sends none", async () => {
    const session = await aSession();
    await confirm(session.id);
    const interviewer = scriptInterviewer([specTurn(goodSpecMarkdown())]);

    await synthesizeSpec.run({ sessionId: session.id });

    expect(
      (interviewer.requests[0] as { readinessOverride?: unknown }).readinessOverride,
    ).toBeNull();
  });
});

describe("get-spec", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("returns null and ticketsCurrent false when nothing has been synthesized", async () => {
    const session = await aSession();

    expect(await getSpec.run({ sessionId: session.id })).toEqual({
      spec: null,
      ticketsCurrent: false,
    });
  });

  it("throws for a session id that does not exist", async () => {
    await expect(
      getSpec.run({ sessionId: "missing" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("reports ticketsCurrent false once a spec exists but no tickets have been generated", async () => {
    const session = await aSession();
    await confirm(session.id);
    scriptInterviewer([specTurn(goodSpecMarkdown())]);
    await synthesizeSpec.run({ sessionId: session.id });

    const { spec, ticketsCurrent } = await getSpec.run({ sessionId: session.id });
    expect(spec?.markdown).toContain("A settled idea.");
    expect(spec?.current).toBe(true);
    expect(ticketsCurrent).toBe(false);
  });

  it("reports ticketsCurrent true once tickets have been generated from the current spec", async () => {
    const session = await aSession();
    await confirm(session.id);
    scriptInterviewer([specTurn(goodSpecMarkdown())]);
    await synthesizeSpec.run({ sessionId: session.id });
    scriptInterviewer([oneUnblockedTicket]);
    await breakIntoTickets.run({ sessionId: session.id });

    expect((await getSpec.run({ sessionId: session.id })).ticketsCurrent).toBe(
      true,
    );
  });
});
