import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { setScoutProposalDisposition } from "../server/scout-report.js";
import { loadRepoProposal } from "./keep-repo-decision.js";

export default defineAction({
  description:
    "Drop one decision the session's scout report proposes: the report records it as dropped and nothing enters the design tree. A dropped proposal still reaches every interviewer turn as project context, unenforced. Allowed while the session is interviewing and no turn is working. Refused with no-scout-report, proposal-not-found for a key the report does not propose, already-kept for a proposal already in the tree (reopen that decision instead), wrong-session-state, or turn-working. Returns the report's dispositions.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    key: z.string().min(1).describe("The proposed repo decision's key"),
  }),
  run: async ({ sessionId, key }) => {
    const { report } = await loadRepoProposal({
      sessionId,
      key,
      verb: "dropped",
    });

    // A kept proposal is a settled decision others may already depend on.
    // Taking it back out of the tree is a reopen, not a drop.
    if (report.dispositions[key] === "kept") {
      fail(
        `The repo decision "${key}" is already kept in the design tree. Reopen it to change it.`,
        { errorCode: "already-kept", statusCode: 409 },
      );
    }

    const dispositions = await setScoutProposalDisposition(
      report.id,
      key,
      "dropped",
    );

    return {
      sessionId,
      key,
      dispositions: dispositions ?? { ...report.dispositions, [key]: "dropped" },
    };
  },
});
