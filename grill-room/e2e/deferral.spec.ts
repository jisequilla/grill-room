import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

const HOLD = "How long is a payout held before release?";
const SERVICE = "Which service launches first?";
const DEFERRING_ANSWER = "Wait until dispute handling is settled";
const REASON =
  "The answer waits on dispute handling instead of choosing a hold period.";

/**
 * `deferral` (`server/interviewer/fake.ts`) scripts one round of two
 * independent decisions, a done proposal, and the check that runs
 * automatically as its second half — flagging the hold period's own answer as
 * a deferral. Its last turn is the empty round "Continue the interview" asks
 * for, which opens only the deferred decision again.
 */
async function answerRoundToDeferral(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const sessionId = await createSession(page, {
    title: "Deferral",
    idea: "A marketplace for local services, with payouts held for disputes.",
  });
  await chooseScenario(request, sessionId, "deferral");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(HOLD);
  await expect(cards.last()).toContainText(SERVICE);

  await answerOwnText(cards.first(), DEFERRING_ANSWER);
  await answerOwnText(cards.last(), "Dog walking.");
  await expect(page.getByTestId("round-progress")).toHaveText(
    "2 of 2 answered",
  );
  await page.getByRole("button", { name: "Submit round" }).click();

  await expect(page.getByTestId("done-proposed-panel")).toBeVisible();
  return sessionId;
}

/** `get-tree`'s decision shape, narrowed to what these tests read. */
interface TreeDecisionRow {
  questionTitle: string;
  state: string;
  answer: { kind: string; text: string | null } | null;
  deferralReason: string | null;
}

async function readHoldDecision(
  request: APIRequestContext,
  sessionId: string,
): Promise<TreeDecisionRow> {
  const response = await request.get(
    `/_agent-native/actions/get-tree?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBeTruthy();
  const tree: { decisions: TreeDecisionRow[] } = await response.json();
  const hold = tree.decisions.find((decision) => decision.questionTitle === HOLD);
  if (!hold) {
    throw new Error(
      `"${HOLD}" not found among: ${tree.decisions.map((d) => d.questionTitle).join(", ")}`,
    );
  }
  return hold;
}

test("the done panel proposes an own answer that defers, without blocking confirmation", async ({
  page,
  request,
}) => {
  await answerRoundToDeferral(page, request);

  const done = page.getByTestId("done-proposed-panel");
  await expect(done.getByTestId("loose-ends-clear")).toBeVisible();

  const group = done.getByTestId("deferral-proposals");
  await expect(group).toBeVisible();
  await expect(group).toContainText("Answers that read as deferrals");
  const row = group.getByTestId("deferral-proposal");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(HOLD);
  await expect(row).toContainText(DEFERRING_ANSWER);
  await expect(row).toContainText(REASON);
  await expect(row).not.toContainText(SERVICE);

  // A pending deferral never blocks confirmation.
  await expect(done.getByTestId("confirm-session")).toBeEnabled();
});

test("accepting a deferral makes it a loose end that blocks confirmation, and continuing asks it again", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToDeferral(page, request);

  const done = page.getByTestId("done-proposed-panel");
  await done
    .getByTestId("deferral-proposals")
    .getByTestId("deferral-proposal")
    .getByTestId("deferral-accept")
    .click();

  await expect(done.getByTestId("deferral-proposals")).toHaveCount(0);
  const looseEnd = done.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await expect(looseEnd).toContainText(HOLD);
  await expect(done.getByTestId("confirm-session")).toBeDisabled();

  const hold = await readHoldDecision(request, sessionId);
  expect(hold.answer?.kind).toBe("deferred");

  await done.getByRole("button", { name: "Continue the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(HOLD);
});

test("dismissing a deferral removes it and leaves the decision settled", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToDeferral(page, request);

  const done = page.getByTestId("done-proposed-panel");
  await done
    .getByTestId("deferral-proposals")
    .getByTestId("deferral-proposal")
    .getByTestId("deferral-dismiss")
    .click();

  await expect(done.getByTestId("deferral-proposals")).toHaveCount(0);
  await expect(done.getByTestId("loose-ends-clear")).toBeVisible();
  await expect(done.getByTestId("confirm-session")).toBeEnabled();

  const hold = await readHoldDecision(request, sessionId);
  expect(hold).toMatchObject({
    state: "settled",
    answer: { kind: "own-answer", text: DEFERRING_ANSWER },
    deferralReason: null,
  });
});
