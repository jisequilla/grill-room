import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ReadinessPanel,
  type Readiness,
} from "@/components/workspace/readiness-panel";

function judged(result: Partial<Readiness["result"]> = {}): Readiness {
  return {
    ideaJudged: "A PWA for 16-week marathon training",
    judgedAt: "2026-09-24T10:00:00.000Z",
    result: {
      evidence: ["16-week plan", "runs offline as a PWA"],
      objective: "A training-plan PWA for one runner",
      objectiveIsProcess: false,
      expectedOutcome: "The runner follows the plan from their phone",
      unknowns: ["Which plan template", "How workouts are logged"],
      verdict: "ready",
      missing: [],
      ...result,
    },
  };
}

function render(
  readiness: Readiness | null,
  { working = false, isAssessing = false } = {},
) {
  return renderToStaticMarkup(
    <ReadinessPanel
      readiness={readiness}
      working={working}
      isAssessing={isAssessing}
      onAssess={() => {}}
    />,
  );
}

/** The attribute a disabled button renders with, not the `disabled:` classes. */
const DISABLED = 'disabled=""';

/**
 * The markup from the opening tag carrying `data-testid` up to the next
 * element that carries one.
 */
function section(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, `${testId} is rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  const next = html.indexOf("data-testid=", at + 1);
  const end = next === -1 ? html.length : html.lastIndexOf("<", next);
  return html.slice(start, end);
}

describe("ReadinessPanel", () => {
  it("invites an assessment when the idea has not been judged", () => {
    const html = render(null);

    expect(html).toContain('data-testid="readiness-panel"');
    expect(html).toContain('data-testid="readiness-assess"');
    expect(html).not.toContain('data-testid="readiness-reassess"');
    expect(html).not.toContain('data-testid="readiness-verdict"');
    expect(html).not.toContain('data-testid="readiness-objective"');
  });

  it("renders every field of a judgment", () => {
    const html = render(judged());

    expect(section(html, "readiness-verdict")).toContain('data-verdict="ready"');
    expect(section(html, "readiness-objective")).toContain(
      "A training-plan PWA for one runner",
    );
    const evidence = section(html, "readiness-evidence");
    expect(evidence).toContain("16-week plan");
    expect(evidence).toContain("runs offline as a PWA");
    expect(section(html, "readiness-expected-outcome")).toContain(
      "The runner follows the plan from their phone",
    );
    const unknowns = section(html, "readiness-unknowns");
    expect(unknowns).toContain("Which plan template");
    expect(unknowns).toContain("How workouts are logged");
    expect(html).toContain('data-testid="readiness-reassess"');
    expect(html).not.toContain('data-testid="readiness-assess"');
  });

  it("marks a not-ready verdict and lists what is missing", () => {
    const html = render(
      judged({
        verdict: "not-ready",
        evidence: [],
        objective: null,
        expectedOutcome: null,
        missing: ["Name what gets built", "Say who uses it"],
      }),
    );

    expect(section(html, "readiness-verdict")).toContain(
      'data-verdict="not-ready"',
    );
    const missing = section(html, "readiness-missing");
    expect(missing).toContain("Name what gets built");
    expect(missing).toContain("Say who uses it");
    expect(section(html, "readiness-objective")).not.toContain(
      "A training-plan PWA",
    );
    expect(section(html, "readiness-expected-outcome")).not.toContain(
      "The runner follows",
    );
  });

  it("hides the missing list when nothing is missing", () => {
    expect(render(judged({ missing: [] }))).not.toContain(
      'data-testid="readiness-missing"',
    );
  });

  it("warns about a process objective only when the judge flagged one", () => {
    expect(render(judged({ objectiveIsProcess: false }))).not.toContain(
      'data-testid="readiness-process-warning"',
    );
    expect(
      render(
        judged({
          objective: "Decide how to evaluate eight repos",
          objectiveIsProcess: true,
          verdict: "not-ready",
        }),
      ),
    ).toContain('data-testid="readiness-process-warning"');
  });

  it("disables the action while a turn works", () => {
    const assess = section(render(null, { working: true }), "readiness-assess");
    expect(assess).toContain(DISABLED);
    const reassess = section(
      render(judged(), { isAssessing: true }),
      "readiness-reassess",
    );
    expect(reassess).toContain(DISABLED);
    expect(section(render(null), "readiness-assess")).not.toContain(DISABLED);
  });
});
