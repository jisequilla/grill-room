import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getBuildRecord from "./get-build-record.js";
import setBuildRecord from "./set-build-record.js";

/** A session with `count` tickets, numbered from 1, inserted directly. */
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

describe("set-build-record", () => {
  useTestDatabase();

  it("creates a build record by ticketId", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });

    expect(record).toMatchObject({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
      escalated: false,
      promptMissing: "",
      notes: "",
      ticket: { number: 1, slug: "ticket-1", title: "Ticket 1", status: "ready" },
    });
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });

  it("creates a build record by sessionId and ticketNumber", async () => {
    const { sessionId, ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      sessionId,
      ticketNumber: 1,
      model: "opus",
      firstAttemptPassed: false,
    });

    expect(record).toMatchObject({ ticketId: ticketIds[0], model: "opus" });
  });

  it("refuses when neither ticketId nor the sessionId+ticketNumber pair is given", async () => {
    await expect(
      setBuildRecord.run({ model: "sonnet", firstAttemptPassed: true }),
    ).rejects.toThrow(/ticketId, or the pair sessionId and ticketNumber/);
  });

  it("refuses when both ticketId and the sessionId+ticketNumber pair are given", async () => {
    const { sessionId, ticketIds } = await aSessionWithTickets(1);

    await expect(
      setBuildRecord.run({
        ticketId: ticketIds[0],
        sessionId,
        ticketNumber: 1,
        model: "sonnet",
        firstAttemptPassed: true,
      }),
    ).rejects.toThrow(/ticketId, or the pair sessionId and ticketNumber/);
  });

  it("refuses when only sessionId is given, without ticketNumber", async () => {
    const { sessionId } = await aSessionWithTickets(1);

    await expect(
      setBuildRecord.run({ sessionId, model: "sonnet", firstAttemptPassed: true }),
    ).rejects.toThrow(/ticketId, or the pair sessionId and ticketNumber/);
  });

  it("refuses an unknown ticketId", async () => {
    await expect(
      setBuildRecord.run({
        ticketId: "missing",
        model: "sonnet",
        firstAttemptPassed: true,
      }),
    ).rejects.toThrow(/Ticket not found: missing/);
  });

  it("refuses an unknown sessionId+ticketNumber pair", async () => {
    const { sessionId } = await aSessionWithTickets(1);

    await expect(
      setBuildRecord.run({
        sessionId,
        ticketNumber: 99,
        model: "sonnet",
        firstAttemptPassed: true,
      }),
    ).rejects.toThrow(/Ticket not found: session .+, number 99/);
  });

  it("refuses an empty model", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    await expect(
      setBuildRecord.run({
        ticketId: ticketIds[0],
        model: "   ",
        firstAttemptPassed: true,
      }),
    ).rejects.toThrow(/model is required/);
  });

  it("trims the model", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "  sonnet  ",
      firstAttemptPassed: true,
    });

    expect(record.model).toBe("sonnet");
  });

  it("defaults escalated, promptMissing and notes", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });

    expect(record).toMatchObject({ escalated: false, promptMissing: "", notes: "" });
  });

  it("edit replaces every field but keeps createdAt", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const created = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: false,
      escalated: false,
      promptMissing: "file boundaries",
      notes: "first attempt",
    });

    const edited = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "opus",
      firstAttemptPassed: true,
      escalated: true,
      promptMissing: "",
      notes: "escalated and fixed",
    });

    expect(edited).toMatchObject({
      id: created.id,
      model: "opus",
      firstAttemptPassed: true,
      escalated: true,
      promptMissing: "",
      notes: "escalated and fixed",
      createdAt: created.createdAt,
    });

    const all = await getDb().select().from(schema.buildRecords);
    expect(all).toHaveLength(1);
  });

  it("updates the ticket's status when ticketStatus is given", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
      ticketStatus: "in-progress",
    });

    expect(record.ticket.status).toBe("in-progress");

    const [ticket] = await getDb()
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, ticketIds[0]!));
    expect(ticket?.status).toBe("in-progress");
  });

  it("rejects an invalid ticketStatus", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    await expect(
      setBuildRecord.run({
        ticketId: ticketIds[0],
        model: "sonnet",
        firstAttemptPassed: true,
        // @ts-expect-error intentionally invalid value
        ticketStatus: "not-a-status",
      }),
    ).rejects.toThrow();
  });

  it("leaves the ticket's status untouched when ticketStatus is omitted", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    const record = await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });

    expect(record.ticket.status).toBe("ready");
  });
});

describe("get-build-record", () => {
  useTestDatabase();

  it("returns null when no build record exists", async () => {
    const { ticketIds } = await aSessionWithTickets(1);

    expect(await getBuildRecord.run({ ticketId: ticketIds[0] })).toBeNull();
  });

  it("returns the build record when one exists", async () => {
    const { ticketIds } = await aSessionWithTickets(1);
    await setBuildRecord.run({
      ticketId: ticketIds[0],
      model: "sonnet",
      firstAttemptPassed: true,
    });

    const record = await getBuildRecord.run({ ticketId: ticketIds[0] });
    expect(record).toMatchObject({ ticketId: ticketIds[0], model: "sonnet" });
  });
});
