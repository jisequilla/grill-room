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
 * A throwaway git repository citing the same three files as
 * `e2e/project-scout.spec.ts`'s fixture: `scout-project-readiness`
 * (`server/interviewer/fake.ts`) is the only fake scenario that both scouts
 * a project and opens a first round in the same session, which is exactly
 * what this file needs to see the Brief strip fold and unfold around a real
 * round.
 */
function createFixtureRepo(): string {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-brief-")),
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

/** Runs readiness (which scouts first, since the session has a project) and
 * waits for the verdict, exactly as `e2e/project-scout.spec.ts` does. */
async function assessReadiness(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("readiness-panel").getByTestId("readiness-assess").click();
  await expect(
    page.getByTestId("readiness-panel").getByTestId("readiness-verdict"),
  ).toHaveAttribute("data-verdict", "ready");
}

test.describe("brief strip", () => {
  // A fresh repo per test (`beforeEach`/`afterEach`, not `beforeAll`):
  // `register-project` refuses a second registration of the same root
  // (`project-exists`), and this file's two tests each register one.
  let repoRoot: string;

  test.beforeEach(() => {
    repoRoot = createFixtureRepo();
  });

  test.afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("puts the current question first: expanded before round 1, collapses live once it opens, and expands back to the scout panel", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

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
    // test attached after the session was created (as `project-scout.spec.ts`
    // does).
    await page.reload();

    const strip = page.getByTestId("brief-strip");
    const toggle = page.getByTestId("brief-toggle");

    // ---- Before round 1: expanded, so keep/drop and readiness work as
    // today (acceptance line 5's e2e specs never touch a round, so this is
    // the same state they exercise). ----------------------------------------
    await expect(strip).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("scout-panel")).toBeVisible();
    await expect(page.getByTestId("readiness-panel")).toBeVisible();

    await assessReadiness(page);

    // ---- Open round 1, in the same page: the strip collapses live --------
    await page
      .getByRole("button", { name: /^(Start the interview|Ask for the next round)$/ })
      .click();

    const cards = page.getByTestId("round-card");
    await expect(cards).toHaveCount(1);

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("scout-panel")).toHaveCount(0);

    // The current question — the first round card — starts inside the first
    // viewport at 1440x900: the Brief strip never buries it (DESIGN.md's
    // anti-reference, "Burying the current ask").
    const box = await cards.first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(900);

    // ---- Expand it back: the scout panel is reachable again ---------------
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("scout-panel")).toBeVisible();
  });

  test("reloading a session that already has a round never shows the strip expanded", async ({
    page,
    request,
  }) => {
    const project = await registerProject(request, {
      root: repoRoot,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });

    const sessionId = await createSession(page, {
      title: "Ingest Alerting Reload",
      idea: "Alert when ingest lag crosses a threshold.",
    });
    await setSessionProject(request, sessionId, project.id);
    await chooseScenario(request, sessionId, "scout-project-readiness");
    await page.reload();

    await assessReadiness(page);
    await page
      .getByRole("button", { name: /^(Start the interview|Ask for the next round)$/ })
      .click();
    await expect(page.getByTestId("round-card")).toHaveCount(1);

    // The strip is already collapsed (the previous step's live transition),
    // so this reload is the real test: does the state come back correctly
    // from scratch, or does it default open for one frame first?
    await page.reload();

    await expect(page.getByTestId("brief-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("scout-panel")).toHaveCount(0);
  });
});
