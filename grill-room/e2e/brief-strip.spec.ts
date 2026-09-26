import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Page } from "@playwright/test";
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
async function assessReadiness(page: Page): Promise<void> {
  await page.getByTestId("readiness-panel").getByTestId("readiness-assess").click();
  await expect(
    page.getByTestId("readiness-panel").getByTestId("readiness-verdict"),
  ).toHaveAttribute("data-verdict", "ready");
}

/**
 * Marks `window.__briefStripFlashed` the moment the page ever shows the
 * strip expanded or the scout panel visible — through a `MutationObserver`
 * installed by `page.addInitScript`, so it runs before any of the page's own
 * scripts on every subsequent navigation (including the `page.reload()`
 * this test cares about), and catches a flash that resolves within a single
 * frame, which a `toHaveAttribute` assertion's retry loop cannot: that loop
 * only ever samples the DOM, so a strip that opens and closes between two
 * samples is invisible to it, however tightly `useState`'s initial value is
 * set — reverting `brief-strip.tsx`'s initial `open` state to
 * `useState(true)` confirms it (see the PR body).
 *
 * Observes `document` itself, not `document.documentElement`: an init
 * script runs at the very start of a fresh document, before the HTML parser
 * has necessarily produced a `documentElement` to attach to or an attribute
 * on it to read back — `document` always exists. The flag lives on
 * `window` for the same reason, not as a DOM attribute.
 */
async function installFlashDetector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __briefStripFlashed: boolean }).__briefStripFlashed =
      false;
    const looksFlashed = () => {
      if (document.querySelector('[data-testid="scout-panel"]')) return true;
      const toggle = document.querySelector('[data-testid="brief-toggle"]');
      return toggle?.getAttribute("aria-expanded") === "true";
    };
    const mark = () => {
      if (looksFlashed()) {
        (
          window as unknown as { __briefStripFlashed: boolean }
        ).__briefStripFlashed = true;
      }
    };
    new MutationObserver(mark).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    mark();
  });
}

async function readFlashed(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { __briefStripFlashed?: boolean })
        .__briefStripFlashed ?? false,
  );
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
    // from scratch, or does it flash open for a frame first? A plain
    // `toHaveAttribute` assertion only samples the DOM on its retry
    // schedule, so it cannot see a flash that resolves between samples —
    // the `MutationObserver` installed below catches every DOM mutation as
    // it happens, not just what a later sample finds.
    await installFlashDetector(page);
    await page.reload();

    await expect(page.getByTestId("brief-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("scout-panel")).toHaveCount(0);
    expect(await readFlashed(page)).toBe(false);
  });
});

test.describe("brief strip: no project, a stored readiness judgment", () => {
  /**
   * `readiness-ready` (`server/interviewer/fake.ts`) schedules exactly one
   * `assess-readiness` request and nothing after it — there is no fake
   * scenario that both judges readiness and opens a round for a
   * project-less session, so this switches scenarios mid-session:
   * `use-fake-scenario` replaces the session's queue outright (see
   * `chooseScenario`'s own doc comment), so choosing `canned-interview`
   * (`DEFAULT_SCENARIO`) after readiness has already run supplies the
   * `propose-round` turns needed to open round 1.
   */
  test("keeps the judgment reachable in the strip's body after round 1, read-only", async ({
    page,
    request,
  }) => {
    const sessionId = await createSession(page, {
      title: "Repo-less Readiness",
      idea: "A 16-week marathon training tracker for one runner.",
    });
    await chooseScenario(request, sessionId, "readiness-ready");

    await assessReadiness(page);

    const toggle = page.getByTestId("brief-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Switch scenarios, then open round 1: the strip collapses live, and its
    // summary is the readiness verdict alone (no project, no "Scout:" half).
    await chooseScenario(request, sessionId, "canned-interview");
    await page
      .getByRole("button", { name: /^(Start the interview|Ask for the next round)$/ })
      .click();
    await expect(page.getByTestId("round-card")).toHaveCount(2);

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Bug this test guards: with the readiness panel gated on
    // `showReadiness` alone, the strip would still render here (a judgment
    // exists) but its body would be empty — nothing to expand into.
    await expect(page.getByTestId("scout-panel")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const readinessPanel = page.getByTestId("readiness-panel");
    await expect(readinessPanel).toBeVisible();
    await expect(readinessPanel.getByTestId("readiness-verdict")).toHaveAttribute(
      "data-verdict",
      "ready",
    );
    // Read-only from here on: `assess-readiness` refuses with `has-rounds`
    // once any round exists, so neither control is offered any more.
    await expect(readinessPanel.getByTestId("readiness-assess")).toHaveCount(0);
    await expect(readinessPanel.getByTestId("readiness-reassess")).toHaveCount(0);
  });
});
