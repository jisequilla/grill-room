import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerProject, setSessionProject } from "./support";

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

/**
 * A throwaway git repository the export step registers as a project, so the
 * bundle it writes (including `decisions.md`) has somewhere real to land.
 * Nothing about its content matters — the export step only needs a project
 * whose root is a real git repository (`register-project` resolves the root
 * with a read-only `git rev-parse`), and its visibility report reads the
 * bundle's files against the repo with `git ls-files`/`git check-ignore`,
 * both of which work on a freshly committed empty tree.
 */
function createExportProjectRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-smoke-project-"));
  git(root, ["init", "-q"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "fixture"]);
  return root;
}

/**
 * The one browser smoke test the spec calls for (`.scratch/grill-room/spec.md`,
 * "Testing Decisions"): walk a full grilling session through the real UI,
 * against the running app with the fake interviewer enabled. Everything else
 * in this app is tested at the action boundary (see `actions/*.test.ts`); this
 * is the one place the browser itself is exercised.
 *
 * The fake interviewer keeps one scripted turn queue per session
 * (`server/interviewer/fake.ts`'s `createScenarioInterviewer`), built from a
 * named scenario chosen for the session, or — when none was chosen, as here,
 * since this test drives only the UI — from the default `canned-interview`
 * scenario, `cannedInterviewTurns()`. This test's session gets exactly the
 * five turns below, in order:
 *
 *   1. propose-round  -> refused for a tree-rule violation (a dependency on
 *                         a decision that does not exist), then retried and
 *                         accepted: "What shape should this take?" / "Where
 *                         does the data live?", no dependencies, both
 *                         recommended. This is round 1's turn, and its two
 *                         attempts are what the attempt log below reads back.
 *   2. propose-round  -> done, no more decisions.
 *   3. find-superseded -> none (the done proposal's second half).
 *   4. synthesize-spec -> a canned spec.
 *   5. break-into-tickets -> two tickets, the second blocked by the first.
 *
 * This test drives exactly one session, consuming those five turns in order.
 * After the fifth turn, it generates the handoff and exports the session —
 * both deterministic, template-rendered steps that call no interviewer turn
 * — and checks that the export wrote `decisions.md` with an entry for each
 * of the two decisions this session settled (`server/export.ts`'s
 * `renderDecisionsFile`; see `.scratch/decisions-export/spec.md`).
 *
 * Other spec files in this suite (`e2e/*.spec.ts`) run against the same
 * `webServer` alongside it: each creates its own session and chooses its own
 * scenario (`actions/use-fake-scenario.ts`), and a session's queue is its
 * own. This file stays one test regardless, since its canned interview is
 * written to be walked start to finish in a single session; the suite still
 * runs on one worker with no retries (see the config) — nothing yet has
 * proven a need for more.
 */
test("walks the canned interview from a new session to broken-out tickets", async ({
  page,
  request,
}) => {
  // ---- A throwaway project for the export step, way at the end ----------
  const repoRoot = createExportProjectRepo();

  // ---- Session list -> create a session -------------------------------
  await page.goto("/");
  // The shell's page title is plain text mounted into the header, not a
  // semantic heading (see `useSetPageTitle`), so this reads it by role
  // scoped to the header rather than an accessible heading name.
  await expect(page.locator("header")).toContainText("Sessions");

  await page.getByRole("button", { name: "New session" }).click();
  await expect(
    page.getByRole("heading", { name: "New session" }),
  ).toBeVisible();

  await page.getByLabel("Title").fill("Playwright smoke test");
  await page
    .getByLabel("Idea")
    .fill("A workspace app that grills a loose idea into a spec.");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // ---- Land on the workspace -------------------------------------------
  await page.waitForURL(/\/sessions\/[^/]+$/);
  // Scoped to the route's own header (inside `<main>`, as opposed to the
  // shell's global `<header>` that also sits on this page): an unscoped
  // `getByText("Interviewing")` matches every session's status badge once
  // other specs in this suite have created sessions of their own against the
  // same `webServer` and database (see `e2e/support.ts`'s `chooseScenario`
  // doc comment).
  const workspaceHeader = page.locator("main header");
  await expect(workspaceHeader.getByText("Interviewing")).toBeVisible();

  // ---- Register the export project on this session -----------------------
  // Done over HTTP the same way `e2e/support.ts`'s `chooseScenario` calls
  // `use-fake-scenario` — a project has no bearing on the interview itself,
  // only on the export step at the very end.
  const sessionIdMatch = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!sessionIdMatch) {
    throw new Error(`Could not read a session id off ${page.url()}`);
  }
  const sessionId = sessionIdMatch[1]!;
  const project = await registerProject(request, {
    root: repoRoot,
    verifyCommand: "true",
    exportFolder: ".scratch",
  });
  await setSessionProject(request, sessionId, project.id);

  // ---- Start the interview: round 1 (two decisions, both recommended) --
  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("What shape should this take?");
  await expect(cards.last()).toContainText("Where does the data live?");

  // Card 1: accept the interviewer's recommendation.
  await cards
    .first()
    .getByRole("button", { name: "Accept" })
    .click();
  await expect(cards.first()).toContainText("Accepted the recommendation");

  // Card 2: a steering move — "I don't know" — so the round still leaves a
  // loose end to resolve later, the way a real interview sometimes does.
  await cards
    .last()
    .getByRole("button", { name: "I don't know", exact: true })
    .click();
  await expect(cards.last()).toContainText("I don't know");

  await expect(page.getByTestId("round-progress")).toHaveText(
    "2 of 2 answered",
  );

  // ---- Submit the round: settles one decision, leaves the other open ---
  await page.getByRole("button", { name: "Submit round" }).click();

  // The interviewer proposes done immediately (turn 2 of the canned queue),
  // so the workspace moves straight past any further round to the done
  // panel.
  await expect(
    page.getByText("The interviewer proposes you are done"),
  ).toBeVisible();

  // ---- The tree updated: the accepted decision is now settled ----------
  const treeRows = page.getByTestId("tree-row");
  await expect(
    treeRows.filter({ hasText: "What shape should this take?" }),
  ).toHaveAttribute("data-state", "settled");
  await expect(
    treeRows.filter({ hasText: "Where does the data live?" }),
  ).toHaveAttribute("data-state", "frontier");

  // ---- Round history: round 1's attempt log reads back the refusal ------
  // Round 1's proposal was refused once for a tree-rule violation before the
  // retry that succeeded (turn 1 of the canned queue above), so its turn has
  // two attempts. The fake interviewer has no latency, so by the time this
  // page can act, the turn has already stopped and the live turn-working
  // panel that would have shown it mid-flight is gone — the app has nothing
  // left running to poll. The same two attempts are read back here instead,
  // from round history's collapsed attempt log, which holds exactly what the
  // live status would have shown.
  //
  // Scoped to `round-history`: the done panel's supersession check has its
  // own attempt log (one attempt), so an unscoped `attempt-log-trigger`
  // locator matches both and violates Playwright's strict mode.
  const roundHistory = page.getByTestId("round-history");
  await roundHistory.getByRole("button", { name: /Round 1/ }).click();

  const attemptLogTrigger = roundHistory.getByTestId("attempt-log-trigger");
  await expect(attemptLogTrigger).toHaveAttribute("data-count", "2");

  // Collapsed: the attempt rows are not rendered until the log itself is
  // expanded.
  await expect(roundHistory.getByTestId("attempt-row")).toHaveCount(0);

  await attemptLogTrigger.click();

  const attemptRows = roundHistory.getByTestId("attempt-row");
  await expect(attemptRows).toHaveCount(2);
  await expect(attemptRows.first()).toHaveAttribute(
    "data-attempt-kind",
    "tree-rule-refusal",
  );
  await expect(attemptRows.first()).toContainText(
    'depends on "fake-no-such-decision"',
  );
  await expect(attemptRows.last()).toHaveAttribute(
    "data-attempt-kind",
    "success",
  );

  // ---- Resolve the loose end the round left, before confirming ---------
  const looseEnd = page.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await expect(looseEnd).toContainText("Where does the data live?");
  await expect(looseEnd).toContainText("You said you don't know");

  await looseEnd.getByRole("button", { name: "Answer now" }).click();
  await page
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk, in the app's own database.");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByTestId("loose-ends-clear")).toBeVisible();
  await expect(page.getByText("Everything is answered or set aside.")).toBeVisible();

  // ---- Confirm shared understanding -------------------------------------
  await page.getByTestId("confirm-session").click();
  await expect(
    page.getByText("Shared understanding confirmed"),
  ).toBeVisible();

  // ---- Open the output, write the spec (turn 4), see it rendered --------
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "Problem Statement",
  );
  await expect(page.getByTestId("output-spec-section")).toContainText(
    "A canned spec, produced by the fake interviewer.",
  );

  // ---- Break into tickets (turn 5), see the list -------------------------
  await page.getByTestId("break-into-tickets").click();

  await expect(page.getByTestId("ticket-row-1")).toContainText(
    "Build the workspace",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText(
    "Store the data on disk",
  );
  await expect(page.getByTestId("ticket-row-2")).toContainText("Blocked by: #1");

  // ---- Generate the handoff: export is gated on a current one -----------
  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  await expect(
    handoffSection.getByTestId("handoff-document-view"),
  ).toBeVisible({ timeout: 15_000 });

  // ---- Export: decisions.md is in the preview, before anything is written
  // Both decisions this session settled — the accepted recommendation and
  // the loose end answered in its own words above — qualify as entries
  // (`isEntry` in `server/export.ts`), so `decisions.md` is planned.
  const exportSection = page.getByTestId("output-export-section");
  const previewFiles = exportSection.getByTestId("export-preview-files");
  await expect(previewFiles.getByText(/decisions\.md$/)).toBeVisible({
    timeout: 15_000,
  });

  // ---- Export for real: decisions.md is written, with at least one entry
  const exportButton = exportSection.getByTestId("export-action");
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  await exportButton.click();

  const writtenDecisionsFile = exportSection
    .getByTestId("export-written-files")
    .getByText(/decisions\.md$/);
  await expect(writtenDecisionsFile).toBeVisible({ timeout: 15_000 });

  // The written-files list renders the exact absolute path export wrote to
  // (`server/actions/export-session.ts`'s `files`, via `PathList`), so the
  // bundle is read back from disk at that same path — the same bundle
  // directory the UI's own preview and result panels are pointing at.
  const decisionsFilePath = (await writtenDecisionsFile.textContent())?.trim();
  if (!decisionsFilePath) {
    throw new Error("Could not read the exported decisions.md path off the export result.");
  }
  const decisionsFileContent = readFileSync(decisionsFilePath, "utf-8");
  expect(decisionsFileContent).toContain("## Decisions");
  expect(decisionsFileContent).toMatch(/<a id="/);

  rmSync(repoRoot, { recursive: true, force: true });
});
