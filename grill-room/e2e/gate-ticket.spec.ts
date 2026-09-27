import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { chooseScenario, createSession, registerProject, setSessionProject } from "./support";

const WAITS_FOR = "A live account on the payment platform, with API keys issued.";

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

/** A throwaway repository with one commit, for the session to hand off into. */
function createProjectRepo(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-gate-project-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

/**
 * gr-ibp.8: a prerequisite outside the code becomes a gate ticket. The
 * `gate-ticket` scenario is the canned interview (walked here exactly as
 * `export-visibility-unchecked.spec.ts` walks it, loose end included) with a
 * breakdown holding a gate: 01 builds the workspace, 02 waits for a payment
 * account, 03 waits for both. The output page marks the gate and says what
 * it waits for; the handoff gives it a `Wait for:` line and no brief.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = createProjectRepo();
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("a gate ticket shows what it waits for, and the handoff gives it no brief", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Gate ticket e2e",
    idea: "A workspace that takes payments once the payment account is live.",
  });
  await chooseScenario(request, sessionId, "gate-ticket");
  const project = await registerProject(request, {
    root: repoRoot,
    verifyCommand: "true",
    workingExportFolder: ".scratch",
  });
  await setSessionProject(request, sessionId, project.id);

  // ---- Round 1: accept one, leave one loose end -------------------------
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

  // ---- Output: the spec, then the tickets with their gate ---------------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");

  await page.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-3")).toContainText("Store the data on disk");

  await expect(page.getByTestId("ticket-kind-2")).toHaveText("Gate");
  await expect(page.getByTestId("ticket-waits-for-2")).toHaveText(`Wait for: ${WAITS_FOR}`);
  await expect(page.getByTestId("ticket-row-1").getByTestId(/^ticket-kind-/)).toHaveCount(0);
  await expect(page.getByTestId("ticket-row-3").getByTestId(/^ticket-kind-/)).toHaveCount(0);

  // ---- The handoff: a Wait for line, and no brief for the gate ----------
  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  const handoffView = handoffSection.getByTestId("handoff-document-view");
  await expect(handoffView).toBeVisible({ timeout: 15_000 });
  // The view renders the markdown, so the `- Wait for:` item is a list item.
  await expect(handoffView.locator("li", { hasText: `Wait for: ${WAITS_FOR}` }).last()).toBeVisible();

  await handoffSection.getByTestId("handoff-document").click();
  const options = page.getByRole("option");
  await expect(options).toHaveText([
    "HANDOFF.md",
    "briefs/01-build-the-workspace.md",
    "briefs/03-store-on-disk.md",
  ]);
  await expect(page.getByRole("option", { name: /^briefs\/02-/ })).toHaveCount(0);
});
