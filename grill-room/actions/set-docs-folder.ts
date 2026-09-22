import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/**
 * The docs folder is the one place the app points the model at the user's own
 * filesystem, so it is validated harder than the export target. The export
 * target is somewhere the app writes on the user's instruction; this is
 * somewhere a model reads on its own initiative, and a folder chosen too wide
 * hands it everything underneath — including this app's own `.env`.
 */

/** `~` alone, or `~/...`, expands to the user's home directory. Nothing else about `~` is special-cased. */
function expandHome(folder: string): string {
  if (folder === "~") return os.homedir();
  if (folder.startsWith("~/")) return path.join(os.homedir(), folder.slice(2));
  return folder;
}

/** Where this app's own files live: the two ways the running server can name itself. */
function appDirectories(): string[] {
  return [
    path.resolve(fileURLToPath(new URL("..", import.meta.url))),
    path.resolve(process.cwd()),
  ];
}

/** True when `folder` is `inner` or one of its ancestors. */
function contains(folder: string, inner: string): boolean {
  return inner === folder || inner.startsWith(`${folder}${path.sep}`);
}

export interface DocsFolderRefusal {
  errorCode: string;
  message: string;
}

/**
 * Resolves a user-supplied docs folder to the absolute path to store, or
 * returns the reason it is refused. Shared with `create-session`, which accepts
 * the same folder at the moment a session is started.
 */
export function resolveDocsFolder(
  folder: string,
): { folder: string } | { refusal: DocsFolderRefusal } {
  const expanded = expandHome(folder);

  if (!path.isAbsolute(expanded)) {
    return {
      refusal: {
        errorCode: "folder-not-absolute",
        message: `The docs folder must be an absolute path: ${folder}`,
      },
    };
  }

  const resolved = path.resolve(expanded);

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    return {
      refusal: {
        errorCode: "folder-not-found",
        message: `The docs folder does not exist: ${resolved}`,
      },
    };
  }

  if (!stats.isDirectory()) {
    return {
      refusal: {
        errorCode: "folder-not-directory",
        message: `The docs folder is not a directory: ${resolved}`,
      },
    };
  }

  if (resolved === path.parse(resolved).root) {
    return {
      refusal: {
        errorCode: "folder-is-root",
        message:
          "The docs folder cannot be the filesystem root: the interviewer would be able to read the whole machine.",
      },
    };
  }

  if (resolved === path.resolve(os.homedir())) {
    return {
      refusal: {
        errorCode: "folder-is-home",
        message:
          "The docs folder cannot be your home directory: point it at the project or docs folder the interview is about.",
      },
    };
  }

  if (appDirectories().some((app) => contains(resolved, app))) {
    return {
      refusal: {
        errorCode: "folder-contains-app",
        message:
          "The docs folder contains Grill Room itself, which would let the interviewer read the app's own configuration and secrets.",
      },
    };
  }

  return { folder: resolved };
}

export default defineAction({
  description:
    "Set the read-only folder the interviewer may read while grilling this session, or clear it with null. Must be an existing directory, given as an absolute path.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    folder: z
      .string()
      .min(1)
      .nullable()
      .describe(
        "Absolute path to an existing folder the interviewer may read; a leading ~ is expanded. Null clears it.",
      ),
  }),
  run: async ({ sessionId, folder }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    let docsFolder: string | null = null;
    if (folder !== null) {
      const outcome = resolveDocsFolder(folder);
      if ("refusal" in outcome) {
        fail(outcome.refusal.message, {
          errorCode: outcome.refusal.errorCode,
          statusCode: 400,
        });
      }
      docsFolder = outcome.folder;
    }

    const [row] = await db
      .update(schema.sessions)
      .set({ docsFolder, updatedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId))
      .returning();

    return row;
  },
});
