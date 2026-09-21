import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { returnSessionToInterviewing } from "../server/session-state.js";
import { describeDecisions } from "../server/tree.js";

/** A short, readable key from the title, with a random suffix so it never collides. */
function generateKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "user-decision"}-${randomUUID().slice(0, 8)}`;
}

export default defineAction({
  description:
    "Add a decision the user thought of themselves, something the interviewer never asked about. It waits, excluded from the frontier and every round, until the next propose-round places it in the tree with its dependencies.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    title: z.string().min(1).describe("The question's title"),
    body: z.string().default("").describe("The question's body, if any"),
  }),
  run: async ({ sessionId, title, body }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const now = new Date().toISOString();

    // A decision the user thinks of is the interview continuing: a session
    // that had proposed or confirmed done returns to interviewing, its done
    // summary is dropped, and — leaving `confirmed` — its spec is marked not
    // current.
    if (session.state !== "interviewing") {
      await returnSessionToInterviewing(session, now);
    }

    const [row] = await db
      .insert(schema.decisions)
      .values({
        id: randomUUID(),
        sessionId,
        key: generateKey(title),
        questionTitle: title,
        questionBody: body,
        offeredChoicesJson: "[]",
        dependsOnJson: "[]",
        introducedBy: "user",
        awaitingPlacementSince: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) fail("Failed to add the decision.", { statusCode: 500 });

    return describeDecisions([row])[0];
  },
});
