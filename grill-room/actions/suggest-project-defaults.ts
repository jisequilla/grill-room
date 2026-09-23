import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { failWithProjectRefusal } from "../server/project-refusal.js";
import { inspectProjectFolder } from "../server/projects.js";

export default defineAction({
  description:
    "What registering a folder would detect, without registering it: the git root it resolves to, a default name, a verify command suggested from the repository's justfile, package.json or Makefile, an export folder and slug pattern suggested from a declared tracker block when the repository has a valid one, and — given an export folder — the visibility git check-ignore seeds for it. Refuses a folder outside any git repository.",
  schema: z.object({
    folder: z
      .string()
      .min(1)
      .describe("Absolute path to any folder inside the repository"),
    exportFolder: z
      .string()
      .optional()
      .describe("Export folder relative to the root, to seed visibility for"),
  }),
  http: { method: "GET" },
  run: async ({ folder, exportFolder }) => {
    const outcome = await inspectProjectFolder(folder, exportFolder);
    if ("refusal" in outcome) failWithProjectRefusal(outcome.refusal);
    return outcome;
  },
});
