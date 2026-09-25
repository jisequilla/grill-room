import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * `refusal-then-success` (`server/interviewer/fake.ts`) scripts round 1's
 * proposal refused once for a tree-rule violation (a dependency cycle) and
 * accepted on the automatic retry inside the same turn — two attempts of
 * one turn, which is exactly what the attempt log is for.
 *
 * A round proposal's attempt log is only ever shown two places: the live
 * turn status while it runs, and collapsed in round history once the round
 * is submitted (`.grill-room/turn-visibility/spec.md`, "Round proposals: in
 * the live turn status and collapsed in round history"). This scenario has
 * no latency scripted, so — as `smoke.spec.ts` notes for its own round 1 —
 * the live view is gone by the time the page can act on it; round history
 * is the one that is actually reachable, so this test submits the round to
 * read it there.
 *
 * The scenario scripts nothing past that one round. Submitting it asks the
 * interviewer for whatever comes next (this session is in the default
 * whole-round answering mode, which always asks again once nothing is
 * pending), and this session's queue has nothing left to serve that ask —
 * it fails, visibly, as a generic turn failure. That is fine: the round was
 * already recorded as submitted before the ask ran, so round history holds
 * exactly what this test came to read, and the failure afterward is not
 * this scenario's story.
 */
test("round history's attempt log shows the refusal row then the success row", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Refusal then success",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "refusal-then-success");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("What shape should this take?");

  await answerOwnText(cards.first(), "A single page.");
  await expect(page.getByTestId("round-progress")).toHaveText(
    "1 of 1 answered",
  );

  await page.getByRole("button", { name: "Submit round" }).click();

  const roundHistory = page.getByTestId("round-history");
  await roundHistory.getByRole("button", { name: /Round 1/ }).click();

  const attemptLogTrigger = roundHistory.getByTestId("attempt-log-trigger");
  await expect(attemptLogTrigger).toHaveAttribute("data-count", "2");
  // Collapsed: the rows are not rendered until the log is expanded.
  await expect(roundHistory.getByTestId("attempt-row")).toHaveCount(0);

  await attemptLogTrigger.click();

  const attemptRows = roundHistory.getByTestId("attempt-row");
  await expect(attemptRows).toHaveCount(2);
  await expect(attemptRows.first()).toHaveAttribute(
    "data-attempt-kind",
    "tree-rule-refusal",
  );
  await expect(attemptRows.first()).toContainText("dependency cycle");
  await expect(attemptRows.last()).toHaveAttribute(
    "data-attempt-kind",
    "success",
  );
});
