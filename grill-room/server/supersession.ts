/**
 * The supersession turn: which loose ends a later settled decision has already
 * answered, and which settled decisions a later one replaced.
 *
 * A loose end is a question the user left open — "I don't know", deferred,
 * flagged for a prototype, or pushed back with no response. The interview
 * carries on past it, and by the time the interviewer proposes done, some of
 * those questions have been answered under a different heading: asked again,
 * the user would only repeat what they already decided.
 *
 * A settled decision can go out of date the same way from the other side: a
 * decision that settled later changes, narrows or reverses it, and a builder
 * reading the earlier answer alone would build the wrong thing.
 *
 * What comes back is stored as a **proposal** and nothing else. The decision
 * keeps its answer, its kind and its place in the tree until the user accepts;
 * the proposal columns (`supersededById`, `supersessionAnswer`,
 * `supersessionReason`) are the whole of what this writes. An interviewer that
 * is wrong here costs one dismissal, not a decision recorded in the user's
 * name. A pending proposal never blocks confirmation.
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
  projectContextFor,
  MAX_TURN_RETRIES,
  portKey,
  runTurn,
  TurnRejected,
} from "./turn.js";
import {
  startTurnRecorder,
  TURN_SUCCEEDED,
  type AttemptRecorder,
} from "./turn-recorder.js";

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

/** Answer kinds that answer a question for real, rather than set it aside. */
const ANSWERED_KINDS: readonly string[] = ["accepted-recommendation", "own-answer"];

/**
 * Rows of the settled decisions this turn would check for replacement, in tree
 * order: answered for real, not already replaced, and followed by at least one
 * other decision answered for real that settled strictly later — whether or not
 * that later one was itself replaced.
 */
export function replaceableDecisions(
  rows: readonly DecisionRow[],
): DecisionRow[] {
  const states = deriveTreeStates(treeFacts(rows));
  const answered = rows.filter(
    (row) =>
      states.get(row.id) === "settled" &&
      row.answerKind != null &&
      ANSWERED_KINDS.includes(row.answerKind),
  );
  return answered.filter(
    (row) =>
      row.replacedById == null &&
      answered.some(
        (later) =>
          later.id !== row.id &&
          later.settledAt != null &&
          later.settledAt > (row.settledAt ?? ""),
      ),
  );
}

/** Whether a turn has anything to ask about: a loose end or a replaceable decision. */
function hasAnythingToCheck(rows: readonly DecisionRow[]): boolean {
  return (
    supersedableLooseEnds(rows).length > 0 ||
    replaceableDecisions(rows).length > 0
  );
}

/**
 * Why a result cannot be stored, written for the interviewer: it is sent back
 * verbatim. Empty when every supersession names a loose end that was asked
 * about and a decision that really is settled, every replacement names a
 * decision that was asked about and one that settled later, and nothing
 * appears twice.
 */
export function supersessionRejectionReasons(input: {
  /** The loose-end keys the request listed. */
  askedKeys: readonly string[];
  /** The replaceable keys the request listed. */
  replaceableKeys: readonly string[];
  /** The keys of every decision currently derived settled. */
  settledKeys: readonly string[];
  /** When each settled decision settled, by key. */
  settledAtByKey: ReadonlyMap<string, string | null>;
  /**
   * The keys of every settled decision whose answer kind is `dispositioned`:
   * set aside as out of scope or as a named open question, not answered. Such
   * a decision is settled — nothing downstream of it is blocked — but it
   * answers nothing, so it cannot supersede a loose end.
   */
  dispositionedKeys: readonly string[];
  result: FindSupersededResult;
}): string[] {
  const reasons: string[] = [];
  const asked = new Set(input.askedKeys);
  const settled = new Set(input.settledKeys);
  const dispositioned = new Set(input.dispositionedKeys);
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

    if (dispositioned.has(entry.answeredByKey)) {
      reasons.push(
        `"${entry.answeredByKey}" cannot supersede "${entry.looseEndKey}": it was set aside (dispositioned), not answered. A loose end is only superseded by a decision that settled with a real answer.`,
      );
    } else if (!settled.has(entry.answeredByKey)) {
      reasons.push(
        `"${entry.answeredByKey}" cannot supersede "${entry.looseEndKey}": it is not a settled decision of this tree. A loose end is only superseded by a decision that is settled now.`,
      );
    }
  }

  const replaceable = new Set(input.replaceableKeys);
  const seenReplaced = new Set<string>();

  for (const entry of input.result.replacements) {
    if (seenReplaced.has(entry.replacedKey)) {
      reasons.push(
        `Decision "${entry.replacedKey}" was replaced twice. Give at most one replacing decision per decision.`,
      );
    }
    seenReplaced.add(entry.replacedKey);

    if (!replaceable.has(entry.replacedKey)) {
      reasons.push(
        `"${entry.replacedKey}" is not one of the decisions to check for replacement. Rule only on the ones listed.`,
      );
    }

    if (entry.byKey === entry.replacedKey) {
      reasons.push(`"${entry.byKey}" cannot replace itself.`);
    } else if (dispositioned.has(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": it was set aside (dispositioned), not answered.`,
      );
    } else if (!settled.has(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": it is not a settled decision of this tree.`,
      );
    } else {
      const byAt = input.settledAtByKey.get(entry.byKey) ?? null;
      const replacedAt = input.settledAtByKey.get(entry.replacedKey) ?? "";
      if (byAt == null || byAt <= replacedAt) {
        reasons.push(
          `"${entry.byKey}" cannot replace "${entry.replacedKey}": it did not settle later.`,
        );
      }
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
  recorder: AttemptRecorder | null | undefined,
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
  const replaceable = replaceableDecisions(rows);
  if (looseEnds.length === 0 && replaceable.length === 0) return conversationId;

  const askedKeys = looseEnds.map(portKey);
  const replaceableKeys = replaceable.map(portKey);
  const states = deriveTreeStates(treeFacts(rows));
  const settledRows = rows.filter((row) => states.get(row.id) === "settled");
  const settledKeys = settledRows.map(portKey);
  const settledAtByKey = new Map(
    settledRows.map((row) => [portKey(row), row.settledAt] as const),
  );
  const dispositionedKeys = settledRows
    .filter((row) => row.answerKind === "dispositioned")
    .map(portKey);

  const interviewer = getInterviewer();

  const turn = await askUntilAccepted<FindSupersededResult>({
    conversationId,
    recorder,
    ask: async (attempt) =>
      interviewer.findSuperseded(
        {
          kind: "find-superseded",
          context: {
            sessionId: session.id,
            idea: session.idea,
            title: session.title,
            model: session.model,
            answeringMode: session.answeringMode,
            docsFolder: session.docsFolder,
            conversationId: attempt.conversationId,
            decisions: await decisionSnapshots(rows),
            projectContext: await projectContextFor(session),
          },
          looseEndKeys: askedKeys,
          replaceableKeys,
          rejectionReason: attempt.rejectionReason,
        },
        attempt.observer,
      ),
    reasonsToRefuse: (result) =>
      supersessionRejectionReasons({
        askedKeys,
        replaceableKeys,
        settledKeys,
        settledAtByKey,
        dispositionedKeys,
        result,
      }),
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

  for (const entry of turn.result.replacements) {
    const replacedId = idByKey.get(entry.replacedKey);
    const byId = idByKey.get(entry.byKey);
    if (!replacedId || !byId) continue;

    await db
      .update(schema.decisions)
      .set({
        supersededById: byId,
        supersessionAnswer: null,
        supersessionReason: entry.reason,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, replacedId));
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
 *
 * This runs nested inside the propose-round turn, not through `runTurn`, but
 * it still gets its own `find-superseded` turn record: `startTurnRecorder` is
 * used directly, and the recorder is closed here rather than by `runTurn`.
 * Does nothing at all — not even a turn record — when the session has neither
 * a loose end nor a replaceable decision this could apply to.
 */
export async function findSupersessionsForDone(input: {
  session: SupersessionSession;
  conversationId: string | null;
}): Promise<{
  conversationId: string | null;
  failure: SupersessionFailure | null;
}> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, input.session.id));

  if (!hasAnythingToCheck(rows)) {
    return { conversationId: input.conversationId, failure: null };
  }

  const recorder = await startTurnRecorder({
    sessionId: input.session.id,
    turnKind: "find-superseded",
    model: input.session.model,
  });

  try {
    const conversationId = await scan(
      input.session,
      input.conversationId,
      recorder,
    );
    await recorder.finish(TURN_SUCCEEDED);
    await db
      .update(schema.sessions)
      .set({
        supersessionTurnId: recorder.turnId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, input.session.id));
    return { conversationId, failure: null };
  } catch (error) {
    const failure: SupersessionFailure =
      isInterviewerError(error) || error instanceof TurnRejected
        ? { code: error.code, message: error.message }
        : {
            code: "failed",
            message:
              "The done proposal was accepted, but the check for loose ends a later decision already answered failed.",
          };
    await recorder.finish(failure.code);
    return { conversationId: input.conversationId, failure };
  }
}

/**
 * The whole turn, for the explicit action: the session reads as working while
 * the model thinks, and a failure is stored on it the way any other failed turn
 * is. Does nothing at all — not even a turn status — when the session has
 * neither a loose end nor a replaceable decision this could apply to.
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

  if (!hasAnythingToCheck(rows)) return;

  await runTurn({
    sessionId,
    failedMessage: "The check for superseded loose ends failed.",
    record: { turnKind: "find-superseded", model: session.model },
    take: async (recorder) => {
      const conversationId =
        (await scan(session, session.conversationId, recorder)) ??
        session.conversationId ??
        "";
      await db
        .update(schema.sessions)
        .set({
          supersessionTurnId: recorder?.turnId ?? null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.sessions.id, sessionId));
      return conversationId;
    },
  });
}
