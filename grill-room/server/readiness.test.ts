/**
 * Unit tests for the readiness refusal rule, isolated from the action that
 * calls it. See `readiness.ts` for the rule.
 */
import { describe, expect, it } from "vitest";

import {
  anAssessReadinessResult,
  ideaEvidence,
  repoEvidence,
} from "./interviewer/test-fixtures.js";
import { reasonsToRefuseReadiness } from "./readiness.js";
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
