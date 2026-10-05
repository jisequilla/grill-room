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

/** A throwaway git repository with one commit, real-pathed as `register-project` reports it. */
function createProjectRepo(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-handoff-bundle-paths-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

let repoRoot: string;

test.beforeEach(() => {
  repoRoot = createProjectRepo();
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * gr-5iy: the HANDOFF viewer fills every `{{BUNDLE}}` brief link with the
 * path the export section currently plans, instead of showing the raw
 * `[`{{BUNDLE}}/briefs/01-x.md`](briefs/01-x.md)` markdown as text — and
 * follows the export slug as it changes, while the editor keeps the stored
 * token. gr-0hy.6: the spec path is `{{DOCS}}`, filled with the durable
 * bundle folder (`docs/specs/…`), while the briefs stay under the working
 * one. Walks the canned fake scenario to a generated handoff the same way
 * `handoff-regenerate.spec.ts` does.
 */
test("shows brief links as the planned bundle path, and follows the export slug", async ({
  page,
  request,
}) => {
  // ---- Session list -> create a session ---------------------------------
  await page.goto("/");
  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("Handoff bundle paths e2e");
  await page
    .getByLabel("Idea")
    .fill("A session whose handoff brief links show the planned bundle path.");
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
  const view = handoff.getByTestId("handoff-document-view");
  await expect(view).toBeVisible({ timeout: 15_000 });

  // ---- 1. The viewer shows the planned bundle path, not the raw token ---
  await expect(view).toContainText(/\.scratch\/[^\s]*handoff-bundle-paths-e2e\/briefs\/01-/);
  await expect(view).toContainText(/docs\/specs\/[^\s]*handoff-bundle-paths-e2e\/spec\.md/);
  await expect(view).not.toContainText(/\.scratch\/[^\s]*\/spec\.md/);
  await expect(view).not.toContainText("{{BUNDLE}}");
  await expect(view).not.toContainText("{{DOCS}}");
  await expect(view).not.toContainText("](briefs/");
  await expect(handoff).toContainText("Bundle paths are shown as the export below would write them");
  await expect(handoff).toContainText(/in \.scratch\/[^\s]*handoff-bundle-paths-e2e and docs\/specs\/[^\s]*handoff-bundle-paths-e2e\./);

  // ---- 2. Following the export slug moves the path -----------------------
  const exportSection = page.getByTestId("output-export-section");
  const slugInput = exportSection.getByTestId("export-slug-input");
  await slugInput.fill("renamed-bundle");
  await expect(view).toContainText(/\.scratch\/[^\s]*renamed-bundle\/briefs\/01-/);
  await expect(view).toContainText(/docs\/specs\/[^\s]*renamed-bundle\/spec\.md/);

  // ---- 3. A blank slug: no current plan, the viewer shows the token again
  await slugInput.fill("");
  await expect(view).toContainText("{{BUNDLE}}");
  await expect(view).toContainText("{{DOCS}}/spec.md");
  await expect(view).not.toContainText(/renamed-bundle/);

  // ---- 4. Edit mode still shows the stored token -------------------------
  await handoff.getByTestId("edit-handoff").click();
  await expect(handoff.getByTestId("handoff-editor")).toHaveValue(/\{\{BUNDLE\}\}\/briefs\/01-/);
  await expect(handoff.getByTestId("handoff-editor")).toHaveValue(/\{\{DOCS\}\}\/spec\.md/);
});
