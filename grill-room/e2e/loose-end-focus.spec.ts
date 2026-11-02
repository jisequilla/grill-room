import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

/**
 * A loose end whose reason changes group (`never-answered`, the
 * interviewer's, to `unknown`, the user's) moves to the other `<ul>` of the
 * loose-end list, so React remounts its row. A keyboard user keeps focus on
 * that decision's button through the move, and the list never takes focus
 * from anything else.
 *
 * Each test holds the `list-loose-ends` refetch that follows "Submit round"
 * on a gate, so the stale list (the decision still `never-answered`) stays
 * on screen until the test releases it at the step it names.
 */

const TITLE = "Where does the data live?";

type Gate = { release: () => void };

async function holdLooseEndsAfterSubmit(page: Page): Promise<Gate> {
  let submitted = false;
  let released = false;
  const held: Array<() => Promise<void>> = [];

  page.on("request", (request) => {
    if (request.url().includes("/_agent-native/actions/submit-round")) {
      submitted = true;
    }
  });

  await page.route("**/_agent-native/actions/list-loose-ends**", (route) => {
    if (!submitted || released) return route.continue();
    held.push(() => route.continue());
  });

  return {
    release() {
      released = true;
      for (const resume of held.splice(0)) {
        // A held request the page has since cancelled cannot be continued.
        resume().catch(() => {});
      }
    },
  };
}

async function reachLooseEnd(
  page: Page,
  request: APIRequestContext,
): Promise<{ row: Locator; button: Locator; gate: Gate }> {
  const sessionId = await createSession(page, {
    title: "Loose-end focus",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "supersession");
  const gate = await holdLooseEndsAfterSubmit(page);
  await page.getByRole("button", { name: "Start the interview" }).click();
  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await answerOwnText(cards.first(), "A workspace, on disk.", "save");
  await cards
    .last()
    .getByRole("button", { name: "I don't know", exact: true })
    .click();
  await page.getByRole("button", { name: "Submit round" }).click();
  await expect(page.getByTestId("done-proposed-panel")).toBeVisible();

  const row = page.getByTestId("loose-end").filter({ hasText: TITLE });
  await expect(row).toHaveAttribute("data-reason", "never-answered");
  const button = row.getByRole("button", { name: TITLE, exact: true });
  return { row, button, gate };
}

/** Releases the held list, waits for the row to change group, lets effects run. */
async function moveRow(page: Page, row: Locator, gate: Gate) {
  gate.release();
  await expect(row).toHaveAttribute("data-reason", "unknown");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

function bodyHasFocus(page: Page) {
  return page.evaluate(() => document.activeElement === document.body);
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return "nothing";
    const testId = active.getAttribute("data-testid");
    return `<${active.tagName.toLowerCase()}>${testId ? ` data-testid=${testId}` : ""}`;
  });
  console.log(`[${testInfo.title}] focus at failure: ${focused}`);
});

test("a focused loose end keeps focus when its row changes group", async ({
  page,
  request,
}) => {
  const { row, button, gate } = await reachLooseEnd(page, request);

  await button.focus();
  await expect(button).toBeFocused();
  await moveRow(page, row, gate);

  await expect(button).toBeFocused();
});

test("closing a loose end's detail keeps focus when its row changes group afterwards", async ({
  page,
  request,
}) => {
  const { row, button, gate } = await reachLooseEnd(page, request);
  const detail = page.getByRole("dialog", { name: TITLE });

  await button.click();
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(button).toBeFocused();

  await moveRow(page, row, gate);

  await expect(button).toBeFocused();
});

test("a row that changes group while its detail is open gets focus back on close", async ({
  page,
  request,
}) => {
  const { row, button, gate } = await reachLooseEnd(page, request);
  const detail = page.getByRole("dialog", { name: TITLE });

  await button.click();
  await expect(detail).toBeVisible();
  await moveRow(page, row, gate);
  await expect(detail).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(button).toBeFocused();
});

test("a row change does not take focus from another control", async ({
  page,
  request,
}) => {
  const { row, gate } = await reachLooseEnd(page, request);
  const check = page.getByTestId("check-superseded");

  await check.focus();
  await expect(check).toBeFocused();
  await moveRow(page, row, gate);

  await expect(check).toBeFocused();
});

test("a row change does not take focus from the page", async ({
  page,
  request,
}) => {
  const { row, gate } = await reachLooseEnd(page, request);

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  expect(await bodyHasFocus(page)).toBe(true);
  await moveRow(page, row, gate);

  expect(await bodyHasFocus(page)).toBe(true);
});

test("a row change does not refocus a button focus has left", async ({
  page,
  request,
}) => {
  const { row, button, gate } = await reachLooseEnd(page, request);
  const check = page.getByTestId("check-superseded");

  await button.focus();
  await expect(button).toBeFocused();
  await check.focus();
  await expect(check).toBeFocused();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  expect(await bodyHasFocus(page)).toBe(true);
  await moveRow(page, row, gate);

  expect(await bodyHasFocus(page)).toBe(true);
  await expect(button).not.toBeFocused();
});
