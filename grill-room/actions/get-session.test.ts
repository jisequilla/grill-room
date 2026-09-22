import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";

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
