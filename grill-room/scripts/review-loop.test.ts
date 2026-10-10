import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT = readFileSync(
  new URL("../../.claude/workflows/ticket-build-review-loop.js", import.meta.url),
  "utf8",
).replace("export const meta =", "const meta =");

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

interface Call {
  prompt: string;
  opts: any;
}
type Canned = unknown | unknown[] | ((n: number) => unknown);

const MUTATE_TEXT = (branch: string) =>
  [
    `You run one mutation-testing command for PR branch ${branch} and return its summary. You change no file, commit nothing and never use port 8082.`,
    `1. Run \`git fetch origin main ${branch}\`, then \`git checkout --detach origin/${branch}\`.`,
    "2. Run `cd grill-room && pnpm install --frozen-lockfile --prefer-offline`.",
    "3. From grill-room/, run `pnpm test:mutate --base origin/main` with the Bash tool's run_in_background, and wait for its completion notice. Never poll with sleep: the run can take longer than a foreground Bash call allows.",
    "4. Read grill-room/.scratch/mutation/summary.json and return its status, mutants, score, survivors, elapsedMs and dropped unchanged, with blocked null.",
    "If any step fails, return blocked with the exact command and its error, status runner-failed, and null or empty values for the rest.",
  ].join("\n");

const ONE_OF_SEVERAL =
  "\n\nYou are one of several reviewers, each with its own lens. Do not run gh pr ready; the main session marks the PR ready once every lens approves.";
const FIX_NOT_SETTLED =
  "\n\nYour previous result was not final: it had no commit and no PR-body edit, or its verification said a command was still running. Run every verify command in the foreground, wait for each to finish, and report only then.";

const OK_MUTATION = {
  status: "ok",
  mutants: 0,
  score: null,
  survivors: [],
  elapsedMs: 5000,
  dropped: [],
  blocked: null,
};
const OK_MUTATION_TEXT = (round: number) =>
  `Mutation run (round ${round}): ok, 0 mutants, score n/a, 5 s, 0 survivors.`;

const finding = (level: string, file: string, over: Record<string, unknown> = {}) => ({
  level,
  file,
  line: 10,
  claim: `${level} in ${file}`,
  evidence: `check ${file}`,
  equivalentMutant: null,
  ...over,
});
const verdict = (v: string, findings: unknown[] = []) => ({ verdict: v, findings, blocked: null });
const FIX_OK = { commit: "abc", bodyEdited: false, verification: "all passed", note: null, blocked: null };

async function run(opts: {
  reviewers?: string[];
  start?: Record<string, unknown> | undefined;
  canned?: Record<string, Canned>;
  mutation?: unknown;
  builder?: unknown;
}) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const canned = opts.canned ?? {};
  const agent = async (prompt: string, o: any) => {
    calls.push({ prompt, opts: o });
    const n = (counts[o.label] = (counts[o.label] ?? 0) + 1);
    if (o.label.startsWith("mutate:") && !(o.label in canned)) {
      return "mutation" in opts ? opts.mutation : OK_MUTATION;
    }
    if (o.label.startsWith("build:") && !(o.label in canned)) return opts.builder;
    if (!(o.label in canned)) throw new Error(`no canned result for ${o.label}`);
    const value = canned[o.label];
    if (typeof value === "function") return (value as (n: number) => unknown)(n);
    if (Array.isArray(value)) return value[n - 1];
    return value;
  };
  const parallel = (thunks: Array<() => unknown>) => Promise.all(thunks.map((t) => t()));
  const pipeline = async (items: unknown[], ...stages: Array<(...a: any[]) => unknown>) =>
    Promise.all(
      items.map(async (item, index) => {
        let previous: unknown = item;
        for (const stage of stages) previous = await stage(previous, item, index);
        return previous;
      }),
    );
  const ticket = {
    bead: "gr-x",
    builder: "BUILD",
    reviewers: opts.reviewers ?? ["M:{{mutation}}|{{prior_round}}"],
    fix: "FIX {{findings}}",
    start: "start" in opts ? opts.start : { pr: 7, branch: "worktree-x", stage: "review", round: 1 },
  };
  const fn = new AsyncFunction("agent", "parallel", "pipeline", "log", "phase", "args", SCRIPT);
  const [result] = await fn(agent, parallel, pipeline, () => {}, () => {}, [ticket]);
  const labels = calls.map((c) => c.opts.label as string);
  const call = (label: string) => calls.find((c) => c.opts.label === label)!;
  return { result, calls, labels, call };
}

const R1 = "review:gr-x:r1:lens1";
const R2 = "review:gr-x:r2:lens1";

describe("mutation step", () => {
  it("mutate call", async () => {
    const { call } = await run({ canned: { [R1]: verdict("approved") } });
    const c = call("mutate:gr-x:r1");
    expect(c.prompt).toBe(MUTATE_TEXT("worktree-x"));
    expect(c.opts.model).toBe("sonnet");
    expect(c.opts.effort).toBe("low");
    expect(c.opts.isolation).toBe("worktree");
    expect(c.opts.phase).toBe("Mutate");
    expect(c.opts.schema.required).toEqual([
      "status",
      "mutants",
      "score",
      "survivors",
      "elapsedMs",
      "dropped",
      "blocked",
    ]);
    expect(c.opts.schema.properties.status.enum).toEqual([
      "ok",
      "truncated",
      "overrun",
      "runner-failed",
      "no-scope",
    ]);
  });

  const SURV_A = { file: "server/ordering.ts", line: 24, mutator: "ConditionalExpression", status: "Survived" };
  const SURV_B = { file: "server/ordering.ts", line: 19, mutator: "BlockStatement", status: "NoCoverage" };
  const SKIP = "The gate is skipped for this round; say so in the verdict.";
  const rows: Array<[string, unknown, string]> = [
    ["agent died", null, `Mutation run (round 1): the mutation agent died. ${SKIP}`],
    [
      "blocked",
      { ...OK_MUTATION, status: "runner-failed", blocked: "pnpm install failed: ERR" },
      `Mutation run (round 1): blocked: pnpm install failed: ERR. ${SKIP}`,
    ],
    [
      "overrun",
      { ...OK_MUTATION, status: "overrun", elapsedMs: 601234 },
      `Mutation run (round 1): overrun after 601 s. ${SKIP}`,
    ],
    [
      "runner-failed",
      { ...OK_MUTATION, status: "runner-failed", elapsedMs: null },
      `Mutation run (round 1): runner-failed after n/a. ${SKIP}`,
    ],
    ["no-scope", { ...OK_MUTATION, status: "no-scope" }, "Mutation run (round 1): no-scope, nothing to mutate."],
    [
      "ok with survivors",
      {
        status: "ok",
        mutants: 12,
        score: 16.666666,
        elapsedMs: 307676,
        survivors: [SURV_A, SURV_B],
        dropped: [],
        blocked: null,
      },
      [
        "Mutation run (round 1): ok, 12 mutants, score 16.7, 308 s, 2 survivors.",
        "- server/ordering.ts:24 ConditionalExpression (Survived)",
        "- server/ordering.ts:19 BlockStatement (NoCoverage)",
      ].join("\n"),
    ],
    [
      "truncated with dropped",
      {
        status: "truncated",
        mutants: 4,
        score: 75,
        elapsedMs: 61000,
        survivors: [{ file: "server/a.ts", line: 41, mutator: "EqualityOperator", status: "Survived" }],
        dropped: ["server/z.ts:40-90", "server/b.ts:1-9"],
        blocked: null,
      },
      [
        "Mutation run (round 1): truncated, 4 mutants, score 75.0, 61 s, 1 survivor.",
        "- server/a.ts:41 EqualityOperator (Survived)",
        "Dropped over the cap: server/z.ts:40-90, server/b.ts:1-9",
      ].join("\n"),
    ],
    ["ok with zero mutants", OK_MUTATION, OK_MUTATION_TEXT(1)],
    [
      "ok with one mutant",
      {
        status: "ok",
        mutants: 1,
        score: 0,
        elapsedMs: 9000,
        survivors: [{ file: "server/c.ts", line: 3, mutator: "BooleanLiteral", status: "Survived" }],
        dropped: [],
        blocked: null,
      },
      [
        "Mutation run (round 1): ok, 1 mutant, score 0.0, 9 s, 1 survivor.",
        "- server/c.ts:3 BooleanLiteral (Survived)",
      ].join("\n"),
    ],
    [
      "overrun with dropped",
      { ...OK_MUTATION, status: "overrun", elapsedMs: 601234, dropped: ["server/z.ts:40-90"] },
      `Mutation run (round 1): overrun after 601 s. ${SKIP}`,
    ],
  ];
  for (const [name, mutation, text] of rows) {
    it(`mutation text: ${name}`, async () => {
      const { call } = await run({
        reviewers: ["M:{{mutation}}"],
        mutation,
        canned: { [R1]: verdict("approved") },
      });
      expect(call(R1).prompt).toBe(`M:${text}`);
    });
  }

  it("empty blocked counts as null", async () => {
    const { call } = await run({
      reviewers: ["M:{{mutation}}"],
      mutation: { ...OK_MUTATION, blocked: "" },
      canned: { [R1]: verdict("approved") },
    });
    expect(call(R1).prompt).toBe(`M:${OK_MUTATION_TEXT(1)}`);
  });

  it("mutation text reaches every lens", async () => {
    const { call } = await run({
      reviewers: ["M:{{mutation}}", "N:{{mutation}}"],
      canned: { [R1]: verdict("approved"), "review:gr-x:r1:lens2": verdict("approved") },
    });
    expect(call(R1).prompt).toBe(`M:${OK_MUTATION_TEXT(1)}${ONE_OF_SEVERAL}`);
    expect(call("review:gr-x:r1:lens2").prompt).toBe(`N:${OK_MUTATION_TEXT(1)}${ONE_OF_SEVERAL}`);
  });

  it("runs mutate before each review round", async () => {
    const { labels } = await run({
      start: undefined,
      builder: { pr: 7, branch: "worktree-x", verification: "ok", blocked: null, notes: "" },
      canned: {
        [R1]: verdict("changes-requested", [finding("blocker", "a.ts")]),
        "fix:gr-x:r1": FIX_OK,
        [R2]: verdict("approved"),
      },
    });
    expect(labels).toEqual(["build:gr-x", "mutate:gr-x:r1", R1, "fix:gr-x:r1", "mutate:gr-x:r2", R2]);
  });

  it("round 2 reviewers get the round 2 mutation text", async () => {
    const { call } = await run({
      reviewers: ["M:{{mutation}}"],
      canned: {
        [R1]: verdict("changes-requested", [finding("blocker", "a.ts", { line: 2, claim: "A", evidence: "ea" })]),
        "fix:gr-x:r1": FIX_OK,
        [R2]: verdict("approved"),
      },
    });
    expect(call(R2).prompt).toBe(`M:${OK_MUTATION_TEXT(2)}`);
  });

  it("start at round 2 calls mutate first", async () => {
    const { labels } = await run({
      start: { pr: 7, branch: "worktree-x", stage: "review", round: 2, findings: ["1. old"] },
      canned: { [R2]: verdict("approved") },
    });
    expect(labels).toEqual(["mutate:gr-x:r2", R2]);
  });
});

describe("routing", () => {
  const cases: Array<{
    name: string;
    lenses: unknown[];
    verdict: string;
    fix: string | null;
  }> = [
    {
      name: "approved lens with a line-less blocker",
      lenses: [verdict("approved", [finding("blocker", "a.ts", { line: null, claim: "broken", evidence: "run a" })])],
      verdict: "changes-requested",
      fix: "1. [blocker] a.ts: broken (evidence: run a)",
    },
    {
      name: "changes-requested with only should-fix and nit",
      lenses: [verdict("changes-requested", [finding("should-fix", "a.ts"), finding("nit", "b.ts")])],
      verdict: "approved",
      fix: null,
    },
    {
      name: "blockers first across lenses, nits never",
      lenses: [
        verdict("changes-requested", [
          finding("should-fix", "a.ts", { line: 1, claim: "A", evidence: "ea" }),
          finding("nit", "b.ts", { claim: "B" }),
        ]),
        verdict("changes-requested", [
          finding("should-fix", "g.ts", { line: 7, claim: "G", evidence: "eg" }),
          finding("blocker", "c.ts", { line: 3, claim: "C", evidence: "ec" }),
        ]),
      ],
      verdict: "changes-requested",
      fix: "1. [blocker] c.ts:3: C (evidence: ec)\n2. [should-fix] a.ts:1: A (evidence: ea)\n3. [should-fix] g.ts:7: G (evidence: eg)",
    },
    {
      name: "blocker, should-fix, blocker in one lens",
      lenses: [
        verdict("changes-requested", [
          finding("blocker", "d.ts", { line: 4, claim: "D", evidence: "ed" }),
          finding("should-fix", "e.ts", { line: 5, claim: "E", evidence: "ee" }),
          finding("blocker", "f.ts", { line: 6, claim: "F", evidence: "ef" }),
        ]),
      ],
      verdict: "changes-requested",
      fix: "1. [blocker] d.ts:4: D (evidence: ed)\n2. [blocker] f.ts:6: F (evidence: ef)\n3. [should-fix] e.ts:5: E (evidence: ee)",
    },
  ];
  for (const c of cases) {
    it(`routing: ${c.name}`, async () => {
      const reviewers = c.lenses.map(() => "M");
      const canned: Record<string, Canned> = { "fix:gr-x:r1": FIX_OK, [R2]: verdict("approved") };
      c.lenses.forEach((l, i) => {
        canned[`review:gr-x:r1:lens${i + 1}`] = l;
        canned[`review:gr-x:r2:lens${i + 1}`] = verdict("approved");
      });
      const { result, call, labels } = await run({ reviewers, canned });
      expect(result.rounds[0].review.verdict).toBe(c.verdict);
      if (c.fix === null) {
        expect(labels.some((l) => l.startsWith("fix:"))).toBe(false);
      } else {
        expect(call("fix:gr-x:r1").prompt).toBe(`FIX ${c.fix}`);
      }
    });
  }

  it("round 2 gets the fix list", async () => {
    const { call } = await run({
      reviewers: ["P:{{prior_round}}"],
      canned: {
        [R1]: verdict("changes-requested", [finding("blocker", "a.ts", { line: 2, claim: "A", evidence: "ea" })]),
        "fix:gr-x:r1": FIX_OK,
        [R2]: verdict("approved"),
      },
    });
    expect(call(R2).prompt).toBe(
      "P:This is review round 2. Round 1 requested:\n1. [blocker] a.ts:2: A (evidence: ea)\nCheck that each is fixed, and look again for new defects.",
    );
  });
});

describe("evidence re-ask", () => {
  const blockerNoEvidence = finding("blocker", "a.ts", { line: null, evidence: "  " });
  it("re-asks a lens once for a blocker without evidence", async () => {
    const { call, labels, result } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [blockerNoEvidence]),
        [`${R1}:again`]: verdict("approved"),
      },
    });
    expect(labels.filter((l) => l.endsWith(":again"))).toEqual([`${R1}:again`]);
    expect(call(`${R1}:again`).prompt).toBe(
      "M\n\nThese findings need evidence, the command that shows them: a.ts. Return all your findings again with evidence filled in.",
    );
    expect(result.rounds[0].review.verdict).toBe("approved");
  });

  it("lists file:line when the line is known", async () => {
    const { call } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [
          finding("blocker", "a.ts", { line: 3, evidence: null }),
          finding("should-fix", "b.ts", { line: null, evidence: null }),
          finding("blocker", "c.ts", { evidence: "ok" }),
        ]),
        [`${R1}:again`]: verdict("approved"),
      },
    });
    expect(call(`${R1}:again`).prompt).toBe(
      "M\n\nThese findings need evidence, the command that shows them: a.ts:3, b.ts. Return all your findings again with evidence filled in.",
    );
  });

  it("re-asks lens 2 on its own", async () => {
    const { call, labels } = await run({
      reviewers: ["M", "N"],
      canned: {
        [R1]: verdict("approved"),
        "review:gr-x:r1:lens2": verdict("changes-requested", [finding("blocker", "b.ts", { line: 4, evidence: null })]),
        "review:gr-x:r1:lens2:again": verdict("approved"),
      },
    });
    expect(labels.filter((l) => l.endsWith(":again"))).toEqual(["review:gr-x:r1:lens2:again"]);
    expect(call("review:gr-x:r1:lens2:again").prompt).toBe(
      `N${ONE_OF_SEVERAL}\n\nThese findings need evidence, the command that shows them: b.ts:4. Return all your findings again with evidence filled in.`,
    );
  });

  it("should-fix without evidence", async () => {
    const { labels } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("approved", [finding("should-fix", "a.ts", { evidence: null })]),
        [`${R1}:again`]: verdict("approved"),
      },
    });
    expect(labels.filter((l) => l.endsWith(":again"))).toEqual([`${R1}:again`]);
  });

  it("nit without evidence", async () => {
    const { labels } = await run({
      reviewers: ["M"],
      canned: { [R1]: verdict("approved", [finding("nit", "a.ts", { evidence: null })]) },
    });
    expect(labels.filter((l) => l.endsWith(":again"))).toEqual([]);
  });

  it("re-ask answer null", async () => {
    const { result } = await run({
      reviewers: ["M"],
      canned: { [R1]: verdict("changes-requested", [blockerNoEvidence]), [`${R1}:again`]: null },
    });
    expect(result.outcome).toBe("reviewer-died");
    expect(result.rounds[0].review.verdict).toBe("reviewer-died");
  });

  it("re-ask answer blocked", async () => {
    const { result } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [blockerNoEvidence]),
        [`${R1}:again`]: { verdict: "blocked", findings: [], blocked: "hook" },
      },
    });
    expect(result.outcome).toBe("blocked");
  });

  it("re-ask answer still without evidence", async () => {
    const { call, labels } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [blockerNoEvidence]),
        [`${R1}:again`]: verdict("changes-requested", [
          finding("blocker", "a.ts", { line: 2, claim: "A", evidence: null }),
        ]),
        "fix:gr-x:r1": FIX_OK,
        [R2]: verdict("approved"),
      },
    });
    expect(labels.filter((l) => l.endsWith(":again"))).toEqual([`${R1}:again`]);
    expect(call("fix:gr-x:r1").prompt).toBe("FIX 1. [blocker] a.ts:2: A");
  });
});

describe("nonBlocking", () => {
  const SF1 = finding("should-fix", "s1.ts", { claim: "S1" });
  const NIT1 = finding("nit", "n1.ts", { claim: "N1" });
  const BL1 = finding("blocker", "b1.ts", { claim: "B1" });
  const SF2 = finding("should-fix", "s2.ts", { claim: "S2" });
  const NIT2 = finding("nit", "n2.ts", { claim: "N2" });
  const BL2 = finding("blocker", "b2.ts", { claim: "B2" });
  const SF3 = finding("should-fix", "s3.ts", { claim: "S3" });
  const withLens = (f: object, lens: number) => ({ ...f, lens });

  const twoRound = {
    reviewers: ["M", "N"],
    canned: {
      [R1]: verdict("changes-requested", [SF1, NIT1]),
      "review:gr-x:r1:lens2": verdict("changes-requested", [BL1, SF3]),
      "fix:gr-x:r1": FIX_OK,
      [R2]: verdict("changes-requested", [SF2]),
      "review:gr-x:r2:lens2": verdict("changes-requested", [BL2, NIT2]),
    } as Record<string, Canned>,
  };

  it("returns every non-blocking finding with round, lens and sentToFix", async () => {
    const { result } = await run(twoRound);
    expect(result.outcome).toBe("operator-decides");
    expect(result.nonBlocking).toEqual([
      { ...SF1, lens: 1, round: 1, sentToFix: 1 },
      { ...NIT1, lens: 1, round: 1, sentToFix: null },
      { ...SF3, lens: 2, round: 1, sentToFix: 1 },
      { ...SF2, lens: 1, round: 2, sentToFix: null },
      { ...NIT2, lens: 2, round: 2, sentToFix: null },
    ]);
  });

  it("round records", async () => {
    const { result } = await run(twoRound);
    expect(result.rounds).toEqual([
      {
        round: 1,
        mutation: OK_MUTATION,
        review: {
          verdict: "changes-requested",
          verdicts: [twoRound.canned[R1], twoRound.canned["review:gr-x:r1:lens2"]],
          findings: [withLens(SF1, 1), withLens(NIT1, 1), withLens(BL1, 2), withLens(SF3, 2)],
        },
      },
      { round: 1, fix: FIX_OK },
      {
        round: 2,
        mutation: OK_MUTATION,
        review: {
          verdict: "changes-requested",
          verdicts: [twoRound.canned[R2], twoRound.canned["review:gr-x:r2:lens2"]],
          findings: [withLens(SF2, 1), withLens(BL2, 2), withLens(NIT2, 2)],
        },
      },
    ]);
  });

  it("fix-failed keeps nonBlocking", async () => {
    const { result } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [BL1, SF1]),
        "fix:gr-x:r1": { ...FIX_OK, commit: null },
        "fix:gr-x:r1:again": { ...FIX_OK, commit: null },
      },
    });
    expect(result.outcome).toBe("fix-failed");
    expect(result.nonBlocking).toEqual([{ ...SF1, lens: 1, round: 1, sentToFix: 1 }]);
  });

  it("build-blocked has empty nonBlocking", async () => {
    const { result } = await run({
      start: undefined,
      builder: { pr: null, branch: null, verification: "x", blocked: "hook", notes: "" },
    });
    expect(result.outcome).toBe("build-blocked");
    expect(result.nonBlocking).toEqual([]);
  });

  it("builder-died has empty nonBlocking", async () => {
    const { result } = await run({ start: undefined, builder: null });
    expect(result.outcome).toBe("builder-died");
    expect(result.nonBlocking).toEqual([]);
  });

  it("blocked round adds nothing", async () => {
    const { result } = await run({
      reviewers: ["M", "N"],
      canned: {
        [R1]: { verdict: "blocked", findings: [], blocked: "hook" },
        "review:gr-x:r1:lens2": verdict("approved", [NIT1]),
      },
    });
    expect(result.outcome).toBe("blocked");
    expect(result.nonBlocking).toEqual([]);
    expect(result.rounds[0].review).toEqual({
      verdict: "blocked",
      verdicts: [{ verdict: "blocked", findings: [], blocked: "hook" }, verdict("approved", [NIT1])],
    });
  });
});

describe("fix rounds", () => {
  const BL = verdict("changes-requested", [finding("blocker", "a.ts", { line: 2, claim: "A", evidence: "ea" })]);
  const FIX_PROMPT = "FIX 1. [blocker] a.ts:2: A (evidence: ea)";
  const base = { reviewers: ["M"] };
  const fixCase = async (fixes: Record<string, unknown>) =>
    run({ ...base, canned: { [R1]: BL, [R2]: verdict("approved"), ...fixes } as Record<string, Canned> });
  const fixCalls = (labels: string[]) => labels.filter((l) => l.startsWith("fix:")).length;

  it("fix: commit with a note goes to re-review", async () => {
    const { result, labels } = await fixCase({
      "fix:gr-x:r1": { ...FIX_OK, note: "tested countMutantLines instead" },
    });
    expect(result.outcome).toBe("approved");
    expect(fixCalls(labels)).toBe(1);
    expect(labels.includes(R2)).toBe(true);
  });

  it("fix: body edit without commit goes to re-review", async () => {
    const { result, labels } = await fixCase({
      "fix:gr-x:r1": { ...FIX_OK, commit: null, bodyEdited: true },
    });
    expect(result.outcome).toBe("approved");
    expect(fixCalls(labels)).toBe(1);
    expect(labels.includes(R2)).toBe(true);
  });

  it("fix: first empty, second commit", async () => {
    const { result, labels, call } = await fixCase({
      "fix:gr-x:r1": { ...FIX_OK, commit: null },
      "fix:gr-x:r1:again": FIX_OK,
    });
    expect(result.outcome).toBe("approved");
    expect(fixCalls(labels)).toBe(2);
    expect(call("fix:gr-x:r1:again").prompt).toBe(FIX_PROMPT + FIX_NOT_SETTLED);
    expect(labels.includes(R2)).toBe(true);
  });

  it("fix: both empty", async () => {
    const empty = { ...FIX_OK, commit: null };
    const { result, labels, call } = await fixCase({ "fix:gr-x:r1": empty, "fix:gr-x:r1:again": empty });
    expect(result.outcome).toBe("fix-failed");
    expect(fixCalls(labels)).toBe(2);
    expect(call("fix:gr-x:r1:again").prompt).toBe(FIX_PROMPT + FIX_NOT_SETTLED);
    expect(labels.includes(R2)).toBe(false);
  });

  it("fix: body edit with verification still running", async () => {
    const pending = { ...FIX_OK, commit: null, bodyEdited: true, verification: "vitest still running" };
    const { result, labels } = await fixCase({ "fix:gr-x:r1": pending, "fix:gr-x:r1:again": pending });
    expect(result.outcome).toBe("fix-failed");
    expect(fixCalls(labels)).toBe(2);
    expect(labels.includes(R2)).toBe(false);
  });

  it("fix: blocked", async () => {
    const { result, labels } = await fixCase({ "fix:gr-x:r1": { ...FIX_OK, blocked: "cannot start e2e" } });
    expect(result.outcome).toBe("fix-failed");
    expect(fixCalls(labels)).toBe(1);
    expect(labels.includes(R2)).toBe(false);
  });

  it("fix: agent died", async () => {
    const { result, labels } = await fixCase({ "fix:gr-x:r1": null });
    expect(result.outcome).toBe("fix-failed");
    expect(fixCalls(labels)).toBe(1);
    expect(labels.includes(R2)).toBe(false);
  });
});

describe("outcomes", () => {
  it("two lenses approve → approved-mark-ready", async () => {
    const { result } = await run({
      reviewers: ["M", "N"],
      canned: { [R1]: verdict("approved"), "review:gr-x:r1:lens2": verdict("approved") },
    });
    expect(result.outcome).toBe("approved-mark-ready");
  });

  it("single lens changes-requested with only nits → approved-mark-ready", async () => {
    const { result } = await run({
      reviewers: ["M"],
      canned: { [R1]: verdict("changes-requested", [finding("nit", "a.ts")]) },
    });
    expect(result.outcome).toBe("approved-mark-ready");
  });

  it("single lens approved → approved", async () => {
    const { result } = await run({ reviewers: ["M"], canned: { [R1]: verdict("approved") } });
    expect(result.outcome).toBe("approved");
  });

  it("lens 1 approved, lens 2 changes-requested with only nits → approved-mark-ready", async () => {
    const { result } = await run({
      reviewers: ["M", "N"],
      canned: {
        [R1]: verdict("approved"),
        "review:gr-x:r1:lens2": verdict("changes-requested", [finding("nit", "a.ts")]),
      },
    });
    expect(result.outcome).toBe("approved-mark-ready");
  });

  it("round 2 changes-requested → operator-decides", async () => {
    const bl = verdict("changes-requested", [finding("blocker", "a.ts")]);
    const { result, labels } = await run({
      reviewers: ["M"],
      canned: { [R1]: bl, "fix:gr-x:r1": FIX_OK, [R2]: bl },
    });
    expect(result.outcome).toBe("operator-decides");
    expect(labels.filter((l) => l.startsWith("fix:"))).toEqual(["fix:gr-x:r1"]);
  });
});

describe("schemas", () => {
  it("schemas", async () => {
    const { call } = await run({
      reviewers: ["M"],
      canned: {
        [R1]: verdict("changes-requested", [finding("blocker", "a.ts")]),
        "fix:gr-x:r1": FIX_OK,
        [R2]: verdict("approved"),
      },
    });
    const review = call(R1).opts.schema;
    expect(review.properties.findings.items.required).toEqual([
      "level",
      "file",
      "line",
      "claim",
      "evidence",
      "equivalentMutant",
    ]);
    expect(review.properties.findings.items.properties.level.enum).toEqual(["blocker", "should-fix", "nit"]);
    expect(call("fix:gr-x:r1").opts.schema.required).toEqual([
      "commit",
      "bodyEdited",
      "verification",
      "note",
      "blocked",
    ]);
  });
});
