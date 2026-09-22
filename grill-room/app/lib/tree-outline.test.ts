import { describe, expect, it } from "vitest";

import type { TreeDecision } from "@/lib/decisions";
import { buildTreeOutline, transitiveDependentCount } from "@/lib/tree-outline";

function decision(
  id: string,
  dependsOn: string[] = [],
  state: TreeDecision["state"] = "settled",
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
    dependsOn,
    introducedBy: "interviewer",
    state,
    answer: null,
    dispositionTarget: null,
    settledAt: null,
    reopenedAt: null,
    withdrawnAt: null,
    awaitingPlacementSince: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    previousAnswers: [],
  };
}

function shape(decisions: TreeDecision[]) {
  return buildTreeOutline(decisions).rows.map(
    (row) => `${"  ".repeat(row.depth)}${row.decision.id}`,
  );
}

describe("buildTreeOutline", () => {
  it("nests a decision under the decision it depends on", () => {
    expect(shape([decision("a"), decision("b", ["a"]), decision("c", ["b"])])).toEqual([
      "a",
      "  b",
      "    c",
    ]);
  });

  it("keeps decisions with no dependencies as roots, in the order given", () => {
    expect(shape([decision("a"), decision("b")])).toEqual(["a", "b"]);
  });

  it("nests a multi-dependency decision under its first one and names the rest", () => {
    const rows = buildTreeOutline([
      decision("a"),
      decision("b"),
      decision("c"),
      decision("d", ["a", "b", "c"]),
    ]).rows;

    expect(rows.map((row) => `${row.depth}:${row.decision.id}`)).toEqual([
      "0:a",
      "1:d",
      "0:b",
      "0:c",
    ]);
    expect(
      rows
        .find((row) => row.decision.id === "d")
        ?.otherParents.map((parent) => parent.id),
    ).toEqual(["b", "c"]);
  });

  it("groups unplaced decisions apart from the outline", () => {
    const outline = buildTreeOutline([
      decision("a"),
      decision("mine", [], "unplaced"),
    ]);

    expect(outline.rows.map((row) => row.decision.id)).toEqual(["a"]);
    expect(outline.unplaced.map((entry) => entry.id)).toEqual(["mine"]);
  });

  it("ignores a dependency id that matches no decision", () => {
    expect(shape([decision("a", ["gone"])])).toEqual(["a"]);
  });

  it("shows every decision even when the links form a cycle", () => {
    expect(shape([decision("a", ["b"]), decision("b", ["a"])]).sort()).toEqual([
      "  b",
      "a",
    ]);
  });
});

describe("transitiveDependentCount", () => {
  it("counts everything downstream, directly or not", () => {
    const decisions = [
      decision("a"),
      decision("b", ["a"]),
      decision("c", ["b"]),
      decision("d"),
    ];

    expect(transitiveDependentCount(decisions, "a")).toBe(2);
    expect(transitiveDependentCount(decisions, "b")).toBe(1);
    expect(transitiveDependentCount(decisions, "d")).toBe(0);
  });
});
