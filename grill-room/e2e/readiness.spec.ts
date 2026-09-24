import { expect, test } from "@playwright/test";

import { chooseScenario, createSession } from "./support";

/**
 * `readiness-not-ready` and `readiness-ready` (`server/interviewer/fake.ts`)
 * each script exactly one `assess-readiness` request, so this drives two
 * sessions rather than re-assessing one — the readiness panel through the
 * real flow, both verdicts.
 */
test("readiness shows a not-ready idea's verdict and a ready idea's evidence", async ({
  page,
  request,
}) => {
  // ---- Not ready: the verdict, what is missing, and why ------------------
  const notReadySessionId = await createSession(page, {
    title: "Repo comparison",
    idea: "Decide how to evaluate eight repos.",
  });
  await chooseScenario(request, notReadySessionId, "readiness-not-ready");

  const notReadyPanel = page.getByTestId("readiness-panel");
  await expect(notReadyPanel).toBeVisible();
  await notReadyPanel.getByTestId("readiness-assess").click();

  await expect(notReadyPanel.getByTestId("readiness-verdict")).toHaveAttribute(
    "data-verdict",
    "not-ready",
  );
  await expect(
    notReadyPanel.getByTestId("readiness-process-warning"),
  ).toBeVisible();
  await expect(notReadyPanel.getByTestId("readiness-missing")).toContainText(
    "A single buildable thing, not a method for deciding one",
  );
  await expect(notReadyPanel.getByTestId("readiness-unknowns")).toContainText(
    "What would actually get built",
  );

  // Nowhere else in this scenario shows this turn's attempt log — one
  // assess-readiness request, one attempt — so the readiness panel's own
  // collapsed log is the thing to check.
  const notReadyTrigger = notReadyPanel.getByTestId("attempt-log-trigger");
  await expect(notReadyTrigger).toHaveAttribute("data-count", "1");

  // ---- Ready: the evidence and the objective it names ---------------------
  const readySessionId = await createSession(page, {
    title: "Marathon Tracker",
    idea: "A 16-week marathon training tracker for one runner.",
  });
  await chooseScenario(request, readySessionId, "readiness-ready");

  const readyPanel = page.getByTestId("readiness-panel");
  await expect(readyPanel).toBeVisible();
  await readyPanel.getByTestId("readiness-assess").click();

  await expect(readyPanel.getByTestId("readiness-verdict")).toHaveAttribute(
    "data-verdict",
    "ready",
  );
  await expect(readyPanel.getByTestId("readiness-process-warning")).toHaveCount(
    0,
  );
  await expect(readyPanel.getByTestId("readiness-objective")).toContainText(
    "A tracker for a 16-week marathon training plan.",
  );
  await expect(readyPanel.getByTestId("readiness-evidence")).toContainText(
    "The idea names marathon runners preparing for a 16-week training block.",
  );
  await expect(
    readyPanel.getByTestId("readiness-expected-outcome"),
  ).toContainText("A plan the runner can follow week by week.");
});
