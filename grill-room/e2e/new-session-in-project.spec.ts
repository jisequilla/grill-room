import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { registerProject } from "./support";

const DRAFT_KEY = "grill-room:new-session-draft";

function initRepo(repo: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    delete env[name];
  }
  execFileSync("git", ["-C", repo, "init", "-q"], { env, stdio: "ignore" });
}

function storedDraft(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, DRAFT_KEY);
}

test.describe("new session in a project", () => {
  let repoRoots: string[];

  test.beforeAll(() => {
    repoRoots = [0, 1].map(() => {
      const repo = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-new-in-project-")),
      );
      initRepo(repo);
      return repo;
    });
  });

  test.afterAll(() => {
    for (const repo of repoRoots) rmSync(repo, { recursive: true, force: true });
  });

  test("New session in this project pre-fills the project and keeps an unsent draft's text", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}`;
    const nameX = `Project X ${suffix}`;
    const nameY = `Project Y ${suffix}`;
    const projectX = await registerProject(request, {
      root: repoRoots[0],
      verifyCommand: "true",
      workingExportFolder: ".scratch",
      name: nameX,
    });
    const projectY = await registerProject(request, {
      root: repoRoots[1],
      verifyCommand: "true",
      workingExportFolder: ".scratch",
      name: nameY,
    });

    const dialog = page.getByRole("dialog");
    const projectField = page.locator("#session-project");
    const openFromSidebar = async () => {
      await page.locator("aside").getByTestId("sidebar-new-session").first().click();
      await expect(dialog).toBeVisible();
    };
    const cancel = async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    };
    const storeDraftIn = (projectId: string) =>
      page.evaluate(
        ([key, id]) =>
          window.localStorage.setItem(
            key,
            JSON.stringify({
              title: "T",
              idea: "I",
              model: "opus",
              answeringMode: "one-at-a-time",
              docsFolder: "",
              projectId: id,
            }),
          ),
        [DRAFT_KEY, projectId],
      );

    // Row 5: no draft, the click pre-fills the project and stores nothing.
    await page.goto(`/projects/${projectY.id}`);
    await page.evaluate((key) => window.localStorage.removeItem(key), DRAFT_KEY);
    await page.getByTestId("project-tab-sessions").click();
    await page.getByTestId("project-new-session").click();
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(page.getByLabel("Idea")).toHaveValue("");
    await expect(projectField).toHaveText(nameY);
    expect(await storedDraft(page)).toBeNull();

    // Row 6: closed untouched, a later sidebar open is clean (same page, no reload).
    await cancel();
    await openFromSidebar();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(projectField).toHaveText("No project");
    expect(await storedDraft(page)).toBeNull();
    await cancel();

    // Row 7: a stored draft in X keeps its text and moves to Y; the click is written.
    await storeDraftIn(projectX.id);
    await page.getByTestId("project-new-session").click();
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("T");
    await expect(page.getByLabel("Idea")).toHaveValue("I");
    await expect(projectField).toHaveText(nameY);
    expect((await storedDraft(page))?.projectId).toBe(projectY.id);

    // Row 8: Cancel, then the sidebar open shows the same draft in Y.
    await cancel();
    await openFromSidebar();
    await expect(page.getByLabel("Title")).toHaveValue("T");
    await expect(page.getByLabel("Idea")).toHaveValue("I");
    await expect(projectField).toHaveText(nameY);
    await cancel();

    // Row 9: from /projects/Y, same page, a sidebar open leaves a stored draft in X alone.
    await storeDraftIn(projectX.id);
    await openFromSidebar();
    await expect(page.getByLabel("Title")).toHaveValue("T");
    await expect(page.getByLabel("Idea")).toHaveValue("I");
    await expect(projectField).toHaveText(nameX);
    await cancel();

    // Row 10: a session created from the click belongs to the project.
    const title = `In project ${suffix}`;
    await page.evaluate((key) => window.localStorage.removeItem(key), DRAFT_KEY);
    await page.goto(`/projects/${projectY.id}`);
    await page.getByTestId("project-new-session").click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Idea").fill("Made from the project page.");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL(/\/sessions\/[^/]+$/);
    await page.goto(`/projects/${projectY.id}`);
    await page.getByTestId("project-tab-sessions").click();
    await expect(page.locator("main").getByText(title)).toBeVisible();
  });
});
