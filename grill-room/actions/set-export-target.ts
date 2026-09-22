import os from "node:os";
import path from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/** `~` alone, or `~/...`, expands to the user's home directory. Nothing else about `~` is special-cased. */
function expandHome(folder: string): string {
  if (folder === "~") return os.homedir();
  if (folder.startsWith("~/")) return path.join(os.homedir(), folder.slice(2));
  return folder;
}

export default defineAction({
  description:
    "Set the folder a session exports its spec and tickets into. Must be an absolute path; it does not need to exist yet.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    folder: z
      .string()
      .min(1)
      .describe("Absolute path to the export target folder; a leading ~ is expanded to the home directory"),
  }),
  run: async ({ sessionId, folder }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const expanded = expandHome(folder);

    if (!path.isAbsolute(expanded)) {
      fail(`The export target folder must be an absolute path: ${folder}`, {
        errorCode: "folder-not-absolute",
        statusCode: 400,
      });
    }

    const [row] = await db
      .update(schema.sessions)
      .set({
        exportTargetFolder: path.resolve(expanded),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, sessionId))
      .returning();

    return row;
  },
});
