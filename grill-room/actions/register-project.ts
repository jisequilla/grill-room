import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { failWithProjectRefusal } from "../server/project-refusal.js";
import { registerProject } from "../server/projects.js";
import {
  PROJECT_TRACKER_KINDS,
  PROJECT_VISIBILITIES,
} from "../shared/session-constants.js";

export default defineAction({
  description:
    "Register a project sessions export into. The root is resolved to its git top-level and a folder outside any git repository is refused. Root, verify command and export folder are required; the visibility flag is seeded from git check-ignore on the export folder unless given.",
  schema: z.object({
    root: z
      .string()
      .min(1)
      .describe("Absolute path to any folder inside the repository; a leading ~ is expanded"),
    verifyCommand: z
      .string()
      .min(1)
      .describe("The command that verifies a change in this repository, e.g. 'pnpm test'"),
    exportFolder: z
      .string()
      .min(1)
      .describe("Where exports land, relative to the repository root, e.g. '.scratch'"),
    name: z
      .string()
      .optional()
      .describe("Display name; defaults to the root folder's name"),
    slugPattern: z
      .string()
      .optional()
      .describe("Folder name pattern with placeholders; defaults to '{slug}'"),
    trackerKind: z
      .enum(PROJECT_TRACKER_KINDS)
      .optional()
      .describe('How the repository tracks tickets: "beads" or "markdown"; defaults to "markdown"'),
    buildRecordLogging: z
      .boolean()
      .optional()
      .describe("Whether handoffs instruct logging build records; defaults to false"),
    visibility: z
      .enum(PROJECT_VISIBILITIES)
      .optional()
      .describe('Whether the export folder is "tracked" or "ignored" by git; seeded from git check-ignore when omitted'),
  }),
  run: async (input) => {
    const outcome = await registerProject(input);
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);
    return outcome.project;
  },
});
