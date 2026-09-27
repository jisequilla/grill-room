import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision, { addDecisionCore } from "./add-decision.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

describe("add-decision", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(
      addDecision.run({ sessionId: "missing", title: "Anything", body: "" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("adds a decision introduced by the user, awaiting placement", async () => {
    const session = await aSession();

    const added = await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
      body: "Came to me in the shower.",
    });

    expect(added).toMatchObject({
      questionTitle: "Should we support offline mode?",
      questionBody: "Came to me in the shower.",
      introducedBy: "user",
      state: "unplaced",
      dependsOn: [],
      answer: null,
    });
    expect(added.key).toEqual(expect.any(String));
    expect(added.awaitingPlacementSince).toEqual(
      expect.stringMatching(/^\d{4}-/),
    );

    const tree = await getTree.run({ sessionId: session.id });
    expect(tree.decisions).toMatchObject([
      { key: added.key, state: "unplaced", introducedBy: "user" },
    ]);
  });

  it("gives every added decision a distinct key, even for the same title", async () => {
    const session = await aSession();

    const first = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
      body: "",
    });
    const second = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
      body: "",
    });

    expect(first.key).not.toEqual(second.key);
  });

  it("defaults the body to empty", async () => {
    const session = await aSession();

    const added = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
    });

    expect(added.questionBody).toEqual("");
  });

  it("returns a done-proposed session to interviewing and clears the summary", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed", doneSummary: "Nothing left, we thought." })
      .where(eq(schema.sessions.id, session.id));

    await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "interviewing",
      doneSummary: null,
    });
  });

  it("returns a confirmed session to interviewing and clears the summary", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed", doneSummary: "Nothing left, we thought." })
      .where(eq(schema.sessions.id, session.id));

    await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "interviewing",
      doneSummary: null,
    });
  });

  it("marks an existing spec not current when adding a decision to a confirmed session", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));

    await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: false });
  });

  it("leaves the spec alone when adding a decision to a done-proposed session", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed" })
      .where(eq(schema.sessions.id, session.id));

    await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: true });
  });

  describe("addDecisionCore", () => {
    /** A confirmed session with a current spec. */
    async function aConfirmedSessionWithSpec() {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb().insert(schema.specs).values({
        id: `spec-${session.id}`,
        sessionId: session.id,
        markdown: "# Grill Room\n",
        current: true,
        createdAt: now,
        updatedAt: now,
      });
      await getDb()
        .update(schema.sessions)
        .set({ state: "confirmed", doneSummary: "Nothing left, we thought." })
        .where(eq(schema.sessions.id, session.id));
      return session.id;
    }

    async function specOf(sessionId: string) {
      const [spec] = await getDb()
        .select()
        .from(schema.specs)
        .where(eq(schema.specs.sessionId, sessionId));
      return spec!;
    }

    it("adds with the default handle exactly as before", async () => {
      const viaAction = await aConfirmedSessionWithSpec();
      const viaCore = await aConfirmedSessionWithSpec();
      const input = { title: "Should we support offline mode?", body: "A body." };

      const fromAction = await addDecision.run({ sessionId: viaAction, ...input });
      const fromCore = await addDecisionCore({ sessionId: viaCore, ...input });

      const comparable = (view: NonNullable<typeof fromAction>) => ({
        ...view,
        id: "<id>",
        key: view.key?.replace(/-[0-9a-f]{8}$/, "-<suffix>"),
        awaitingPlacementSince: "<now>",
        createdAt: "<now>",
        updatedAt: "<now>",
      });
      expect(comparable(fromCore!)).toEqual(comparable(fromAction!));
      expect(fromCore).toMatchObject({
        questionTitle: input.title,
        questionBody: input.body,
        introducedBy: "user",
        state: "unplaced",
      });
      for (const sessionId of [viaAction, viaCore]) {
        expect(await getSession.run({ id: sessionId })).toMatchObject({
          state: "interviewing",
          doneSummary: null,
        });
        expect(await specOf(sessionId)).toMatchObject({ current: false });
      }
    });

    it("adds and returns the session to interviewing inside a given transaction, and rolls back with it", async () => {
      const committed = await aConfirmedSessionWithSpec();
      const rolledBack = await aConfirmedSessionWithSpec();

      // Every query goes through the handle it is given: the embedded
      // database runs one connection, so a query that skipped the handle
      // would still land inside the transaction, and only this record shows it.
      const through: string[] = [];
      await getDb().transaction(async (tx) => {
        const name = (table: unknown) =>
          table === schema.sessions
            ? "sessions"
            : table === schema.specs
              ? "specs"
              : table === schema.decisions
                ? "decisions"
                : "other";
        const recording = {
          select: ((...args: Parameters<typeof tx.select>) => {
            through.push("select");
            return tx.select(...args);
          }) as typeof tx.select,
          insert: ((table: Parameters<typeof tx.insert>[0]) => {
            through.push(`insert ${name(table)}`);
            return tx.insert(table);
          }) as typeof tx.insert,
          update: ((table: Parameters<typeof tx.update>[0]) => {
            through.push(`update ${name(table)}`);
            return tx.update(table);
          }) as typeof tx.update,
          delete: ((table: Parameters<typeof tx.delete>[0]) => {
            through.push(`delete ${name(table)}`);
            return tx.delete(table);
          }) as typeof tx.delete,
        };
        await addDecisionCore({ sessionId: committed, title: "Kept?", body: "" }, recording);
      });
      expect(through).toEqual(["select", "update sessions", "update specs", "insert decisions"]);
      await expect(
        getDb().transaction(async (tx) => {
          await addDecisionCore({ sessionId: rolledBack, title: "Dropped?", body: "" }, tx);
          const [inside] = await tx
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.id, rolledBack));
          expect(inside).toMatchObject({ state: "interviewing", doneSummary: null });
          throw new Error("Something after it failed.");
        }),
      ).rejects.toThrow("Something after it failed.");

      expect((await getTree.run({ sessionId: committed })).decisions).toMatchObject([
        { questionTitle: "Kept?", state: "unplaced" },
      ]);
      expect(await getSession.run({ id: committed })).toMatchObject({ state: "interviewing" });
      expect(await specOf(committed)).toMatchObject({ current: false });

      expect((await getTree.run({ sessionId: rolledBack })).decisions).toEqual([]);
      expect(await getSession.run({ id: rolledBack })).toMatchObject({
        state: "confirmed",
        doneSummary: "Nothing left, we thought.",
      });
      expect(await specOf(rolledBack)).toMatchObject({ current: true });
    });
  });
});
