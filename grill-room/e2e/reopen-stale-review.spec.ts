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
 * The ticket asks this to check the what-changed digest and its attempt
 * log, but neither is reachable here: `sessions.$sessionId.tsx` computes
 * `lastSubmittedAt` (what the digest treats as "already seen") from every
 * submitted round, including the one that answers the reopened decision
 * itself — and that round's own submission is what runs the stale review
 * in the first place. Its `submittedAt` is always later than the review's
 * `reopenedAt`, so the digest — and the review-stale turn's attempt log,
 * which the digest is the only place in the UI that shows — hides on the
 * same request that would first make it true. Confirmed against the
 * running app (`get-tree` and `list-rounds` after this exact sequence);
 * out of this ticket's file boundary to fix (it is route logic, not a
 * component or a missing `data-testid`). Flagged in the PR; this test
 * checks the review's effects that are actually visible instead: the
 * reconfirmed dependent stays settled unchanged, and the re-asked one comes
 * back as an open round under its new question.
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
  await answerOwnText(cards.first(), "A workspace.");
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- Round 2: its two dependents -----------------------------------------
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Where does the data live?");
  await expect(cards.last()).toContainText("How does it sync?");
  await answerOwnText(cards.first(), "On disk.");
  await answerOwnText(cards.last(), "Whatever the shape needs.");
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
  await answerOwnText(cards.first(), "A page, after all.");
  await page.getByRole("button", { name: "Submit round" }).click();

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
