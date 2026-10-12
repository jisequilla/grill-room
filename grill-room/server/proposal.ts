/**
 * Proposal: the one module that owns a decision's Proposals, from the moment
 * one is stored to the moment the owner accepts or dismisses it, and the rule
 * of which decision may hold which.
 *
 * A Proposal is the interviewer's suggestion about an answer the owner already
 * gave. Four kinds, stored in `proposalKind` beside that kind's payload:
 *
 * | Kind          | Held by                                | Payload                                                     |
 * |---------------|----------------------------------------|-------------------------------------------------------------|
 * | `answered-by` | a loose end a later decision answers   | `supersededById`, `supersessionAnswer`, `supersessionReason` |
 * | `replacement` | a settled decision a later one replaced | `supersededById`, `supersessionReason`                      |
 * | `deferral`    | a settled own answer that waits        | `deferralReason`                                            |
 * | `restatement` | a settled own answer holding notes     | `restatementText`, `restatementNotes`, `restatementReason`  |
 *
 * A decision holds at most one. Each transition differs in what it writes:
 *
 * | Transition       | Pending Proposal | Answer                    | Dismissals         | History | Spec        |
 * |------------------|------------------|---------------------------|--------------------|---------|-------------|
 * | propose          | stored           | kept                      | kept               | none    | kept        |
 * | accept answered-by | cleared        | Answer change's settle    | forgotten          | a row   | not current |
 * | accept replacement | cleared        | kept, `replacedById` set  | kept               | none    | not current |
 * | accept deferral  | cleared          | Answer change's defer     | forgotten          | a row   | not current |
 * | accept restatement | cleared        | Answer change's reword    | forgotten          | a row   | not current |
 * | dismiss          | cleared          | kept                      | one appended       | none    | kept        |
 * | forgetDismissal  | kept             | kept                      | matching removed   | none    | kept        |
 *
 * `propose` refuses, as a skip rather than an error, a decision that already
 * holds a Proposal, one with a remembered dismissal of the same Proposal, and
 * one not eligible for its kind. Concurrent writers are kept apart by the
 * actions' turn lock and the scan's transaction, not here. Preconditions on
 * the session — a turn in progress, the session's state — stay with callers.
 */
import { eq } from "@agent-native/core/db/schema";

import { defer, reword, settle } from "./answer-change.js";
import { getDb, schema } from "./db/index.js";
import type { DecisionProposalKind } from "./db/schema.js";
import { type DbHandle, markSpecNotCurrent } from "./session-state.js";
import {
  deferrableDecisions,
  replaceableDecisions,
  supersedableLooseEnds,
} from "./supersession.js";
import { CLEARED_PENDING_PROPOSAL, type DecisionRow } from "./tree.js";

/** A decision's pending Proposal: its kind and that kind's payload. */
export type Proposal =
  | {
      kind: "answered-by";
      byId: string;
      answer: string | null;
      reason: string | null;
    }
  | { kind: "replacement"; byId: string; reason: string | null }
  | { kind: "deferral"; reason: string | null }
  | {
      kind: "restatement";
      text: string;
      notes: string | null;
      reason: string | null;
    };

/**
 * A Proposal the owner dismissed for the answer the decision holds now.
 * `targetId` names the answering or replacing decision; `text` is a
 * restatement's proposed statement.
 */
export interface Dismissal {
  kind: DecisionProposalKind;
  targetId?: string;
  reason: string | null;
  dismissedAt: string;
  text?: string;
}

/** What every transition takes besides its own arguments. */
export interface ProposalOptions {
  /** The moment of the change: every `updatedAt` written. */
  now: string;
  /** A caller's transaction to run inside; without one, a change of more than one write opens its own. */
  db?: DbHandle;
}

/** Why `propose` stored nothing. */
export type ProposeSkip = "already-pending" | "dismissed" | "not-eligible";

export type ProposeResult =
  | { stored: true; row: DecisionRow }
  | { stored: false; skip: ProposeSkip };

type DecisionUpdate = Partial<typeof schema.decisions.$inferInsert>;

/** The decision's pending Proposal, read from its stored kind, or null when none is. */
export function pendingProposal(row: DecisionRow): Proposal | null {
  switch (row.proposalKind) {
    case "answered-by":
      return {
        kind: "answered-by",
        byId: row.supersededById ?? "",
        answer: row.supersessionAnswer,
        reason: row.supersessionReason,
      };
    case "replacement":
      return {
        kind: "replacement",
        byId: row.supersededById ?? "",
        reason: row.supersessionReason,
      };
    case "deferral":
      return { kind: "deferral", reason: row.deferralReason };
    case "restatement":
      return {
        kind: "restatement",
        text: row.restatementText ?? "",
        notes: row.restatementNotes,
        reason: row.restatementReason,
      };
    default:
      return null;
  }
}

/** The Proposals the owner dismissed for the decision's current answer. */
export function dismissals(row: DecisionRow): Dismissal[] {
  if (row.dismissedProposalsJson == null) return [];
  return JSON.parse(row.dismissedProposalsJson) as Dismissal[];
}

function dismissedKind(row: DecisionRow, kind: DecisionProposalKind): boolean {
  return dismissals(row).some((dismissal) => dismissal.kind === kind);
}

/**
 * The rows of one session that may be offered `kind`, in the order given:
 * today's selection for that kind, less every row holding a Proposal, and,
 * for a deferral or a restatement, less every row with a remembered
 * dismissal of that kind. An answered-by or replacement dismissal names its
 * target, so `propose` matches it instead.
 */
export function eligibleFor(
  kind: DecisionProposalKind,
  rows: readonly DecisionRow[],
): DecisionRow[] {
  const free = (row: DecisionRow) => row.proposalKind == null;
  switch (kind) {
    case "answered-by":
      return supersedableLooseEnds(rows).filter(free);
    case "replacement":
      return replaceableDecisions(rows).filter(free);
    case "deferral":
    case "restatement":
      return deferrableDecisions(rows).filter(
        (row) => free(row) && !dismissedKind(row, kind),
      );
  }
}

function targetOf(proposal: Proposal): string | undefined {
  return proposal.kind === "answered-by" || proposal.kind === "replacement"
    ? proposal.byId
    : undefined;
}

function isDismissed(row: DecisionRow, proposal: Proposal): boolean {
  const target = targetOf(proposal);
  return dismissals(row).some(
    (dismissal) =>
      dismissal.kind === proposal.kind &&
      (target === undefined || dismissal.targetId === target),
  );
}

function payloadOf(proposal: Proposal): DecisionUpdate {
  switch (proposal.kind) {
    case "answered-by":
      return {
        supersededById: proposal.byId,
        supersessionAnswer: proposal.answer,
        supersessionReason: proposal.reason,
      };
    case "replacement":
      return {
        supersededById: proposal.byId,
        supersessionAnswer: null,
        supersessionReason: proposal.reason,
      };
    case "deferral":
      return { deferralReason: proposal.reason };
    case "restatement":
      return {
        restatementText: proposal.text,
        restatementNotes: proposal.notes,
        restatementReason: proposal.reason,
      };
  }
}

async function readDecision(db: DbHandle, id: string): Promise<DecisionRow> {
  const [row] = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1);
  if (!row) throw new Error(`Decision not found: ${id}`);
  return row;
}

async function writeDecision(
  db: DbHandle,
  id: string,
  update: DecisionUpdate,
): Promise<DecisionRow> {
  const [written] = await db
    .update(schema.decisions)
    .set(update)
    .where(eq(schema.decisions.id, id))
    .returning();
  return written!;
}

/**
 * Store `proposal` on the decision, unless it already holds one
 * (`already-pending`), the owner dismissed the same Proposal for its current
 * answer (`dismissed`), or it is not eligible for that kind (`not-eligible`),
 * checked in that order against the session's rows as they read now.
 */
export async function propose(
  id: string,
  proposal: Proposal,
  opts: ProposalOptions,
): Promise<ProposeResult> {
  const db = opts.db ?? getDb();
  const row = await readDecision(db, id);

  if (row.proposalKind != null) return { stored: false, skip: "already-pending" };
  if (isDismissed(row, proposal)) return { stored: false, skip: "dismissed" };

  const rows = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, row.sessionId))
    .orderBy(schema.decisions.createdAt, schema.decisions.id);
  if (!eligibleFor(proposal.kind, rows).some((candidate) => candidate.id === id)) {
    return { stored: false, skip: "not-eligible" };
  }

  const written = await writeDecision(db, id, {
    proposalKind: proposal.kind,
    ...payloadOf(proposal),
    updatedAt: opts.now,
  });
  return { stored: true, row: written };
}

/**
 * Mark the decision replaced by the decision its Proposal names: the link and
 * the reason are set, every pending Proposal is cleared, and the spec is
 * marked not current, since the export and the tickets read the link. The
 * answer, its settled time, its history and the remembered dismissals stay:
 * the answer did not change.
 */
async function acceptReplacement(
  db: DbHandle,
  row: DecisionRow,
  now: string,
): Promise<DecisionRow> {
  const written = await writeDecision(db, row.id, {
    replacedById: row.supersededById,
    replacedReason: row.supersessionReason,
    ...CLEARED_PENDING_PROPOSAL,
    updatedAt: now,
  });
  await markSpecNotCurrent(row.sessionId, now, db);
  return written;
}

/**
 * Accept the decision's pending Proposal, whatever its kind; null, writing
 * nothing, when none is pending. An answered-by settles the loose end with
 * the proposed answer, a deferral defers it and a restatement rewords it
 * (with the owner's `statement` when given), each through Answer change. A
 * replacement is accepted here.
 */
export async function accept(
  id: string,
  opts: ProposalOptions & { statement?: string },
): Promise<DecisionRow | null> {
  const { now, db } = opts;
  const row = await readDecision(db ?? getDb(), id);
  const pending = pendingProposal(row);
  if (!pending) return null;

  switch (pending.kind) {
    case "answered-by":
      return settle(
        id,
        {
          answer: row.supersessionAnswer ?? "",
          kind: "own-answer",
          settledById: row.supersededById,
        },
        { now, reason: row.supersessionReason ?? undefined, db },
      );
    case "replacement":
      if (db) return acceptReplacement(db, row, now);
      return getDb().transaction((tx) => acceptReplacement(tx, row, now));
    case "deferral":
      return defer(id, { now, reason: row.deferralReason ?? undefined, db });
    case "restatement": {
      // Never null: a non-null `operatorNotes` is what marks an accepted
      // restatement's entry, and the interviewer's context leaves every such
      // entry out. Its text is the original answer, which may hold notes even
      // when these are empty (an owner's edit took them out).
      const notes = row.restatementNotes?.trim() ? row.restatementNotes : "";
      return reword(
        id,
        { text: opts.statement?.trim() || row.restatementText || "", notes },
        { now, reason: row.restatementReason ?? undefined, db },
      );
    }
  }
}

/**
 * Dismiss the decision's pending Proposal: it is cleared and remembered for
 * the decision's current answer, so it is not offered again. Null, writing
 * nothing, when none is pending. Writes no history and leaves the spec as it
 * is.
 */
export async function dismiss(
  id: string,
  opts: ProposalOptions,
): Promise<DecisionRow | null> {
  const db = opts.db ?? getDb();
  const row = await readDecision(db, id);
  const pending = pendingProposal(row);
  if (!pending) return null;

  const target = targetOf(pending);
  const dismissal: Dismissal = {
    kind: pending.kind,
    ...(target !== undefined ? { targetId: target } : {}),
    reason: pending.reason,
    dismissedAt: opts.now,
    ...(pending.kind === "restatement" ? { text: pending.text } : {}),
  };

  return writeDecision(db, id, {
    ...CLEARED_PENDING_PROPOSAL,
    dismissedProposalsJson: JSON.stringify([...dismissals(row), dismissal]),
    updatedAt: opts.now,
  });
}

/**
 * Forget every remembered dismissal of `kind` naming `targetId` (absent and
 * null name the same target), so the Proposal may be offered again. Nothing
 * else changes; when nothing matches, nothing is written.
 */
export async function forgetDismissal(
  id: string,
  match: { kind: DecisionProposalKind; targetId?: string | null },
  opts: ProposalOptions,
): Promise<DecisionRow> {
  const db = opts.db ?? getDb();
  const row = await readDecision(db, id);
  const remembered = dismissals(row);
  const kept = remembered.filter(
    (dismissal) =>
      dismissal.kind !== match.kind ||
      (dismissal.targetId ?? null) !== (match.targetId ?? null),
  );
  if (kept.length === remembered.length) return row;

  return writeDecision(db, id, {
    dismissedProposalsJson: kept.length === 0 ? null : JSON.stringify(kept),
    updatedAt: opts.now,
  });
}
