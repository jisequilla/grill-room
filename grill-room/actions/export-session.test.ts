import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { storeBriefGrounding } from "../server/brief-grounding.js";
import { planExportBundle } from "../server/export-bundle.js";
import { EXPORT_MANIFEST_FILE, formatLocalDate, hashExportContent } from "../server/export.js";
import {
  bundlePathFor,
  fillBundlePath,
  FILE_BOUNDARIES_SLOT,
  handoffFingerprint,
  loadHandoffSource,
  renderBrief,
} from "../server/handoff.js";
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
import { getProject } from "../server/projects.js";
import type { ProjectVisibility } from "../shared/session-constants.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import generateHandoff from "./generate-handoff.js";
import listTickets from "./list-tickets.js";
import previewExport from "./preview-export.js";
import registerProject from "./register-project.js";
import setTicketBlockedBy from "./set-ticket-blocked-by.js";
import updateHandoff from "./update-handoff.js";

const repos = useTempGitRepos();

const SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
].join("\n");

async function aProject(
  options: {
    workingExportFolder?: string;
    slugPattern?: string;
    files?: Record<string, string>;
    gitignore?: string;
    commit?: boolean;
    visibility?: ProjectVisibility;
  } = {},
) {
  const root = repos.create({ files: options.files, gitignore: options.gitignore, commit: options.commit });
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    workingExportFolder: options.workingExportFolder ?? ".scratch",
    slugPattern: options.slugPattern,
    visibility: options.visibility,
  });
  return { root, project };
}

async function aSession(title: string, projectId?: string) {
  return createSession.run({
    title,
    idea: "A local app that grills me about an idea until it is decided.",
    projectId,
  });
}

/**
 * `ticketsCurrent: true` sets `ticketsGeneratedAt` to the same timestamp as
 * `updatedAt`, so the spec's tickets are current by construction.
 */
async function insertSpec(
  sessionId: string,
  overrides: Partial<typeof schema.specs.$inferInsert> & { ticketsCurrent?: boolean } = {},
) {
  const { ticketsCurrent, ...rest } = overrides;
  const now = new Date().toISOString();
  const [row] = await getDb()
    .insert(schema.specs)
    .values({
      id: randomUUID(),
      sessionId,
      markdown: SPEC_MARKDOWN,
      current: true,
      ticketsGeneratedAt: ticketsCurrent ? now : null,
      createdAt: now,
      updatedAt: now,
      ...rest,
    })
    .returning();
  return row!;
}

async function insertTicket(
  sessionId: string,
  overrides: Partial<typeof schema.tickets.$inferInsert> & { number: number; slug: string },
) {
  const now = new Date().toISOString();
  const id = overrides.id ?? randomUUID();
  await getDb()
    .insert(schema.tickets)
    .values({
      sessionId,
      title: `Ticket ${overrides.number}`,
      body: `Do the work of ticket ${overrides.number}.`,
      status: "ready",
      blockedByJson: "[]",
      createdAt: now,
      updatedAt: now,
      ...overrides,
      id,
    });
  return id;
}

/** A confirmed-style session in a fresh project with a current spec and two tickets, 02 blocked by 01. */
async function aReadySession(
  options: {
    title?: string;
    workingExportFolder?: string;
    slugPattern?: string;
    files?: Record<string, string>;
    gitignore?: string;
    commit?: boolean;
    visibility?: ProjectVisibility;
  } = {},
) {
  const { root, project } = await aProject(options);
  const session = await aSession(options.title ?? "Grill Room", project.id);
  const blockerId = await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
  await insertTicket(session.id, {
    number: 2,
    slug: "store-on-disk",
    blockedByJson: JSON.stringify([blockerId]),
  });
  const spec = await insertSpec(session.id, { ticketsCurrent: true });
  return { root, project, session, spec };
}

async function ticketIdFor(sessionId: string, number: number): Promise<string> {
  const { tickets } = await listTickets.run({ sessionId });
  return tickets.find((ticket) => ticket.number === number)!.id;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(bundleDir: string) {
  return JSON.parse(await fs.readFile(path.join(bundleDir, EXPORT_MANIFEST_FILE), "utf8"));
}

/** The paths the bundle's manifest lists, in order. */
async function manifestPaths(bundleDir: string): Promise<string[]> {
  return (await readManifest(bundleDir)).files.map((file: { path: string }) => file.path);
}

/** Every file under `folder`, as absolute paths, not following symlinks. */
async function listFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(absolute)));
    else found.push(absolute);
  }
  return found.sort();
}

describe("preview-export and export-session", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(previewExport.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
    await expect(exportSession.run({ sessionId: "missing", slug: "x" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("refuses to preview or export a session without a project", async () => {
    const session = await aSession("Grill Room");
    await insertSpec(session.id);

    await expect(previewExport.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "no-project",
    });
    await expect(
      exportSession.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "no-project" });
  });

  it("refuses when the session has no spec, or the spec is not current", async () => {
    const { project } = await aProject();
    const noSpec = await aSession("No spec", project.id);
    await expect(previewExport.run({ sessionId: noSpec.id })).rejects.toMatchObject({
      errorCode: "spec-missing",
    });

    const stale = await aSession("Stale spec", project.id);
    await insertSpec(stale.id, { current: false });
    await expect(
      exportSession.run({ sessionId: stale.id, slug: "stale" }),
    ).rejects.toMatchObject({ errorCode: "spec-not-current" });
  });

  describe("export gate: a current handoff is required", () => {
    it("refuses to export without a handoff, writing nothing", async () => {
      const { root, session } = await aReadySession();

      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.exportBlocked).toBe(true);
      expect(preview.exportBlockedReason).toBe("handoff-missing");
      // Everything else in the preview still renders; only the gate blocks.
      expect(preview.files.length).toBeGreaterThan(0);

      await expect(
        exportSession.run({ sessionId: session.id, slug: "grill-room" }),
      ).rejects.toMatchObject({ errorCode: "handoff-missing" });
      expect(await pathExists(path.join(root, ".scratch"))).toBe(false);
    });

    it("refuses to export a stale handoff (e.g. after a blocker edit), writing nothing", async () => {
      const { root, session } = await aReadySession();
      await generateHandoff.run({ sessionId: session.id });

      // Removing ticket 2's blocker changes the handoff's fingerprint without
      // touching the spec's `ticketsGeneratedAt`.
      await setTicketBlockedBy.run({
        ticketId: await ticketIdFor(session.id, 2),
        blockedBy: [],
      });

      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.exportBlocked).toBe(true);
      expect(preview.exportBlockedReason).toBe("handoff-stale");

      await expect(
        exportSession.run({ sessionId: session.id, slug: "grill-room" }),
      ).rejects.toMatchObject({ errorCode: "handoff-stale" });
      expect(await pathExists(path.join(root, ".scratch"))).toBe(false);
    });

    it("succeeds once the handoff is regenerated", async () => {
      const { session } = await aReadySession();
      await generateHandoff.run({ sessionId: session.id });
      await setTicketBlockedBy.run({
        ticketId: await ticketIdFor(session.id, 2),
        blockedBy: [],
      });
      await generateHandoff.run({ sessionId: session.id });

      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.exportBlocked).toBe(false);
      expect(preview.exportBlockedReason).toBeNull();

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.handoffExported).toBe(true);
    });
  });

  it("previews without side effects, and writes exactly the files the preview listed", async () => {
    const { root, session } = await aReadySession({ workingExportFolder: "docs/features" });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    const bundleDir = path.join(root, "docs", "features", "grill-room");

    expect(preview).toMatchObject({
      projectRoot: root,
      workingExportFolder: "docs/features",
      proposedSlug: "grill-room",
      slug: "grill-room",
      folderName: "grill-room",
      bundleDir,
      bundleExists: false,
      removals: [],
      trackerDiagnostic: null,
      ticketsExported: true,
      exportBlocked: false,
      exportBlockedReason: null,
    });
    expect(preview.files).toEqual([
      path.join(bundleDir, "HANDOFF.md"),
      path.join(bundleDir, "spec.md"),
      path.join(bundleDir, "intent.md"),
      path.join(bundleDir, "issues", "01-build-the-workspace.md"),
      path.join(bundleDir, "issues", "02-store-on-disk.md"),
      path.join(bundleDir, "briefs", "01-build-the-workspace.md"),
      path.join(bundleDir, "briefs", "02-store-on-disk.md"),
      path.join(bundleDir, EXPORT_MANIFEST_FILE),
    ]);
    expect(await pathExists(path.join(root, "docs"))).toBe(false);

    const result = await exportSession.run({ sessionId: session.id, slug: preview.slug });

    expect(result.written).toEqual(preview.files);
    expect(result.bundleDir).toBe(bundleDir);
    expect(await listFiles(bundleDir)).toEqual([...preview.files].sort());
  });

  it("creates missing folders and lays the bundle out as spec.md plus issues/NN-slug.md", async () => {
    const { root, session, spec } = await aReadySession({ workingExportFolder: "a/b/c" });
    await generateHandoff.run({ sessionId: session.id });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, "a", "b", "c", "grill-room");
    expect(await fs.readFile(path.join(bundleDir, "spec.md"), "utf8")).toBe(
      `# Grill Room\n\nStatus: ready-for-agent\n\n${spec.markdown}`,
    );
    expect(
      await fs.readFile(path.join(bundleDir, "issues", "01-build-the-workspace.md"), "utf8"),
    ).toBe(
      "# 01 Ticket 1\n\nStatus: ready-for-agent\nBlocked by: none\n\nDo the work of ticket 1.",
    );
    expect(
      await fs.readFile(path.join(bundleDir, "issues", "02-store-on-disk.md"), "utf8"),
    ).toBe("# 02 Ticket 2\n\nStatus: ready-for-agent\nBlocked by: 01\n\nDo the work of ticket 2.");
    expect(await fs.readFile(path.join(bundleDir, "intent.md"), "utf8")).toBe(
      [
        "# Intent: Grill Room",
        "",
        "A local app that grills me about an idea until it is decided.",
        "",
        "## Readiness before the interview",
        "",
        "Not judged for this version of the idea.",
        "",
      ].join("\n"),
    );
    expect(await manifestPaths(bundleDir)).toEqual([
      "HANDOFF.md",
      "spec.md",
      "intent.md",
      "issues/01-build-the-workspace.md",
      "issues/02-store-on-disk.md",
      "briefs/01-build-the-workspace.md",
      "briefs/02-store-on-disk.md",
    ]);
  });

  it("proposes a slug of at most four title words, and uses an edited slug instead", async () => {
    const { root, session } = await aReadySession({
      title: "Export anywhere, and generate a handoff!",
    });
    await generateHandoff.run({ sessionId: session.id });

    const proposal = await previewExport.run({ sessionId: session.id });
    expect(proposal.proposedSlug).toBe("export-anywhere-and-generate");
    expect(proposal.folderName).toBe("export-anywhere-and-generate");

    const edited = await previewExport.run({ sessionId: session.id, slug: "  Handoff Bundle " });
    expect(edited.proposedSlug).toBe("export-anywhere-and-generate");
    expect(edited.slug).toBe("handoff-bundle");

    const result = await exportSession.run({ sessionId: session.id, slug: "  Handoff Bundle " });
    expect(result.bundleDir).toBe(path.join(root, ".scratch", "handoff-bundle"));
    expect(result.written).toEqual(edited.files);
  });

  it("falls back to a session-id slug when the title has no usable word", async () => {
    const { project } = await aProject();
    const session = await aSession("!!! *** ???", project.id);
    await insertSpec(session.id);

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.proposedSlug).toBe(`session-${session.id.slice(0, 8)}`);
  });

  it("refuses a slug that sanitizes to nothing, writing nothing", async () => {
    const { root, session } = await aReadySession();

    await expect(
      previewExport.run({ sessionId: session.id, slug: "!!!" }),
    ).rejects.toMatchObject({ errorCode: "invalid-slug" });
    await expect(
      exportSession.run({ sessionId: session.id, slug: " -- " }),
    ).rejects.toMatchObject({ errorCode: "invalid-slug" });
    expect(await pathExists(path.join(root, ".scratch"))).toBe(false);
  });

  it("applies a {date} pattern with the local date", async () => {
    const { root, session } = await aReadySession({ slugPattern: "{date}-{slug}" });
    await generateHandoff.run({ sessionId: session.id });

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const today = formatLocalDate(new Date());
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.folderName).toBe(`${today}-grill-room`);
    expect(result.bundleDir).toBe(path.join(root, ".scratch", `${today}-grill-room`));
  });

  it("applies a {seq} pattern as 01 when the export folder has no numbered folders", async () => {
    const { session } = await aReadySession({ slugPattern: "{seq}-{slug}" });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.folderName).toBe("01-grill-room");
  });

  it("applies a {seq} pattern as one past the highest numeric prefix among existing folders", async () => {
    const { root, session } = await aReadySession({
      slugPattern: "{seq}-{slug}",
      files: {
        ".scratch/03-older-feature/spec.md": "old",
        ".scratch/7-other/spec.md": "other",
        ".scratch/notes/readme.md": "not numbered",
        ".scratch/12-a-file.md": "a file, not a folder",
      },
    });
    await generateHandoff.run({ sessionId: session.id });

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    expect(result.folderName).toBe("08-grill-room");
    expect(result.bundleDir).toBe(path.join(root, ".scratch", "08-grill-room"));
  });

  it("re-exports a {seq} bundle into the folder it used before", async () => {
    const { session } = await aReadySession({
      slugPattern: "{seq}-{slug}",
      files: { ".scratch/04-older-feature/spec.md": "old" },
    });
    await generateHandoff.run({ sessionId: session.id });

    const first = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(first.folderName).toBe("05-grill-room");

    const again = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
    expect(again.folderName).toBe("05-grill-room");
    expect(again.bundleExists).toBe(true);
  });

  it("re-export removes a dropped ticket's file and brief, the preview's removals match, and hand-written files survive", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handWritten = [
      path.join(bundleDir, "notes.txt"),
      path.join(bundleDir, "issues", "99-notes.md"),
      path.join(bundleDir, "issues", "README.txt"),
      path.join(bundleDir, "extra.md"),
    ];
    for (const file of handWritten) await fs.writeFile(file, "written by hand");
    await fs.writeFile(path.join(bundleDir, "spec.md"), "stale content");

    await getDb()
      .delete(schema.tickets)
      .where(eq(schema.tickets.number, 2));
    // A dropped ticket changes the handoff's fingerprint; without regenerating
    // it, export would now refuse with `handoff-stale`.
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
    const dropped = path.join(bundleDir, "issues", "02-store-on-disk.md");
    const droppedBrief = path.join(bundleDir, "briefs", "02-store-on-disk.md");
    expect(preview.bundleExists).toBe(true);
    expect(preview.files).toContain(path.join(bundleDir, EXPORT_MANIFEST_FILE));
    expect(preview.removals).toEqual(expect.arrayContaining([dropped, droppedBrief]));
    expect(preview.removals).toHaveLength(2);

    const result = await exportSession.run({
      sessionId: session.id,
      slug: "grill-room",
      overridePaths: ["spec.md"],
    });

    expect(result.written).toEqual(preview.files);
    expect(result.removed).toEqual(preview.removals);
    expect(await pathExists(dropped)).toBe(false);
    expect(await pathExists(droppedBrief)).toBe(false);
    expect(await fs.readFile(path.join(bundleDir, "spec.md"), "utf8")).not.toBe("stale content");
    for (const file of handWritten) {
      expect(await fs.readFile(file, "utf8")).toBe("written by hand");
    }
    expect(await manifestPaths(bundleDir)).toEqual([
      "HANDOFF.md",
      "spec.md",
      "intent.md",
      "issues/01-build-the-workspace.md",
      "briefs/01-build-the-workspace.md",
    ]);
  });

  it("removes nothing from a bundle that has no manifest", async () => {
    const { root, session } = await aReadySession({
      files: {
        ".scratch/grill-room/issues/03-older-ticket.md": "from before manifests",
        ".scratch/grill-room/issues/99-notes.md": "written by hand",
      },
    });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
    expect(preview.bundleExists).toBe(true);
    expect(preview.removals).toEqual([]);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.removed).toEqual([]);

    const issues = path.join(root, ".scratch", "grill-room", "issues");
    expect(await pathExists(path.join(issues, "03-older-ticket.md"))).toBe(true);
    expect(await pathExists(path.join(issues, "99-notes.md"))).toBe(true);
  });

  it.each([
    ["unparseable JSON", "{ not json"],
    ["no files array", JSON.stringify({ version: 1 })],
    ["a non-string entry", JSON.stringify({ version: 1, files: ["issues/03-old.md", 7] })],
  ])("removes nothing when the manifest is malformed (%s)", async (_label, manifest) => {
    const { root, session } = await aReadySession({
      files: {
        [`.scratch/grill-room/${EXPORT_MANIFEST_FILE}`]: manifest,
        ".scratch/grill-room/issues/03-old.md": "listed by a broken manifest",
      },
    });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
    expect(preview.removals).toEqual([]);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.removed).toEqual([]);
    expect(
      await pathExists(path.join(root, ".scratch", "grill-room", "issues", "03-old.md")),
    ).toBe(true);
  });

  it("ignores manifest entries that climb out of the bundle", async () => {
    const { root, session } = await aReadySession({
      files: {
        [`.scratch/grill-room/${EXPORT_MANIFEST_FILE}`]: JSON.stringify({
          version: 1,
          files: ["../sibling.md", "../../README.md", path.join(os.tmpdir(), "x.md")],
        }),
        ".scratch/sibling.md": "outside the bundle",
      },
    });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
    expect(preview.removals).toEqual([]);

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(await pathExists(path.join(root, ".scratch", "sibling.md"))).toBe(true);
    expect(await pathExists(path.join(root, "README.md"))).toBe(true);
  });

  it("refuses to export a session with no tickets, since it can never have a handoff", async () => {
    const { project } = await aProject();

    const noTickets = await aSession("No tickets", project.id);
    await insertSpec(noTickets.id);

    const preview = await previewExport.run({ sessionId: noTickets.id, slug: "no-tickets" });
    expect(preview.exportBlocked).toBe(true);
    expect(preview.exportBlockedReason).toBe("handoff-missing");

    await expect(
      exportSession.run({ sessionId: noTickets.id, slug: "no-tickets" }),
    ).rejects.toMatchObject({ errorCode: "handoff-missing" });
    await expect(
      generateHandoff.run({ sessionId: noTickets.id }),
    ).rejects.toMatchObject({ errorCode: "no-tickets" });
  });

  it("exports the spec only, skipping tickets that are out of date, once the handoff is current", async () => {
    const { root, project } = await aProject();

    const staleTickets = await aSession("Stale tickets", project.id);
    await insertSpec(staleTickets.id, {
      updatedAt: "2030-01-02T00:00:00.000Z",
      ticketsGeneratedAt: "2030-01-01T00:00:00.000Z",
    });
    await insertTicket(staleTickets.id, { number: 1, slug: "stale-ticket" });
    // Generating a handoff only needs a spec and at least one ticket row; it
    // does not care whether the tickets are current with the spec, so it
    // succeeds here even though export will still skip the issue files below.
    await generateHandoff.run({ sessionId: staleTickets.id });

    const second = await exportSession.run({ sessionId: staleTickets.id, slug: "stale" });
    expect(second.ticketsExported).toBe(false);
    expect(second.ticketsSkippedReason).toMatch(/out of date/i);
    expect(second.written).toEqual([
      path.join(root, ".scratch", "stale", "HANDOFF.md"),
      path.join(root, ".scratch", "stale", "spec.md"),
      path.join(root, ".scratch", "stale", "intent.md"),
      path.join(root, ".scratch", "stale", "briefs", "01-stale-ticket.md"),
      path.join(root, ".scratch", "stale", EXPORT_MANIFEST_FILE),
    ]);
    expect(await pathExists(path.join(root, ".scratch", "stale", "issues"))).toBe(false);
  });

  it("shows the project's tracker diagnostic as a preview line", async () => {
    const { project, session } = await aReadySession();
    await getDb()
      .update(schema.projects)
      .set({ trackerDiagnostic: "Tracker block is missing the key: ticket_format" })
      .where(eq(schema.projects.id, project.id));

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.trackerDiagnostic).toBe("Tracker block is missing the key: ticket_format");
  });

  it("keeps a malicious ticket slug inside the bundle", async () => {
    const { root, project } = await aProject();
    const session = await aSession("Grill Room", project.id);
    await insertTicket(session.id, { number: 1, slug: "../../evil" });
    await insertSpec(session.id, { ticketsCurrent: true });
    await generateHandoff.run({ sessionId: session.id });

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    expect(result.written).toContain(path.join(bundleDir, "issues", "01-evil.md"));
    expect(result.written).toContain(path.join(bundleDir, "briefs", "01-evil.md"));
    for (const file of result.written) expect(file.startsWith(bundleDir + path.sep)).toBe(true);
    expect(await pathExists(path.join(root, "evil.md"))).toBe(false);
    expect(await pathExists(path.join(root, ".scratch", "evil.md"))).toBe(false);
  });

  it("refuses a symlinked export folder that points outside the project root, writing nothing", async () => {
    const outside = repos.plainFolder();
    const { root, session } = await aReadySession({ workingExportFolder: "exports" });
    await fs.symlink(outside, path.join(root, "exports"));

    await expect(previewExport.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "export-outside-root",
    });
    await expect(
      exportSession.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "export-outside-root" });

    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("refuses a symlinked issues folder inside the bundle that points outside the root", async () => {
    const outside = repos.plainFolder();
    const { root, session } = await aReadySession();
    const bundleDir = path.join(root, ".scratch", "grill-room");
    await fs.mkdir(bundleDir, { recursive: true });
    await fs.symlink(outside, path.join(bundleDir, "issues"));

    await expect(
      exportSession.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "export-outside-root" });

    expect(await fs.readdir(outside)).toEqual([]);
    expect(await pathExists(path.join(bundleDir, "spec.md"))).toBe(false);
  });

  it("refuses a dangling symlink on the way to the bundle", async () => {
    const outside = repos.plainFolder();
    const { root, session } = await aReadySession({ workingExportFolder: "exports" });
    await fs.symlink(path.join(outside, "not-yet"), path.join(root, "exports"));

    await expect(
      exportSession.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "export-outside-root" });

    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("accepts a symlinked export folder that stays inside the project root", async () => {
    const { root, session } = await aReadySession({ workingExportFolder: "exports" });
    await generateHandoff.run({ sessionId: session.id });
    await fs.mkdir(path.join(root, "real-exports"));
    await fs.symlink(path.join(root, "real-exports"), path.join(root, "exports"));

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    expect(await pathExists(path.join(root, "real-exports", "grill-room", "spec.md"))).toBe(true);
  });

  it("pads ticket numbers to three digits once there are 100 or more tickets", async () => {
    const { root, project } = await aProject();
    const session = await aSession("Grill Room", project.id);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.tickets)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          id: randomUUID(),
          sessionId: session.id,
          number: index + 1,
          slug: `ticket-${index + 1}`,
          title: `Ticket ${index + 1}`,
          body: "Body.",
          status: "ready" as const,
          blockedByJson: "[]",
          createdAt: now,
          updatedAt: now,
        })),
      );
    await insertSpec(session.id, { ticketsCurrent: true });
    await generateHandoff.run({ sessionId: session.id });

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    expect(result.written).toContain(path.join(bundleDir, "issues", "001-ticket-1.md"));
    expect(result.written).toContain(path.join(bundleDir, "issues", "100-ticket-100.md"));
    expect(result.written).toContain(path.join(bundleDir, "briefs", "001-ticket-1.md"));
    expect(result.written).toContain(path.join(bundleDir, "briefs", "100-ticket-100.md"));
    for (const file of result.written) expect(file.startsWith(root + path.sep)).toBe(true);
  });

  describe("post-export visibility report", () => {
    it("reports freshly written files as untracked when the repo has never seen them", async () => {
      const { root, session } = await aReadySession();
      await generateHandoff.run({ sessionId: session.id });

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      const bundleDir = path.join(root, ".scratch", "grill-room");
      expect(result.visibility.files).toEqual(
        result.written.map((file) => ({
          path: file,
          relativePath: path.relative(root, file).split(path.sep).join("/"),
          visibility: "untracked",
        })),
      );
      expect(result.visibility.hasUntracked).toBe(true);
      expect(result.visibility.hasIgnored).toBe(false);
      expect(result.visibility.warning).toMatch(/will not see/);
      expect(result.visibility.untrackedRemedy).toContain(
        `git -C ${root} add .scratch/grill-room`,
      );
      // The seeded flag ("tracked", since .scratch/ isn't gitignored here) matches: nothing is ignored.
      expect(result.visibility.mismatchWarning).toBeNull();
    });

    it("reports files under a gitignored export folder as ignored, with the check-ignore remedy", async () => {
      const { root, session } = await aReadySession({ files: { ".gitignore": ".scratch/\n" } });
      await generateHandoff.run({ sessionId: session.id });

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      expect(result.visibility.hasIgnored).toBe(true);
      expect(result.visibility.files.every((file) => file.visibility === "ignored")).toBe(true);
      expect(result.visibility.ignoredRemedy).toMatch(/cannot be committed/i);
      expect(result.visibility.ignoredRemedy).toContain(
        `git -C ${root} check-ignore -v .scratch/grill-room/spec.md`,
      );
      // The flag was seeded from check-ignore at registration, so it already says "ignored".
      expect(result.visibility.mismatchWarning).toBeNull();
    });

    it("warns when the project's visibility flag disagrees with the repository's real state", async () => {
      const root = repos.create({ files: { ".gitignore": ".scratch/\n" } });
      const project = await registerProject.run({
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
        visibility: "tracked",
      });
      const session = await aSession("Grill Room", project.id);
      await insertTicket(session.id, { number: 1, slug: "ticket-one" });
      await insertSpec(session.id, { ticketsCurrent: true });
      await generateHandoff.run({ sessionId: session.id });

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      expect(result.visibility.hasIgnored).toBe(true);
      expect(result.visibility.mismatchWarning).toContain("tracked");
      expect(result.visibility.mismatchWarning).toMatch(/ignored/);
    });

    it("reports no mismatch and no ignored/untracked files once the bundle is already tracked", async () => {
      const { root, session } = await aReadySession({
        files: {
          ".scratch/grill-room/HANDOFF.md": "old handoff",
          ".scratch/grill-room/spec.md": "old committed content",
          ".scratch/grill-room/intent.md": "old intent",
          ".scratch/grill-room/issues/01-build-the-workspace.md": "old",
          ".scratch/grill-room/issues/02-store-on-disk.md": "old",
          ".scratch/grill-room/briefs/01-build-the-workspace.md": "old brief",
          ".scratch/grill-room/briefs/02-store-on-disk.md": "old brief",
          [`.scratch/grill-room/${EXPORT_MANIFEST_FILE}`]: JSON.stringify({
            version: 1,
            files: [
              "HANDOFF.md",
              "spec.md",
              "intent.md",
              "issues/01-build-the-workspace.md",
              "issues/02-store-on-disk.md",
              "briefs/01-build-the-workspace.md",
              "briefs/02-store-on-disk.md",
            ],
          }),
        },
      });
      await generateHandoff.run({ sessionId: session.id });

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      expect(result.visibility.hasUntracked).toBe(false);
      expect(result.visibility.hasIgnored).toBe(false);
      expect(result.visibility.warning).toBeNull();
      expect(result.visibility.mismatchWarning).toBeNull();
      expect(root.length).toBeGreaterThan(0);
    });
  });

  describe("decisions.md", () => {
    async function insertDecision(
      sessionId: string,
      overrides: Partial<typeof schema.decisions.$inferInsert> & { key: string },
    ) {
      const now = new Date().toISOString();
      const [row] = await getDb()
        .insert(schema.decisions)
        .values({
          id: randomUUID(),
          sessionId,
          questionTitle: `Title of ${overrides.key}`,
          currentAnswer: `Answer of ${overrides.key}`,
          answerKind: "own-answer",
          settledAt: now,
          createdAt: now,
          updatedAt: now,
          ...overrides,
        })
        .returning();
      return row!;
    }

    async function storedFolder(sessionId: string): Promise<string | null> {
      const [row] = await getDb()
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));
      return row!.lastExportFolder;
    }

    it("is previewed beside the spec, written, and listed in the manifest", async () => {
      const { root, session } = await aReadySession();
      await insertDecision(session.id, { key: "storage" });
      await generateHandoff.run({ sessionId: session.id });

      const bundleDir = path.join(root, ".scratch", "grill-room");
      const decisionsPath = path.join(bundleDir, "decisions.md");
      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.files.slice(0, 4)).toEqual([
        path.join(bundleDir, "HANDOFF.md"),
        path.join(bundleDir, "spec.md"),
        path.join(bundleDir, "intent.md"),
        decisionsPath,
      ]);

      const result = await exportSession.run({ sessionId: session.id, slug: preview.slug });

      expect(result.written).toEqual(preview.files);
      expect(await fs.readFile(decisionsPath, "utf8")).toBe(
        [
          "# Decisions: Grill Room",
          "",
          "Generated by the Grill Room export from this session's settled design tree.",
          "",
          "## Decisions",
          "",
          '<a id="storage"></a>',
          "### Title of storage",
          "",
          "- **Decision:** Answer of storage",
          "- **Origin:** interviewer · own answer",
          "",
        ].join("\n"),
      );
      expect(await manifestPaths(bundleDir)).toContain("decisions.md");
    });

    it("is removed by a re-export that no longer plans it, and nothing else is", async () => {
      const { root, session } = await aReadySession();
      const decision = await insertDecision(session.id, { key: "storage" });
      await generateHandoff.run({ sessionId: session.id });
      const first = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      const bundleDir = path.join(root, ".scratch", "grill-room");
      const decisionsPath = path.join(bundleDir, "decisions.md");
      expect(await pathExists(decisionsPath)).toBe(true);

      // Only a kept repo decision remains: Built under alone plans no file.
      await getDb()
        .update(schema.decisions)
        .set({
          introducedBy: "repo",
          answerKind: "repo-established",
          repoSource: "recorded",
          repoCitation: "AGENTS.md:3",
          repoStatement: "Answer of storage",
        })
        .where(eq(schema.decisions.id, decision.id));

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(preview.files).not.toContain(decisionsPath);
      expect(preview.removals).toEqual([decisionsPath]);

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.removed).toEqual([decisionsPath]);
      expect(await pathExists(decisionsPath)).toBe(false);
      expect(result.written).toEqual(first.written.filter((file) => file !== decisionsPath));
      for (const file of result.written) expect(await pathExists(file)).toBe(true);
    });

    it("stores the bundle folder on the session after a successful export, relative to the root", async () => {
      const { session } = await aReadySession({ workingExportFolder: "docs/features" });
      expect(await storedFolder(session.id)).toBeNull();
      await generateHandoff.run({ sessionId: session.id });

      await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      expect(await storedFolder(session.id)).toBe("docs/features/grill-room");
    });

    it("leaves the stored folder unchanged when an export fails", async () => {
      const { session } = await aReadySession();
      await generateHandoff.run({ sessionId: session.id });
      await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      await setTicketBlockedBy.run({
        ticketId: await ticketIdFor(session.id, 2),
        blockedBy: [],
      });
      await expect(
        exportSession.run({ sessionId: session.id, slug: "renamed" }),
      ).rejects.toMatchObject({ errorCode: "handoff-stale" });

      expect(await storedFolder(session.id)).toBe(".scratch/grill-room");
    });
  });

  describe("provenance manifest and the edited-file guard", () => {
    const EDITED = "# Grill Room\n\nEdited in the repo by hand.\n";

    /** A ready session with a current handoff, already exported once to `.scratch/grill-room`. */
    async function anExportedSession() {
      const ready = await aReadySession();
      await generateHandoff.run({ sessionId: ready.session.id });
      const first = await exportSession.run({ sessionId: ready.session.id, slug: "grill-room" });
      const bundleDir = path.join(ready.root, ".scratch", "grill-room");
      return { ...ready, first, bundleDir };
    }

    async function manifestHash(bundleDir: string, relativePath: string) {
      const manifest = await readManifest(bundleDir);
      return manifest.files.find((file: { path: string }) => file.path === relativePath)?.sha256;
    }

    function editedFlags(entries: { relativePath: string; edited: boolean }[]) {
      return Object.fromEntries(entries.map((entry) => [entry.relativePath, entry.edited]));
    }

    it("records the session, revision 1, the HEAD commit and a hash of every file written", async () => {
      const { root, session, first, bundleDir } = await anExportedSession();

      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const manifest = await readManifest(bundleDir);
      expect(manifest).toMatchObject({
        version: 2,
        sessionId: session.id,
        revision: 1,
        scoutCommit: null,
        headCommit: head,
      });
      expect(Object.keys(manifest).sort()).toEqual(
        ["files", "headCommit", "revision", "scoutCommit", "sessionId", "version"],
      );
      for (const written of first.written) {
        if (written.endsWith(EXPORT_MANIFEST_FILE)) continue;
        const relativePath = path.relative(bundleDir, written).split(path.sep).join("/");
        expect(await manifestHash(bundleDir, relativePath)).toBe(
          hashExportContent(await fs.readFile(written, "utf8")),
        );
      }

      await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect((await readManifest(bundleDir)).revision).toBe(2);
    });

    it("keeps a file edited on disk, lists it as kept, and keeps its old hash in the manifest", async () => {
      const { session, bundleDir } = await anExportedSession();
      const specPath = path.join(bundleDir, "spec.md");
      const oldHash = await manifestHash(bundleDir, "spec.md");
      await fs.writeFile(specPath, EDITED);

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      const flags = editedFlags(preview.plannedWrites);
      expect(flags["spec.md"]).toBe(true);
      expect(Object.entries(flags).filter(([, edited]) => edited)).toEqual([["spec.md", true]]);

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.kept).toEqual([specPath]);
      expect(result.written).not.toContain(specPath);
      expect(result.written).toContain(path.join(bundleDir, "intent.md"));
      expect(await fs.readFile(specPath, "utf8")).toBe(EDITED);
      expect(await manifestHash(bundleDir, "spec.md")).toBe(oldHash);
      expect(oldHash).not.toBe(hashExportContent(EDITED));

      // Still flagged by the next preview, since the manifest kept the old hash.
      const again = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(editedFlags(again.plannedWrites)["spec.md"]).toBe(true);
    });

    it("overwrites an edited file whose path is in the override list, and records its new hash", async () => {
      const { session, spec, bundleDir } = await anExportedSession();
      const specPath = path.join(bundleDir, "spec.md");
      await fs.writeFile(specPath, EDITED);

      const result = await exportSession.run({
        sessionId: session.id,
        slug: "grill-room",
        overridePaths: ["spec.md"],
      });

      const expected = `# Grill Room\n\nStatus: ready-for-agent\n\n${spec.markdown}`;
      expect(result.kept).toEqual([]);
      expect(result.written).toContain(specPath);
      expect(await fs.readFile(specPath, "utf8")).toBe(expected);
      expect(await manifestHash(bundleDir, "spec.md")).toBe(hashExportContent(expected));

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(editedFlags(preview.plannedWrites)["spec.md"]).toBe(false);
    });

    it("does not count a CRLF-only difference as an edit", async () => {
      const { session, bundleDir } = await anExportedSession();
      const specPath = path.join(bundleDir, "spec.md");
      const content = await fs.readFile(specPath, "utf8");
      await fs.writeFile(specPath, content.replace(/\n/g, "\r\n"));

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(editedFlags(preview.plannedWrites)["spec.md"]).toBe(false);
      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.kept).toEqual([]);
    });

    it("keeps an unlisted file already at a planned path, and does not add it to the manifest", async () => {
      const { root, session } = await aReadySession({
        files: { ".scratch/grill-room/spec.md": EDITED },
      });
      await generateHandoff.run({ sessionId: session.id });
      const bundleDir = path.join(root, ".scratch", "grill-room");
      const specPath = path.join(bundleDir, "spec.md");

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      const flags = editedFlags(preview.plannedWrites);
      expect(flags["spec.md"]).toBe(true);
      expect(flags["intent.md"]).toBe(false);

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.kept).toEqual([specPath]);
      expect(await fs.readFile(specPath, "utf8")).toBe(EDITED);
      expect(await manifestPaths(bundleDir)).not.toContain("spec.md");
      expect(await manifestPaths(bundleDir)).toContain("intent.md");
      expect((await readManifest(bundleDir)).revision).toBe(1);
    });

    it("trusts a version-1 manifest's files once: overwritten and removed, then guarded", async () => {
      const { root, session } = await aReadySession({
        files: {
          [`.scratch/grill-room/${EXPORT_MANIFEST_FILE}`]: JSON.stringify({
            version: 1,
            files: ["spec.md", "issues/03-old.md"],
          }),
          ".scratch/grill-room/spec.md": "written by an older export, then edited",
          ".scratch/grill-room/issues/03-old.md": "a ticket since dropped, then edited",
        },
      });
      await generateHandoff.run({ sessionId: session.id });
      const bundleDir = path.join(root, ".scratch", "grill-room");
      const specPath = path.join(bundleDir, "spec.md");
      const oldTicket = path.join(bundleDir, "issues", "03-old.md");

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(editedFlags(preview.plannedWrites)["spec.md"]).toBe(false);
      expect(preview.plannedRemovals).toEqual([
        { path: oldTicket, relativePath: "issues/03-old.md", edited: false },
      ]);

      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(result.kept).toEqual([]);
      expect(result.written).toContain(specPath);
      expect(result.removed).toEqual([oldTicket]);
      expect(await fs.readFile(specPath, "utf8")).not.toBe("written by an older export, then edited");
      expect(await readManifest(bundleDir)).toMatchObject({ version: 2, revision: 1 });

      // Once: the next edit is caught against the version-2 hash.
      await fs.writeFile(specPath, EDITED);
      const next = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(next.kept).toEqual([specPath]);
      expect((await readManifest(bundleDir)).revision).toBe(2);
    });

    it("keeps an edited file the plan drops, and removes it when overridden", async () => {
      const { session, bundleDir } = await anExportedSession();
      const droppedIssue = path.join(bundleDir, "issues", "02-store-on-disk.md");
      const droppedBrief = path.join(bundleDir, "briefs", "02-store-on-disk.md");
      const oldHash = await manifestHash(bundleDir, "issues/02-store-on-disk.md");
      await fs.writeFile(droppedIssue, "Ticket 2, rewritten by hand.");

      await getDb().delete(schema.tickets).where(eq(schema.tickets.number, 2));
      await generateHandoff.run({ sessionId: session.id });

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(preview.plannedRemovals).toEqual([
        { path: droppedBrief, relativePath: "briefs/02-store-on-disk.md", edited: false },
        { path: droppedIssue, relativePath: "issues/02-store-on-disk.md", edited: true },
      ]);

      const kept = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
      expect(kept.removed).toEqual([droppedBrief]);
      expect(kept.kept).toEqual([droppedIssue]);
      expect(await fs.readFile(droppedIssue, "utf8")).toBe("Ticket 2, rewritten by hand.");
      expect(await pathExists(droppedBrief)).toBe(false);
      expect(await manifestHash(bundleDir, "issues/02-store-on-disk.md")).toBe(oldHash);

      const removed = await exportSession.run({
        sessionId: session.id,
        slug: "grill-room",
        overridePaths: ["issues/02-store-on-disk.md"],
      });
      expect(removed.removed).toEqual([droppedIssue]);
      expect(removed.kept).toEqual([]);
      expect(await pathExists(droppedIssue)).toBe(false);
      expect(await manifestPaths(bundleDir)).not.toContain("issues/02-store-on-disk.md");
    });

    it("keeps a file edited between the preview and the export", async () => {
      const { session, bundleDir } = await anExportedSession();
      const specPath = path.join(bundleDir, "spec.md");

      const preview = await previewExport.run({ sessionId: session.id, slug: "grill-room" });
      expect(preview.plannedWrites.every((write) => !write.edited)).toBe(true);

      await fs.writeFile(specPath, EDITED);
      const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });

      expect(result.kept).toEqual([specPath]);
      expect(await fs.readFile(specPath, "utf8")).toBe(EDITED);
    });

    it.each([
      ["a path climbing out of the bundle", "../other/spec.md"],
      ["an absolute path", "/etc/hosts"],
    ])("refuses an override outside the bundle (%s), writing nothing", async (_label, override) => {
      const { session, bundleDir } = await anExportedSession();
      const specPath = path.join(bundleDir, "spec.md");
      await fs.writeFile(specPath, EDITED);

      await expect(
        exportSession.run({ sessionId: session.id, slug: "grill-room", overridePaths: [override] }),
      ).rejects.toMatchObject({ errorCode: "override-outside-bundle" });
      expect(await fs.readFile(specPath, "utf8")).toBe(EDITED);
    });

    it("refuses an override that leaves the bundle through a symlink, writing nothing", async () => {
      const { root, session, bundleDir } = await anExportedSession();
      const elsewhere = path.join(root, "elsewhere");
      await fs.mkdir(elsewhere);
      await fs.writeFile(path.join(elsewhere, "spec.md"), "not the bundle's");
      await fs.symlink(elsewhere, path.join(bundleDir, "escape"));
      const specPath = path.join(bundleDir, "spec.md");
      await fs.writeFile(specPath, EDITED);

      await expect(
        exportSession.run({
          sessionId: session.id,
          slug: "grill-room",
          overridePaths: ["spec.md", "escape/spec.md"],
        }),
      ).rejects.toMatchObject({ errorCode: "override-outside-bundle" });
      expect(await fs.readFile(specPath, "utf8")).toBe(EDITED);
      expect(await fs.readFile(path.join(elsewhere, "spec.md"), "utf8")).toBe("not the bundle's");
    });
  });
});

describe("export writes grounded briefs", () => {
  useTestDatabase();

  /** Grounds the session right now: a valid result, today's fingerprint, HEAD as read. */
  async function groundNow(sessionId: string, root: string): Promise<void> {
    const loaded = await loadHandoffSource(sessionId);
    if (!("source" in loaded)) throw new Error("expected a handoff source");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await storeBriefGrounding({
      sessionId,
      result: aHandoffScoutResult(),
      commitRead: head,
      handoffFingerprint: handoffFingerprint(loaded.source),
      model: "sonnet",
      turnId: null,
      ranAt: new Date().toISOString(),
    });
  }

  async function readBrief(bundleDir: string, relativePath: string): Promise<string> {
    return fs.readFile(path.join(bundleDir, "briefs", relativePath), "utf8");
  }

  /**
   * Overwrites ticket `number`'s stored brief text directly in the database,
   * without touching `editedAt` — simulating a brief `generate-handoff` wrote
   * under an earlier template version (its exact bytes no longer match
   * today's `renderBrief`), as opposed to one a person edited through
   * `update-handoff` (which always sets `editedAt`).
   */
  async function overwriteStoredBriefText(
    sessionId: string,
    ticketNumber: number,
    markdown: string,
  ): Promise<void> {
    const [row] = await getDb()
      .select()
      .from(schema.handoffs)
      .where(eq(schema.handoffs.sessionId, sessionId))
      .limit(1);
    const briefs = JSON.parse(row!.briefsJson) as {
      ticketNumber: number;
      relativePath: string;
      markdown: string;
    }[];
    const updated = briefs.map((brief) =>
      brief.ticketNumber === ticketNumber ? { ...brief, markdown } : brief,
    );
    await getDb()
      .update(schema.handoffs)
      .set({ briefsJson: JSON.stringify(updated) })
      .where(eq(schema.handoffs.id, row!.id));
  }

  async function editedAtOf(sessionId: string): Promise<string | null> {
    const [row] = await getDb()
      .select()
      .from(schema.handoffs)
      .where(eq(schema.handoffs.sessionId, sessionId))
      .limit(1);
    return row!.editedAt;
  }

  it("exports an unedited brief with the grounded sections", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await groundNow(session.id, root);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.groundedBriefs.sort()).toEqual([1, 2]);
    expect(result.ungroundedBriefs).toEqual([]);
    const bundleDir = path.join(root, ".scratch", "grill-room");

    // Ticket 1 (aHandoffScoutResult's ticket 1: no blockers, cited facts, a Proved by).
    const first = await readBrief(bundleDir, "01-build-the-workspace.md");
    expect(first).toContain("## File boundaries");
    expect(first).toContain("src/ingest/lag-alert.ts");
    expect(first).toContain("## Codebase facts");
    expect(first).toContain("Ingest lag is measured in src/ingest/metrics.ts.");
    expect(first).toContain("## Proved by");
    expect(first).toContain("src/ingest/lag-alert.test.ts");
    expect(first).not.toContain(FILE_BOUNDARIES_SLOT);

    // Ticket 2 (aHandoffScoutResult's ticket 2: blocked by 1, a Builds on entry).
    const second = await readBrief(bundleDir, "02-store-on-disk.md");
    expect(second).toContain("## Builds on");
    expect(second).toContain("The lag alert module.");
    expect(second).toContain("created by ticket 01 at `src/ingest/lag-alert.ts`");
  });

  it("exports a brief edited through update-handoff verbatim, ignoring grounding", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    const edited = "# Brief 01: Hand-edited\n\nSomeone already wrote this by hand.\n";
    await updateHandoff.run({ sessionId: session.id, briefs: [{ ticketNumber: 1, markdown: edited }] });
    await groundNow(session.id, root);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.ungroundedBriefs).toEqual([{ ticket: 1, reason: "edited" }]);
    expect(result.groundedBriefs).toEqual([2]);
    const bundleDir = path.join(root, ".scratch", "grill-room");

    expect(await readBrief(bundleDir, "01-build-the-workspace.md")).toBe(edited);
  });

  it("grounds a brief stored under an older template: editedAt null overrides the text mismatch", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    // Simulate a brief `generate-handoff` wrote before a later template
    // wording change (e.g. #54): its stored bytes no longer match today's
    // `renderBrief`, but nothing was hand-edited, so `editedAt` is still
    // null. Without the `editedAt`-first check, this text mismatch alone
    // would wrongly classify the brief as edited and skip grounding.
    const olderTemplateText =
      "# Brief 01: Build the workspace\n\nAn older rendering of this brief, before a template wording change.\n\n<!-- slot: file-boundaries -->\n\n<!-- slot: codebase-facts -->\n";
    await overwriteStoredBriefText(session.id, 1, olderTemplateText);
    expect(await editedAtOf(session.id)).toBeNull();

    await groundNow(session.id, root);

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.groundingState).toBe("current");
    expect(preview.groundedBriefs).toContain(1);
    expect(preview.ungroundedBriefs.some((entry: { ticket: number }) => entry.ticket === 1)).toBe(false);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.groundedBriefs).toContain(1);
    const bundleDir = path.join(root, ".scratch", "grill-room");

    const first = await readBrief(bundleDir, "01-build-the-workspace.md");
    expect(first).not.toContain("An older rendering of this brief");
    expect(first).toContain("## Proved by");
    expect(first).toContain("src/ingest/lag-alert.ts");
  });

  it("with stale grounding, the brief carries the stale line naming the handoff (tickets or project settings)", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await groundNow(session.id, root);

    // Removing ticket 2's blocker and regenerating the handoff keeps the
    // handoff itself current (so export is not blocked) but leaves the
    // grounding — made for the handoff before this edit — stale with reason
    // `handoff-changed`.
    await setTicketBlockedBy.run({ ticketId: await ticketIdFor(session.id, 2), blockedBy: [] });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.exportBlocked).toBe(false);
    expect(preview.groundingState).toBe("stale");
    expect(preview.groundingStaleReason).toBe("handoff-changed");

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const bundleDir = path.join(root, ".scratch", "grill-room");

    const first = await readBrief(bundleDir, "01-build-the-workspace.md");
    expect(first).toContain("_Grounded at commit `");
    expect(first).toContain("for an earlier version of the handoff (tickets or project settings)._");
    // The grounded content itself is still there under the stale line.
    expect(first).toContain("src/ingest/lag-alert.ts");
  });

  it("with no grounding, the brief is byte-identical to today's (unfilled slots)", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.groundingState).toBe("absent");

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const bundleDir = path.join(root, ".scratch", "grill-room");

    const loaded = await loadHandoffSource(session.id);
    if (!("source" in loaded)) throw new Error("expected a handoff source");
    const ticket1 = loaded.source.tickets.find((ticket) => ticket.number === 1)!;
    const bundlePath = bundlePathFor(loaded.source.project.visibility, loaded.source.project.rootPath, bundleDir);
    const expected = fillBundlePath(renderBrief(loaded.source, ticket1), bundlePath);

    expect(await readBrief(bundleDir, "01-build-the-workspace.md")).toBe(expected);
  });

  it("an older-template handoff with one brief hand-edited: HANDOFF.md keeps the fill wording, and the lists are accurate", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    // Ticket 2's brief is left sitting under an older template — nobody
    // touches it, and `editedAt` is still null at this point.
    const olderTemplateText =
      "# Brief 02: Store on disk\n\nAn older rendering of this brief, before a template wording change.\n\n<!-- slot: file-boundaries -->\n\n<!-- slot: codebase-facts -->\n";
    await overwriteStoredBriefText(session.id, 2, olderTemplateText);
    expect(await editedAtOf(session.id)).toBeNull();

    // Editing ticket 1's brief through update-handoff sets `editedAt` for the
    // whole handoff. From here, the equality check decides eligibility for
    // *every* text — including ticket 2's, which nobody touched but which
    // still no longer matches today's template.
    const handEdited = "# Brief 01: Hand-edited\n\nSomeone already wrote this by hand.\n";
    await updateHandoff.run({ sessionId: session.id, briefs: [{ ticketNumber: 1, markdown: handEdited }] });
    expect(await editedAtOf(session.id)).not.toBeNull();

    await groundNow(session.id, root);

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.groundingState).toBe("current");
    expect(preview.groundedBriefs).toEqual([]);
    expect(
      [...preview.ungroundedBriefs].sort((a: { ticket: number }, b: { ticket: number }) => a.ticket - b.ticket),
    ).toEqual([
      { ticket: 1, reason: "edited" },
      { ticket: 2, reason: "edited" },
    ]);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.groundedBriefs).toEqual([]);
    expect(
      [...result.ungroundedBriefs].sort((a: { ticket: number }, b: { ticket: number }) => a.ticket - b.ticket),
    ).toEqual([
      { ticket: 1, reason: "edited" },
      { ticket: 2, reason: "edited" },
    ]);

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handoffMarkdown = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoffMarkdown).toContain("Fill the brief's **File boundaries** slot");
    expect(handoffMarkdown).toContain("Fill the **Codebase facts** slot");
    expect(handoffMarkdown).not.toContain("grounded and current");

    expect(await readBrief(bundleDir, "01-build-the-workspace.md")).toBe(handEdited);
    const second = await readBrief(bundleDir, "02-store-on-disk.md");
    expect(second).toBe(olderTemplateText);
    expect(second).not.toContain("## Proved by");
  });

  it("a brief the hash guard kept is not reported as grounded", async () => {
    const { root, session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await groundNow(session.id, root);

    // A first export writes both briefs grounded, so HANDOFF.md says so too.
    const first = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(first.groundedBriefs.sort()).toEqual([1, 2]);
    const bundleDir = path.join(root, ".scratch", "grill-room");
    expect(await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8")).toContain("grounded and current");

    // Someone hand-edits the exported brief file directly in the repo,
    // outside Grill Room, after the export — the hash guard will keep it.
    const editedOnDisk = "# Hand-edited directly in the repo, not through update-handoff\n";
    await fs.writeFile(path.join(bundleDir, "briefs", "02-store-on-disk.md"), editedOnDisk);

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.groundedBriefs).toEqual([1]);
    expect(preview.ungroundedBriefs).toEqual(
      expect.arrayContaining([{ ticket: 2, reason: "kept" }]),
    );

    const second = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(second.groundedBriefs).toEqual([1]);
    expect(second.ungroundedBriefs).toEqual(expect.arrayContaining([{ ticket: 2, reason: "kept" }]));
    expect(second.kept.some((p) => p.endsWith("02-store-on-disk.md"))).toBe(true);

    // Ticket 2's file on disk is untouched by the export; ticket 1's is
    // still (re-)written grounded.
    expect(await readBrief(bundleDir, "02-store-on-disk.md")).toBe(editedOnDisk);
    expect(await readBrief(bundleDir, "01-build-the-workspace.md")).toContain("## Proved by");

    // Not every brief is actually grounded any more (ticket 2 is kept), so
    // the re-exported HANDOFF.md must fall back to the fill-the-slots
    // wording, not still claim the briefs are grounded and current.
    const handoffMarkdown = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoffMarkdown).toContain("Fill the brief's **File boundaries** slot");
    expect(handoffMarkdown).toContain("Fill the **Codebase facts** slot");
    expect(handoffMarkdown).not.toContain("grounded and current");
  });
});

describe("export-time facts: visibility and greenfield measured from git", () => {
  useTestDatabase();

  const GREENFIELD_PARAGRAPH =
    "This repository has no commits yet (greenfield). A worktree branches from a commit, so make the first commit before delegating the first ticket.";

  /** A ready session with a generated handoff. */
  async function aHandoffSession(options: {
    gitignore?: string;
    commit?: boolean;
    visibility: ProjectVisibility;
  }) {
    const ready = await aReadySession(options);
    await generateHandoff.run({ sessionId: ready.session.id });
    return ready;
  }

  async function exportedFiles(bundleDir: string): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};
    for (const file of await listFiles(bundleDir)) contents[file] = await fs.readFile(file, "utf8");
    return contents;
  }

  it.each([
    { name: ".scratch/* rule, stored tracked (stale)", gitignore: ".scratch/*\n", commit: true, stored: "tracked", effective: "ignored", greenfield: false },
    { name: ".scratch/ rule, stored ignored", gitignore: ".scratch/\n", commit: true, stored: "ignored", effective: "ignored", greenfield: false },
    { name: "no rule, stored ignored (stale)", gitignore: undefined, commit: true, stored: "ignored", effective: "tracked", greenfield: false },
    { name: "no rule, no commit, stored tracked", gitignore: undefined, commit: false, stored: "tracked", effective: "tracked", greenfield: true },
    { name: ".scratch/* rule, no commit, stored tracked", gitignore: ".scratch/*\n", commit: false, stored: "tracked", effective: "ignored", greenfield: true },
  ] as const)("$name: effective $effective, greenfield $greenfield", async (row) => {
    const { root, session } = await aHandoffSession({
      gitignore: row.gitignore,
      commit: row.commit,
      visibility: row.stored,
    });

    const plan = await planExportBundle({ sessionId: session.id, slug: "grill-room" });

    expect(plan.project.visibility).toBe(row.stored);
    expect(plan.effectiveVisibility).toBe(row.effective);
    expect(plan.greenfield).toBe(row.greenfield);
    const bundleDir = path.join(root, ".scratch", "grill-room");
    const expectedBundlePath = row.effective === "ignored" ? bundleDir : ".scratch/grill-room";
    const handoff = plan.files.find((file) => file.relativePath === "HANDOFF.md")!;
    expect(handoff.content).toContain(`- Spec: \`${expectedBundlePath}/spec.md\``);
    const brief = plan.files.find((file) => file.relativePath === "briefs/01-build-the-workspace.md")!;
    expect(brief.content).toContain(`\`${expectedBundlePath}/spec.md\``);
  });

  it("root no longer a git repository, stored tracked: falls back to the stored flag, greenfield", async () => {
    const { root, session } = await aHandoffSession({ visibility: "tracked" });
    await fs.rm(path.join(root, ".git"), { recursive: true, force: true });

    const plan = await planExportBundle({ sessionId: session.id, slug: "grill-room" });

    expect(plan.project.visibility).toBe("tracked");
    expect(plan.effectiveVisibility).toBe("tracked");
    expect(plan.greenfield).toBe(true);
    const handoff = plan.files.find((file) => file.relativePath === "HANDOFF.md")!;
    expect(handoff.content).toContain("- Spec: `.scratch/grill-room/spec.md`");
  });

  it("root no longer a git repository, stored ignored: falls back to the stored flag, absolute paths", async () => {
    const { root, session } = await aHandoffSession({ visibility: "ignored" });
    await fs.rm(path.join(root, ".git"), { recursive: true, force: true });

    const plan = await planExportBundle({ sessionId: session.id, slug: "grill-room" });

    expect(plan.project.visibility).toBe("ignored");
    expect(plan.effectiveVisibility).toBe("ignored");
    expect(plan.greenfield).toBe(true);
    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handoff = plan.files.find((file) => file.relativePath === "HANDOFF.md")!;
    expect(handoff.content).toContain(`- Spec: \`${bundleDir}/spec.md\``);
    const brief = plan.files.find((file) => file.relativePath === "briefs/01-build-the-workspace.md")!;
    expect(brief.content).toContain(`the spec at \`${bundleDir}/spec.md\``);
  });

  it("checks the bundle folder itself: a negation that un-ignores it wins over its ignored parent's contents", async () => {
    const { root, session } = await aHandoffSession({
      gitignore: ".scratch/*\n!.scratch/grill-room/\n",
      visibility: "ignored",
    });

    const plan = await planExportBundle({ sessionId: session.id, slug: "grill-room" });

    expect(plan.project.visibility).toBe("ignored");
    expect(plan.effectiveVisibility).toBe("tracked");
    expect(plan.greenfield).toBe(false);
    const handoff = plan.files.find((file) => file.relativePath === "HANDOFF.md")!;
    expect(handoff.content).toContain("- Spec: `.scratch/grill-room/spec.md`");
    expect(handoff.content).toContain(`${root}\`). The bundle lives in \`.scratch\`, which git tracks.`);
  });

  it("never writes the stored flag, still reports it, and keeps the fingerprint independent of git's answer", async () => {
    const { root, project, session } = await aHandoffSession({ visibility: "tracked" });
    const fingerprintOf = async () => {
      const loaded = await loadHandoffSource(session.id);
      if (!("source" in loaded)) throw new Error("expected a handoff source");
      return handoffFingerprint(loaded.source);
    };
    const before = await fingerprintOf();

    // git's answer changes after registration: the stored "tracked" goes stale.
    await fs.writeFile(path.join(root, ".gitignore"), ".scratch/*\n");

    const plan = await planExportBundle({ sessionId: session.id, slug: "grill-room" });
    expect(plan.effectiveVisibility).toBe("ignored");
    expect(plan.project.visibility).toBe("tracked");
    expect(await fingerprintOf()).toBe(before);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.written.length).toBeGreaterThan(0);
    expect((await getProject(project.id))!.visibility).toBe("tracked");
    expect(await fingerprintOf()).toBe(before);
    // The stored flag still reaches the mismatch warning.
    expect(result.visibility.mismatchWarning).toContain("tracked");
  });

  it("the review's worked case: greenfield, .scratch/* and a stored tracked flag", async () => {
    const { root, session } = await aHandoffSession({
      gitignore: ".scratch/*\n",
      commit: false,
      visibility: "tracked",
    });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const files = await exportedFiles(bundleDir);
    for (const [file, content] of Object.entries(files)) {
      expect(content, file).not.toContain("which git tracks");
      expect(content, file).not.toContain("The bundle is committed in this repository");
    }
    const handoff = files[path.join(bundleDir, "HANDOFF.md")]!;
    expect(handoff).toContain(
      `Paths below are absolute, into the main checkout at \`${root}\`. The bundle lives in \`.scratch\`, which git ignores`,
    );
    // No remote, so the recipe is local-merge: greenfield first, then its settings paragraph, then the ignored text.
    const section = handoff.slice(handoff.indexOf("## Before delegating the first ticket"));
    expect(section.startsWith(`## Before delegating the first ticket\n\n${GREENFIELD_PARAGRAPH}\n\n`)).toBe(true);
    const ignoredText = section.indexOf("The bundle is ignored by git, so no worktree will ever contain it.");
    expect(section.indexOf("worktree.baseRef")).toBeGreaterThan(section.indexOf(GREENFIELD_PARAGRAPH));
    expect(ignoredText).toBeGreaterThan(section.indexOf("worktree.baseRef"));
    expect(handoff).toContain(`- Spec: \`${bundleDir}/spec.md\``);
    for (const brief of ["01-build-the-workspace.md", "02-store-on-disk.md"]) {
      expect(files[path.join(bundleDir, "briefs", brief)]).toContain(
        "The bundle is ignored by git, so it is NOT in your worktree.",
      );
    }
  });

  it("keeps an owner-edited HANDOFF.md word for word even when the fresh facts differ", async () => {
    const { root, session } = await aHandoffSession({
      gitignore: ".scratch/*\n",
      commit: false,
      visibility: "tracked",
    });
    const [row] = await getDb()
      .select()
      .from(schema.handoffs)
      .where(eq(schema.handoffs.sessionId, session.id))
      .limit(1);
    const edited = `${row!.markdown}\nOwner note: commit the bundle first.\n`;
    await updateHandoff.run({ sessionId: session.id, markdown: edited });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handoff = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoff).toBe(fillBundlePath(edited, bundleDir));
    expect(handoff).toContain("which git tracks");
    expect(handoff).not.toContain(GREENFIELD_PARAGRAPH);
  });

  it("still re-renders an unedited HANDOFF.md with the fresh facts when only a brief was edited", async () => {
    const { root, session } = await aHandoffSession({
      gitignore: ".scratch/*\n",
      commit: false,
      visibility: "tracked",
    });
    await updateHandoff.run({
      sessionId: session.id,
      briefs: [{ ticketNumber: 1, markdown: "# Brief 01: hand-edited\n" }],
    });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handoff = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoff).toContain(GREENFIELD_PARAGRAPH);
    expect(handoff).not.toContain("which git tracks");
    expect(await fs.readFile(path.join(bundleDir, "briefs", "01-build-the-workspace.md"), "utf8")).toBe(
      "# Brief 01: hand-edited\n",
    );
    expect(await fs.readFile(path.join(bundleDir, "briefs", "02-store-on-disk.md"), "utf8")).toContain(
      "The bundle is ignored by git, so it is NOT in your worktree.",
    );
  });
});

describe("export separates tickets in one wave that change the same file", () => {
  useTestDatabase();

  const NOT_CHECKED_LINE =
    "Tickets in one wave have no Blocked-by between them. Whether they change the same files was not checked, because the briefs are not grounded against the current code: run them one at a time, or ground the briefs first. Start a wave only once every ticket of the previous wave is merged and verified.";
  const PARALLEL_LINE =
    "Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most two at a time. Start a wave only once every ticket of the previous wave is merged and verified.";
  const EDGE_LINE = "Ticket 03 waits for ticket 02: both change `src/shared/store.ts`.";

  /** One grounded ticket that changes `files`, with nothing it builds on. */
  function groundedTicket(number: number, files: string[]) {
    const base = aHandoffScoutResult().tickets[0]!;
    return {
      ...base,
      number,
      filesToChange: files.map((file) => ({ path: file, change: "edit" as const })),
      buildsOn: [],
    };
  }

  /** Three tickets with no Blocked-by at all: 02 and 03 both change `src/shared/store.ts`. */
  async function aSessionWithOverlap() {
    const { root, project } = await aProject();
    const session = await aSession("Grill Room", project.id);
    await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
    await insertTicket(session.id, { number: 2, slug: "store-on-disk" });
    await insertTicket(session.id, { number: 3, slug: "list-the-store" });
    await insertSpec(session.id, { ticketsCurrent: true });
    await generateHandoff.run({ sessionId: session.id });
    return { root, session };
  }

  async function groundNow(sessionId: string, root: string): Promise<void> {
    const loaded = await loadHandoffSource(sessionId);
    if (!("source" in loaded)) throw new Error("expected a handoff source");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await storeBriefGrounding({
      sessionId,
      result: aHandoffScoutResult({
        tickets: [
          groundedTicket(1, ["src/workspace.ts"]),
          groundedTicket(2, ["src/shared/store.ts", "src/disk.ts"]),
          groundedTicket(3, ["src/shared/store.ts", "src/list.ts"]),
        ],
      }),
      commitRead: head,
      handoffFingerprint: handoffFingerprint(loaded.source),
      model: "sonnet",
      turnId: null,
      ranAt: new Date().toISOString(),
    });
  }

  async function exportedHandoff(root: string): Promise<string> {
    return fs.readFile(path.join(root, ".scratch", "grill-room", "HANDOFF.md"), "utf8");
  }

  function waveHeadingBefore(markdown: string, needle: string): string {
    const at = markdown.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    const heading = markdown.lastIndexOf("### Wave ", at);
    return markdown.slice(heading, markdown.indexOf("\n", heading));
  }

  it("with current grounding, puts 02 and 03 in different waves and names the shared file", async () => {
    const { root, session } = await aSessionWithOverlap();
    await groundNow(session.id, root);
    expect((await previewExport.run({ sessionId: session.id })).groundingState).toBe("current");

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const handoff = await exportedHandoff(root);
    expect(handoff).toContain(`${PARALLEL_LINE}\n\n${EDGE_LINE}\n\n### Wave 1`);
    expect(waveHeadingBefore(handoff, "**01 Ticket 1**")).toBe("### Wave 1");
    expect(waveHeadingBefore(handoff, "**02 Ticket 2**")).toBe("### Wave 1");
    expect(waveHeadingBefore(handoff, "**03 Ticket 3**")).toBe("### Wave 2");
    expect(handoff).not.toContain("was not checked");
  });

  it("with stale grounding, carries the not-checked line and the Blocked-by waves", async () => {
    const { root, session } = await aSessionWithOverlap();
    await groundNow(session.id, root);
    await setTicketBlockedBy.run({ ticketId: await ticketIdFor(session.id, 3), blockedBy: [1] });
    await generateHandoff.run({ sessionId: session.id });
    expect((await previewExport.run({ sessionId: session.id })).groundingState).toBe("stale");

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const handoff = await exportedHandoff(root);
    expect(handoff).toContain(`## Waves\n\n${NOT_CHECKED_LINE}\n\n### Wave 1`);
    expect(handoff).not.toContain("do not block each other");
    expect(handoff).not.toContain("waits for ticket");
    expect(waveHeadingBefore(handoff, "**02 Ticket 2**")).toBe("### Wave 1");
    expect(waveHeadingBefore(handoff, "**03 Ticket 3** (blocked by 01)")).toBe("### Wave 2");
  });

  it("with no grounding, carries the not-checked line", async () => {
    const { root, session } = await aSessionWithOverlap();

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const handoff = await exportedHandoff(root);
    expect(handoff).toContain(`## Waves\n\n${NOT_CHECKED_LINE}\n\n### Wave 1`);
    expect(handoff).not.toContain("waits for ticket");
  });

  it("leaves the stored Blocked-by unchanged", async () => {
    const { root, session } = await aSessionWithOverlap();
    await groundNow(session.id, root);
    const before = await listTickets.run({ sessionId: session.id });

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const after = await listTickets.run({ sessionId: session.id });
    expect(after.tickets.map((ticket) => ticket.blockedBy)).toEqual([[], [], []]);
    expect(after.tickets).toEqual(before.tickets);
    expect(after.waves).toEqual([[1, 2, 3]]);
    expect(await exportedHandoff(root)).toContain(EDGE_LINE);
  });

  it("keeps an edited HANDOFF.md word for word, with current grounding and an overlap", async () => {
    const { root, session } = await aSessionWithOverlap();
    const [row] = await getDb()
      .select()
      .from(schema.handoffs)
      .where(eq(schema.handoffs.sessionId, session.id))
      .limit(1);
    const edited = `${row!.markdown}\nOwner note: run the tickets one at a time.\n`;
    await updateHandoff.run({ sessionId: session.id, markdown: edited });
    await groundNow(session.id, root);

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const bundleDir = path.join(root, ".scratch", "grill-room");
    const handoff = await exportedHandoff(root);
    expect(handoff).toBe(fillBundlePath(edited, bundlePathFor("tracked", root, bundleDir)));
    expect(handoff).not.toContain("waits for ticket");
  });

  it("still separates an unedited HANDOFF.md when only a brief was edited", async () => {
    const { root, session } = await aSessionWithOverlap();
    await updateHandoff.run({
      sessionId: session.id,
      briefs: [{ ticketNumber: 1, markdown: "# Brief 01: hand-edited\n" }],
    });
    await groundNow(session.id, root);

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    expect(await exportedHandoff(root)).toContain(`${PARALLEL_LINE}\n\n${EDGE_LINE}\n\n### Wave 1`);
  });
});
