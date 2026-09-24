import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getInterviewer,
  SCOUT_MODEL,
  type PreviousRepoDecision,
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
  repoDecisionsInTree,
  storeScoutReport,
  type ScoutProposalDisposition,
  type ScoutReportWithStaleness,
} from "../server/scout-report.js";
import {
  askUntilAccepted,
  MAX_TURN_RETRIES,
  projectContextFor,
  runTurn,
  TurnRejected,
} from "../server/turn.js";
import { reopenDecisionCore } from "./reopen-decision.js";

type ScoutSession = typeof schema.sessions.$inferSelect;

/**
 * Reopen every kept repo decision the scout reports `changed` or `removed`,
 * so its dependents go stale through the same review a manual reopen gets. A
 * `changed` one also gets the repo's new statement as its recommended
 * answer; `repoStatement` is left exactly as it was — it is what the
 * interview's next answer replaces (see
 * `.scratch/project-scout/issues/06-rescout-drift.md`,
 * "Reopening leaves repo_statement as it is").
 *
 * Runs after `runTurn` returns, once the session's turn is idle again: the
 * reopen this calls checks the same lock the scout turn just released, and
 * would refuse itself if it ran while the session still reads as working.
 */
async function applyRescoutDrift(input: {
  sessionId: string;
  keptKeys: ReadonlySet<string>;
  previousDecisions: ScoutProjectResult["previousDecisions"];
}): Promise<void> {
  const db = getDb();
  for (const entry of input.previousDecisions) {
    if (!input.keptKeys.has(entry.key) || entry.change === "unchanged") continue;

    const [decision] = await db
      .select({ id: schema.decisions.id })
      .from(schema.decisions)
      .where(
        and(
          eq(schema.decisions.sessionId, input.sessionId),
          eq(schema.decisions.key, entry.key),
        ),
      )
      .limit(1);
    if (!decision) continue;

    await reopenDecisionCore(decision.id);

    if (entry.change === "changed" && entry.statement) {
      await db
        .update(schema.decisions)
        .set({
          recommendedAnswer: entry.statement,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.decisions.id, decision.id));
    }
  }
}

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

  // The previous decisions a re-run carries: every repo decision the tree
  // still holds (disposition `kept`, however many re-runs it has survived —
  // it lives in `gr_decisions`, not in the previous report row) plus the
  // latest report's own proposals that are dropped or still undecided. A
  // kept decision does not come from `previous` at all, so it is unaffected
  // by the report row being replaced. See
  // `.scratch/project-scout/issues/06-rescout-drift.md`
  // ("Which decisions a re-run carries").
  const previous = await latestScoutReport(session.id);
  const keptFromTree = await repoDecisionsInTree(session.id);
  const keptKeys = new Set(keptFromTree.map((decision) => decision.key));
  const droppedOrUndecided = previous
    ? previousRepoDecisions(previous).filter(
        (decision) => decision.disposition !== "kept",
      )
    : [];
  const previousDecisions: PreviousRepoDecision[] = [
    ...keptFromTree,
    ...droppedOrUndecided,
  ];
  const previousDecisionKeys = previousDecisions.map((decision) => decision.key);
  // What each non-kept key was decided as before this run, so it keeps that
  // disposition on the new report instead of reverting to `undecided`. A
  // kept key is never carried this way: it is not report-tracked, it lives
  // in the tree.
  const priorDispositionByKey: Record<string, ScoutProposalDisposition> =
    Object.fromEntries(
      droppedOrUndecided.map((decision) => [
        decision.key,
        decision.disposition === "proposed" ? "undecided" : decision.disposition,
      ]),
    );
  // The previous report's own proposal content, by key, for a non-kept
  // decision the scout reports `unchanged` or `changed` but does not
  // repropose itself — the app carries it forward rather than losing it. A
  // `removed` one is not carried, whether or not it is reproposed.
  const priorProposalByKey = new Map(
    (previous?.result.proposedDecisions ?? []).map((decision) => [
      decision.key,
      decision,
    ]),
  );

  let acceptedResult: ScoutProjectResult | undefined;

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
        ask: async ({ rejectionReason, observer }) =>
          getInterviewer().scoutProject(
            {
              kind: "scout-project",
              context: {
                sessionId: session.id,
                idea: session.idea,
                title: session.title,
                model: SCOUT_MODEL,
                answeringMode: session.answeringMode,
                docsFolder: null,
                conversationId: null,
                decisions: [],
                projectContext: await projectContextFor(session),
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
      acceptedResult = accepted.result;

      // A kept decision is never a report proposal — it is reopened directly,
      // below, once the turn is no longer marked working. Drop it here in
      // case the scout echoed it back as a proposal anyway.
      const proposedByKey = new Map(
        accepted.result.proposedDecisions
          .filter((decision) => !keptKeys.has(decision.key))
          .map((decision) => [decision.key, decision]),
      );

      // Carry forward a non-kept previous proposal the scout reports
      // `unchanged` or `changed` but does not repropose itself — the report
      // row is what a re-run replaces, so losing it here would be silent.
      // The scout's own re-proposal, when it sends one, wins.
      for (const entry of accepted.result.previousDecisions) {
        if (keptKeys.has(entry.key)) continue;
        if (entry.change === "removed") continue;
        if (proposedByKey.has(entry.key)) continue;
        const prior = priorProposalByKey.get(entry.key);
        if (!prior) continue;
        proposedByKey.set(
          entry.key,
          entry.change === "changed" && entry.statement
            ? { ...prior, statement: entry.statement }
            : prior,
        );
      }
      const proposedDecisions = [...proposedByKey.values()];

      await storeScoutReport({
        sessionId: session.id,
        projectId: project.id,
        facts,
        result: { ...accepted.result, proposedDecisions },
        ideaRead: session.idea,
        model: SCOUT_MODEL,
        turnId: recorder?.turnId ?? null,
        ranAt: new Date().toISOString(),
        carriedDispositions: priorDispositionByKey,
      });

      return session.conversationId;
    },
  });

  // Now that the turn is no longer marked working, apply drift to every kept
  // decision the scout reported changed or removed. `acceptedResult` is set
  // whenever `runTurn` returns without throwing.
  if (acceptedResult) {
    await applyRescoutDrift({
      sessionId: session.id,
      keptKeys,
      previousDecisions: acceptedResult.previousDecisions,
    });
  }

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
