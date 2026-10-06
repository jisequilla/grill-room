import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerProject, setSessionProject } from "./support";

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(repo: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=Grill Room E2E",
      "-c",
      "user.email=e2e@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, stdio: "ignore" },
  );
}

/**
 * A durable folder git ignores refuses the export, and the project's edit
 * dialog says so. The fixture repo commits a `.gitignore` for the default
 * durable folder `docs/specs/`. The walk is the fake interviewer's canned
 * scenario, as `export-visibility-unchecked.spec.ts` walks it, and generates
 * the handoff before asserting, so the handoff gate is clear and the durable
 * reason is the one shown.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-durable-ignored-")));
  git(repoRoot, ["init", "-q"]);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n");
  writeFileSync(path.join(repoRoot, ".gitignore"), "docs/specs/\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "fixture"]);
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("refuses the export and warns in project settings when the durable folder is ignored", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("Durable ignored e2e");
  await page.getByLabel("Idea").fill("A session whose durable folder git ignores.");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/sessions\/[^/]+$/);
  const sessionIdMatch = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!sessionIdMatch) {
    throw new Error(`Could not read a session id off ${page.url()}`);
  }
  const sessionId = sessionIdMatch[1]!;

  const project = await registerProject(request, {
    root: repoRoot,
    verifyCommand: "true",
    workingExportFolder: ".scratch",
    name: "Durable ignored fixture",
  });
  await setSessionProject(request, sessionId, project.id);

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await cards.first().getByRole("button", { name: "Accept" }).click();
  await cards.last().getByRole("button", { name: "I don't know", exact: true }).click();
  await expect(page.getByTestId("round-progress")).toHaveText("2 of 2 answered");

  await page.getByRole("button", { name: "Submit round" }).click();
  await expect(page.getByText("The interviewer proposes you are done")).toBeVisible();

  const looseEnd = page.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await looseEnd.getByRole("button", { name: "Answer now" }).click();
  await page
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk, in the app's own database.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("loose-ends-clear")).toBeVisible();

  await page.getByTestId("confirm-session").click();
  await expect(page.getByText("Shared understanding confirmed")).toBeVisible();

  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");

  await page.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-1")).toBeVisible();

  const handoffSection = page.getByTestId("output-handoff-section");
  const exportSection = page.getByTestId("output-export-section");

  await handoffSection.getByTestId("generate-handoff").click();
  await expect(handoffSection.getByTestId("handoff-document-view")).toBeVisible({
    timeout: 15_000,
  });

  const gateMessage = exportSection.getByTestId("export-gate-message");
  await expect(gateMessage).toBeVisible({ timeout: 30_000 });
  await expect(gateMessage).toContainText(/durable folder is ignored by git/i);
  await expect(exportSection.getByTestId("export-action")).toBeDisabled();

  await page.goto("/projects");
  const row = page.getByTestId("project-row").filter({ hasText: "Durable ignored fixture" });
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("project-durable-ignored-warning")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("project-working-ignored-note")).toHaveCount(0);
});
