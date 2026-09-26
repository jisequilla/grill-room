import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { chooseScenario, createSession } from "./support";

/**
 * gr-ibp.1.3: an own answer that reads as a deferral ("Wait until dispute
 * handling is settled") gets nudged toward the Defer state at save time,
 * rather than being stored and later exported as a settled decision (the
 * defect Pipe's 2026-09-25 review found). `canned-interview`
 * (`server/interviewer/fake.ts`'s `cannedInterviewTurns()`) is the default
 * fake scenario: its first round asks two cards, "What shape should this
 * take?" and "Where does the data live?", both with choices and a
 * recommendation, which this test ignores in favour of "Write my own" so it
 * can control the typed text.
 */

/** `list-loose-ends`'s shape, narrowed to what these tests read. */
interface LooseEndRow {
  questionTitle: string;
  answer: { text: string | null; kind: string } | null;
}

async function looseEnds(
  request: APIRequestContext,
  sessionId: string,
): Promise<LooseEndRow[]> {
  const response = await request.get(
    `/_agent-native/actions/list-loose-ends?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("typing a deferral phrase in the own-answer box shows the hint and two save buttons; plain text shows neither", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Deferral nudge",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "canned-interview");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  const shapeCard = cards.first();
  await expect(shapeCard).toContainText("What shape should this take?");

  await shapeCard.getByRole("button", { name: "Write my own" }).click();
  const textbox = shapeCard.getByPlaceholder(
    "What you have decided, in your own words",
  );

  // ---- Plain text: no hint, one Save button --------------------------------
  await textbox.fill("Postgres, with a read replica");
  await expect(shapeCard.getByTestId("deferral-hint")).toHaveCount(0);
  await expect(
    shapeCard.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(shapeCard.getByTestId("save-as-defer")).toHaveCount(0);
  await expect(shapeCard.getByTestId("save-as-answer")).toHaveCount(0);

  // ---- A deferral phrase: the hint and the two buttons ---------------------
  await textbox.fill("Wait until dispute handling is settled");
  await expect(shapeCard.getByTestId("deferral-hint")).toHaveText(
    "This reads like a deferral.",
  );
  await expect(shapeCard.getByTestId("deferral-hint")).toHaveAttribute(
    "role",
    "status",
  );
  await expect(
    shapeCard.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await expect(shapeCard.getByTestId("save-as-defer")).toBeVisible();
  await expect(shapeCard.getByTestId("save-as-answer")).toBeVisible();

  // ---- Save as Defer: the card shows the deferred state and keeps the text -
  await shapeCard.getByTestId("save-as-defer").click();
  await expect(shapeCard).toContainText("Deferred");
  await expect(shapeCard).toContainText(
    "Wait until dispute handling is settled",
  );

  // ---- Submit the round, then check the deferred loose end ---------------
  const storageCard = cards.last();
  await storageCard.getByRole("button", { name: "Write my own" }).click();
  await storageCard
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk.");
  await storageCard.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Submit round" }).click();

  // The next round (or the done panel) only renders once the submission has
  // settled server-side, so waiting for either is proof the write landed.
  await expect(async () => {
    const ends = await looseEnds(request, sessionId);
    const shape = ends.find(
      (end) => end.questionTitle === "What shape should this take?",
    );
    expect(shape).toBeTruthy();
    expect(shape?.answer?.kind).toBe("deferred");
    expect(shape?.answer?.text).toBe(
      "Wait until dispute handling is settled",
    );
  }).toPass();
});

test("Save as my answer stores an own answer exactly as today, settled and not a loose end", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Deferral nudge - save as answer",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "canned-interview");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  const shapeCard = cards.first();

  await shapeCard.getByRole("button", { name: "Write my own" }).click();
  await shapeCard
    .getByPlaceholder("What you have decided, in your own words")
    .fill("Wait until dispute handling is settled");
  await expect(shapeCard.getByTestId("deferral-hint")).toBeVisible();

  await shapeCard.getByTestId("save-as-answer").click();
  await expect(shapeCard).toContainText("Own answer");
  await expect(shapeCard).toContainText(
    "Wait until dispute handling is settled",
  );

  await cards
    .last()
    .getByRole("button", { name: "Write my own" }).click();
  await cards
    .last()
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk.");
  await cards.last().getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Submit round" }).click();

  await expect(async () => {
    const ends = await looseEnds(request, sessionId);
    const shape = ends.find(
      (end) => end.questionTitle === "What shape should this take?",
    );
    expect(shape).toBeUndefined();
  }).toPass();
});
