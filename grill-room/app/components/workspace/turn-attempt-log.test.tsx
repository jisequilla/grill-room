import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";

/*
 * These render with no i18n catalog wired up (the same bare
 * `renderToStaticMarkup` pattern `readiness-panel.test.tsx` uses), so `useT()`
 * falls back to a humanized version of the key rather than this app's actual
 * `en-US.ts` copy. Assertions therefore read structure, test ids, and the
 * component's own data attributes and raw (untranslated) inputs — reasons,
 * kinds, counts — never the rendered label text.
 */

type Run = Turn["runs"][number];
type Attempt = Run["attempts"][number];

let attemptId = 0;
let runId = 0;

/** A completed attempt, defaulting to a clean success. */
function attempt(overrides: Partial<Attempt> = {}): Attempt {
  attemptId += 1;
  return {
    id: `attempt-${attemptId}`,
    attemptNumber: attemptId,
    startedAt: "2026-09-24T10:00:00.000Z",
    durationMs: 12_000,
    kind: "success",
    reason: null,
    rawOutput: null,
    ...overrides,
  };
}

/** An attempt still in flight: no kind, no duration, no reason yet. */
function runningAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return attempt({
    durationMs: null,
    kind: null,
    reason: null,
    startedAt: "2026-09-24T10:00:00.000Z",
    ...overrides,
  });
}

function run(attempts: Attempt[], overrides: Partial<Run> = {}): Run {
  runId += 1;
  return {
    id: `run-${runId}`,
    runNumber: runId,
    manualRetry: false,
    createdAt: "2026-09-24T10:00:00.000Z",
    attempts,
    ...overrides,
  };
}

function turn(runs: Run[], overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    turnKind: "propose-round",
    model: "sonnet",
    startedAt: "2026-09-24T10:00:00.000Z",
    completedAt: "2026-09-24T10:01:00.000Z",
    totalElapsedMs: 60_000,
    outcome: "succeeded",
    runs,
    ...overrides,
  };
}

function render(value: Turn | null) {
  return renderToStaticMarkup(<TurnAttemptLog turn={value} />);
}

/** Each attempt row's own opening-tag attributes, in order. */
function rowTags(html: string): string[] {
  const matches = html.matchAll(/<li[^>]*data-testid="attempt-row"[^>]*>/g);
  return Array.from(matches, (match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

describe("TurnAttemptLog", () => {
  it("renders nothing when there is no turn record", () => {
    expect(render(null)).toBe("");
  });

  it("renders nothing for a turn with no attempts", () => {
    expect(render(turn([]))).toBe("");
    expect(render(turn([run([])]))).toBe("");
  });

  it("shows a still-running turn's attempts inline, with no collapse control", () => {
    const html = render(
      turn(
        [
          run([
            attempt({
              kind: "tree-rule-refusal",
              reason: "That question is not on the frontier.",
            }),
            runningAttempt(),
          ]),
        ],
        { completedAt: null, totalElapsedMs: null, outcome: null },
      ),
    );

    expect(html).toContain('data-testid="attempt-log"');
    expect(html).not.toContain('data-testid="attempt-log-trigger"');
    expect(html).toContain('data-testid="attempt-log-body"');
    expect(html).toContain("That question is not on the frontier.");

    const [first, second] = rowTags(html);
    expect(attr(first!, "data-attempt-kind")).toBe("tree-rule-refusal");
    expect(attr(first!, "data-budget-number")).toBe("1");
    expect(attr(second!, "data-attempt-kind")).toBe("running");
    expect(attr(second!, "data-budget-number")).toBe("2");
  });

  it("collapses a finished turn to a count, hiding the attempts until expanded", () => {
    const html = render(turn([run([attempt({ kind: "success" })])]));

    const trigger = /<button[^>]*data-testid="attempt-log-trigger"[^>]*>/.exec(
      html,
    )?.[0];
    expect(trigger).toBeTruthy();
    expect(attr(trigger!, "data-count")).toBe("1");
    // Radix's Collapsible only mounts its content once open; a fresh,
    // finished turn starts closed, so the row never reaches the markup.
    expect(html).not.toContain('data-testid="attempt-row"');
  });

  it("counts every attempt across every run for the collapsed trigger", () => {
    const html = render(
      turn([
        run([attempt(), attempt()]),
        run([attempt()], { manualRetry: true, runNumber: 2 }),
      ]),
    );
    const trigger = /<button[^>]*data-testid="attempt-log-trigger"[^>]*>/.exec(
      html,
    )?.[0];
    expect(attr(trigger!, "data-count")).toBe("3");
  });

  it("marks every run after the first with a manual-retry separator, between the runs' attempts", () => {
    const html = render(
      turn(
        [
          run([attempt({ kind: "schema-invalid", reason: "Bad shape." })]),
          run([attempt({ kind: "success" })], { manualRetry: true, runNumber: 2 }),
        ],
        { completedAt: null, totalElapsedMs: null, outcome: null },
      ),
    );

    const separatorCount =
      html.split('data-testid="manual-retry-separator"').length - 1;
    expect(separatorCount).toBe(1);

    const separatorAt = html.indexOf('data-testid="manual-retry-separator"');
    const rows = rowTags(html);
    expect(rows).toHaveLength(2);
    expect(attr(rows[0]!, "data-attempt-kind")).toBe("schema-invalid");
    expect(attr(rows[1]!, "data-attempt-kind")).toBe("success");
    // The separator sits after the first run's row and before the second's.
    expect(html.indexOf(rows[0]!)).toBeLessThan(separatorAt);
    expect(separatorAt).toBeLessThan(html.indexOf(rows[1]!));
  });

  it("gives every run's first attempt budget number 1 again after a manual retry", () => {
    const html = render(
      turn(
        [
          run([attempt({ kind: "rate-limit", reason: "Spent." })]),
          run([attempt({ kind: "success" })], { manualRetry: true, runNumber: 2 }),
        ],
        { completedAt: null, totalElapsedMs: null, outcome: null },
      ),
    );
    const rows = rowTags(html);
    expect(attr(rows[0]!, "data-budget-number")).toBe("1");
    expect(attr(rows[1]!, "data-budget-number")).toBe("1");
  });

  it("labels a rate limit distinctly from an interviewer error", () => {
    const html = render(
      turn(
        [
          run([
            attempt({ kind: "rate-limit", reason: "The subscription pool is spent." }),
            attempt({ kind: "error", reason: "failed: The turn died." }),
          ]),
        ],
        { completedAt: null, totalElapsedMs: null, outcome: null },
      ),
    );

    const rows = rowTags(html);
    expect(attr(rows[0]!, "data-attempt-kind")).toBe("rate-limit");
    expect(attr(rows[1]!, "data-attempt-kind")).toBe("error");

    const rateLimitTag = /<span[^>]*data-kind="rate-limit"[^>]*>/.exec(html)?.[0];
    const errorTag = /<span[^>]*data-kind="error"[^>]*>/.exec(html)?.[0];
    expect(rateLimitTag).toBeTruthy();
    expect(errorTag).toBeTruthy();
    // Distinct kinds must never share their tag's colour class, and a rate
    // limit must never be styled as the destructive/error colour.
    const rateLimitClass = attr(rateLimitTag!, "class") ?? "";
    const errorClass = attr(errorTag!, "class") ?? "";
    expect(rateLimitClass).not.toBe(errorClass);
    expect(rateLimitClass).not.toContain("destructive");
    expect(errorClass).toContain("destructive");
  });

  it("gives a resume fallback no budget number, without consuming the count for later attempts", () => {
    const finished = render(
      turn([
        run([
          attempt({ kind: "resume-fallback", reason: "No conversation found." }),
          attempt({ kind: "tree-rule-refusal", reason: "Off frontier." }),
          attempt({ kind: "success" }),
        ]),
      ]),
    );
    expect(finished).not.toContain('data-testid="attempt-row"');

    // Re-rendered as still running, so the body mounts and the rows can be
    // read back directly.
    const running = render(
      turn(
        [
          run([
            attempt({ kind: "resume-fallback", reason: "No conversation found." }),
            attempt({ kind: "tree-rule-refusal", reason: "Off frontier." }),
            runningAttempt(),
          ]),
        ],
        { completedAt: null, totalElapsedMs: null, outcome: null },
      ),
    );

    const rows = rowTags(running);
    expect(rows).toHaveLength(3);
    expect(attr(rows[0]!, "data-attempt-kind")).toBe("resume-fallback");
    expect(attr(rows[0]!, "data-budget-number")).toBeNull();
    expect(attr(rows[1]!, "data-attempt-kind")).toBe("tree-rule-refusal");
    expect(attr(rows[1]!, "data-budget-number")).toBe("1");
    expect(attr(rows[2]!, "data-attempt-kind")).toBe("running");
    expect(attr(rows[2]!, "data-budget-number")).toBe("2");
  });
});
