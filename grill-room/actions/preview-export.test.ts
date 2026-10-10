import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { storeBriefGrounding } from "../server/brief-grounding.js";
import { handoffFingerprint, loadHandoffSource } from "../server/handoff.js";
import type { HandoffScoutResult } from "../server/interviewer/index.js";
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
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

describe("preview-export: delegation proposals", () => {
  useTestDatabase();

  it("lists the grounding's pending delegation proposals; export stays available", async () => {
    const { root, session } = await aSessionWithHandoff();
    const base = aHandoffScoutResult();
    const prune = { command: "just prune", citation: "CLAUDE.md:4" };
    await groundNow(session.id, root, {
      ...base,
      delegationProposals: { ...base.delegationProposals, pruneCommand: prune },
    });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.delegationProposals).toEqual([
      { slot: "pruneCommand", proposal: prune, confirmed: null },
    ]);
    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
  });

  it("lists nothing without a grounding", async () => {
    const { session } = await aSessionWithHandoff();

    expect((await previewExport.run({ sessionId: session.id })).delegationProposals).toEqual([]);
  });

  it("still lists them from a stale grounding", async () => {
    const { root, session } = await aSessionWithHandoff();
    const base = aHandoffScoutResult();
    await groundNow(session.id, root, {
      ...base,
      delegationProposals: { ...base.delegationProposals, reviewRule: { citation: "CLAUDE.md:3" } },
    });
    commitMore(root);

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("stale");
    expect(preview.delegationProposals.map((entry) => entry.slot)).toEqual(["reviewRule"]);
  });
});

describe("preview-export: rule conflicts", () => {
  useTestDatabase();

  const CONFLICT = {
    citation: "CLAUDE.md:12",
    statement: "A new action is listed in the docs.",
    missingFiles: ["AGENTS.md", "docs/actions.md"],
  };

  /** The scout result with one rule on ticket 2 that requires `requiredFiles`. */
  function withRuleOnTicketTwo(requiredFiles: string[]): HandoffScoutResult {
    const base = aHandoffScoutResult();
    return {
      ...base,
      tickets: base.tickets.map((ticket) =>
        ticket.number === 2
          ? {
              ...ticket,
              rules: [{ citation: CONFLICT.citation, statement: CONFLICT.statement, requiredFiles }],
            }
          : ticket,
      ),
    };
  }

  const conflicting = () => withRuleOnTicketTwo(["src/ingest/queue.ts", ...CONFLICT.missingFiles]);

  async function theBaseline(sessionId: string) {
    const { exportBlocked, exportBlockedReason } = await previewExport.run({ sessionId });
    return { exportBlocked, exportBlockedReason };
  }

  it("is empty with no handoff", async () => {
    const root = repos.create();
    const project = await registerProject.run({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" });
    const session = await createSession.run({ title: "No handoff", idea: "An idea.", projectId: project.id });
    await insertSpec(session.id);

    expect((await previewExport.run({ sessionId: session.id })).ruleConflicts).toEqual([]);
  });

  it("is empty with a handoff and no grounding", async () => {
    const { session } = await aSessionWithHandoff();

    expect((await previewExport.run({ sessionId: session.id })).ruleConflicts).toEqual([]);
  });

  it("is empty for a grounding with no conflict", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withRuleOnTicketTwo(["src/ingest/queue.ts"]));

    expect((await previewExport.run({ sessionId: session.id })).ruleConflicts).toEqual([]);
  });

  it("lists a conflict on ticket 2 with its title; export stays as without it", async () => {
    const { root, session } = await aSessionWithHandoff();
    const baseline = await theBaseline(session.id);
    await groundNow(session.id, root, conflicting());

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.ruleConflicts).toEqual([{ ticket: 2, title: "Ticket 2", ...CONFLICT }]);
    expect({ exportBlocked: preview.exportBlocked, exportBlockedReason: preview.exportBlockedReason }).toEqual(
      baseline,
    );
  });

  it("lists the same conflict when ticket 2's brief is hand-edited", async () => {
    const { root, session } = await aSessionWithHandoff();
    await updateHandoff.run({
      sessionId: session.id,
      briefs: [{ ticketNumber: 2, markdown: "# Brief 02: Hand-edited\n\nWritten by hand.\n" }],
    });
    const baseline = await theBaseline(session.id);
    await groundNow(session.id, root, conflicting());

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.ruleConflicts).toEqual([{ ticket: 2, title: "Ticket 2", ...CONFLICT }]);
    expect({ exportBlocked: preview.exportBlocked, exportBlockedReason: preview.exportBlockedReason }).toEqual(
      baseline,
    );
  });

  it("lists the same conflict from a stale grounding", async () => {
    const { root, session } = await aSessionWithHandoff();
    const baseline = await theBaseline(session.id);
    await groundNow(session.id, root, conflicting());
    commitMore(root);

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.groundingState).toBe("stale");
    expect(preview.ruleConflicts).toEqual([{ ticket: 2, title: "Ticket 2", ...CONFLICT }]);
    expect({ exportBlocked: preview.exportBlocked, exportBlockedReason: preview.exportBlockedReason }).toEqual(
      baseline,
    );
  });
});

describe("preview-export: accepted rule conflicts", () => {
  useTestDatabase();

  const CITATION = "CLAUDE.md:12";
  const withClaim = (): HandoffScoutResult => {
    const base = aHandoffScoutResult();
    return {
      ...base,
      tickets: base.tickets.map((ticket) =>
        ticket.number === 2
          ? {
              ...ticket,
              rules: [{ citation: CITATION, statement: "Docs follow the code.", requiredFiles: ["docs/actions.md"] }],
            }
          : ticket,
      ),
    };
  };

  it("lists a waived conflict with its reason, not among the open ones, and leaves the export gate alone", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaim());
    const before = await previewExport.run({ sessionId: session.id });
    expect(before.ruleConflicts).toHaveLength(1);
    expect(before.acceptedRuleConflicts).toEqual([]);

    const { waiverId } = await waiveRuleConflict.run({
      sessionId: session.id,
      ticket: 2,
      citation: CITATION,
      missingFiles: ["docs/actions.md"],
      reason: "Docs are regenerated.",
    });
    const after = await previewExport.run({ sessionId: session.id });

    expect(after.ruleConflicts).toEqual([]);
    expect(after.acceptedRuleConflicts).toEqual([
      {
        ticket: 2,
        title: "Ticket 2",
        citation: CITATION,
        statement: "Docs follow the code.",
        missingFiles: ["docs/actions.md"],
        waiverId,
        reason: "Docs are regenerated.",
      },
    ]);
    expect({ exportBlocked: after.exportBlocked, exportBlockedReason: after.exportBlockedReason }).toEqual({
      exportBlocked: before.exportBlocked,
      exportBlockedReason: before.exportBlockedReason,
    });
  });

  it("is empty with no waiver", async () => {
    const { root, session } = await aSessionWithHandoff();
    await groundNow(session.id, root, withClaim());
    expect((await previewExport.run({ sessionId: session.id })).acceptedRuleConflicts).toEqual([]);
  });
});

describe("preview-export: two roots", () => {
  useTestDatabase();

  /** A session ready to export into a fresh project, with `prepare` run on its root first. */
  async function aTwoRootSession(
    options: {
      gitignore?: string;
      visibility?: "tracked" | "ignored";
      prepare?: (root: string) => Promise<void>;
    } = {},
  ) {
    const root = repos.create({ gitignore: options.gitignore });
    await options.prepare?.(root);
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
      visibility: options.visibility,
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
    await insertSpec(session.id);
    await generateHandoff.run({ sessionId: session.id });
    return { root, session };
  }

  it("reports the durable bundle directory, and whether it exists: not before the first export, then yes", async () => {
    // The working bundle folder already exists; the durable one does not.
    const { root, session } = await aTwoRootSession({
      prepare: async (root) => {
        await fs.mkdir(path.join(root, ".scratch", "grill-room"), { recursive: true });
      },
    });
    const durableBundleDir = path.join(root, "docs", "specs", "grill-room");

    const before = await previewExport.run({ sessionId: session.id });
    expect(before).toMatchObject({
      durableExportFolder: "docs/specs",
      durableBundleDir,
      durableBundleExists: false,
      bundleDir: path.join(root, ".scratch", "grill-room"),
      bundleExists: true,
    });

    await exportSession.run({ sessionId: session.id, slug: before.slug });

    const after = await previewExport.run({ sessionId: session.id });
    expect(after.durableBundleDir).toBe(durableBundleDir);
    expect(after.durableBundleExists).toBe(true);
  });

  it("gives a repo-relative durableBundlePath when git says the durable folder is not ignored, whatever the working folder", async () => {
    const { root, session } = await aTwoRootSession({
      gitignore: ".scratch/\n",
      visibility: "ignored",
    });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.durableBundlePath).toBe("docs/specs/grill-room");
    expect(preview.bundlePath).toBe(path.join(root, ".scratch", "grill-room"));
  });

  it("gives an absolute durableBundlePath when git ignores the durable folder", async () => {
    const { root, session } = await aTwoRootSession({
      gitignore: "docs/specs/\n",
      visibility: "tracked",
    });

    const preview = await previewExport.run({ sessionId: session.id });
    expect(preview.durableBundlePath).toBe(path.join(root, "docs", "specs", "grill-room"));
    // The working folder is not ignored, so the working bundle path stays repo-relative.
    expect(preview.bundlePath).toBe(".scratch/grill-room");
  });

  // The working folder is measured the other way each time, so only the
  // stored flag can give the expected path.
  const symlinkCases: ReadonlyArray<
    ["tracked" | "ignored", string | undefined, (root: string) => string]
  > = [
    ["tracked", ".scratch/\n", () => "docs/specs/grill-room"],
    ["ignored", undefined, (root) => path.join(root, "docs", "specs", "grill-room")],
  ];

  it.each(symlinkCases)(
    "follows the stored flag (%s) when git cannot tell: a symlinked durable folder",
    async (visibility, gitignore, expected) => {
      const { root, session } = await aTwoRootSession({
        visibility,
        gitignore,
        prepare: async (root) => {
          await fs.mkdir(path.join(root, "real-specs"));
          await fs.mkdir(path.join(root, "docs"));
          await fs.symlink(path.join(root, "real-specs"), path.join(root, "docs", "specs"));
        },
      });

      const preview = await previewExport.run({ sessionId: session.id });
      expect(preview.durableBundlePath).toBe(expected(root));
    },
  );
});

describe("preview-export: durable folder ignored", () => {
  useTestDatabase();

  async function aSessionIn(options: {
    gitignore?: string;
    handoff?: boolean;
    slugFiles?: boolean;
    prepare?: (root: string) => Promise<void>;
  }) {
    const root = repos.create({ gitignore: options.gitignore });
    await options.prepare?.(root);
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
    await insertTicket(session.id, { number: 1, slug: "build-the-workspace" });
    await insertSpec(session.id);
    if (options.handoff !== false) await generateHandoff.run({ sessionId: session.id });
    return { root, session };
  }

  it("reports the gate when git confirms the durable folder is ignored", async () => {
    const { session } = await aSessionIn({ gitignore: "docs/specs/\n" });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportBlocked).toBe(true);
    expect(preview.exportBlockedReason).toBe("durable-folder-ignored");
    expect(preview.durableFolderIgnored).toBe(true);
  });

  it("does not report it when the durable folder is not ignored, even with the working folder ignored", async () => {
    const { session } = await aSessionIn({ gitignore: ".scratch/\n" });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
    expect(preview.durableFolderIgnored).toBe(false);
  });

  it("does not report it when git cannot tell: a symlinked durable folder", async () => {
    const { session } = await aSessionIn({
      prepare: async (root) => {
        await fs.mkdir(path.join(root, "real-specs"));
        await fs.mkdir(path.join(root, "docs"));
        await fs.symlink(path.join(root, "real-specs"), path.join(root, "docs", "specs"));
      },
    });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
    expect(preview.durableFolderIgnored).toBe(false);
  });

  it("names the handoff reason first and still reports durableFolderIgnored: true", async () => {
    const { session } = await aSessionIn({ gitignore: "docs/specs/\n", handoff: false });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportBlocked).toBe(true);
    expect(preview.exportBlockedReason).toBe("handoff-missing");
    expect(preview.durableFolderIgnored).toBe(true);
  });

  it("measures the durable bundle folder: a rule for docs/specs/a/ refuses slug a and lets slug b through", async () => {
    const { session } = await aSessionIn({ gitignore: "docs/specs/a/\n" });

    const refused = await previewExport.run({ sessionId: session.id, slug: "a" });
    expect(refused.exportBlockedReason).toBe("durable-folder-ignored");
    await expect(exportSession.run({ sessionId: session.id, slug: "a" })).rejects.toMatchObject({
      errorCode: "durable-folder-ignored",
    });

    const allowed = await previewExport.run({ sessionId: session.id, slug: "b" });
    expect(allowed.exportBlockedReason).toBeNull();
    expect(allowed.durableFolderIgnored).toBe(false);
    const result = await exportSession.run({ sessionId: session.id, slug: "b" });
    expect(result.written.length).toBeGreaterThan(0);
  });
});

describe("preview-export: retired export", () => {
  useTestDatabase();

  async function aRetiredSession() {
    const { root, session } = await aSessionWithHandoff();
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    await fs.rm(path.join(root, ".scratch", "grill-room"), { recursive: true });
    return { root, session };
  }

  it("not retired after an export: exportRetired false, no folder, not blocked", async () => {
    const { session } = await aSessionWithHandoff();
    await exportSession.run({ sessionId: session.id, slug: "grill-room" });

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportRetired).toBe(false);
    expect(preview.retiredWorkingFolder).toBeNull();
    expect(preview.exportBlockedReason).toBeNull();
  });

  it("retired without the override: names the folder and is blocked export-retired", async () => {
    const { session } = await aRetiredSession();

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportRetired).toBe(true);
    expect(preview.retiredWorkingFolder).toBe(".scratch/grill-room");
    expect(preview.exportBlocked).toBe(true);
    expect(preview.exportBlockedReason).toBe("export-retired");
  });

  it("retired with reexportRetired true: still reported retired, but not blocked", async () => {
    const { session } = await aRetiredSession();

    const preview = await previewExport.run({ sessionId: session.id, reexportRetired: true });

    expect(preview.exportRetired).toBe(true);
    expect(preview.retiredWorkingFolder).toBe(".scratch/grill-room");
    expect(preview.exportBlocked).toBe(false);
    expect(preview.exportBlockedReason).toBeNull();
  });

  it("retired and durable folder ignored reports durable-folder-ignored", async () => {
    const { root, session } = await aRetiredSession();
    await fs.writeFile(path.join(root, ".gitignore"), "docs/specs/\n", "utf8");

    const preview = await previewExport.run({ sessionId: session.id });

    expect(preview.exportRetired).toBe(true);
    expect(preview.exportBlockedReason).toBe("durable-folder-ignored");
  });

  it("retired, a different slug: still blocked export-retired", async () => {
    const { session } = await aRetiredSession();

    const preview = await previewExport.run({ sessionId: session.id, slug: "another" });

    expect(preview.exportRetired).toBe(true);
    expect(preview.exportBlockedReason).toBe("export-retired");
  });
});
