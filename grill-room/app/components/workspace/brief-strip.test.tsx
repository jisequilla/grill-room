import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";
import {
  BriefStrip,
  briefSummary,
  nextBriefStripOpenState,
} from "@/components/workspace/brief-strip";
import type { Readiness, ScoutReport } from "@/components/workspace/readiness-panel";

/**
 * A translate function that reads this app's own `en-US.ts` copy directly —
 * dotted-path lookup plus `{{var}}` interpolation, the same substitution
 * `@agent-native/core`'s fallback formatter does — rather than going through
 * `useT()`/react-i18next, which has no catalog wired up in these tests (see
 * `readiness-panel.test.tsx` and `turn-attempt-log.test.tsx`'s comments) and
 * would humanize the key instead of returning the real copy. `briefSummary`
 * takes its translate function as a plain argument for exactly this reason:
 * it lets this test pin the exact rendered sentence against the real
 * `en-US.ts` strings, catching a wording change there as a test failure.
 */
function realT(key: string, params: Record<string, unknown> = {}): string {
  const value: unknown = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      enUS,
    );
  if (typeof value !== "string") {
    throw new Error(`No en-US string for "${key}"`);
  }
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? ""),
  );
}

function scoutReport(overrides: Partial<ScoutReport> = {}): ScoutReport {
  return {
    id: "report-1",
    sessionId: "session-1",
    projectId: "project-1",
    facts: {
      headCommit: "0c00712abcdef1234567890",
      headBranch: "main",
      remotes: [],
      dirty: false,
      recentCommitSubjects: [],
      hasAgentInstructions: true,
      decisionsFolder: null,
      hasRulesFolder: false,
    },
    result: {
      currentState: [],
      proposedDecisions: [
        { key: "a", title: "A", statement: "a", source: "recorded", citation: "x:1", reason: "r" },
        { key: "b", title: "B", statement: "b", source: "recorded", citation: "x:1", reason: "r" },
        { key: "c", title: "C", statement: "c", source: "inferred", citation: "x:1", reason: "r" },
        { key: "d", title: "D", statement: "d", source: "inferred", citation: "x:1", reason: "r" },
        { key: "e", title: "E", statement: "e", source: "inferred", citation: "x:1", reason: "r" },
        { key: "f", title: "F", statement: "f", source: "inferred", citation: "x:1", reason: "r" },
        { key: "g", title: "G", statement: "g", source: "inferred", citation: "x:1", reason: "r" },
        { key: "h", title: "H", statement: "h", source: "inferred", citation: "x:1", reason: "r" },
      ],
      previousDecisions: [],
    },
    commitRead: "0c00712abcdef1234567890",
    ideaRead: "An idea.",
    model: "sonnet",
    ranAt: "2026-09-24T10:00:00.000Z",
    turnId: null,
    dispositions: {
      a: "kept",
      b: "kept",
      c: "dropped",
      d: "dropped",
      e: "dropped",
      f: "dropped",
      g: "dropped",
      h: "dropped",
    },
    stale: false,
    ...overrides,
  } as ScoutReport;
}

function judged(verdict: "ready" | "not-ready" = "ready"): Readiness {
  return {
    ideaJudged: "An idea.",
    judgedAt: "2026-09-24T10:00:00.000Z",
    scoutReportId: null,
    result: {
      evidence: [],
      objective: "Build the thing",
      objectiveIsProcess: false,
      expectedOutcome: "It works",
      unknowns: [],
      verdict,
      missing: [],
    },
  } as Readiness;
}

describe("briefSummary", () => {
  it("matches DESIGN.md's own example: a read commit, kept/dropped counts, ready", () => {
    expect(
      briefSummary(
        {
          hasProject: true,
          scoutReport: scoutReport(),
          scoutWorking: false,
          readiness: judged("ready"),
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Scout: read 0c00712 · 2 kept, 6 dropped · Ready");
  });

  it("adds a to-review clause once some proposals have no disposition yet", () => {
    const summary = briefSummary(
      {
        hasProject: true,
        scoutReport: scoutReport({
          dispositions: { a: "kept", b: "undecided", c: "dropped", d: "undecided", e: "dropped", f: "dropped" },
        }),
        scoutWorking: false,
        readiness: judged("not-ready"),
        readinessWorking: false,
      },
      realT,
    );

    expect(summary).toBe("Scout: read 0c00712 · 1 kept, 3 dropped, 2 to review · Not ready");
  });

  it("shows no commits yet when the project has none", () => {
    const summary = briefSummary(
      {
        hasProject: true,
        scoutReport: scoutReport({ commitRead: null }),
        scoutWorking: false,
        readiness: judged("ready"),
        readinessWorking: false,
      },
      realT,
    );

    expect(summary).toBe("Scout: read · no commits yet · 2 kept, 6 dropped · Ready");
  });

  it("says the scout was never run, for a project with no report yet", () => {
    expect(
      briefSummary(
        {
          hasProject: true,
          scoutReport: null,
          scoutWorking: false,
          readiness: judged("ready"),
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Scout: not run · Ready");
  });

  it("says readiness has not been judged when there is no verdict", () => {
    expect(
      briefSummary(
        {
          hasProject: true,
          scoutReport: null,
          scoutWorking: false,
          readiness: null,
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Scout: not run · Readiness · not judged");
  });

  it("drops the scout segment entirely when the session has no project", () => {
    expect(
      briefSummary(
        {
          hasProject: false,
          scoutReport: null,
          scoutWorking: false,
          readiness: judged("ready"),
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Ready");
    expect(
      briefSummary(
        {
          hasProject: false,
          scoutReport: null,
          scoutWorking: false,
          readiness: judged("not-ready"),
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Not ready");
  });

  it("shows the working state for whichever turn is running, without touching the other half", () => {
    expect(
      briefSummary(
        {
          hasProject: true,
          scoutReport: null,
          scoutWorking: true,
          readiness: judged("ready"),
          readinessWorking: false,
        },
        realT,
      ),
    ).toBe("Scout: reading… · Ready");

    expect(
      briefSummary(
        {
          hasProject: true,
          scoutReport: scoutReport(),
          scoutWorking: false,
          readiness: null,
          readinessWorking: true,
        },
        realT,
      ),
    ).toBe("Scout: read 0c00712 · 2 kept, 6 dropped · Readiness · judging…");
  });
});

describe("BriefStrip", () => {
  function render(props: Partial<Parameters<typeof BriefStrip>[0]> = {}) {
    return renderToStaticMarkup(
      <BriefStrip
        hasProject={false}
        scoutReport={null}
        scoutWorking={false}
        readiness={null}
        readinessWorking={false}
        showReadiness={false}
        roundsCount={undefined}
        {...props}
      >
        <span data-testid="brief-child">child</span>
      </BriefStrip>,
    );
  }

  it("renders nothing with no project, no readiness judgment, and no pre-round invitation", () => {
    expect(render()).toBe("");
  });

  it("renders the strip once the session has a project", () => {
    const html = render({ hasProject: true });
    expect(html).toContain('data-testid="brief-strip"');
    expect(html).toContain('data-testid="brief-toggle"');
    expect(html).toContain('data-testid="brief-summary"');
  });

  it("renders the strip from a stored readiness judgment alone, with no project", () => {
    const html = render({ readiness: judged("ready") });
    expect(html).toContain('data-testid="brief-strip"');
  });

  it("renders the strip before the first round even with no project and no judgment yet, so the readiness invitation stays reachable", () => {
    const html = render({ showReadiness: true });
    expect(html).toContain('data-testid="brief-strip"');
  });

  it("gives the scout half of the summary its own truncating span, and keeps the readiness half (and its separator) in non-truncating ones", () => {
    // Structural, not content: `render()` has no i18n catalog wired up (see
    // the file-top note), so the readiness text itself is a humanized
    // fallback, not "Ready" — this pins the class split that makes the
    // readiness verdict survive a narrow viewport instead of the text.
    const html = render({ hasProject: true, scoutReport: scoutReport() });

    expect(html).toContain('class="min-w-0 flex-1 truncate"');
    const shrinkSpans = [...html.matchAll(/<span class="shrink-0"[^>]*>/g)];
    expect(shrinkSpans.length).toBeGreaterThan(0);
    for (const [tag] of shrinkSpans) {
      expect(tag).not.toContain("truncate");
    }
  });
});

describe("nextBriefStripOpenState", () => {
  it("expands on the first resolution when there are no rounds yet", () => {
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: null,
        roundsCount: 0,
        currentOpen: false,
      }),
    ).toBe(true);
  });

  it("collapses on the first resolution when a round already exists — never a guess made before that resolution", () => {
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: null,
        roundsCount: 1,
        currentOpen: false,
      }),
    ).toBe(false);
    // Even if some earlier code had left it expanded, the first real
    // resolution overrides that guess.
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: null,
        roundsCount: 1,
        currentOpen: true,
      }),
    ).toBe(false);
  });

  it("collapses live, once, the moment the round count leaves zero", () => {
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: 0,
        roundsCount: 1,
        currentOpen: true,
      }),
    ).toBe(false);
  });

  it("never re-collapses a later round opening, and never re-expands one either — the user's own choice holds", () => {
    // The scenario acceptance non-blocking item (a) asks for: the user
    // re-expanded after round 1 collapsed it, then round 2 opens.
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: 1,
        roundsCount: 2,
        currentOpen: true,
      }),
    ).toBe(true);
    // And the mirror case: still collapsed, round 2 opens — stays collapsed.
    expect(
      nextBriefStripOpenState({
        previousConfirmedCount: 1,
        roundsCount: 2,
        currentOpen: false,
      }),
    ).toBe(false);
  });
});
