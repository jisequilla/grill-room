import { expect, test } from "@playwright/test";

import { createSession } from "./support";

const TITLE = "Where does the data live?";
const NOTE = "The builder picks the storage.";

/** `get-tree`'s decision shape, narrowed to what this test reads. */
interface TreeDecisionRow {
  questionTitle: string;
  state: string;
  dispositionTarget: string | null;
  answer: { kind: string; text: string | null } | null;
}

/**
 * A loose end is left to the builder, confirmed, and then moved to an open
 * question from its sheet. The move changes only the target: the note stays,
 * the decision stays settled and the session stays confirmed.
 */
test("a loose end left to the builder, then moved to an open question", async ({ page, request }) => {
  const sessionId = await createSession(page, {
    title: "Builder's call",
    idea: "A tool that turns a loose idea into settled decisions.",
  });

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
  await looseEnd.getByRole("button", { name: "Set aside" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Leave it to the builder/ }).click();
  await dialog.getByPlaceholder("Why it is set aside, in one line").fill(NOTE);
  await dialog.getByRole("button", { name: "Set aside", exact: true }).click();
  await expect(page.getByTestId("loose-ends-clear")).toBeVisible();
  await page.getByTestId("confirm-session").click();
  await expect(page.getByText("Shared understanding confirmed")).toBeVisible();

  await page.getByTestId("tree-row").filter({ hasText: TITLE }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("set-aside-kind")).toHaveText("Builder's call");

  await sheet.getByTestId("move-set-aside").click();
  await page.getByTestId("move-to-open-question").click();
  await expect(sheet.getByTestId("set-aside-kind")).toHaveText("Open question");

  const treeResponse = await request.get(
    `/_agent-native/actions/get-tree?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(treeResponse.ok()).toBeTruthy();
  const tree: { decisions: TreeDecisionRow[] } = await treeResponse.json();
  const moved = tree.decisions.find((decision) => decision.questionTitle === TITLE);
  expect(moved).toMatchObject({
    dispositionTarget: "open-question",
    state: "settled",
    answer: { text: NOTE },
  });

  const sessionResponse = await request.get(
    `/_agent-native/actions/get-session?id=${encodeURIComponent(sessionId)}`,
  );
  expect(sessionResponse.ok()).toBeTruthy();
  expect(await sessionResponse.json()).toMatchObject({ state: "confirmed" });
});
