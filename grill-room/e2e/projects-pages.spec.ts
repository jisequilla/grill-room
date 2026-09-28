import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { createSession, registerProject, setSessionProject } from "./support";

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function initRepo(repo: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync("git", ["-C", repo, "init", "-q"], { env, stdio: "ignore" });
}

test.describe("projects pages", () => {
  let repoRoot: string;

  test.beforeAll(() => {
    repoRoot = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-projects-")),
    );
    initRepo(repoRoot);
  });

  test.afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("a project has its own page, the Sessions list filters by it, and a session shows it", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}`;
    const projectName = `Pages fixture ${suffix}`;
    const verifyCommand = `pnpm verify-${suffix}`;
    const assignedTitle = `Filed session ${suffix}`;
    const unassignedTitle = `Loose session ${suffix}`;

    const project = await registerProject(request, {
      root: repoRoot,
      verifyCommand,
      workingExportFolder: ".scratch",
      name: projectName,
    });

    const assignedId = await createSession(page, {
      title: assignedTitle,
      idea: "A session that belongs to the fixture project.",
    });
    await setSessionProject(request, assignedId, project.id);
    await createSession(page, {
      title: unassignedTitle,
      idea: "A session that belongs to no project.",
    });

    // The registry links each row to its project's page.
    await page.goto("/projects");
    await page
      .getByTestId("project-row")
      .filter({ hasText: projectName })
      .getByTestId("project-open")
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));

    // Sessions tab: only this project's sessions.
    await page.getByTestId("project-tab-sessions").click();
    await expect(page.locator("main").getByText(assignedTitle)).toBeVisible();
    await expect(page.locator("main").getByText(unassignedTitle)).toHaveCount(0);

    // Settings tab: the fields, and Edit opens the form on this project.
    await page.getByTestId("project-tab-settings").click();
    await expect(page.getByText(verifyCommand)).toBeVisible();
    await page.getByTestId("project-page-edit").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue(projectName);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The home list filters by project.
    await page.goto("/");
    const list = page
      .getByTestId("session-project-filter")
      .locator("xpath=following-sibling::ul");
    const assignedRow = list
      .getByRole("listitem")
      .filter({ hasText: assignedTitle });
    const unassignedRow = list
      .getByRole("listitem")
      .filter({ hasText: unassignedTitle });

    await page.getByTestId(`session-project-filter-${project.id}`).click();
    await expect(assignedRow).toBeVisible();
    await expect(unassignedRow).toHaveCount(0);

    await page.getByTestId("session-project-filter-unassigned").click();
    await expect(unassignedRow).toBeVisible();
    await expect(assignedRow).toHaveCount(0);

    // The session page names its project and links back to it.
    await page.goto(`/sessions/${assignedId}`);
    const breadcrumb = page.getByTestId("session-breadcrumb-project");
    await expect(breadcrumb).toHaveText(projectName);
    await expect(breadcrumb).toHaveAttribute(
      "href",
      `/projects/${project.id}`,
    );
    await expect(page.getByTestId("session-title")).toHaveText(assignedTitle);

    // An unknown project id says so.
    await page.goto("/projects/does-not-exist");
    await expect(page.getByText("Project not found")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to projects" }),
    ).toHaveAttribute("href", "/projects");
  });
});
