import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getBuildSummary from "./get-build-summary.js";
import setBuildRecord from "./set-build-record.js";

async function aSessionWithTickets(count: number): Promise<{
  sessionId: string;
  ticketIds: string[];
}> {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });

  const now = new Date().toISOString();
  const ticketIds = Array.from({ length: count }, () => randomUUID());

  if (count > 0) {
    await getDb()
      .insert(schema.tickets)
      .values(
        ticketIds.map((id, index) => ({
          id,
          sessionId: session.id,
          number: index + 1,
          slug: `ticket-${index + 1}`,
          title: `Ticket ${index + 1}`,
          body: `Do the work of ticket ${index + 1}.`,
          createdAt: now,
          updatedAt: now,
        })),
      );
  }

  return { sessionId: session.id, ticketIds };
}

describe("get-build-summary", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(getBuildSummary.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("reports zero tickets and a null pass rate for a session with no tickets", async () => {
    const { sessionId } = await aSessionWithTickets(0);

    expect(await getBuildSummary.run({ sessionId })).toEqual({
      tickets: 0,
      recorded: 0,
      firstAttemptPassed: 0,
      firstAttemptPassRate: null,
      escalated: 0,
      byModel: [],
      records: [],
    });
  });

  it("lists every ticket with a null build record when nothing is recorded yet", async () => {
    const { sessionId } = await aSessionWithTickets(2);

    const summary = await getBuildSummary.run({ sessionId });

    expect(summary.tickets).toBe(2);
    expect(summary.recorded).toBe(0);
    expect(summary.firstAttemptPassRate).toBeNull();
    expect(summary.records).toEqual([
      { ticket: { number: 1, slug: "ticket-1", title: "Ticket 1", status: "ready" }, buildRecord: null },
      { ticket: { number: 2, slug: "ticket-2", title: "Ticket 2", status: "ready" }, buildRecord: null },
    ]);
  });

  it("computes counts, pass rate, per-model grouping and ordering, and the records list", async () => {
    const { sessionId, ticketIds } = await aSessionWithTickets(4);

    await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });
    await setBuildRecord.run({
      ticketId: ticketIds[1],
      model: "sonnet",
      firstAttemptPassed: false,
      escalated: true,
    });
    await setBuildRecord.run({
      ticketId: ticketIds[2],
      model: "opus",
      firstAttemptPassed: true,
    });
    // Ticket 4 is left unrecorded.

    const summary = await getBuildSummary.run({ sessionId });

    expect(summary.tickets).toBe(4);
    expect(summary.recorded).toBe(3);
    expect(summary.firstAttemptPassed).toBe(2);
    expect(summary.firstAttemptPassRate).toBeCloseTo(2 / 3);
    expect(summary.escalated).toBe(1);
    expect(summary.byModel).toEqual([
      { model: "opus", recorded: 1, firstAttemptPassed: 1, escalated: 0 },
      { model: "sonnet", recorded: 2, firstAttemptPassed: 1, escalated: 1 },
    ]);
    expect(summary.records.map((entry) => entry.ticket.number)).toEqual([1, 2, 3, 4]);
    expect(summary.records[3]).toMatchObject({ buildRecord: null });
    expect(summary.records[0]?.buildRecord).toMatchObject({ model: "sonnet", firstAttemptPassed: true });
  });

  it("removes a ticket's build record when the ticket is deleted (cascade)", async () => {
    const { sessionId, ticketIds } = await aSessionWithTickets(1);
    await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });

    expect(await getDb().select().from(schema.buildRecords)).toHaveLength(1);

    await getDb().delete(schema.tickets).where(eq(schema.tickets.id, ticketIds[0]!));

    expect(await getDb().select().from(schema.buildRecords)).toHaveLength(0);
    expect((await getBuildSummary.run({ sessionId })).tickets).toBe(0);
  });
});
