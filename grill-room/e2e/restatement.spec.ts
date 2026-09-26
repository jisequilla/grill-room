import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

const PROVIDER = "Which payment provider handles payouts?";
const SERVICE = "Which service launches first?";
const ORIGINAL = "Stirpe. Claude, double-check the fee table.";
const STATEMENT = "Stripe.";
const NOTES = "Claude, double-check the fee table.";
const REASON =
  "Fixed the spelling of Stripe and took out a note addressed to the AI.";
const NOTES_LABEL = "Kept for you, not exported";

/**
 * `restatement` (`server/interviewer/fake.ts`) scripts one round of two
 * independent decisions, a done proposal, and the check that runs
 * automatically as its second half — proposing a clean statement for the
 * payment provider's own answer, with its note to the AI kept aside.
 */
async function answerRoundToRestatement(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const sessionId = await createSession(page, {
    title: "Restatement",
    idea: "A marketplace for local services, paying sellers out through a provider.",
  });
  await chooseScenario(request, sessionId, "restatement");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(PROVIDER);
  await expect(cards.last()).toContainText(SERVICE);

  await answerOwnText(cards.first(), ORIGINAL, "save");
  await answerOwnText(cards.last(), "Dog walking.", "save");
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
  restatementText: string | null;
  previousAnswers: { text: string | null; operatorNotes: string | null }[];
}

async function readProvider(
  request: APIRequestContext,
  sessionId: string,
): Promise<TreeDecisionRow> {
  const response = await request.get(
    `/_agent-native/actions/get-tree?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBeTruthy();
  const tree: { decisions: TreeDecisionRow[] } = await response.json();
  const provider = tree.decisions.find(
    (decision) => decision.questionTitle === PROVIDER,
  );
  if (!provider) {
    throw new Error(
      `"${PROVIDER}" not found among: ${tree.decisions.map((d) => d.questionTitle).join(", ")}`,
    );
  }
  return provider;
}

function theProposal(page: Page) {
  return page
    .getByTestId("done-proposed-panel")
    .getByTestId("restatement-proposals")
    .getByTestId("restatement-proposal");
}

test("the done panel proposes a clean statement for an own answer, without blocking confirmation", async ({
  page,
  request,
}) => {
  await answerRoundToRestatement(page, request);

  const done = page.getByTestId("done-proposed-panel");
  await expect(done.getByTestId("loose-ends-clear")).toBeVisible();

  const group = done.getByTestId("restatement-proposals");
  await expect(group).toContainText("Answers to restate");
  const row = theProposal(page);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(PROVIDER);
  await expect(row.getByTestId("restatement-original")).toHaveText(ORIGINAL);
  await expect(row.getByTestId("restatement-statement")).toHaveText(STATEMENT);
  await expect(row.getByTestId("restatement-notes")).toContainText(NOTES_LABEL);
  await expect(row.getByTestId("restatement-notes")).toContainText(NOTES);
  await expect(row).toContainText(REASON);
  await expect(row).not.toContainText(SERVICE);

  // A pending restatement never blocks confirmation.
  await expect(done.getByTestId("confirm-session")).toBeEnabled();
});

test("accepting a restatement records the statement, and the history keeps the notes for the owner", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToRestatement(page, request);

  await theProposal(page).getByTestId("restatement-accept").click();

  const done = page.getByTestId("done-proposed-panel");
  await expect(done.getByTestId("restatement-proposals")).toHaveCount(0);
  await expect(done.getByTestId("confirm-session")).toBeEnabled();
  expect(await readProvider(request, sessionId)).toMatchObject({
    state: "settled",
    answer: { kind: "own-answer", text: STATEMENT },
    restatementText: null,
    previousAnswers: [{ text: ORIGINAL, operatorNotes: NOTES }],
  });

  await page.getByTestId("tree-row").filter({ hasText: PROVIDER }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const notes = sheet.getByTestId("history-operator-notes");
  await expect(notes).toContainText(NOTES_LABEL);
  await expect(notes).toContainText(NOTES);
  await expect(sheet).toContainText(ORIGINAL);
});

test("editing a restatement and saving records the edited statement", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToRestatement(page, request);
  const row = theProposal(page);

  await row.getByTestId("restatement-edit").click();
  const input = row.getByTestId("restatement-input");
  await expect(input).toHaveValue(STATEMENT);
  await input.fill("Stripe, on the standard plan.");
  await row.getByTestId("restatement-save").click();

  await expect(
    page.getByTestId("done-proposed-panel").getByTestId("restatement-proposals"),
  ).toHaveCount(0);
  expect(await readProvider(request, sessionId)).toMatchObject({
    answer: { kind: "own-answer", text: "Stripe, on the standard plan." },
    restatementText: null,
    previousAnswers: [{ text: ORIGINAL, operatorNotes: NOTES }],
  });
});

test("cancelling an edit leaves the proposal exactly as it was", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToRestatement(page, request);
  const row = theProposal(page);

  await row.getByTestId("restatement-edit").click();
  await row.getByTestId("restatement-input").fill("Something else entirely.");
  await row.getByTestId("restatement-cancel").click();

  await expect(row.getByTestId("restatement-input")).toHaveCount(0);
  await expect(row.getByTestId("restatement-statement")).toHaveText(STATEMENT);
  await expect(row.getByTestId("restatement-accept")).toBeVisible();
  expect(await readProvider(request, sessionId)).toMatchObject({
    answer: { kind: "own-answer", text: ORIGINAL },
    restatementText: STATEMENT,
    previousAnswers: [],
  });
});

test("dismissing a restatement removes it and leaves the answer as written", async ({
  page,
  request,
}) => {
  const sessionId = await answerRoundToRestatement(page, request);

  await theProposal(page).getByTestId("restatement-dismiss").click();

  const done = page.getByTestId("done-proposed-panel");
  await expect(done.getByTestId("restatement-proposals")).toHaveCount(0);
  await expect(done.getByTestId("confirm-session")).toBeEnabled();
  expect(await readProvider(request, sessionId)).toMatchObject({
    state: "settled",
    answer: { kind: "own-answer", text: ORIGINAL },
    restatementText: null,
    previousAnswers: [],
  });
});
