import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

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
import synthesizeSpec from "./synthesize-spec.js";

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
      },
    ],
  },
};

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

  it("gives up after exhausting retries, stores nothing, and records a failed turn", async () => {
    const session = await aSession();
    await confirm(session.id);
    const bad = specTurn("## Problem Statement\n\nIncomplete.");
    const interviewer = scriptInterviewer([bad, bad, bad]);

    await expect(
      synthesizeSpec.run({ sessionId: session.id }),
    ).rejects.toThrow(/missing required sections 3 times/);

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
      ).rejects.toThrow(/missing required sections 3 times/);

      const latest = await findLatestTurn({
        sessionId: session.id,
        turnKind: "synthesize-spec",
      });
      expect(latest).not.toBeNull();
      expect(latest!.outcome).toBe("invalid-spec");
      expect((await getSpec.run({ sessionId: session.id })).spec).toBeNull();
    });
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
