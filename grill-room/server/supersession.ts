/**
 * The supersession turn: which loose ends a later settled decision has already
 * answered.
 *
 * A loose end is a question the user left open — "I don't know", deferred,
 * flagged for a prototype, or pushed back with no response. The interview
 * carries on past it, and by the time the interviewer proposes done, some of
 * those questions have been answered under a different heading: asked again,
 * the user would only repeat what they already decided.
 *
 * What comes back is stored as a **proposal** and nothing else. The loose end
 * keeps its answer, its kind and its place in the list of things blocking
 * confirmation until the user accepts; the three `supersession*` columns are
 * the whole of what this writes. An interviewer that is wrong here costs one
 * dismissal, not a decision recorded in the user's name.
 *
 * Both entry points live here so `request-next-round` and the explicit action
 * share one implementation, and both go through `turn.ts` rather than keeping
 * their own copy of the turn bookkeeping.
 */
import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import { getInterviewer, isInterviewerError } from "./interviewer/index.js";
import type { FindSupersededResult } from "./interviewer/index.js";
import {
  classifyLooseEnds,
  deriveTreeStates,
  treeFacts,
  type DecisionRow,
  type LooseEndReason,
} from "./tree.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  MAX_TURN_RETRIES,
  portKey,
  runTurn,
  TurnRejected,
} from "./turn.js";

/**
 * The loose ends worth asking about: the ones the user could answer themselves.
 * Stale and unplaced decisions are excluded — they are the interviewer's to
 * resolve by reviewing or placing them, and a decision never answered has no
 * question behind it that another decision could have answered instead.
 */
const SUPERSEDABLE_REASONS: readonly LooseEndReason[] = [
  "unknown",
  "deferred",
  "prototype-flagged",
  "pushed-back",
];

/** A session, as a supersession turn needs it. */
type SupersessionSession = typeof schema.sessions.$inferSelect;

/** The failure of a supersession turn, as the done branch reports it upward. */
export interface SupersessionFailure {
  code: string;
  message: string;
}

/** Rows of the loose ends this turn would ask about, in tree order. */
export function supersedableLooseEnds(
  rows: readonly DecisionRow[],
): DecisionRow[] {
  const reasons = classifyLooseEnds(treeFacts(rows));
  return rows.filter((row) => {
    const reason = reasons.get(row.id);
    return reason != null && SUPERSEDABLE_REASONS.includes(reason);
  });
}

/**
 * Why a result cannot be stored, written for the interviewer: it is sent back
 * verbatim. Empty when every entry names a loose end that was asked about and a
 * decision that really is settled, and no loose end appears twice.
 */
export function supersessionRejectionReasons(input: {
  /** The loose-end keys the request listed. */
  askedKeys: readonly string[];
  /** The keys of every decision currently derived settled. */
  settledKeys: readonly string[];
  result: FindSupersededResult;
}): string[] {
  const reasons: string[] = [];
  const asked = new Set(input.askedKeys);
  const settled = new Set(input.settledKeys);
  const seen = new Set<string>();

  for (const entry of input.result.supersessions) {
    if (seen.has(entry.looseEndKey)) {
      reasons.push(
        `Loose end "${entry.looseEndKey}" was superseded twice. Give at most one superseding decision per loose end.`,
      );
    }
    seen.add(entry.looseEndKey);

    if (!asked.has(entry.looseEndKey)) {
      reasons.push(
        `"${entry.looseEndKey}" is not one of the loose ends in this request. Rule only on the ones listed.`,
      );
    }

    if (!settled.has(entry.answeredByKey)) {
      reasons.push(
        `"${entry.answeredByKey}" cannot supersede "${entry.looseEndKey}": it is not a settled decision of this tree. A loose end is only superseded by a decision that is settled now.`,
      );
    }
  }

  return reasons;
}

/**
 * Ask, validate, and store the proposals. No turn bookkeeping of its own: both
 * callers below wrap it, one in a turn of its own and one inside the turn that
 * proposed done.
 *
 * Resolves with the conversation to resume next, or with the one it was given
 * when there is nothing to ask about.
 */
async function scan(
  session: SupersessionSession,
  conversationId: string | null,
): Promise<string | null> {
  const db = getDb();

  const loadDecisions = () =>
    db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, session.id))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // the order the loose ends are reported in deterministic.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

  const rows = await loadDecisions();
  const looseEnds = supersedableLooseEnds(rows);
  if (looseEnds.length === 0) return conversationId;

  const askedKeys = looseEnds.map(portKey);
  const states = deriveTreeStates(treeFacts(rows));
  const settledKeys = rows
    .filter((row) => states.get(row.id) === "settled")
    .map(portKey);

  const interviewer = getInterviewer();

  const turn = await askUntilAccepted<FindSupersededResult>({
    conversationId,
    ask: async (attempt) =>
      interviewer.findSuperseded({
        kind: "find-superseded",
        context: {
          idea: session.idea,
          title: session.title,
          model: session.model,
          answeringMode: session.answeringMode,
          conversationId: attempt.conversationId,
          decisions: await decisionSnapshots(rows),
        },
        looseEndKeys: askedKeys,
        rejectionReason: attempt.rejectionReason,
      }),
    reasonsToRefuse: (result) =>
      supersessionRejectionReasons({ askedKeys, settledKeys, result }),
    exhausted: (lastReason) =>
      new TurnRejected(
        "invalid-supersession",
        `The interviewer proposed supersessions the tree does not support ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
      ),
  });

  const idByKey = new Map(rows.map((row) => [portKey(row), row.id] as const));
  const now = new Date().toISOString();

  for (const entry of turn.result.supersessions) {
    const looseEndId = idByKey.get(entry.looseEndKey);
    const answeredById = idByKey.get(entry.answeredByKey);
    if (!looseEndId || !answeredById) continue;

    await db
      .update(schema.decisions)
      .set({
        supersededById: answeredById,
        supersessionAnswer: entry.answer,
        supersessionReason: entry.reason,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, looseEndId));
  }

  return turn.conversationId;
}

/**
 * The second half of a done proposal, run before the session is moved to
 * `done-proposed`.
 *
 * It never throws. The done proposal was already accepted and is the expensive
 * half of the turn; losing it because the follow-up failed would put the user
 * back at the start of a minute-long turn for a convenience they did not ask
 * for. The failure is handed back instead, for the caller to record once the
 * turn's own bookkeeping has finished writing.
 */
export async function findSupersessionsForDone(input: {
  session: SupersessionSession;
  conversationId: string | null;
}): Promise<{
  conversationId: string | null;
  failure: SupersessionFailure | null;
}> {
  try {
    return {
      conversationId: await scan(input.session, input.conversationId),
      failure: null,
    };
  } catch (error) {
    const failure: SupersessionFailure =
      isInterviewerError(error) || error instanceof TurnRejected
        ? { code: error.code, message: error.message }
        : {
            code: "failed",
            message:
              "The done proposal was accepted, but the check for loose ends a later decision already answered failed.",
          };
    return { conversationId: input.conversationId, failure };
  }
}

/**
 * The whole turn, for the explicit action: the session reads as working while
 * the model thinks, and a failure is stored on it the way any other failed turn
 * is. Does nothing at all — not even a turn status — when the session has no
 * loose end this could apply to.
 */
export async function runSupersessionTurn(sessionId: string): Promise<void> {
  const db = getDb();

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) return;

  const rows = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, sessionId));

  if (supersedableLooseEnds(rows).length === 0) return;

  await runTurn({
    sessionId,
    failedMessage: "The check for superseded loose ends failed.",
    take: async () =>
      (await scan(session, session.conversationId)) ?? session.conversationId ?? "",
  });
}
