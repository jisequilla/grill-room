/**
 * The supersession turn: which loose ends a later settled decision has already
 * answered, which settled decisions a later one replaced, and which of the
 * user's own answers postpone their question rather than decide it.
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
 * And an own answer can settle a decision without deciding it: "wait until
 * dispute handling is settled" is a deferral written as an answer, and it
 * would export as a decision.
 *
 * Or it can decide and hold more besides: "Stirpe. Claude, double-check the
 * fee table." exports its typo and its note to the AI verbatim, and build
 * agents read it as the decision. A restatement proposes the clean statement.
 *
 * What comes back is stored as a **proposal** and nothing else. The decision
 * keeps its answer, its kind and its place in the tree until the user accepts;
 * the proposal columns (`supersededById`, `supersessionAnswer`,
 * `supersessionReason`, `deferralReason`, `restatementText`,
 * `restatementNotes`, `restatementReason`) and the Proposal's kind
 * (`proposalKind`) are the whole of what this writes. An interviewer that
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
  eligibleFor,
  laterKeysOf,
  propose,
  type Proposal,
} from "./proposal.js";
import { deriveTreeStates, treeFacts, type DecisionRow } from "./tree.js";
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

/** A session, as a supersession turn needs it. */
type SupersessionSession = typeof schema.sessions.$inferSelect;

/** The failure of a supersession turn, as the done branch reports it upward. */
export interface SupersessionFailure {
  code: string;
  message: string;
}

/**
 * Whether a turn has anything to ask about: a decision eligible for any of
 * the four kinds of Proposal.
 */
function hasAnythingToCheck(rows: readonly DecisionRow[]): boolean {
  return (
    eligibleFor("answered-by", rows).length > 0 ||
    eligibleFor("replacement", rows).length > 0 ||
    eligibleFor("deferral", rows).length > 0 ||
    eligibleFor("restatement", rows).length > 0
  );
}

/** What a result is checked against: the request, and the tree it was asked about. */
export interface SupersessionCheck {
  /** The loose-end keys the request listed. */
  askedKeys: readonly string[];
  /** The replaceable keys the request listed. */
  replaceableKeys: readonly string[];
  /** The request's `laterKeys`: each replaceable key's possible replacers. */
  laterKeys: Readonly<Record<string, readonly string[]>>;
  /** The deferrable keys the request listed. */
  deferrableKeys: readonly string[];
  /** The restatable keys the request listed. */
  restatableKeys: readonly string[];
  /**
   * The current answer of each restatable decision, by key: what a
   * restatement's statement must differ from.
   */
  restatableAnswers: Readonly<Record<string, string>>;
  /** The keys of every decision currently derived settled. */
  settledKeys: readonly string[];
  /**
   * The keys of every settled decision whose answer kind is `dispositioned`:
   * set aside as out of scope or as a named open question, not answered. Such
   * a decision is settled — nothing downstream of it is blocked — but it
   * answers nothing, so it cannot supersede a loose end.
   */
  dispositionedKeys: readonly string[];
  /** The keys of every kept repo decision: settled, but not an interview answer. */
  repoEstablishedKeys: readonly string[];
}

/** Why the result's loose-end supersessions cannot be stored. */
function looseEndRejectionReasons(
  check: SupersessionCheck,
  result: FindSupersededResult,
): string[] {
  const reasons: string[] = [];
  const asked = new Set(check.askedKeys);
  const settled = new Set(check.settledKeys);
  const dispositioned = new Set(check.dispositionedKeys);
  const seen = new Set<string>();

  for (const entry of result.supersessions) {
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

  return reasons;
}

/**
 * Why each of the result's replacements cannot be stored, one list per entry
 * in the result's order: empty for an entry that can be. A second entry for
 * the same decision is the one refused.
 */
function replacementRejectionReasons(
  check: SupersessionCheck,
  result: FindSupersededResult,
): string[][] {
  const replaceable = new Set(check.replaceableKeys);
  const settled = new Set(check.settledKeys);
  const dispositioned = new Set(check.dispositionedKeys);
  const repoEstablished = new Set(check.repoEstablishedKeys);
  const seen = new Set<string>();

  return result.replacements.map((entry) => {
    const reasons: string[] = [];
    if (seen.has(entry.replacedKey)) {
      reasons.push(
        `Decision "${entry.replacedKey}" was replaced twice. Give at most one replacing decision per decision.`,
      );
    }
    seen.add(entry.replacedKey);

    if (!replaceable.has(entry.replacedKey)) {
      reasons.push(
        `"${entry.replacedKey}" is not one of the decisions to check for replacement. Rule only on the ones listed.`,
      );
    }

    const later = check.laterKeys[entry.replacedKey] ?? [];
    if (entry.byKey === entry.replacedKey) {
      reasons.push(`"${entry.byKey}" cannot replace itself.`);
    } else if (repoEstablished.has(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": only an interview answer can replace one.`,
      );
    } else if (dispositioned.has(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": it was set aside (dispositioned), not answered.`,
      );
    } else if (!settled.has(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": it is not a settled decision of this tree.`,
      );
    } else if (!later.includes(entry.byKey)) {
      reasons.push(
        `"${entry.byKey}" cannot replace "${entry.replacedKey}": it is not one of the decisions listed after it.`,
      );
    }
    return reasons;
  });
}

/**
 * Why each of the result's deferrals cannot be stored, one list per entry in
 * the result's order: empty for an entry that can be. A second entry for the
 * same decision is the one refused.
 */
function deferralRejectionReasons(
  check: SupersessionCheck,
  result: FindSupersededResult,
): string[][] {
  const deferrable = new Set(check.deferrableKeys);
  const replaced = new Set(result.replacements.map((entry) => entry.replacedKey));
  const seen = new Set<string>();

  return result.deferrals.map((entry) => {
    const reasons: string[] = [];
    if (seen.has(entry.key)) {
      reasons.push(
        `Decision "${entry.key}" was flagged as a deferral twice. Give at most one deferral per decision.`,
      );
    }
    seen.add(entry.key);

    if (!deferrable.has(entry.key)) {
      reasons.push(
        `"${entry.key}" is not one of the own answers to check for a deferral. Rule only on the ones listed.`,
      );
    }

    if (replaced.has(entry.key)) {
      reasons.push(
        `"${entry.key}" is both replaced and flagged as a deferral. Give it one or the other.`,
      );
    }
    return reasons;
  });
}

/**
 * Why each of the result's restatements cannot be stored, one list per entry
 * in the result's order: empty for an entry that can be. A second entry for
 * the same decision is the one refused. Judged against the deferrals and
 * replacements as the interviewer sent them.
 */
function restatementRejectionReasons(
  check: SupersessionCheck,
  result: FindSupersededResult,
): string[][] {
  const restatable = new Set(check.restatableKeys);
  const deferred = new Set(result.deferrals.map((entry) => entry.key));
  const replaced = new Set(result.replacements.map((entry) => entry.replacedKey));
  const seen = new Set<string>();

  return result.restatements.map((entry) => {
    const reasons: string[] = [];
    if (seen.has(entry.key)) {
      reasons.push(
        `Decision "${entry.key}" was restated twice. Give at most one restatement per decision.`,
      );
    }
    seen.add(entry.key);

    if (!restatable.has(entry.key)) {
      reasons.push(
        `"${entry.key}" is not one of the own answers to check for a restatement. Rule only on the ones listed.`,
      );
    }

    if (deferred.has(entry.key)) {
      reasons.push(
        `"${entry.key}" is both flagged as a deferral and restated. Give it one or the other.`,
      );
    }

    if (replaced.has(entry.key)) {
      reasons.push(
        `"${entry.key}" is both replaced and restated. Give it one or the other.`,
      );
    }

    const current = check.restatableAnswers[entry.key];
    if (current != null && entry.statement.trim() === current.trim()) {
      reasons.push(
        `The statement for "${entry.key}" is its answer unchanged, so it removes nothing. Restate an answer only when the statement differs from it.`,
      );
    }
    return reasons;
  });
}

/**
 * Why a result cannot be stored, written for the interviewer: it is sent back
 * verbatim. Empty when every supersession names a loose end that was asked
 * about and a decision that really is settled, every replacement names a
 * decision that was asked about and one listed after it, every deferral names
 * an own answer that was asked about and is not also replaced, every
 * restatement names an own answer that was asked about, is neither deferred
 * nor replaced, and changes its text, and nothing appears twice.
 */
export function supersessionRejectionReasons(
  input: SupersessionCheck & { result: FindSupersededResult },
): string[] {
  return [
    ...looseEndRejectionReasons(input, input.result),
    ...replacementRejectionReasons(input, input.result).flat(),
    ...deferralRejectionReasons(input, input.result).flat(),
    ...restatementRejectionReasons(input, input.result).flat(),
  ];
}

/**
 * The result with its invalid replacements, deferrals and restatements
 * dropped, and a line for the attempt log naming each dropped entry and why;
 * null when nothing was dropped.
 *
 * Deferrals are judged against the replacements as the interviewer sent them,
 * and restatements against both as sent, so a decision named in two lists
 * loses the later list's entry even when the earlier one is itself dropped.
 */
function keepValidEntries(
  check: SupersessionCheck,
  result: FindSupersededResult,
): { result: FindSupersededResult; dropped: string | null } {
  const replacementReasons = replacementRejectionReasons(check, result);
  const deferralReasons = deferralRejectionReasons(check, result);
  const restatementReasons = restatementRejectionReasons(check, result);
  const keptReplacements = result.replacements.filter(
    (_, index) => replacementReasons[index]!.length === 0,
  );
  const keptDeferrals = result.deferrals.filter(
    (_, index) => deferralReasons[index]!.length === 0,
  );
  const keptRestatements = result.restatements.filter(
    (_, index) => restatementReasons[index]!.length === 0,
  );
  const droppedReplacements = result.replacements.flatMap((entry, index) =>
    replacementReasons[index]!.length === 0
      ? []
      : [
          `"${entry.replacedKey}" by "${entry.byKey}" (${replacementReasons[index]!.join(" ")})`,
        ],
  );
  const droppedDeferrals = result.deferrals.flatMap((entry, index) =>
    deferralReasons[index]!.length === 0
      ? []
      : [`"${entry.key}" (${deferralReasons[index]!.join(" ")})`],
  );
  const droppedRestatements = result.restatements.flatMap((entry, index) =>
    restatementReasons[index]!.length === 0
      ? []
      : [`"${entry.key}" (${restatementReasons[index]!.join(" ")})`],
  );
  const parts = [
    droppedReplacements.length === 0
      ? null
      : `${droppedReplacements.length === 1 ? "this replacement" : "these replacements"}: ${droppedReplacements.join("; ")}`,
    droppedDeferrals.length === 0
      ? null
      : `${droppedDeferrals.length === 1 ? "this deferral" : "these deferrals"}: ${droppedDeferrals.join("; ")}`,
    droppedRestatements.length === 0
      ? null
      : `${droppedRestatements.length === 1 ? "this restatement" : "these restatements"}: ${droppedRestatements.join("; ")}`,
  ].filter((part): part is string => part != null);
  return {
    result: {
      ...result,
      replacements: keptReplacements,
      deferrals: keptDeferrals,
      restatements: keptRestatements,
    },
    dropped:
      parts.length === 0
        ? null
        : `Kept the valid entries after the last retry. Dropped ${parts.join("; and ")}`,
  };
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
  const looseEnds = eligibleFor("answered-by", rows);
  const replaceable = eligibleFor("replacement", rows);
  const deferrable = eligibleFor("deferral", rows);
  const restatable = eligibleFor("restatement", rows);
  if (
    looseEnds.length === 0 &&
    replaceable.length === 0 &&
    deferrable.length === 0 &&
    restatable.length === 0
  ) {
    return conversationId;
  }

  const askedKeys = looseEnds.map(portKey);
  const replaceableKeys = replaceable.map(portKey);
  const laterKeys = laterKeysOf(rows);
  const deferrableKeys = deferrable.map(portKey);
  const restatableKeys = restatable.map(portKey);
  const states = deriveTreeStates(treeFacts(rows));
  const settledRows = rows.filter((row) => states.get(row.id) === "settled");
  const check: SupersessionCheck = {
    askedKeys,
    replaceableKeys,
    laterKeys,
    deferrableKeys,
    restatableKeys,
    restatableAnswers: Object.fromEntries(
      restatable.map((row) => [portKey(row), row.currentAnswer ?? ""]),
    ),
    settledKeys: settledRows.map(portKey),
    dispositionedKeys: settledRows
      .filter((row) => row.answerKind === "dispositioned")
      .map(portKey),
    repoEstablishedKeys: settledRows
      .filter((row) => row.answerKind === "repo-established")
      .map(portKey),
  };

  const interviewer = getInterviewer();
  let attemptsAsked = 0;

  const accepted = await askUntilAccepted<FindSupersededResult>({
    conversationId,
    recorder,
    ask: async (attempt) => {
      attemptsAsked += 1;
      return interviewer.findSuperseded(
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
          laterKeys,
          deferrableKeys,
          restatableKeys,
          rejectionReason: attempt.rejectionReason,
        },
        attempt.observer,
      );
    },
    reasonsToRefuse: (result) => {
      const reasons = supersessionRejectionReasons({ ...check, result });
      // On the last attempt, invalid replacements, deferrals and restatements
      // alone no longer fail the scan: the valid entries are kept and the
      // invalid ones dropped below. Invalid loose-end entries still do.
      const lastAttempt = attemptsAsked > MAX_TURN_RETRIES;
      if (lastAttempt && looseEndRejectionReasons(check, result).length === 0) {
        return [];
      }
      return reasons;
    },
    exhausted: (lastReason) =>
      new TurnRejected(
        "invalid-supersession",
        `The interviewer proposed supersessions the tree does not support ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
      ),
  });

  const kept = keepValidEntries(check, accepted.result);
  if (kept.dropped) await recorder?.noted(kept.dropped);
  const turn = { ...accepted, result: kept.result };

  const idByKey = new Map(rows.map((row) => [portKey(row), row.id] as const));
  const now = new Date().toISOString();

  // One transaction: a Proposal `propose` skips is not a failure, and the
  // rest are still stored.
  await db.transaction(async (tx) => {
    const store = (id: string | undefined, proposal: Proposal) =>
      id ? propose(id, proposal, { now, db: tx }) : null;

    for (const entry of turn.result.supersessions) {
      const byId = idByKey.get(entry.answeredByKey);
      if (!byId) continue;
      await store(idByKey.get(entry.looseEndKey), {
        kind: "answered-by",
        byId,
        answer: entry.answer,
        reason: entry.reason,
      });
    }

    for (const entry of turn.result.replacements) {
      const byId = idByKey.get(entry.byKey);
      if (!byId) continue;
      await store(idByKey.get(entry.replacedKey), {
        kind: "replacement",
        byId,
        reason: entry.reason,
      });
    }

    for (const entry of turn.result.deferrals) {
      await store(idByKey.get(entry.key), {
        kind: "deferral",
        reason: entry.reason,
      });
    }

    for (const entry of turn.result.restatements) {
      await store(idByKey.get(entry.key), {
        kind: "restatement",
        text: entry.statement,
        notes: entry.operatorNotes,
        reason: entry.reason,
      });
    }
  });

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
 * Does nothing at all — not even a turn record — when the session has no
 * loose end, replaceable decision or deferrable own answer this could apply to.
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
 * is. Does nothing at all — not even a turn status — when the session has no
 * loose end, replaceable decision or deferrable own answer this could apply to.
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
