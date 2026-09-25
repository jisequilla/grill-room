import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario } from "./support";

/**
 * The whole app, walked at a watchable pace against the `demo` scenario: one
 * real interview, recorded once against this repository with
 * `GRILL_ROOM_RECORD_TURNS` (see
 * `.grill-room/regression-scenarios/issues/05-recorded-demo.md`) and replayed
 * here through the fake interviewer. `just demo` runs only this file, with
 * Playwright video on, and compresses the result to `docs/media/demo.webm`.
 *
 * Not part of `just e2e` (see `playwright.config.ts`'s `demo` project and its
 * `testMatch`/exclusion from the default project) — this test is slow by
 * design, pausing after each step so a human watching the video can follow
 * it, not a regression guard for the flows the other `e2e/*.spec.ts` files
 * already cover at normal speed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PROJECT_DIR = path.join(__dirname, "fixtures", "demo-project");

/** How long each step stays on screen before the next one starts. */
const PAUSE_MS = 1800;

/** Scrolls `locator` into view, then holds so the step reads on screen. */
async function beat(page: Page, locator?: Locator): Promise<void> {
  if (locator) await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(PAUSE_MS);
}

/**
 * Builds a throwaway git repository from the committed fixture files
 * (`e2e/fixtures/demo-project/`) — exactly the files the recorded scout
 * cited, copied verbatim from the repository at recording time (see that
 * directory's own citations). The demo project's git history, and therefore
 * its `HEAD` commit, is new every run; nothing in the replay depends on it
 * matching the commit the recording names; only the file contents and their
 * relative paths have to.
 */
function buildDemoProjectRepo(): string {
  const repoDir = mkdtempSync(path.join(tmpdir(), "grill-room-demo-project-"));
  cpSync(FIXTURE_PROJECT_DIR, repoDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "demo@example.invalid"], {
    cwd: repoDir,
  });
  execFileSync("git", ["config", "user.name", "Grill Room Demo"], {
    cwd: repoDir,
  });
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "Demo project fixture"], {
    cwd: repoDir,
  });
  return repoDir;
}

test("demo: the whole app, from idea to export", async ({ page, request }) => {
  // Generous: this walk makes roughly twenty real UI round trips plus the
  // deliberate pauses between them.
  test.setTimeout(5 * 60_000);

  // ---- A project whose files match the recorded scout's citations --------
  const repoDir = buildDemoProjectRepo();
  const registerResponse = await request.post(
    "/_agent-native/actions/register-project",
    {
      data: {
        root: repoDir,
        verifyCommand: "pnpm test",
        name: "Demo repo",
        workingExportFolder: ".scratch",
      },
    },
  );
  if (!registerResponse.ok()) {
    throw new Error(
      `register-project failed: ${registerResponse.status()} ${await registerResponse.text()}`,
    );
  }

  // ---- New session: the idea the recording was grilled against -----------
  await page.goto("/");
  await page.getByRole("button", { name: "New session" }).click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();

  await page.getByLabel("Title").fill("Decisions.md export");
  await page
    .getByLabel("Idea")
    .fill(
      "Export a session's decisions as a decisions.md beside the spec, each with its origin (user, interviewer, recorded or inferred from the repo) and citation.",
    );

  await page.locator("#session-model").click();
  await page.getByRole("option", { name: "Opus" }).click();

  await page.getByTestId("session-project-trigger").click();
  await page.getByRole("option", { name: "Demo repo" }).click();

  await beat(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/sessions\/[^/]+$/);
  const match = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!match) throw new Error(`Could not read a session id off ${page.url()}`);
  const sessionId = match[1]!;
  await chooseScenario(request, sessionId, "demo");

  await beat(page);

  // ---- Readiness: the scout runs first (no report yet), then the judge ---
  const readinessPanel = page.getByTestId("readiness-panel");
  await beat(page, readinessPanel);
  await readinessPanel.getByTestId("readiness-assess").click();

  await expect(readinessPanel.getByTestId("readiness-verdict")).toHaveAttribute(
    "data-verdict",
    "ready",
    { timeout: 30_000 },
  );
  await beat(page, readinessPanel);

  const scoutPanel = page.getByTestId("scout-panel");
  await expect(scoutPanel).toBeVisible();
  await expect(scoutPanel.getByTestId("scout-decision")).toHaveCount(8);
  await beat(page, scoutPanel);

  // ---- Keep the two decisions that define the file's placement and shape -
  const decisionRow = (key: string) =>
    scoutPanel.getByTestId("scout-decision").filter({
      has: page.locator(`[data-key="${key}"]`),
    });

  for (const key of ["decisions-md-beside-spec", "decisions-md-content-shape"]) {
    const row = scoutPanel.locator(
      `[data-testid="scout-decision"][data-key="${key}"]`,
    );
    await row.scrollIntoViewIfNeeded();
    await row.getByTestId("scout-decision-keep").click();
    await expect(row).toHaveAttribute("data-disposition", "kept");
    await beat(page, row);
  }

  // ---- Drop the rest: they duplicate what the two kept decisions already
  // establish, or belong to sibling work this feature does not build -------
  for (const key of [
    "decision-origin-values",
    "repo-decision-source-values",
    "decisions-md-recorded-loop",
    "export-file-plan-is-pure-and-tested",
    "export-manifest-owns-removal",
    "export-ownership-out-of-scope-for-scout",
  ]) {
    const row = scoutPanel.locator(
      `[data-testid="scout-decision"][data-key="${key}"]`,
    );
    await row.scrollIntoViewIfNeeded();
    await row.getByTestId("scout-decision-drop").click();
    await expect(row).toHaveAttribute("data-disposition", "dropped");
    await beat(page, row);
  }
  void decisionRow; // kept for readability of the two loops above

  // ---- Start the interview: round 1 (6 cards) -----------------------------
  // The two kept repo decisions already populate the tree, so the workspace
  // shows "Ask for the next round" (`NextRoundPanel`) rather than "Start the
  // interview" (`StartInterviewPanel`, only shown with an empty tree) — both
  // call the same `request-next-round` action.
  await page.getByRole("button", { name: "Ask for the next round" }).click();

  let cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(6, { timeout: 30_000 });
  await beat(page, cards.first());

  async function acceptCard(title: string): Promise<void> {
    const card = cards.filter({ hasText: title });
    await card.scrollIntoViewIfNeeded();
    // Exact: several recommended choice labels in the recorded interview
    // contain the word "accepted" (e.g. "...accepted recommendation, picked
    // another choice..."), which a substring match on "Accept" also hits.
    await card.getByRole("button", { name: "Accept", exact: true }).click();
    await beat(page, card);
  }

  await acceptCard("decisions.md only, or intent.md too");
  await acceptCard("Which tree decisions go into the file");
  await acceptCard("What 'origin' means per entry");

  const citationCard = cards.filter({
    hasText: "What 'citation' means for user and interviewer decisions",
  });
  await citationCard.scrollIntoViewIfNeeded();
  await answerOwnText(
    citationCard,
    "A user or interviewer decision carries no citation; the field is left null for those, and only repo-origin entries carry one.",
  );
  await beat(page, citationCard);

  await acceptCard("Re-exporting repo decisions that were kept unchanged");
  await acceptCard("What each entry says beyond origin and citation");

  await beat(page, page.getByTestId("round-progress"));
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- Round 2 (6 cards), all recommendations accepted --------------------
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(6, { timeout: 30_000 });
  await beat(page, cards.first());

  await acceptCard("Markdown layout of an entry");
  await acceptCard("Wording and source of the 'how it was answered' label");
  await acceptCard("How a reopened repo decision appears");
  await acceptCard("When decisions.md is written at all");
  await acceptCard("Order of entries");
  await acceptCard("Where the renderer lives and how it is tested");

  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- The interviewer proposes done --------------------------------------
  const doneHeading = page.getByText("The interviewer proposes you are done");
  await expect(doneHeading).toBeVisible({ timeout: 30_000 });
  await beat(page, doneHeading);

  // ---- Reopen one settled decision from the tree --------------------------
  const treeRows = page.getByTestId("tree-row");
  const inclusionRow = treeRows.filter({
    hasText: "Which tree decisions go into the file",
  });
  await inclusionRow.scrollIntoViewIfNeeded();
  await beat(page, inclusionRow);
  await inclusionRow.click();

  const detailSheet = page.getByRole("dialog");
  await expect(detailSheet).toBeVisible();
  await beat(page, detailSheet);
  await detailSheet.getByRole("button", { name: "Reopen" }).click();

  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toBeVisible();
  await beat(page, confirmDialog);
  await confirmDialog.getByRole("button", { name: "Reopen" }).click();
  await expect(confirmDialog).toBeHidden();
  await page.getByRole("button", { name: "Close" }).click();

  // ---- It is asked again straight away: answer it differently ------------
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1, { timeout: 30_000 });
  const inclusionCard = cards.first();
  await inclusionCard.scrollIntoViewIfNeeded();
  await beat(page, inclusionCard);
  await answerOwnText(
    inclusionCard,
    "Settled decisions only, plus a clearly separated Unresolved section listing every open, deferred, unknown and prototype-flagged loose end by title, so a reader sees them without the next scout mistaking them for recorded decisions.",
  );
  await beat(page, inclusionCard);
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- The stale review's what-changed digest, right on this submission --
  const digest = page.getByTestId("review-digest");
  await expect(digest).toBeVisible({ timeout: 30_000 });
  await beat(page, digest);
  await expect(digest).toContainText("Re-asked");
  await expect(digest).toContainText(
    "When decisions.md is written at all, now that it has an Unresolved section",
  );

  const reconfirmedTrigger = digest.getByRole("button", {
    name: /reconfirmed/,
  });
  await reconfirmedTrigger.click();
  await beat(page, digest);

  // ---- The re-ask round it produced (3 cards): accept every recommendation
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(3, { timeout: 30_000 });
  await beat(page, cards.first());

  await acceptCard(
    "When decisions.md is written at all, now that it has an Unresolved section",
  );
  await acceptCard(
    "How the next scout is kept from reading Unresolved items as decisions",
  );
  await acceptCard("Exactly which states land in Unresolved, and what each line shows");

  await page.getByRole("button", { name: "Submit round" }).click();
  await expect(doneHeading).toBeVisible({ timeout: 30_000 });
  await beat(page, doneHeading);

  // ---- Confirm shared understanding ---------------------------------------
  await page.getByTestId("confirm-session").click();
  await expect(page.getByText("Shared understanding confirmed")).toBeVisible({
    timeout: 15_000,
  });
  await beat(page);

  // ---- The output page: spec, tickets, handoff, export -------------------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  const specSection = page.getByTestId("output-spec-section");
  await beat(page, specSection);
  await specSection.getByTestId("write-spec").click();
  await expect(specSection).toContainText("Problem Statement", {
    timeout: 30_000,
  });
  await beat(page, specSection);

  const ticketsSection = page.getByTestId("output-tickets-section");
  await beat(page, ticketsSection);
  await ticketsSection.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-1")).toBeVisible({
    timeout: 30_000,
  });
  await beat(page, ticketsSection);

  const handoffSection = page.getByTestId("output-handoff-section");
  await beat(page, handoffSection);
  await handoffSection.getByTestId("generate-handoff").click();
  await expect(handoffSection.getByTestId("handoff-document-view")).toBeVisible(
    { timeout: 15_000 },
  );
  await beat(page, handoffSection);

  const exportSection = page.getByTestId("output-export-section");
  await beat(page, exportSection);
  const exportButton = exportSection.getByTestId("export-action");
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  await exportButton.click();
  await expect(exportSection.getByTestId("export-result")).toBeVisible({
    timeout: 15_000,
  });
  await beat(page, exportSection);
});
