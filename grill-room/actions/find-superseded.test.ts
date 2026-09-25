import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  InterviewerError,
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import confirmSession from "./confirm-session.js";
import createSession from "./create-session.js";
import findSuperseded from "./find-superseded.js";
import getSession from "./get-session.js";
import getTurn from "./get-turn.js";
import listLooseEnds from "./list-loose-ends.js";
import requestNextRound from "./request-next-round.js";

/*
 * `find-superseded` runs in two places: as the second half of a done proposal,
 * and as an action of its own. Both are covered here, because the done branch
 * has no behaviour of its own beyond this turn.
 */

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    model: "sonnet",
  });
}

/** Inserts a decision row directly, bypassing the interviewer and any round. */
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

/**
 * A settled decision and one loose end the user said they did not know. The
 * loose end is `unknown` rather than deferred, so a done proposal over this
 * tree is one the app will accept: a deferred decision would still be asked.
 */
async function aTreeWithOneLooseEnd(sessionId: string) {
  await insertDecision(sessionId, {
    id: "d-shape",
    key: "shape",
    questionTitle: "What shape should this take?",
    answerKind: "own-answer",
    currentAnswer: "A workspace whose data lives on disk",
    settledAt: new Date().toISOString(),
  });
  await insertDecision(sessionId, {
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: "unknown",
    currentAnswer: "Not sure yet",
  });
}

const DONE_PROPOSAL = {
  kind: "propose-round" as const,
  result: {
    proposedDecisions: [],
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: { summary: "The shape is settled." },
  },
};

function supersessions(
  ...entries: {
    looseEndKey: string;
    answeredByKey: string;
    answer?: string;
    reason?: string;
  }[]
) {
  return {
    kind: "find-superseded" as const,
    result: {
      supersessions: entries.map((entry) => ({
        answer: "On disk",
        reason: "The shape decision already commits to data on disk.",
        ...entry,
      })),
      replacements: [],
    },
  };
}

function replacements(
  ...entries: { replacedKey: string; byKey: string; reason?: string }[]
) {
  return {
    kind: "find-superseded" as const,
    result: {
      supersessions: [],
      replacements: entries.map((entry) => ({
        reason: "The later decision moves the data off the local disk.",
        ...entry,
      })),
    },
  };
}

describe("find-superseded", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  describe("as the second half of a done proposal", () => {
    it("asks for supersessions after the proposal, and stores them as proposals that leave the loose end open", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
        "find-superseded",
      ]);
      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        looseEndKeys: ["storage"],
        rejectionReason: null,
      });
      expect(result.state).toBe("done-proposed");

      // A proposal, not an answer: the decision is exactly as open as it was.
      const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
      expect(looseEnd).toMatchObject({
        key: "storage",
        reason: "unknown",
        answer: { kind: "unknown", text: "Not sure yet" },
        supersession: {
          byId: "d-shape",
          byKey: "shape",
          byTitle: "What shape should this take?",
          answer: "On disk",
          reason: "The shape decision already commits to data on disk.",
        },
      });
    });

    it("still refuses to confirm while a superseded loose end is only proposed", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      await expect(
        confirmSession.run({ sessionId: session.id }),
      ).rejects.toThrow(/1 loose end still block confirmation/);
    });

    it("does not ask at all when the session has no loose end it could apply to", async () => {
      const session = await aSession();
      await insertDecision(session.id, {
        id: "d-shape",
        key: "shape",
        questionTitle: "What shape should this take?",
        answerKind: "own-answer",
        currentAnswer: "A workspace",
        settledAt: new Date().toISOString(),
      });
      const interviewer = scriptInterviewer([DONE_PROPOSAL]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
      ]);
      expect(result.state).toBe("done-proposed");
    });

    it("keeps the done proposal and records the error when the second turn fails", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        DONE_PROPOSAL,
        {
          kind: "find-superseded",
          error: new InterviewerError(
            "rate-limited",
            "The Claude subscription is rate limited.",
          ),
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.state).toBe("done-proposed");
      expect(result.doneSummary).toBe("The shape is settled.");
      expect(await getSession.run({ id: session.id })).toMatchObject({
        state: "done-proposed",
        doneSummary: "The shape is settled.",
        // Idle, not failed: the proposal itself succeeded, and the error is
        // only there to explain why nothing was found.
        turnStatus: "idle",
        turnErrorCode: "rate-limited",
      });
      const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
      expect(looseEnd?.supersession).toBeNull();
    });
  });

  describe("validating what comes back", () => {
    it("rejects a loose end the request never listed, and retries with the reason", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "invented", answeredByKey: "shape" }),
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(3);
      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'is not one of the loose ends in this request',
        ),
      });
      const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
      expect(looseEnd?.supersession).toMatchObject({ byKey: "shape" });
    });

    it("rejects a superseding decision that is not settled, and retries with the reason", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      await insertDecision(session.id, {
        id: "d-tone",
        key: "tone",
        questionTitle: "How blunt should it be?",
      });
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "storage", answeredByKey: "tone" }),
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      // A never-answered decision on the frontier would block a done proposal,
      // so this one hangs off the loose end and is blocked rather than asked.
      await getDb()
        .update(schema.decisions)
        .set({ dependsOnJson: JSON.stringify(["d-storage"]) })
        .where(eq(schema.decisions.id, "d-tone"));

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining(
          "it is not a settled decision of this tree",
        ),
      });
    });

    it("rejects a superseding decision that was dispositioned, and retries with the reason", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      await insertDecision(session.id, {
        id: "d-hosting",
        key: "hosting",
        questionTitle: "Where does this run?",
        answerKind: "dispositioned",
        dispositionTarget: "out-of-scope",
        settledAt: new Date().toISOString(),
      });
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "storage", answeredByKey: "hosting" }),
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining(
          "it was set aside (dispositioned), not answered",
        ),
      });
      const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
      expect(looseEnd?.supersession).toMatchObject({ byKey: "shape" });
    });

    it("rejects a decision superseded twice, and gives up after two retries storing nothing", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      const twice = supersessions(
        { looseEndKey: "storage", answeredByKey: "shape" },
        { looseEndKey: "storage", answeredByKey: "shape" },
      );
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        twice,
        twice,
        twice,
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(4);
      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining("was superseded twice"),
      });
      // The done proposal survives the failure; nothing was stored.
      expect(result.state).toBe("done-proposed");
      expect(await getSession.run({ id: session.id })).toMatchObject({
        state: "done-proposed",
        turnStatus: "idle",
        turnErrorCode: "invalid-supersession",
      });
      const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
      expect(looseEnd?.supersession).toBeNull();
    });
  });

  describe("as an action of its own", () => {
    it("throws for a session id that does not exist", async () => {
      await expect(
        findSuperseded.run({ sessionId: "missing" }),
      ).rejects.toThrow("Session not found: missing");
    });

    it("refuses while a turn is working", async () => {
      const session = await aSession();
      await getDb()
        .update(schema.sessions)
        .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, session.id));

      await expect(
        findSuperseded.run({ sessionId: session.id }),
      ).rejects.toThrow(/interviewer is working/);
    });

    it("refuses a session that is neither interviewing nor done-proposed", async () => {
      const session = await aSession();
      await getDb()
        .update(schema.sessions)
        .set({ state: "confirmed" })
        .where(eq(schema.sessions.id, session.id));

      await expect(
        findSuperseded.run({ sessionId: session.id }),
      ).rejects.toThrow(/This session is confirmed/);
    });

    it("runs a turn of its own and returns the loose ends with what it found", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      const interviewer = scriptInterviewer([
        supersessions({
          looseEndKey: "storage",
          answeredByKey: "shape",
          answer: "On disk, in the workspace's own database",
        }),
      ]);

      const looseEnds = await findSuperseded.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "find-superseded",
      ]);
      expect(looseEnds).toHaveLength(1);
      expect(looseEnds[0]?.supersession).toMatchObject({
        byKey: "shape",
        answer: "On disk, in the workspace's own database",
      });
      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "idle",
      });
    });

    it("asks nothing when the session has no loose end it could apply to", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([]);

      expect(await findSuperseded.run({ sessionId: session.id })).toEqual([]);
      expect(interviewer.requests).toHaveLength(0);
    });

    it("marks the turn failed when the interviewer fails", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        {
          kind: "find-superseded",
          error: new InterviewerError(
            "rate-limited",
            "The Claude subscription is rate limited.",
          ),
        },
      ]);

      await expect(
        findSuperseded.run({ sessionId: session.id }),
      ).rejects.toThrow(/rate limited/);

      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "rate-limited",
      });
    });
  });

  describe("turn records", () => {
    it("records a clean standalone check as one successful attempt, on the session's model, linked to the session", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      await findSuperseded.run({ sessionId: session.id });

      const latest = await findLatestTurn({
        sessionId: session.id,
        turnKind: "find-superseded",
      });
      expect(latest).not.toBeNull();
      const turn = await getTurn.run({ turnId: latest!.id });
      expect(turn).toMatchObject({
        sessionId: session.id,
        turnKind: "find-superseded",
        model: session.model,
        outcome: "succeeded",
      });
      expect(turn.runs).toHaveLength(1);
      expect(turn.runs[0]!.attempts).toEqual([
        expect.objectContaining({ attemptNumber: 1, kind: "success" }),
      ]);
      expect(
        (await getSession.run({ id: session.id })).supersessionTurnId,
      ).toBe(turn.id);
    });

    it("records the done branch's check as its own find-superseded turn, separate from the propose-round turn", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        DONE_PROPOSAL,
        supersessions({ looseEndKey: "storage", answeredByKey: "shape" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      const proposeTurn = await findLatestTurn({
        sessionId: session.id,
        turnKind: "propose-round",
      });
      const supersessionTurn = await findLatestTurn({
        sessionId: session.id,
        turnKind: "find-superseded",
      });
      expect(proposeTurn).not.toBeNull();
      expect(supersessionTurn).not.toBeNull();
      expect(supersessionTurn!.id).not.toBe(proposeTurn!.id);
      expect(supersessionTurn!.outcome).toBe("succeeded");
      expect(supersessionTurn!.runs[0]!.attempts).toEqual([
        expect.objectContaining({ kind: "success" }),
      ]);
      expect(
        (await getSession.run({ id: session.id })).supersessionTurnId,
      ).toBe(supersessionTurn!.id);
    });

    it("stops the standalone check on a rate limit with its own kind and keeps the record", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      scriptInterviewer([
        {
          kind: "find-superseded",
          error: new InterviewerError(
            "rate-limited",
            "The Claude subscription is rate limited.",
          ),
        },
      ]);

      await expect(
        findSuperseded.run({ sessionId: session.id }),
      ).rejects.toThrow(/rate limited/);

      const latest = await findLatestTurn({
        sessionId: session.id,
        turnKind: "find-superseded",
      });
      expect(latest).not.toBeNull();
      expect(latest!.outcome).toBe("rate-limited");
      expect(latest!.runs[0]!.attempts).toEqual([
        expect.objectContaining({ kind: "rate-limit" }),
      ]);
      expect(
        (await getSession.run({ id: session.id })).supersessionTurnId,
      ).toBeNull();
    });

    it("records nothing when the session has no loose end it could apply to", async () => {
      const session = await aSession();
      scriptInterviewer([]);

      await findSuperseded.run({ sessionId: session.id });

      expect(
        await findLatestTurn({
          sessionId: session.id,
          turnKind: "find-superseded",
        }),
      ).toBeNull();
    });
  });
});
