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
 *   1. propose-round  -> "What shape should this take?" / "Where does the
 *                         data live?", no dependencies, both recommended.
 *   2. propose-round  -> done, no more decisions.
 *   3. synthesize-spec -> a canned spec.
 *   4. break-into-tickets -> two tickets, the second blocked by the first.
 *
 * This test drives exactly one session, consuming those four turns in order.
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

  // ---- Open the output, write the spec (turn 3), see it rendered --------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "Problem Statement",
  );
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "A canned spec, produced by the fake interviewer.",
  );

  // ---- Break into tickets (turn 4), see the list -------------------------
  await page.getByTestId("break-into-tickets").click();

  await expect(page.getByTestId("ticket-row-1")).toContainText(
    "Build the workspace",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText(
    "Store the data on disk",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText("Blocked by: #1");
});
