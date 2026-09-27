import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

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

/** A throwaway git repository with one commit, real-pathed as `register-project` reports it. */
function createProjectRepo(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-handoff-regenerate-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

const BRIEF_2 = "briefs/02-store-on-disk.md";
const MY_BRIEF_2 = "# My brief for ticket 2\n\nKeep this line.\n";

async function selectDocument(page: Page, name: string): Promise<void> {
  await page.getByTestId("handoff-document").click();
  await page.getByRole("option", { name, exact: true }).click();
}

let repoRoot: string;

test.beforeEach(() => {
  repoRoot = createProjectRepo();
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * gr-ibp.6: regenerating the handoff keeps a hand-edited brief and names it
 * when its ticket changed since, saving it marks it reviewed, and "Regenerate,
 * replacing edits" still rewrites everything after a confirmation. Walks the
 * canned fake scenario to a generated handoff the same way
 * `export-visibility-unchecked.spec.ts` does, including its one loose end.
 */
test("keeps an edited brief on regeneration, names it outdated, and replaces it only when asked", async ({
  page,
  request,
}) => {
  // ---- Session list -> create a session ---------------------------------
  await page.goto("/");
  await page.getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("Handoff regenerate e2e");
  await page.getByLabel("Idea").fill("A session whose handoff brief is edited by hand.");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/sessions\/[^/]+$/);
  const sessionIdMatch = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!sessionIdMatch) throw new Error(`Could not read a session id off ${page.url()}`);
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

  // ---- Output: spec, tickets, handoff -----------------------------------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);
  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");
  await page.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-2")).toBeVisible();

  const handoff = page.getByTestId("output-handoff-section");
  await handoff.getByTestId("generate-handoff").click();
  await expect(handoff.getByTestId("handoff-document-view")).toBeVisible({ timeout: 15_000 });

  // ---- 1. Edit brief 2 ---------------------------------------------------
  await selectDocument(page, BRIEF_2);
  await handoff.getByTestId("edit-handoff").click();
  await handoff.getByTestId("handoff-editor").fill(MY_BRIEF_2);
  await handoff.getByTestId("save-handoff").click();
  await expect(handoff.getByTestId("handoff-edited")).toBeVisible();
  await expect(handoff.getByTestId("regenerate-handoff-replace")).toBeVisible();

  // ---- 2. Change ticket 2's blockers: the handoff goes stale -------------
  await page.getByTestId("edit-blocked-by-2").click();
  await page.getByTestId("blocked-by-option-2-1").click();
  await page.keyboard.press("Escape");
  await expect(handoff.getByTestId("handoff-stale")).toBeVisible();
  await expect(handoff.getByTestId("handoff-outdated-edits")).toHaveCount(0);

  // ---- 3. Regenerate: the edit is kept and named -------------------------
  await handoff.getByTestId("regenerate-handoff").click();
  await expect(handoff.getByTestId("handoff-stale")).toBeHidden();
  await expect(page.getByTestId("confirm-regenerate-handoff")).toHaveCount(0);
  await expect(handoff.getByTestId("handoff-document-view")).toContainText("Keep this line.");
  await expect(handoff.getByTestId("handoff-outdated-edits")).toContainText(
    `${BRIEF_2} was edited by hand`,
  );

  // ---- 4. Save brief 2 unchanged: marked reviewed ------------------------
  await handoff.getByTestId("edit-handoff").click();
  await handoff.getByTestId("save-handoff").click();
  await expect(handoff.getByTestId("handoff-outdated-edits")).toBeHidden();
  await expect(handoff.getByTestId("handoff-edited")).toBeVisible();

  // ---- 5. Regenerate, replacing edits ------------------------------------
  await handoff.getByTestId("regenerate-handoff-replace").click();
  await page.getByTestId("confirm-regenerate-handoff").click();
  await expect(handoff.getByTestId("handoff-edited")).toBeHidden();
  const view = handoff.getByTestId("handoff-document-view");
  await expect(view).toContainText("Blocked by: none");
  await expect(view).not.toContainText("Keep this line.");
});
