/**
 * Unit tests for the readiness refusal rule, isolated from the action that
 * calls it. See `readiness.ts` for the rule.
 */
import { describe, expect, it } from "vitest";

import { DEPTHS } from "../shared/session-constants.js";
import {
  READINESS_DEPTH_BARS,
  READINESS_VERDICT_RULE,
  READINESS_VERDICT_RULE_PROOF_OF_CONCEPT,
  buildPrompt,
} from "./interviewer/prompt.js";
import {
  MAX_READY_UNKNOWNS,
  MAX_READY_UNKNOWNS_PROOF_OF_CONCEPT,
  type AssessReadinessResult,
} from "./interviewer/schemas.js";
import {
  aContext,
  anAssessReadinessRequest,
  anAssessReadinessResult,
  ideaEvidence,
  repoEvidence,
} from "./interviewer/test-fixtures.js";
import {
  clampReadinessCitations,
  parseStoredReadiness,
  reasonsToRefuseReadiness,
  storeReadiness,
} from "./readiness.js";
import { useTempGitRepos } from "../test/git-repos.js";

const IDEA = "A tiny web app to track books I want to read.";

describe("reasonsToRefuseReadiness", () => {
  it("has no reasons for a not-ready verdict, whatever else is wrong", () => {
    const result = anAssessReadinessResult({
      verdict: "not-ready",
      evidence: [],
      objective: null,
    });
    expect(reasonsToRefuseReadiness(result, IDEA)).toEqual([]);
  });

  it("accepts a ready verdict with real evidence", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [
        ideaEvidence(
          "I currently track books in a spreadsheet that keeps getting lost.",
        ),
      ],
      objective: "A tiny web app to track books I want to read.",
      objectiveIsProcess: false,
      unknowns: [],
    });
    expect(reasonsToRefuseReadiness(result, IDEA)).toEqual([]);
  });

  it("refuses a ready verdict with no evidence", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [],
      objective: "A tiny web app to track books I want to read.",
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(reasons).toContain("A ready verdict needs at least one evidence item.");
  });

  it("refuses a ready verdict whose only evidence restates the objective", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [ideaEvidence("A tiny web app to track books I want to read")],
      objective: "A tiny web app to track books I want to read.",
      objectiveIsProcess: false,
      unknowns: [],
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(
      reasons.some((reason) => reason.includes("restates the idea's goal")),
    ).toBe(true);
  });

  it("refuses a ready verdict whose only evidence is the whole idea, quoted verbatim", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [ideaEvidence(IDEA)],
      objective: "A book tracking app.",
      objectiveIsProcess: false,
      unknowns: [],
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(
      reasons.some((reason) => reason.includes("restates the idea's goal")),
    ).toBe(true);
  });

  it("ignores case, whitespace and trailing punctuation when comparing", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [ideaEvidence("  A TINY WEB APP TO TRACK BOOKS I WANT TO READ   ")],
      objective: "A book tracking app.",
      objectiveIsProcess: false,
      unknowns: [],
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(
      reasons.some((reason) => reason.includes("restates the idea's goal")),
    ).toBe(true);
  });

  it("does not flag an evidence item that merely overlaps the idea's wording", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      evidence: [ideaEvidence("I want to read more books but lose track of my list.")],
      objective: "A tiny web app to track books I want to read.",
      objectiveIsProcess: false,
      unknowns: [],
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(
      reasons.some((reason) => reason.includes("restates the idea's goal")),
    ).toBe(false);
  });

  it("refuses a ready verdict with a null objective", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      objective: null,
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(reasons).toContain("A ready verdict needs an objective.");
  });

  it("refuses a ready verdict whose objective is a process", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      objective: "Decide how to evaluate eight repos.",
      objectiveIsProcess: true,
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(reasons).toContain(
      "A ready verdict needs an objective that is not a process.",
    );
  });

  it("refuses a ready verdict with too many unknowns", () => {
    const result = anAssessReadinessResult({
      verdict: "ready",
      unknowns: ["a", "b", "c", "d", "e", "f"],
    });
    const reasons = reasonsToRefuseReadiness(result, IDEA);
    expect(
      reasons.some((reason) => reason.includes("allows at most 5 unknowns")),
    ).toBe(true);
  });

  describe("repo-sourced evidence", () => {
    const repos = useTempGitRepos();

    it("accepts a repo item whose citation resolves in the project, whatever the verdict", () => {
      const root = repos.create({ files: { "docs/adr/0003-queue.md": "a\nb\nc\n" } });
      const result = anAssessReadinessResult({
        verdict: "not-ready",
        evidence: [
          repoEvidence(
            "Ingest runs on a Postgres-backed queue.",
            "docs/adr/0003-queue.md:1-2",
          ),
        ],
      });
      expect(reasonsToRefuseReadiness(result, IDEA, root)).toEqual([]);
    });

    it("refuses a repo item with no citation", () => {
      const result = anAssessReadinessResult({
        verdict: "not-ready",
        evidence: [
          { text: "Ingest runs on a queue.", source: "repo", citation: null },
        ],
      });
      const reasons = reasonsToRefuseReadiness(result, IDEA, "/tmp/does-not-matter");
      expect(reasons.some((reason) => reason.includes("carries no citation"))).toBe(
        true,
      );
    });

    it("refuses a repo item when the session has no project to check it against", () => {
      const result = anAssessReadinessResult({
        verdict: "not-ready",
        evidence: [repoEvidence("Ingest runs on a queue.", "docs/adr/0003.md:1")],
      });
      const reasons = reasonsToRefuseReadiness(result, IDEA, null);
      expect(
        reasons.some((reason) => reason.includes("this session has no project")),
      ).toBe(true);
    });

    it("refuses a repo item whose citation does not resolve in the project", () => {
      const root = repos.create({ files: { "docs/adr/0003-queue.md": "a\nb\n" } });
      const result = anAssessReadinessResult({
        verdict: "not-ready",
        evidence: [
          repoEvidence("Ingest runs on a queue.", "docs/adr/0003-queue.md:1-5"),
        ],
      });
      const reasons = reasonsToRefuseReadiness(result, IDEA, root);
      expect(reasons.some((reason) => reason.includes("has 2 lines"))).toBe(true);
    });

    it("refuses an idea item that carries a citation", () => {
      const result = anAssessReadinessResult({
        verdict: "not-ready",
        evidence: [
          { text: IDEA, source: "idea", citation: "docs/adr/0003-queue.md:1" },
        ],
      });
      const reasons = reasonsToRefuseReadiness(result, IDEA, "/tmp/does-not-matter");
      expect(
        reasons.some((reason) => reason.includes("only repo evidence cites")),
      ).toBe(true);
    });

    it("does not flag a repo item that echoes the objective: the restatement check is idea-only", () => {
      const root = repos.create({ files: { "docs/adr/0003-queue.md": "a\nb\nc\n" } });
      const result = anAssessReadinessResult({
        verdict: "ready",
        evidence: [
          repoEvidence(
            "A tiny web app to track books I want to read.",
            "docs/adr/0003-queue.md:1-2",
          ),
        ],
        objective: "A tiny web app to track books I want to read.",
        objectiveIsProcess: false,
        unknowns: [],
      });
      const reasons = reasonsToRefuseReadiness(result, IDEA, root);
      expect(
        reasons.some((reason) => reason.includes("restates the idea's goal")),
      ).toBe(false);
    });
  });
});

const ready = (over: Partial<AssessReadinessResult> = {}) =>
  anAssessReadinessResult({ verdict: "ready", ...over });
const NO_EVIDENCE = { evidence: [] };
const items = (n: number) => Array.from({ length: n }, (_, i) => `Unknown ${i + 1}`);
const NEEDS_EVIDENCE = "A ready verdict needs at least one evidence item.";

describe("reasonsToRefuseReadiness by depth", () => {
  it("C1: a proof of concept needs no evidence item", () => {
    expect(
      reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE }), IDEA, null, "proof-of-concept"),
    ).toEqual([]);
  });

  it("C1b: a proof of concept allows 8 unknowns", () => {
    expect(
      reasonsToRefuseReadiness(ready({ unknowns: items(8) }), IDEA, null, "proof-of-concept"),
    ).toEqual([]);
  });

  it("C2: a proof of concept allows no more than 8 unknowns", () => {
    expect(
      reasonsToRefuseReadiness(
        ready({ ...NO_EVIDENCE, unknowns: items(9) }),
        IDEA,
        null,
        "proof-of-concept",
      ),
    ).toEqual(["A ready verdict allows at most 8 unknowns; this one has 9."]);
  });

  it("C3: a proof of concept still needs an objective", () => {
    expect(
      reasonsToRefuseReadiness(
        ready({ ...NO_EVIDENCE, objective: null, objectiveIsProcess: false }),
        IDEA,
        null,
        "proof-of-concept",
      ),
    ).toEqual(["A ready verdict needs an objective."]);
  });

  it("C4: a proof of concept still needs an objective that is not a process", () => {
    expect(
      reasonsToRefuseReadiness(
        ready({ ...NO_EVIDENCE, objectiveIsProcess: true }),
        IDEA,
        null,
        "proof-of-concept",
      ),
    ).toEqual(["A ready verdict needs an objective that is not a process."]);
  });

  it("C5: a first working version still needs evidence", () => {
    expect(
      reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE }), IDEA, null, "first-working-version"),
    ).toEqual([NEEDS_EVIDENCE]);
  });

  it("C6: a full spec still needs evidence", () => {
    expect(
      reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE }), IDEA, null, "full-spec"),
    ).toEqual([NEEDS_EVIDENCE]);
  });

  it("C7: a first working version keeps the cap of 5 unknowns", () => {
    expect(
      reasonsToRefuseReadiness(ready({ unknowns: items(6) }), IDEA, null, "first-working-version"),
    ).toEqual(["A ready verdict allows at most 5 unknowns; this one has 6."]);
  });

  it("C8: the citation checks run at a proof of concept", () => {
    expect(
      reasonsToRefuseReadiness(
        ready({ evidence: [repoEvidence("Sessions are stored in PGlite", "server/db.ts:1")] }),
        IDEA,
        null,
        "proof-of-concept",
      ),
    ).toEqual([
      'Evidence item "Sessions are stored in PGlite" is sourced from the repo, but this session has no project to check its citation against.',
    ]);
  });

  it("C9: a not-ready verdict at a proof of concept is not refused", () => {
    const result = anAssessReadinessResult({
      verdict: "not-ready",
      evidence: [],
      objective: null,
    });
    expect(() =>
      reasonsToRefuseReadiness(result, IDEA, null, "proof-of-concept"),
    ).not.toThrow();
    expect(reasonsToRefuseReadiness(result, IDEA, null, "proof-of-concept")).toEqual([]);
  });

  it("C10: with no depth argument, the check is a first working version's", () => {
    expect(reasonsToRefuseReadiness(ready({ ...NO_EVIDENCE }), IDEA)).toEqual([
      NEEDS_EVIDENCE,
    ]);
  });

  it("C12: the restated-goal rule runs at a proof of concept", () => {
    const objective = ready().objective!;
    expect(
      reasonsToRefuseReadiness(
        ready({ evidence: [ideaEvidence(objective)] }),
        IDEA,
        null,
        "proof-of-concept",
      ),
    ).toEqual([
      `Evidence item "${objective}" only restates the idea's goal, not a fact about the world. A ready verdict needs evidence other than the objective: a constraint, a user, an existing system, or an observed problem.`,
    ]);
  });

  it("C13: the restated-goal rule does not run for a not-ready verdict", () => {
    expect(
      reasonsToRefuseReadiness(
        anAssessReadinessResult({ verdict: "not-ready", evidence: [ideaEvidence(IDEA)] }),
        IDEA,
        null,
        "first-working-version",
      ),
    ).toEqual([]);
  });

  describe("C11: every ready shape a depth's verdict rule describes passes that depth's check", () => {
    it("proof-of-concept: no evidence and 8 unknowns", () => {
      expect(
        reasonsToRefuseReadiness(
          ready({ ...NO_EVIDENCE, unknowns: items(MAX_READY_UNKNOWNS_PROOF_OF_CONCEPT) }),
          IDEA,
          null,
          "proof-of-concept",
        ),
      ).toEqual([]);
    });

    for (const depth of ["first-working-version", "full-spec"] as const) {
      it(`${depth}: one evidence item and 5 unknowns`, () => {
        expect(
          reasonsToRefuseReadiness(ready({ unknowns: items(MAX_READY_UNKNOWNS) }), IDEA, null, depth),
        ).toEqual([]);
      });
    }
  });
});

const TASK_HEADING = "## Your task: judge whether the idea is ready to grill";

describe("the readiness prompt by depth", () => {
  for (const depth of DEPTHS) {
    const prompt = () =>
      buildPrompt(anAssessReadinessRequest({ context: aContext({ depth }) }));

    it(`P1: at ${depth}, its bar sits just before the task, and no other bar`, () => {
      const text = prompt();
      expect(text).toContain(`${READINESS_DEPTH_BARS[depth]}\n\n${TASK_HEADING}`);
      for (const other of DEPTHS.filter((d) => d !== depth)) {
        expect(text).not.toContain(READINESS_DEPTH_BARS[other]);
      }
    });

    it(`P2: at ${depth}, the verdict rule matches the check`, () => {
      const text = prompt();
      if (depth === "proof-of-concept") {
        expect(text).toContain(READINESS_VERDICT_RULE_PROOF_OF_CONCEPT);
        expect(text).not.toContain(READINESS_VERDICT_RULE);
      } else {
        expect(text).toContain(READINESS_VERDICT_RULE);
        expect(text).not.toContain(READINESS_VERDICT_RULE_PROOF_OF_CONCEPT);
      }
    });
  }

  it("P3: with no depth, the prompt carries today's rule and no bar", () => {
    const text = buildPrompt(anAssessReadinessRequest());
    expect(text).toContain(READINESS_VERDICT_RULE);
    expect(text).not.toContain(READINESS_VERDICT_RULE_PROOF_OF_CONCEPT);
    for (const bar of Object.values(READINESS_DEPTH_BARS)) {
      expect(text).not.toContain(bar);
    }
  });

  it("P3: with no depth, the project section runs straight into the task, as today", () => {
    const text = buildPrompt(anAssessReadinessRequest());
    const beforeTask = text.slice(0, text.indexOf(TASK_HEADING));
    expect(beforeTask.endsWith(
      [
        "## The project",
        "",
        "This session has no current scout report of its project (no project is",
        "registered, or none has been scouted yet). Every evidence item you",
        "return must be sourced from the idea.",
        "",
        "",
      ].join("\n"),
    )).toBe(true);
  });
});

describe("storeReadiness and the depth", () => {
  const at = "2026-11-14T00:00:00.000Z";

  it("S1: without a depth, the stored JSON has no depth key", () => {
    const stored = storeReadiness(IDEA, anAssessReadinessResult(), at, null);
    expect("depth" in JSON.parse(stored)).toBe(false);
  });

  it("S2: a depth is stored and read back", () => {
    const stored = storeReadiness(IDEA, anAssessReadinessResult(), at, null, "full-spec");
    expect(parseStoredReadiness({ idea: IDEA, readinessJson: stored })?.depth).toBe(
      "full-spec",
    );
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("clampReadinessCitations", () => {
  const repos = useTempGitRepos();

  it("clampReadinessCitations returns a new result and leaves a frozen input untouched", () => {
    const root = repos.create({ files: { "docs/adr/0003-queue.md": "a\nb\nc\n" } });
    const result = anAssessReadinessResult({
      evidence: [
        ideaEvidence("Alert the on-call engineer"),
        repoEvidence("The queue is Postgres-backed", "docs/adr/0003-queue.md:2-10"),
      ],
    });
    deepFreeze(result);

    const clamped = clampReadinessCitations(result, root);

    expect(clamped).not.toBe(result);
    expect(clamped.evidence[0]).toEqual(ideaEvidence("Alert the on-call engineer"));
    expect(clamped.evidence[1]!.citation).toBe("docs/adr/0003-queue.md:2-3");
    expect(result.evidence[1]!.citation).toBe("docs/adr/0003-queue.md:2-10");
  });
});
