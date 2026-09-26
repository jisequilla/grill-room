/**
 * The one transition three actions share: the interview continuing while a
 * session had proposed or confirmed done. `reopen-decision`, `add-decision`,
 * and `request-next-round` all reach this the moment they are about to put a
 * question back in front of the user — a reopened decision, a decision the
 * user added, or a round the interviewer actually opens.
 *
 * Leaving `confirmed` also marks the session's spec, if it has one, not
 * current: a spec synthesized from the old answers no longer describes the
 * tree. Tickets carry no such flag of their own — their currency is judged
 * against the spec's `updatedAt` instead, so marking the spec here is enough.
 */
import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";

/** A session, as this transition needs it: its id and the state it is leaving. */
type SessionLeavingState = Pick<
  typeof schema.sessions.$inferSelect,
  "id" | "state"
>;

/**
 * Return `session` to `interviewing`, clearing its done summary. Callers check
 * `session.state !== "interviewing"` themselves before calling this — it only
 * performs the transition, using the state the caller already loaded rather
 * than reading it again.
 */
export async function returnSessionToInterviewing(
  session: SessionLeavingState,
  now: string,
): Promise<void> {
  const db = getDb();

  await db
    .update(schema.sessions)
    .set({ state: "interviewing", doneSummary: null, updatedAt: now })
    .where(eq(schema.sessions.id, session.id));

  if (session.state === "confirmed") {
    await markSpecNotCurrent(session.id, now);
  }
}

/**
 * Mark the session's spec, if it has one, not current: it no longer describes
 * the tree it was synthesized from, so export refuses it (`spec-not-current`)
 * until it is synthesized again. The session's own state is untouched. A
 * session with no spec is left as it is.
 */
export async function markSpecNotCurrent(
  sessionId: string,
  now: string,
): Promise<void> {
  await getDb()
    .update(schema.specs)
    .set({ current: false, updatedAt: now })
    .where(eq(schema.specs.sessionId, sessionId));
}
