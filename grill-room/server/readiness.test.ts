/**
 * Unit tests for the readiness refusal rule, isolated from the action that
 * calls it. See `readiness.ts` for the rule.
 */
import { describe, expect, it } from "vitest";

import { anAssessReadinessResult } from "./interviewer/test-fixtures.js";
import { reasonsToRefuseReadiness } from "./readiness.js";

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
      evidence: ["I currently track books in a spreadsheet that keeps getting lost."],
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
      evidence: ["A tiny web app to track books I want to read"],
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
      evidence: [IDEA],
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
      evidence: ["  A TINY WEB APP TO TRACK BOOKS I WANT TO READ   "],
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
      evidence: ["I want to read more books but lose track of my list."],
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
});
