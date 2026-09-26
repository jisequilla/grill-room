import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * `supersession` (`server/interviewer/fake.ts`) scripts a round of two
 * independent decisions, a done proposal once one settles and the other is
 * left a loose end, and the supersession check that runs automatically as
 * the done proposal's second half. `server/interviewer/scenarios.test.ts`'s
 * test of the same name confirms this needs no separate call: submitting
 * the round is enough to consume all three requests.
 */
test("the done panel shows the proposed supersession and its attempt log", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Supersession",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "supersession");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("What shape should this take?");
  await expect(cards.last()).toContainText("Where does the data live?");

  await answerOwnText(cards.first(), "A workspace, on disk.", "save");
  await cards
    .last()
    .getByRole("button", { name: "I don't know", exact: true })
    .click();

  await expect(page.getByTestId("round-progress")).toHaveText(
    "2 of 2 answered",
  );
  await page.getByRole("button", { name: "Submit round" }).click();

  // ---- The done proposal, with the loose end it left -----------------------
  const done = page.getByTestId("done-proposed-panel");
  await expect(done).toBeVisible();
  await expect(done).toContainText(
    "The shape is settled; nothing else is left to ask.",
  );

  const looseEnd = done.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await expect(looseEnd).toContainText("Where does the data live?");

  // ---- The supersession the check proposed on it, and its attempt log -----
  const supersession = looseEnd.getByTestId("supersession");
  await expect(supersession).toBeVisible();
  await expect(supersession).toContainText(
    "Answered by: What shape should this take?",
  );
  await expect(supersession).toContainText(
    "On disk, inside the workspace shape.",
  );

  const attemptTrigger = done.getByTestId("attempt-log-trigger");
  await expect(attemptTrigger).toHaveAttribute("data-count", "1");
  await attemptTrigger.click();
  await expect(done.getByTestId("attempt-row")).toHaveAttribute(
    "data-attempt-kind",
    "success",
  );

  // Accepting it closes the loose end the check found.
  await supersession.getByTestId("accept-supersession").click();
  await expect(done.getByTestId("loose-ends-clear")).toBeVisible();
});
