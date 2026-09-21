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
  ProposeRoundResult,
  SubmittedAnswer,
} from "../server/interviewer/index.js";
import {
  deriveTreeStates,
  isSettlingAnswerKind,
  parseStringArray,
  validateProposal,
  type DecisionRow,
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

export default defineAction({
  description:
    "Ask the interviewer for the session's next round of questions, validate the proposal against the design tree, and open the round. Starts the interview when the session has no decisions yet. In one-at-a-time mode it opens the next single question from an existing proposal without calling the interviewer again.",
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

    /** Decisions the interviewer asked for that no round has opened on yet. */
    const askable = (rows: DecisionRow[]) => {
      const states = deriveTreeStates(
        rows.map((row) => ({
          id: row.id,
          dependsOn: parseStringArray(row.dependsOnJson),
          answerKind: row.answerKind,
          settledAt: row.settledAt,
          reopenedAt: row.reopenedAt,
        })),
      );
      return rows.filter(
        (row) => row.pendingAsk && states.get(row.id) === "frontier",
      );
    };

    let rows = await loadDecisions();
    let pending = askable(rows);

    if (pending.length === 0) {
      await runTurn();
      rows = await loadDecisions();
      pending = askable(rows);
    }

    if (pending.length === 0) return getCurrentRound.run({ sessionId });

    // One at a time means one card per round; the rest stay pending and open
    // as later rounds without troubling the interviewer again.
    const asking =
      session.answeringMode === "one-at-a-time" ? pending.slice(0, 1) : pending;
    const now = new Date().toISOString();
    const roundId = randomUUID();

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
          userAddedDecisions: [],
          rejectionReason,
        });

        conversationId = turn.conversationId;

        const validation = validateProposal(
          current.map((row) => ({
            id: row.id,
            key: row.key,
            dependsOn: parseStringArray(row.dependsOnJson),
            answerKind: row.answerKind,
            settledAt: row.settledAt,
            reopenedAt: row.reopenedAt,
          })),
          turn.result.proposedDecisions,
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

    /** The tree as the interviewer reads it, keys and all. */
    async function snapshots(
      current: DecisionRow[],
    ): Promise<DecisionSnapshot[]> {
      const keyById = new Map(
        current.flatMap((row) => (row.key ? [[row.id, row.key] as const] : [])),
      );
      const states = deriveTreeStates(
        current.map((row) => ({
          id: row.id,
          dependsOn: parseStringArray(row.dependsOnJson),
          answerKind: row.answerKind,
          settledAt: row.settledAt,
          reopenedAt: row.reopenedAt,
        })),
      );

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

      return current.map((row) => {
        const kind = portAnswerKind(row);
        return {
          key: row.key ?? row.id,
          title: row.questionTitle,
          body: row.questionBody,
          choices: parseStringArray(row.offeredChoicesJson),
          recommendedAnswer: row.recommendedAnswer ?? "",
          dependsOn: dependencyKeys(row, keyById),
          state: states.get(row.id) ?? "blocked",
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
     * Store an accepted proposal. Push backs, user decision placements and a
     * done proposal are parts of later tickets and are ignored here rather
     * than failing the turn.
     */
    async function store(
      result: ProposeRoundResult,
      conversationId: string,
    ): Promise<void> {
      const stamp = Date.now();
      const keyById = new Map(
        (await loadDecisions()).flatMap((row) =>
          row.key ? [[row.key, row.id] as const] : [],
        ),
      );

      const ids = new Map(
        result.proposedDecisions.map((decision) => [
          decision.key,
          randomUUID(),
        ]),
      );

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
                  const id = ids.get(key) ?? keyById.get(key);
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

      await db
        .update(schema.sessions)
        .set({
          conversationId,
          turnStatus: "idle",
          turnErrorCode: null,
          turnErrorMessage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.sessions.id, sessionId));
    }
  },
});
