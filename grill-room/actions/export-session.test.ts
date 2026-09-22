import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import setExportTarget from "./set-export-target.js";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function aSession(title = "Grill Room") {
  return createSession.run({
    title,
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

const SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
].join("\n");

/**
 * `ticketsCurrent: true` sets `ticketsGeneratedAt` to the same timestamp as
 * `updatedAt` (rather than a separately-computed `new Date()`), so the spec's
 * tickets are current by construction instead of by timing luck.
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
  overrides: Partial<typeof schema.tickets.$inferInsert> & {
    number: number;
    slug: string;
  },
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

async function targetDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "grill-room-export-"));
}

async function pointAt(sessionId: string, folder: string) {
  await setExportTarget.run({ sessionId, folder });
}

describe("export-session", () => {
  useTestDatabase();

  const tmpDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function newTargetDir(): Promise<string> {
    const dir = await targetDir();
    tmpDirs.push(dir);
    return dir;
  }

  it("throws for a session id that does not exist", async () => {
    await expect(exportSession.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("refuses when no export target is set", async () => {
    const session = await aSession();
    await insertSpec(session.id);

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "no-export-target" });
  });

  it("refuses when the session has no spec", async () => {
    const session = await aSession();
    await pointAt(session.id, await newTargetDir());

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "spec-missing" });
  });

  it("refuses when the spec is not current", async () => {
    const session = await aSession();
    await pointAt(session.id, await newTargetDir());
    await insertSpec(session.id, { current: false });

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "spec-not-current" });
  });

  it("refuses when the target folder does not exist", async () => {
    const session = await aSession();
    await pointAt(session.id, "/definitely/does/not/exist/anywhere");
    await insertSpec(session.id);

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "target-not-found" });
  });

  it("refuses when the target is a file, not a directory", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    const filePath = path.join(dir, "not-a-directory");
    await fs.writeFile(filePath, "not a directory");
    await pointAt(session.id, filePath);
    await insertSpec(session.id);

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "target-not-directory" });
  });

  it.skipIf(isRoot)("refuses when the target folder is not writable", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await fs.chmod(dir, 0o500);
    await pointAt(session.id, dir);
    await insertSpec(session.id);

    try {
      await expect(
        exportSession.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "target-not-writable" });
    } finally {
      await fs.chmod(dir, 0o700);
    }
  });

  it("writes the exact spec.md and issue file names and content for a full export", async () => {
    const session = await aSession("Grill Room");
    const dir = await newTargetDir();
    await pointAt(session.id, dir);

    const blockerId = await insertTicket(session.id, {
      number: 1,
      slug: "build-the-workspace",
    });
    await insertTicket(session.id, {
      number: 2,
      slug: "store-on-disk",
      blockedByJson: JSON.stringify([blockerId]),
    });
    const spec = await insertSpec(session.id, { ticketsCurrent: true });

    const result = await exportSession.run({ sessionId: session.id });

    const featureDir = path.join(dir, ".scratch", "grill-room");
    expect(result).toMatchObject({
      folder: dir,
      ticketsExported: true,
      ticketsSkippedReason: null,
    });
    expect(result.files).toEqual([
      path.join(featureDir, "spec.md"),
      path.join(featureDir, "issues", "01-build-the-workspace.md"),
      path.join(featureDir, "issues", "02-store-on-disk.md"),
    ]);

    const specContent = await fs.readFile(path.join(featureDir, "spec.md"), "utf8");
    expect(specContent).toBe(
      `# Grill Room\n\nStatus: ready-for-agent\n\n${spec.markdown}`,
    );

    const noBlockers = await fs.readFile(
      path.join(featureDir, "issues", "01-build-the-workspace.md"),
      "utf8",
    );
    expect(noBlockers).toBe(
      "# 01 Ticket 1\n\nStatus: ready-for-agent\nBlocked by: none\n\nDo the work of ticket 1.",
    );

    const withBlockers = await fs.readFile(
      path.join(featureDir, "issues", "02-store-on-disk.md"),
      "utf8",
    );
    expect(withBlockers).toBe(
      "# 02 Ticket 2\n\nStatus: ready-for-agent\nBlocked by: 01\n\nDo the work of ticket 2.",
    );
  });

  it("exports the spec only when the session has no tickets", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertSpec(session.id);

    const result = await exportSession.run({ sessionId: session.id });

    expect(result.ticketsExported).toBe(false);
    expect(result.ticketsSkippedReason).toMatch(/no tickets/i);
    expect(result.files).toEqual([
      path.join(dir, ".scratch", "grill-room", "spec.md"),
    ]);
    await expect(
      fs.stat(path.join(dir, ".scratch", "grill-room", "issues")),
    ).rejects.toThrow();
  });

  it("exports the spec only when tickets are out of date with the spec", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertSpec(session.id, {
      updatedAt: "2030-01-02T00:00:00.000Z",
      ticketsGeneratedAt: "2030-01-01T00:00:00.000Z",
    });
    await insertTicket(session.id, { number: 1, slug: "stale-ticket" });

    const result = await exportSession.run({ sessionId: session.id });

    expect(result.ticketsExported).toBe(false);
    expect(result.ticketsSkippedReason).toMatch(/out of date/i);
    expect(result.files).toEqual([
      path.join(dir, ".scratch", "grill-room", "spec.md"),
    ]);
  });

  it("writes nothing and lists existing files when files already exist and overwrite is not set", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertSpec(session.id);
    await exportSession.run({ sessionId: session.id });

    await expect(
      exportSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({
      errorCode: "files-exist",
      details: {
        existing: [path.join(dir, ".scratch", "grill-room", "spec.md")],
      },
    });
  });

  it("overwrite: true replaces existing files but leaves unrelated files in issues/ untouched", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertTicket(session.id, {
      number: 1,
      slug: "build-the-workspace",
    });
    await insertSpec(session.id, { ticketsCurrent: true });

    await exportSession.run({ sessionId: session.id });

    const featureDir = path.join(dir, ".scratch", "grill-room");
    const unrelatedPath = path.join(featureDir, "issues", "99-unrelated.md");
    await fs.writeFile(unrelatedPath, "left alone");

    await fs.writeFile(path.join(featureDir, "spec.md"), "stale content");

    const result = await exportSession.run({
      sessionId: session.id,
      overwrite: true,
    });

    expect(result.ticketsExported).toBe(true);
    const specContent = await fs.readFile(path.join(featureDir, "spec.md"), "utf8");
    expect(specContent).not.toBe("stale content");
    const unrelatedContent = await fs.readFile(unrelatedPath, "utf8");
    expect(unrelatedContent).toBe("left alone");
  });

  it("falls back to a session-id slug when the title has no usable characters", async () => {
    const session = await aSession("!!! *** ???");
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertSpec(session.id);

    const result = await exportSession.run({ sessionId: session.id });

    const expectedDir = path.join(
      dir,
      ".scratch",
      `session-${session.id.slice(0, 8)}`,
    );
    expect(result.files).toEqual([path.join(expectedDir, "spec.md")]);
  });

  it("pads ticket numbers to three digits once there are 100 or more tickets", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);

    const db = getDb();
    const now = new Date().toISOString();
    await db.insert(schema.tickets).values(
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

    const result = await exportSession.run({ sessionId: session.id });

    const featureDir = path.join(dir, ".scratch", "grill-room");
    expect(result.files[1]).toBe(
      path.join(featureDir, "issues", "001-ticket-1.md"),
    );
    expect(result.files[100]).toBe(
      path.join(featureDir, "issues", "100-ticket-100.md"),
    );
  });

  it("cannot write outside the feature directory even with a malicious ticket slug", async () => {
    const session = await aSession();
    const dir = await newTargetDir();
    await pointAt(session.id, dir);
    await insertTicket(session.id, { number: 1, slug: "../../evil" });
    await insertSpec(session.id, { ticketsCurrent: true });

    const result = await exportSession.run({ sessionId: session.id });

    const featureDir = path.join(dir, ".scratch", "grill-room");
    for (const file of result.files) {
      expect(file.startsWith(featureDir + path.sep) || file === featureDir).toBe(
        true,
      );
    }
    expect(result.files[1]).toBe(path.join(featureDir, "issues", "01-evil.md"));
    await expect(fs.stat(path.join(dir, "evil.md"))).rejects.toThrow();
    await expect(
      fs.stat(path.join(dir, ".scratch", "evil.md")),
    ).rejects.toThrow();
  });
});
