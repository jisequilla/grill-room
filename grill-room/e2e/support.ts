import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Creates a session through the real UI — the same "New session" dialog
 * `smoke.spec.ts` drives — and returns its id, read off the workspace URL
 * once the session lands there. Every flow test starts here: a fresh
 * session with its own fake-interviewer queue (see {@link chooseScenario}),
 * untouched by any other test or session.
 */
export async function createSession(
  page: Page,
  { title, idea }: { title: string; idea: string },
): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "New session" }).click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Idea").fill(idea);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/sessions\/[^/]+$/);
  const match = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!match) {
    throw new Error(`Could not read a session id off ${page.url()}`);
  }
  return match[1]!;
}

/**
 * Chooses the fake interviewer's scripted scenario for one session, over
 * HTTP the same way an orchestrating agent calls any action — a POST to the
 * action's endpoint with a JSON body (`grill-room/AGENTS.md`, "Logging a
 * build from an agent", shows the same pattern for `set-build-record`).
 * `use-fake-scenario` (`actions/use-fake-scenario.ts`) only works while
 * `GRILL_ROOM_INTERVIEWER=fake` is selected, which `playwright.config.ts`'s
 * `webServer` env asserts for this whole suite.
 *
 * Call this once, right after {@link createSession} returns and before
 * anything that asks the interviewer for a turn (starting the interview,
 * assessing readiness, …): the fake builds the session's queue from the
 * named scenario on its first request.
 */
export async function chooseScenario(
  request: APIRequestContext,
  sessionId: string,
  scenario: string,
): Promise<void> {
  const response = await request.post(
    "/_agent-native/actions/use-fake-scenario",
    { data: { sessionId, scenario } },
  );
  if (!response.ok()) {
    throw new Error(
      `use-fake-scenario(sessionId=${sessionId}, scenario=${scenario}) failed: ${response.status()} ${await response.text()}`,
    );
  }
}

/**
 * Answers one round card by writing an own-text answer: opens "Write my
 * own", fills the textarea, saves. Every scripted card in these scenarios
 * has no choices and no recommendation (`aProposedDecision`'s defaults in
 * `server/interviewer/fake.ts`), so this is the one way to answer them
 * through the UI.
 */
export async function answerOwnText(card: Locator, text: string): Promise<void> {
  await card.getByRole("button", { name: "Write my own" }).click();
  await card
    .getByPlaceholder("What you have decided, in your own words")
    .fill(text);
  await card.getByRole("button", { name: "Save", exact: true }).click();
}

/**
 * Registers a repository as a project, over HTTP the same way
 * {@link chooseScenario} calls `use-fake-scenario` — a POST to the action's
 * endpoint (`actions/register-project.ts`). Returns the created project (at
 * least its `id`), which {@link setSessionProject} then attaches to a
 * session.
 */
export async function registerProject(
  request: APIRequestContext,
  input: {
    root: string;
    verifyCommand: string;
    workingExportFolder?: string;
    name?: string;
  },
): Promise<{ id: string }> {
  const response = await request.post(
    "/_agent-native/actions/register-project",
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `register-project(root=${input.root}) failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

/**
 * Sets the registered project a session exports into
 * (`actions/set-session-project.ts`), over HTTP as {@link registerProject}
 * and {@link chooseScenario} do.
 */
export async function setSessionProject(
  request: APIRequestContext,
  sessionId: string,
  projectId: string,
): Promise<void> {
  const response = await request.post(
    "/_agent-native/actions/set-session-project",
    { data: { sessionId, projectId } },
  );
  if (!response.ok()) {
    throw new Error(
      `set-session-project(sessionId=${sessionId}, projectId=${projectId}) failed: ${response.status()} ${await response.text()}`,
    );
  }
}
