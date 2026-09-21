import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import listLooseEnds from "./list-loose-ends.js";
import reopenDecision from "./reopen-decision.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
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

async function reasonsOf(sessionId: string) {
  const looseEnds = await listLooseEnds.run({ sessionId });
  return Object.fromEntries(
    looseEnds.map((end) => [end.key, end.reason]),
  ) as Record<string, string>;
}

describe("list-loose-ends", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(listLooseEnds.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("returns nothing for a session with no decisions", async () => {
    const session = await aSession();
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("lists every loose-end category with its reason, and excludes settled, dispositioned and withdrawn decisions", async () => {
    const session = await aSession();
    const now = new Date().toISOString();

    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "Unknown",
      answerKind: "unknown",
      currentAnswer: "Not sure",
    });
    await insertDecision(session.id, {
      id: "d-deferred",
      key: "deferred-key",
      questionTitle: "Deferred",
      answerKind: "deferred",
    });
    await insertDecision(session.id, {
      id: "d-proto",
      key: "proto-key",
      questionTitle: "Needs a prototype",
      answerKind: "prototype-flagged",
    });
    await insertDecision(session.id, {
      id: "d-pushed",
      key: "pushed-key",
      questionTitle: "Pushed back",
      answerKind: "pushed-back",
      currentAnswer: "Too vague",
    });
    await insertDecision(session.id, {
      id: "d-pushed-withdrawn",
      key: "pushed-withdrawn-key",
      questionTitle: "Pushed back, withdrawn",
      answerKind: "pushed-back",
      currentAnswer: "Too vague",
      withdrawnAt: now,
    });
    await insertDecision(session.id, {
      id: "d-never",
      key: "never-key",
      questionTitle: "Never answered, on the frontier",
    });
    await insertDecision(session.id, {
      id: "d-never-blocked",
      key: "never-blocked-key",
      questionTitle: "Never answered, blocked",
      dependsOnJson: JSON.stringify(["d-unknown"]),
    });
    await insertDecision(session.id, {
      id: "d-settled",
      key: "settled-key",
      questionTitle: "Settled",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-dispositioned",
      key: "dispositioned-key",
      questionTitle: "Dispositioned",
      answerKind: "dispositioned",
      dispositionTarget: "out-of-scope",
      currentAnswer: "",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-withdrawn-plain",
      key: "withdrawn-plain-key",
      questionTitle: "Withdrawn",
      withdrawnAt: now,
    });
    await insertDecision(session.id, {
      id: "d-base",
      key: "base-key",
      questionTitle: "Base",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-dependent",
      key: "dependent-key",
      questionTitle: "Dependent",
      answerKind: "own-answer",
      currentAnswer: "On disk",
      settledAt: now,
      dependsOnJson: JSON.stringify(["d-base"]),
    });
    const added = await addDecision.run({
      sessionId: session.id,
      title: "Unplaced",
      body: "",
    });

    // Reopening the base decision makes its dependent stale, and returns the
    // base itself to the frontier as a never-answered loose end of its own.
    await reopenDecision.run({ decisionId: "d-base" });

    const reasons = await reasonsOf(session.id);

    expect(reasons["unknown-key"]).toBe("unknown");
    expect(reasons["deferred-key"]).toBe("deferred");
    expect(reasons["proto-key"]).toBe("prototype-flagged");
    expect(reasons["pushed-key"]).toBe("pushed-back");
    expect(reasons["never-key"]).toBe("never-answered");
    expect(reasons["never-blocked-key"]).toBe("never-answered");
    expect(reasons["base-key"]).toBe("never-answered");
    expect(reasons["dependent-key"]).toBe("stale");
    expect(reasons[added.key as string]).toBe("unplaced");

    expect(reasons["pushed-withdrawn-key"]).toBeUndefined();
    expect(reasons["settled-key"]).toBeUndefined();
    expect(reasons["dispositioned-key"]).toBeUndefined();
    expect(reasons["withdrawn-plain-key"]).toBeUndefined();
  });
});
