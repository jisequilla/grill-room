import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import exportSession from "./export-session.js";
import generateHandoff from "./generate-handoff.js";
import getExportVisibility from "./get-export-visibility.js";
import registerProject from "./register-project.js";

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

async function aProject(options: { files?: Record<string, string> } = {}) {
  const root = repos.create({ files: options.files });
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    workingExportFolder: ".scratch",
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

async function insertSpec(sessionId: string) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.specs)
    .values({
      id: randomUUID(),
      sessionId,
      markdown: SPEC_MARKDOWN,
      current: true,
      createdAt: now,
      updatedAt: now,
    });
}

async function insertTicket(sessionId: string) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.tickets)
    .values({
      id: randomUUID(),
      sessionId,
      number: 1,
      slug: "the-ticket",
      title: "The ticket",
      body: "Do the work.",
      status: "ready",
      blockedByJson: "[]",
      createdAt: now,
      updatedAt: now,
    });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe("get-export-visibility", () => {
  useTestDatabase();

  it("throws for a session id that does not exist, same as preview-export", async () => {
    await expect(
      getExportVisibility.run({ sessionId: "missing", slug: "x" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("refuses a session without a project", async () => {
    const session = await aSession("Grill Room");
    await insertSpec(session.id);

    await expect(
      getExportVisibility.run({ sessionId: session.id, slug: "grill-room" }),
    ).rejects.toMatchObject({ errorCode: "no-project" });
  });

  it("classifies without writing anything to disk", async () => {
    const { root, project } = await aProject();
    const session = await aSession("Grill Room", project.id);
    await insertSpec(session.id);

    const report = await getExportVisibility.run({ sessionId: session.id, slug: "grill-room" });

    expect(report.files).toEqual([
      {
        path: path.join(root, ".scratch", "grill-room", "spec.md"),
        relativePath: ".scratch/grill-room/spec.md",
        visibility: "untracked",
      },
      {
        path: path.join(root, ".scratch", "grill-room", "intent.md"),
        relativePath: ".scratch/grill-room/intent.md",
        visibility: "untracked",
      },
      {
        path: path.join(root, ".scratch", "grill-room", ".grill-room-export.json"),
        relativePath: ".scratch/grill-room/.grill-room-export.json",
        visibility: "untracked",
      },
    ]);
    expect(report.hasUntracked).toBe(true);
    expect(await pathExists(path.join(root, ".scratch"))).toBe(false);
  });

  it("re-checks the same files export-session wrote, agreeing with its own report", async () => {
    const { project } = await aProject();
    const session = await aSession("Grill Room", project.id);
    await insertTicket(session.id);
    await insertSpec(session.id);
    await generateHandoff.run({ sessionId: session.id });

    const exported = await exportSession.run({ sessionId: session.id, slug: "grill-room" });
    const recheck = await getExportVisibility.run({ sessionId: session.id, slug: "grill-room" });

    expect(recheck).toEqual(exported.visibility);
  });

  it("reflects a bundle already committed as tracked, once re-checked", async () => {
    const { project } = await aProject({
      files: {
        ".scratch/grill-room/spec.md": "already committed",
        ".scratch/grill-room/intent.md": "already committed",
        ".scratch/grill-room/.grill-room-export.json": JSON.stringify({
          version: 1,
          files: [],
        }),
      },
    });
    const session = await aSession("Grill Room", project.id);
    await insertSpec(session.id);

    const report = await getExportVisibility.run({ sessionId: session.id, slug: "grill-room" });

    expect(report.files.every((file) => file.visibility === "tracked")).toBe(true);
    expect(report.warning).toBeNull();
    expect(report.mismatchWarning).toBeNull();
  });
});
