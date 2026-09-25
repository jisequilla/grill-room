import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { aScoutProjectResult } from "./interviewer/test-fixtures.js";
import { checkCitation, reasonsToRefuseScoutReport } from "./scout-report.js";

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
