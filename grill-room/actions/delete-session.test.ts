import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import deleteSession from "./delete-session.js";
import getSession from "./get-session.js";

describe("delete-session", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(deleteSession.run({ id: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("deletes the session so it can no longer be found", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
    });

    await deleteSession.run({ id: session.id });

    await expect(getSession.run({ id: session.id })).rejects.toThrow(
      `Session not found: ${session.id}`,
    );
  });

  it("cascades to decisions, decision history, rounds, spec, tickets, and build records", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
    });
    const db = getDb();
    const now = new Date().toISOString();

    const [decision] = await db
      .insert(schema.decisions)
      .values({
        id: "decision-1",
        sessionId: session.id,
        questionTitle: "What platform?",
        introducedBy: "interviewer",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(schema.decisionHistory).values({
      id: "decision-history-1",
      decisionId: decision!.id,
      questionTitle: "What platform?",
      recordedAt: now,
    });

    const [round] = await db
      .insert(schema.rounds)
      .values({
        id: "round-1",
        sessionId: session.id,
        createdAt: now,
      })
      .returning();

    await db.insert(schema.roundDecisions).values({
      id: "round-decision-1",
      roundId: round!.id,
      decisionId: decision!.id,
    });

    await db.insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Spec",
      createdAt: now,
      updatedAt: now,
    });

    const [ticket] = await db
      .insert(schema.tickets)
      .values({
        id: "ticket-1",
        sessionId: session.id,
        number: 1,
        slug: "01-first-ticket",
        title: "First ticket",
        body: "Do the thing",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(schema.buildRecords).values({
      id: "build-record-1",
      ticketId: ticket!.id,
      createdAt: now,
      updatedAt: now,
    });

    await deleteSession.run({ id: session.id });

    expect(
      await db.select().from(schema.decisions).where(eq(schema.decisions.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, decision!.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.rounds).where(eq(schema.rounds.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.roundDecisions)
        .where(eq(schema.roundDecisions.roundId, round!.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.specs).where(eq(schema.specs.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.tickets).where(eq(schema.tickets.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.buildRecords)
        .where(eq(schema.buildRecords.ticketId, ticket!.id)),
    ).toEqual([]);
  });
});
