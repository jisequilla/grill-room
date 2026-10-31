import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { chooseScenario, createSession } from "./support";

const MISSING = "A single buildable thing, not a method for deciding one";

/** The session's stored override, parsed, read through `get-session`. */
async function storedOverride(
  request: APIRequestContext,
  sessionId: string,
): Promise<{ missing: string[] } | null> {
  const response = await request.get(
    `/_agent-native/actions/get-session?id=${encodeURIComponent(sessionId)}`,
  );
  expect(response.ok()).toBe(true);
  const session = (await response.json()) as { readinessOverrideJson: string | null };
  return session.readinessOverrideJson === null
    ? null
    : (JSON.parse(session.readinessOverrideJson) as { missing: string[] });
}

/** A fresh session on `readiness-not-ready-grill`, judged not ready. */
async function aNotReadySession(
  page: Page,
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const sessionId = await createSession(page, {
    title,
    idea: "Decide how to evaluate eight repos.",
  });
  await chooseScenario(request, sessionId, "readiness-not-ready-grill");

  const panel = page.getByTestId("readiness-panel");
  await panel.getByTestId("readiness-assess").click();
  await expect(panel.getByTestId("readiness-verdict")).toHaveAttribute(
    "data-verdict",
    "not-ready",
  );
  return sessionId;
}

/**
 * `readiness-not-ready-grill` (`server/interviewer/fake.ts`) scripts one
 * not-ready judgment and then the canned interview, so each test drives its
 * own session, as `readiness.spec.ts` drives two.
 */
test("a not-ready idea can be edited or grilled as is", async ({ page, request }) => {
  const sessionId = await aNotReadySession(page, request, "Repo comparison");

  const ways = page.getByTestId("readiness-ways");
  await expect(ways).toBeVisible();
  await expect(ways).toContainText(
    "This idea is not ready yet. Edit it and assess it again, or grill it as is: the spec and the handoff will say it was not ready.",
  );

  await ways.getByRole("button", { name: "Edit the idea" }).click();
  await expect(page.getByTestId("idea-textarea")).toBeVisible();
  await expect(page.getByTestId("idea-textarea")).toBeFocused();
  await page.getByTestId("idea-cancel").click();
  await expect(page.getByTestId("idea-textarea")).toHaveCount(0);
  expect(await storedOverride(request, sessionId)).toBeNull();

  await ways.getByRole("button", { name: "Grill it as is" }).click();
  await expect(page.getByTestId("round-card").first()).toBeVisible();

  expect(await storedOverride(request, sessionId)).toMatchObject({ missing: [MISSING] });
  await expect(page.getByTestId("readiness-ways")).toHaveCount(0);
});

test("Start the interview past a not-ready verdict records it too", async ({
  page,
  request,
}) => {
  const sessionId = await aNotReadySession(page, request, "Repo comparison, started");

  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByTestId("round-card").first()).toBeVisible();

  expect(await storedOverride(request, sessionId)).toMatchObject({ missing: [MISSING] });
});
