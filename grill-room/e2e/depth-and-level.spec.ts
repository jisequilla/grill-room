import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { answerOwnText, chooseScenario, createSession } from "./support";

test.describe.configure({ mode: "serial" });

const SETUP_HEADING = "Set up the grill";

interface SessionRow {
  depth: string;
  technicalLevel: string | null;
  turnStatus: string;
  readinessJson: unknown;
}

async function setLevel(
  request: APIRequestContext,
  technicalLevel: string,
): Promise<void> {
  const response = await request.post(
    "/_agent-native/actions/set-owner-technical-level",
    { data: { technicalLevel } },
  );
  expect(response.ok()).toBeTruthy();
}

async function readSession(
  request: APIRequestContext,
  id: string,
): Promise<SessionRow> {
  const response = await request.get(
    `/_agent-native/actions/get-session?id=${encodeURIComponent(id)}`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function readProfileLevel(
  request: APIRequestContext,
): Promise<string | null> {
  const response = await request.get("/_agent-native/actions/get-owner-profile");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).technicalLevel;
}

async function countSessions(request: APIRequestContext): Promise<number> {
  const response = await request.get("/_agent-native/actions/list-sessions");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).length;
}

/** Opens the dialog and fills screen 1, ready for Next. */
async function openAndFill(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Idea").fill("A small tool to try the setup step.");
}

async function next(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: SETUP_HEADING })).toBeVisible();
}

async function sessionIdFromUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/sessions\/[^/]+$/);
  const match = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!match) throw new Error(`Could not read a session id off ${page.url()}`);
  return match[1]!;
}

const on = (page: Page, testId: string) =>
  expect(page.getByTestId(testId)).toHaveAttribute("data-state", "on");

test("creates a session through the setup step", async ({ page, request }) => {
  await setLevel(request, "technical-not-building");
  await openAndFill(page, "Setup full spec");
  await next(page);
  await on(page, "setup-level-technical-not-building");

  await page.getByTestId("setup-depth-full-spec").click();
  await page.getByTestId("setup-level-builder").click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await next(page);
  await on(page, "setup-depth-full-spec");
  await on(page, "setup-level-builder");

  await page.getByTestId("setup-level-builder").click();
  await page.getByTestId("setup-depth-full-spec").click();
  await on(page, "setup-depth-full-spec");
  await on(page, "setup-level-builder");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: SETUP_HEADING })).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  const id = await sessionIdFromUrl(page);

  const expected = {
    depth: "full-spec",
    technicalLevel: "builder",
    turnStatus: "idle",
    readinessJson: null,
  };
  const pick = (row: SessionRow) => ({
    depth: row.depth,
    technicalLevel: row.technicalLevel,
    turnStatus: row.turnStatus,
    readinessJson: row.readinessJson,
  });
  expect(pick(await readSession(request, id))).toEqual(expected);
  // No turn starts on create: nothing changes while we wait.
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const row = pick(await readSession(request, id));
        if (JSON.stringify(row) !== JSON.stringify(expected)) return row;
        return Date.now() - started >= 3000 ? "unchanged" : "waiting";
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe("unchanged");
  expect(pick(await readSession(request, id))).toEqual(expected);
});

test("create with nothing touched sends the defaults", async ({
  page,
  request,
}) => {
  await setLevel(request, "builder");
  await openAndFill(page, "Setup untouched");
  await next(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const id = await sessionIdFromUrl(page);

  const row = await readSession(request, id);
  expect(row.depth).toBe("first-working-version");
  expect(row.technicalLevel).toBe("builder");
});

test("skip keeps the defaults and the profile", async ({ page, request }) => {
  await setLevel(request, "builder");
  await openAndFill(page, "Setup skipped");
  await next(page);
  await page.getByTestId("setup-depth-proof-of-concept").click();
  await page.getByTestId("setup-level-not-technical").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const id = await sessionIdFromUrl(page);

  const row = await readSession(request, id);
  expect(row.depth).toBe("first-working-version");
  expect(row.technicalLevel).toBe("builder");
});

test("cancel leaves the profile and reopening resets", async ({
  page,
  request,
}) => {
  await setLevel(request, "builder");
  await openAndFill(page, "Setup cancelled");
  await next(page);
  await page.getByTestId("setup-depth-full-spec").click();
  await page.getByTestId("setup-level-not-technical").click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: SETUP_HEADING })).toBeHidden();
  expect(await readProfileLevel(request)).toBe("builder");

  await page.getByTestId("header-new-session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await next(page);
  await on(page, "setup-depth-first-working-version");
  await on(page, "setup-level-builder");
});

test("a failed level save still opens the session", async ({
  page,
  request,
}) => {
  await setLevel(request, "builder");
  await page.route(
    "**/_agent-native/actions/set-owner-technical-level*",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.abort();
    },
  );
  await openAndFill(page, "Setup level fails");
  const before = page.url();
  await next(page);
  await page.getByTestId("setup-level-not-technical").click();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: SETUP_HEADING })).toBeVisible();
  expect(page.url()).toBe(before);

  await sessionIdFromUrl(page);
  await expect(
    page.getByText("Could not save your technical level."),
  ).toBeVisible();
});

test("a failed profile load still allows Create", async ({ page }) => {
  await page.route("**/_agent-native/actions/get-owner-profile*", (route) =>
    route.request().method() === "GET" ? route.abort() : route.continue(),
  );
  await openAndFill(page, "Setup profile fails");
  await next(page);
  for (const level of ["builder", "technical-not-building", "not-technical"]) {
    await expect(page.getByTestId(`setup-level-${level}`)).toHaveAttribute(
      "data-state",
      "off",
    );
  }
  await page.getByTestId("setup-level-builder").click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await sessionIdFromUrl(page);
});

test("a double click on Create makes one session", async ({
  page,
  request,
}) => {
  await setLevel(request, "builder");
  const before = await countSessions(request);
  await openAndFill(page, "Setup double click");
  await next(page);
  await page.getByRole("button", { name: "Create", exact: true }).dblclick();
  await sessionIdFromUrl(page);
  // Give a second create time to land, if one was sent.
  await page.waitForTimeout(1000);
  expect(await countSessions(request)).toBe(before + 1);
});

test("changes depth and level from the header", async ({ page, request }) => {
  await setLevel(request, "builder");
  const id = await createSession(page, {
    title: "Header controls",
    idea: "A workspace app that grills a loose idea into a spec.",
  });
  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByTestId("round-card").first()).toBeVisible();
  await expect(page.getByTestId("depth-control")).toBeEnabled();

  await page.getByTestId("depth-control").click();
  await page.getByRole("option", { name: "Proof of concept" }).click();
  await expect(page.getByTestId("depth-control")).toContainText(
    "Proof of concept",
  );
  await page.getByTestId("level-control").click();
  await page.getByRole("option", { name: "Not technical" }).click();
  await expect(page.getByTestId("level-control")).toContainText(
    "Not technical",
  );

  const row = await readSession(request, id);
  expect(row.depth).toBe("proof-of-concept");
  expect(row.technicalLevel).toBe("not-technical");
  await expect(page.getByTestId("depth-control-note")).toHaveText(
    "Applies from the next round.",
  );
});

const HOLD = "How long is a payout held before release?";
const SERVICE = "Which service launches first?";

/** As `deferral.spec.ts`'s helper: one answered round, then a done proposal. */
async function answerRoundToDeferral(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const sessionId = await createSession(page, {
    title: "Deferral depth",
    idea: "A marketplace for local services, with payouts held for disputes.",
  });
  await chooseScenario(request, sessionId, "deferral");

  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(HOLD);
  await expect(cards.last()).toContainText(SERVICE);

  await answerOwnText(
    cards.first(),
    "Wait until dispute handling is settled",
    "save-past-nudge",
  );
  await answerOwnText(cards.last(), "Dog walking.", "save");
  await expect(page.getByTestId("round-progress")).toHaveText(
    "2 of 2 answered",
  );
  await page.getByRole("button", { name: "Submit round" }).click();

  await expect(page.getByTestId("done-proposed-panel")).toBeVisible();
  return sessionId;
}

test("warns before a depth change reopens a proposed grill", async ({
  page,
  request,
}) => {
  await answerRoundToDeferral(page, request);
  await expect(page.getByTestId("depth-warning-reopens")).toHaveText(
    "Changing depth reopens the grill.",
  );
});
