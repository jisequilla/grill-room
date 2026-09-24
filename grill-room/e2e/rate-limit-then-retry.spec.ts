import { expect, test } from "@playwright/test";

import { chooseScenario, createSession } from "./support";

/**
 * `rate-limit-then-retry` (`server/interviewer/fake.ts`) scripts round 1's
 * proposal rate limited, then accepted on a manual retry — two separate
 * calls, each delayed 2 s (the scenario's `delayMs`). The registry comment
 * calls this "long enough to see the turn running before it fails, and
 * again before the manual retry succeeds": `sessions.$sessionId.tsx` now
 * polls `get-current-round`, `get-tree`, `list-rounds`, `get-active-turn`
 * and `list-loose-ends` every `STARTING_POLL_MS` (500 ms) from the moment
 * this tab's own `request-next-round` request is pending, rather than only
 * once the round it already has says `turnStatus === "working"` — so the
 * running-turn panel actually appears inside the 2 s window below, for both
 * the rate-limited first call and the manual retry, and the first call's
 * panel carries the live attempt log too (gr-93t).
 *
 * The manual retry's own panel does not get the live log, and this test
 * does not claim it does: `resumeOrStartTurnRecorder` /
 * `addRun` (`server/turn-records.ts`) continue the same turn record for a
 * manual retry without clearing its `completedAt`, so `findRunningTurn`
 * (also `server/turn-records.ts`, `isNull(schema.turns.completedAt)`) never
 * finds it while the retry is in flight — `get-active-turn` falls back to
 * the stale, already-completed record, and `TurnWorkingPanel`
 * (`turn-panels.tsx`) treats a turn whose `completedAt` isn't null as
 * stopped and renders no log at all. That is a server-side turn-recording
 * gap, not this ticket's client polling/visibility bug, and out of this
 * ticket's file boundary (`server code`) to fix; flagged in the PR.
 *
 * What was already checkable, and still is: the rate limit fails apart from
 * a plain interviewer error, and the manual retry is a second run of the
 * same turn — round history's attempt log shows both, exactly like
 * `refusal-then-success.spec.ts`'s single-turn refusal-then-success, with
 * the added manual-retry separator and a budget that restarts at 1 for the
 * new run.
 */
test("rate limit then manual retry, and round history's attempt log shows both runs", async ({
  page,
  request,
}) => {
  const sessionId = await createSession(page, {
    title: "Rate limited then retried",
    idea: "A tool that turns a loose idea into settled decisions.",
  });
  await chooseScenario(request, sessionId, "rate-limit-then-retry");

  await page.getByRole("button", { name: "Start the interview" }).click();

  // Mid-turn, before the rate limit lands: the running-turn panel is up and
  // its attempt log shows the one attempt actually in flight.
  const working = page.getByTestId("turn-working");
  await expect(working).toBeVisible();
  const workingLog = working.getByTestId("attempt-log");
  await expect(workingLog).toBeVisible();
  await expect(workingLog.getByTestId("attempt-row")).toHaveAttribute(
    "data-attempt-kind",
    "running",
  );

  // It fails as a rate limit, shown apart from a plain interviewer error —
  // its own headline and its own attempt kind.
  const failed = page.getByTestId("turn-failed");
  await expect(failed).toHaveAttribute("data-error-code", "rate-limited");
  await expect(failed).toContainText("Your Claude usage limit was hit.");

  const failedTrigger = failed.getByTestId("attempt-log-trigger");
  await expect(failedTrigger).toHaveAttribute("data-count", "1");
  await failedTrigger.click();
  await expect(failed.getByTestId("attempt-row")).toHaveAttribute(
    "data-attempt-kind",
    "rate-limit",
  );

  // Manual retry: a second, separate call. It goes through the same failed
  // -> working transition as the first one, so the running panel comes back
  // for it too rather than only ever appearing once — its attempt log does
  // not, for the separate, pre-existing reason the comment above explains.
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(working).toBeVisible();

  // It succeeds: the round opens with its one card.
  const cards = page.getByTestId("round-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("What shape should this take?");

  // Submitting the round, as `refusal-then-success.spec.ts` does, is what
  // makes round history — the one place this turn's attempt log is ever
  // shown once it has stopped — hold it. This scenario's queue has nothing
  // past this one round either, so the follow-up ask fails the same
  // harmless way that test documents; the round is already recorded as
  // submitted before that happens.
  await cards.first().getByRole("button", { name: "Write my own" }).click();
  await cards
    .first()
    .getByPlaceholder("What you have decided, in your own words")
    .fill("A single page.");
  await cards
    .first()
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("button", { name: "Submit round" }).click();

  const roundHistory = page.getByTestId("round-history");
  await roundHistory.getByRole("button", { name: /Round 1/ }).click();

  const attemptLogTrigger = roundHistory.getByTestId("attempt-log-trigger");
  await expect(attemptLogTrigger).toHaveAttribute("data-count", "2");
  await attemptLogTrigger.click();

  await expect(
    roundHistory.getByTestId("manual-retry-separator"),
  ).toBeVisible();

  const attemptRows = roundHistory.getByTestId("attempt-row");
  await expect(attemptRows).toHaveCount(2);
  await expect(attemptRows.first()).toHaveAttribute(
    "data-attempt-kind",
    "rate-limit",
  );
  await expect(attemptRows.first()).toHaveAttribute("data-budget-number", "1");
  await expect(attemptRows.last()).toHaveAttribute(
    "data-attempt-kind",
    "success",
  );
  // The budget resets with the new run: this is its first attempt, not its
  // third.
  await expect(attemptRows.last()).toHaveAttribute("data-budget-number", "1");
});
