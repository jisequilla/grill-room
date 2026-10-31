import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  chooseScenario,
  createSession,
  registerProject,
  setSessionProject,
} from "./support";

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(repo: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=Grill Room E2E",
      "-c",
      "user.email=e2e@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, stdio: "ignore" },
  );
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

/**
 * A throwaway git repository, in the OS temp dir, holding the three files the
 * `scout-project` scenario (`server/interviewer/fake.ts`) cites at least as
 * many lines as it names: `src/ingest/metrics.ts:12-30`,
 * `docs/adr/0003-queue.md:5-9` and `CLAUDE.md:1`. The app checks the scout's
 * citations against a real working tree, so the fixture has to be one.
 */
function createFixtureRepo(): string {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-scout-")),
  );
  git(root, ["init", "-q"]);

  const files: Record<string, string> = {
    "src/ingest/metrics.ts": numberedLines(30),
    "docs/adr/0003-queue.md": numberedLines(9),
    "CLAUDE.md": "# Agent instructions\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

test.describe("project scout", () => {
  let repoRoot: string;

  test.beforeAll(() => {
    repoRoot = createFixtureRepo();
  });

  const extraRepos: string[] = [];

  test.afterAll(() => {
    for (const root of [repoRoot, ...extraRepos]) rmSync(root, { recursive: true, force: true });
  });

  /**
   * `scout-project-readiness` (`server/interviewer/fake.ts`) schedules the
   * same scout report as `scout-project` — one current-state item and two
   * proposed repo decisions, citing the fixture's three files — followed by
   * the readiness judge it grounds and a first round that asks about
   * something the scout never proposed. That is what lets this test keep one
   * repo decision, drop the other, and then confirm the first round never
   * re-asks the one it kept.
   */
  test("readiness runs the scout, a kept decision reaches the tree, and the first round never re-asks it", async ({
    page,
    request,
  }) => {
    const project = await registerProject(request, {
      root: repoRoot,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });

    const sessionId = await createSession(page, {
      title: "Ingest Alerting",
      idea: "Alert when ingest lag crosses a threshold.",
    });
    await setSessionProject(request, sessionId, project.id);
    await chooseScenario(request, sessionId, "scout-project-readiness");

    // Reload so the workspace's `hasProject` query picks up the project this
    // test attached after the session was created.
    await page.reload();

    // ---- Before readiness runs: the scout panel is there but empty --------
    const scoutPanel = page.getByTestId("scout-panel");
    await expect(scoutPanel).toBeVisible();
    await expect(scoutPanel.getByTestId("scout-facts")).toHaveCount(0);

    // ---- Run readiness: it scouts first (no report yet), then judges ------
    const readinessPanel = page.getByTestId("readiness-panel");
    await expect(readinessPanel).toBeVisible();
    await readinessPanel.getByTestId("readiness-assess").click();

    await expect(readinessPanel.getByTestId("readiness-verdict")).toHaveAttribute(
      "data-verdict",
      "ready",
    );

    // ---- The scout panel now shows facts, current state and both proposals
    await expect(scoutPanel.getByTestId("scout-facts")).toBeVisible();
    await expect(scoutPanel.getByTestId("scout-current-state")).toContainText(
      "Ingest lag is measured but never alerted on.",
    );

    const decisions = scoutPanel.getByTestId("scout-decision");
    await expect(decisions).toHaveCount(2);

    const keep = scoutPanel.locator(
      '[data-testid="scout-decision"][data-key="no-message-broker"]',
    );
    const drop = scoutPanel.locator(
      '[data-testid="scout-decision"][data-key="agent-instructions-exist"]',
    );
    await expect(keep).toContainText("No message broker");
    await expect(drop).toContainText("The repo already documents agent conventions");

    // ---- Keep one proposal, drop the other ---------------------------------
    await keep.getByTestId("scout-decision-keep").click();
    await expect(keep).toHaveAttribute("data-disposition", "kept");
    await expect(keep.getByTestId("scout-decision-kept-note")).toBeVisible();

    await drop.getByTestId("scout-decision-drop").click();
    await expect(drop).toHaveAttribute("data-disposition", "dropped");
    await expect(drop.getByTestId("scout-decision-dropped-note")).toBeVisible();

    // ---- The kept decision reaches the tree, with its repo marker ---------
    const treeRows = page.getByTestId("tree-row");
    const keptRow = treeRows.filter({ hasText: "No message broker" });
    await expect(keptRow).toHaveCount(1);

    const marker = keptRow.getByTestId("repo-marker");
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute("data-source", "recorded");
    await expect(marker).toHaveAttribute("data-citation", "docs/adr/0003-queue.md:5-9");

    // The dropped proposal never enters the tree.
    await expect(
      treeRows.filter({ hasText: "The repo already documents agent conventions" }),
    ).toHaveCount(0);

    // ---- Start the interview: the first round never re-asks the kept one --
    await expect(readinessPanel.getByTestId("readiness-reassess")).toBeVisible();
    await page.getByRole("button", { name: "Start the interview", exact: true }).click();

    const cards = page.getByTestId("round-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("What should trigger the alert?");
    await expect(cards.first()).not.toContainText("No message broker");
    await expect(cards.first()).not.toContainText(
      "The repo already documents agent conventions",
    );
  });

  test("keeping a repo decision before readiness leaves the invitation and the start control", async ({
    page,
    request,
  }) => {
    const ownRepo = createFixtureRepo();
    extraRepos.push(ownRepo);
    const project = await registerProject(request, {
      root: ownRepo,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const sessionId = await createSession(page, {
      title: "Ingest Alerting",
      idea: "Alert when ingest lag crosses a threshold.",
    });
    await setSessionProject(request, sessionId, project.id);
    await chooseScenario(request, sessionId, "scout-project");
    await page.reload();

    const scoutPanel = page.getByTestId("scout-panel");
    await scoutPanel.getByTestId("scout-run").click();
    const keep = scoutPanel.locator(
      '[data-testid="scout-decision"][data-key="no-message-broker"]',
    );
    await keep.getByTestId("scout-decision-keep").click();
    await expect(keep).toHaveAttribute("data-disposition", "kept");
    await expect(
      page.getByTestId("tree-row").filter({ hasText: "No message broker" }),
    ).toHaveCount(1);

    await expect(
      page.getByTestId("readiness-panel").getByTestId("readiness-assess"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start the interview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ask for the next round", exact: true }),
    ).toHaveCount(0);
  });

  test("the start control waits for the rounds", async ({ page, request }) => {
    const sessionId = await createSession(page, {
      title: "Ingest Alerting",
      idea: "Alert when ingest lag crosses a threshold.",
    });
    await chooseScenario(request, sessionId, "scout-project");

    await page.route("**/_agent-native/actions/list-rounds*", () => {
      // Held unfulfilled: the rounds never load.
    });
    await Promise.all([
      page.waitForResponse("**/_agent-native/actions/get-current-round*"),
      page.reload(),
    ]);
    await expect(page.getByTestId("round-panel-loading")).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: "Start the interview", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Ask for the next round", exact: true }),
    ).toHaveCount(0);
  });
});
