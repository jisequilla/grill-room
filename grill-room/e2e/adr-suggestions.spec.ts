import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * gr-2f9.7: a flagged decision no ticket builds is named in the export section,
 * and the export writes its ADR suggestion into the working bundle folder. The
 * walk is the fake interviewer's canned five-turn scenario, up to a handoff.
 */
let repoRoot: string;

test.beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-adr-suggestions-")));
  git(repoRoot, ["init", "-q"]);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "fixture"]);
});

test.afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

test("names a flagged decision no ticket builds, then exports its suggestion", async ({ page, request }) => {
  await page.goto("/");
  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("ADR suggestions e2e");
  await page.getByLabel("Idea").fill("A session with a decision worth recording as an ADR.");
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
  await handoffSection.getByTestId("generate-handoff").click();
  await expect(handoffSection.getByTestId("handoff-document-view")).toBeVisible({ timeout: 15_000 });

  // ---- Flag a settled decision; the scripted tickets list no decision keys ----
  const treeResponse = await request.get(`/_agent-native/actions/get-tree?sessionId=${sessionId}`);
  expect(treeResponse.ok()).toBe(true);
  const tree = (await treeResponse.json()) as {
    decisions: { id: string; key: string | null; state: string; questionTitle: string }[];
  };
  const settled = tree.decisions.find((decision) => decision.state === "settled");
  if (!settled) throw new Error("expected a settled decision to flag");
  const key = settled.key ?? settled.id;
  const flag = await request.post("/_agent-native/actions/set-adr-worthy", {
    data: { decisionId: settled.id, adrWorthy: true, consequences: "Commits the app to its own database." },
  });
  expect(flag.ok()).toBe(true);

  await page.reload();
  const exportSection = page.getByTestId("output-export-section");
  const notice = exportSection.getByTestId("export-adr-without-tickets");
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText("These ADR-worthy decisions have no ticket that builds them");
  await expect(notice).toContainText(settled.questionTitle);
  await expect(notice).toContainText(key);

  // ---- Export: the warning never blocks, and the suggestion lands on disk ----
  const exportButton = exportSection.getByTestId("export-action");
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await exportButton.click();
  await expect(exportSection.getByTestId("export-result")).toBeVisible({ timeout: 15_000 });

  const suggestion = path.join(repoRoot, ".scratch", "adr-suggestions-e2e", "adr-suggestions", `${key}.md`);
  expect(existsSync(suggestion)).toBe(true);
  const content = readFileSync(suggestion, "utf8");
  expect(content).toContain(`- **Decision key:** \`${key}\``);
  expect(content).toContain("None yet: no ticket lists this decision.");
});
