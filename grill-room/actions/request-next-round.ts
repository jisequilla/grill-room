import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getInterviewer } from "../server/interviewer/index.js";
import type {
  ProposeRoundResult,
  SubmittedAnswer,
  UserAddedDecision,
} from "../server/interviewer/index.js";
import { increasingTimestamps } from "../server/ordering.js";
import { returnSessionToInterviewing } from "../server/session-state.js";
import { runDueStaleReviews } from "../server/stale-review.js";
import {
  findSupersessionsForDone,
  type SupersessionFailure,
} from "../server/supersession.js";
import {
  deferredFrontierIds,
  neverAnsweredFrontierIds,
  CLEARED_ANSWER_LINKS,
  toTreeDecision,
  validateProposal,
  type DecisionRow,
  type KeyedTreeDecision,
} from "../server/tree.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  projectContextFor,
  failIfTurnInProgress,
  MAX_TURN_RETRIES,
  portAnswerKind,
  portKey,
  runTurn,
  TurnRejected,
} from "../server/turn.js";
import type { AttemptRecorder } from "../server/turn-recorder.js";
import getCurrentRound from "./get-current-round.js";

/** A row, as `validateProposal` needs an existing decision: tree facts plus its question. */
function toKeyedTreeDecision(row: DecisionRow): KeyedTreeDecision {
  return {
    ...toTreeDecision(row),
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
      key: portKey(row),
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

    failIfTurnInProgress(
      session,
      "The interviewer is already working on this session. Wait for the turn to finish.",
    );

    // Whatever a reopened answer put in doubt is judged first, so the tree is
    // true before anything reads it: the cards of an open round, and any
    // proposal asked for below. Costs nothing when nothing is stale.
    await runDueStaleReviews(sessionId);

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
        // `createdAt` has millisecond precision; id as a final tie-break
        // keeps round-building order deterministic when two decisions land
        // in the same millisecond (a proposal's own decisions never tie —
        // see `store` below — but a decision from a different action, such
        // as `add-decision`, still can).
        .orderBy(schema.decisions.createdAt, schema.decisions.id);

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
      const treeRows = rows.map(toTreeDecision);
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
    // The turn record of the proposal this request asked for, which the round
    // it opens points at. Null when the round comes from an earlier proposal's
    // queue without troubling the interviewer.
    let proposalTurnId: string | null = null;

    if (!isOneAtATime || pending.length === 0) {
      const supersessionFailure = await runProposalTurn();
      // `runTurn` has finished writing the turn's own status by now, so an
      // error from the done proposal's second turn survives being stored here.
      // The status stays `idle` deliberately: the done proposal did succeed,
      // and a `failed` status would replace the ending the user just reached
      // with a retry panel. The error is what the done panel offers a fresh
      // check from.
      if (supersessionFailure) {
        await db
          .update(schema.sessions)
          .set({
            turnErrorCode: supersessionFailure.code,
            turnErrorMessage: supersessionFailure.message,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.sessions.id, sessionId));
      }
      rows = await loadDecisions();
      pending = nextRoundCandidates(rows);
    }

    if (pending.length === 0) return getCurrentRound.run({ sessionId });

    // One at a time means one card per round; the rest stay pending and open
    // as later rounds without troubling the interviewer again.
    const asking = isOneAtATime ? pending.slice(0, 1) : pending;
    const now = new Date().toISOString();
    const roundId = randomUUID();

    // A round is about to open, so the interview is continuing: a session
    // that had proposed (or, via a reopen elsewhere, confirmed) done returns
    // to interviewing, its done summary is dropped, and — leaving
    // `confirmed` — its spec is marked not current.
    if (session.state !== "interviewing") {
      await returnSessionToInterviewing(session, now);
    }

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
          ...CLEARED_ANSWER_LINKS,
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
      turnId: proposalTurnId,
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
     *
     * Resolves with the failure of a done proposal's supersession scan, when
     * there was one: the scan runs inside this turn, but its error can only be
     * stored after `runTurn` has written the turn's own result.
     *
     * Every model call of the turn is recorded as an attempt on a turn record
     * of kind `propose-round`, whose id is kept for the round it opens.
     */
    async function runProposalTurn(): Promise<SupersessionFailure | null> {
      let failure: SupersessionFailure | null = null;

      await runTurn({
        sessionId,
        failedMessage: "The interviewer turn failed.",
        record: { turnKind: "propose-round", model: session!.model },
        take: async (recorder) => {
          proposalTurnId = recorder?.turnId ?? null;
          const accepted = await propose(recorder);
          const stored = await store(accepted.result, accepted.conversationId);
          failure = stored.failure;
          return stored.conversationId;
        },
      });

      return failure;
    }

    async function propose(recorder: AttemptRecorder | null) {
      const interviewer = getInterviewer();
      const latestAnswers = await answersOfLastSubmittedRound();
      // The tree cannot change between attempts: nothing is written until one
      // is accepted. Refusal only needs the proposal read against it.
      let against: KeyedTreeDecision[] = [];

      return askUntilAccepted<ProposeRoundResult>({
        conversationId: session!.conversationId,
        recorder,
        ask: async ({ conversationId, rejectionReason, observer }) => {
          const current = await loadDecisions();
          against = current.map(toKeyedTreeDecision);
          return interviewer.proposeRound(
            {
              kind: "propose-round",
              context: {
                sessionId: session!.id,
                idea: session!.idea,
                title: session!.title,
                model: session!.model,
                answeringMode: session!.answeringMode,
                docsFolder: session!.docsFolder,
                conversationId,
                decisions: await decisionSnapshots(current),
                projectContext: await projectContextFor(session!),
              },
              latestAnswers,
              userAddedDecisions: pendingUserAddedDecisions(current),
              rejectionReason,
            },
            observer,
          );
        },
        reasonsToRefuse: (result) =>
          validateProposal(against, result.proposedDecisions, {
            pushBackResponses: result.pushBackResponses,
            userDecisionPlacements: result.userDecisionPlacements,
            done: result.done != null,
          }).reasons,
        exhausted: (lastReason) =>
          new TurnRejected(
            "invalid-proposal",
            `The interviewer proposed a round that does not fit the design tree ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
          ),
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
        // `submittedAt` has millisecond precision. Only one round is ever
        // open at a time, so a round is always created after the previous
        // one submits — `createdAt` desc is a meaningful secondary key on a
        // tie, and id is the final, arbitrary-but-deterministic fallback.
        .orderBy(
          desc(schema.rounds.submittedAt),
          desc(schema.rounds.createdAt),
          schema.rounds.id,
        )
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
          { decisionKey: portKey(row), kind, text: row.currentAnswer ?? "" },
        ];
      });
    }

    /**
     * Store an accepted proposal, and resolve with the conversation to resume
     * next and whatever the done proposal's second turn failed with. When the
     * proposal carries `done`, `reasonsToRefuse` has already checked that
     * nothing would be asked once it lands, so the session moves straight to
     * `done-proposed` with the summary: the pending-candidate check just below
     * finds nothing, and no round opens.
     */
    async function store(
      result: ProposeRoundResult,
      conversationId: string,
    ): Promise<{ conversationId: string; failure: SupersessionFailure | null }> {
      const now = new Date().toISOString();
      // Distinct, increasing timestamps: the tree and the one-at-a-time queue
      // are read back in `createdAt` order, and a tie would make it
      // arbitrary.
      const decisionCreatedAts = increasingTimestamps(
        now,
        result.proposedDecisions.length,
      );
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
            const createdAt = decisionCreatedAts[index] as string;
            return {
              id: ids.get(decision.key) as string,
              sessionId,
              key: decision.key,
              questionTitle: decision.title,
              questionBody: decision.body,
              offeredChoicesJson: JSON.stringify(
                decision.choices.map((choice) => choice.label),
              ),
              choiceRationalesJson: JSON.stringify(
                decision.choices.map((choice) => choice.rationale),
              ),
              recommendedChoice: decision.recommendedChoice,
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

      // Push backs: the pushed-back decision leaves the tree, the user's reason
      // for pushing back and the interviewer's answer to it both kept in
      // decision history. A replacement or restructuring arrives as an ordinary
      // entry of `proposedDecisions`, already inserted above.
      for (const response of result.pushBackResponses) {
        const row = rowByKey.get(response.decisionKey);
        if (!row) continue;

        await db.insert(schema.decisionHistory).values({
          id: randomUUID(),
          decisionId: row.id,
          questionTitle: row.questionTitle,
          questionBody: row.questionBody,
          answer: row.currentAnswer,
          answerKind: row.answerKind,
          interviewerReason: response.explanation,
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
            recommendedChoice: placement.recommendedChoice,
            offeredChoicesJson: JSON.stringify(
              placement.choices.map((choice) => choice.label),
            ),
            choiceRationalesJson: JSON.stringify(
              placement.choices.map((choice) => choice.rationale),
            ),
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

      if (!result.done) return { conversationId, failure: null };

      // The second half of a done proposal: before the user is asked to
      // resolve every loose end by hand, the interviewer says which of them a
      // later decision already answered. It runs inside this same turn — one
      // working status, one conversation — and cannot take the done proposal
      // down with it if it fails, which is why the failure comes back as a
      // value rather than an exception.
      const scan = await findSupersessionsForDone({
        session: session!,
        conversationId,
      });

      await db
        .update(schema.sessions)
        .set({
          state: "done-proposed",
          doneSummary: result.done.summary,
          updatedAt: now,
        })
        .where(eq(schema.sessions.id, sessionId));

      return {
        conversationId: scan.conversationId ?? conversationId,
        failure: scan.failure,
      };
    }
  },
});
