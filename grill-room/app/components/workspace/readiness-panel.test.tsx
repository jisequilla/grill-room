import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ReadinessPanel,
  ScoutReportPanel,
  type Readiness,
  type ScoutReport,
} from "@/components/workspace/readiness-panel";

function judged(result: Partial<Readiness["result"]> = {}): Readiness {
  return {
    ideaJudged: "A PWA for 16-week marathon training",
    judgedAt: "2026-09-24T10:00:00.000Z",
    scoutReportId: null,
    result: {
      evidence: [
        { text: "16-week plan", source: "idea", citation: null },
        { text: "runs offline as a PWA", source: "idea", citation: null },
      ],
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
  { working = false, isAssessing = false, canAssess = true } = {},
) {
  return renderToStaticMarkup(
    <ReadinessPanel
      readiness={readiness}
      working={working}
      isAssessing={isAssessing}
      onAssess={() => {}}
      canAssess={canAssess}
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

  it("marks repo-sourced evidence with its citation", () => {
    const html = render(
      judged({
        evidence: [
          {
            text: "Ingest runs on a Postgres-backed queue, not a message broker.",
            source: "repo",
            citation: "docs/adr/0003-queue.md:5-9",
          },
        ],
      }),
    );

    const evidence = section(html, "readiness-evidence");
    expect(evidence).toContain("Ingest runs on a Postgres-backed queue");
    expect(evidence).toContain("docs/adr/0003-queue.md:5-9");
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

  it("shows the verdict read-only, with no assess control, once a round exists", () => {
    const html = render(judged(), { canAssess: false });

    expect(html).toContain('data-testid="readiness-panel"');
    expect(html).toContain('data-testid="readiness-verdict"');
    expect(section(html, "readiness-verdict")).toContain('data-verdict="ready"');
    expect(html).not.toContain('data-testid="readiness-assess"');
    expect(html).not.toContain('data-testid="readiness-reassess"');
  });

  it("still offers no control with no judgment and canAssess false (a defensive combination the route never actually produces)", () => {
    const html = render(null, { canAssess: false });

    expect(html).toContain('data-testid="readiness-panel"');
    expect(html).not.toContain('data-testid="readiness-assess"');
    expect(html).not.toContain('data-testid="readiness-reassess"');
  });
});

function scoutReport(overrides: Partial<ScoutReport> = {}): ScoutReport {
  return {
    id: "report-1",
    sessionId: "session-1",
    projectId: "project-1",
    facts: {
      headCommit: "7ea65ab0e100cafe1234567890abcdef1234567",
      headBranch: "main",
      remotes: [],
      dirty: false,
      recentCommitSubjects: ["Fixture repo for scout browser check"],
      hasAgentInstructions: true,
      decisionsFolder: "docs/adr",
      hasRulesFolder: false,
    },
    result: {
      currentState: [
        {
          status: "partial",
          summary: "Ingest lag is measured but never alerted on.",
          citations: ["src/ingest/metrics.ts:12-30"],
        },
      ],
      proposedDecisions: [
        {
          key: "no-message-broker",
          title: "No message broker",
          statement: "Ingest runs on a Postgres-backed queue, not a message broker.",
          source: "recorded",
          citation: "docs/adr/0003-queue.md:5-9",
          reason: "An alert on ingest lag reads the queue this decision chose.",
        },
        {
          key: "agent-instructions-exist",
          title: "The repo already documents agent conventions",
          statement: "CLAUDE.md exists at the repo root.",
          source: "inferred",
          citation: "CLAUDE.md:1",
          reason: "A scouted feature should follow the same conventions.",
        },
      ],
      previousDecisions: [],
    },
    commitRead: "7ea65ab0e100cafe1234567890abcdef1234567",
    ideaRead: "Alert on-call when ingest lag exceeds a threshold.",
    model: "sonnet",
    ranAt: "2026-09-24T10:00:00.000Z",
    turnId: null,
    dispositions: {
      "no-message-broker": "undecided",
      "agent-instructions-exist": "undecided",
    },
    stale: false,
    ...overrides,
  } as ScoutReport;
}

function renderScout(
  report: ScoutReport | null,
  {
    busy = false,
    isScouting = false,
  }: { busy?: boolean; isScouting?: boolean } = {},
) {
  return renderToStaticMarkup(
    <ScoutReportPanel
      report={report}
      busy={busy}
      isScouting={isScouting}
      onRescout={() => {}}
      onKeep={() => {}}
      onDrop={() => {}}
    />,
  );
}

describe("ScoutReportPanel", () => {
  it("invites a scout run when the session has no report yet", () => {
    const html = renderScout(null);

    expect(html).toContain('data-testid="scout-panel"');
    expect(html).toContain('data-testid="scout-run"');
    expect(html).not.toContain('data-testid="scout-rescout"');
    expect(html).not.toContain('data-testid="scout-facts"');
    expect(html).not.toContain('data-testid="scout-decisions"');
  });

  it("renders the facts, current state and proposed decisions of a report", () => {
    const html = renderScout(scoutReport());

    expect(html).toContain('data-testid="scout-rescout"');
    expect(html).not.toContain('data-testid="scout-run"');

    // `section()` cuts at the next `data-testid`, which is too fine-grained
    // for these containers — each fact and each decision carries its own —
    // so this checks the whole markup directly for content unique to the
    // fixture instead of trying to isolate one container's slice.
    expect(html).toContain('data-testid="scout-facts"');
    expect(html).toContain("7ea65ab0e100");
    expect(html).toContain("main");
    expect(html).toContain("docs/adr");

    expect(html).toContain('data-status="partial"');
    expect(html).toContain("Ingest lag is measured but never alerted on.");
    expect(html).toContain("src/ingest/metrics.ts:12-30");

    expect(html).toContain('data-testid="scout-decisions"');
    expect(html).toContain("No message broker");
    expect(html).toContain("docs/adr/0003-queue.md:5-9");
    expect(html).toContain("An alert on ingest lag reads the queue this decision chose.");
    expect(html).toContain("The repo already documents agent conventions");
    expect(html).toContain("CLAUDE.md:1");

    expect(html).toContain("7ea65ab0e100");
    expect(html).toContain('data-testid="scout-meta"');
  });

  it("shows keep and drop controls for an undecided proposal", () => {
    const html = renderScout(scoutReport());
    const row = html.slice(
      html.indexOf('data-key="no-message-broker"'),
      html.indexOf('data-key="agent-instructions-exist"'),
    );

    expect(row).toContain('data-disposition="undecided"');
    expect(row).toContain('data-testid="scout-decision-keep"');
    expect(row).toContain('data-testid="scout-decision-drop"');
    expect(row).not.toContain('data-testid="scout-decision-kept-note"');
  });

  it("shows the kept note without controls once a proposal is kept", () => {
    const html = renderScout(
      scoutReport({
        dispositions: {
          "no-message-broker": "kept",
          "agent-instructions-exist": "undecided",
        },
      }),
    );
    const row = html.slice(
      html.indexOf('data-key="no-message-broker"'),
      html.indexOf('data-key="agent-instructions-exist"'),
    );

    expect(row).toContain('data-disposition="kept"');
    expect(row).toContain('data-testid="scout-decision-kept-note"');
    expect(row).not.toContain('data-testid="scout-decision-keep"');
    expect(row).not.toContain('data-testid="scout-decision-drop"');
  });

  it("shows the dropped note alongside controls once a proposal is dropped", () => {
    const html = renderScout(
      scoutReport({
        dispositions: {
          "no-message-broker": "dropped",
          "agent-instructions-exist": "undecided",
        },
      }),
    );
    const row = html.slice(
      html.indexOf('data-key="no-message-broker"'),
      html.indexOf('data-key="agent-instructions-exist"'),
    );

    expect(row).toContain('data-disposition="dropped"');
    expect(row).toContain('data-testid="scout-decision-dropped-note"');
    expect(row).toContain('data-testid="scout-decision-keep"');
    expect(row).toContain('data-testid="scout-decision-drop"');
  });

  it("shows the stale badge only once the report is stale", () => {
    expect(renderScout(scoutReport({ stale: false }))).not.toContain(
      'data-testid="scout-stale-badge"',
    );
    expect(renderScout(scoutReport({ stale: true }))).toContain(
      'data-testid="scout-stale-badge"',
    );
  });

  it("disables the re-scout and every decision control while busy", () => {
    const html = renderScout(scoutReport(), { busy: true });

    expect(section(html, "scout-rescout")).toContain(DISABLED);

    // `section()` cuts at the next `data-testid`, which each decision row
    // carries its own of, so this reads from the decisions list to the end
    // of the markup instead of trying to isolate just that container.
    const decisions = html.slice(html.indexOf('data-testid="scout-decisions"'));
    const keepButtons = decisions.match(/data-testid="scout-decision-keep"/g) ?? [];
    expect(keepButtons.length).toBeGreaterThan(0);
    // Every button inside the decisions list carries `disabled`.
    for (const button of decisions.split("<button").slice(1)) {
      expect(button.slice(0, button.indexOf(">"))).toContain(DISABLED);
    }
  });
});
