import { expect, test, type Locator, type Page } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * The session header at a phone's width and at a laptop's (DESIGN.md,
 * Composition: "Shell", "Ledger", "Narrow width"). Below `lg` the title keeps
 * the row, every action lives in the `…` menu, and the design tree opens as a
 * sheet from a header button carrying the loose-end count. At `lg` and wider
 * two actions stay visible beside `…` and the tree keeps its column.
 */

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 720 };

const LONG_TITLE =
  "Decide how the experiment exports its settled decisions into every registered project";

/** The shell's header row: the one holding the session title. */
function shellHeader(page: Page): Locator {
  return page.getByTestId("session-title").locator("xpath=ancestor::header[1]");
}

/** Every visible control in the shell header, with its label and box. */
async function visibleHeaderControls(page: Page) {
  return shellHeader(page).evaluate((header) =>
    Array.from(
      header.querySelectorAll<HTMLElement>(
        "button, [role='radiogroup'], a, input, [data-testid='session-title']",
      ),
    )
      .filter((element) => element.checkVisibility())
      // A control inside another listed one (a toggle inside its group) is
      // counted once, as its container.
      .filter(
        (element, _index, all) =>
          !all.some((other) => other !== element && other.contains(element)),
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name:
            element.dataset.testid ??
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            "",
          right: rect.right,
        };
      }),
  );
}

/** Opens a menu dialog and checks the modal hand-off both ways. */
async function openFromMenuAndClose(
  page: Page,
  item: string,
  dialogName: string,
) {
  await page.getByTestId("header-overflow").click();
  await page.getByRole("menuitem", { name: item }).click();

  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The dialog has no trigger of its own: focus goes back to the button the
  // menu opened from, not to the body.
  await expect(page.getByTestId("header-overflow")).toBeFocused();

  // The page is interactive again: nothing left `pointer-events: none` on the
  // body, and a header button answers a real click.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
    .not.toBe("none");
  await page.getByTestId("header-overflow").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
}

test.describe("at 390×844", () => {
  test.use({ viewport: PHONE });

  test("the title truncates on one line and only the tree and … buttons sit beside it", async ({
    page,
  }) => {
    await createSession(page, {
      title: LONG_TITLE,
      idea: "A tool that turns a loose idea into settled decisions.",
    });

    const title = page.getByTestId("session-title");
    await expect(title).toHaveText(LONG_TITLE);
    await expect(title).toHaveAttribute("title", LONG_TITLE);

    const metrics = await title.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.height).toBeLessThan(metrics.lineHeight * 1.5);

    const controls = await visibleHeaderControls(page);
    expect(controls.map((control) => control.name)).toEqual([
      "Open navigation",
      "session-title",
      "tree-sheet-trigger",
      "header-overflow",
    ]);
    for (const control of controls) {
      expect(control.right, control.name).toBeLessThanOrEqual(PHONE.width);
    }

    await expect(page.getByTestId("tree-sheet-trigger")).toHaveText("Tree");
  });

  test("the … menu switches the answering mode and opens both dialogs", async ({
    page,
  }) => {
    await createSession(page, {
      title: "Narrow menu",
      idea: "A tool that turns a loose idea into settled decisions.",
    });

    const overflow = page.getByTestId("header-overflow");
    await expect(overflow).toHaveAttribute("aria-label", "More actions");

    await overflow.click();
    await expect(
      page.getByRole("menuitemradio", { name: "Whole round" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "One at a time" }).click();
    await expect(page.getByRole("menu")).toBeHidden();

    await overflow.click();
    await expect(
      page.getByRole("menuitemradio", { name: "One at a time" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.reload();
    await page.getByTestId("header-overflow").click();
    await expect(
      page.getByRole("menuitemradio", { name: "One at a time" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();

    await openFromMenuAndClose(
      page,
      "Apply a batch of changes…",
      "Apply a batch of changes",
    );
    await openFromMenuAndClose(
      page,
      "Add my own decision…",
      "Add my own decision",
    );
  });

  test("the tree sheet carries the loose-end count and opens a decision's detail", async ({
    page,
    request,
  }) => {
    const sessionId = await createSession(page, {
      title: "Narrow tree",
      idea: "A tool that turns a loose idea into settled decisions.",
    });
    await chooseScenario(request, sessionId, "supersession");

    // The tree has no column here.
    await expect(page.getByRole("heading", { name: "Design tree" })).toBeHidden();

    await page.getByRole("button", { name: "Start the interview" }).click();
    const cards = page.getByTestId("round-card");
    await expect(cards).toHaveCount(2);
    await answerOwnText(cards.first(), "A workspace, on disk.");
    await cards
      .last()
      .getByRole("button", { name: "I don't know", exact: true })
      .click();
    await page.getByRole("button", { name: "Submit round" }).click();
    await expect(page.getByTestId("done-proposed-panel")).toBeVisible();

    const trigger = page.getByTestId("tree-sheet-trigger");
    await expect(trigger).toHaveText("Tree · 1 owed");
    await trigger.click();

    const sheet = page.getByTestId("tree-sheet");
    await expect(sheet).toBeVisible();
    const rows = sheet.getByTestId("tree-row");
    await expect(rows).toHaveCount(2);
    await expect(sheet.getByTestId("tree-footer")).toContainText("1 loose end");

    // Closed without a selection, the sheet hands focus back to its button.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(sheet).toBeVisible();
    await rows.filter({ hasText: "Where does the data live?" }).click();
    await expect(sheet).toBeHidden();
    const detail = page.getByRole("dialog", {
      name: "Where does the data live?",
    });
    await expect(detail).toBeVisible();
    // The detail sheet the selection opened keeps the focus.
    await expect
      .poll(() =>
        detail.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
  });
});

test.describe("at 1280×720", () => {
  test.use({ viewport: LAPTOP });

  test("two actions stay visible, … holds the batch, and the tree keeps its column", async ({
    page,
  }) => {
    await createSession(page, {
      title: "Wide header",
      idea: "A tool that turns a loose idea into settled decisions.",
    });

    const header = shellHeader(page);
    await expect(
      header.getByRole("radiogroup", { name: "Answering mode" }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Add my own decision" }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Apply a batch of changes" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("tree-sheet-trigger")).toBeHidden();

    const controls = await visibleHeaderControls(page);
    expect(controls.map((control) => control.name)).toEqual([
      "session-title",
      "Answering mode",
      "Add my own decision",
      "header-overflow",
    ]);

    await page.getByTestId("header-overflow").click();
    await expect(
      page.getByRole("menuitem", { name: "Apply a batch of changes…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Add my own decision…" }),
    ).toBeHidden();
    // The mode radios are the visible switch's job at this width.
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: "Design tree" })).toBeVisible();

    // The visible "Add my own decision" still owns its dialog, so focus
    // returns to it.
    const addButton = header.getByRole("button", {
      name: "Add my own decision",
    });
    await addButton.click();
    const addDialog = page.getByRole("dialog", { name: "Add my own decision" });
    await expect(addDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addDialog).toBeHidden();
    await expect(addButton).toBeFocused();

    await openFromMenuAndClose(
      page,
      "Apply a batch of changes…",
      "Apply a batch of changes",
    );
  });
});
