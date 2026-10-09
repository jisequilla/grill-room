import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * gr-0hy.9: once the owner deletes the working bundle folder by hand, the
 * session's export is retired. The export section says so, keeps Export
 * disabled, and offers "Re-export anyway", which puts the working folder back.
 *
 * The walk is the fake interviewer's canned five-turn scenario, the same one
 * `export-durable-ignored.spec.ts` walks, up to a real export.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-retired-")));
  git(repoRoot, ["init", "-q"]);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "fixture"]);
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("notices a deleted working folder, refuses re-export, and re-exports on the override", async ({
  page,
  request,
}) => {
  // ---- Session list -> create a session ---------------------------------
  await page.goto("/");
  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("Retired export e2e");
  await page.getByLabel("Idea").fill("A session whose build finished and whose working folder was deleted.");
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
  });
  await setSessionProject(request, sessionId, project.id);

  // ---- Interview: round 1 (accept one, leave one loose end) -------------
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

  // ---- Output: spec, tickets, handoff ------------------------------------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");

  await page.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-1")).toBeVisible();

  const handoffSection = page.getByTestId("output-handoff-section");
  const exportSection = page.getByTestId("output-export-section");

  const exportUnblocked = page.waitForResponse(
    async (response) => {
      if (!response.url().includes("/_agent-native/actions/preview-export")) return false;
      if (!response.ok()) return false;
      const body = await response.json().catch(() => null);
      return body?.exportBlocked === false;
    },
    { timeout: 30_000 },
  );

  await handoffSection.getByTestId("generate-handoff").click();
  await expect(handoffSection.getByTestId("handoff-document-view")).toBeVisible({
    timeout: 15_000,
  });
  await exportUnblocked;

  // ---- First export: nothing is retired ----------------------------------
  await expect(exportSection.getByTestId("export-preview-files").getByText(/spec\.md$/)).toBeVisible({
    timeout: 15_000,
  });
  const exportButton = exportSection.getByTestId("export-action");
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await exportButton.click();
  await expect(exportSection.getByTestId("export-result")).toBeVisible({ timeout: 15_000 });

  const workingFolder = path.join(repoRoot, ".scratch", "retired-export-e2e");
  expect(existsSync(path.join(workingFolder, "HANDOFF.md"))).toBe(true);
  await expect(exportSection.getByTestId("export-retired-notice")).toHaveCount(0);

  // ---- The owner deletes the working folder by hand ----------------------
  rmSync(workingFolder, { recursive: true, force: true });
  await page.reload();

  const retiredExportSection = page.getByTestId("output-export-section");
  const notice = retiredExportSection.getByTestId("export-retired-notice");
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText(".scratch/retired-export-e2e");
  await expect(retiredExportSection.getByTestId("export-gate-message")).toContainText(
    "Re-export is off for a retired session",
  );
  await expect(retiredExportSection.getByTestId("export-action")).toBeDisabled();

  // ---- Re-export anyway ---------------------------------------------------
  const override = retiredExportSection.getByTestId("export-retired-override");
  await override.click();
  await expect(override).toBeChecked();
  await expect(notice).toBeVisible();
  await expect(retiredExportSection.getByTestId("export-action")).toBeEnabled({ timeout: 30_000 });
  await retiredExportSection.getByTestId("export-action").click();
  await expect(retiredExportSection.getByTestId("export-result")).toBeVisible({ timeout: 15_000 });

  expect(existsSync(path.join(workingFolder, "HANDOFF.md"))).toBe(true);
  await expect(retiredExportSection.getByTestId("export-retired-notice")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(retiredExportSection.getByTestId("export-retired-override")).toHaveCount(0);
});
