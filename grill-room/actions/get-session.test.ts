import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import generateHandoff from "./generate-handoff.js";
import getSession from "./get-session.js";
import registerProject from "./register-project.js";

describe("get-session", () => {
  useTestDatabase();

  it("returns the session that was created", async () => {
    const created = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
    });

    expect(await getSession.run({ id: created.id })).toEqual({
      ...created,
      modelLocked: false,
      exportRetired: false,
      retiredWorkingFolder: null,
    });
  });

  it("throws for a session id that does not exist", async () => {
    await expect(getSession.run({ id: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("reports modelLocked false for a fresh session (no conversation id, idle)", async () => {
    const created = await createSession.run({
      title: "Fresh session",
      idea: "An idea",
    });

    const session = await getSession.run({ id: created.id });
    expect(session.modelLocked).toBe(false);
    expect(session.model).toBe(created.model);
  });

  it("reports modelLocked false for a failed turn with no conversation id", async () => {
    const created = await createSession.run({
      title: "Failed turn, no conversation",
      idea: "An idea",
    });

    await getDb()
      .update(schema.sessions)
      .set({ conversationId: null, turnStatus: "failed" })
      .where(eq(schema.sessions.id, created.id));

    const session = await getSession.run({ id: created.id });
    expect(session.modelLocked).toBe(false);
  });

  it("reports modelLocked true once a conversation id exists", async () => {
    const created = await createSession.run({
      title: "Has conversation",
      idea: "An idea",
    });

    await getDb()
      .update(schema.sessions)
      .set({ conversationId: "conv-1" })
      .where(eq(schema.sessions.id, created.id));

    const session = await getSession.run({ id: created.id });
    expect(session.modelLocked).toBe(true);
  });

  it("reports modelLocked true while turn status is working with no conversation id", async () => {
    const created = await createSession.run({
      title: "Working turn, no conversation",
      idea: "An idea",
    });

    await getDb()
      .update(schema.sessions)
      .set({ conversationId: null, turnStatus: "working" })
      .where(eq(schema.sessions.id, created.id));

    const session = await getSession.run({ id: created.id });
    expect(session.modelLocked).toBe(true);
  });
});

describe("get-session: retired export", () => {
  useTestDatabase();
  const repos = useTempGitRepos();

  it("reports exportRetired and retiredWorkingFolder before and after the working folder is deleted", async () => {
    const root = repos.create();
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    const now = new Date().toISOString();
    await getDb().insert(schema.tickets).values({
      id: randomUUID(),
      sessionId: session.id,
      number: 1,
      slug: "build-the-workspace",
      title: "Ticket 1",
      body: "Do the work of ticket 1.",
      status: "ready",
      blockedByJson: "[]",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.specs).values({
      id: randomUUID(),
      sessionId: session.id,
      markdown: "## Problem Statement\n\nA settled idea.\n\n## Solution\n\nA workspace.",
      current: true,
      ticketsGeneratedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await generateHandoff.run({ sessionId: session.id });

    const beforeExport = await getSession.run({ id: session.id });
    expect(beforeExport.exportRetired).toBe(false);
    expect(beforeExport.retiredWorkingFolder).toBeNull();

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const exported = await getSession.run({ id: session.id });
    expect(exported.exportRetired).toBe(false);
    expect(exported.retiredWorkingFolder).toBeNull();

    await fs.rm(path.join(root, ".scratch", "grill-room"), { recursive: true });
    const retired = await getSession.run({ id: session.id });
    expect(retired.exportRetired).toBe(true);
    expect(retired.retiredWorkingFolder).toBe(".scratch/grill-room");
  });
});
