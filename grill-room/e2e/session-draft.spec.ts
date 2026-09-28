import { expect, test, type Page } from "@playwright/test";

const IDEA = "An idea that must not be lost";

async function openDialog(page: Page) {
  await page.getByTestId("header-new-session").click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();
}

async function expectDraftRestored(page: Page, docsFolder: string) {
  await expect(page.getByLabel("Title")).toHaveValue("Draft e2e");
  await expect(page.getByLabel("Idea")).toHaveValue(IDEA);
  await expect(page.locator("#session-model")).toHaveText("Opus");
  await expect(page.getByRole("radio", { name: "One at a time" })).toBeChecked();
  await expect(page.getByLabel(/docs folder/i)).toHaveValue(docsFolder);
}

test("keeps the New session text through a stray click, Escape, Cancel, a refused create and a reload", async ({
  page,
}) => {
  const heading = page.getByRole("heading", { name: "New session" });

  await page.goto("/");
  await openDialog(page);
  await page.getByLabel("Title").fill("Draft e2e");
  await page.getByLabel("Idea").fill(IDEA);
  await page.locator("#session-model").click();
  await page.getByRole("option", { name: "Opus" }).click();
  await page.getByRole("radio", { name: "One at a time" }).click();
  await expect(heading).toBeVisible();

  // A closing dialog keeps its heading visible through the exit animation, so
  // the open state on the dialog itself is what proves nothing closed.
  const dialog = page.getByRole("dialog");

  await page.mouse.click(5, 5);
  await expect(dialog).toHaveAttribute("data-state", "open");
  await expect(heading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("data-state", "open");
  await expect(heading).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(heading).toBeHidden();

  await openDialog(page);
  await expectDraftRestored(page, "");

  await page.getByLabel(/docs folder/i).fill("relative/path");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("The docs folder must be an absolute path."),
  ).toBeVisible();
  await expect(heading).toBeVisible();

  await page.reload();
  await openDialog(page);
  await expectDraftRestored(page, "relative/path");

  await page.getByTestId("discard-session-draft").click();
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expect(page.getByLabel("Idea")).toHaveValue("");
  await expect(page.getByLabel(/docs folder/i)).toHaveValue("");
  await expect(
    page.getByText("The docs folder must be an absolute path."),
  ).toBeHidden();
  await expect(heading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(heading).toBeHidden();

  await openDialog(page);
  await page.getByLabel("Title").fill("Draft e2e");
  await page.getByLabel("Idea").fill(IDEA);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/sessions\/[^/]+$/);

  await page.goto("/");
  await openDialog(page);
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expect(page.getByLabel("Idea")).toHaveValue("");
});
