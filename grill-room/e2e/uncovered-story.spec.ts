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
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-story-project-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

/**
 * gr-ibp.7: every user story reaches a ticket. The `uncovered-story`
 * scenario is the canned interview (walked here exactly as
 * `gate-ticket.spec.ts` walks it, loose end included) with a breakdown that
 * cites no story, three times over: the first two are sent back, the third
 * is accepted on the last attempt, and the handoff names the spec's story 1
 * as one no ticket implements.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = createProjectRepo();
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("the handoff lists a story no ticket implements", async ({ page, request }) => {
  const sessionId = await createSession(page, {
    title: "Uncovered story e2e",
    idea: "A workspace whose data lives on disk.",
  });
  await chooseScenario(request, sessionId, "uncovered-story");
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
  await expect(page.getByTestId("ticket-row-2")).toContainText("Store the data on disk");

  // ---- The handoff names the story no ticket implements -----------------
  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  const handoffView = handoffSection.getByTestId("handoff-document-view");
  await expect(handoffView).toBeVisible({ timeout: 15_000 });
  await expect(handoffView).toContainText("Stories no ticket implements");
  await expect(handoffView).toContainText(
    "Story 1: As a user, I want a workspace, so that I can see the whole shape of what I am deciding.",
  );
});
