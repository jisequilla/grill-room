import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
 * A throwaway git repository whose export folder is a symlink to a real
 * directory inside the same repo (`.scratch -> actual-export`). `git
 * check-ignore`/`git ls-files` refuse to resolve a pathspec that goes
 * *through* a symlink ("fatal: ... is beyond a symbolic link", exit 128) —
 * this is the real-world trigger gr-b9v names for `classifyVisibility`
 * falling back to "none known ignored" and reporting every such file as
 * `untracked`. Checking the symlink entry itself (`.scratch`) does not hit
 * this — only a path *underneath* it does, which is exactly where the
 * exported bundle's files land.
 */
function createSymlinkedExportProjectRepo(): string {
  // Real-pathed up front: on macOS, `os.tmpdir()` sits under `/var`, which
  // git (via `rev-parse --show-toplevel` in `register-project`) reports back
  // as `/private/var` — the same normalization `test/git-repos.ts` applies
  // for the same reason.
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-e2e-unchecked-project-")));
  git(root, ["init", "-q"]);
  writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  mkdirSync(path.join(root, "actual-export"));
  symlinkSync("actual-export", path.join(root, ".scratch"));

  return root;
}

/**
 * gr-b9v: exporting into a folder reached through a symlink must classify
 * the written files as `unchecked` ("could not check"), never silently as
 * `untracked` — which would wrongly tell the operator to `git add` and
 * commit files git never actually judged. This walks a session to a real
 * export against a fixture repo built exactly to trigger the symlink case
 * (see {@link createSymlinkedExportProjectRepo}).
 *
 * The canned interview scenario (the fake interviewer's default, used when
 * no scenario is chosen) is the same five-turn queue `smoke.spec.ts` walks,
 * including its one loose end (round 1's second card, answered "I don't
 * know"): the queued `find-superseded` turn is asked only when a loose end
 * actually exists (`server/supersession.ts`'s `scan` returns early
 * otherwise), so that card has to stay a steering move here too, or the
 * scripted queue and the app's real requests fall out of step. Brief
 * grounding is skipped entirely: `export-session` only gates on a current
 * handoff (`app/components/output/export-section.tsx`'s `canExport`), never
 * on grounding, so a plain `generate-handoff` is enough to unblock export.
 */
test("reports a file exported through a symlinked folder as \"could not check\", not untracked", async ({
  page,
  request,
}) => {
  const repoRoot = createSymlinkedExportProjectRepo();

  // ---- Session list -> create a session ---------------------------------
  await page.goto("/");
  await page.getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  await page.getByLabel("Title").fill("Unchecked visibility e2e");
  await page
    .getByLabel("Idea")
    .fill("A session whose export folder sits behind a symlink.");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/sessions\/[^/]+$/);
  const sessionIdMatch = /\/sessions\/([^/]+)$/.exec(page.url());
  if (!sessionIdMatch) {
    throw new Error(`Could not read a session id off ${page.url()}`);
  }
  const sessionId = sessionIdMatch[1]!;

  // ---- Register the symlinked-export project on this session ------------
  const project = await registerProject(request, {
    root: repoRoot,
    verifyCommand: "true",
    exportFolder: ".scratch",
  });
  await setSessionProject(request, sessionId, project.id);

  // ---- Start the interview: round 1 (accept one, leave one loose end) ---
  await page.getByRole("button", { name: "Start the interview" }).click();

  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(2);
  await cards.first().getByRole("button", { name: "Accept" }).click();
  await cards.last().getByRole("button", { name: "I don't know", exact: true }).click();
  await expect(page.getByTestId("round-progress")).toHaveText("2 of 2 answered");

  await page.getByRole("button", { name: "Submit round" }).click();
  await expect(page.getByText("The interviewer proposes you are done")).toBeVisible();

  // ---- Resolve the loose end the round left, before confirming ----------
  const looseEnd = page.getByTestId("loose-end");
  await expect(looseEnd).toHaveCount(1);
  await looseEnd.getByRole("button", { name: "Answer now" }).click();
  await page
    .getByPlaceholder("What you have decided, in your own words")
    .fill("On disk, in the app's own database.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("loose-ends-clear")).toBeVisible();

  // ---- Confirm shared understanding --------------------------------------
  await page.getByTestId("confirm-session").click();
  await expect(page.getByText("Shared understanding confirmed")).toBeVisible();

  // ---- Output: write the spec, break into tickets, generate the handoff --
  await page.getByRole("link", { name: "Open the output" }).click();
  await page.waitForURL(/\/sessions\/[^/]+\/output$/);

  await page.getByTestId("write-spec").click();
  await expect(page.getByTestId("output-spec-section")).toContainText("Problem Statement");

  await page.getByTestId("break-into-tickets").click();
  await expect(page.getByTestId("ticket-row-1")).toBeVisible();

  const handoffSection = page.getByTestId("output-handoff-section");
  await handoffSection.getByTestId("generate-handoff").click();
  await expect(handoffSection.getByTestId("handoff-document-view")).toBeVisible({
    timeout: 15_000,
  });

  // ---- Export into the symlinked folder ----------------------------------
  const exportSection = page.getByTestId("output-export-section");
  const previewFiles = exportSection.getByTestId("export-preview-files");
  await expect(previewFiles.getByText(/spec\.md$/)).toBeVisible({ timeout: 15_000 });

  const exportButton = exportSection.getByTestId("export-action");
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  await exportButton.click();

  // ---- The report says "could not check", never the old "untracked" lie -
  const report = exportSection.getByTestId("export-visibility-report");
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(exportSection.getByTestId("export-visibility-files")).toContainText(
    "Could not check",
  );

  const uncheckedAlert = exportSection.getByTestId("export-visibility-unchecked");
  await expect(uncheckedAlert).toBeVisible();
  await expect(uncheckedAlert).toContainText(/could not tell/i);
  await expect(uncheckedAlert).toContainText(`git -C ${repoRoot} check-ignore -v`);

  // The old defect: every unchecked file reported as `untracked`, with a
  // "git add and commit it" remedy the app cannot actually vouch for. None
  // of that should appear once the file is correctly `unchecked`.
  await expect(exportSection.getByTestId("export-visibility-warning")).toHaveCount(0);

  rmSync(repoRoot, { recursive: true, force: true });
});
