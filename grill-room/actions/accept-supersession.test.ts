import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { describeDecisions } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import acceptSupersession from "./accept-supersession.js";
import answerDecision from "./answer-decision.js";
import createSession from "./create-session.js";
import dismissSupersession from "./dismiss-supersession.js";
import dispositionDecision from "./disposition-decision.js";
import getCurrentRound from "./get-current-round.js";
import listLooseEnds from "./list-loose-ends.js";
import reopenDecision from "./reopen-decision.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/*
 * `dismiss-supersession`, and every other path that has to drop a pending
 * proposal, travel with `accept-supersession`: the harness builds one database
 * per test file, and what they assert is what this action's counterpart wrote.
 */

const REASON = "The shape decision already commits to data on disk.";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

async function insertDecision(
  sessionId: string,
  overrides: Partial<typeof schema.decisions.$inferInsert> & {
    id: string;
    key: string;
    questionTitle: string;
  },
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      sessionId,
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

/** A settled decision, and a loose end carrying a supersession that points at it. */
async function aPendingSupersession(overrides: {
  looseEndKind?: "unknown" | "deferred" | "prototype-flagged" | "pushed-back";
} = {}) {
  const session = await aSession();
  await insertDecision(session.id, {
    id: "d-shape",
    key: "shape",
    questionTitle: "What shape should this take?",
    answerKind: "own-answer",
    currentAnswer: "A workspace whose data lives on disk",
    settledAt: new Date().toISOString(),
  });
  await insertDecision(session.id, {
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: overrides.looseEndKind ?? "unknown",
    currentAnswer: "Not sure yet",
    supersededById: "d-shape",
    supersessionAnswer: "On disk",
    supersessionReason: REASON,
  });
  return session;
}

const REPLACED_REASON = "Storage moved into a synced cloud folder.";

/**
 * Two settled decisions, the first carrying a proposal that the second, which
 * settled later, replaced it.
 */
async function aPendingReplacement() {
  const session = await aSession();
  // The replacing decision goes in first: the proposal column references it.
  await insertDecision(session.id, {
    id: "d-location",
    key: "storage-location",
    questionTitle: "Which disk does the data live on?",
    answerKind: "own-answer",
    currentAnswer: "A synced cloud folder",
    settledAt: "2026-09-01T00:00:02.000Z",
  });
  await insertDecision(session.id, {
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: "accepted-recommendation",
    currentAnswer: "On disk",
    settledAt: "2026-09-01T00:00:01.000Z",
    supersededById: "d-location",
    supersessionReason: REPLACED_REASON,
  });
  return session;
}

/** The lasting links, set on a row as if earlier acceptances had written them. */
const LINKS = {
  replacedById: "d-elsewhere",
  replacedReason: "Something later changed it.",
  settledById: "d-source",
};

const NO_LINKS = { replacedById: null, replacedReason: null, settledById: null };

async function setLinks(decisionId: string) {
  await getDb()
    .update(schema.decisions)
    .set(LINKS)
    .where(eq(schema.decisions.id, decisionId));
}

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

function historyOf(decisionId: string) {
  return getDb()
    .select()
    .from(schema.decisionHistory)
    .where(eq(schema.decisionHistory.decisionId, decisionId));
}

describe("accept-supersession", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      acceptSupersession.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("refuses a decision with no supersession pending", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "unknown",
    });

    await expect(
      acceptSupersession.run({ decisionId: "d-storage" }),
    ).rejects.toThrow(/has no supersession to accept/);
  });

  it("settles the loose end with the proposed answer and clears the proposal", async () => {
    const session = await aPendingSupersession();

    const view = await acceptSupersession.run({ decisionId: "d-storage" });

    expect(view).toMatchObject({
      answer: { kind: "own-answer", text: "On disk" },
      supersession: null,
      state: "settled",
    });
    const row = await readDecision("d-storage");
    expect(row).toMatchObject({
      currentAnswer: "On disk",
      answerKind: "own-answer",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(row?.settledAt).not.toBeNull();
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("records the steering move it replaced, with the interviewer's reason", async () => {
    await aPendingSupersession();

    await acceptSupersession.run({ decisionId: "d-storage" });

    expect(await historyOf("d-storage")).toMatchObject([
      {
        answer: "Not sure yet",
        answerKind: "unknown",
        interviewerReason: REASON,
      },
    ]);
  });
});

describe("accept-supersession: the lasting links", () => {
  useTestDatabase();

  it("on a settled decision a later one replaced, keeps its answer and links it to the replacement", async () => {
    const session = await aPendingReplacement();
    const before = await readDecision("d-storage");

    const view = await acceptSupersession.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject({
      currentAnswer: "On disk",
      answerKind: "accepted-recommendation",
      settledAt: before?.settledAt,
      replacedById: "d-location",
      replacedReason: REPLACED_REASON,
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      settledById: null,
    });
    expect(view).toMatchObject({
      answer: { kind: "accepted-recommendation", text: "On disk" },
      supersession: null,
      replacedBy: { id: "d-location", reason: REPLACED_REASON },
    });
    // The answer did not change, so nothing moves to history.
    expect(await historyOf("d-storage")).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("on a loose end, links it to the decision whose answer settled it", async () => {
    await aPendingSupersession();

    const view = await acceptSupersession.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject({
      settledById: "d-shape",
      replacedById: null,
      supersededById: null,
    });
    expect(view).toMatchObject({ settledBy: { id: "d-shape" } });
  });

  it("reads both links with the other decision's key and title when it is among the rows described", async () => {
    const session = await aPendingReplacement();
    await acceptSupersession.run({ decisionId: "d-storage" });
    await insertDecision(session.id, {
      id: "d-backup",
      key: "backup",
      questionTitle: "Is it backed up?",
      answerKind: "own-answer",
      currentAnswer: "The sync is the backup",
      settledAt: "2026-09-01T00:00:03.000Z",
      settledById: "d-location",
    });

    const rows = await getDb()
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, session.id));
    const views = describeDecisions(rows);

    expect(views.find((view) => view.id === "d-storage")?.replacedBy).toEqual({
      id: "d-location",
      key: "storage-location",
      title: "Which disk does the data live on?",
      reason: REPLACED_REASON,
    });
    expect(views.find((view) => view.id === "d-backup")?.settledBy).toEqual({
      id: "d-location",
      key: "storage-location",
      title: "Which disk does the data live on?",
    });
  });

  it("dismissing clears only the proposal, leaving any lasting link", async () => {
    await aPendingReplacement();
    await getDb()
      .update(schema.decisions)
      .set({ settledById: "d-source" })
      .where(eq(schema.decisions.id, "d-storage"));

    await dismissSupersession.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject({
      currentAnswer: "On disk",
      answerKind: "accepted-recommendation",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      replacedById: null,
      settledById: "d-source",
    });
  });
});

describe("dismiss-supersession", () => {
  useTestDatabase();

  it("refuses a decision with no supersession pending", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "unknown",
    });

    await expect(
      dismissSupersession.run({ decisionId: "d-storage" }),
    ).rejects.toThrow(/has no supersession to dismiss/);
  });

  it("clears the proposal and leaves the loose end exactly as open as it was", async () => {
    const session = await aPendingSupersession();

    const view = await dismissSupersession.run({ decisionId: "d-storage" });

    expect(view).toMatchObject({
      answer: { kind: "unknown", text: "Not sure yet" },
      supersession: null,
    });
    // Nothing was decided, so nothing is recorded as history.
    expect(await historyOf("d-storage")).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toMatchObject([
      { key: "storage", reason: "unknown", supersession: null },
    ]);
  });
});

describe("a pending supersession the user resolves another way", () => {
  useTestDatabase();

  it("is cleared by answering the loose end", async () => {
    await aPendingSupersession();

    const view = await answerDecision.run({
      decisionId: "d-storage",
      answer: "In memory, and that is deliberate",
    });

    expect(view).toMatchObject({
      answer: { kind: "own-answer", text: "In memory, and that is deliberate" },
      supersession: null,
    });
    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
  });

  it("is cleared by setting the loose end aside", async () => {
    await aPendingSupersession();

    const view = await dispositionDecision.run({
      decisionId: "d-storage",
      target: "out-of-scope",
      note: "Not this release.",
    });

    expect(view.supersession).toBeNull();
    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
    });
  });

  it("is cleared by reopening the decision it claimed had answered it", async () => {
    const session = await aPendingSupersession();

    await reopenDecision.run({ decisionId: "d-shape" });

    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    const looseEnds = await listLooseEnds.run({ sessionId: session.id });
    expect(
      looseEnds.find((end) => end.key === "storage")?.supersession,
    ).toBeNull();
  });
});

/**
 * The lasting links describe a decision's answer as it stands, so every write
 * that changes that answer drops them, and reopening a replacing decision
 * drops the claim that it replaced anything.
 */
describe("the lasting links, when the answer changes", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  const nothingMore: ScriptedTurn = {
    kind: "propose-round",
    result: {
      proposedDecisions: [],
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };

  /** A settled decision, and a loose end carrying both links. */
  async function aLooseEndWithLinks(
    answerKind: "unknown" | "deferred" = "unknown",
  ) {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-shape",
      key: "shape",
      questionTitle: "What shape should this take?",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: "2026-09-01T00:00:01.000Z",
    });
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind,
      currentAnswer: "",
      ...LINKS,
    });
    return session;
  }

  /** shape, and storage settled after it and hanging off it, carrying both links. */
  async function aChainWithLinks() {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-shape",
      key: "shape",
      questionTitle: "What shape should this take?",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: "2026-09-01T00:00:01.000Z",
    });
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "own-answer",
      currentAnswer: "On disk",
      dependsOnJson: JSON.stringify(["d-shape"]),
      settledAt: "2026-09-01T00:00:02.000Z",
      ...LINKS,
    });
    return session;
  }

  /** Reopens shape and answers it again, running the stale review of storage. */
  async function reopenShapeAndReview(
    sessionId: string,
    verdict: "reconfirm" | "re-ask",
  ) {
    scriptInterviewer([
      {
        kind: "review-stale",
        result: {
          reviews: [
            {
              decisionKey: "storage",
              verdict,
              reason: "A page stores differently.",
              title: verdict === "re-ask" ? "Where does a page keep its data?" : null,
              body: null,
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: null,
            },
          ],
        },
      },
      nothingMore,
    ]);
    await reopenDecision.run({ decisionId: "d-shape" });
    const open = await getCurrentRound.run({ sessionId });
    await saveDraftAnswer.run({
      decisionId: "d-shape",
      answerKind: "own-answer",
      answer: "A page, after all",
    });
    await submitRound.run({ id: open.round!.id });
  }

  it("answer-decision clears them", async () => {
    await aLooseEndWithLinks();

    await answerDecision.run({ decisionId: "d-storage", answer: "In memory" });

    expect(await readDecision("d-storage")).toMatchObject(NO_LINKS);
  });

  it("disposition-decision clears them", async () => {
    await aLooseEndWithLinks();

    await dispositionDecision.run({
      decisionId: "d-storage",
      target: "out-of-scope",
      note: "Not this release.",
    });

    expect(await readDecision("d-storage")).toMatchObject(NO_LINKS);
  });

  it("reopen-decision clears them on the reopened decision", async () => {
    await aChainWithLinks();

    await reopenDecision.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject(NO_LINKS);
  });

  it("request-next-round clears them on a deferred decision it asks again", async () => {
    const session = await aLooseEndWithLinks("deferred");
    scriptInterviewer([nothingMore]);

    const next = await requestNextRound.run({ sessionId: session.id });

    expect(next.round?.decisions.map((card) => card.key)).toEqual(["storage"]);
    expect(await readDecision("d-storage")).toMatchObject(NO_LINKS);
  });

  it("submit-round clears them on every decision it answers", async () => {
    const session = await aSession();
    scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "shape",
              title: "What shape should this take?",
              body: "",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "A workspace",
              dependsOn: [],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
      nothingMore,
    ]);
    const opened = await requestNextRound.run({ sessionId: session.id });
    const card = opened.round!.decisions[0]!;
    await setLinks(card.id);
    await saveDraftAnswer.run({
      decisionId: card.id,
      answerKind: "own-answer",
      answer: "A workspace",
    });

    await submitRound.run({ id: opened.round!.id });

    expect(await readDecision(card.id)).toMatchObject(NO_LINKS);
  });

  it("a stale review that re-asks clears them", async () => {
    const session = await aChainWithLinks();

    await reopenShapeAndReview(session.id, "re-ask");

    expect(await readDecision("d-storage")).toMatchObject({
      answerKind: null,
      ...NO_LINKS,
    });
  });

  it("a stale review that reconfirms keeps them: the answer stands", async () => {
    const session = await aChainWithLinks();

    await reopenShapeAndReview(session.id, "reconfirm");

    expect(await readDecision("d-storage")).toMatchObject({
      answerKind: "own-answer",
      currentAnswer: "On disk",
      ...LINKS,
    });
  });

  /** A pending proposal on the row, pointing at `byId`. */
  async function setProposal(decisionId: string, byId: string) {
    await getDb()
      .update(schema.decisions)
      .set({
        supersededById: byId,
        supersessionAnswer: "The answer it proposed.",
        supersessionReason: "A later decision changed it.",
      })
      .where(eq(schema.decisions.id, decisionId));
  }

  const NO_PROPOSAL = {
    supersededById: null,
    supersessionAnswer: null,
    supersessionReason: null,
  };

  it("reopen-decision clears the reopened decision's own pending proposal, so it can no longer be accepted", async () => {
    const session = await aChainWithLinks();
    await insertDecision(session.id, {
      id: "d-other",
      key: "other",
      questionTitle: "Something settled later",
      answerKind: "own-answer",
      currentAnswer: "Later",
      settledAt: "2026-09-01T00:00:03.000Z",
    });
    await setProposal("d-storage", "d-other");

    await reopenDecision.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject(NO_PROPOSAL);
    await expect(
      acceptSupersession.run({ decisionId: "d-storage" }),
    ).rejects.toThrow(/has no supersession to accept/);
  });

  it("a stale review that re-asks clears the decision's own pending proposal", async () => {
    const session = await aChainWithLinks();
    await insertDecision(session.id, {
      id: "d-other",
      key: "other",
      questionTitle: "Something settled later",
      answerKind: "own-answer",
      currentAnswer: "Later",
      settledAt: "2026-09-01T00:00:03.000Z",
    });
    await setProposal("d-storage", "d-other");

    await reopenShapeAndReview(session.id, "re-ask");

    expect(await readDecision("d-storage")).toMatchObject({
      answerKind: null,
      ...NO_PROPOSAL,
    });
  });

  it("request-next-round clears the own pending proposal of a deferred decision it asks again", async () => {
    const session = await aLooseEndWithLinks("deferred");
    await setProposal("d-storage", "d-shape");
    scriptInterviewer([nothingMore]);

    await requestNextRound.run({ sessionId: session.id });

    expect(await readDecision("d-storage")).toMatchObject(NO_PROPOSAL);
  });

  it("submit-round clears the own pending proposal of every decision it answers", async () => {
    const session = await aSession();
    scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "shape",
              title: "What shape should this take?",
              body: "",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "A workspace",
              dependsOn: [],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
      nothingMore,
    ]);
    const opened = await requestNextRound.run({ sessionId: session.id });
    const card = opened.round!.decisions[0]!;
    await setProposal(card.id, card.id);
    await saveDraftAnswer.run({
      decisionId: card.id,
      answerKind: "own-answer",
      answer: "A workspace",
    });

    await submitRound.run({ id: opened.round!.id });

    expect(await readDecision(card.id)).toMatchObject(NO_PROPOSAL);
  });

  /**
   * The chain, plus the claims other decisions hold about storage's answer: a
   * decision storage replaced, a former loose end storage settled, and a loose
   * end with a pending proposal that storage answers it.
   */
  async function aChainWithClaimsOnStorage() {
    const session = await aChainWithLinks();
    await insertDecision(session.id, {
      id: "d-old",
      key: "old-storage",
      questionTitle: "Where did the data live before?",
      answerKind: "own-answer",
      currentAnswer: "In memory",
      settledAt: "2026-09-01T00:00:00.000Z",
      replacedById: "d-storage",
      replacedReason: REPLACED_REASON,
    });
    await insertDecision(session.id, {
      id: "d-backup",
      key: "backup",
      questionTitle: "Is it backed up?",
      answerKind: "own-answer",
      currentAnswer: "Backed up with the disk",
      settledAt: "2026-09-01T00:00:03.000Z",
      settledById: "d-storage",
    });
    await insertDecision(session.id, {
      id: "d-open",
      key: "retention",
      questionTitle: "How long is data kept?",
      answerKind: "unknown",
      currentAnswer: "",
      supersededById: "d-storage",
      supersessionAnswer: "As long as it is on disk",
      supersessionReason: "Storage already answers it.",
    });
    return session;
  }

  it("a stale review that re-asks a decision clears Superseded by on what it replaced, and keeps Settled by", async () => {
    const session = await aChainWithClaimsOnStorage();

    await reopenShapeAndReview(session.id, "re-ask");

    expect(await readDecision("d-old")).toMatchObject({
      replacedById: null,
      replacedReason: null,
      currentAnswer: "In memory",
    });
    expect(await readDecision("d-backup")).toMatchObject({
      settledById: "d-storage",
    });
  });

  it("a stale review that re-asks a decision withdraws the pending proposals that name it", async () => {
    const session = await aChainWithClaimsOnStorage();

    await reopenShapeAndReview(session.id, "re-ask");

    expect(await readDecision("d-open")).toMatchObject({
      answerKind: "unknown",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
  });

  it("a proposal naming a re-asked decision can no longer be accepted", async () => {
    const session = await aChainWithClaimsOnStorage();

    await reopenShapeAndReview(session.id, "re-ask");

    await expect(
      acceptSupersession.run({ decisionId: "d-open" }),
    ).rejects.toThrow(/has no supersession to accept/);
  });

  it("a stale review that reconfirms a decision leaves the claims on it alone", async () => {
    const session = await aChainWithClaimsOnStorage();

    await reopenShapeAndReview(session.id, "reconfirm");

    expect(await readDecision("d-old")).toMatchObject({ replacedById: "d-storage" });
    expect(await readDecision("d-open")).toMatchObject({ supersededById: "d-storage" });
  });

  it("reopening a decision clears Superseded by on what it replaced, and keeps Settled by on what it settled", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "accepted-recommendation",
      currentAnswer: "On disk",
      settledAt: "2026-09-01T00:00:01.000Z",
      replacedById: "d-location",
      replacedReason: REPLACED_REASON,
    });
    await insertDecision(session.id, {
      id: "d-location",
      key: "storage-location",
      questionTitle: "Which disk does the data live on?",
      answerKind: "own-answer",
      currentAnswer: "A synced cloud folder",
      settledAt: "2026-09-01T00:00:02.000Z",
    });
    await insertDecision(session.id, {
      id: "d-backup",
      key: "backup",
      questionTitle: "Is it backed up?",
      answerKind: "own-answer",
      currentAnswer: "The sync is the backup",
      settledAt: "2026-09-01T00:00:03.000Z",
      settledById: "d-location",
    });

    await reopenDecision.run({ decisionId: "d-location" });

    expect(await readDecision("d-storage")).toMatchObject({
      replacedById: null,
      replacedReason: null,
      currentAnswer: "On disk",
    });
    expect(await readDecision("d-backup")).toMatchObject({
      settledById: "d-location",
    });
  });
});
