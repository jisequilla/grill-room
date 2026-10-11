import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { chooseScenario, createSession, registerProject, setSessionProject } from "./support";

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
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-unproduced-project-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

/**
 * gr-qpo.2: an input no ticket produces reaches the owner. The
 * `unproduced-inputs` scenario is the canned interview (walked here as
 * `uncovered-story.spec.ts` walks it) with a breakdown whose ticket 2
 * consumes a "spans writer" nothing provides, sent back once and then
 * accepted. The tickets page flags the gap and the handoff lists it.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = createProjectRepo();
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("the tickets page and the handoff flag an input no ticket produces", async ({ page, request }) => {
  const sessionId = await createSession(page, {
    title: "Unproduced inputs e2e",
    idea: "A workspace whose data lives on disk.",
  });
  await chooseScenario(request, sessionId, "unproduced-inputs");
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

  // ---- Output: the spec, then tickets accepted on the last attempt ------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");

  await page.getByTestId("break-into-tickets").click();
  const ticketTwo = page.getByTestId("ticket-row-2");
  await expect(ticketTwo).toContainText("Showing spans");

  // ---- The tickets page flags the gap on ticket 2 only ------------------
  await expect(page.getByTestId("ticket-unresolved-2")).toHaveText("1 unresolved input");
  await expect(page.getByTestId("ticket-unresolved-item-2-0")).toHaveText(
    'Unresolved: "spans writer" — no ticket or repository file provides it.',
  );
  await expect(page.getByTestId("ticket-row-1").getByTestId("ticket-unresolved-1")).toHaveCount(0);

  // ---- The handoff lists it ---------------------------------------------
  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  const handoffView = handoffSection.getByTestId("handoff-document-view");
  await expect(handoffView).toBeVisible({ timeout: 15_000 });
  await expect(handoffView).toContainText("Inputs no ticket produces");
  await expect(handoffView).toContainText(
    'Ticket 02 (show-spans) needs "spans writer": no ticket or repository file provides it.',
  );
});
