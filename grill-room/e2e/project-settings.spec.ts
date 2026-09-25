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
    await registerProject(request, {
      root: repoRoot,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
      name: "Settings fixture",
    });

    await page.goto("/settings");
    const row = page
      .getByTestId("project-row")
      .filter({ hasText: "Settings fixture" });
    await row.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // No remote on the fixture repo, so registration guessed "local-merge".
    const recipeTrigger = page.getByTestId("project-delivery-recipe");
    await expect(recipeTrigger).toHaveText(/Local merge/);

    await recipeTrigger.click();
    await page.getByRole("option", { name: "Pull request" }).click();
    await expect(recipeTrigger).toHaveText(/Pull request/);

    const reviewSwitch = page.getByTestId("project-adversarial-review");
    await expect(reviewSwitch).toHaveAttribute("aria-checked", "true");
    await reviewSwitch.click();
    await expect(reviewSwitch).toHaveAttribute("aria-checked", "false");

    await page.getByTestId("project-save").click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await row.getByRole("button", { name: "Edit" }).click();
    await expect(dialog).toBeVisible();

    await expect(page.getByTestId("project-delivery-recipe")).toHaveText(
      /Pull request/,
    );
    await expect(
      page.getByTestId("project-adversarial-review"),
    ).toHaveAttribute("aria-checked", "false");
  });
});
