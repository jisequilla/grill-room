import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * `reopen-stale-review` (`server/interviewer/fake.ts`) scripts two rounds
 * that settle a root decision and two dependents, then a reopen of the
 * root, the stale review it triggers (one dependent reconfirmed, the other
 * re-asked under a new question), and the round the re-ask reopens — five
 * requests in that order. `server/interviewer/scenarios.test.ts`'s test of
 * the same name drives the same five turns through the action boundary;
 * this walks the same story through the UI.
 *
 * The round that reanswers the reopened root is the same `request-next-round`
 * call that runs the stale review (`server/stale-review.ts`), so the digest
 * must already be showing by the time that round's submission response
 * lands — not one submission later. That used to be exactly backwards (see
 * `app/lib/review-digest.ts`'s `reviewCompletedAt`, gr-pcd), which is why
 * this checks the digest right there, immediately after that submission,
 * rather than after some later round.
 */
test("reopening a settled decision runs its stale review and re-asks the affected dependent", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Reopen and stale review",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "reopen-stale-review");

  // ---- Round 1: the root --------------------------------------------------
  await page.getByRole("button", { name: "Start the interview" }).click();

  let cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("What shape should this take?");
  await answerOwnText(cards.first(), "A workspace.", "save");
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- Round 2: its two dependents -----------------------------------------
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Where does the data live?");
  await expect(cards.last()).toContainText("How does it sync?");
  await answerOwnText(cards.first(), "On disk.", "save");
  await answerOwnText(cards.last(), "Whatever the shape needs.", "save");
  await page.getByRole("button", { name: "Submit round" }).click();

  // Nothing left to propose: no round is open, and the tree holds all three,
  // settled.
  await expect(page.getByTestId("round-card")).toHaveCount(0);
  const treeRows = page.getByTestId("tree-row");
  const rootRow = treeRows.filter({ hasText: "What shape should this take?" });
  await expect(rootRow).toHaveAttribute("data-state", "settled");

  // ---- Reopen the root from the tree ---------------------------------------
  await rootRow.click();
  await page.getByRole("button", { name: "Reopen" }).click();
  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Reopen" }).click();
  await expect(confirmDialog).toBeHidden();
  await page.getByRole("button", { name: "Close" }).click();

  // It is asked again straight away, no interviewer turn spent.
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("What shape should this take?");
  await answerOwnText(cards.first(), "A page, after all.", "save");
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- The what-changed digest shows on this very submission ---------------
  // It answered the reopened root and ran the stale review in the same
  // request-next-round call, so this is the moment the digest first has
  // something to show — not a submission later (gr-pcd).
  const digest = page.getByTestId("review-digest");
  await expect(digest).toBeVisible();
  await expect(digest).toContainText("What changed");
  await expect(digest).toContainText("A workspace.");
  await expect(digest).toContainText("A page, after all.");

  await expect(digest).toContainText("Re-asked");
  await expect(digest).toContainText("How does a single page stay current?");
  await expect(digest).toContainText(
    "A single page syncs differently than a workspace.",
  );

  // The reconfirmed dependent starts collapsed behind its own count...
  const reconfirmedTrigger = digest.getByRole("button", {
    name: "1 reconfirmed",
  });
  await expect(reconfirmedTrigger).toBeVisible();
  await expect(digest).not.toContainText(
    "Storage still follows from the shape either way.",
  );
  // ...and expanding it reads the interviewer's reason.
  await reconfirmedTrigger.click();
  await expect(digest).toContainText(
    "Storage still follows from the shape either way.",
  );

  // The review-stale turn's own attempt log, collapsed beside the digest.
  await expect(digest.getByTestId("attempt-log-trigger")).toBeVisible();

  // ---- The stale review ran: one dependent reconfirmed, unchanged ----------
  await expect(rootRow).toHaveAttribute("data-state", "settled");
  const storageRow = treeRows.filter({ hasText: "Where does the data live?" });
  await expect(storageRow).toHaveAttribute("data-state", "settled");
  await storageRow.click();
  const detailSheet = page.getByRole("dialog");
  await expect(
    detailSheet.getByRole("heading", { name: "Where does the data live?" }),
  ).toBeVisible();
  // "On disk." also appears in the history list further down the sheet; the
  // current-answer section renders first, so `.first()` reads that one.
  await expect(detailSheet.getByText("On disk.").first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // ---- ...the other re-asked, back as an open round under its new question -
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(
    "How does a single page stay current?",
  );
  await expect(cards.first()).toContainText("Poll");
  await expect(cards.first()).toContainText("Push");

  const syncRow = treeRows.filter({ hasText: "How does a single page stay current?" });
  await expect(syncRow).toHaveAttribute("data-state", "frontier");
});
