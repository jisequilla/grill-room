import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import {
  currentBriefGrounding,
  reasonsToRefuseHandoffGrounding,
  storeBriefGrounding,
} from "../server/brief-grounding.js";
import { getDb, schema } from "../server/db/index.js";
import {
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
} from "../server/handoff.js";
import {
  getInterviewer,
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_TICKETS,
  SCOUT_MODEL,
  type HandoffScoutResult,
} from "../server/interviewer/index.js";
import { collectProjectFacts } from "../server/project-facts.js";
import { failWithProjectFactsRefusal } from "../server/project-refusal.js";
import { getProject } from "../server/projects.js";
import {
  askUntilAccepted,
  MAX_TURN_RETRIES,
  projectContextFor,
  runTurn,
  TurnRejected,
} from "../server/turn.js";

/** An attempt's result with the app's reasons to refuse it, worked out beside it. */
interface CheckedGrounding {
  result: HandoffScoutResult;
  reasons: string[];
}

export default defineAction({
  description:
    "Ground a session's handoff briefs in its project's code: one handoff scout turn (always on sonnet, read-only over the project root, its own conversation) covering every ticket at once, reporting per ticket the files to create or edit, the existing files it builds on, cited codebase facts, what it needs from each blocker with the check that proves it, and the test and command that prove it. Every citation, ticket, dependency and planned file is checked against the handoff and the working tree, and a result that fails is sent back with the reasons. The accepted grounding is stored on the session with the commit it read and the handoff fingerprint it was made for, replacing any earlier one. Refused with no-project, not-a-repo, handoff-missing, handoff-stale, turn-working, too-many-tickets or too-many-blockers (the last two before any turn is spent). A grounding refused three times fails the turn with invalid-brief-grounding. Returns the grounding as get-brief-grounding does.",
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
        "The briefs can be grounded only while no turn is working. Wait for the turn to finish.",
        { errorCode: "turn-working", statusCode: 409 },
      );
    }

    const project = session.projectId
      ? await getProject(session.projectId)
      : undefined;
    if (!project) {
      fail("This session has no project to ground its briefs in. Choose a project first.", {
        errorCode: "no-project",
        statusCode: 409,
      });
    }

    const collected = await collectProjectFacts(
      project.rootPath,
      session.lastExportFolder ?? undefined,
    );
    if ("refusal" in collected) failWithProjectFactsRefusal(collected.refusal);
    const { facts } = collected;

    const handoff = await getHandoffRow(sessionId);
    if (!handoff) {
      fail("This session has no handoff to ground. Generate the handoff first.", {
        errorCode: "handoff-missing",
        statusCode: 409,
      });
    }

    const loaded = await loadHandoffSource(sessionId);
    if (
      !("source" in loaded) ||
      handoffFingerprint(loaded.source) !== handoff.fingerprint
    ) {
      fail(
        "The handoff no longer matches the session's spec, tickets or project. Regenerate the handoff first.",
        { errorCode: "handoff-stale", statusCode: 409 },
      );
    }
    const { tickets } = loaded.source;

    if (tickets.length > MAX_HANDOFF_SCOUT_TICKETS) {
      fail(
        `The handoff has ${tickets.length} tickets; one grounding turn covers at most ${MAX_HANDOFF_SCOUT_TICKETS}.`,
        { errorCode: "too-many-tickets", statusCode: 409 },
      );
    }
    const overBlocked = tickets.filter(
      (ticket) => ticket.blockedBy.length > MAX_HANDOFF_SCOUT_BUILDS_ON,
    );
    if (overBlocked.length > 0) {
      fail(
        `${overBlocked.map((ticket) => `Ticket ${ticket.number} has ${ticket.blockedBy.length} blockers`).join("; ")}; a grounded ticket names at most ${MAX_HANDOFF_SCOUT_BUILDS_ON}.`,
        { errorCode: "too-many-blockers", statusCode: 409 },
      );
    }

    const [spec] = await db
      .select({ markdown: schema.specs.markdown })
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    const requestTickets = tickets.map((ticket) => ({
      number: ticket.number,
      title: ticket.title,
      body: ticket.body,
      blockedBy: [...ticket.blockedBy].sort((a, b) => a - b),
    }));

    // Like the project scout, the handoff scout runs in a conversation of its
    // own on its own model, and leaves the session's conversation untouched.
    await runTurn({
      sessionId,
      failedMessage: "The handoff scout turn failed.",
      record: { turnKind: "handoff-scout", model: SCOUT_MODEL },
      take: async (recorder) => {
        const accepted = await askUntilAccepted<CheckedGrounding>({
          conversationId: null,
          recorder,
          // The ignore check runs git, so it is async; `reasonsToRefuse` is
          // not. Each attempt works its reasons out as soon as the scout
          // answers, and `reasonsToRefuse` reads them back.
          ask: async ({ rejectionReason, observer }) => {
            const turn = await getInterviewer().scoutHandoff(
              {
                kind: "handoff-scout",
                context: {
                  sessionId,
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
                specMarkdown: spec?.markdown ?? "",
                tickets: requestTickets,
                rejectionReason,
              },
              observer,
            );
            const reasons = await reasonsToRefuseHandoffGrounding(turn.result, {
              projectRoot: project.rootPath,
              tickets: requestTickets,
            });
            return {
              result: { result: turn.result, reasons },
              conversationId: turn.conversationId,
            };
          },
          reasonsToRefuse: (checked) => checked.reasons,
          exhausted: (lastReason) =>
            new TurnRejected(
              "invalid-brief-grounding",
              `The handoff scout returned a grounding the app could not accept ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
            ),
        });

        await storeBriefGrounding({
          sessionId,
          result: accepted.result.result,
          commitRead: facts.headCommit,
          handoffFingerprint: handoff.fingerprint,
          model: SCOUT_MODEL,
          turnId: recorder?.turnId ?? null,
          ranAt: new Date().toISOString(),
        });

        return session.conversationId;
      },
    });

    return { sessionId, grounding: await currentBriefGrounding(sessionId) };
  },
});
