/**
 * The single definition of whether a session's interviewer model is locked.
 * The model-change action calls this to refuse a change, and the session
 * payload builder calls it to derive the `locked` flag the header reads —
 * neither reimplements the rule from `conversationId` or `turnStatus` itself.
 *
 * Locked when either fact holds on the session row: a conversation id exists,
 * or the turn status is `working`. The conversation id is what the CLI
 * adapter resumes, so its existence is the exact moment a different model
 * would corrupt the recorded one. `working` means a first turn is in flight,
 * so its model cannot be pulled out from under it even before a conversation
 * id is set. Round rows and their submission state play no part.
 */
import type { schema } from "./db/index.js";

/** A session, as the lock rule needs it: whether it has a conversation, and its turn's status. */
type SessionLockState = Pick<
  typeof schema.sessions.$inferSelect,
  "conversationId" | "turnStatus"
>;

/** Whether `session`'s interviewer model can no longer be changed. */
export function isModelLocked(session: SessionLockState): boolean {
  return session.conversationId !== null || session.turnStatus === "working";
}
