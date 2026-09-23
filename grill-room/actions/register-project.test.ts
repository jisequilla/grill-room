import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import getProject from "./get-project.js";
import getSession from "./get-session.js";
import listProjects from "./list-projects.js";
import registerProject from "./register-project.js";
import setSessionProject from "./set-session-project.js";
import suggestProjectDefaults from "./suggest-project-defaults.js";
import updateProject from "./update-project.js";

const repos = useTempGitRepos();

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
    });
    await expect(
      suggestProjectDefaults.run({ folder: repos.plainFolder() }),
    ).rejects.toMatchObject({ errorCode: "not-a-git-repo" });
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
