import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import generateHandoff from "./generate-handoff.js";
import listTickets from "./list-tickets.js";
import registerProject from "./register-project.js";
import setTicketBlockedBy from "./set-ticket-blocked-by.js";

function aSession(projectId?: string) {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    projectId,
  });
}

async function insertTicket(
  sessionId: string,
  overrides: Partial<typeof schema.tickets.$inferInsert> & { number: number; slug: string },
): Promise<string> {
  const now = new Date().toISOString();
  const id = overrides.id ?? randomUUID();
  await getDb()
    .insert(schema.tickets)
    .values({
      sessionId,
      title: `Ticket ${overrides.number}`,
      body: `Do the work of ticket ${overrides.number}.`,
      status: "ready",
      blockedByJson: "[]",
      createdAt: now,
      updatedAt: now,
      ...overrides,
      id,
    });
  return id;
}

async function insertSpec(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb().insert(schema.specs).values({
    id: randomUUID(),
    sessionId,
    markdown: "## Problem Statement\n\nA settled idea.",
    current: true,
    ticketsGeneratedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

describe("set-ticket-blocked-by", () => {
  useTestDatabase();

  it("throws for a ticket id that does not exist", async () => {
    await expect(
      setTicketBlockedBy.run({ ticketId: "missing", blockedBy: [] }),
    ).rejects.toThrow(/Ticket not found: missing/);
  });

  it("stores a valid edit, reflected in list-tickets and its waves", async () => {
    const session = await aSession();
    const id1 = await insertTicket(session.id, { number: 1, slug: "one" });
    const id2 = await insertTicket(session.id, { number: 2, slug: "two" });
    const id3 = await insertTicket(session.id, { number: 3, slug: "three" });

    const { tickets, waves } = await setTicketBlockedBy.run({
      ticketId: id3,
      blockedBy: [1, 2],
    });

    expect(tickets.find((t) => t.id === id3)?.blockedBy).toEqual([1, 2]);
    expect(waves).toEqual([[1, 2], [3]]);

    // Reflected on a fresh read, not just the mutation's own return value.
    const relisted = await listTickets.run({ sessionId: session.id });
    expect(relisted.tickets.find((t) => t.id === id3)?.blockedBy).toEqual([1, 2]);

    // Stored the same way `break-into-tickets` stores it: ids, not numbers.
    const [row] = await getDb()
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, id3))
      .limit(1);
    expect(JSON.parse(row!.blockedByJson).sort()).toEqual([id1, id2].sort());
  });

  it("does not touch the spec's ticketsGeneratedAt, so ticketsAreCurrent is unaffected by the edit", async () => {
    const session = await aSession();
    await insertSpec(session.id);
    await insertTicket(session.id, { number: 1, slug: "one" });
    const id2 = await insertTicket(session.id, { number: 2, slug: "two" });

    const before = await listTickets.run({ sessionId: session.id });
    expect(before.ticketsCurrent).toBe(true);

    await setTicketBlockedBy.run({ ticketId: id2, blockedBy: [1] });

    const after = await listTickets.run({ sessionId: session.id });
    expect(after.ticketsCurrent).toBe(true);
  });

  it("refuses a ticket naming itself", async () => {
    const session = await aSession();
    const id1 = await insertTicket(session.id, { number: 1, slug: "one" });

    await expect(
      setTicketBlockedBy.run({ ticketId: id1, blockedBy: [1] }),
    ).rejects.toMatchObject({ errorCode: "self-reference" });
  });

  it("refuses a ticket number that does not exist in the session", async () => {
    const session = await aSession();
    const id1 = await insertTicket(session.id, { number: 1, slug: "one" });

    await expect(
      setTicketBlockedBy.run({ ticketId: id1, blockedBy: [99] }),
    ).rejects.toMatchObject({ errorCode: "unknown-ticket-number" });
  });

  it("refuses an edit that would create a cycle, naming the tickets on it", async () => {
    const session = await aSession();
    const id1 = await insertTicket(session.id, { number: 1, slug: "one" });
    await insertTicket(session.id, {
      number: 2,
      slug: "two",
      blockedByJson: JSON.stringify([id1]),
    });

    await expect(
      setTicketBlockedBy.run({ ticketId: id1, blockedBy: [2] }),
    ).rejects.toMatchObject({ errorCode: "cycle", details: { cycle: [1, 2] } });

    // Refused, so nothing was written.
    const { tickets } = await listTickets.run({ sessionId: session.id });
    expect(tickets.find((t) => t.id === id1)?.blockedBy).toEqual([]);
  });
});

describe("set-ticket-blocked-by export", () => {
  useTestDatabase();
  const repos = useTempGitRepos();

  it("keeps the exported ticket file's Blocked by line current after an edit", async () => {
    const root = repos.create();
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    const session = await aSession(project.id);
    await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
    const id2 = await insertTicket(session.id, { number: 2, slug: "store-on-disk" });
    await insertSpec(session.id);

    await setTicketBlockedBy.run({ ticketId: id2, blockedBy: [1] });
    await generateHandoff.run({ sessionId: session.id });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const bundleDir = path.join(root, ".scratch", "grill-room");

    expect(
      await fs.readFile(path.join(bundleDir, "issues", "01-build-the-workspace.md"), "utf8"),
    ).toBe(
      "# 01 Ticket 1\n\nStatus: ready-for-agent\nBlocked by: none\n\nDo the work of ticket 1.",
    );
    expect(
      await fs.readFile(path.join(bundleDir, "issues", "02-store-on-disk.md"), "utf8"),
    ).toBe(
      "# 02 Ticket 2\n\nStatus: ready-for-agent\nBlocked by: 01\n\nDo the work of ticket 2.",
    );
  });
});
