import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { chooseScenario, createSession } from "./support";

/**
 * `replacement` (`server/interviewer/fake.ts`) scripts round 1 settling
 * `storage` ("Where does the data live?") by accepting its recommendation,
 * round 2 settling `storage-location` ("Which disk does the data live on?",
 * which depends on it) the same way, a done proposal with no loose end, and
 * the supersession check that runs automatically as the done proposal's
 * second half — proposing `storage-location` as replacing `storage`.
 * `server/interviewer/scenarios.test.ts`'s test of the same name confirms
 * this needs no separate call: submitting each round is enough.
 */
async function answerBothRoundsToReplacement(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const sessionId = await createSession(page, {
    title: "Replacement",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "replacement");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const round1 = page.getByTestId("round-card");
  await expect(round1).toHaveCount(1);
  await expect(round1.first()).toContainText("Where does the data live?");
  await round1
    .first()
    .getByTestId("recommendation-block")
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(page.getByTestId("round-progress")).toHaveText(
    "1 of 1 answered",
  );
  await page.getByRole("button", { name: "Submit round" }).click();

  const round2 = page.getByTestId("round-card");
  await expect(round2).toHaveCount(1);
  await expect(round2.first()).toContainText(
    "Which disk does the data live on?",
  );
  await round2
    .first()
    .getByTestId("recommendation-block")
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(page.getByTestId("round-progress")).toHaveText(
    "1 of 1 answered",
  );
  await page.getByRole("button", { name: "Submit round" }).click();

  await expect(page.getByTestId("done-proposed-panel")).toBeVisible();
  return sessionId;
}

/** `get-tree`'s decision shape, narrowed to what these tests read. */
interface TreeDecisionRow {
  questionTitle: string;
  replacedBy: { key: string | null } | null;
}

async function readStorageDecision(
  request: APIRequestContext,
  sessionId: string,
): Promise<TreeDecisionRow> {
  const response = await request.get(
    `/_agent-native/actions/get-tree?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBeTruthy();
  const tree: { decisions: TreeDecisionRow[] } = await response.json();
  const storage = tree.decisions.find(
    (decision) => decision.questionTitle === "Where does the data live?",
  );
  if (!storage) {
    throw new Error(
      `"Where does the data live?" not found among: ${tree.decisions.map((d) => d.questionTitle).join(", ")}`,
    );
  }
  return storage;
}

test("the done panel shows a replaced decision without blocking confirmation", async ({
  page,
  request,
}) => {
  await answerBothRoundsToReplacement(page, request);

  const done = page.getByTestId("done-proposed-panel");
  await expect(done).toContainText("Storage and where it lives are settled.");
  await expect(done.getByTestId("loose-ends-clear")).toBeVisible();

  // Acceptance line 4: a plain count, not gated on loose ends — the button
  // shows with none remaining and two decisions settled this round.
  const checkButton = done.getByTestId("check-superseded");
  await expect(checkButton).toBeVisible();
  await expect(checkButton).toContainText(
    "Check for answered or replaced decisions",
  );

  const group = done.getByTestId("replaced-decisions");
  await expect(group).toBeVisible();
  const row = group.getByTestId("replacement");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Which disk does the data live on?");
  await expect(row).toContainText(
    "The data lives in a synced cloud folder, not only on the local disk.",
  );

  // A pending replacement never blocks confirmation.
  await expect(done.getByTestId("confirm-session")).toBeEnabled();
});

test("accepting a replaced-decision proposal removes it and marks the decision replaced", async ({
  page,
  request,
}) => {
  const sessionId = await answerBothRoundsToReplacement(page, request);

  const done = page.getByTestId("done-proposed-panel");
  const row = done
    .getByTestId("replaced-decisions")
    .getByTestId("replacement");
  await row.getByTestId("accept-replacement").click();

  await expect(done.getByTestId("replaced-decisions")).toHaveCount(0);

  const storage = await readStorageDecision(request, sessionId);
  expect(storage.replacedBy?.key).toBe("storage-location");
});

test("dismissing a replaced-decision proposal removes it without marking the decision replaced", async ({
  page,
  request,
}) => {
  const sessionId = await answerBothRoundsToReplacement(page, request);

  const done = page.getByTestId("done-proposed-panel");
  const row = done
    .getByTestId("replaced-decisions")
    .getByTestId("replacement");
  await row.getByTestId("dismiss-replacement").click();

  await expect(done.getByTestId("replaced-decisions")).toHaveCount(0);

  const storage = await readStorageDecision(request, sessionId);
  expect(storage.replacedBy).toBeNull();
});
