import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { storeBriefGrounding } from "../server/brief-grounding.js";
import { handoffFingerprint, loadHandoffSource } from "../server/handoff.js";
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import generateHandoff from "./generate-handoff.js";
import listTickets from "./list-tickets.js";
import previewExport from "./preview-export.js";
import registerProject from "./register-project.js";
import setTicketBlockedBy from "./set-ticket-blocked-by.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(root: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Grill Room Tests",
      "-c",
      "user.email=tests@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, encoding: "utf8" },
  ).trim();
}

function headOf(root: string): string {
  return git(root, ["rev-parse", "HEAD"]);
}

/** A new commit in `root`, so its HEAD moves past whatever it was grounded at. */
function commitMore(root: string): void {
  git(root, ["commit", "--allow-empty", "-q", "-m", "one more commit"]);
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

async function insertSpec(sessionId: string) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.specs)
    .values({
      id: randomUUID(),
      sessionId,
      markdown: ["## Problem Statement", "", "A settled idea.", "", "## Solution", "", "A workspace."].join(
        "\n",
      ),
      current: true,
      ticketsGeneratedAt: now,
      createdAt: now,
      updatedAt: now,
    });
}

async function ticketIdFor(sessionId: string, number: number): Promise<string> {
  const { tickets } = await listTickets.run({ sessionId });
  return tickets.find((ticket) => ticket.number === number)!.id;
}

/** A session with a generated handoff, ready for `preview-export`, two tickets (02 blocked by 01). */
async function aSessionWithHandoff() {
  const root = repos.create();
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    exportFolder: ".scratch",
  });
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    projectId: project.id,
  });
  const blockerId = await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
  await insertTicket(session.id, {
    number: 2,
    slug: "store-on-disk",
    blockedByJson: JSON.stringify([blockerId]),
  });
  await insertSpec(session.id);
  await generateHandoff.run({ sessionId: session.id });
  return { root, session };
}

/** Grounds `session` right now: a valid result, today's fingerprint, HEAD as read. */
async function groundNow(sessionId: string, root: string): Promise<void> {
  const loaded = await loadHandoffSource(sessionId);
  if (!("source" in loaded)) throw new Error("expected a handoff source");
  await storeBriefGrounding({
    sessionId,
    result: aHandoffScoutResult(),
    commitRead: headOf(root),
    handoffFingerprint: handoffFingerprint(loaded.source),
    model: "sonnet",
    turnId: null,
    ranAt: new Date().toISOString(),
  });
}

describe("preview-export: brief grounding state", () => {
  useTestDatabase();

  it("reports absent when the session has never been grounded, and nothing counts as grounded", async () => {
    const { session } = await aSessionWithHandoff();

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("absent");
    expect(preview.groundingStaleReason).toBeNull();
    // Eligible briefs render fresh from today's template with no grounding
    // to apply, but that is not "grounded": groundedBriefs must stay empty,
    // and every brief must be listed as ungrounded with reason no-grounding.
    expect(preview.groundedBriefs).toEqual([]);
    expect(preview.ungroundedBriefs.map((entry: { ticket: number }) => entry.ticket).sort()).toEqual([1, 2]);
    for (const entry of preview.ungroundedBriefs) {
      expect(entry.reason).toBe("no-grounding");
    }
  });

  it("reports current once a grounding matches today's handoff and HEAD", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root);

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("current");
    expect(preview.groundingStaleReason).toBeNull();
    expect(preview.groundedBriefs.sort()).toEqual([1, 2]);
    expect(preview.ungroundedBriefs).toEqual([]);
  });

  it("reports stale with handoff-changed once a ticket edit outdates the grounding", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root);

    // Removing ticket 2's blocker changes the handoff's fingerprint without
    // regenerating the handoff or moving HEAD.
    await setTicketBlockedBy.run({ ticketId: await ticketIdFor(session.id, 2), blockedBy: [] });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("stale");
    expect(preview.groundingStaleReason).toBe("handoff-changed");
  });

  it("reports stale with head-moved once the project's HEAD moves past the grounded commit", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root);

    commitMore(root);

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("stale");
    expect(preview.groundingStaleReason).toBe("head-moved");
  });

  it("never blocks export on grounding: an absent grounding leaves exportBlocked to the handoff gate alone", async () => {
    const { session } = await aSessionWithHandoff();

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("absent");
    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
  });

  it("never blocks export on grounding: a stale grounding leaves exportBlocked to the handoff gate alone", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root);
    commitMore(root);

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("stale");
    expect(preview.groundingStaleReason).toBe("head-moved");
    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
  });
});
