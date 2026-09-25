import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import getProject from "./get-project.js";
import getSession from "./get-session.js";
import listProjects from "./list-projects.js";
import refreshProjectTracker from "./refresh-project-tracker.js";
import registerProject from "./register-project.js";
import setSessionProject from "./set-session-project.js";
import suggestProjectDefaults from "./suggest-project-defaults.js";
import updateProject from "./update-project.js";

const repos = useTempGitRepos();

/** Add a bare remote to a temp repo — for delivery-recipe guessing tests only, never a write the app's own read-only git wrapper allows. */
function addRemote(root: string, url = "https://example.invalid/repo.git"): void {
  execFileSync("git", ["-C", root, "remote", "add", "origin", url], { stdio: "ignore" });
}

describe("project actions", () => {
  useTestDatabase();

  async function aProject(options: Parameters<typeof repos.create>[0] = {}) {
    const root = repos.create(options);
    return registerProject.run({ root, verifyCommand: "pnpm test", exportFolder: ".scratch" });
  }

  it("register-project refuses with the registry's error code", async () => {
    await expect(
      registerProject.run({
        root: repos.plainFolder(),
        verifyCommand: "pnpm test",
        exportFolder: ".scratch",
      }),
    ).rejects.toMatchObject({ errorCode: "not-a-git-repo" });

    await expect(
      registerProject.run({ root: repos.create(), verifyCommand: " ", exportFolder: ".scratch" }),
    ).rejects.toMatchObject({ errorCode: "verify-command-required" });
  });

  it("register-project stores the project and list/get read it back", async () => {
    const root = repos.create({ files: { "app/index.ts": "export {};\n" } });

    const project = await registerProject.run({
      root: path.join(root, "app"),
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });

    expect(project.rootPath).toBe(root);
    expect(await listProjects.run({})).toEqual([project]);
    expect(await getProject.run({ id: project.id })).toEqual(project);
    await expect(getProject.run({ id: "missing" })).rejects.toMatchObject({
      errorCode: "project-not-found",
    });
  });

  it("update-project edits a project and refuses a clash with another's root", async () => {
    const first = await aProject();
    const second = await aProject();

    const updated = await updateProject.run({ id: first.id, name: "Renamed" });
    expect(updated).toMatchObject({ id: first.id, name: "Renamed" });

    await expect(
      updateProject.run({ id: second.id, root: first.rootPath }),
    ).rejects.toMatchObject({ errorCode: "project-exists" });
  });

  it("register-project defaults the delivery recipe from the repository's remotes", async () => {
    const withRemote = repos.create();
    addRemote(withRemote);
    const withoutRemote = repos.create();

    const projectWithRemote = await registerProject.run({
      root: withRemote,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    const projectWithoutRemote = await registerProject.run({
      root: withoutRemote,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });

    expect(projectWithRemote.deliveryRecipe).toBe("pull-request");
    expect(projectWithoutRemote.deliveryRecipe).toBe("local-merge");
    expect(projectWithRemote.adversarialReview).toBe(true);
  });

  it("register-project lets an explicit delivery recipe win over the guess", async () => {
    const withRemote = repos.create();
    addRemote(withRemote);

    const project = await registerProject.run({
      root: withRemote,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
      deliveryRecipe: "local-merge",
    });

    expect(project.deliveryRecipe).toBe("local-merge");
  });

  it("update-project changes the delivery recipe and the review switch", async () => {
    const project = await aProject();

    const updated = await updateProject.run({
      id: project.id,
      deliveryRecipe: "pull-request",
      adversarialReview: false,
    });

    expect(updated).toMatchObject({ deliveryRecipe: "pull-request", adversarialReview: false });
    expect(await getProject.run({ id: project.id })).toMatchObject({
      deliveryRecipe: "pull-request",
      adversarialReview: false,
    });
  });

  it("suggest-project-defaults detects the root, verify command and visibility", async () => {
    const root = repos.create({
      files: {
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        "pnpm-lock.yaml": "",
      },
      gitignore: ".scratch/\n",
    });

    expect(
      await suggestProjectDefaults.run({ folder: root, exportFolder: ".scratch" }),
    ).toEqual({
      root,
      name: path.basename(root),
      verifyCommand: "pnpm test",
      visibility: "ignored",
      exportFolder: ".scratch",
      trackerExportFolder: null,
      trackerSlugPattern: null,
    });
    await expect(
      suggestProjectDefaults.run({ folder: repos.plainFolder() }),
    ).rejects.toMatchObject({ errorCode: "not-a-git-repo" });
  });

  it("suggest-project-defaults proposes an export folder and slug pattern from a valid tracker", async () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
tickets_dir: .scratch/tickets
ticket_format: "{seq}-{slug}"
commands:
  claim: bd update {id} --claim
---
`,
      },
    });

    expect(await suggestProjectDefaults.run({ folder: root })).toMatchObject({
      trackerExportFolder: ".scratch/tickets",
      trackerSlugPattern: "{seq}-{slug}",
    });
  });
});

describe("a project's declared tracker", () => {
  useTestDatabase();

  const TRACKER_PATH = "docs/agents/issue-tracker.md";

  function validTrackerBlock(ticketsDir = ".scratch/tickets", commands: Record<string, string> = { claim: "bd update {id} --claim" }) {
    const commandLines = Object.entries(commands)
      .map(([name, command]) => `  ${name}: ${command}`)
      .join("\n");
    return `---\ntickets_dir: ${ticketsDir}\nticket_format: "{seq}-{slug}"\ncommands:\n${commandLines}\n---\n`;
  }

  it("pre-fills export folder and slug pattern from a valid tracker and stores its commands", async () => {
    const root = repos.create({
      files: { [TRACKER_PATH]: validTrackerBlock() },
    });

    const project = await registerProject.run({ root, verifyCommand: "pnpm test" });

    expect(project.exportFolder).toBe(".scratch/tickets");
    expect(project.slugPattern).toBe("{seq}-{slug}");
    expect(project.trackerDiagnostic).toBeNull();
    expect(JSON.parse(project.trackerCommandsJson!)).toEqual({
      claim: "bd update {id} --claim",
    });
  });

  it("is missing without the file, and prose-only counts the same as missing", async () => {
    const noFile = await registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    expect(noFile.trackerCommandsJson).toBeNull();
    expect(noFile.trackerDiagnostic).toBeNull();
    expect(noFile.exportFolder).toBe(".scratch");

    const prose = await registerProject.run({
      root: repos.create({
        files: { [TRACKER_PATH]: "# Issue tracker\n\nJust prose, no front matter.\n" },
      }),
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    expect(prose.trackerCommandsJson).toBeNull();
    expect(prose.trackerDiagnostic).toBeNull();
  });

  it("explicit export folder and slug pattern override the tracker's pre-fill", async () => {
    const root = repos.create({ files: { [TRACKER_PATH]: validTrackerBlock() } });

    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch/mine",
      slugPattern: "{slug}",
    });

    expect(project.exportFolder).toBe(".scratch/mine");
    expect(project.slugPattern).toBe("{slug}");
    // The commands are stored from the tracker read regardless.
    expect(JSON.parse(project.trackerCommandsJson!)).toEqual({
      claim: "bd update {id} --claim",
    });
  });

  it("keeps the fixed defaults and stores a diagnostic naming tickets_dir when the block is missing it", async () => {
    const root = repos.create({
      files: {
        [TRACKER_PATH]: `---\nticket_format: "{slug}"\ncommands:\n  claim: bd update {id} --claim\n---\n`,
      },
    });

    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });

    expect(project.exportFolder).toBe(".scratch");
    expect(project.slugPattern).toBe("{slug}");
    expect(project.trackerCommandsJson).toBeNull();
    expect(project.trackerDiagnostic).toMatch(/tickets_dir/);
  });

  it("is invalid, naming tickets_dir, with a tickets_dir outside the root", async () => {
    const root = repos.create({
      files: { [TRACKER_PATH]: validTrackerBlock("../outside") },
    });

    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });

    expect(project.trackerDiagnostic).toMatch(/tickets_dir/);
    expect(project.exportFolder).toBe(".scratch");
  });

  it("refuses a blank export folder when there is no valid tracker to fall back on", async () => {
    await expect(
      registerProject.run({ root: repos.create(), verifyCommand: "pnpm test" }),
    ).rejects.toMatchObject({ errorCode: "export-folder-required" });
  });

  it("is not re-read by an ordinary update; refresh-project-tracker re-reads it", async () => {
    const root = repos.create({ files: { [TRACKER_PATH]: validTrackerBlock() } });
    const project = await registerProject.run({ root, verifyCommand: "pnpm test" });
    expect(project.exportFolder).toBe(".scratch/tickets");

    writeFileSync(
      path.join(root, TRACKER_PATH),
      validTrackerBlock(".scratch/renamed", {
        claim: "bd update {id} --claim",
        close: "bd close {id}",
      }),
    );

    const updated = await updateProject.run({ id: project.id, name: "Renamed" });
    expect(updated.exportFolder).toBe(".scratch/tickets");
    expect(JSON.parse(updated.trackerCommandsJson!)).toEqual({
      claim: "bd update {id} --claim",
    });

    const refreshed = await refreshProjectTracker.run({ id: project.id });
    expect(refreshed.exportFolder).toBe(".scratch/renamed");
    expect(JSON.parse(refreshed.trackerCommandsJson!)).toEqual({
      claim: "bd update {id} --claim",
      close: "bd close {id}",
    });

    expect((await getProject.run({ id: project.id })).exportFolder).toBe(".scratch/renamed");
  });

  it("surfaces the diagnostic on the project record", async () => {
    const root = repos.create({
      files: { [TRACKER_PATH]: `---\ntickets_dir: .scratch\n---\n` },
    });

    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });

    expect((await getProject.run({ id: project.id })).trackerDiagnostic).toMatch(/ticket_format/);
    expect((await listProjects.run({})).find((p) => p.id === project.id)?.trackerDiagnostic).toMatch(
      /ticket_format/,
    );
  });
});

describe("a session's project", () => {
  useTestDatabase();

  async function aProject() {
    return registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
  }

  it("has none by default", async () => {
    const session = await createSession.run({ title: "T", idea: "An idea" });

    expect(session.projectId).toBeNull();
  });

  it("persists the project chosen at creation", async () => {
    const project = await aProject();

    const session = await createSession.run({
      title: "T",
      idea: "An idea",
      projectId: project.id,
    });

    expect(session.projectId).toBe(project.id);
    expect((await getSession.run({ id: session.id })).projectId).toBe(project.id);
  });

  it("refuses an unknown project at creation", async () => {
    await expect(
      createSession.run({ title: "T", idea: "An idea", projectId: "missing" }),
    ).rejects.toMatchObject({ errorCode: "project-not-found" });
  });

  it("can be set later, changed, and cleared", async () => {
    const first = await aProject();
    const second = await aProject();
    const session = await createSession.run({ title: "T", idea: "An idea" });

    await setSessionProject.run({ sessionId: session.id, projectId: first.id });
    expect((await getSession.run({ id: session.id })).projectId).toBe(first.id);

    await setSessionProject.run({ sessionId: session.id, projectId: second.id });
    expect((await getSession.run({ id: session.id })).projectId).toBe(second.id);

    await setSessionProject.run({ sessionId: session.id, projectId: null });
    expect((await getSession.run({ id: session.id })).projectId).toBeNull();
  });

  it("set-session-project refuses an unknown project or session", async () => {
    const session = await createSession.run({ title: "T", idea: "An idea" });

    await expect(
      setSessionProject.run({ sessionId: session.id, projectId: "missing" }),
    ).rejects.toMatchObject({ errorCode: "project-not-found" });
    await expect(
      setSessionProject.run({ sessionId: "missing", projectId: null }),
    ).rejects.toThrow("Session not found: missing");
  });
});
