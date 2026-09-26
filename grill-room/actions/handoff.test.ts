import fs from "node:fs/promises";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { EXPORT_MANIFEST_FILE, hashExportContent, parseExportManifest } from "../server/export.js";
import {
  BUNDLE_TOKEN,
  loadHandoffSource,
  parseBriefs,
  renderBrief,
  renderHandoff,
} from "../server/handoff.js";
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
import setSessionProject from "./set-session-project.js";
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
    gitignore?: string;
  } = {},
) {
  const root = repos.create({ gitignore: options.gitignore });
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    workingExportFolder: ".scratch",
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
    const project = await registerProject.run({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" });
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

  it("goes stale when the delivery recipe or the review switch changes", async () => {
    const { session, project } = await aReadySession();
    // repos.create() leaves no remote, so registration guessed local-merge.
    expect(project.deliveryRecipe).toBe("local-merge");
    await generateHandoff.run({ sessionId: session.id });

    await updateProject.run({ id: project.id, deliveryRecipe: "pull-request" });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);
    await generateHandoff.run({ sessionId: session.id });

    await updateProject.run({ id: project.id, adversarialReview: false });
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.stale).toBe(true);
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

async function storedHandoff(sessionId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.handoffs)
    .where(eq(schema.handoffs.sessionId, sessionId))
    .limit(1);
  return { ...row!, briefs: parseBriefs(row!.briefsJson) };
}

async function renderedToday(sessionId: string) {
  const loaded = await loadHandoffSource(sessionId);
  if (!("source" in loaded)) throw new Error("expected a source");
  return { source: loaded.source, rendered: renderHandoff(loaded.source) };
}

/** Strips both baselines, as a row stored before they existed has none. */
async function makeLegacy(sessionId: string): Promise<void> {
  const row = await storedHandoff(sessionId);
  await getDb()
    .update(schema.handoffs)
    .set({
      markdownGeneratedSha256: null,
      briefsJson: JSON.stringify(
        row.briefs.map(({ ticketNumber, relativePath, markdown }) => ({ ticketNumber, relativePath, markdown })),
      ),
    })
    .where(eq(schema.handoffs.sessionId, sessionId));
}

async function editBrief(sessionId: string, ticketNumber: number, markdown: string) {
  return updateHandoff.run({ sessionId, briefs: [{ ticketNumber, markdown }] });
}

async function unblockTicket2(sessionId: string): Promise<void> {
  await setTicketBlockedBy.run({ ticketId: await ticketId(sessionId, 2), blockedBy: [] });
}

const MY_BRIEF_2 = "# My brief 2\n";

describe("regenerating a handoff with edits", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("row 1: a first generation writes both baselines and no edits", async () => {
    const { session } = await aReadySession();
    const generated = await generateHandoff.run({ sessionId: session.id });

    const row = await storedHandoff(session.id);
    expect(row.markdownGeneratedSha256).toBe(hashExportContent(row.markdown));
    expect(row.briefs).toHaveLength(3);
    for (const brief of row.briefs) expect(brief.generatedSha256).toBe(hashExportContent(brief.markdown));
    expect(row.editedAt).toBeNull();
    expect(generated).toMatchObject({ handoffEdited: false, editedBriefs: [], outdatedBriefs: [] });
  });

  it("row 11: a legacy row with no edits is rewritten with both baselines and stops being legacy", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await makeLegacy(session.id);
    expect((await storedHandoff(session.id)).markdownGeneratedSha256).toBeNull();

    await unblockTicket2(session.id);
    const regenerated = await generateHandoff.run({ sessionId: session.id });

    const row = await storedHandoff(session.id);
    expect(row.markdownGeneratedSha256).toBe(hashExportContent(row.markdown));
    for (const brief of row.briefs) expect(brief.generatedSha256).toBe(hashExportContent(brief.markdown));
    expect(regenerated).toMatchObject({ stale: false, handoffEdited: false, editedBriefs: [] });
  });

  it("row 2: with nothing edited, everything is rewritten from today's render with new baselines", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await unblockTicket2(session.id);

    const regenerated = await generateHandoff.run({ sessionId: session.id });
    const { rendered } = await renderedToday(session.id);
    const row = await storedHandoff(session.id);
    expect(row.markdown).toBe(rendered.markdown);
    expect(row.markdownGeneratedSha256).toBe(hashExportContent(rendered.markdown));
    expect(row.briefs).toEqual(
      rendered.briefs.map((brief) => ({ ...brief, generatedSha256: hashExportContent(brief.markdown) })),
    );
    expect(row.editedAt).toBeNull();
    expect(regenerated.stale).toBe(false);
  });

  it("row 3: keeps an edited brief whose ticket changed, rewrites the rest, and names it outdated", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    const baselineBefore = (await storedHandoff(session.id)).briefs[1]!.generatedSha256;
    await editBrief(session.id, 2, MY_BRIEF_2);
    const before = await storedHandoff(session.id);
    await unblockTicket2(session.id);

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    const { rendered } = await renderedToday(session.id);
    const row = await storedHandoff(session.id);
    expect(row.markdown).toBe(rendered.markdown);
    expect(row.markdownGeneratedSha256).toBe(hashExportContent(rendered.markdown));
    expect(row.briefs[0]).toEqual({ ...rendered.briefs[0], generatedSha256: hashExportContent(rendered.briefs[0]!.markdown) });
    expect(row.briefs[2]).toEqual({ ...rendered.briefs[2], generatedSha256: hashExportContent(rendered.briefs[2]!.markdown) });
    expect(row.briefs[1]).toEqual({
      ticketNumber: 2,
      relativePath: "briefs/02-store-on-disk.md",
      markdown: MY_BRIEF_2,
      generatedSha256: baselineBefore,
    });
    expect(row.editedAt).toBe(before.editedAt);
    expect(row.editedAt).not.toBeNull();
    expect(row.revision).toBe(before.revision + 1);
    expect(regenerated).toMatchObject({
      stale: false,
      fingerprint: regenerated.currentFingerprint,
      editedAt: before.editedAt,
      handoffEdited: false,
      editedBriefs: [2],
      outdatedBriefs: [2],
    });
  });

  it("row 4: keeps an edited brief whose own render did not change, and does not name it outdated", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    await setTicketBlockedBy.run({ ticketId: await ticketId(session.id, 3), blockedBy: [1] });

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    const { rendered } = await renderedToday(session.id);
    const row = await storedHandoff(session.id);
    expect(row.briefs[1]!.markdown).toBe(MY_BRIEF_2);
    expect(row.briefs[2]!.markdown).toBe(rendered.briefs[2]!.markdown);
    expect(row.briefs[2]!.markdown).toContain("Blocked by: 01");
    expect(regenerated).toMatchObject({ editedBriefs: [2], outdatedBriefs: [] });
  });

  it("row 5: a brief saved back to exactly its generated text is not an edit, so it is rewritten", async () => {
    const { session } = await aReadySession();
    const generated = await generateHandoff.run({ sessionId: session.id });
    const original = generated.briefs[1]!.markdown;
    await editBrief(session.id, 2, MY_BRIEF_2);
    const savedBack = await editBrief(session.id, 2, original);
    expect(savedBack.editedAt).not.toBeNull();
    expect(savedBack.editedBriefs).toEqual([]);
    await unblockTicket2(session.id);

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    const { rendered } = await renderedToday(session.id);
    expect(regenerated.briefs[1]!.markdown).toBe(rendered.briefs[1]!.markdown);
    expect(regenerated.editedAt).toBeNull();
    expect(regenerated.editedBriefs).toEqual([]);
    expect((await storedHandoff(session.id)).editedAt).toBeNull();
  });

  it("a CRLF-only difference is not an edit", async () => {
    const { session } = await aReadySession();
    const generated = await generateHandoff.run({ sessionId: session.id });
    const crlf = generated.briefs[1]!.markdown.replace(/\n/g, "\r\n");
    const saved = await editBrief(session.id, 2, crlf);
    expect(saved.editedBriefs).toEqual([]);
  });

  it("row 6 and M1: refuses over an edited HANDOFF.md, writing nothing", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await updateHandoff.run({ sessionId: session.id, markdown: "# My handoff\n" });
    await unblockTicket2(session.id);
    const before = await storedHandoff(session.id);

    await expect(generateHandoff.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "handoff-edited",
      statusCode: 409,
      message:
        "HANDOFF.md was edited since it was generated, and regenerating rewrites it. Confirm to overwrite the edits.",
    });
    expect(await storedHandoff(session.id)).toEqual(before);
  });

  it("row 7 and M2 for one brief: refuses when an edited brief's ticket is gone, writing nothing", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 3, "# My brief 3\n");
    scriptInterviewer([ticketsTurn(THREE_TICKETS.slice(0, 2))]);
    await breakIntoTickets.run({ sessionId: session.id });
    const before = await storedHandoff(session.id);

    await expect(generateHandoff.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "handoff-edited",
      statusCode: 409,
      message:
        "The edited brief briefs/03-export-it.md has no ticket any more, so regenerating removes it. Confirm to overwrite the edits.",
    });
    expect(await storedHandoff(session.id)).toEqual(before);
  });

  it("M2 for several briefs: names every removed edited brief in ticket order", async () => {
    const tickets = ["a", "b", "c", "d", "e"].map((slug, index) => ({ number: index + 1, slug }));
    const { session } = await aReadySession({ tickets });
    await generateHandoff.run({ sessionId: session.id });
    await updateHandoff.run({
      sessionId: session.id,
      briefs: [5, 3, 4].map((ticketNumber) => ({ ticketNumber, markdown: `# Mine ${ticketNumber}\n` })),
    });
    scriptInterviewer([ticketsTurn(tickets.slice(0, 2))]);
    await breakIntoTickets.run({ sessionId: session.id });
    const before = await storedHandoff(session.id);

    await expect(generateHandoff.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "handoff-edited",
      statusCode: 409,
      message:
        "The edited briefs briefs/03-c.md, briefs/04-d.md and briefs/05-e.md have no ticket any more, so regenerating removes them. Confirm to overwrite the edits.",
    });
    expect(await storedHandoff(session.id)).toEqual(before);
  });

  it("row 8: an unedited brief whose ticket is gone is dropped without asking", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    scriptInterviewer([ticketsTurn(THREE_TICKETS.slice(0, 2))]);
    await breakIntoTickets.run({ sessionId: session.id });

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    expect(regenerated.briefs.map((brief) => brief.ticketNumber)).toEqual([1, 2]);
    expect(regenerated.briefs[1]!.markdown).toBe(MY_BRIEF_2);
    expect((await storedHandoff(session.id)).briefs.map((brief) => brief.ticketNumber)).toEqual([1, 2]);
  });

  it("row 9: a new ticket leaves an edited brief's render alone, and gets a fresh brief with its baseline", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    scriptInterviewer([ticketsTurn([...THREE_TICKETS, { number: 4, slug: "ship-it" }])]);
    await breakIntoTickets.run({ sessionId: session.id });

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    const row = await storedHandoff(session.id);
    expect(row.briefs[1]!.markdown).toBe(MY_BRIEF_2);
    expect(row.briefs[3]).toMatchObject({ ticketNumber: 4, relativePath: "briefs/04-ship-it.md" });
    expect(row.briefs[3]!.generatedSha256).toBe(hashExportContent(row.briefs[3]!.markdown));
    expect(regenerated).toMatchObject({ editedBriefs: [2], outdatedBriefs: [] });
  });

  it("row 10: keeps an edited brief at its ticket's new path when the slug changed, and names it outdated", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    scriptInterviewer([
      ticketsTurn([THREE_TICKETS[0]!, { number: 2, slug: "persist-to-disk", blockedBy: [1] }, THREE_TICKETS[2]!]),
    ]);
    await breakIntoTickets.run({ sessionId: session.id });

    const regenerated = await generateHandoff.run({ sessionId: session.id });

    expect(regenerated.briefs[1]).toEqual({
      ticketNumber: 2,
      relativePath: "briefs/02-persist-to-disk.md",
      markdown: MY_BRIEF_2,
    });
    expect(regenerated).toMatchObject({ editedBriefs: [2], outdatedBriefs: [2] });
  });

  it("row 12 and M0: a legacy row with edits refuses with today's message, writing nothing", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    await makeLegacy(session.id);
    const before = await storedHandoff(session.id);

    await expect(generateHandoff.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "handoff-edited",
      statusCode: 409,
      message: "The handoff was edited since it was generated. Confirm to overwrite the edits.",
    });
    expect(await storedHandoff(session.id)).toEqual(before);
  });

  it("row 13: overwriteEdits rewrites everything with fresh baselines, legacy or not", async () => {
    for (const legacy of [false, true]) {
      const { session } = await aReadySession();
      await generateHandoff.run({ sessionId: session.id });
      await updateHandoff.run({
        sessionId: session.id,
        markdown: "# My handoff\n",
        briefs: [{ ticketNumber: 2, markdown: MY_BRIEF_2 }],
      });
      if (legacy) await makeLegacy(session.id);
      await unblockTicket2(session.id);

      const overwritten = await generateHandoff.run({ sessionId: session.id, overwriteEdits: true });

      const { rendered } = await renderedToday(session.id);
      const row = await storedHandoff(session.id);
      expect(row.markdown).toBe(rendered.markdown);
      expect(row.markdownGeneratedSha256).toBe(hashExportContent(rendered.markdown));
      expect(row.briefs).toEqual(
        rendered.briefs.map((brief) => ({ ...brief, generatedSha256: hashExportContent(brief.markdown) })),
      );
      expect(row.editedAt).toBeNull();
      expect(overwritten).toMatchObject({ handoffEdited: false, editedBriefs: [], outdatedBriefs: [] });
    }
  });
});

describe("editing a handoff moves baselines", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("U1: saving an edited brief while current marks it reviewed, after a row-3 regeneration", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    await unblockTicket2(session.id);
    const regenerated = await generateHandoff.run({ sessionId: session.id });
    expect(regenerated).toMatchObject({ editedBriefs: [2], outdatedBriefs: [2] });

    const saved = await editBrief(session.id, 2, MY_BRIEF_2);

    const { source } = await renderedToday(session.id);
    const row = await storedHandoff(session.id);
    expect(row.briefs[1]!.generatedSha256).toBe(hashExportContent(renderBrief(source, source.tickets[1]!)));
    expect(saved).toMatchObject({ editedBriefs: [2], outdatedBriefs: [] });
    expect((await getHandoff.run({ sessionId: session.id })).handoff).toMatchObject({
      editedBriefs: [2],
      outdatedBriefs: [],
    });
  });

  it("U2: a brief saved back to its generated text keeps its baseline, even after its ticket changed", async () => {
    const { session } = await aReadySession();
    const generated = await generateHandoff.run({ sessionId: session.id });
    const baseline = (await storedHandoff(session.id)).briefs[1]!.generatedSha256;

    await editBrief(session.id, 2, generated.briefs[1]!.markdown);
    expect((await storedHandoff(session.id)).briefs[1]!.generatedSha256).toBe(baseline);

    // Kept by a row-3 regeneration, then saved back to the text it was generated with.
    await editBrief(session.id, 2, MY_BRIEF_2);
    await unblockTicket2(session.id);
    await generateHandoff.run({ sessionId: session.id });
    const savedBack = await editBrief(session.id, 2, generated.briefs[1]!.markdown);

    expect((await storedHandoff(session.id)).briefs[1]!.generatedSha256).toBe(baseline);
    expect(savedBack).toMatchObject({ editedBriefs: [], outdatedBriefs: [] });
  });

  it("U3: an edit saved while stale keeps its baseline, and is named outdated after the next regeneration", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    const baseline = (await storedHandoff(session.id)).briefs[1]!.generatedSha256;
    await unblockTicket2(session.id);

    const saved = await editBrief(session.id, 2, MY_BRIEF_2);
    expect(saved.stale).toBe(true);
    expect((await storedHandoff(session.id)).briefs[1]!.generatedSha256).toBe(baseline);

    const regenerated = await generateHandoff.run({ sessionId: session.id });
    expect(regenerated).toMatchObject({ stale: false, editedBriefs: [2], outdatedBriefs: [2] });
  });

  it("U3: an edit saved when the source is refused keeps its baseline", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    const baseline = (await storedHandoff(session.id)).briefs[1]!.generatedSha256;
    await setSessionProject.run({ sessionId: session.id, projectId: null });

    await editBrief(session.id, 2, "# Mine again\n");

    expect((await storedHandoff(session.id)).briefs[1]!.generatedSha256).toBe(baseline);
  });

  it("U4: an edit on a legacy row writes no baseline", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await makeLegacy(session.id);

    const saved = await editBrief(session.id, 2, MY_BRIEF_2);

    const row = await storedHandoff(session.id);
    expect(row.markdownGeneratedSha256).toBeNull();
    expect(row.briefs.every((brief) => brief.generatedSha256 === undefined)).toBe(true);
    expect(saved).toMatchObject({ handoffEdited: false, editedBriefs: [], outdatedBriefs: [] });
  });

  it("U5 and U6: replacing HANDOFF.md keeps its baseline, and the briefs not named keep theirs", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    const before = await storedHandoff(session.id);

    const saved = await updateHandoff.run({
      sessionId: session.id,
      markdown: "# My handoff\n",
      briefs: [{ ticketNumber: 2, markdown: MY_BRIEF_2 }],
    });

    const row = await storedHandoff(session.id);
    expect(row.markdownGeneratedSha256).toBe(before.markdownGeneratedSha256);
    expect(row.briefs[0]!.generatedSha256).toBe(before.briefs[0]!.generatedSha256);
    expect(row.briefs[2]!.generatedSha256).toBe(before.briefs[2]!.generatedSha256);
    expect(saved).toMatchObject({ handoffEdited: true, editedBriefs: [2] });
  });
});

describe("get-handoff's edit report", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("reports edited texts, names an edited brief whose ticket is gone as outdated, and never shows baselines", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await updateHandoff.run({
      sessionId: session.id,
      markdown: "# My handoff\n",
      briefs: [{ ticketNumber: 3, markdown: "# My brief 3\n" }],
    });
    scriptInterviewer([ticketsTurn(THREE_TICKETS.slice(0, 2))]);
    await breakIntoTickets.run({ sessionId: session.id });

    const { handoff } = await getHandoff.run({ sessionId: session.id });
    expect(handoff).toMatchObject({ handoffEdited: true, editedBriefs: [3], outdatedBriefs: [3] });
    for (const brief of handoff!.briefs) {
      expect(Object.keys(brief).sort()).toEqual(["markdown", "relativePath", "ticketNumber"]);
    }
  });

  it("reports nothing outdated when today's inputs cannot be read", async () => {
    const { session } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });
    await editBrief(session.id, 2, MY_BRIEF_2);
    await unblockTicket2(session.id);
    expect((await getHandoff.run({ sessionId: session.id })).handoff?.outdatedBriefs).toEqual([2]);

    await setSessionProject.run({ sessionId: session.id, projectId: null });

    const { handoff } = await getHandoff.run({ sessionId: session.id });
    expect(handoff).toMatchObject({ editedBriefs: [2], outdatedBriefs: [] });
  });
});

describe("handoff export", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("refuses to export without a handoff, writing nothing", async () => {
    const { session, bundleDir } = await aReadySession();
    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.handoffIncluded).toBe(false);
    expect(preview.files).not.toContain(path.join(bundleDir, "HANDOFF.md"));
    expect(preview.exportBlocked).toBe(true);
    expect(preview.exportBlockedReason).toBe("handoff-missing");

    await expect(
      exportSession.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "handoff-missing" });
    await expect(fs.access(bundleDir)).rejects.toThrow();
  });

  it("lists HANDOFF.md and the briefs in the preview and manifest, and writes them with repo-relative paths", async () => {
    const { session, bundleDir } = await aReadySession();
    await generateHandoff.run({ sessionId: session.id });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.handoffIncluded).toBe(true);
    expect(preview.files).toEqual([
      path.join(bundleDir, "HANDOFF.md"),
      path.join(bundleDir, "spec.md"),
      path.join(bundleDir, "intent.md"),
      path.join(bundleDir, "issues", "01-build-the-workspace.md"),
      path.join(bundleDir, "issues", "02-store-on-disk.md"),
      path.join(bundleDir, "issues", "03-export-it.md"),
      path.join(bundleDir, "briefs", "01-build-the-workspace.md"),
      path.join(bundleDir, "briefs", "02-store-on-disk.md"),
      path.join(bundleDir, "briefs", "03-export-it.md"),
      path.join(bundleDir, EXPORT_MANIFEST_FILE),
    ]);

    const result = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    expect(result.written).toEqual(preview.files);
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
    expect(manifest?.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["HANDOFF.md", "briefs/02-store-on-disk.md"]),
    );

    const read = await getHandoff.run({ sessionId: session.id });
    expect(read.handoff?.exportedAt).not.toBeNull();
    expect(read.handoff?.exportStale).toBe(false);
  });

  it("writes absolute paths into the main checkout for an ignored project", async () => {
    const { session, bundleDir } = await aReadySession({ visibility: "ignored", gitignore: ".scratch/\n" });
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
