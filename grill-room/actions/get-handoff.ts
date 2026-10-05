import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getProject, recipeRemoteWarning, hasGitRemote } from "../server/projects.js";
import { describeHandoff, getHandoffRow, loadHandoffSource } from "../server/handoff.js";

export default defineAction({
  description:
    "Read a session's handoff: HANDOFF.md and one brief per ticket (bundle paths written as {{BUNDLE}} and {{DOCS}}, filled in at export), or null when none has been generated. Carries `stale` (the session, spec, tickets or project changed since it was generated, per a fingerprint over everything it renders), `exportStale` (edited or regenerated after the last export that included it), `handoffEdited` (HANDOFF.md differs from the text Grill Room generated), `editedBriefs` (ticket numbers of hand-edited briefs), `outdatedBriefs` (edited briefs whose ticket is gone or whose fresh render changed since: review them, then save to mark them reviewed), and `canGenerate` with the reason generation is refused when it is not possible. Carries `recipeWarning`, `pull-request-without-remote` when the session's project delivers by pull request but its repository has no remote (reported with or without a handoff), otherwise null.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const [session] = await getDb()
      .select({ id: schema.sessions.id, projectId: schema.sessions.projectId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const loaded = await loadHandoffSource(sessionId);
    const row = await getHandoffRow(sessionId);

    const project = session.projectId ? await getProject(session.projectId) : null;
    const recipeWarning = project
      ? recipeRemoteWarning(project.deliveryRecipe, await hasGitRemote(project.rootPath))
      : null;

    return {
      handoff: row ? describeHandoff(row, "source" in loaded ? loaded.source : null) : null,
      canGenerate: "source" in loaded,
      cannotGenerateReason: "refusal" in loaded ? loaded.refusal : null,
      recipeWarning,
    };
  },
});
