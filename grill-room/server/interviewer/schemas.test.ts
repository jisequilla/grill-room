import { describe, expect, it } from "vitest";

import {
  citation,
  jsonSchemaFor,
  MAX_SCOUT_CURRENT_STATE,
  MAX_SCOUT_PROPOSED_DECISIONS,
  scoutProjectResultSchema,
} from "./schemas.js";
import { aScoutProjectResult } from "./test-fixtures.js";

const aStateItem = aScoutProjectResult().currentState[0];
const aProposal = aScoutProjectResult().proposedDecisions[0];

describe("a scout report's citations", () => {
  it.each([
    "src/server.ts:42",
    "docs/adr/0003-queue.md:5-12",
    "CLAUDE.md:1",
    "a folder/with spaces.md:3-3",
    ".claude/rules/worktrees.md:10",
  ])("accepts %s", (value) => {
    expect(citation.safeParse(value).success).toBe(true);
  });

  it.each([
    ["no line", "src/server.ts"],
    ["an empty line", "src/server.ts:"],
    ["line zero", "src/server.ts:0"],
    ["a word for a line", "src/server.ts:top"],
    ["a column", "src/server.ts:4:2"],
    ["an open range", "src/server.ts:4-"],
    ["a backwards range", "src/server.ts:12-5"],
    ["no path", ":12"],
    ["an absolute path", "/etc/passwd:1"],
    ["a home path", "~/.ssh/config:1"],
    ["a drive path", "C:\\repo\\a.ts:1"],
    ["a path out of the repo", "../other/a.ts:1"],
    ["a path stepping out midway", "src/../../a.ts:1"],
    ["surrounding whitespace", " src/a.ts:1"],
    ["two citations in one", "src/a.ts:1, src/b.ts:2"],
  ])("rejects %s", (_label, value) => {
    expect(citation.safeParse(value).success).toBe(false);
  });
});

describe("the scout report schema", () => {
  it("accepts a first-run report", () => {
    expect(scoutProjectResultSchema.safeParse(aScoutProjectResult()).success).toBe(
      true,
    );
  });

  it("accepts a re-run report with a verdict on each previous decision", () => {
    const report = aScoutProjectResult({
      previousDecisions: [
        { key: "no-message-broker", change: "unchanged", statement: null },
        { key: "one-region", change: "changed", statement: "Two regions now." },
        { key: "cron-jobs", change: "removed", statement: null },
      ],
    });

    expect(scoutProjectResultSchema.safeParse(report).success).toBe(true);
  });

  it(`accepts ${MAX_SCOUT_CURRENT_STATE} current-state items and rejects one more`, () => {
    const atLimit = aScoutProjectResult({
      currentState: Array.from({ length: MAX_SCOUT_CURRENT_STATE }, () => aStateItem),
    });
    const overLimit = aScoutProjectResult({
      currentState: [...atLimit.currentState, aStateItem],
    });

    expect(scoutProjectResultSchema.safeParse(atLimit).success).toBe(true);
    expect(scoutProjectResultSchema.safeParse(overLimit).success).toBe(false);
  });

  it(`accepts ${MAX_SCOUT_PROPOSED_DECISIONS} proposed decisions and rejects one more`, () => {
    const proposals = Array.from(
      { length: MAX_SCOUT_PROPOSED_DECISIONS + 1 },
      (_, index) => ({ ...aProposal, key: `decision-${index}` }),
    );

    expect(
      scoutProjectResultSchema.safeParse(
        aScoutProjectResult({ proposedDecisions: proposals.slice(0, -1) }),
      ).success,
    ).toBe(true);
    expect(
      scoutProjectResultSchema.safeParse(
        aScoutProjectResult({ proposedDecisions: proposals }),
      ).success,
    ).toBe(false);
  });

  it("rejects a malformed citation on a current-state item", () => {
    const report = aScoutProjectResult({
      currentState: [{ ...aStateItem, citations: ["src/ingest/metrics.ts"] }],
    });

    expect(scoutProjectResultSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a current-state item that cites nothing", () => {
    const report = aScoutProjectResult({
      currentState: [{ ...aStateItem, citations: [] }],
    });

    expect(scoutProjectResultSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a malformed citation on a proposed decision", () => {
    const report = aScoutProjectResult({
      proposedDecisions: [{ ...aProposal, citation: "/abs/adr.md:3" }],
    });

    expect(scoutProjectResultSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a status, source or change outside its set", () => {
    for (const report of [
      { ...aScoutProjectResult(), currentState: [{ ...aStateItem, status: "done" }] },
      { ...aScoutProjectResult(), proposedDecisions: [{ ...aProposal, source: "guessed" }] },
      {
        ...aScoutProjectResult(),
        previousDecisions: [{ key: "a", change: "renamed", statement: null }],
      },
    ]) {
      expect(scoutProjectResultSchema.safeParse(report).success).toBe(false);
    }
  });

  it("rejects fields it does not define, and missing ones", () => {
    const { previousDecisions: _dropped, ...missing } = aScoutProjectResult();

    expect(
      scoutProjectResultSchema.safeParse({ ...aScoutProjectResult(), extra: 1 })
        .success,
    ).toBe(false);
    expect(scoutProjectResultSchema.safeParse(missing).success).toBe(false);
  });

  it("hands the command line the limits and the citation shape", () => {
    const schema = jsonSchemaFor("scout-project") as {
      properties: Record<string, { maxItems?: number; items: unknown }>;
    };

    expect(schema.properties.currentState.maxItems).toBe(MAX_SCOUT_CURRENT_STATE);
    expect(schema.properties.proposedDecisions.maxItems).toBe(
      MAX_SCOUT_PROPOSED_DECISIONS,
    );
    expect(JSON.stringify(schema)).toContain('"pattern"');
  });
});
