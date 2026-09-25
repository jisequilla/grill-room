import { describe, expect, it } from "vitest";

import type { DecisionAnswerKind, TreeDecision } from "@/lib/decisions";
import {
  classifyHistoryEntry,
  mostRecentReAskBefore,
  reviewCompletedAt,
  reviewEvents,
  roundCardAnchorId,
  visibleReviewEvents,
} from "@/lib/review-digest";

type HistoryEntry = TreeDecision["previousAnswers"][number];

function history(
  text: string,
  kind: DecisionAnswerKind,
  recordedAt: string,
  interviewerReason: string | null = null,
  questionTitle = "Question",
  questionBody = "",
): HistoryEntry {
  return { text, kind, interviewerReason, recordedAt, questionTitle, questionBody };
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
    repo: null,
    state: "settled",
    answer: null,
    dispositionTarget: null,
    settledAt: null,
    reopenedAt: null,
    withdrawnAt: null,
    awaitingPlacementSince: null,
    supersession: null,
    replacedBy: null,
    settledBy: null,
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
      previousAnswers: [
        history("e1-answer", "own-answer", "T2", "still fits", "e1"),
      ],
      answer: { text: "e1-answer", kind: "own-answer" },
    });
    const reAsked = decision({
      id: "e2",
      dependsOn: ["d"],
      previousAnswers: [
        history("e2-old-answer", "own-answer", "T2b", "doesn't fit anymore", "e2"),
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
        title: "e1",
        retitledTo: null,
      },
      {
        decisionId: "e2",
        verdict: "re-ask",
        reason: "doesn't fit anymore",
        recordedAt: "T2b",
        title: "e2",
        retitledTo: null,
      },
    ]);
  });

  it("exposes the old title and points at the current one when a re-ask reworded the question", () => {
    const d = decision({
      id: "d",
      reopenedAt: "T1",
      previousAnswers: [history("old-d", "own-answer", "T1")],
      answer: { text: "new-d", kind: "own-answer" },
    });
    const reAsked = decision({
      id: "e",
      questionTitle: "Where does this run, exactly?",
      dependsOn: ["d"],
      previousAnswers: [
        history(
          "old-answer",
          "own-answer",
          "T2",
          "doesn't fit anymore",
          "Where does this run?",
        ),
      ],
      answer: null,
    });

    const events = reviewEvents([d, reAsked]);

    expect(events[0]!.reviewed).toEqual([
      {
        decisionId: "e",
        verdict: "re-ask",
        reason: "doesn't fit anymore",
        recordedAt: "T2",
        title: "Where does this run?",
        retitledTo: "Where does this run, exactly?",
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
        history("e-orig", "own-answer", "T2", "fits d1's reopen", "e"),
        // ...and again, later, once d2 was also reopened.
        history("e-orig", "own-answer", "T4", "doesn't fit d2's reopen", "e"),
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
        title: "e",
        retitledTo: null,
      },
    ]);
    expect(events[1]!.reviewed).toEqual([
      {
        decisionId: "e",
        verdict: "reconfirm",
        reason: "fits d1's reopen",
        recordedAt: "T2",
        title: "e",
        retitledTo: null,
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

describe("reviewCompletedAt and visibleReviewEvents", () => {
  // The exact shape `reopen-stale-review.spec.ts` drives through the UI: `d`
  // is reopened at T1, reanswered by the round submitted at T2 (so
  // `lastSubmittedAt` reads T2 the moment that submission's response lands),
  // and the stale review it triggers records its dependent's verdict at T3,
  // strictly after that same submission.
  function reopenedWithReview(): ReturnType<typeof reviewEvents> {
    const d = decision({
      id: "d",
      reopenedAt: "T1",
      previousAnswers: [history("old-d", "own-answer", "T1")],
      answer: { text: "new-d", kind: "own-answer" },
    });
    const dependent = decision({
      id: "e",
      dependsOn: ["d"],
      previousAnswers: [
        history("e-old", "own-answer", "T3", "doesn't fit anymore", "e"),
      ],
      answer: null,
    });
    return reviewEvents([d, dependent]);
  }

  it("reads a reviewed event's completed time off its latest verdict, not its reopen", () => {
    const [event] = reopenedWithReview();
    expect(reviewCompletedAt(event!)).toBe("T3");
  });

  it("falls back to the reopen time when nothing was reviewed", () => {
    const d = decision({
      id: "d",
      reopenedAt: "T1",
      previousAnswers: [history("old-d", "own-answer", "T1")],
      answer: { text: "new-d", kind: "own-answer" },
    });
    const [event] = reviewEvents([d]);
    expect(reviewCompletedAt(event!)).toBe("T1");
  });

  it("is visible on the very submission that answered the reopened decision and triggered the review", () => {
    const events = reopenedWithReview();
    // T2 is the round that reanswered `d` and ran the review — the request
    // that should first show the digest, not hide it.
    const visible = visibleReviewEvents(events, {
      lastSubmittedAt: "T2",
      dismissedReviewedAt: null,
    });
    expect(visible).toEqual(events);
  });

  it("is hidden once dismissed", () => {
    const events = reopenedWithReview();
    const visible = visibleReviewEvents(events, {
      lastSubmittedAt: "T2",
      dismissedReviewedAt: reviewCompletedAt(events[0]!),
    });
    expect(visible).toEqual([]);
  });

  it("is hidden again after a later, unrelated round is submitted", () => {
    const events = reopenedWithReview();
    const visible = visibleReviewEvents(events, {
      lastSubmittedAt: "T4",
      dismissedReviewedAt: null,
    });
    expect(visible).toEqual([]);
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
