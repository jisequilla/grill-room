import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ScoutProjectResult } from "../server/interviewer/index.js";
import {
  latestScoutReport,
  setScoutProposalDisposition,
  type ScoutReport,
} from "../server/scout-report.js";
import { describeDecisions } from "../server/tree.js";

type ProposedRepoDecision = ScoutProjectResult["proposedDecisions"][number];

/**
 * The session, its scout report and the proposal `key` names, once every rule
 * that keeping or dropping shares has passed: the session is being
 * interviewed, no turn is working, it has a report, and `key` is one of that
 * report's proposals.
 */
export async function loadRepoProposal(input: {
  sessionId: string;
  key: string;
  verb: "kept" | "dropped";
}): Promise<{
  session: typeof schema.sessions.$inferSelect;
  report: ScoutReport;
  proposal: ProposedRepoDecision;
}> {
  const { sessionId, key, verb } = input;

  const [session] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

  if (session.state !== "interviewing") {
    fail(
      `A repo decision can be ${verb} only while the session is being interviewed. This session is ${session.state}.`,
      { errorCode: "wrong-session-state", statusCode: 409 },
    );
  }

  if (session.turnStatus === "working") {
    fail(
      `A repo decision can be ${verb} only while no turn is working. Wait for the turn to finish.`,
      { errorCode: "turn-working", statusCode: 409 },
    );
  }

  const report = await latestScoutReport(sessionId);
  if (!report) {
    fail("This session has no scout report to keep or drop decisions from.", {
      errorCode: "no-scout-report",
      statusCode: 409,
    });
  }

  const proposal = report.result.proposedDecisions.find(
    (candidate) => candidate.key === key,
  );
  if (!proposal) {
    fail(
      `"${key}" is not a decision the session's scout report proposes.`,
      { errorCode: "proposal-not-found", statusCode: 404 },
    );
  }

  return { session, report, proposal };
}

/**
 * Keep one proposed repo decision: it enters the tree settled, introduced by
 * the repo, with the project's statement as its answer, and the report records
 * it as kept.
 */
export async function keepRepoDecisionCore(input: {
  sessionId: string;
  key: string;
}) {
  const { sessionId, key } = input;
  const { report, proposal } = await loadRepoProposal({
    sessionId,
    key,
    verb: "kept",
  });

  if (report.dispositions[key] === "kept") {
    fail(`The repo decision "${key}" is already kept.`, {
      errorCode: "already-kept",
      statusCode: 409,
    });
  }

  const db = getDb();
  const [clash] = await db
    .select({ id: schema.decisions.id })
    .from(schema.decisions)
    .where(
      and(
        eq(schema.decisions.sessionId, sessionId),
        eq(schema.decisions.key, key),
      ),
    )
    .limit(1);
  if (clash) {
    fail(
      `The design tree already has a decision with the key "${key}", so the repo decision cannot be added under it.`,
      { errorCode: "key-in-use", statusCode: 409 },
    );
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(schema.decisions)
    .values({
      id: randomUUID(),
      sessionId,
      key,
      questionTitle: proposal.title,
      questionBody: proposal.reason,
      offeredChoicesJson: "[]",
      choiceRationalesJson: "[]",
      recommendedAnswer: proposal.statement,
      currentAnswer: proposal.statement,
      answerKind: "repo-established",
      dependsOnJson: "[]",
      introducedBy: "repo",
      settledAt: now,
      repoSource: proposal.source,
      repoCitation: proposal.citation,
      repoStatement: proposal.statement,
      scoutReportId: report.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) fail("Failed to add the repo decision.", { statusCode: 500 });

  const dispositions = await setScoutProposalDisposition(report.id, key, "kept");

  return {
    decision: describeDecisions([row])[0]!,
    dispositions: dispositions ?? { ...report.dispositions, [key]: "kept" },
  };
}

export default defineAction({
  description:
    "Keep one decision the session's scout report proposes: it enters the design tree settled, introduced by the repo, with the project's statement as its answer (answer kind repo-established), its source (recorded or inferred), citation and report. The interviewer can never ask it again; it changes only by reopening. The report records the proposal as kept. Allowed while the session is interviewing and no turn is working. Refused with no-scout-report, proposal-not-found for a key the report does not propose, already-kept, key-in-use when the tree already has a decision under that key, wrong-session-state, or turn-working. Returns the added decision and the report's dispositions.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    key: z.string().min(1).describe("The proposed repo decision's key"),
  }),
  run: ({ sessionId, key }) => keepRepoDecisionCore({ sessionId, key }),
});
