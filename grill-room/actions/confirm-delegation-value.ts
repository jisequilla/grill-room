import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { currentBriefGrounding } from "../server/brief-grounding.js";
import { getDb, schema } from "../server/db/index.js";
import {
  DELEGATION_SLOTS,
  parseDelegationProposals,
  parseDelegationValues,
  pendingForProject,
  serializeDelegationProposals,
  serializeDelegationValues,
} from "../server/delegation-values.js";
import { failWithProjectRefusal } from "../server/project-refusal.js";
import { getProject, setDelegationDecision } from "../server/projects.js";

export default defineAction({
  description:
    "Confirm one delegation value the session's grounding proposes for its project: the proposal becomes the project's confirmed value for that slot (the in-flight cap also sets the project's tickets in flight), and any dismissal of that slot is removed. The slot must be among the pending proposals, the ones `preview-export` lists as `delegationProposals`; otherwise it is refused with no-pending-proposal (409) and nothing is written. Like any project setting edit, this changes the handoff fingerprint, so the handoff reads as stale until regenerated. Returns the project and the recomputed pending proposals.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slot: z.enum(DELEGATION_SLOTS).describe("The delegation slot to confirm"),
  }),
  run: async ({ sessionId, slot }) => {
    const [session] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const project = session.projectId ? await getProject(session.projectId) : undefined;
    if (!project) {
      fail("This session has no project to confirm a delegation value for. Choose a project first.", {
        errorCode: "no-project",
        statusCode: 409,
      });
    }

    const grounding = await currentBriefGrounding(sessionId);
    const proposed = grounding?.result.delegationProposals;
    const entry = pendingForProject(project, proposed).find((pending) => pending.slot === slot);
    if (!entry) {
      fail(`The ${slot} slot has no pending proposal to confirm.`, {
        errorCode: "no-pending-proposal",
        statusCode: 409,
      });
    }

    const values = parseDelegationValues(project.delegationValuesJson);
    const dismissed = parseDelegationProposals(project.delegationProposalsJson);
    delete dismissed[slot];

    let maxTicketsInFlight: number | undefined;
    switch (entry.slot) {
      case "maxTicketsInFlight":
        values.maxTicketsInFlight = { citation: entry.proposal.citation };
        maxTicketsInFlight = entry.proposal.value;
        break;
      case "pruneCommand":
        values.pruneCommand = { command: entry.proposal.command, citation: entry.proposal.citation };
        break;
      case "reviewRule":
        values.reviewRule = { citation: entry.proposal.citation };
        break;
      case "preflight":
        values.preflight = { citation: entry.proposal.citation };
        break;
    }

    const outcome = await setDelegationDecision(project.id, {
      delegationValuesJson: serializeDelegationValues(values),
      delegationProposalsJson: serializeDelegationProposals(dismissed),
      ...(maxTicketsInFlight === undefined ? {} : { maxTicketsInFlight }),
    });
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);

    return {
      project: outcome.project,
      pendingProposals: pendingForProject(outcome.project, proposed),
    };
  },
});
