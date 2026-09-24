import { expect, test } from "@playwright/test";

/**
 * The one browser smoke test the spec calls for (`.scratch/grill-room/spec.md`,
 * "Testing Decisions"): walk a full grilling session through the real UI,
 * against the running app with the fake interviewer enabled. Everything else
 * in this app is tested at the action boundary (see `actions/*.test.ts`); this
 * is the one place the browser itself is exercised.
 *
 * The fake interviewer's turn queue is scripted once, at server startup, by
 * `cannedInterviewTurns()` (`server/interviewer/fake.ts`) and lives for the
 * whole server process — not per session. `playwright.config.ts` starts a
 * fresh server for this suite, so the queue below is this test's alone:
 *
 *   1. propose-round  -> refused for a tree-rule violation (a dependency on
 *                         a decision that does not exist), then retried and
 *                         accepted: "What shape should this take?" / "Where
 *                         does the data live?", no dependencies, both
 *                         recommended. This is round 1's turn, and its two
 *                         attempts are what the attempt log below reads back.
 *   2. propose-round  -> done, no more decisions.
 *   3. find-superseded -> none (the done proposal's second half).
 *   4. synthesize-spec -> a canned spec.
 *   5. break-into-tickets -> two tickets, the second blocked by the first.
 *
 * This test drives exactly one session, consuming those five turns in order.
 * A second test in this file would starve on an empty queue, which is why the
 * suite is one test, one worker, no retries (see the config).
 */
test("walks the canned interview from a new session to broken-out tickets", async ({
  page,
}) => {
  // ---- Session list -> create a session -------------------------------
  await page.goto("/");
  // The shell's page title is plain text mounted into the header, not a
  // semantic heading (see `useSetPageTitle`), so this reads it by role
  // scoped to the header rather than an accessible heading name.
  await expect(page.locator("header")).toContainText("Sessions");

  await page.getByRole("button", { name: "New session" }).click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();

  await page.getByLabel("Title").fill("Playwright smoke test");
  await page
    .getByLabel("Idea")
    .fill("A workspace app that grills a loose idea into a spec.");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // ---- Land on the workspace -------------------------------------------
  await page.waitForURL(/\/sessions\/[^/]+$/);
  await expect(page.getByText("Interviewing")).toBeVisible();

  // ---- Start the interview: round 1 (two decisions, both recommended) --
  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("What shape should this take?");
  await expect(cards.last()).toContainText("Where does the data live?");

  // Card 1: accept the interviewer's recommendation.
  await cards
    .first()
    .getByRole("button", { name: "Accept" })
    .click();
  await expect(cards.first()).toContainText("Accepted the recommendation");

  // Card 2: a steering move — "I don't know" — so the round still leaves a
  // loose end to resolve later, the way a real interview sometimes does.
  await cards
    .last()
    .getByRole("button", { name: "I don't know", exact: true })
    .click();
  await expect(cards.last()).toContainText("I don't know");

  await expect(page.getByTestId("round-progress")).toHaveText(
    "2 of 2 answered",
  );

  // ---- Submit the round: settles one decision, leaves the other open ---
  await page.getByRole("button", { name: "Submit round" }).click();

  // The interviewer proposes done immediately (turn 2 of the canned queue),
  // so the workspace moves straight past any further round to the done
  // panel.
  await expect(
    page.getByText("The interviewer proposes you are done"),
  ).toBeVisible();

  // ---- The tree updated: the accepted decision is now settled ----------
  const treeRows = page.getByTestId("tree-row");
  await expect(
    treeRows.filter({ hasText: "What shape should this take?" }),
  ).toHaveAttribute("data-state", "settled");
  await expect(
    treeRows.filter({ hasText: "Where does the data live?" }),
  ).toHaveAttribute("data-state", "frontier");

  // ---- Round history: round 1's attempt log reads back the refusal ------
  // Round 1's proposal was refused once for a tree-rule violation before the
  // retry that succeeded (turn 1 of the canned queue above), so its turn has
  // two attempts. The fake interviewer has no latency, so by the time this
  // page can act, the turn has already stopped and the live turn-working
  // panel that would have shown it mid-flight is gone — the app has nothing
  // left running to poll. The same two attempts are read back here instead,
  // from round history's collapsed attempt log, which holds exactly what the
  // live status would have shown.
  await page.getByRole("button", { name: /Round 1/ }).click();

  const attemptLogTrigger = page.getByTestId("attempt-log-trigger");
  await expect(attemptLogTrigger).toHaveAttribute("data-count", "2");

  // Collapsed: the attempt rows are not rendered until the log itself is
  // expanded.
  await expect(page.getByTestId("attempt-row")).toHaveCount(0);

  await attemptLogTrigger.click();

  const attemptRows = page.getByTestId("attempt-row");
  await expect(attemptRows).toHaveCount(2);
  await expect(attemptRows.first()).toHaveAttribute(
    "data-attempt-kind",
    "tree-rule-refusal",
  );
  await expect(attemptRows.first()).toContainText(
    'depends on "fake-no-such-decision"',
  );
  await expect(attemptRows.last()).toHaveAttribute(
    "data-attempt-kind",
    "success",
  );

  // ---- Resolve the loose end the round left, before confirming ---------
  const looseEnd = page.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await expect(looseEnd).toContainText("Where does the data live?");
  await expect(looseEnd).toContainText("You said you don't know");

  await looseEnd.getByRole("button", { name: "Answer now" }).click();
  await page
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk, in the app's own database.");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByTestId("loose-ends-clear")).toBeVisible();
  await expect(page.getByText("Everything is answered or set aside.")).toBeVisible();

  // ---- Confirm shared understanding -------------------------------------
  await page.getByTestId("confirm-session").click();
  await expect(
    page.getByText("Shared understanding confirmed"),
  ).toBeVisible();

  // ---- Open the output, write the spec (turn 4), see it rendered --------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "Problem Statement",
  );
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "A canned spec, produced by the fake interviewer.",
  );

  // ---- Break into tickets (turn 5), see the list -------------------------
  await page.getByTestId("break-into-tickets").click();

  await expect(page.getByTestId("ticket-row-1")).toContainText(
    "Build the workspace",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText(
    "Store the data on disk",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText("Blocked by: #1");
});
