import { eq, sql } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import getTree from "./get-tree.js";
import reopenDecision from "./reopen-decision.js";
import setAdrWorthy from "./set-adr-worthy.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

async function insertDecision(
  sessionId: string,
  overrides: Partial<typeof schema.decisions.$inferInsert> & {
    id: string;
    key: string;
  },
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      sessionId,
      questionTitle: `Title of ${overrides.key}`,
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

/** A settled decision of the given kind in a fresh session. */
async function aSettled(
  kind: "accepted-recommendation" | "own-answer" | "repo-established",
  overrides: Partial<Omit<typeof schema.decisions.$inferInsert, "id" | "key">> = {},
) {
  const session = await aSession();
  await insertDecision(session.id, {
    id: "d-1",
    key: "k-1",
    answerKind: kind,
    currentAnswer: "An answer",
    settledAt: new Date().toISOString(),
    ...overrides,
  });
  return session;
}

async function stored(id = "d-1") {
  const [row] = await getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id));
  return row;
}

async function expectRefused(
  input: Parameters<typeof setAdrWorthy.run>[0],
  errorCode: string,
  statusCode: number,
) {
  const before = await stored(input.decisionId);
  await expect(setAdrWorthy.run(input)).rejects.toMatchObject({ errorCode, statusCode });
  expect(await stored(input.decisionId)).toEqual(before);
}

describe("set-adr-worthy", () => {
  useTestDatabase();

  it("flags an accepted recommendation and trims the consequences", async () => {
    await aSettled("accepted-recommendation");
    const view = await setAdrWorthy.run({
      decisionId: "d-1",
      adrWorthy: true,
      consequences: "  Costs X.  ",
    });
    expect(view).toMatchObject({ id: "d-1", adrWorthy: true, consequences: "Costs X." });
    const row = await stored();
    expect(row.adrWorthy).toBe(true);
    expect(row.consequences).toBe("Costs X.");
  });

  it("keeps stored consequences when flagging an own answer without new ones", async () => {
    await aSettled("own-answer", { consequences: "Costs W." });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true });
    const row = await stored();
    expect(row.adrWorthy).toBe(true);
    expect(row.consequences).toBe("Costs W.");
  });

  it("flags a kept repo decision", async () => {
    await aSettled("repo-established", { introducedBy: "repo" });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true, consequences: "Costs Y." });
    const row = await stored();
    expect(row.adrWorthy).toBe(true);
    expect(row.consequences).toBe("Costs Y.");
  });

  it("unflagging keeps the consequences", async () => {
    await aSettled("own-answer", { adrWorthy: true, consequences: "Costs X." });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: false });
    const row = await stored();
    expect(row.adrWorthy).toBe(false);
    expect(row.consequences).toBe("Costs X.");
  });

  it("replaces the consequences of a flagged decision", async () => {
    await aSettled("own-answer", { adrWorthy: true, consequences: "Costs X." });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true, consequences: "Costs Z." });
    expect((await stored()).consequences).toBe("Costs Z.");
  });

  it("refuses flagging with no consequences stored or given", async () => {
    await aSettled("own-answer");
    await expectRefused({ decisionId: "d-1", adrWorthy: true }, "consequences-required", 400);
  });

  it("refuses flagging with blank consequences", async () => {
    await aSettled("own-answer", { consequences: "Costs X." });
    await expectRefused(
      { decisionId: "d-1", adrWorthy: true, consequences: "   " },
      "consequences-required",
      400,
    );
  });

  it("a blank edit while unflagging clears the consequences", async () => {
    await aSettled("own-answer", { adrWorthy: true, consequences: "Costs X." });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: false, consequences: "   " });
    const row = await stored();
    expect(row.adrWorthy).toBe(false);
    expect(row.consequences).toBeNull();
  });

  it("stores an edit of the consequences whatever the flag", async () => {
    await aSettled("own-answer", { adrWorthy: true, consequences: "Costs X." });
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: false, consequences: "  Costs Q.  " });
    const row = await stored();
    expect(row.adrWorthy).toBe(false);
    expect(row.consequences).toBe("Costs Q.");
  });

  it("refuses an open decision as not settled, before asking for consequences", async () => {
    const session = await aSession();
    await insertDecision(session.id, { id: "d-1", key: "k-1" });
    await expectRefused({ decisionId: "d-1", adrWorthy: true }, "decision-not-settled", 409);
  });

  it("works while the session's turn is working", async () => {
    const session = await aSettled("own-answer");
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true, consequences: "Costs X." });
    expect((await stored()).adrWorthy).toBe(true);
  });

  it("refuses a dispositioned decision", async () => {
    await aSettled("own-answer", { answerKind: "dispositioned", dispositionTarget: "out-of-scope" });
    await expectRefused(
      { decisionId: "d-1", adrWorthy: true, consequences: "Costs X." },
      "decision-not-settled",
      409,
    );
  });

  it.each(["unknown", "deferred", "pushed-back", "prototype-flagged"] as const)(
    "refuses a %s steering move",
    async (kind) => {
      await aSettled("own-answer", { answerKind: kind });
      await expectRefused(
        { decisionId: "d-1", adrWorthy: true, consequences: "Costs X." },
        "decision-not-settled",
        409,
      );
    },
  );

  it("refuses a blocked decision", async () => {
    const session = await aSession();
    await insertDecision(session.id, { id: "d-base", key: "base" });
    await insertDecision(session.id, {
      id: "d-1",
      key: "k-1",
      dependsOnJson: JSON.stringify(["d-base"]),
    });
    await expectRefused({ decisionId: "d-1", adrWorthy: true, consequences: "X." }, "decision-not-settled", 409);
  });

  it("refuses a stale decision", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await insertDecision(session.id, {
      id: "d-base",
      key: "base",
      answerKind: "own-answer",
      currentAnswer: "A",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-1",
      key: "k-1",
      answerKind: "own-answer",
      currentAnswer: "B",
      settledAt: now,
      dependsOnJson: JSON.stringify(["d-base"]),
    });
    await reopenDecision.run({ decisionId: "d-base" });
    await expectRefused({ decisionId: "d-1", adrWorthy: true, consequences: "X." }, "decision-not-settled", 409);
  });

  it("refuses an unplaced decision", async () => {
    const session = await aSession();
    const added = await addDecision.run({ sessionId: session.id, title: "Offline mode?" });
    await expectRefused({ decisionId: added.id, adrWorthy: true, consequences: "X." }, "decision-not-settled", 409);
  });

  it("refuses a withdrawn decision", async () => {
    await aSettled("own-answer", { withdrawnAt: new Date().toISOString() });
    await expectRefused({ decisionId: "d-1", adrWorthy: true, consequences: "X." }, "decision-not-settled", 409);
  });

  it("refuses a decision a later one replaced", async () => {
    const session = await aSettled("own-answer", { replacedById: "d-2", replacedReason: "Newer" });
    await insertDecision(session.id, {
      id: "d-2",
      key: "k-2",
      answerKind: "own-answer",
      currentAnswer: "Newer",
      settledAt: new Date().toISOString(),
    });
    await expectRefused({ decisionId: "d-1", adrWorthy: true, consequences: "X." }, "decision-replaced", 409);
  });

  it("answers 404 for a missing decision", async () => {
    await expect(
      setAdrWorthy.run({ decisionId: "nope", adrWorthy: true, consequences: "X." }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("a decision created before the flag reads unflagged with no consequences", async () => {
    const session = await aSession();
    await getDb().execute(
      sql`INSERT INTO gr_decisions (id, session_id, key, question_title, question_body, offered_choices_json, depends_on_json, introduced_by, created_at, updated_at)
          VALUES ('d-old', ${session.id}, 'old', 'Old', '', '[]', '[]', 'interviewer', 'now', 'now')`,
    );
    const tree = await getTree.run({ sessionId: session.id });
    expect(tree.decisions.find((d) => d.id === "d-old")).toMatchObject({
      adrWorthy: false,
      consequences: null,
    });
  });

  it("reopening a flagged decision keeps its flag and consequences", async () => {
    const session = await aSettled("own-answer");
    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true, consequences: "Costs X." });
    await reopenDecision.run({ decisionId: "d-1" });
    const tree = await getTree.run({ sessionId: session.id });
    const view = tree.decisions.find((d) => d.id === "d-1");
    expect(view).toMatchObject({ adrWorthy: true, consequences: "Costs X." });
    expect(view?.state).not.toBe("settled");
    await expectRefused({ decisionId: "d-1", adrWorthy: false }, "decision-not-settled", 409);
  });

  it("flagging changes nothing but the flag and consequences", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-0",
      key: "k-0",
      answerKind: "own-answer",
      currentAnswer: "Parent answer",
      settledAt: new Date().toISOString(),
    });
    await insertDecision(session.id, {
      id: "d-1",
      key: "k-1",
      answerKind: "accepted-recommendation",
      currentAnswer: "An answer",
      settledAt: new Date().toISOString(),
      dependsOnJson: JSON.stringify(["k-0"]),
      settledById: "d-0",
      supersededById: "d-0",
      supersessionAnswer: "Use the parent's answer",
      supersessionReason: "Same question",
      deferralReason: "Waits on X",
      restatementText: "A cleaner answer",
      restatementNotes: "Dropped a note",
      restatementReason: "Fixed typos",
    });
    const strip = ({ adrWorthy, consequences, ...rest }: Record<string, unknown>) => rest;
    const stripRow = ({ adrWorthy, consequences, updatedAt, ...rest }: Record<string, unknown>) => rest;
    const view = async () =>
      (await getTree.run({ sessionId: session.id })).decisions.find((d) => d.id === "d-1")!;
    const before = await view();
    const rowBefore = await stored();
    const historyBefore = await getDb().select().from(schema.decisionHistory);

    await setAdrWorthy.run({ decisionId: "d-1", adrWorthy: true, consequences: "Costs X." });

    expect(strip(await view())).toEqual(strip(before));
    expect(stripRow(await stored())).toEqual(stripRow(rowBefore));
    expect(await getDb().select().from(schema.decisionHistory)).toEqual(historyBefore);
  });
});
