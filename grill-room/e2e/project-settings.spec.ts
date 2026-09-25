import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerProject } from "./support";

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
 * A throwaway git repository with no remote, so `register-project` guesses
 * `local-merge` for its delivery recipe — the starting point this spec
 * changes away from.
 */
function createFixtureRepo(): string {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-settings-")),
  );
  git(root, ["init", "-q"]);
  return root;
}

test.describe("project settings", () => {
  let repoRoot: string;

  test.beforeAll(() => {
    repoRoot = createFixtureRepo();
  });

  test.afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("changes the delivery recipe and the adversarial review switch, and both persist across a reload", async ({
    page,
    request,
  }) => {
    const project = await registerProject(request, {
      root: repoRoot,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
      name: "Settings fixture",
    });

    await page.goto("/settings");
    const row = page
      .getByTestId("project-row")
      .filter({ hasText: "Settings fixture" });

    // No remote on the fixture repo, so registration guessed "local-merge",
    // visible on the row without opening Edit, and review defaults on (no
    // "no review" marker).
    await expect(row.getByTestId("project-recipe-badge")).toHaveText(/Local merge/);
    await expect(row.getByTestId("project-review-off-marker")).toHaveCount(0);

    await row.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const recipeTrigger = page.getByTestId("project-delivery-recipe");
    await expect(recipeTrigger).toHaveText(/Local merge/);

    await recipeTrigger.click();
    await page.getByRole("option", { name: "Pull request" }).click();
    await expect(recipeTrigger).toHaveText(/Pull request/);

    const reviewSwitch = page.getByTestId("project-adversarial-review");
    await expect(reviewSwitch).toHaveAttribute("aria-checked", "true");
    await reviewSwitch.click();
    await expect(reviewSwitch).toHaveAttribute("aria-checked", "false");

    // The dialog closes on the mutation's onSuccess callback, a tick before
    // the response promise it comes from actually settles — so waiting for
    // the dialog to hide is not enough to know the save has landed. Wait for
    // the update-project response itself before reading the stored value.
    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/update-project") &&
        response.ok(),
    );
    await page.getByTestId("project-save").click();
    await updateResponse;
    await expect(dialog).toBeHidden();

    // The stored values, not just what the UI echoes back.
    const savedResponse = await request.get(
      `/_agent-native/actions/get-project?id=${project.id}`,
    );
    expect(savedResponse.ok()).toBeTruthy();
    const saved = await savedResponse.json();
    expect(saved.deliveryRecipe).toBe("pull-request");
    expect(saved.adversarialReview).toBe(false);

    await page.reload();

    // The badge and marker on the row reflect the saved values too.
    await expect(row.getByTestId("project-recipe-badge")).toHaveText(/Pull request/);
    await expect(row.getByTestId("project-review-off-marker")).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog).toBeVisible();

    await expect(page.getByTestId("project-delivery-recipe")).toHaveText(
      /Pull request/,
    );
    await expect(
      page.getByTestId("project-adversarial-review"),
    ).toHaveAttribute("aria-checked", "false");

    // The stored values are unchanged by the reload and reopen alone.
    const reloadedResponse = await request.get(
      `/_agent-native/actions/get-project?id=${project.id}`,
    );
    expect(reloadedResponse.ok()).toBeTruthy();
    const reloaded = await reloadedResponse.json();
    expect(reloaded.deliveryRecipe).toBe("pull-request");
    expect(reloaded.adversarialReview).toBe(false);
  });
});
