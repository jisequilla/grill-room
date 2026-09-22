import { describe, expect, it } from "vitest";

import type { TreeDecision } from "@/lib/decisions";
import {
  assignColumn,
  computeNodeDepths,
  groupByColumn,
} from "@/lib/tree-layout";

function decision(
  id: string,
  overrides: Partial<TreeDecision> = {},
): TreeDecision {
  return {
    id,
    key: id,
    questionTitle: id,
    questionBody: "",
    choices: [],
    recommendedChoice: null,
    recommendedChoiceLabel: null,
    recommendedAnswer: null,
    dependsOn: [],
    introducedBy: "interviewer",
    state: "settled",
    answer: { text: "yes", kind: "own-answer" },
    supersession: null,
    dispositionTarget: null,
    settledAt: null,
    reopenedAt: null,
    withdrawnAt: null,
    awaitingPlacementSince: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    previousAnswers: [],
    ...overrides,
  };
}

describe("computeNodeDepths", () => {
  it("gives a root no dependencies depth 0", () => {
    const depths = computeNodeDepths([decision("a")]);
    expect(depths.get("a")).toBe(0);
  });

  it("depths a chain one more than its dependency each step", () => {
    const depths = computeNodeDepths([
      decision("a"),
      decision("b", { dependsOn: ["a"] }),
      decision("c", { dependsOn: ["b"] }),
    ]);
    expect(depths.get("a")).toBe(0);
    expect(depths.get("b")).toBe(1);
    expect(depths.get("c")).toBe(2);
  });

  it("takes the deepest of several dependencies", () => {
    const depths = computeNodeDepths([
      decision("a"),
      decision("b", { dependsOn: ["a"] }),
      decision("c", { dependsOn: ["b"] }),
      decision("d", { dependsOn: ["a", "c"] }),
    ]);
    expect(depths.get("d")).toBe(3);
  });

  it("ignores a dependency id that matches no decision", () => {
    const depths = computeNodeDepths([decision("a", { dependsOn: ["gone"] })]);
    expect(depths.get("a")).toBe(0);
  });

  it("resolves a cycle to a depth instead of looping forever", () => {
    const depths = computeNodeDepths([
      decision("a", { dependsOn: ["b"] }),
      decision("b", { dependsOn: ["a"] }),
    ]);
    expect(depths.get("a")).toBeGreaterThanOrEqual(0);
    expect(depths.get("b")).toBeGreaterThanOrEqual(0);
  });
});

describe("assignColumn", () => {
  it("puts a settled decision in Settled", () => {
    expect(assignColumn(decision("a", { state: "settled" }))).toBe("settled");
  });

  it("puts a frontier decision in Frontier", () => {
    expect(assignColumn(decision("a", { state: "frontier" }))).toBe(
      "frontier",
    );
  });

  it("puts a blocked decision in Blocked", () => {
    expect(assignColumn(decision("a", { state: "blocked" }))).toBe("blocked");
  });

  it("puts a stale decision in Loose ends even though it once settled", () => {
    expect(assignColumn(decision("a", { state: "stale" }))).toBe("looseEnds");
  });

  it("puts a withdrawn decision in Settled", () => {
    expect(assignColumn(decision("a", { state: "withdrawn" }))).toBe(
      "settled",
    );
  });

  it("puts an unplaced decision in Blocked", () => {
    expect(assignColumn(decision("a", { state: "unplaced" }))).toBe(
      "blocked",
    );
  });

  it("puts a frontier-ready decision with a steering-move answer in Loose ends, not Frontier", () => {
    const looseEnd = decision("a", {
      state: "frontier",
      answer: { text: null, kind: "deferred" },
    });
    expect(assignColumn(looseEnd)).toBe("looseEnds");
  });
});

describe("groupByColumn", () => {
  it("sorts every decision into its column", () => {
    const groups = groupByColumn([
      decision("f", { state: "frontier" }),
      decision("bl", { state: "blocked" }),
      decision("s", { state: "settled" }),
      decision("st", { state: "stale" }),
    ]);
    expect(groups.frontier.map((d) => d.id)).toEqual(["f"]);
    expect(groups.blocked.map((d) => d.id)).toEqual(["bl"]);
    expect(groups.settled.map((d) => d.id)).toEqual(["s"]);
    expect(groups.looseEnds.map((d) => d.id)).toEqual(["st"]);
  });

  it("pushes withdrawn to the bottom of Settled without reordering the rest", () => {
    const groups = groupByColumn([
      decision("withdrawn-1", { state: "withdrawn" }),
      decision("settled-1", { state: "settled" }),
      decision("settled-2", { state: "settled" }),
    ]);
    expect(groups.settled.map((d) => d.id)).toEqual([
      "settled-1",
      "settled-2",
      "withdrawn-1",
    ]);
  });

  it("pushes unplaced to the bottom of Blocked without reordering the rest", () => {
    const groups = groupByColumn([
      decision("unplaced-1", { state: "unplaced" }),
      decision("blocked-1", { state: "blocked" }),
      decision("blocked-2", { state: "blocked" }),
    ]);
    expect(groups.blocked.map((d) => d.id)).toEqual([
      "blocked-1",
      "blocked-2",
      "unplaced-1",
    ]);
  });
});
