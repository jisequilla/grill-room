import { describe, expect, it } from "vitest";

import {
  breakIntoTicketsResultSchema,
  CITATION_PATTERN,
  citation,
  handoffScoutContractSchema,
  handoffScoutResultSchema,
  type HandoffScoutResult,
  jsonSchemaFor,
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_BUILDS_ON_FILES,
  MAX_HANDOFF_SCOUT_FACTS,
  MAX_HANDOFF_SCOUT_FILES_TO_CHANGE,
  MAX_HANDOFF_SCOUT_REACH,
  MAX_HANDOFF_SCOUT_RULES,
  MAX_HANDOFF_SCOUT_TICKETS,
  MAX_SCOUT_CURRENT_STATE,
  MAX_SCOUT_PROPOSED_DECISIONS,
  proposeRoundResultSchema,
  scoutProjectResultSchema,
  staysInsideRepo,
} from "./schemas.js";
import { aHandoffScoutResult, aScoutProjectResult, NO_DELEGATION_PROPOSALS } from "./test-fixtures.js";

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

describe("a citation with one leading slash", () => {
  it.each([
    ["/.claude/rules/worktrees.md:86", true, ".claude/rules/worktrees.md:86"],
    ["/src/server.ts:4-9", true, "src/server.ts:4-9"],
    ["/etc/passwd:1", true, "etc/passwd:1"],
    ["src/server.ts:42", true, "src/server.ts:42"],
    ["//etc/passwd:1", false, undefined],
    ["/../other/a.ts:1", false, undefined],
    ["/~/.ssh/config:1", false, undefined],
    ["/:12", false, undefined],
    [" /src/a.ts:1", false, undefined],
    ["/src/a.ts", false, undefined],
  ])("reads %s as success %s with data %s", (value, success, data) => {
    const result = citation.safeParse(value);

    expect(result.success).toBe(success);
    if (result.success) expect(result.data).toBe(data);
  });

  it("keeps the citation pattern in the command line's schema", () => {
    const plain = { type: "string", pattern: CITATION_PATTERN.source };
    const schema = jsonSchemaFor("scout-project") as {
      properties: {
        currentState: { items: { properties: { citations: { items: unknown } } } };
        proposedDecisions: { items: { properties: { citation: unknown } } };
      };
    };

    expect(schema.properties.currentState.items.properties.citations.items).toEqual(plain);
    expect(schema.properties.proposedDecisions.items.properties.citation).toEqual(plain);
    expect(() => jsonSchemaFor("assess-readiness")).not.toThrow();
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
      proposedDecisions: [{ ...aProposal, citation: "//abs/adr.md:3" }],
    });

    expect(scoutProjectResultSchema.safeParse(report).success).toBe(false);
  });

  it("reads a proposed decision's leading-slash citation as repo-relative", () => {
    const report = aScoutProjectResult({
      currentState: [{ ...aStateItem, citations: ["/src/a.ts:1"] }],
      proposedDecisions: [{ ...aProposal, citation: "/abs/adr.md:3" }],
    });

    const parsed = scoutProjectResultSchema.safeParse(report);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.proposedDecisions[0]!.citation).toBe("abs/adr.md:3");
      expect(parsed.data.currentState[0]!.citations).toEqual(["src/a.ts:1"]);
    }
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
  return { delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [ticket, aBlockedTicket] };
}

/** The result with its blocked ticket's one dependency replaced by `dependency`. */
function withDependency(dependency: Record<string, unknown>) {
  return {
    delegationProposals: NO_DELEGATION_PROPOSALS,
    tickets: [aGroundedTicket, { ...aBlockedTicket, buildsOn: [dependency] }],
  };
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

  it("a stored grounding without rulesRead parses, the validator accepts rulesRead, and the contract has no rulesRead key", () => {
    const stored = { delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [aGroundedTicket] };
    expect(handoffScoutResultSchema.parse(stored).rulesRead).toBeUndefined();
    expect(handoffScoutResultSchema.parse({ ...stored, rulesRead: true }).rulesRead).toBe(true);
    expect(handoffScoutResultSchema.parse({ ...stored, rulesRead: false }).rulesRead).toBe(false);
    expect(accepts({ ...stored, rulesRead: "yes" })).toBe(false);
    expect(Object.keys(handoffScoutContractSchema.shape)).not.toContain("rulesRead");
    expect(contractAccepts({ ...stored, rulesRead: true })).toBe(false);
  });

  it("reads a grounding stored before reach as an empty reach", () => {
    const { reach: _reach, ...stored } = aGroundedTicket!;
    const parsed = handoffScoutResultSchema.parse({ tickets: [stored] });

    expect(parsed.tickets[0]!.reach).toEqual([]);
  });

  it("requires reach in the contract and leaves its count to the app", () => {
    const { reach: _reach, ...withoutReach } = aGroundedTicket!;
    const reaching = (reach: unknown) => ({
      delegationProposals: NO_DELEGATION_PROPOSALS,
      tickets: [{ ...aGroundedTicket, reach }],
    });

    expect(contractAccepts({ tickets: [withoutReach] })).toBe(false);
    expect(contractAccepts(reaching([{ symbol: "exportFolder" }]))).toBe(true);
    expect(contractAccepts(reaching([{ symbol: "exportFolder", files: 37 }]))).toBe(false);
    expect(contractAccepts(reaching([{ symbol: "" }]))).toBe(false);
    expect(contractAccepts(reaching(Array.from({ length: MAX_HANDOFF_SCOUT_REACH + 1 }, () => ({ symbol: "a" }))))).toBe(
      false,
    );
    expect(accepts(reaching([{ symbol: "exportFolder", files: 37 }]))).toBe(true);
    expect(accepts(reaching([{ symbol: "exportFolder" }]))).toBe(true);
    expect(accepts(reaching([{ symbol: "" }]))).toBe(false);
    expect(accepts(reaching([{ symbol: "a", files: -1 }]))).toBe(false);
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

  it("lets provedBy.testPath be null, never empty, while command stays required text", () => {
    const untested = { ...aGroundedTicket, provedBy: { testPath: null, command: "go build ./..." } };

    expect(accepts(withTicket(untested))).toBe(true);
    expect(contractAccepts(withTicket(untested))).toBe(true);
    expect(accepts(withTicket({ ...aGroundedTicket, provedBy: { testPath: null, command: null } }))).toBe(false);
    expect(accepts(withTicket({ ...aGroundedTicket, provedBy: { testPath: null } }))).toBe(false);
    expect(accepts(withTicket({ ...aGroundedTicket, provedBy: { command: "go build ./..." } }))).toBe(false);
    // A grounding stored before testPath could be null still reads.
    expect(accepts(aHandoffScoutResult())).toBe(true);
  });

  it("hands the command line a required, nullable testPath and a required command", () => {
    const schema = jsonSchemaFor("handoff-scout") as {
      properties: {
        tickets: {
          items: {
            properties: {
              provedBy: {
                required: string[];
                properties: Record<string, unknown>;
              };
            };
          };
        };
      };
    };
    const provedBy = schema.properties.tickets.items.properties.provedBy;

    expect(provedBy.required).toEqual(["testPath", "command"]);
    expect(provedBy.properties.testPath).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
    expect(provedBy.properties.command).toEqual({ type: "string", minLength: 1 });
  });

  it("leaves the project scout's citation rules in its schema", () => {
    const outside = {
      ...aScoutProjectResult(),
      proposedDecisions: [{ ...aProposal, citation: "../elsewhere.md:1" }],
    };

    expect(scoutProjectResultSchema.safeParse(outside).success).toBe(false);
  });
});

describe("break-into-tickets: kind and waitsFor default, and the CLI schema requires them", () => {
  it("parses a ticket with neither field as a build that waits for nothing", () => {
    const parsed = breakIntoTicketsResultSchema.parse({
      tickets: [{ number: 1, slug: "a-ticket", title: "A ticket", body: "", blockedBy: [] }],
    });

    expect(parsed.tickets[0]).toMatchObject({ kind: "build", waitsFor: null });
  });

  it("parses a gate with what it waits for", () => {
    const parsed = breakIntoTicketsResultSchema.parse({
      tickets: [
        {
          number: 1,
          slug: "payment-account",
          title: "Payment account is live",
          body: "",
          blockedBy: [],
          kind: "gate",
          waitsFor: "A live account on the payment platform, with API keys issued.",
        },
      ],
    });

    expect(parsed.tickets[0]).toMatchObject({
      kind: "gate",
      waitsFor: "A live account on the payment platform, with API keys issued.",
    });
  });

  it("lists both as required properties of a ticket in the schema the command line receives", () => {
    const schema = jsonSchemaFor("break-into-tickets") as {
      properties: {
        tickets: { items: { required: string[]; properties: Record<string, unknown> } };
      };
    };
    const ticket = schema.properties.tickets.items;

    expect(ticket.required).toEqual(expect.arrayContaining(["kind", "waitsFor"]));
    expect(ticket.properties.kind).toMatchObject({ enum: ["build", "gate"] });
  });
});

const aRule = {
  citation: ".claude/rules/versioning.md:3-8",
  statement: "A change under web/ bumps VERSION.",
  requiredFiles: ["web/package.json"],
};

const allProposals = {
  maxTicketsInFlight: { value: 3, citation: "CLAUDE.md:12" },
  pruneCommand: { command: "just prune-worktrees", citation: "CLAUDE.md:30" },
  reviewRule: { citation: ".claude/rules/worktrees.md:5-9" },
  preflight: { citation: ".claude/rules/worktrees.md:20" },
};

function withRules(rules: unknown[], twoLensReview: unknown = null, delegationProposals: unknown = NO_DELEGATION_PROPOSALS) {
  return {
    delegationProposals,
    tickets: [{ ...aGroundedTicket, rules, twoLensReview }, aBlockedTicket],
  };
}

describe("the handoff scout schema: rules, two-lens flag and delegation proposals", () => {
  it("reads a stored grounding with none of the new fields, with empty rules and null flags and proposals", () => {
    const { rules: _rules, twoLensReview: _flag, ...oldTicket } = aGroundedTicket!;
    const { rules: _r2, twoLensReview: _f2, ...oldBlocked } = aBlockedTicket!;
    const parsed = handoffScoutResultSchema.parse({ tickets: [oldTicket, oldBlocked] });

    for (const ticket of parsed.tickets) {
      expect(ticket.rules).toEqual([]);
      expect(ticket.twoLensReview).toBeNull();
    }
    expect(parsed.delegationProposals).toEqual({
      maxTicketsInFlight: null,
      pruneCommand: null,
      reviewRule: null,
      preflight: null,
    });
  });

  it("accepts a rule with required files", () => {
    expect(accepts(withRules([aRule]))).toBe(true);
  });

  it("accepts a rule with requiredFiles: []", () => {
    expect(accepts(withRules([{ ...aRule, requiredFiles: [] }]))).toBe(true);
  });

  it("refuses maxTicketsInFlight out of range", () => {
    expect(
      accepts(withRules([], null, { ...allProposals, maxTicketsInFlight: { value: 11, citation: "a.md:1" } })),
    ).toBe(false);
    expect(
      accepts(withRules([], null, { ...allProposals, maxTicketsInFlight: { value: 0, citation: "a.md:1" } })),
    ).toBe(false);
  });

  it("refuses a rule entry with an extra key", () => {
    expect(accepts(withRules([{ ...aRule, extra: 1 }]))).toBe(false);
  });

  it("fills the missing proposal slots with null when only one is given", () => {
    const parsed = handoffScoutResultSchema.parse(
      withRules([], null, { maxTicketsInFlight: null }),
    );

    expect(parsed.delegationProposals).toEqual({
      maxTicketsInFlight: null,
      pruneCommand: null,
      reviewRule: null,
      preflight: null,
    });
  });

  it("requires every new field in the contract", () => {
    const { rules: _rules, ...withoutRules } = aGroundedTicket!;
    const { twoLensReview: _flag, ...withoutFlag } = aGroundedTicket!;
    const { delegationProposals: _dp, ...withoutProposals } = withRules([]);

    expect(contractAccepts({ delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [withoutRules, aBlockedTicket] })).toBe(false);
    expect(contractAccepts({ delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [withoutFlag, aBlockedTicket] })).toBe(false);
    expect(contractAccepts(withoutProposals)).toBe(false);
    expect(contractAccepts(withRules([aRule]))).toBe(true);
  });

  it("holds the contract's rule list to its cap and its citations to the citation pattern", () => {
    expect(contractAccepts(withRules(Array.from({ length: MAX_HANDOFF_SCOUT_RULES }, () => aRule)))).toBe(true);
    expect(contractAccepts(withRules(Array.from({ length: MAX_HANDOFF_SCOUT_RULES + 1 }, () => aRule)))).toBe(false);
    expect(contractAccepts(withRules([{ ...aRule, citation: "the versioning rule" }]))).toBe(false);
  });

  it("seam: every rules, two-lens and proposal shape the handoff prompt describes passes the contract and the validator", () => {
    const shapes = [
      withRules([aRule]),
      withRules([{ ...aRule, requiredFiles: [] }]),
      withRules([], null),
      withRules([], { citation: ".claude/rules/worktrees.md:40" }),
      withRules([], null, NO_DELEGATION_PROPOSALS),
      withRules([], null, allProposals),
    ];

    for (const shape of shapes) {
      expect(contractAccepts(shape)).toBe(true);
      expect(accepts(shape)).toBe(true);
    }
  });

  it("types each delegation proposal slot, so a consumer reads it without a cast", () => {
    const proposals = aHandoffScoutResult().delegationProposals;
    const inFlight: number | undefined = proposals.maxTicketsInFlight?.value;
    const prune: string | undefined = proposals.pruneCommand?.command;
    const rule: string | undefined = proposals.reviewRule?.citation;
    // @ts-expect-error a number is not a prune slot
    const bad: HandoffScoutResult["delegationProposals"]["pruneCommand"] = 42;
    expect([inFlight, prune, rule, bad]).toBeDefined();
  });
});

describe("the round contract: ADR-worthy flag and Consequences", () => {
  const entry = {
    key: "storage",
    title: "Where is data stored?",
    body: "",
    choices: [],
    recommendedChoice: null,
    recommendedAnswer: "",
    dependsOn: [],
    ask: true,
  };

  it("a round reply without adrWorthy or consequences parses as unflagged", () => {
    const parsed = proposeRoundResultSchema.parse({
      proposedDecisions: [entry],
      pushBackResponses: [],
      userDecisionPlacements: [{ ...entry, key: "added" }],
      done: null,
    });

    for (const decision of [...parsed.proposedDecisions, ...parsed.userDecisionPlacements]) {
      expect(decision).toMatchObject({ adrWorthy: false, consequences: null });
    }
  });

  it("the round contract requires adrWorthy and consequences", () => {
    const schema = jsonSchemaFor("propose-round") as {
      properties: Record<
        "proposedDecisions" | "userDecisionPlacements",
        { items: { required: string[]; properties: { consequences: { type: unknown } } } }
      >;
    };

    for (const list of [schema.properties.proposedDecisions, schema.properties.userDecisionPlacements]) {
      expect(list.items.required).toEqual(expect.arrayContaining(["adrWorthy", "consequences"]));
      expect(list.items.properties.consequences.type).toEqual(["string", "null"]);
    }
  });
});
