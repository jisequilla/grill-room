import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { currentBriefGrounding } from "../server/brief-grounding.js";
import { getDb, schema } from "../server/db/index.js";
import {
  DELEGATION_SLOTS,
  parseDelegationProposals,
  pendingForProject,
  serializeDelegationProposals,
} from "../server/delegation-values.js";
import { failWithProjectRefusal } from "../server/project-refusal.js";
import { getProject, setDelegationDecision } from "../server/projects.js";

export default defineAction({
  description:
    "Dismiss one delegation value the session's grounding proposes for its project: the exact proposal is recorded as dismissed for that slot, replacing an earlier dismissal, and stops being pending; a different proposal for the slot later is pending again. The project's confirmed values and tickets in flight are untouched. The slot must be among the pending proposals, the ones `preview-export` lists as `delegationProposals`; otherwise it is refused with no-pending-proposal (409) and nothing is written. Like any project setting edit, this changes the handoff fingerprint. Returns the project and the recomputed pending proposals.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slot: z.enum(DELEGATION_SLOTS).describe("The delegation slot whose proposal to dismiss"),
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
      fail("This session has no project to dismiss a delegation proposal for. Choose a project first.", {
        errorCode: "no-project",
        statusCode: 409,
      });
    }

    const grounding = await currentBriefGrounding(sessionId);
    const proposed = grounding?.result.delegationProposals;
    const entry = pendingForProject(project, proposed).find((pending) => pending.slot === slot);
    if (!entry) {
      fail(`The ${slot} slot has no pending proposal to dismiss.`, {
        errorCode: "no-pending-proposal",
        statusCode: 409,
      });
    }

    const dismissed = parseDelegationProposals(project.delegationProposalsJson);
    Object.assign(dismissed, { [slot]: entry.proposal });

    const outcome = await setDelegationDecision(project.id, {
      delegationProposalsJson: serializeDelegationProposals(dismissed),
    });
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);

    return {
      project: outcome.project,
      pendingProposals: pendingForProject(outcome.project, proposed),
    };
  },
});
