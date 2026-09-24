import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getInterviewer,
  SCOUT_MODEL,
  type ScoutProjectResult,
} from "../server/interviewer/index.js";
import { collectProjectFacts } from "../server/project-facts.js";
import { failWithProjectFactsRefusal } from "../server/project-refusal.js";
import { getProject, type Project } from "../server/projects.js";
import {
  currentScoutReport,
  latestScoutReport,
  previousRepoDecisions,
  reasonsToRefuseScoutReport,
  storeScoutReport,
  type ScoutReportWithStaleness,
} from "../server/scout-report.js";
import {
  askUntilAccepted,
  MAX_TURN_RETRIES,
  runTurn,
  TurnRejected,
} from "../server/turn.js";

type ScoutSession = typeof schema.sessions.$inferSelect;

/**
 * Runs the scout turn for a session and its project, storing the accepted
 * report and returning it with its staleness. Shared with `assess-readiness`,
 * which runs the scout first when a session has a project and no current
 * report — the same turn, the same storage, the same citation checks.
 *
 * Callers are responsible for whatever state checks matter to them (session
 * state, turn lock); this function performs none, so it can run as the first
 * of two turns without a redundant check between them.
 */
export async function scoutProjectCore(input: {
  session: ScoutSession;
  project: Pick<Project, "id" | "rootPath">;
}): Promise<ScoutReportWithStaleness | null> {
  const { session, project } = input;

  const collected = await collectProjectFacts(project.rootPath);
  if ("refusal" in collected) failWithProjectFactsRefusal(collected.refusal);
  const { facts } = collected;

  const previous = await latestScoutReport(session.id);
  const previousDecisions = previous ? previousRepoDecisions(previous) : [];
  const previousDecisionKeys = previousDecisions.map((decision) => decision.key);

  // The scout is not part of the interview: it runs in a conversation of its
  // own on its own model, and leaves the session's conversation untouched, so
  // the session's model stays unlocked.
  await runTurn({
    sessionId: session.id,
    failedMessage: "The scout turn failed.",
    record: { turnKind: "scout-project", model: SCOUT_MODEL },
    take: async (recorder) => {
      const accepted = await askUntilAccepted<ScoutProjectResult>({
        conversationId: null,
        recorder,
        ask: ({ rejectionReason, observer }) =>
          getInterviewer().scoutProject(
            {
              kind: "scout-project",
              context: {
                idea: session.idea,
                title: session.title,
                model: SCOUT_MODEL,
                answeringMode: session.answeringMode,
                docsFolder: null,
                conversationId: null,
                decisions: [],
              },
              projectRoot: project.rootPath,
              facts,
              previousDecisions,
              rejectionReason,
            },
            observer,
          ),
        reasonsToRefuse: (result) =>
          reasonsToRefuseScoutReport(result, {
            projectRoot: project.rootPath,
            previousDecisionKeys,
          }),
        exhausted: (lastReason) =>
          new TurnRejected(
            "invalid-scout-report",
            `The scout returned a report the app could not accept ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
          ),
      });

      await storeScoutReport({
        sessionId: session.id,
        projectId: project.id,
        facts,
        result: accepted.result,
        ideaRead: session.idea,
        model: SCOUT_MODEL,
        turnId: recorder?.turnId ?? null,
        ranAt: new Date().toISOString(),
      });

      return session.conversationId;
    },
  });

  const [refreshed] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, session.id))
    .limit(1);
  return refreshed ? currentScoutReport(refreshed) : null;
}

export default defineAction({
  description:
    "Run the scout on a session's project: collect the repository's server facts, have the scout (always on sonnet, read-only) report the project's current state and proposed repo decisions for the session's idea, check every citation against the project's files, and store the report on the session, replacing any earlier one. Every proposal starts undecided. Returns the report with `stale`. Refused with no-project when the session has no project, not-a-repo when the project root is no longer a git repository, wrong-session-state outside interviewing, and turn-working while a turn is working. A report the app refuses three times fails the turn with invalid-scout-report.",
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

    if (session.state !== "interviewing") {
      fail(
        `Only a session still being interviewed can have its project scouted. This session is ${session.state}.`,
        { errorCode: "wrong-session-state", statusCode: 409 },
      );
    }

    if (session.turnStatus === "working") {
      fail(
        "The project can be scouted only while no turn is working. Wait for the turn to finish.",
        { errorCode: "turn-working", statusCode: 409 },
      );
    }

    const project = session.projectId
      ? await getProject(session.projectId)
      : undefined;
    if (!project) {
      fail("This session has no project to scout. Choose a project first.", {
        errorCode: "no-project",
        statusCode: 409,
      });
    }

    const report = await scoutProjectCore({ session, project });

    return { sessionId, report };
  },
});
