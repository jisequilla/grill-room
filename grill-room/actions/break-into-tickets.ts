import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import {
  checkConsistencyForBreakdown,
  tooManyTicketsMessage,
  type ConsistencyFailure,
} from "../server/consistency.js";
import { getDb, schema } from "../server/db/index.js";
import { headCommit } from "../server/export-bundle.js";
import { collectHandoffFactPack } from "../server/handoff-fact-pack.js";
import { getInterviewer, MAX_HANDOFF_SCOUT_TICKETS } from "../server/interviewer/index.js";
import type { BreakIntoTicketsResult } from "../server/interviewer/index.js";
import { getProject } from "../server/projects.js";
import {
  chainNote,
  chainReason,
  numberRanges,
  storedImplements,
  storedWaitsFor,
  storyReasons,
  uncoveredStories,
  userStories,
  validateTicketSet,
} from "../server/tickets.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  projectContextFor,
  failIfTurnInProgress,
  MAX_TURN_RETRIES,
  runTurn,
  TurnRejected,
} from "../server/turn.js";
import listTickets from "./list-tickets.js";

export default defineAction({
  description:
    "Break the session's current spec into implementation tickets, replacing any tickets already on the session. Allowed only for a confirmed session with a current spec and no turn already working. Refuses to replace tickets that carry a build record unless `force` is set, since replacing a ticket cascades to delete its build record.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    force: z
      .boolean()
      .default(false)
      .describe(
        "Replace the session's tickets even though doing so would delete a build record",
      ),
  }),
  run: async ({ sessionId, force }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before breaking the spec into tickets.",
    );

    if (session.state !== "confirmed") {
      fail(
        `Only a confirmed session can be broken into tickets. This session is ${session.state}.`,
        { errorCode: "not-confirmed", statusCode: 409 },
      );
    }

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    if (!spec) {
      fail(
        "This session has no spec yet. Synthesize one before breaking it into tickets.",
        { errorCode: "spec-missing", statusCode: 409 },
      );
    }

    if (!spec.current) {
      fail(
        "The spec is out of date with the design tree. Regenerate it before breaking it into tickets.",
        { errorCode: "spec-not-current", statusCode: 409 },
      );
    }

    const existingTickets = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId));

    if (existingTickets.length > 0 && !force) {
      const buildRecordRows = await db
        .select()
        .from(schema.buildRecords)
        .where(
          inArray(
            schema.buildRecords.ticketId,
            existingTickets.map((ticket) => ticket.id),
          ),
        );

      if (buildRecordRows.length > 0) {
        fail(
          `Replacing this session's tickets would delete ${buildRecordRows.length} build record${buildRecordRows.length === 1 ? "" : "s"}. Pass force to replace them anyway.`,
          {
            errorCode: "build-records-exist",
            statusCode: 409,
            details: { buildRecordCount: buildRecordRows.length },
          },
        );
      }
    }

    // The consistency check that follows an accepted breakdown runs inside
    // its turn, but its failure (or its skip above the ticket cap) can only
    // be stored once `runTurn` has written the breakdown's own result: the
    // success path clears the session's error fields after `take` returns.
    let consistencyFailure: ConsistencyFailure | null = null;

    await runTurn({
      sessionId,
      failedMessage: "The interviewer turn failed.",
      record: { turnKind: "break-into-tickets", model: session!.model },
      take: async (recorder) => {
        const rows = await db
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.sessionId, sessionId))
          // `createdAt` has millisecond precision; id as a final tie-break
          // keeps ticket generation input order deterministic when two
          // decisions land in the same millisecond.
          .orderBy(schema.decisions.createdAt, schema.decisions.id);

        // A repository with no commits has no verify command yet: ticket 1
        // sets it up and every other ticket waits for it. Measured once per
        // breakdown, so every retry is judged against the same answer.
        const project = session!.projectId ? await getProject(session!.projectId) : undefined;
        const verifyCommand = project?.verifyCommand ?? null;
        const greenfield = project ? (await headCommit(project.rootPath)) === null : false;
        // The tracked files let the tickets name what they touch. The
        // breakdown still runs without them when collecting fails.
        const trackedFiles = project
          ? await collectHandoffFactPack(project.rootPath, {
              excludeFolder: session!.lastExportFolder ?? undefined,
            }).then(
              (pack) => ({ files: pack.trackedFiles, omitted: pack.trackedFilesOmitted }),
              () => null,
            )
          : null;
        // The spec's numbered user stories, read once so every retry is
        // judged against the same list. None skips the story check.
        const stories = userStories(spec!.markdown).map((story) => story.number);

        const interviewer = getInterviewer();
        let attemptsAsked = 0;
        // A long chain is sent back at most once per breakdown, and never on
        // the last attempt: after that it is accepted and noted below.
        let chainSentBack = false;

        const accepted = await askUntilAccepted<BreakIntoTicketsResult>({
          conversationId: session!.conversationId,
          recorder,
          ask: async ({ conversationId, rejectionReason, observer }) => {
            attemptsAsked += 1;
            return interviewer.breakIntoTickets(
              {
                kind: "break-into-tickets",
                context: {
                  sessionId: session!.id,
                  idea: session!.idea,
                  title: session!.title,
                  model: session!.model,
                  answeringMode: session!.answeringMode,
                  docsFolder: session!.docsFolder,
                  conversationId,
                  decisions: await decisionSnapshots(rows),
                  projectContext: await projectContextFor(session!),
                },
                specMarkdown: spec!.markdown,
                greenfield,
                verifyCommand,
                trackedFiles,
                userStories: stories,
                rejectionReason,
              },
              observer,
            );
          },
          // On the last attempt, stories no ticket cites no longer refuse the
          // set: it is accepted and the gap noted below. Every other reason
          // still refuses it. A long chain is soft in the same way, and is
          // sent back only once.
          reasonsToRefuse: (result) => {
            const reasons = [
              ...validateTicketSet(
                result.tickets,
                greenfield && verifyCommand !== null ? { verifyCommand } : null,
              ).reasons,
              ...storyReasons(result.tickets, stories, {
                lastAttempt: attemptsAsked > MAX_TURN_RETRIES,
              }),
            ];
            const chain = chainReason(result.tickets);
            if (chain !== null && !chainSentBack && attemptsAsked <= MAX_TURN_RETRIES) {
              reasons.push(chain);
              chainSentBack = true;
            }
            return reasons;
          },
          exhausted: (lastReason) =>
            new TurnRejected(
              "invalid-tickets",
              `The interviewer proposed a ticket breakdown that does not validate ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
            ),
        });

        const uncovered = uncoveredStories(
          accepted.result.tickets,
          stories.map((number) => ({ number })),
        ).map((story) => story.number);
        // `noted` keeps only its last note, so both go in one call.
        const notes: string[] = [];
        if (uncovered.length > 0) {
          notes.push(
            `Accepted after the last retry, with ${uncovered.length === 1 ? "user story" : "user stories"} ${numberRanges(uncovered)} in no ticket's implements.`,
          );
        }
        const chain = chainNote(accepted.result.tickets);
        if (chain !== null) notes.push(chain);
        if (notes.length > 0) await recorder?.noted(notes.join(" "));

        const now = new Date().toISOString();
        const idByNumber = new Map(
          accepted.result.tickets.map((ticket) => [ticket.number, randomUUID()]),
        );

        // Cascades to the build records of the tickets being replaced; the
        // check above already refused this unless force was passed or there
        // was nothing to lose.
        await db.delete(schema.tickets).where(eq(schema.tickets.sessionId, sessionId));

        await db.insert(schema.tickets).values(
          accepted.result.tickets.map((ticket) => ({
            id: idByNumber.get(ticket.number) as string,
            sessionId,
            number: ticket.number,
            slug: ticket.slug,
            title: ticket.title,
            body: ticket.body,
            status: "ready" as const,
            kind: ticket.kind,
            waitsFor: ticket.kind === "gate" ? storedWaitsFor(ticket) : null,
            implementsJson: JSON.stringify(
              stories.length === 0 ? [] : storedImplements(ticket.implements),
            ),
            blockedByJson: JSON.stringify(
              ticket.blockedBy.flatMap((number) => {
                const id = idByNumber.get(number);
                return id ? [id] : [];
              }),
            ),
            createdAt: now,
            updatedAt: now,
          })),
        );

        await db
          .update(schema.specs)
          .set({
            ticketsGeneratedAt: now,
            ticketsTurnId: recorder?.turnId ?? null,
            // The check below is attempted or skipped for this breakdown,
            // whatever it then does: "checked, but not these tickets".
            consistencyAttemptedFor: now,
          })
          .where(eq(schema.specs.sessionId, sessionId));

        // One check covers at most as many tickets as the handoff scout
        // grounds; above that it is skipped, not attempted.
        const ticketCount = accepted.result.tickets.length;
        consistencyFailure =
          ticketCount > MAX_HANDOFF_SCOUT_TICKETS
            ? {
                code: "too-many-tickets",
                message: tooManyTicketsMessage(ticketCount, MAX_HANDOFF_SCOUT_TICKETS, true),
              }
            : (await checkConsistencyForBreakdown({ session: session! })).failure;

        return accepted.conversationId;
      },
    });

    // The tickets stay and the status stays `idle`: the error only says why
    // the reopen cards were not refreshed.
    const failure = consistencyFailure as ConsistencyFailure | null;
    if (failure) {
      await db
        .update(schema.sessions)
        .set({
          turnErrorCode: failure.code,
          turnErrorMessage: failure.message,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.sessions.id, sessionId));
    }

    return listTickets.run({ sessionId });
  },
});
