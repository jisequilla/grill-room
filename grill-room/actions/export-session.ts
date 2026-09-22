import fs from "node:fs/promises";
import path from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { planExport } from "../server/export.js";
import { describeTickets, ticketsAreCurrent } from "../server/tickets.js";

const NO_TICKETS_REASON = "This session has no tickets to export.";
const STALE_TICKETS_REASON =
  "The session's tickets are out of date with its spec and were not exported.";

export default defineAction({
  description:
    "Export a session's current spec — and its tickets, when they are current — into its export target folder using the local-markdown tracker layout: <target>/.scratch/<feature-slug>/spec.md plus one numbered file per ticket under issues/. Refuses to overwrite existing files unless `overwrite` is set.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    overwrite: z
      .boolean()
      .default(false)
      .describe("Replace files the export would otherwise refuse to overwrite"),
  }),
  run: async ({ sessionId, overwrite }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    if (!session.exportTargetFolder) {
      fail(
        "This session has no export target folder set. Set one before exporting.",
        { errorCode: "no-export-target", statusCode: 409 },
      );
    }

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    if (!spec) {
      fail("This session has no spec yet. Synthesize one before exporting.", {
        errorCode: "spec-missing",
        statusCode: 409,
      });
    }

    if (!spec.current) {
      fail(
        "The spec is out of date with the design tree. Regenerate it before exporting.",
        { errorCode: "spec-not-current", statusCode: 409 },
      );
    }

    const targetFolder = session.exportTargetFolder;

    let targetStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      targetStat = await fs.stat(targetFolder);
    } catch {
      fail(`The export target folder does not exist: ${targetFolder}`, {
        errorCode: "target-not-found",
        statusCode: 400,
      });
    }

    if (!targetStat.isDirectory()) {
      fail(`The export target is not a directory: ${targetFolder}`, {
        errorCode: "target-not-directory",
        statusCode: 400,
      });
    }

    try {
      await fs.access(targetFolder, fs.constants.W_OK);
    } catch {
      fail(`The export target folder is not writable: ${targetFolder}`, {
        errorCode: "target-not-writable",
        statusCode: 400,
      });
    }

    const ticketRows = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId))
      .orderBy(schema.tickets.number);

    let ticketsExported = false;
    let ticketsSkippedReason: string | null = null;
    let exportTickets: ReturnType<typeof describeTickets> = [];

    if (ticketRows.length === 0) {
      ticketsSkippedReason = NO_TICKETS_REASON;
    } else if (!ticketsAreCurrent(spec)) {
      ticketsSkippedReason = STALE_TICKETS_REASON;
    } else {
      ticketsExported = true;
      exportTickets = describeTickets(ticketRows);
    }

    const plan = planExport({
      sessionTitle: session.title,
      sessionId: session.id,
      specMarkdown: spec.markdown,
      tickets: exportTickets,
    });

    const featureDir = path.resolve(targetFolder, ".scratch", plan.featureSlug);

    const resolvedFiles = plan.files.map((file) => {
      const absolutePath = path.resolve(featureDir, file.relativePath);
      const withinFeatureDir =
        absolutePath === featureDir || absolutePath.startsWith(featureDir + path.sep);

      if (!withinFeatureDir) {
        fail(
          `Refusing to export: a planned file would land outside the feature directory: ${file.relativePath}`,
          { errorCode: "path-escape", statusCode: 500 },
        );
      }

      return { absolutePath, content: file.content };
    });

    const existing: string[] = [];
    for (const file of resolvedFiles) {
      try {
        await fs.access(file.absolutePath);
        existing.push(file.absolutePath);
      } catch {
        // Does not exist yet — nothing to guard.
      }
    }

    if (existing.length > 0 && !overwrite) {
      fail(
        `Export would overwrite ${existing.length} existing file${existing.length === 1 ? "" : "s"}. Pass overwrite to replace them.`,
        {
          errorCode: "files-exist",
          statusCode: 409,
          details: { existing },
        },
      );
    }

    const written: string[] = [];
    for (const file of resolvedFiles) {
      await fs.mkdir(path.dirname(file.absolutePath), { recursive: true });
      await fs.writeFile(file.absolutePath, file.content, "utf8");
      written.push(file.absolutePath);
    }

    return {
      folder: targetFolder,
      files: written,
      ticketsExported,
      ticketsSkippedReason,
    };
  },
});
