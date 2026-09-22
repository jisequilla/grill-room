import { describe, expect, it } from "vitest";

import type { DecisionAnswerKind, TreeDecision } from "@/lib/decisions";
import {
  classifyHistoryEntry,
  mostRecentReAskBefore,
  reviewEvents,
  roundCardAnchorId,
} from "@/lib/review-digest";

type HistoryEntry = TreeDecision["previousAnswers"][number];

function history(
  text: string,
  kind: DecisionAnswerKind,
  recordedAt: string,
  interviewerReason: string | null = null,
): HistoryEntry {
  return { text, kind, interviewerReason, recordedAt };
}

function decision(overrides: Partial<TreeDecision> = {}): TreeDecision {
  const id = overrides.id ?? "decision";
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
    answer: null,
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

describe("classifyHistoryEntry", () => {
  it("returns null for an entry with no interviewer reason", () => {
    const d = decision({
      previousAnswers: [history("old", "own-answer", "T1")],
      answer: { text: "old", kind: "own-answer" },
    });
    expect(classifyHistoryEntry(d, 0)).toBeNull();
  });

  it("reads a reconfirm off the answer staying the same", () => {
    const d = decision({
      previousAnswers: [
        history("kept", "own-answer", "T2", "still fits after the reopen"),
      ],
      answer: { text: "kept", kind: "own-answer" },
    });
    expect(classifyHistoryEntry(d, 0)).toBe("reconfirm");
  });

  it("reads a re-ask off the answer being cleared", () => {
    const d = decision({
      previousAnswers: [
        history("stale-answer", "own-answer", "T2", "doesn't fit anymore"),
      ],
      answer: null,
    });
    expect(classifyHistoryEntry(d, 0)).toBe("re-ask");
  });

  it("reads a re-ask off a later, different answer", () => {
    // The dependent was re-asked, then later given a fresh answer — which
    // writes no history entry of its own, so the verdict is read against the
    // decision's current live answer.
    const d = decision({
      previousAnswers: [
        history("old-answer", "own-answer", "T2", "needs a new take"),
      ],
      answer: { text: "fresh-answer", kind: "accepted-recommendation" },
    });
    expect(classifyHistoryEntry(d, 0)).toBe("re-ask");
  });

  it("prefers the next history entry over the live answer when there is one", () => {
    const d = decision({
      previousAnswers: [
        history("kept", "own-answer", "T2", "reconfirmed under the first reopen"),
        // A later, unrelated reopen of this same decision: its own record
        // shows the answer was still "kept" right before that reopen, so the
        // earlier entry reads as a reconfirm even though the *live* answer is
        // now cleared.
        history("kept", "own-answer", "T3"),
      ],
      answer: null,
    });
    expect(classifyHistoryEntry(d, 0)).toBe("reconfirm");
  });

  it("does not label a push-back's withdrawal as a reconfirm", () => {
    // A push-back response also carries a non-empty interviewerReason, and
    // leaves the answer kind/text untouched while marking the decision
    // withdrawn — indistinguishable from a reconfirm by shape alone. Only the
    // *last* entry of a withdrawn decision can be this case, since nothing is
    // ever recorded against a decision again once it leaves the tree.
    const d = decision({
      withdrawnAt: "T2",
      previousAnswers: [
        history("wrong premise", "pushed-back", "T2", "withdrawing this one"),
      ],
      answer: { text: "wrong premise", kind: "pushed-back" },
    });
    expect(classifyHistoryEntry(d, 0)).toBeNull();
  });

  it("still classifies an earlier review entry of a decision later pushed back", () => {
    const d = decision({
      withdrawnAt: "T3",
      previousAnswers: [
        history("kept", "own-answer", "T2", "reconfirmed under a reopen"),
        history("kept", "own-answer", "T3", "withdrawing this one"),
      ],
      answer: { text: "kept", kind: "own-answer" },
    });
    expect(classifyHistoryEntry(d, 0)).toBe("reconfirm");
    expect(classifyHistoryEntry(d, 1)).toBeNull();
  });
});

describe("reviewEvents", () => {
  it("returns nothing for a tree with no reopen", () => {
    const decisions = [decision({ id: "a" }), decision({ id: "b", dependsOn: ["a"] })];
    expect(reviewEvents(decisions)).toEqual([]);
  });

  it("groups one reopen's mixed verdicts into one event", () => {
    const d = decision({
      id: "d",
      reopenedAt: "T1",
      previousAnswers: [history("old-d", "own-answer", "T1")],
      answer: { text: "new-d", kind: "own-answer" },
    });
    const reconfirmed = decision({
      id: "e1",
      dependsOn: ["d"],
      previousAnswers: [history("e1-answer", "own-answer", "T2", "still fits")],
      answer: { text: "e1-answer", kind: "own-answer" },
    });
    const reAsked = decision({
      id: "e2",
      dependsOn: ["d"],
      previousAnswers: [
        history("e2-old-answer", "own-answer", "T2b", "doesn't fit anymore"),
      ],
      answer: null,
    });

    const events = reviewEvents([d, reconfirmed, reAsked]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "d@T1",
      reopenedId: "d",
      reopenedAt: "T1",
      oldAnswer: { text: "old-d", kind: "own-answer" },
      newAnswer: { text: "new-d", kind: "own-answer" },
    });
    expect(events[0]!.reviewed).toEqual([
      {
        decisionId: "e1",
        verdict: "reconfirm",
        reason: "still fits",
        recordedAt: "T2",
      },
      {
        decisionId: "e2",
        verdict: "re-ask",
        reason: "doesn't fit anymore",
        recordedAt: "T2b",
      },
    ]);
  });

  it("attributes a shared dependent's two reviews to the reopen each followed, newest first", () => {
    const d1 = decision({
      id: "d1",
      reopenedAt: "T1",
      previousAnswers: [history("d1-old", "own-answer", "T1")],
      answer: { text: "d1-new", kind: "own-answer" },
    });
    const d2 = decision({
      id: "d2",
      reopenedAt: "T3",
      previousAnswers: [history("d2-old", "own-answer", "T3")],
      answer: { text: "d2-new", kind: "own-answer" },
    });
    const dependent = decision({
      id: "e",
      dependsOn: ["d1", "d2"],
      previousAnswers: [
        // Reviewed once under d1's reopen (before d2 was ever reopened)...
        history("e-orig", "own-answer", "T2", "fits d1's reopen"),
        // ...and again, later, once d2 was also reopened.
        history("e-orig", "own-answer", "T4", "doesn't fit d2's reopen"),
      ],
      answer: null,
    });

    const events = reviewEvents([d1, d2, dependent]);

    expect(events.map((event) => event.id)).toEqual(["d2@T3", "d1@T1"]);
    expect(events[0]!.reviewed).toEqual([
      {
        decisionId: "e",
        verdict: "re-ask",
        reason: "doesn't fit d2's reopen",
        recordedAt: "T4",
      },
    ]);
    expect(events[1]!.reviewed).toEqual([
      {
        decisionId: "e",
        verdict: "reconfirm",
        reason: "fits d1's reopen",
        recordedAt: "T2",
      },
    ]);
  });

  it("holds off on an event until the reopened decision is answered again", () => {
    const d = decision({
      id: "d",
      reopenedAt: "T1",
      previousAnswers: [history("old-d", "own-answer", "T1")],
      answer: null,
    });
    expect(reviewEvents([d])).toEqual([]);
  });
});

describe("mostRecentReAskBefore", () => {
  it("finds the re-ask that explains a question resurfacing in a round", () => {
    const d = decision({
      previousAnswers: [
        history("old-answer", "own-answer", "T2", "doesn't fit anymore"),
      ],
      answer: null,
    });
    expect(mostRecentReAskBefore(d, "T3")).toEqual({
      reason: "doesn't fit anymore",
      recordedAt: "T2",
    });
  });

  it("ignores a reconfirm and a re-ask recorded after the round started", () => {
    const reconfirmed = decision({
      previousAnswers: [history("kept", "own-answer", "T2", "still fits")],
      answer: { text: "kept", kind: "own-answer" },
    });
    expect(mostRecentReAskBefore(reconfirmed, "T3")).toBeNull();

    const tooLate = decision({
      previousAnswers: [
        history("old-answer", "own-answer", "T5", "doesn't fit anymore"),
      ],
      answer: null,
    });
    expect(mostRecentReAskBefore(tooLate, "T3")).toBeNull();
  });
});

describe("roundCardAnchorId", () => {
  it("is stable and unique per decision", () => {
    expect(roundCardAnchorId("abc")).toBe("round-card-abc");
    expect(roundCardAnchorId("abc")).not.toBe(roundCardAnchorId("def"));
  });
});
