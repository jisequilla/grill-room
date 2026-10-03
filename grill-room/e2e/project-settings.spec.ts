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

  test("changes the delivery recipe, the adversarial review switch and the pre-flight switch, and all persist across a reload", async ({
    page,
    request,
  }) => {
    const project = await registerProject(request, {
      root: repoRoot,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
      name: "Settings fixture",
    });

    await page.goto("/projects");
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

    const preflightSwitch = page.getByTestId("project-preflight-step");
    await expect(preflightSwitch).toHaveAttribute("aria-checked", "true");
    await preflightSwitch.click();
    await expect(preflightSwitch).toHaveAttribute("aria-checked", "false");

    const inFlight = page.getByTestId("project-max-tickets-in-flight");
    await expect(inFlight).toHaveValue("3");
    await inFlight.fill("2");

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
    expect(saved.preflightStep).toBe(false);
    expect(saved.maxTicketsInFlight).toBe(2);

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
    await expect(page.getByTestId("project-preflight-step")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByTestId("project-max-tickets-in-flight")).toHaveValue("2");

    // The stored values are unchanged by the reload and reopen alone.
    const reloadedResponse = await request.get(
      `/_agent-native/actions/get-project?id=${project.id}`,
    );
    expect(reloadedResponse.ok()).toBeTruthy();
    const reloaded = await reloadedResponse.json();
    expect(reloaded.deliveryRecipe).toBe("pull-request");
    expect(reloaded.adversarialReview).toBe(false);
    expect(reloaded.preflightStep).toBe(false);
    expect(reloaded.maxTicketsInFlight).toBe(2);
  });

  test("refuses tickets in flight of 11 beside the field", async ({ page, request }) => {
    const root = createFixtureRepo();
    try {
      await registerProject(request, {
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
        name: "In-flight refusal fixture",
      });

      await page.goto("/projects");
      const row = page
        .getByTestId("project-row")
        .filter({ hasText: "In-flight refusal fixture" });
      await row.getByRole("button", { name: "Edit" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const inFlight = page.getByTestId("project-max-tickets-in-flight");
      await inFlight.fill("11");
      const refusedResponse = page.waitForResponse((response) =>
        response.url().includes("/_agent-native/actions/update-project"),
      );
      await page.getByTestId("project-save").click();
      await refusedResponse;

      await expect(dialog.locator("#project-max-tickets-in-flight-hint")).toHaveText(
        "Tickets in flight must be a whole number from 1 to 10.",
      );
      await expect(inFlight).toHaveAttribute("aria-invalid", "true");
      await expect(dialog).toBeVisible();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a blank tickets in flight still saves and keeps the stored value", async ({
    page,
    request,
  }) => {
    const root = createFixtureRepo();
    try {
      const project = await registerProject(request, {
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
        name: "In-flight blank fixture",
      });

      await page.goto("/projects");
      const row = page
        .getByTestId("project-row")
        .filter({ hasText: "In-flight blank fixture" });
      await row.getByRole("button", { name: "Edit" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const inFlight = page.getByTestId("project-max-tickets-in-flight");
      await expect(inFlight).toHaveValue("3");
      await inFlight.fill("");
      await expect(page.getByTestId("project-save")).toBeEnabled();

      const updateResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/actions/update-project") &&
          response.ok(),
      );
      await page.getByTestId("project-save").click();
      await updateResponse;
      await expect(dialog).toBeHidden();

      const savedResponse = await request.get(
        `/_agent-native/actions/get-project?id=${project.id}`,
      );
      expect(savedResponse.ok()).toBeTruthy();
      expect((await savedResponse.json()).maxTicketsInFlight).toBe(3);

      await page.reload();
      await row.getByRole("button", { name: "Edit" }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("project-max-tickets-in-flight")).toHaveValue("3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shows the durable and working folders with their lifetimes, refuses overlapping roots under both, and saves a new durable folder across a reload", async ({
    page,
    request,
  }) => {
    const root = createFixtureRepo();
    try {
      const project = await registerProject(request, {
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
        name: "Folders fixture",
      });

      await page.goto("/projects");
      const row = page
        .getByTestId("project-row")
        .filter({ hasText: "Folders fixture" });
      await row.getByRole("button", { name: "Edit" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const durable = dialog.getByLabel("Durable folder");
      const working = dialog.getByLabel("Working folder");
      const durableHint = dialog.locator("#project-durable-hint");
      const workingHint = dialog.locator("#project-export-hint");

      await expect(durable).toHaveValue("docs/specs");
      await expect(durable).toHaveAttribute("placeholder", "docs/specs");
      await expect(working).toHaveValue(".scratch");
      await expect(durableHint).toHaveText(
        /Specs, decisions and intent, kept after the build/,
      );
      await expect(workingHint).toHaveText(
        /Tickets, handoff and briefs, deletable after the build/,
      );

      // A durable folder inside the working one: refused, shown under both.
      await durable.fill(".scratch/specs");
      const refusedResponse = page.waitForResponse((response) =>
        response.url().includes("/_agent-native/actions/update-project"),
      );
      await page.getByTestId("project-save").click();
      await refusedResponse;
      const overlap = /The durable and working folders must be separate/;
      await expect(durableHint).toHaveText(overlap);
      await expect(workingHint).toHaveText(overlap);
      await expect(durable).toHaveAttribute("aria-invalid", "true");
      await expect(working).toHaveAttribute("aria-invalid", "true");
      await expect(dialog).toBeVisible();

      // Changing either folder clears the refusal from both.
      await durable.fill("docs/architecture");
      await expect(durableHint).not.toHaveText(overlap);
      await expect(workingHint).not.toHaveText(overlap);

      const updateResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/actions/update-project") &&
          response.ok(),
      );
      await page.getByTestId("project-save").click();
      await updateResponse;
      await expect(dialog).toBeHidden();

      const savedResponse = await request.get(
        `/_agent-native/actions/get-project?id=${project.id}`,
      );
      expect(savedResponse.ok()).toBeTruthy();
      const saved = await savedResponse.json();
      expect(saved.durableExportFolder).toBe("docs/architecture");
      expect(saved.workingExportFolder).toBe(".scratch");

      await page.reload();
      await row.getByRole("button", { name: "Edit" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Durable folder")).toHaveValue(
        "docs/architecture",
      );
      await expect(dialog.getByLabel("Working folder")).toHaveValue(".scratch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Settings links to the Projects page", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-projects-link").click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("projects-section")).toBeVisible();
  });
});
