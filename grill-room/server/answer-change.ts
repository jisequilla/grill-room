/**
 * Answer change: the one module that owns every write giving a decision a new
 * answer state. Five transitions share one rule, applied in one transaction:
 *
 * 1. the prior answer, when there was one, goes to the decision's history;
 * 2. the decision takes its new answer state, and its own proposals lapse —
 *    with its answer links, unless the change is a reword;
 * 3. the claims other decisions make about it are withdrawn — only pending
 *    supersessions naming it, for a reword;
 * 4. the session's spec, if it has one, is marked not current.
 *
 * Each transition differs only in the answer state it writes:
 *
 * | Transition | answer   | kind       | target         | settledAt         | reopenedAt              | withdrawnAt |
 * |------------|----------|------------|----------------|-------------------|-------------------------|-------------|
 * | settle     | given    | given      | given when kind is `dispositioned`, else null | now if kind settles, else null | kept | kept |
 * | defer      | kept     | `deferred` | null           | null              | kept                    | kept        |
 * | reword     | given    | kept       | kept           | kept              | kept                    | kept        |
 * | unsettle   | null     | null       | null           | null              | now if prior kind settled, else kept | kept |
 * | withdraw   | kept     | kept       | kept           | kept              | kept                    | now         |
 *
 * Preconditions — a withdrawn decision, the session's state, a turn in
 * progress — stay with the callers. Returning the session to interviewing and
 * placing a decision in a round stay with them too.
 */
import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import type {
  DecisionAnswerKind,
  DecisionDispositionTarget,
} from "./db/schema.js";
import { type DbHandle, markSpecNotCurrent } from "./session-state.js";
import {
  CLEARED_ANSWER_LINKS,
  CLEARED_PROPOSAL,
  type DecisionRow,
  isSettlingAnswerKind,
} from "./tree.js";
import {
  withdrawClaimsOn,
  withdrawSupersessionsNaming,
} from "./withdraw-claims.js";

/** What every transition takes besides its own arguments. */
export interface AnswerChangeOptions {
  /** The moment of the change: history's `recordedAt` and every stamp written. */
  now: string;
  /** Why the change was made, kept as the history row's interviewer reason. */
  reason?: string;
  /** A caller's transaction to run inside; without one, the transition opens its own. */
  db?: DbHandle;
}

type DecisionUpdate = Partial<typeof schema.decisions.$inferInsert>;

interface Change {
  /** The answer state to write, from the decision as it stood. */
  answerState: (prior: DecisionRow) => DecisionUpdate;
  /** A reword keeps the decision's links and the replaced-by records naming it. */
  keepsLinks: boolean;
  operatorNotes: string | null;
  settledById?: string;
}

function hadPriorAnswer(row: DecisionRow): boolean {
  return (row.currentAnswer != null && row.currentAnswer !== "") || row.answerKind != null;
}

async function applyChange(
  db: DbHandle,
  id: string,
  change: Change,
  opts: AnswerChangeOptions,
): Promise<DecisionRow> {
  const { now } = opts;

  const [prior] = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1);

  if (!prior) throw new Error(`Decision not found: ${id}`);

  if (hadPriorAnswer(prior)) {
    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId: prior.id,
      questionTitle: prior.questionTitle,
      questionBody: prior.questionBody,
      answer: prior.currentAnswer,
      answerKind: prior.answerKind,
      interviewerReason: opts.reason ?? null,
      operatorNotes: change.operatorNotes,
      recordedAt: now,
    });
  }

  const [written] = await db
    .update(schema.decisions)
    .set({
      ...change.answerState(prior),
      ...CLEARED_PROPOSAL,
      ...(change.keepsLinks ? {} : CLEARED_ANSWER_LINKS),
      ...(change.settledById != null ? { settledById: change.settledById } : {}),
      updatedAt: now,
    })
    .where(eq(schema.decisions.id, id))
    .returning();

  if (change.keepsLinks) {
    await withdrawSupersessionsNaming(id, now, db);
  } else {
    await withdrawClaimsOn(id, now, db);
  }

  await markSpecNotCurrent(prior.sessionId, now, db);

  return written!;
}

function inTransaction(
  id: string,
  change: Change,
  opts: AnswerChangeOptions,
): Promise<DecisionRow> {
  if (opts.db) return applyChange(opts.db, id, change, opts);
  return getDb().transaction((tx) => applyChange(tx, id, change, opts));
}

/**
 * Give the decision an answer of `kind`. A settling kind stamps `settledAt`;
 * any other leaves it null. A `dispositioned` answer requires its target, and
 * any other kind drops one. Given `settledById`, records the decision whose
 * answer settled this one.
 */
export function settle(
  id: string,
  input: {
    answer: string | null;
    kind: DecisionAnswerKind;
    dispositionTarget?: DecisionDispositionTarget | null;
    settledById?: string | null;
  },
  opts: AnswerChangeOptions,
): Promise<DecisionRow> {
  const dispositioned = input.kind === "dispositioned";
  if (dispositioned && input.dispositionTarget == null) {
    return Promise.reject(
      new Error(`A dispositioned answer needs a disposition target: ${id}`),
    );
  }

  return inTransaction(
    id,
    {
      answerState: () => ({
        currentAnswer: input.answer,
        answerKind: input.kind,
        dispositionTarget: dispositioned ? input.dispositionTarget : null,
        settledAt: isSettlingAnswerKind(input.kind) ? opts.now : null,
      }),
      keepsLinks: false,
      operatorNotes: null,
      settledById: input.settledById ?? undefined,
    },
    opts,
  );
}

/** Defer the decision: its kind becomes `deferred`, its answer text stays. */
export function defer(id: string, opts: AnswerChangeOptions): Promise<DecisionRow> {
  return inTransaction(
    id,
    {
      answerState: () => ({
        answerKind: "deferred",
        dispositionTarget: null,
        settledAt: null,
      }),
      keepsLinks: false,
      operatorNotes: null,
    },
    opts,
  );
}

/**
 * Reword the decision's answer, keeping its kind and meaning: its links and the
 * replaced-by records naming it stay, and `notes` (what the rewording took
 * out) go to the history row.
 */
export function reword(
  id: string,
  input: { text: string; notes: string },
  opts: AnswerChangeOptions,
): Promise<DecisionRow> {
  return inTransaction(
    id,
    {
      answerState: () => ({ currentAnswer: input.text }),
      keepsLinks: true,
      operatorNotes: input.notes,
    },
    opts,
  );
}

/**
 * Clear the decision's answer, putting it back in question. A decision that
 * was settled is stamped reopened, which is what makes its dependents stale.
 */
export function unsettle(id: string, opts: AnswerChangeOptions): Promise<DecisionRow> {
  return inTransaction(
    id,
    {
      answerState: (prior) => ({
        currentAnswer: null,
        answerKind: null,
        dispositionTarget: null,
        settledAt: null,
        ...(isSettlingAnswerKind(prior.answerKind) ? { reopenedAt: opts.now } : {}),
      }),
      keepsLinks: false,
      operatorNotes: null,
    },
    opts,
  );
}

/** Withdraw the decision from the tree, keeping its answer as it stood. */
export function withdraw(id: string, opts: AnswerChangeOptions): Promise<DecisionRow> {
  return inTransaction(
    id,
    {
      answerState: () => ({ withdrawnAt: opts.now }),
      keepsLinks: false,
      operatorNotes: null,
    },
    opts,
  );
}
