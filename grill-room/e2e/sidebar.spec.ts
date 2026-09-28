import { expect, test } from "@playwright/test";

/**
 * The sidebar (DESIGN.md, "Mark: the Grate", "Name treatment", "Information
 * architecture"). The suite shares one server and database, so the session is
 * named uniquely and no assertion counts rows.
 */

const PHONE = { width: 390, height: 844 };

test("the sidebar carries the mark, New session, Projects, Recent and footer links", async ({
  page,
}) => {
  const title = `Sidebar e2e ${Date.now()}`;

  await page.goto("/");
  const aside = page.locator("aside");

  // ---- The mark and the wordmark ------------------------------------------
  await expect(aside.getByText("grill room", { exact: true })).toBeVisible();
  await expect(aside.getByTestId("grate-mark")).toBeVisible();
  await expect(aside.getByText("Grill Room", { exact: true })).toHaveCount(0);

  // ---- Projects is a link; its route belongs to another ticket ------------
  await expect(aside.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "href",
    "/projects",
  );

  // ---- New session opens from the sidebar ---------------------------------
  await aside.getByTestId("sidebar-new-session").click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("Idea")
    .fill("A workspace app that grills a loose idea into a spec.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/sessions\/[^/]+$/);

  // ---- Recent: the new session, with no loose ends yet --------------------
  const row = aside.getByTestId("recent-session").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("owed");

  // The sidebar's session query is not polled, so the count shows after a reload.
  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByTestId("round-card").first()).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator("aside")
      .getByTestId("recent-session")
      .filter({ hasText: title }),
  ).toContainText(/owed [1-9]\d*/);

  // ---- Footer links ---------------------------------------------------------
  await page.locator("aside").getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/settings$/);
  await page.locator("aside").getByRole("link", { name: "Database" }).click();
  await page.waitForURL(/\/database$/);

  // ---- Collapsed: Recent goes, the links stay ---------------------------------
  await page.goto("/");
  const expanded = page.locator("aside");
  await expect(expanded.getByText("Recent", { exact: true })).toBeVisible();
  await expanded.getByRole("button", { name: "Collapse Sidebar" }).click();
  await expect(expanded.getByText("Recent", { exact: true })).toHaveCount(0);
  await expect(expanded.getByTestId("recent-session")).toHaveCount(0);
  for (const name of ["Projects", "Settings", "Database"]) {
    await expect(expanded.getByRole("link", { name })).toBeVisible();
  }
  await expect(expanded.getByRole("button", { name: "New session" })).toBeVisible();
});

test.describe("at 390 px", () => {
  test.use({ viewport: PHONE });

  test("New session in the sheet closes it, opens the dialog and leaves the page clickable", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();

    const sheet = page.getByRole("dialog", { name: "Navigation" });
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("sidebar-new-session").click();

    await expect(sheet).toBeHidden();
    const heading = page.getByRole("heading", { name: "New session" });
    await expect(heading).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(heading).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).pointerEvents),
      )
      .not.toBe("none");
  });
});
