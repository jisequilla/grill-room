import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { SESSION_ANSWERING_MODES, SESSION_MODELS } from "../server/db/schema.js";
import getDefaultModel from "./get-default-model.js";
import { resolveDocsFolder } from "./set-docs-folder.js";

export default defineAction({
  description:
    "Start a new grilling session from a loose idea. The interviewer model defaults to the global default model when omitted.",
  schema: z.object({
    title: z
      .string()
      .min(1)
      .describe("Short title to tell sessions apart in a list"),
    idea: z.string().min(1).describe("The original loose idea to grill"),
    model: z
      .enum(SESSION_MODELS)
      .optional()
      .describe(
        "Interviewer model for this session; defaults to the global default model",
      ),
    answeringMode: z
      .enum(SESSION_ANSWERING_MODES)
      .optional()
      .default("whole-round")
      .describe("Whether rounds are answered all at once or one at a time"),
    docsFolder: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Absolute path to an existing folder the interviewer may read while grilling; omit for the tool-less interview",
      ),
  }),
  run: async ({ title, idea, model, answeringMode, docsFolder }) => {
    const resolvedModel = model ?? (await getDefaultModel.run({})).model;

    let resolvedDocsFolder: string | null = null;
    if (docsFolder !== undefined) {
      const outcome = resolveDocsFolder(docsFolder);
      if ("refusal" in outcome) {
        fail(outcome.refusal.message, {
          errorCode: outcome.refusal.errorCode,
          statusCode: 400,
        });
      }
      resolvedDocsFolder = outcome.folder;
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const [row] = await getDb()
      .insert(schema.sessions)
      .values({
        id,
        title,
        idea,
        model: resolvedModel,
        answeringMode,
        docsFolder: resolvedDocsFolder,
        state: "interviewing",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return row;
  },
});
