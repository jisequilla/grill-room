import fs from "node:fs/promises";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { EXPORT_MANIFEST_FILE, parseExportManifest } from "../server/export.js";
import { BUNDLE_TOKEN } from "../server/handoff.js";
import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import generateHandoff from "./generate-handoff.js";
import getHandoff from "./get-handoff.js";
import listTickets from "./list-tickets.js";
import previewExport from "./preview-export.js";
import registerProject from "./register-project.js";
import setTicketBlockedBy from "./set-ticket-blocked-by.js";
import synthesizeSpec from "./synthesize-spec.js";
import updateHandoff from "./update-handoff.js";
import updateProject from "./update-project.js";

const repos = useTempGitRepos();

const SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
  "",
  "## User Stories",
  "",
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
  "",
  "## Implementation Decisions",
  "",
  "- The shape is a workspace.",
  "",
  "## Testing Decisions",
  "",
  "- Behaviour is tested at the action boundary.",
  "",
  "## Out of Scope",
  "",
  "- Anything not decided above.",
  "",
  "## Further Notes",
  "",
  "- None.",
].join("\n");

interface TicketSpec {
  number: number;
  slug: string;
  blockedBy?: number[];
}

function ticketsTurn(tickets: TicketSpec[]): ScriptedTurn {
  return {
    kind: "break-into-tickets",
    result: {
      tickets: tickets.map((ticket) => ({
        title: `Ticket ${ticket.number}`,
        body: `Do the work of ticket ${ticket.number}.`,
        blockedBy: [],
        ...ticket,
      })),
    },
  };
}

const THREE_TICKETS: TicketSpec[] = [
  { number: 1, slug: "build-the-workspace" },
  { number: 2, slug: "store-on-disk", blockedBy: [1] },
  { number: 3, slug: "export-it" },
];

/**
 * A confirmed session in a fresh project, with a synthesized spec and tickets
 * from the fake interviewer: the same path the UI takes.
 */
async function aReadySession(
  options: {
    visibility?: "tracked" | "ignored";
    trackerKind?: "beads" | "markdown";
    tickets?: TicketSpec[];
  } = {},
) {
  const root = repos.create();
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    exportFolder: ".scratch",
    visibility: options.visibility ?? "tracked",
    trackerKind: options.trackerKind,
  });
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    projectId: project.id,
  });
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, session.id));
  scriptInterviewer([
    { kind: "synthesize-spec", result: { markdown: SPEC_MARKDOWN } },
    ticketsTurn(options.tickets ?? THREE_TICKETS),
  ]);
  await synthesizeSpec.run({ sessionId: session.id });
  await breakIntoTickets.run({ sessionId: session.id });
  return { root, project, session, bundleDir: path.join(root, ".scratch", "grill-room") };
}

async function ticketId(sessionId: string, number: number): Promise<string> {
  const { tickets } = await listTickets.run({ sessionId });
  return tickets.find((ticket) => ticket.number === number)!.id;
}

describe("handoff generation", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("reports no handoff and why generation is refused before there are tickets", async () => {
    const root = repos.create();
    const project = await registerProject.run({ root, verifyCommand: "pnpm test", exportFolder: ".scratch" });
    const noProject = await createSession.run({ title: "A", idea: "An idea." });
    const noSpec = await createSession.run({ title: "B", idea: "An idea.", projectId: project.id });

    expect(await getHandoff.run({ sessionId: noProject.id })).toMatchObject({
      handoff: null,
      canGenerate: false,
      cannotGenerateReason: { errorCode: "no-project" },
    });
    await expect(generateHandoff.run({ sessionId: noProject.id })).rejects.toMatchObject({
      errorCode: "no-project",
    });
    await expect(generateHandoff.run({ sessionId: noSpec.id })).rejects.toMatchObject({
      errorCode: "spec-missing",
    });
    await expect(getHandoff.run({ sessionId: "missing" })).rejects.toThrow("Session not found");
  });

  it("generates HANDOFF.md and one brief per ticket, current and never exported", async () => {
    const { session } = await aReadySession();

    const generated = await generateHandoff.run({ sessionId: session.id });
    expect(generated.stale).toBe(false);
    expect(generated.editedAt).toBeNull();
    expect(generated.exportedAt).toBeNull();
    expect(generated.exportStale).toBe(false);
    expect(generated.markdown).toContain("# Handoff: Grill Room");
    expect(generated.markdown).toContain("```bash\npnpm test\n```");
    expect(generated.briefs.map((brief) => brief.relativePath)).toEqual([
      "briefs/01-build-the-workspace.md",
      "briefs/02-store-on-disk.md",
      "briefs/03-export-it.md",
    ]);

    const read = await getHandoff.run({ sessionId: session.id });
    expect(read.canGenerate).toBe(true);
    expect(read.handoff).toMatchObject({ stale: false, markdown: generated.markdown });
  });

  it("renders waves from the stored blockedBy", async () => {
    const { session } = await aReadySession();
    const { markdown } = await generateHandoff.run({ sessionId: session.id });
    const order = ["### Wave 1", "**01 Ticket 1**", "**03 Ticket 3**", "### Wave 2", "**02 Ticket 2**"].map(
      (needle) => markdown.indexOf(needle),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("goes stale on a blocker edit, and regenerating clears it with the new waves", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    await setTicketBlockedBy.run({ ticketId: await ticketId(session.id, 3), blockedBy: [2] });

    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);

    const regenerated = await generateHandoff.run({ sessionId: session.id });
    expect(regenerated.stale).toBe(false);
    expect(regenerated.markdown).toContain("### Wave 3");
    expect(regenerated.markdown).toContain("**03 Ticket 3** (blocked by 02)");
  });

  it("goes stale when the tickets are regenerated, even to the same tickets", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    scriptInterviewer([ticketsTurn(THREE_TICKETS)]);
    await breakIntoTickets.run({ sessionId: session.id });

    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);
    await generateHandoff.run({ sessionId: session.id });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(false);
  });

  it("goes stale when a project field the templates use changes", async () => {
    const { session, project } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    await updateProject.run({ id: project.id, verifyCommand: "just verify" });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);

    const regenerated = await generateHandoff.run({ sessionId: session.id });
    expect(regenerated.stale).toBe(false);
    expect(regenerated.markdown).toContain("```bash\njust verify\n```");

    await updateProject.run({ id: project.id, buildRecordLogging: true });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);
    const withRecords = await generateHandoff.run({ sessionId: session.id });
    expect(withRecords.markdown).toContain(
      `pnpm action set-build-record --sessionId ${session.id} --ticketNumber 2 `,
    );
  });

  it("refuses to regenerate over edits without confirmation, and overwrites them with it", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    const edited = await updateHandoff.run({
      sessionId: session.id,
      markdown: "# My own handoff\n",
      briefs: [{ ticketNumber: 2, markdown: "# My own brief\n" }],
    });
    expect(edited.editedAt).not.toBeNull();
    expect(edited.markdown).toBe("# My own handoff\n");
    expect(edited.briefs.find((brief) => brief.ticketNumber === 2)?.markdown).toBe("# My own brief\n");
    // An edit is not a change of inputs: the handoff is still current.
    expect(edited.stale).toBe(false);

    await expect(generateHandoff.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "handoff-edited",
    });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.markdown).toBe("# My own handoff\n");

    const overwritten = await generateHandoff.run({ sessionId: session.id, overwriteEdits: true });
    expect(overwritten.editedAt).toBeNull();
    expect(overwritten.markdown).toContain("# Handoff: Grill Room");
  });

  it("refuses edits without a handoff or for a ticket with no brief", async () => {
    const { session } = await aReadySession();
    await expect(updateHandoff.run({ sessionId: session.id, markdown: "x" })).rejects.toMatchObject({
      errorCode: "handoff-missing",
    });
    await generateHandoff.run({ sessionId: session.id });
    await expect(
      updateHandoff.run({ sessionId: session.id, briefs: [{ ticketNumber: 9, markdown: "x" }] }),
    ).rejects.toMatchObject({ errorCode: "brief-not-found" });
  });
});

describe("handoff export", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("exports without a handoff exactly as before", async () => {
    const { session, bundleDir } = await aReadySession();
    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.handoffIncluded).toBe(false);
    expect(preview.files).not.toContain(path.join(bundleDir, "HANDOFF.md"));

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.handoffExported).toBe(false);
  });

  it("lists HANDOFF.md and the briefs in the preview and manifest, and writes them with repo-relative paths", async () => {
    const { session, bundleDir } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.handoffIncluded).toBe(true);
    expect(preview.files).toEqual([
      path.join(bundleDir, "HANDOFF.md"),
      path.join(bundleDir, "spec.md"),
      path.join(bundleDir, "issues", "01-build-the-workspace.md"),
      path.join(bundleDir, "issues", "02-store-on-disk.md"),
      path.join(bundleDir, "issues", "03-export-it.md"),
      path.join(bundleDir, "briefs", "01-build-the-workspace.md"),
      path.join(bundleDir, "briefs", "02-store-on-disk.md"),
      path.join(bundleDir, "briefs", "03-export-it.md"),
      path.join(bundleDir, EXPORT_MANIFEST_FILE),
    ]);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.files).toEqual(preview.files);
    expect(result.handoffExported).toBe(true);

    const handoffOnDisk = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoffOnDisk).not.toContain(BUNDLE_TOKEN);
    expect(handoffOnDisk).toContain("- Spec: `.scratch/grill-room/spec.md`");
    expect(handoffOnDisk).toContain("git add .scratch/grill-room");

    const briefOnDisk = await fs.readFile(path.join(bundleDir, "briefs", "02-store-on-disk.md"), "utf8");
    expect(briefOnDisk).toContain("`.scratch/grill-room/issues/02-store-on-disk.md`");

    const manifest = parseExportManifest(
      await fs.readFile(path.join(bundleDir, EXPORT_MANIFEST_FILE), "utf8"),
    );
    expect(manifest).toEqual(expect.arrayContaining(["HANDOFF.md", "briefs/02-store-on-disk.md"]));

    const read = await getHandoff.run({ sessionId: session.id });
    expect(read.handoff?.exportedAt).not.toBeNull();
    expect(read.handoff?.exportStale).toBe(false);
  });

  it("writes absolute paths into the main checkout for an ignored project", async () => {
    const { session, bundleDir } = await aReadySession({ visibility: "ignored" });
    await generateHandoff.run({ sessionId: session.id });
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const handoffOnDisk = await fs.readFile(path.join(bundleDir, "HANDOFF.md"), "utf8");
    expect(handoffOnDisk).toContain(`- Spec: \`${bundleDir}/spec.md\``);
    const briefOnDisk = await fs.readFile(path.join(bundleDir, "briefs", "01-build-the-workspace.md"), "utf8");
    expect(briefOnDisk).toContain(`by absolute path from the main checkout: the spec at \`${bundleDir}/spec.md\``);
  });

  it("marks the export stale after an edit or a regeneration, and clears it on re-export", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const edited = await updateHandoff.run({ sessionId: session.id, markdown: "# Edited\n" });
    expect(edited.exportStale).toBe(true);

    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.exportStale).toBe(false);

    await generateHandoff.run({ sessionId: session.id, overwriteEdits: true });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.exportStale).toBe(true);
  });

  it("removes a dropped ticket's brief on re-export", async () => {
    const { session, bundleDir } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const droppedBrief = path.join(bundleDir, "briefs", "03-export-it.md");
    await fs.access(droppedBrief);

    scriptInterviewer([ticketsTurn(THREE_TICKETS.slice(0, 2))]);
    await breakIntoTickets.run({ sessionId: session.id });
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.removals).toEqual(
      expect.arrayContaining([droppedBrief, path.join(bundleDir, "issues", "03-export-it.md")]),
    );

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.removed).toContain(droppedBrief);
    await expect(fs.access(droppedBrief)).rejects.toThrow();
    await fs.access(path.join(bundleDir, "briefs", "02-store-on-disk.md"));
  });
});
