import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { storeBriefGrounding } from "../server/brief-grounding.js";
import { handoffFingerprint, loadHandoffSource } from "../server/handoff.js";
import type { HandoffScoutResult } from "../server/interviewer/index.js";
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import generateHandoff from "./generate-handoff.js";
import listTickets from "./list-tickets.js";
import previewExport from "./preview-export.js";
import registerProject from "./register-project.js";
import removeRuleWaiver from "./remove-rule-waiver.js";
import waiveRuleConflict from "./waive-rule-conflict.js";

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
    workingExportFolder: ".scratch",
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
async function groundNow(
  sessionId: string,
  root: string,
  result: HandoffScoutResult = aHandoffScoutResult(),
): Promise<void> {
  const loaded = await loadHandoffSource(sessionId);
  if (!("source" in loaded)) throw new Error("expected a handoff source");
  await storeBriefGrounding({
    sessionId,
    result,
    commitRead: headOf(root),
    handoffFingerprint: handoffFingerprint(loaded.source),
    model: "sonnet",
    turnId: null,
    ranAt: new Date().toISOString(),
  });
}


type Claim = { citation: string; statement: string; requiredFiles: string[] };

/** The default scout result with `claims` as the rules of ticket `ticket`; `extraFiles` widen its boundaries. */
function withClaimsOnTicket(ticket: number, claims: Claim[], extraFiles: string[] = []): HandoffScoutResult {
  const base = aHandoffScoutResult();
  return {
    ...base,
    tickets: base.tickets.map((entry) =>
      entry.number === ticket
        ? {
            ...entry,
            filesToChange: [
              ...entry.filesToChange,
              ...extraFiles.map((file) => ({ path: file, change: "edit" as const })),
            ],
            rules: claims,
          }
        : { ...entry, rules: [] },
    ),
  };
}

const claim = (citation: string, requiredFiles: string[]): Claim => ({
  citation,
  statement: "A change updates the docs.",
  requiredFiles,
});

async function waiverRows(sessionId: string) {
  return getDb().select().from(schema.ruleWaivers).where(eq(schema.ruleWaivers.sessionId, sessionId));
}

describe("remove-rule-waiver", () => {
  useTestDatabase();

  async function insertWaiver(sessionId: string, ticketId: string, overrides: Partial<typeof schema.ruleWaivers.$inferInsert> = {}) {
    const id = overrides.id ?? randomUUID();
    await getDb()
      .insert(schema.ruleWaivers)
      .values({
        id,
        sessionId,
        ticketId,
        rulePath: "AGENTS.md",
        missingFilesJson: JSON.stringify(["docs/a.md"]),
        reason: "At release.",
        createdAt: new Date().toISOString(),
        ...overrides,
      });
    return id;
  }

  it("deletes the waiver and returns the conflict open again", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
    const { waiverId } = await waiveRuleConflict.run({
      sessionId: session.id,
      ticket: 2,
      citation: "AGENTS.md:10",
      missingFiles: ["docs/a.md"],
      reason: "At release.",
    });

    const result = await removeRuleWaiver.run({ sessionId: session.id, waiverId });

    expect(result.acceptedRuleConflicts).toEqual([]);
    expect(result.ruleConflicts.map((each) => each.citation)).toEqual(["AGENTS.md:10"]);
    expect(await waiverRows(session.id)).toHaveLength(0);
  });

  it("deletes only the session's own waiver, and refuses an id the session does not hold", async () => {
    const first = await aSessionWithHandoff();
    const second = await aSessionWithHandoff();
    const firstWaiver = await insertWaiver(first.session.id, await ticketIdFor(first.session.id, 2));
    const secondWaiver = await insertWaiver(second.session.id, await ticketIdFor(second.session.id, 2));

    await expect(removeRuleWaiver.run({ sessionId: first.session.id, waiverId: secondWaiver })).rejects.toMatchObject({
      errorCode: "waiver-not-found",
      statusCode: 404,
    });
    await expect(removeRuleWaiver.run({ sessionId: first.session.id, waiverId: "unknown" })).rejects.toMatchObject({
      errorCode: "waiver-not-found",
      statusCode: 404,
    });
    expect(await getDb().select().from(schema.ruleWaivers)).toHaveLength(2);

    await removeRuleWaiver.run({ sessionId: first.session.id, waiverId: firstWaiver });
    expect((await getDb().select().from(schema.ruleWaivers)).map((row) => row.id)).toEqual([secondWaiver]);
  });

  it("refuses an unknown session with 404, not as an unknown waiver", async () => {
    let refused: { statusCode?: number; errorCode?: string } | undefined;
    try {
      await removeRuleWaiver.run({ sessionId: "missing", waiverId: "w" });
    } catch (error) {
      refused = error as { statusCode?: number; errorCode?: string };
    }
    expect(refused!.statusCode).toBe(404);
    expect(refused!.errorCode).not.toBe("waiver-not-found");
  });

  it("removes a lapsed waiver", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
    const waiverId = await insertWaiver(session.id, await ticketIdFor(session.id, 2), {
      missingFilesJson: JSON.stringify(["docs/other.md"]),
    });

    const result = await removeRuleWaiver.run({ sessionId: session.id, waiverId });

    expect(result.ruleConflicts.map((each) => each.citation)).toEqual(["AGENTS.md:10"]);
    expect(await waiverRows(session.id)).toHaveLength(0);
  });

  it("deletes the row and returns both lists empty when the session has no handoff", async () => {
    const root = repos.create();
    const project = await registerProject.run({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" });
    const session = await createSession.run({ title: "No handoff", idea: "An idea.", projectId: project.id });
    const ticketId = await insertTicket(session.id, { number: 1, slug: "only" });
    const waiverId = await insertWaiver(session.id, ticketId);

    const result = await removeRuleWaiver.run({ sessionId: session.id, waiverId });

    expect(result).toEqual({ ruleConflicts: [], acceptedRuleConflicts: [] });
    expect(await waiverRows(session.id)).toHaveLength(0);
  });

  it("deletes the row and returns both lists empty when the handoff source cannot load", async () => {
    const { session } = await aSessionWithHandoff();
    const waiverId = await insertWaiver(session.id, await ticketIdFor(session.id, 2));
    await getDb().update(schema.sessions).set({ projectId: null }).where(eq(schema.sessions.id, session.id));

    const result = await removeRuleWaiver.run({ sessionId: session.id, waiverId });

    expect(result).toEqual({ ruleConflicts: [], acceptedRuleConflicts: [] });
    expect(await waiverRows(session.id)).toHaveLength(0);
  });
});
