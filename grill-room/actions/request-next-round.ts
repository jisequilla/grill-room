import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { DecisionAnswerKind } from "../server/db/schema.js";
import {
  getInterviewer,
  isInterviewerError,
} from "../server/interviewer/index.js";
import type {
  AnswerKind,
  DecisionSnapshot,
  DecisionState,
  ProposeRoundResult,
  SubmittedAnswer,
  UserAddedDecision,
} from "../server/interviewer/index.js";
import {
  deferredFrontierIds,
  deriveTreeStates,
  neverAnsweredFrontierIds,
  parseStringArray,
  validateProposal,
  type DecisionRow,
  type KeyedTreeDecision,
} from "../server/tree.js";
import getCurrentRound from "./get-current-round.js";

/**
 * How many times a rejected proposal is sent back with its reasons before the
 * user sees an error. Three attempts in total: one, then two retries.
 */
const MAX_PROPOSAL_RETRIES = 2;

/** Every proposal in one turn was invalid. Distinct from an interviewer fault. */
class ProposalRejected extends Error {}

function dependencyKeys(row: DecisionRow, keyById: Map<string, string>) {
  return parseStringArray(row.dependsOnJson).flatMap((id) => {
    const key = keyById.get(id);
    return key ? [key] : [];
  });
}

/** The port's answer vocabulary spells a disposition as its target. */
function portAnswerKind(row: {
  answerKind: DecisionAnswerKind | null;
  dispositionTarget: DecisionRow["dispositionTarget"];
}): AnswerKind | null {
  if (!row.answerKind) return null;
  if (row.answerKind !== "dispositioned") return row.answerKind;
  return row.dispositionTarget ?? "out-of-scope";
}

/** A row, reduced to the facts `deriveTreeStates` and its callers need. */
function toTreeFields(row: DecisionRow) {
  return {
    id: row.id,
    dependsOn: parseStringArray(row.dependsOnJson),
    answerKind: row.answerKind,
    settledAt: row.settledAt,
    reopenedAt: row.reopenedAt,
    withdrawnAt: row.withdrawnAt,
    awaitingPlacementSince: row.awaitingPlacementSince,
  };
}

/** A row, as `validateProposal` needs an existing decision: tree facts plus its question. */
function toKeyedTreeDecision(row: DecisionRow): KeyedTreeDecision {
  return {
    ...toTreeFields(row),
    key: row.key,
    title: row.questionTitle,
    body: row.questionBody,
  };
}

/** User-added decisions still awaiting the interviewer's placement, oldest first. */
function pendingUserAddedDecisions(rows: DecisionRow[]): UserAddedDecision[] {
  return rows
    .filter(
      (row) => row.introducedBy === "user" && row.awaitingPlacementSince != null,
    )
    .map((row) => ({
      key: row.key ?? row.id,
      title: row.questionTitle,
      body: row.questionBody,
    }));
}

export default defineAction({
  description:
    "Ask the interviewer for the session's next round of questions, validate the proposal against the design tree, and open the round. Starts the interview when the session has no decisions yet. In one-at-a-time mode it opens the next single never-answered frontier question — whether newly proposed or just unblocked by an earlier answer — without calling the interviewer again while one is still available.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  run: async ({ sessionId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    if (session.turnStatus === "working") {
      fail(
        "The interviewer is already working on this session. Wait for the turn to finish.",
        { errorCode: "turn-in-progress", statusCode: 409 },
      );
    }

    // An open round is the answer to this request: asking again while one is
    // unanswered would throw away the drafts in it.
    const [alreadyOpen] = await db
      .select()
      .from(schema.rounds)
      .where(
        and(
          eq(schema.rounds.sessionId, sessionId),
          eq(schema.rounds.submissionState, "open"),
        ),
      )
      .limit(1);

    if (alreadyOpen) return getCurrentRound.run({ sessionId });

    const loadDecisions = () =>
      db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, sessionId))
        .orderBy(schema.decisions.createdAt);

    /**
     * Every decision that belongs in the next round: whatever the last
     * proposal marked to ask, plus any older decision that was blocked and has
     * since become frontier because its dependency settled, in that order,
     * followed by any deferred decision whose moment has come back around.
     * `pendingAsk` is not consulted here — it only records what a proposal
     * asked for, and says nothing about a decision the tree unblocked on its
     * own — so this reads the tree's actual state instead.
     */
    const nextRoundCandidates = (rows: DecisionRow[]) => {
      const treeRows = rows.map(toTreeFields);
      const ids = [
        ...neverAnsweredFrontierIds(treeRows),
        ...deferredFrontierIds(treeRows),
      ];
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    };

    const isOneAtATime = session.answeringMode === "one-at-a-time";

    let rows = await loadDecisions();
    // In whole-round mode every round consumes its entire pending set (see
    // `asking` below), so anything still to ask always needs a fresh
    // proposal; one-at-a-time mode only re-asks the interviewer once its
    // queue — proposal leftovers and newly-unblocked decisions alike — is
    // empty.
    let pending = isOneAtATime ? nextRoundCandidates(rows) : [];

    if (!isOneAtATime || pending.length === 0) {
      await runTurn();
      rows = await loadDecisions();
      pending = nextRoundCandidates(rows);
    }

    if (pending.length === 0) return getCurrentRound.run({ sessionId });

    // One at a time means one card per round; the rest stay pending and open
    // as later rounds without troubling the interviewer again.
    const asking = isOneAtATime ? pending.slice(0, 1) : pending;
    const now = new Date().toISOString();
    const roundId = randomUUID();

    // A deferred decision re-entering a round is a fresh ask: its deferral is
    // recorded to history first, then its answer kind resets to null so its
    // card comes up unanswered, same as a decision asked for the first time.
    const returningDeferred = asking.filter(
      (row) => row.answerKind === "deferred",
    );
    if (returningDeferred.length > 0) {
      await db.insert(schema.decisionHistory).values(
        returningDeferred.map((row) => ({
          id: randomUUID(),
          decisionId: row.id,
          questionTitle: row.questionTitle,
          questionBody: row.questionBody,
          answer: row.currentAnswer,
          answerKind: row.answerKind,
          recordedAt: now,
        })),
      );
      await db
        .update(schema.decisions)
        .set({
          answerKind: null,
          currentAnswer: null,
          settledAt: null,
          updatedAt: now,
        })
        .where(
          inArray(
            schema.decisions.id,
            returningDeferred.map((row) => row.id),
          ),
        );
    }

    await db.insert(schema.rounds).values({
      id: roundId,
      sessionId,
      submissionState: "open",
      createdAt: now,
    });

    await db.insert(schema.roundDecisions).values(
      asking.map((row, index) => ({
        id: randomUUID(),
        roundId,
        decisionId: row.id,
        sortOrder: index,
      })),
    );

    await db
      .update(schema.decisions)
      .set({ pendingAsk: false, updatedAt: now })
      .where(
        inArray(
          schema.decisions.id,
          asking.map((row) => row.id),
        ),
      );

    return getCurrentRound.run({ sessionId });

    /**
     * One interviewer turn, retried with the app's reasons while the proposal
     * keeps breaking the tree's rules. Nothing is written until a proposal is
     * accepted whole, so a rejected one leaves the tree exactly as it was.
     */
    async function runTurn(): Promise<void> {
      const startedAt = new Date().toISOString();
      await db
        .update(schema.sessions)
        .set({
          turnStatus: "working",
          turnStartedAt: startedAt,
          turnErrorCode: null,
          turnErrorMessage: null,
          updatedAt: startedAt,
        })
        .where(eq(schema.sessions.id, sessionId));

      let accepted: { result: ProposeRoundResult; conversationId: string };
      try {
        accepted = await propose();
      } catch (error) {
        const [code, message] = isInterviewerError(error)
          ? [error.code, error.message]
          : error instanceof ProposalRejected
            ? ["invalid-proposal", error.message]
            : ["failed", "The interviewer turn failed."];

        await db
          .update(schema.sessions)
          .set({
            turnStatus: "failed",
            turnErrorCode: code,
            turnErrorMessage: message,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.sessions.id, sessionId));

        if (isInterviewerError(error) || error instanceof ProposalRejected) {
          // Deliberately not a retryable status: a turn costs a minute of a
          // shared subscription, so retrying is the user's call, not the
          // client's.
          fail(message, { errorCode: code, statusCode: 400 });
        }
        throw error;
      }

      await store(accepted.result, accepted.conversationId);
    }

    async function propose() {
      const interviewer = getInterviewer();
      const latestAnswers = await answersOfLastSubmittedRound();
      let conversationId = session!.conversationId;
      let rejectionReason: string | null = null;

      for (let attempt = 0; attempt <= MAX_PROPOSAL_RETRIES; attempt += 1) {
        const current = await loadDecisions();
        const turn = await interviewer.proposeRound({
          kind: "propose-round",
          context: {
            idea: session!.idea,
            title: session!.title,
            model: session!.model,
            answeringMode: session!.answeringMode,
            conversationId,
            decisions: await snapshots(current),
          },
          latestAnswers,
          userAddedDecisions: pendingUserAddedDecisions(current),
          rejectionReason,
        });

        conversationId = turn.conversationId;

        const validation = validateProposal(
          current.map(toKeyedTreeDecision),
          turn.result.proposedDecisions,
          {
            pushBackResponses: turn.result.pushBackResponses,
            userDecisionPlacements: turn.result.userDecisionPlacements,
          },
        );

        if (validation.ok) {
          return { result: turn.result, conversationId: turn.conversationId };
        }

        rejectionReason = validation.reasons.join(" ");
      }

      throw new ProposalRejected(
        `The interviewer proposed a round that does not fit the design tree ${MAX_PROPOSAL_RETRIES + 1} times. Last reason: ${rejectionReason}`,
      );
    }

    /**
     * The tree as the interviewer reads it, keys and all. A withdrawn decision
     * has left the tree and is left out entirely; a decision the user added is
     * left out too, until it is placed — it reaches the interviewer through
     * `userAddedDecisions` instead, since it has no dependencies to show yet.
     */
    async function snapshots(
      current: DecisionRow[],
    ): Promise<DecisionSnapshot[]> {
      const keyById = new Map(
        current.flatMap((row) => (row.key ? [[row.id, row.key] as const] : [])),
      );
      const states = deriveTreeStates(current.map(toTreeFields));

      const history = current.length
        ? await db
            .select()
            .from(schema.decisionHistory)
            .where(
              inArray(
                schema.decisionHistory.decisionId,
                current.map((row) => row.id),
              ),
            )
            .orderBy(schema.decisionHistory.recordedAt)
        : [];

      return current
        .filter((row) => row.withdrawnAt == null && row.awaitingPlacementSince == null)
        .map((row) => {
          const kind = portAnswerKind(row);
          const rawState = states.get(row.id);
          const state: DecisionState =
            rawState === "settled" ||
            rawState === "frontier" ||
            rawState === "blocked" ||
            rawState === "stale"
              ? rawState
              : "blocked";
          return {
            key: row.key ?? row.id,
            title: row.questionTitle,
            body: row.questionBody,
            choices: parseStringArray(row.offeredChoicesJson),
            recommendedAnswer: row.recommendedAnswer ?? "",
            dependsOn: dependencyKeys(row, keyById),
            state,
            answer: kind ? { kind, text: row.currentAnswer ?? "" } : null,
            previousAnswers: history
              .filter((entry) => entry.decisionId === row.id)
              .flatMap((entry) =>
                entry.answerKind
                  ? [
                      {
                        kind: portAnswerKind({
                          answerKind: entry.answerKind,
                          dispositionTarget: null,
                        }) as AnswerKind,
                        text: entry.answer ?? "",
                      },
                    ]
                  : [],
              ),
            introducedBy: row.introducedBy,
          };
        });
    }

    async function answersOfLastSubmittedRound(): Promise<SubmittedAnswer[]> {
      const [last] = await db
        .select()
        .from(schema.rounds)
        .where(
          and(
            eq(schema.rounds.sessionId, sessionId),
            eq(schema.rounds.submissionState, "submitted"),
          ),
        )
        .orderBy(desc(schema.rounds.submittedAt))
        .limit(1);

      if (!last) return [];

      const placements = await db
        .select()
        .from(schema.roundDecisions)
        .where(eq(schema.roundDecisions.roundId, last.id))
        .orderBy(schema.roundDecisions.sortOrder);

      if (placements.length === 0) return [];

      const answered = await db
        .select()
        .from(schema.decisions)
        .where(
          inArray(
            schema.decisions.id,
            placements.map((placement) => placement.decisionId),
          ),
        );

      const byId = new Map(answered.map((row) => [row.id, row]));

      return placements.flatMap((placement) => {
        const row = byId.get(placement.decisionId);
        const kind = row ? portAnswerKind(row) : null;
        if (!row || !kind) return [];
        return [
          {
            decisionKey: row.key ?? row.id,
            kind,
            text: row.currentAnswer ?? "",
          },
        ];
      });
    }

    /**
     * Store an accepted proposal. A done proposal is a later ticket's concern
     * and is ignored here rather than failing the turn.
     */
    async function store(
      result: ProposeRoundResult,
      conversationId: string,
    ): Promise<void> {
      const stamp = Date.now();
      const now = new Date(stamp).toISOString();
      const currentRows = await loadDecisions();
      const keyById = new Map(
        currentRows.flatMap((row) =>
          row.key ? [[row.key, row.id] as const] : [],
        ),
      );
      const rowByKey = new Map(
        currentRows.flatMap((row) =>
          row.key ? [[row.key, row] as const] : [],
        ),
      );

      const ids = new Map(
        result.proposedDecisions.map((decision) => [
          decision.key,
          randomUUID(),
        ]),
      );
      const resolveId = (key: string) => ids.get(key) ?? keyById.get(key);

      if (result.proposedDecisions.length > 0) {
        await db.insert(schema.decisions).values(
          result.proposedDecisions.map((decision, index) => {
            // Distinct, increasing timestamps: the tree and the one-at-a-time
            // queue are read back in this order, and a tie would make it
            // arbitrary.
            const createdAt = new Date(stamp + index).toISOString();
            return {
              id: ids.get(decision.key) as string,
              sessionId,
              key: decision.key,
              questionTitle: decision.title,
              questionBody: decision.body,
              offeredChoicesJson: JSON.stringify(decision.choices),
              recommendedAnswer: decision.recommendedAnswer,
              dependsOnJson: JSON.stringify(
                decision.dependsOn.flatMap((key) => {
                  const id = resolveId(key);
                  return id ? [id] : [];
                }),
              ),
              introducedBy: "interviewer" as const,
              pendingAsk: decision.ask,
              createdAt,
              updatedAt: createdAt,
            };
          }),
        );
      }

      // Push backs: the pushed-back decision leaves the tree, its explanation
      // kept in decision history. A replacement or restructuring arrives as an
      // ordinary entry of `proposedDecisions`, already inserted above.
      for (const response of result.pushBackResponses) {
        const row = rowByKey.get(response.decisionKey);
        if (!row) continue;

        await db.insert(schema.decisionHistory).values({
          id: randomUUID(),
          decisionId: row.id,
          questionTitle: row.questionTitle,
          questionBody: row.questionBody,
          answer: response.explanation,
          answerKind: row.answerKind,
          recordedAt: now,
        });

        await db
          .update(schema.decisions)
          .set({ withdrawnAt: now, updatedAt: now })
          .where(eq(schema.decisions.id, row.id));
      }

      // User-added decisions the interviewer placed: the existing
      // awaiting-placement row takes its dependencies, recommendation and
      // choices, and stops awaiting. Its title and body are the user's own and
      // are left untouched.
      for (const placement of result.userDecisionPlacements) {
        const row = rowByKey.get(placement.key);
        if (!row) continue;

        await db
          .update(schema.decisions)
          .set({
            recommendedAnswer: placement.recommendedAnswer,
            offeredChoicesJson: JSON.stringify(placement.choices),
            dependsOnJson: JSON.stringify(
              placement.dependsOn.flatMap((key) => {
                const id = resolveId(key);
                return id ? [id] : [];
              }),
            ),
            pendingAsk: placement.ask,
            awaitingPlacementSince: null,
            updatedAt: now,
          })
          .where(eq(schema.decisions.id, row.id));
      }

      await db
        .update(schema.sessions)
        .set({
          conversationId,
          turnStatus: "idle",
          turnErrorCode: null,
          turnErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(schema.sessions.id, sessionId));
    }
  },
});
