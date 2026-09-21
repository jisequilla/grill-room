import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import listTickets from "./list-tickets.js";
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

const GOOD_SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
  "",
  "## User Stories",
  "",
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
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

/** A session confirmed and carrying a current spec, ready to break into tickets. */
async function aConfirmedSessionWithSpec(): Promise<string> {
  const session = await aSession();
  await confirm(session.id);
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: GOOD_SPEC_MARKDOWN } }]);
  await synthesizeSpec.run({ sessionId: session.id });
  return session.id;
}

function ticketsTurn(
  tickets: {
    number: number;
    slug: string;
    title?: string;
    body?: string;
    blockedBy?: number[];
  }[],
): ScriptedTurn {
  return {
    kind: "break-into-tickets",
    result: {
      tickets: tickets.map((ticket) => ({
        title: `Ticket ${ticket.number}`,
        body: `Do the work of ticket ${ticket.number}.`,
        blockedBy: [],
        ...ticket,
      })),
    },
  };
}

const oneGoodTicket = ticketsTurn([{ number: 1, slug: "build-the-workspace" }]);

const twoGoodTickets = ticketsTurn([
  { number: 1, slug: "build-the-workspace" },
  { number: 2, slug: "store-on-disk", blockedBy: [1] },
]);

describe("break-into-tickets", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("refuses a session that is not confirmed", async () => {
    const session = await aSession();

    await expect(
      breakIntoTickets.run({ sessionId: session.id }),
    ).rejects.toThrow(/Only a confirmed session can be broken into tickets/);
  });

  it("refuses while a turn is working", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      breakIntoTickets.run({ sessionId }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("refuses when no spec has been synthesized yet", async () => {
    const session = await aSession();
    await confirm(session.id);

    await expect(
      breakIntoTickets.run({ sessionId: session.id }),
    ).rejects.toThrow(/no spec yet/);
  });

  it("refuses when the spec is not current", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    await getDb()
      .update(schema.specs)
      .set({ current: false })
      .where(eq(schema.specs.sessionId, sessionId));

    await expect(
      breakIntoTickets.run({ sessionId }),
    ).rejects.toThrow(/spec is out of date/);
  });

  it("sends the spec's markdown in the request", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer([oneGoodTicket]);

    await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests[0]).toMatchObject({
      kind: "break-into-tickets",
      specMarkdown: GOOD_SPEC_MARKDOWN,
    });
  });

  it("stores the tickets a well-formed result proposes", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([twoGoodTickets]);

    const { tickets, ticketsCurrent } = await breakIntoTickets.run({ sessionId });

    expect(tickets.map((ticket) => [ticket.number, ticket.slug])).toEqual([
      [1, "build-the-workspace"],
      [2, "store-on-disk"],
    ]);
    expect(tickets[1]?.blockedBy).toEqual([1]);
    expect(ticketsCurrent).toBe(true);
  });

  describe("ticket set validation", () => {
    it("rejects a duplicate ticket number", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one" },
          { number: 1, slug: "one-again" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("used more than once"),
      });
    });

    it("rejects numbers that leave a gap", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one" },
          { number: 3, slug: "three" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("no gaps"),
      });
    });

    it("rejects a slug that is not lowercase letters, digits and hyphens", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "Build The Thing!" }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("must be lowercase"),
      });
    });

    it("rejects a slug used by more than one ticket", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "same-slug" },
          { number: 2, slug: "same-slug" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining('"same-slug" is used by more than one'),
      });
    });

    it("rejects a blockedBy entry that names no ticket in the set", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "one", blockedBy: [99] }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("not a ticket number in this set"),
      });
    });

    it("rejects a ticket that blocks itself", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "one", blockedBy: [1] }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("cannot block itself"),
      });
    });

    it("rejects a blockedBy cycle", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one", blockedBy: [2] },
          { number: 2, slug: "two", blockedBy: [1] },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("blocking cycle"),
      });
    });

    it("gives up after exhausting retries and records a failed turn", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const bad = ticketsTurn([{ number: 1, slug: "one", blockedBy: [1] }]);
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(breakIntoTickets.run({ sessionId })).rejects.toThrow(
        /does not validate 3 times/,
      );

      expect(interviewer.requests).toHaveLength(3);
      expect((await listTickets.run({ sessionId })).tickets).toEqual([]);
      expect(await getSession.run({ id: sessionId })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "invalid-tickets",
      });
    });
  });

  describe("regeneration and build records", () => {
    it("replaces existing tickets when none carry a build record", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      await breakIntoTickets.run({ sessionId });

      scriptInterviewer([twoGoodTickets]);
      const { tickets } = await breakIntoTickets.run({ sessionId });

      expect(tickets.map((ticket) => ticket.slug)).toEqual([
        "build-the-workspace",
        "store-on-disk",
      ]);
    });

    it("refuses to replace a ticket that carries a build record", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      const { tickets } = await breakIntoTickets.run({ sessionId });
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.buildRecords)
        .values({
          id: "build-1",
          ticketId: tickets[0]!.id,
          model: "sonnet",
          firstAttemptPassed: true,
          createdAt: now,
          updatedAt: now,
        });

      scriptInterviewer([twoGoodTickets]);

      await expect(
        breakIntoTickets.run({ sessionId }),
      ).rejects.toThrow(/would delete 1 build record/);
      expect((await listTickets.run({ sessionId })).tickets).toHaveLength(1);
    });

    it("replaces tickets and their build records when force is set", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      const { tickets } = await breakIntoTickets.run({ sessionId });
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.buildRecords)
        .values({
          id: "build-1",
          ticketId: tickets[0]!.id,
          model: "sonnet",
          firstAttemptPassed: true,
          createdAt: now,
          updatedAt: now,
        });

      scriptInterviewer([twoGoodTickets]);
      const { tickets: replaced } = await breakIntoTickets.run({
        sessionId,
        force: true,
      });

      expect(replaced.map((ticket) => ticket.slug)).toEqual([
        "build-the-workspace",
        "store-on-disk",
      ]);
      expect(
        await getDb().select().from(schema.buildRecords),
      ).toEqual([]);
    });
  });
});

describe("list-tickets", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a session id that does not exist", async () => {
    await expect(
      listTickets.run({ sessionId: "missing" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("returns an empty list and ticketsCurrent false before any tickets are generated", async () => {
    const sessionId = await aConfirmedSessionWithSpec();

    expect(await listTickets.run({ sessionId })).toEqual({
      tickets: [],
      ticketsCurrent: false,
    });
  });

  it("orders tickets by number and resolves blockedBy to ticket numbers", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([
      ticketsTurn([
        { number: 2, slug: "second", blockedBy: [1] },
        { number: 1, slug: "first" },
      ]),
    ]);

    await breakIntoTickets.run({ sessionId });
    const { tickets, ticketsCurrent } = await listTickets.run({ sessionId });

    expect(tickets.map((ticket) => ticket.number)).toEqual([1, 2]);
    expect(tickets[0]?.blockedBy).toEqual([]);
    expect(tickets[1]?.blockedBy).toEqual([1]);
    expect(tickets.every((ticket) => ticket.status === "ready")).toBe(true);
    expect(ticketsCurrent).toBe(true);
  });
});
