import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * The owner flags a settled decision ADR-worthy from its sheet, sees the
 * marker in the tree, and finds an unsettled decision read-only.
 */
test("the owner flags and unflags a settled decision as ADR-worthy", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "ADR flag",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "reopen-stale-review");

  await page.getByRole("button", { name: "Start the interview" }).click();
  let cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await answerOwnText(cards.first(), "A workspace.", "save");
  await page.getByRole("button", { name: "Submit round" }).click();
  await expect(page.getByTestId("round-card")).toHaveCount(2);

  const treeRows = page.getByTestId("tree-row");
  const rootRow = treeRows.filter({ hasText: "What shape should this take?" });
  await expect(rootRow).toHaveAttribute("data-state", "settled");
  await expect(rootRow.getByTestId("adr-marker")).toHaveCount(0);

  // ---- Flag it: Consequences are required first -----------------------------
  await rootRow.click();
  const sheet = page.getByRole("dialog");
  const toggle = sheet.getByTestId("adr-worthy-toggle");
  const consequences = sheet.getByTestId("adr-consequences");
  const save = sheet.getByTestId("adr-save");

  await toggle.check();
  await expect(save).toBeDisabled();
  await expect(sheet.getByTestId("adr-consequences-required")).toBeVisible();

  await consequences.fill("Every later decision builds on this shape.");
  await expect(sheet.getByTestId("adr-consequences-required")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();

  await expect(rootRow.getByTestId("adr-marker")).toBeVisible();
  await expect(save).toBeDisabled();

  await page.reload();
  await treeRows.filter({ hasText: "What shape should this take?" }).click();
  await expect(page.getByRole("dialog").getByTestId("adr-worthy-toggle")).toBeChecked();
  await expect(page.getByRole("dialog").getByTestId("adr-consequences")).toHaveValue(
    "Every later decision builds on this shape.",
  );
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // ---- An open decision cannot change ---------------------------------------
  cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  const openRow = treeRows.filter({ hasText: "Where does the data live?" });
  await openRow.click();
  const openSheet = page.getByRole("dialog");
  await expect(openSheet.getByTestId("adr-readonly")).toBeVisible();
  await expect(openSheet.getByTestId("adr-locked-reason")).toBeVisible();
  await expect(openSheet.getByTestId("adr-worthy-toggle")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // ---- Unflag with edited Consequences ---------------------------------------
  await treeRows.filter({ hasText: "What shape should this take?" }).click();
  const again = page.getByRole("dialog");
  await again.getByTestId("adr-worthy-toggle").uncheck();
  await again.getByTestId("adr-consequences").fill("Edited note.");
  await again.getByTestId("adr-save").click();
  await expect(
    treeRows
      .filter({ hasText: "What shape should this take?" })
      .getByTestId("adr-marker"),
  ).toHaveCount(0);

  await page.reload();
  await treeRows.filter({ hasText: "What shape should this take?" }).click();
  const reloaded = page.getByRole("dialog");
  await expect(reloaded.getByTestId("adr-worthy-toggle")).not.toBeChecked();
  await expect(reloaded.getByTestId("adr-consequences")).toHaveValue(
    "Edited note.",
  );
});
