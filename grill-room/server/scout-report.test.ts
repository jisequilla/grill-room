import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import createSession from "../actions/create-session.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import { aScoutProjectResult, someProjectServerFacts } from "./interviewer/test-fixtures.js";
import {
  checkCitation,
  clampCitation,
  clampScoutReportCitations,
  latestScoutReport,
  reasonsToRefuseScoutReport,
} from "./scout-report.js";

const repos = useTempGitRepos();

function aRepo(): string {
  return repos.create({
    files: {
      "src/three-lines.ts": "one\ntwo\nthree\n",
      "src/no-trailing-newline.ts": "one\ntwo",
      "src/empty.ts": "",
      "docs/adr/0003-queue.md": Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
      "src/ingest/metrics.ts": Array.from({ length: 30 }, () => "x").join("\n") + "\n",
    },
  });
}

describe("checkCitation", () => {
  it("accepts a line or range within a file", () => {
    const root = aRepo();
    expect(checkCitation(root, "src/three-lines.ts:1")).toBeNull();
    expect(checkCitation(root, "src/three-lines.ts:3")).toBeNull();
    expect(checkCitation(root, "src/three-lines.ts:1-3")).toBeNull();
    expect(checkCitation(root, "src/no-trailing-newline.ts:2")).toBeNull();
  });

  it("refuses a line or range end past the file's last line", () => {
    const root = aRepo();
    expect(checkCitation(root, "src/three-lines.ts:4")).toMatch(/has 3 lines/);
    expect(checkCitation(root, "src/three-lines.ts:2-4")).toMatch(/cites line 4/);
    expect(checkCitation(root, "src/no-trailing-newline.ts:3")).toMatch(/has 2 lines/);
    expect(checkCitation(root, "src/empty.ts:1")).toMatch(/has 0 lines/);
  });

  it("refuses a path that does not exist", () => {
    const root = aRepo();
    expect(checkCitation(root, "src/missing.ts:1")).toMatch(/does not exist/);
  });

  it("refuses a directory", () => {
    const root = aRepo();
    expect(checkCitation(root, "src:1")).toMatch(/not a file/);
  });

  it("refuses a path that escapes the root, lexically or through a symlink", () => {
    const outside = repos.plainFolder({ "secret.txt": "a\nb\n" });
    const root = aRepo();
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "linked.txt"));
    symlinkSync(outside, path.join(root, "linked-dir"));

    expect(checkCitation(root, "../secret.txt:1")).toMatch(/outside the project/);
    expect(checkCitation(root, `${outside}/secret.txt:1`)).toMatch(/outside the project/);
    expect(checkCitation(root, "linked.txt:1")).toMatch(/leads outside the project/);
    expect(checkCitation(root, "linked-dir/secret.txt:1")).toMatch(/leads outside the project/);
  });

  it("accepts a symlink that stays inside the root", () => {
    const root = aRepo();
    mkdirSync(path.join(root, "alias"));
    symlinkSync(path.join(root, "src", "three-lines.ts"), path.join(root, "alias", "three.ts"));
    expect(checkCitation(root, "alias/three.ts:3")).toBeNull();
  });

  it("reads the working tree, not a commit", () => {
    const root = aRepo();
    writeFileSync(path.join(root, "uncommitted.ts"), "a\nb\n");
    expect(checkCitation(root, "uncommitted.ts:2")).toBeNull();
  });

  it("refuses a malformed citation", () => {
    const root = aRepo();
    expect(checkCitation(root, "src/three-lines.ts")).toMatch(/not `path:line`/);
    expect(checkCitation(root, "src/three-lines.ts:3-1")).toMatch(/ends before it starts/);
  });
});

describe("reasonsToRefuseScoutReport", () => {
  it("accepts a report whose citations are all real", () => {
    const root = aRepo();
    expect(
      reasonsToRefuseScoutReport(aScoutProjectResult(), {
        projectRoot: root,
        previousDecisionKeys: [],
      }),
    ).toEqual([]);
  });

  it("refuses a reused proposal key", () => {
    const root = aRepo();
    const [decision] = aScoutProjectResult().proposedDecisions;
    const result = aScoutProjectResult({ proposedDecisions: [decision!, decision!] });
    expect(
      reasonsToRefuseScoutReport(result, { projectRoot: root, previousDecisionKeys: [] }),
    ).toEqual([expect.stringContaining('"no-message-broker" is used more than once')]);
  });

  it("refuses a re-run that leaves a previous decision out", () => {
    const root = aRepo();
    const result = aScoutProjectResult({
      previousDecisions: [{ key: "kept-one", change: "unchanged", statement: null }],
    });
    expect(
      reasonsToRefuseScoutReport(result, {
        projectRoot: root,
        previousDecisionKeys: ["kept-one", "dropped-one"],
      }),
    ).toEqual([expect.stringContaining('previousDecisions is missing "dropped-one"')]);
  });

  it("checks current-state and proposal citations alike", () => {
    const root = aRepo();
    const result = aScoutProjectResult({
      currentState: [{ status: "gap", summary: "Nothing yet.", citations: ["src/gone.ts:1"] }],
    });
    result.proposedDecisions[0]!.citation = "docs/adr/0003-queue.md:10";
    const reasons = reasonsToRefuseScoutReport(result, {
      projectRoot: root,
      previousDecisionKeys: [],
    });
    expect(reasons).toHaveLength(2);
    expect(reasons.join(" ")).toMatch(/src\/gone\.ts, which does not exist/);
    expect(reasons.join(" ")).toMatch(/cites line 10/);
  });

  describe("proposals that cite a superseded source", () => {
    const DECISIONS_FILE = ".scratch/simpler-api-error-responses/decisions.md";
    const ADR_FILE = "docs/adr/003-rfc7807-problem-details.md";

    function aRepoWithSupersededEntry(): string {
      const decisionsMdLines = [
        "# Decisions: Simpler API error responses",
        "",
        "Generated by the Grill Room export from this session's settled design tree.",
        "",
        "## Decisions",
        "",
        '<a id="rfc7807-problem-details-for-all-errors"></a>',
        "### RFC 7807 Problem Details for all error responses",
        "",
        "- **Decision:** The workout complete and uncomplete endpoints return errors as a flat JSON body.",
        "- **Origin:** repo (recorded) · reopened",
        `- **Source:** ${ADR_FILE}:19`,
        '- **Supersedes:** "We will use RFC 7807 Problem Details for all error responses."',
      ];
      return repos.create({
        files: {
          [ADR_FILE]: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
          [DECISIONS_FILE]: decisionsMdLines.join("\n") + "\n",
        },
      });
    }

    it("refuses a proposal citing exactly the superseded source line, naming the entry", () => {
      const root = aRepoWithSupersededEntry();
      const result = aScoutProjectResult({ currentState: [] });
      result.proposedDecisions[0]!.citation = `${ADR_FILE}:19`;

      const reasons = reasonsToRefuseScoutReport(result, {
        projectRoot: root,
        previousDecisionKeys: [],
        decisionFiles: [DECISIONS_FILE],
      });

      expect(reasons).toEqual([
        expect.stringContaining("rfc7807-problem-details-for-all-errors"),
      ]);
      expect(reasons[0]).toContain(DECISIONS_FILE);
      expect(reasons[0]).toContain("RFC 7807 Problem Details for all error responses");
    });

    it("refuses a proposal whose range covers the superseded line", () => {
      const root = aRepoWithSupersededEntry();
      const result = aScoutProjectResult({ currentState: [] });
      result.proposedDecisions[0]!.citation = `${ADR_FILE}:15-19`;

      expect(
        reasonsToRefuseScoutReport(result, {
          projectRoot: root,
          previousDecisionKeys: [],
          decisionFiles: [DECISIONS_FILE],
        }),
      ).toHaveLength(1);
    });

    it("passes a proposal citing a different line of the same source file", () => {
      const root = aRepoWithSupersededEntry();
      const result = aScoutProjectResult({ currentState: [] });
      result.proposedDecisions[0]!.citation = `${ADR_FILE}:5`;

      expect(
        reasonsToRefuseScoutReport(result, {
          projectRoot: root,
          previousDecisionKeys: [],
          decisionFiles: [DECISIONS_FILE],
        }),
      ).toEqual([]);
    });

    it("passes a proposal citing the decisions.md entry itself, not the source it supersedes", () => {
      const root = aRepoWithSupersededEntry();
      const result = aScoutProjectResult({ currentState: [] });
      result.proposedDecisions[0]!.citation = `${DECISIONS_FILE}:7-13`;

      expect(
        reasonsToRefuseScoutReport(result, {
          projectRoot: root,
          previousDecisionKeys: [],
          decisionFiles: [DECISIONS_FILE],
        }),
      ).toEqual([]);
    });

    it("does nothing when decisionFiles is left out", () => {
      const root = aRepoWithSupersededEntry();
      const result = aScoutProjectResult({ currentState: [] });
      result.proposedDecisions[0]!.citation = `${ADR_FILE}:19`;

      expect(
        reasonsToRefuseScoutReport(result, { projectRoot: root, previousDecisionKeys: [] }),
      ).toEqual([]);
    });
  });
});

describe("clampCitation", () => {
  it.each([
    ["src/three-lines.ts:2-60", "src/three-lines.ts:2-3"],
    ["src/three-lines.ts:3-60", "src/three-lines.ts:3"],
    ["src/three-lines.ts:1-3", "src/three-lines.ts:1-3"],
    ["src/three-lines.ts:2-2", "src/three-lines.ts:2-2"],
    ["src/three-lines.ts:2", "src/three-lines.ts:2"],
    ["src/three-lines.ts:60", "src/three-lines.ts:60"],
    ["src/three-lines.ts:4-60", "src/three-lines.ts:4-60"],
    ["src/missing.ts:1-5", "src/missing.ts:1-5"],
    ["src/three-lines.ts:3-1", "src/three-lines.ts:3-1"],
    ["src/three-lines.ts:0", "src/three-lines.ts:0"],
    ["src/three-lines.ts:1-", "src/three-lines.ts:1-"],
    ["src/three-lines.ts", "src/three-lines.ts"],
    ["../outside.ts:1-5", "../outside.ts:1-5"],
    ["src:1-5", "src:1-5"],
    ["src/empty.ts:1-4", "src/empty.ts:1-4"],
  ])("%s becomes %s", (citation, expected) => {
    expect(clampCitation(aRepo(), citation)).toBe(expected);
  });

  it.skipIf(process.getuid?.() === 0)(
    "clampCitation returns an unreadable file's citation unchanged",
    () => {
      const root = repos.create({ files: { "src/unreadable.ts": "one\ntwo\nthree\n" } });
      const file = path.join(root, "src/unreadable.ts");
      chmodSync(file, 0o000);
      try {
        expect(() => readFileSync(file)).toThrow();
        expect(clampCitation(root, "src/unreadable.ts:1-5")).toBe("src/unreadable.ts:1-5");
      } finally {
        chmodSync(file, 0o644);
      }
    },
  );

  it("never throws, even when the project root is missing", () => {
    expect(clampCitation("/does/not/exist", "src/a.ts:1-9")).toBe("src/a.ts:1-9");
  });

  it("leaves every refusal of checkCitation exactly as it was", () => {
    const root = aRepo();
    expect(checkCitation(root, clampCitation(root, "src/three-lines.ts:60"))).toMatch(
      /cites line 60, but src\/three-lines.ts has 3 lines\./,
    );
    expect(checkCitation(root, clampCitation(root, "src/three-lines.ts:4-60"))).toMatch(
      /cites line 60/,
    );
    expect(checkCitation(root, clampCitation(root, "src/empty.ts:1-4"))).toMatch(/has 0 lines/);
    expect(checkCitation(root, clampCitation(root, "src/missing.ts:1-5"))).toMatch(
      /does not exist/,
    );
  });

  it("seam: clampCitation then checkCitation accepts every range the citation rule says is cut", () => {
    const root = aRepo();
    for (const citation of [
      "src/three-lines.ts:2-60",
      "src/three-lines.ts:3-60",
      "src/three-lines.ts:1-4",
      "src/no-trailing-newline.ts:1-9",
      "docs/adr/0003-queue.md:5-10",
    ]) {
      expect(checkCitation(root, clampCitation(root, citation)), citation).toBeNull();
    }
  });
});

describe("clampScoutReportCitations", () => {
  it("clamps every citation without mutating the report", () => {
    const root = aRepo();
    const report = aScoutProjectResult();
    report.currentState[0]!.citations = ["src/three-lines.ts:2-9"];
    report.proposedDecisions[0]!.citation = "docs/adr/0003-queue.md:5-10";

    const clamped = clampScoutReportCitations(report, root);

    expect(clamped.currentState[0]?.citations).toEqual(["src/three-lines.ts:2-3"]);
    expect(clamped.proposedDecisions[0]?.citation).toBe("docs/adr/0003-queue.md:5-9");
    expect(report.currentState[0]?.citations).toEqual(["src/three-lines.ts:2-9"]);
    expect(report.proposedDecisions[0]?.citation).toBe("docs/adr/0003-queue.md:5-10");
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("clampScoutReportCitations on a frozen report", () => {
  it("clampScoutReportCitations returns a new result and leaves a frozen input untouched", () => {
    const root = aRepo();
    const report = aScoutProjectResult();
    report.currentState[0]!.citations = ["src/three-lines.ts:2-9", "src/ingest/metrics.ts:12-40"];
    report.proposedDecisions[0]!.citation = "docs/adr/0003-queue.md:5-10";
    deepFreeze(report);

    const clamped = clampScoutReportCitations(report, root);

    expect(clamped).not.toBe(report);
    expect(clamped.currentState[0]?.citations).toEqual([
      "src/three-lines.ts:2-3",
      "src/ingest/metrics.ts:12-30",
    ]);
    expect(clamped.proposedDecisions[0]?.citation).toBe("docs/adr/0003-queue.md:5-9");
    expect(report.proposedDecisions[0]?.citation).toBe("docs/adr/0003-queue.md:5-10");
  });
});

describe("a scout report stored before adrConvention", () => {
  useTestDatabase();

  it("reads a report stored before adrConvention as null", async () => {
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
    });
    const { adrConvention: _omitted, ...oldFacts } = someProjectServerFacts({
      adrConvention: {
        folder: "docs/adr",
        numbering: null,
        template: null,
      },
    });
    expect("adrConvention" in oldFacts).toBe(false);
    await getDb()
      .insert(schema.scoutReports)
      .values({
        id: "report-old",
        sessionId: session.id,
        projectId: null,
        factsJson: JSON.stringify(oldFacts),
        resultJson: JSON.stringify(aScoutProjectResult()),
        commitRead: null,
        ideaRead: "An idea",
        model: "sonnet",
        ranAt: "2026-01-01T00:00:00.000Z",
        turnId: null,
        dispositionsJson: "{}",
      });

    const report = await latestScoutReport(session.id);

    expect(report).not.toBeNull();
    expect(report?.facts.adrConvention).toBeNull();
  });
});
