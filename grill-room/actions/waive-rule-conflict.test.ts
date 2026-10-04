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

describe("waive-rule-conflict", () => {
  useTestDatabase();

  const REASON = "The docs are updated at release.";
  const input = (sessionId: string, overrides: Partial<Parameters<typeof waiveRuleConflict.run>[0]> = {}) => ({
    sessionId,
    ticket: 2,
    citation: "AGENTS.md:10",
    missingFiles: ["docs/a.md"],
    reason: REASON,
    ...overrides,
  });

  it("stores the waiver and returns the recomputed lists", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));

    const result = await waiveRuleConflict.run(input(session.id, { reason: "  a\n\n  b " }));

    expect(result.ruleConflicts).toEqual([]);
    expect(result.acceptedRuleConflicts).toEqual([
      {
        ticket: 2,
        title: "Ticket 2",
        citation: "AGENTS.md:10",
        statement: "A change updates the docs.",
        missingFiles: ["docs/a.md"],
        waiverId: result.waiverId,
        reason: "a b",
      },
    ]);
    const rows = await waiverRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.waiverId,
      sessionId: session.id,
      ticketId: await ticketIdFor(session.id, 2),
      rulePath: "AGENTS.md",
      missingFilesJson: JSON.stringify(["docs/a.md"]),
      reason: "a b",
    });
  });

  it("refuses a reason that is blank after trimming, over 500 characters, or a missing-file list that is empty", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
    for (const refused of [
      { reason: "\n " },
      { reason: "x".repeat(501) },
      { missingFiles: [] },
    ]) {
      await expect(waiveRuleConflict.run(input(session.id, refused))).rejects.toThrow(/Invalid action parameters/);
    }
    expect(await waiverRows(session.id)).toHaveLength(0);

    await waiveRuleConflict.run(input(session.id, { reason: "x".repeat(500) }));
    expect(await waiverRows(session.id)).toHaveLength(1);
  });

  describe("refusals write nothing", () => {
    it("1: no such session", async () => {
      await expect(waiveRuleConflict.run(input("missing"))).rejects.toMatchObject({ statusCode: 404 });
      expect(await getDb().select().from(schema.ruleWaivers)).toHaveLength(0);
    });

    it("2: the session has no handoff", async () => {
      const root = repos.create();
      const project = await registerProject.run({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" });
      const session = await createSession.run({ title: "No handoff", idea: "An idea.", projectId: project.id });
      await insertSpec(session.id);
      await expect(waiveRuleConflict.run(input(session.id))).rejects.toMatchObject({
        errorCode: "handoff-missing",
        statusCode: 409,
      });
      expect(await waiverRows(session.id)).toHaveLength(0);
    });

    it("3: the handoff source cannot load", async () => {
      const { root, session } = await aSessionWithHandoff();
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
      await getDb().delete(schema.tickets).where(eq(schema.tickets.sessionId, session.id));
      await expect(waiveRuleConflict.run(input(session.id))).rejects.toMatchObject({
        errorCode: "no-tickets",
        statusCode: 409,
      });
      expect(await waiverRows(session.id)).toHaveLength(0);
    });

    it("4: no open conflict has that ticket, citation and missing files", async () => {
      const { root, session } = await aSessionWithHandoff();
      await expect(waiveRuleConflict.run(input(session.id))).rejects.toMatchObject({
        errorCode: "no-such-conflict",
        statusCode: 409,
      });
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
      for (const wrong of [
        { ticket: 1 },
        { citation: "AGENTS.md:11" },
        { missingFiles: ["docs/b.md"] },
        { missingFiles: ["docs/a.md", "docs/b.md"] },
      ]) {
        await expect(waiveRuleConflict.run(input(session.id, wrong))).rejects.toMatchObject({
          errorCode: "no-such-conflict",
          statusCode: 409,
        });
      }
      expect(await waiverRows(session.id)).toHaveLength(0);
    });

    it("4: a conflict that is already accepted", async () => {
      const { root, session } = await aSessionWithHandoff();
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
      await waiveRuleConflict.run(input(session.id));
      await expect(waiveRuleConflict.run(input(session.id))).rejects.toMatchObject({
        errorCode: "no-such-conflict",
        statusCode: 409,
      });
      expect(await waiverRows(session.id)).toHaveLength(1);
    });
  });

  it("matches the missing files in any order and spelling, and stores the conflict's own", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/b.md", "./docs/a.md"])]));
    await waiveRuleConflict.run(input(session.id, { missingFiles: ["docs/a.md", "docs/b.md"] }));
    const [row] = await waiverRows(session.id);
    expect(row!.missingFilesJson).toBe(JSON.stringify(["docs/b.md", "./docs/a.md"]));
  });

  it("tells two conflicts on one ticket and citation apart by their missing files", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(
      session.id,
      root,
      withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"]), claim("AGENTS.md:10", ["docs/b.md"])]),
    );
    const result = await waiveRuleConflict.run(input(session.id, { missingFiles: ["docs/b.md"] }));
    expect(result.acceptedRuleConflicts.map((each) => each.missingFiles)).toEqual([["docs/b.md"]]);
    expect(result.ruleConflicts.map((each) => each.missingFiles)).toEqual([["docs/a.md"]]);
  });

  it("one waiver accepts both claims on the same rule file", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(
      session.id,
      root,
      withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"]), claim("AGENTS.md:40", ["docs/a.md"])]),
    );
    const result = await waiveRuleConflict.run(input(session.id));
    expect(result.ruleConflicts).toEqual([]);
    expect(result.acceptedRuleConflicts.map((each) => [each.citation, each.waiverId])).toEqual([
      ["AGENTS.md:10", result.waiverId],
      ["AGENTS.md:40", result.waiverId],
    ]);
    await expect(waiveRuleConflict.run(input(session.id, { citation: "AGENTS.md:40" }))).rejects.toMatchObject({
      errorCode: "no-such-conflict",
    });
    expect(await waiverRows(session.id)).toHaveLength(1);
  });

  describe("a waiver across re-groundings", () => {
    async function aWaivedConflict() {
      const { root, session } = await aSessionWithHandoff();
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
      const { waiverId } = await waiveRuleConflict.run(input(session.id));
      return { root, session, waiverId };
    }

    it("survives a re-grounding that finds the same conflict, on other lines", async () => {
      const { root, session, waiverId } = await aWaivedConflict();
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:55-60", ["docs/a.md"])]));
      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.ruleConflicts).toEqual([]);
      expect(preview.acceptedRuleConflicts.map((each) => [each.citation, each.waiverId])).toEqual([
        ["AGENTS.md:55-60", waiverId],
      ]);
    });

    it.each([
      ["the missing files change", 2, "AGENTS.md:10", ["docs/a.md", "docs/b.md"]],
      ["the rule file changes", 2, "CLAUDE.md:10", ["docs/a.md"]],
      ["the claim moves to another ticket", 1, "AGENTS.md:10", ["docs/a.md"]],
    ])("lapses when %s", async (_label, ticket, citation, required) => {
      const { root, session } = await aWaivedConflict();
      await groundNow(session.id, root, withClaimsOnTicket(ticket, [claim(citation, required)]));
      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.ruleConflicts.map((each) => [each.ticket, each.citation])).toEqual([[ticket, citation]]);
      expect(preview.acceptedRuleConflicts).toEqual([]);
      expect(await waiverRows(session.id)).toHaveLength(1);
    });

    it("lapses quietly when a grounding widens the boundaries, and applies again when it narrows", async () => {
      const { root, session, waiverId } = await aWaivedConflict();
      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])], ["docs/a.md"]));
      const widened = await previewExport.run({ sessionId: session.id });
      expect(widened.ruleConflicts).toEqual([]);
      expect(widened.acceptedRuleConflicts).toEqual([]);
      expect(await waiverRows(session.id)).toHaveLength(1);

      await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
      const narrowed = await previewExport.run({ sessionId: session.id });
      expect(narrowed.acceptedRuleConflicts.map((each) => each.waiverId)).toEqual([waiverId]);
    });
  });

  it("accepting and removing a waiver keep the handoff and the grounding current", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaimsOnTicket(2, [claim("AGENTS.md:10", ["docs/a.md"])]));
    const state = async () => {
      const preview = await previewExport.run({ sessionId: session.id });
      return {
        groundingState: preview.groundingState,
        groundingStaleReason: preview.groundingStaleReason,
        exportBlocked: preview.exportBlocked,
        exportBlockedReason: preview.exportBlockedReason,
      };
    };
    const before = await state();
    expect(before).toEqual({
      groundingState: "current",
      groundingStaleReason: null,
      exportBlocked: false,
      exportBlockedReason: null,
    });

    const { waiverId } = await waiveRuleConflict.run(input(session.id));
    expect(await state()).toEqual(before);

    await removeRuleWaiver.run({ sessionId: session.id, waiverId });
    expect(await state()).toEqual(before);
  });
});
