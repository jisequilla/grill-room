import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-cards-project-")));
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
 * A session on `scenario` in a registered project, walked through the canned
 * interview (as `uncovered-story.spec.ts` walks it, loose end included) to
 * the output page, with the spec written and the tickets broken out.
 */
async function aSessionBrokenIntoTickets(
  page: Page,
  request: APIRequestContext,
  scenario: string,
): Promise<string> {
  const sessionId = await createSession(page, {
    title: `Consistency cards e2e (${scenario})`,
    idea: "A run store that keeps benchmark data for the monitor.",
  });
  await chooseScenario(request, sessionId, scenario);
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
  return sessionId;
}

async function generateHandoff(page: Page) {
  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  const handoffView = handoffSection.getByTestId("handoff-document-view");
  await expect(handoffView).toBeVisible({ timeout: 15_000 });
  return handoffView;
}

async function briefOf(
  request: APIRequestContext,
  sessionId: string,
  ticketNumber: number,
): Promise<string> {
  const response = await request.get(
    `/_agent-native/actions/get-handoff?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    handoff: { briefs: { ticketNumber: number; markdown: string }[] } | null;
  };
  return body.handoff!.briefs.find((brief) => brief.ticketNumber === ticketNumber)!.markdown;
}

test("reopen cards are dismissed, listed in the handoff and its briefs, and asked in the interview", async ({
  page,
  request,
}) => {
  const sessionId = await aSessionBrokenIntoTickets(page, request, "consistency-findings");

  // ---- Seven open cards -------------------------------------------------
  const cards = page.locator('[data-testid^="consistency-card-"]');
  await expect(cards).toHaveCount(7);
  for (let number = 1; number <= 7; number += 1) {
    await expect(page.getByTestId(`consistency-card-${number}`)).toHaveAttribute("data-status", "open");
  }
  await expect(page.getByTestId("consistency-card-1")).toContainText("must outlast the benchmark horizon");

  // ---- Dismiss card 7 ---------------------------------------------------
  await page.getByTestId("consistency-dismiss-7").click();
  await expect(page.getByTestId("consistency-card-7")).toHaveAttribute("data-status", "dismissed");

  // ---- The handoff lists the open questions, and brief 02 its own -------
  const handoffView = await generateHandoff(page);
  await expect(handoffView).toContainText("Questions the spec and tickets leave open");
  await expect(handoffView).toContainText("What is N, the number of cadences polling is capped at?");
  await expect(handoffView).not.toContainText("Which host is the staging environment?");
  const brief02 = await briefOf(request, sessionId, 2);
  expect(brief02).toContain("## Open questions on this ticket");
  expect(brief02).toContain("What is N, the number of cadences polling is capped at?");

  // ---- Answer card 2, with card 5 as well -------------------------------
  await page.getByTestId("consistency-answer-2").click();
  const dialog = page.getByTestId("consistency-ask-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("consistency-ask-option-2")).toHaveAttribute("data-state", "checked");
  await expect(dialog.getByTestId("consistency-ask-option-5")).toHaveAttribute("data-state", "unchecked");
  await expect(dialog.getByTestId("consistency-ask-option-7")).toHaveCount(0);
  await dialog.getByTestId("consistency-ask-option-5").click();
  await dialog.getByTestId("consistency-ask-confirm").click();

  await page.waitForURL(new RegExp(`/sessions/${sessionId}$`));
  const treeRows = page.getByTestId("tree-row");
  await expect(treeRows.filter({ hasText: "What is N, the number of cadences polling is capped at?" })).toHaveCount(1);
  await expect(
    treeRows.filter({ hasText: "Which does the booking payment use: Checkout or Payment Element?" }),
  ).toHaveCount(1);
  // Only the checked cards were asked: none of the other open ones reached the tree.
  for (const question of [
    "How long after the benchmark ends must run data be kept?",
    "Which root span does a run driven by hand get?",
    "Does ticket 1 fill in Retention now, or is it left as a placeholder for a later ticket?",
    "How long can an accepted booking stay unpaid before it times out?",
  ]) {
    await expect(treeRows.filter({ hasText: question })).toHaveCount(0);
  }
  const listed = await request.get(
    `/_agent-native/actions/list-consistency-findings?sessionId=${encodeURIComponent(sessionId)}`,
  );
  const { findings } = (await listed.json()) as { findings: { number: number; status: string }[] };
  expect(findings.map((card) => [card.number, card.status])).toEqual([
    [1, "open"],
    [2, "asked"],
    [3, "open"],
    [4, "open"],
    [5, "asked"],
    [6, "open"],
    [7, "dismissed"],
  ]);
});

test("a rate-limited check leaves its note beside the cards, and the handoff says the tickets were not judged", async ({
  page,
  request,
}) => {
  await aSessionBrokenIntoTickets(page, request, "consistency-check-rate-limited");

  const note = page.getByTestId("consistency-note");
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute("data-error-code", "rate-limited");
  await expect(page.getByTestId("output-turn-failed")).toHaveCount(0);

  const handoffView = await generateHandoff(page);
  await expect(handoffView).toContainText("Questions the spec and tickets leave open");
  await expect(handoffView).toContainText("The consistency check has not judged these tickets");
});

test("a clean check says it found nothing", async ({ page, request }) => {
  await aSessionBrokenIntoTickets(page, request, "canned-interview");

  await expect(page.getByTestId("consistency-none")).toBeVisible();
});
