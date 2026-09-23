import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { failWithProjectRefusal } from "../server/project-refusal.js";
import { refreshProjectTracker } from "../server/projects.js";

export default defineAction({
  description:
    "Re-read a project's declared tracker (docs/agents/issue-tracker.md front matter). Always updates the stored tracker commands and diagnostic; updates the export folder and slug pattern only when the newly-read tracker is valid. Nothing else about the project changes, and this is the only action besides registration that re-reads the tracker file.",
  schema: z.object({
    id: z.string().min(1).describe("Project id"),
  }),
  run: async ({ id }) => {
    const outcome = await refreshProjectTracker(id);
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);
    return outcome.project;
  },
});
