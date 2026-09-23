import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { failWithProjectRefusal } from "../server/project-refusal.js";
import { updateProject } from "../server/projects.js";
import {
  PROJECT_TRACKER_KINDS,
  PROJECT_VISIBILITIES,
} from "../shared/session-constants.js";

export default defineAction({
  description:
    "Edit a registered project. Omitted fields keep their value; the result is validated exactly as registration validates it, including resolving a changed root to its git top-level. The visibility flag changes only when given.",
  schema: z.object({
    id: z.string().min(1).describe("Project id"),
    root: z
      .string()
      .min(1)
      .optional()
      .describe("Absolute path to any folder inside the repository"),
    verifyCommand: z.string().optional().describe("The repository's verify command"),
    exportFolder: z
      .string()
      .optional()
      .describe("Where exports land, relative to the repository root"),
    name: z.string().optional().describe("Display name"),
    slugPattern: z.string().optional().describe("Folder name pattern with placeholders"),
    trackerKind: z
      .enum(PROJECT_TRACKER_KINDS)
      .optional()
      .describe('"beads" or "markdown"'),
    buildRecordLogging: z
      .boolean()
      .optional()
      .describe("Whether handoffs instruct logging build records"),
    visibility: z
      .enum(PROJECT_VISIBILITIES)
      .optional()
      .describe('Whether the export folder is "tracked" or "ignored" by git'),
  }),
  run: async ({ id, ...patch }) => {
    const outcome = await updateProject(id, patch);
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);
    return outcome.project;
  },
});
