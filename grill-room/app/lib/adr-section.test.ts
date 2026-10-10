import { describe, expect, it } from "vitest";

import { adrSectionView } from "@/lib/adr-section";
import type { DecisionAnswerKind, DecisionState } from "@/lib/decisions";

type Input = Parameters<typeof adrSectionView>[0];

function aDecision(overrides: Partial<Input> = {}): Input {
  return {
    id: "d1",
    state: "settled",
    answer: { kind: "own-answer", text: "x" },
    replacedBy: null,
    adrWorthy: false,
    consequences: null,
    ...overrides,
  } as Input;
}

const NOT_SETTLED = "workspace.adrLockedNotSettled";
const REPLACED = "workspace.adrLockedReplaced";

function locked(reason: string, consequences: string, adrWorthy = false) {
  return {
    editable: false,
    lockedReasonKey: reason,
    saveEnabled: false,
    showRequiredHint: false,
    saveInput: { decisionId: "d1", adrWorthy, consequences },
  };
}

describe("adrSectionView editability", () => {
  const states: DecisionState[] = [
    "frontier",
    "blocked",
    "stale",
    "withdrawn",
    "unplaced",
  ];
  for (const state of states) {
    it(`is locked as not settled in state ${state}`, () => {
      const view = adrSectionView(aDecision({ state }), {
        adrWorthy: false,
        consequences: "edit",
      });
      expect(view).toEqual(locked(NOT_SETTLED, "edit"));
    });
  }

  const editableKinds: DecisionAnswerKind[] = [
    "accepted-recommendation",
    "own-answer",
    "repo-established",
  ];
  for (const kind of editableKinds) {
    it(`is editable for a settled ${kind}`, () => {
      const view = adrSectionView(
        aDecision({ answer: { kind, text: "x" } as Input["answer"] }),
        { adrWorthy: false, consequences: "" },
      );
      expect(view).toEqual({
        editable: true,
        lockedReasonKey: null,
        saveEnabled: false,
        showRequiredHint: false,
        saveInput: { decisionId: "d1", adrWorthy: false, consequences: "" },
      });
    });
  }

  const lockedKinds: DecisionAnswerKind[] = [
    "unknown",
    "pushed-back",
    "deferred",
    "prototype-flagged",
    "dispositioned",
  ];
  for (const kind of lockedKinds) {
    it(`is locked as not settled for a settled ${kind}`, () => {
      const view = adrSectionView(
        aDecision({ answer: { kind, text: "x" } as Input["answer"] }),
        { adrWorthy: false, consequences: "" },
      );
      expect(view).toEqual(locked(NOT_SETTLED, ""));
    });
  }

  it("is locked for a settled decision with a null answer", () => {
    const view = adrSectionView(aDecision({ answer: null }), {
      adrWorthy: false,
      consequences: "",
    });
    expect(view).toEqual(locked(NOT_SETTLED, ""));
  });

  it("is locked as replaced when replacedBy is set", () => {
    const view = adrSectionView(
      aDecision({
        replacedBy: { id: "d2", key: "k", title: "t", reason: "r" },
      }),
      { adrWorthy: false, consequences: "" },
    );
    expect(view).toEqual(locked(REPLACED, ""));
  });
});

describe("adrSectionView draft", () => {
  it("disables Save when the draft equals the stored values", () => {
    const view = adrSectionView(
      aDecision({ adrWorthy: true, consequences: "Costly." }),
      { adrWorthy: true, consequences: "Costly." },
    );
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: false,
      showRequiredHint: false,
      saveInput: { decisionId: "d1", adrWorthy: true, consequences: "Costly." },
    });
  });

  it("treats a stored null Consequences as an empty textarea", () => {
    const view = adrSectionView(aDecision({ consequences: null }), {
      adrWorthy: false,
      consequences: "",
    });
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: false,
      showRequiredHint: false,
      saveInput: { decisionId: "d1", adrWorthy: false, consequences: "" },
    });
  });

  it("disables Save and shows the hint when checked with blank Consequences", () => {
    const view = adrSectionView(aDecision(), {
      adrWorthy: true,
      consequences: "   ",
    });
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: false,
      showRequiredHint: true,
      saveInput: { decisionId: "d1", adrWorthy: true, consequences: "   " },
    });
  });

  it("shows the hint for a flagged decision whose Consequences were cleared", () => {
    const view = adrSectionView(
      aDecision({ adrWorthy: true, consequences: "Costly." }),
      { adrWorthy: true, consequences: "" },
    );
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: false,
      showRequiredHint: true,
      saveInput: { decisionId: "d1", adrWorthy: true, consequences: "" },
    });
  });

  it("enables Save when unchecked and the Consequences were edited", () => {
    const view = adrSectionView(aDecision({ consequences: null }), {
      adrWorthy: false,
      consequences: "A note.",
    });
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: true,
      showRequiredHint: false,
      saveInput: { decisionId: "d1", adrWorthy: false, consequences: "A note." },
    });
  });

  it("enables Save for a plain change and sends the text as typed", () => {
    const view = adrSectionView(aDecision(), {
      adrWorthy: true,
      consequences: "  Costly.  ",
    });
    expect(view).toEqual({
      editable: true,
      lockedReasonKey: null,
      saveEnabled: true,
      showRequiredHint: false,
      saveInput: {
        decisionId: "d1",
        adrWorthy: true,
        consequences: "  Costly.  ",
      },
    });
  });
});
