import { describe, expect, it } from "vitest";

import {
  citation,
  handoffScoutContractSchema,
  handoffScoutResultSchema,
  jsonSchemaFor,
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_BUILDS_ON_FILES,
  MAX_HANDOFF_SCOUT_FACTS,
  MAX_HANDOFF_SCOUT_FILES_TO_CHANGE,
  MAX_HANDOFF_SCOUT_TICKETS,
  MAX_SCOUT_CURRENT_STATE,
  MAX_SCOUT_PROPOSED_DECISIONS,
  scoutProjectResultSchema,
  staysInsideRepo,
} from "./schemas.js";
import { aHandoffScoutResult, aScoutProjectResult } from "./test-fixtures.js";

const aStateItem = aScoutProjectResult().currentState[0];
const aProposal = aScoutProjectResult().proposedDecisions[0];

describe("a scout report's citations", () => {
  it.each([
    "src/server.ts:42",
    "docs/adr/0003-queue.md:5-12",
    "CLAUDE.md:1",
    "a folder/with spaces.md:3-3",
    ".claude/rules/worktrees.md:10",
    "a/index.ts:1",
    "ab/x.ts:1",
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

const [aGroundedTicket, aBlockedTicket] = aHandoffScoutResult().tickets;
const aDependency = aBlockedTicket!.buildsOn[0]!;

/** The result with its first ticket replaced by `ticket`. */
function withTicket(ticket: Record<string, unknown>) {
  return { tickets: [ticket, aBlockedTicket] };
}

/** The result with its blocked ticket's one dependency replaced by `dependency`. */
function withDependency(dependency: Record<string, unknown>) {
  return { tickets: [aGroundedTicket, { ...aBlockedTicket, buildsOn: [dependency] }] };
}

function accepts(result: unknown): boolean {
  return handoffScoutResultSchema.safeParse(result).success;
}

function contractAccepts(result: unknown): boolean {
  return handoffScoutContractSchema.safeParse(result).success;
}

const aCitedDependency = { ...aDependency, citation: "src/ingest/metrics.ts:12", createdPath: null };
const anEditedDependency = {
  ...aDependency,
  createdPath: null,
  editedPath: "src/ingest/metrics.ts",
  symbol: "LAG_ALERT_THRESHOLD",
};

describe("a handoff scout's paths", () => {
  it.each([
    "src/ingest/lag-alert.ts",
    "e2e/scenario.spec.ts",
    ".claude/rules/x.md",
    "a/index.ts",
    "ab/x.ts",
  ])("stay inside the repository: %s", (value) => {
    expect(staysInsideRepo(value)).toBe(true);
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a home path", "~/.ssh/config"],
    ["a drive path", "C:\\repo\\a.ts"],
    ["a drive path with a forward slash", "C:/x"],
    ["a lowercase drive path", "c:\\x"],
    ["a path out of the repo", "../other/a.ts"],
    ["a path stepping out midway", "src/../../a.ts"],
    ["surrounding whitespace", " src/a.ts"],
  ])("leave it: %s", (_label, value) => {
    expect(staysInsideRepo(value)).toBe(false);
  });
});

describe("the handoff scout schema", () => {
  it("accepts every form of dependency", () => {
    for (const dependency of [aDependency, aCitedDependency, anEditedDependency]) {
      expect(accepts(withDependency(dependency))).toBe(true);
      expect(contractAccepts(withDependency(dependency))).toBe(true);
    }
  });

  it("reads a dependency stored before the edit form, with no editedPath or symbol", () => {
    const { editedPath: _editedPath, symbol: _symbol, ...stored } = aDependency;
    const parsed = handoffScoutResultSchema.parse(withDependency(stored));

    expect(parsed.tickets[1]!.buildsOn[0]).toMatchObject({ editedPath: null, symbol: null });
  });

  it("accepts an empty grounding, facts and dependencies", () => {
    expect(accepts({ tickets: [] })).toBe(true);
    expect(accepts(withTicket({ ...aGroundedTicket, facts: [], buildsOn: [], buildsOnFiles: [] }))).toBe(true);
  });

  it("leaves a dependency's form to the app, which refuses and retries, while the contract holds the model to one", () => {
    for (const dependency of [
      { ...aDependency, citation: "src/ingest/metrics.ts:12" },
      { ...aDependency, createdPath: null },
      { ...anEditedDependency, symbol: null },
      { ...aDependency, symbol: "lagAlert" },
    ]) {
      expect(accepts(withDependency(dependency))).toBe(true);
      expect(contractAccepts(withDependency(dependency))).toBe(false);
    }
  });

  it("leaves paths and citations that leave the repository to the app", () => {
    for (const ticket of [
      { ...aGroundedTicket, filesToChange: [{ path: "../a.ts", change: "create" }] },
      { ...aGroundedTicket, buildsOnFiles: ["/etc/passwd:1"] },
      { ...aGroundedTicket, provedBy: { testPath: "/tmp/a.test.ts", command: "npm test" } },
    ]) {
      expect(accepts(withTicket(ticket))).toBe(true);
    }
  });

  it("holds the model to the citation shape, and leaves it to the app", () => {
    const ticket = { ...aGroundedTicket, facts: [{ statement: "A fact.", citation: "src/a.ts" }] };

    expect(accepts(withTicket(ticket))).toBe(true);
    expect(contractAccepts(withTicket(ticket))).toBe(false);
  });

  it("accepts a ticket that changes no files", () => {
    expect(accepts(withTicket({ ...aGroundedTicket, filesToChange: [] }))).toBe(true);
  });

  it("rejects a change that is neither create nor edit", () => {
    expect(
      accepts(
        withTicket({
          ...aGroundedTicket,
          filesToChange: [{ path: "src/a.ts", change: "delete" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a ticket number that is not a positive integer", () => {
    for (const number of [0, -1, 1.5]) {
      expect(accepts(withTicket({ ...aGroundedTicket, number }))).toBe(false);
    }
    expect(accepts(withDependency({ ...aDependency, blocker: 0 }))).toBe(false);
  });

  it("rejects empty text where text is required", () => {
    for (const ticket of [
      { ...aGroundedTicket, facts: [{ statement: "", citation: "src/a.ts:1" }] },
      { ...aGroundedTicket, provedBy: { testPath: "src/a.test.ts", command: "" } },
      { ...aGroundedTicket, provedBy: { testPath: "", command: "npm test" } },
    ]) {
      expect(accepts(withTicket(ticket))).toBe(false);
    }
    for (const dependency of [
      { ...aDependency, provides: "" },
      { ...aDependency, check: "" },
      { ...anEditedDependency, symbol: "" },
    ]) {
      expect(accepts(withDependency(dependency))).toBe(false);
    }
  });

  it("holds every list to its bound", () => {
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        path: `src/file-${index}.ts`,
        change: "create" as const,
      }));
    const citations = (count: number) =>
      Array.from({ length: count }, (_, index) => `src/a.ts:${index + 1}`);
    const facts = (count: number) =>
      citations(count).map((cited) => ({ statement: "A fact.", citation: cited }));
    const dependencies = (count: number) =>
      Array.from({ length: count }, () => aDependency);
    const tickets = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...aGroundedTicket, number: index + 1 }));

    const cases: [string, number, (count: number) => unknown][] = [
      ["filesToChange", MAX_HANDOFF_SCOUT_FILES_TO_CHANGE, (n) => withTicket({ ...aGroundedTicket, filesToChange: files(n) })],
      ["buildsOnFiles", MAX_HANDOFF_SCOUT_BUILDS_ON_FILES, (n) => withTicket({ ...aGroundedTicket, buildsOnFiles: citations(n) })],
      ["facts", MAX_HANDOFF_SCOUT_FACTS, (n) => withTicket({ ...aGroundedTicket, facts: facts(n) })],
      ["buildsOn", MAX_HANDOFF_SCOUT_BUILDS_ON, (n) => withTicket({ ...aGroundedTicket, buildsOn: dependencies(n) })],
      ["tickets", MAX_HANDOFF_SCOUT_TICKETS, (n) => ({ tickets: tickets(n) })],
    ];
    for (const [label, limit, build] of cases) {
      expect(accepts(build(limit)), `${label} at its limit`).toBe(true);
      expect(accepts(build(limit + 1)), `${label} over its limit`).toBe(false);
    }
  });

  it("rejects fields it does not define, and missing ones", () => {
    expect(accepts({ ...aHandoffScoutResult(), extra: 1 })).toBe(false);
    expect(accepts(withTicket({ ...aGroundedTicket, extra: 1 }))).toBe(false);
    expect(accepts(withDependency({ ...aDependency, extra: 1 }))).toBe(false);
    expect(accepts({})).toBe(false);
    for (const field of ["number", "filesToChange", "buildsOnFiles", "facts", "buildsOn", "provedBy"]) {
      const { [field]: _dropped, ...missing } = aGroundedTicket as Record<string, unknown>;
      expect(accepts(withTicket(missing)), field).toBe(false);
    }
    for (const field of ["blocker", "provides", "citation", "createdPath", "check"]) {
      const { [field]: _dropped, ...missing } = aDependency as Record<string, unknown>;
      expect(accepts(withDependency(missing)), field).toBe(false);
    }
  });

  it("hands the command line the limits, the citation shape and the three dependency forms", () => {
    const schema = jsonSchemaFor("handoff-scout") as {
      properties: {
        tickets: {
          maxItems?: number;
          items: {
            properties: Record<
              string,
              { maxItems?: number; minItems?: number; items?: { anyOf?: { properties: Record<string, { type?: string }> }[] } }
            >;
          };
        };
      };
    };
    const ticket = schema.properties.tickets.items.properties;

    expect(schema.properties.tickets.maxItems).toBe(MAX_HANDOFF_SCOUT_TICKETS);
    expect(ticket.filesToChange!.minItems).toBeUndefined();
    expect(ticket.filesToChange!.maxItems).toBe(MAX_HANDOFF_SCOUT_FILES_TO_CHANGE);
    expect(ticket.buildsOnFiles!.maxItems).toBe(MAX_HANDOFF_SCOUT_BUILDS_ON_FILES);
    expect(ticket.facts!.maxItems).toBe(MAX_HANDOFF_SCOUT_FACTS);
    expect(ticket.buildsOn!.maxItems).toBe(MAX_HANDOFF_SCOUT_BUILDS_ON);
    expect(JSON.stringify(schema)).toContain('"pattern"');

    const forms = ticket.buildsOn!.items!.anyOf!;
    const setFields = forms.map((form) =>
      ["citation", "createdPath", "editedPath", "symbol"].filter(
        (field) => form.properties[field]!.type !== "null",
      ),
    );
    expect(setFields).toEqual([["citation"], ["createdPath"], ["editedPath", "symbol"]]);
  });

  it("leaves the project scout's citation rules in its schema", () => {
    const outside = {
      ...aScoutProjectResult(),
      proposedDecisions: [{ ...aProposal, citation: "../elsewhere.md:1" }],
    };

    expect(scoutProjectResultSchema.safeParse(outside).success).toBe(false);
  });
});
