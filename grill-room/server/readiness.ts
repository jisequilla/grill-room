/**
 * Idea readiness: whether a session's idea is ready to be grilled, judged once
 * before its first round and stored on the session with the idea it judged.
 *
 * The app warns and never blocks: nothing here stops a round from opening. It
 * only decides when a judgment may be asked for or the idea edited (while the
 * session has no rounds and no turn is working), and when a stored judgment
 * still describes the idea (only while the idea is the one it judged).
 */
import { fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "./db/index.js";
import {
  assessReadinessResultSchema,
  MAX_READY_UNKNOWNS,
  type AssessReadinessResult,
} from "./interviewer/index.js";

const storedReadinessSchema = z.object({
  ideaJudged: z.string(),
  result: assessReadinessResultSchema,
  judgedAt: z.string(),
});

/** What `gr_sessions.readiness_json` holds. */
export type StoredReadiness = z.infer<typeof storedReadinessSchema>;

export type ReadinessVerdict = AssessReadinessResult["verdict"];

type ReadinessSession = Pick<
  typeof schema.sessions.$inferSelect,
  "idea" | "readinessJson"
>;

/**
 * The session's readiness judgment, or null when it has none, when what is
 * stored cannot be read, or when it judged an idea other than the current one.
 */
export function currentReadiness(
  session: ReadinessSession,
): StoredReadiness | null {
  if (!session.readinessJson) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(session.readinessJson);
  } catch {
    return null;
  }

  const parsed = storedReadinessSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.ideaJudged !== session.idea) return null;
  return parsed.data;
}

/** The current judgment's verdict alone, for the session list. */
export function readinessVerdict(
  session: ReadinessSession,
): ReadinessVerdict | null {
  return currentReadiness(session)?.result.verdict ?? null;
}

/** Serializes a judgment of `idea` for storage. */
export function storeReadiness(
  idea: string,
  result: AssessReadinessResult,
  judgedAt: string,
): string {
  const stored: StoredReadiness = { ideaJudged: idea, result, judgedAt };
  return JSON.stringify(stored);
}

/**
 * Why a judgment contradicts its own verdict, written for the interviewer.
 * Empty when it can be stored. Only a `ready` verdict is checked: the rule
 * says what ready requires, and a judge may still find an idea that meets it
 * not ready.
 */
export function reasonsToRefuseReadiness(
  result: AssessReadinessResult,
): string[] {
  if (result.verdict !== "ready") return [];

  const reasons: string[] = [];
  if (result.evidence.length === 0) {
    reasons.push("A ready verdict needs at least one evidence item.");
  }
  if (result.objective === null) {
    reasons.push("A ready verdict needs an objective.");
  } else if (result.objectiveIsProcess) {
    reasons.push("A ready verdict needs an objective that is not a process.");
  }
  if (result.unknowns.length > MAX_READY_UNKNOWNS) {
    reasons.push(
      `A ready verdict allows at most ${MAX_READY_UNKNOWNS} unknowns; this one has ${result.unknowns.length}.`,
    );
  }
  return reasons;
}

/** Whether the session has any round at all, open or submitted. */
export async function sessionHasRounds(sessionId: string): Promise<boolean> {
  const [round] = await getDb()
    .select({ id: schema.rounds.id })
    .from(schema.rounds)
    .where(eq(schema.rounds.sessionId, sessionId))
    .limit(1);
  return round !== undefined;
}

type IdeaLockSession = Pick<
  typeof schema.sessions.$inferSelect,
  "turnStatus"
>;

/** Whether the idea may still change: no round yet, and no turn working. */
export function canEditIdea(
  session: IdeaLockSession,
  hasRounds: boolean,
): boolean {
  return !hasRounds && session.turnStatus !== "working";
}

/**
 * Refuse what only a session still before its first round may do — judge the
 * idea, or edit it — once a round exists (`has-rounds`) or while a turn is
 * working (`turn-working`).
 */
export function failIfPastFirstRound(
  session: IdeaLockSession,
  hasRounds: boolean,
  what: string,
): void {
  if (hasRounds) {
    fail(`${what} only before the session's first round.`, {
      errorCode: "has-rounds",
      statusCode: 409,
    });
  }
  if (session.turnStatus === "working") {
    fail(
      `${what} only while no turn is working. Wait for the turn to finish.`,
      { errorCode: "turn-working", statusCode: 409 },
    );
  }
}
