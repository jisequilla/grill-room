import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  findSupersededResultSchema,
  InterviewerError,
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { supersessionRejectionReasons } from "../server/supersession.js";
import { describeDecisions } from "../server/tree.js";
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

/** A settled decision, answered for real, at a given moment. */
function aSettledDecision(
  sessionId: string,
  key: string,
  settledAt: string,
  overrides: Omit<
    Partial<typeof schema.decisions.$inferInsert>,
    "id" | "key" | "questionTitle"
  > = {},
) {
  return insertDecision(sessionId, {
    id: `d-${key}`,
    key,
    questionTitle: `Title of ${key}`,
    answerKind: "own-answer",
    currentAnswer: `Answer of ${key}`,
    settledAt,
    ...overrides,
  });
}

const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-01T00:00:01.000Z";
const T2 = "2026-09-01T00:00:02.000Z";
const T3 = "2026-09-01T00:00:03.000Z";

/**
 * Two decisions answered for real, the second settled later: the first is the
 * one decision to check for replacement, and there is no loose end.
 */
async function aTreeWithOneReplaceableDecision(sessionId: string) {
  await aSettledDecision(sessionId, "storage", T1, {
    answerKind: "accepted-recommendation",
    currentAnswer: "On disk",
  });
  await aSettledDecision(sessionId, "storage-location", T2, {
    currentAnswer: "A synced cloud folder",
  });
}

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
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

  describe("as the second half of a done proposal: settled decisions a later one replaced", () => {
    it("sends every settled, unreplaced decision with a later one as replaceable, in tree order", async () => {
      const session = await aSession();
      // Created in this order, which is tree order; settled in another. The
      // creation times are explicit: two inserts can share a millisecond, and
      // the id tie-break would then put "a" first.
      await aSettledDecision(session.id, "late-first", T2, {
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      await aSettledDecision(session.id, "a", T1, {
        answerKind: "accepted-recommendation",
        createdAt: "2026-08-01T00:00:01.000Z",
      });
      await aSettledDecision(session.id, "b", T2, { replacedById: "d-c" });
      await aSettledDecision(session.id, "c", T3);
      // Set aside, not answered: never replaceable, and no later decision.
      await aSettledDecision(session.id, "hosting", T0, {
        answerKind: "dispositioned",
        dispositionTarget: "out-of-scope",
      });
      const interviewer = scriptInterviewer([DONE_PROPOSAL, replacements()]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
        "find-superseded",
      ]);
      // b is already replaced; c has nothing settled after it.
      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        looseEndKeys: [],
        replaceableKeys: ["late-first", "a"],
      });
      expect(result.state).toBe("done-proposed");
    });

    it("counts only a strictly later settlement, and runs no turn when nothing is replaceable", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "shape", T1);
      await aSettledDecision(session.id, "storage", T1);
      // A decision set aside later does not make an earlier one replaceable.
      await aSettledDecision(session.id, "hosting", T2, {
        answerKind: "dispositioned",
        dispositionTarget: "out-of-scope",
      });
      const interviewer = scriptInterviewer([DONE_PROPOSAL]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
      ]);
      expect(result.state).toBe("done-proposed");
    });

    it("runs the check with no loose ends when a decision is replaceable, and stores the replacement as a proposal", async () => {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        looseEndKeys: [],
        replaceableKeys: ["storage"],
      });
      expect(result.state).toBe("done-proposed");
      // A proposal only: the answer is exactly as it was.
      expect(await readDecision("d-storage")).toMatchObject({
        currentAnswer: "On disk",
        answerKind: "accepted-recommendation",
        settledAt: T1,
        supersededById: "d-storage-location",
        supersessionReason: "The later decision moves the data off the local disk.",
        supersessionAnswer: null,
        replacedById: null,
      });
      const rows = await getDb()
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, session.id));
      const view = describeDecisions(rows).find((d) => d.key === "storage");
      expect(view?.supersession).toMatchObject({
        kind: "replaces-settled",
        byKey: "storage-location",
      });
      // A pending replacement never blocks confirmation.
      await expect(
        confirmSession.run({ sessionId: session.id }),
      ).resolves.toBeDefined();
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

  describe("validating what comes back: replacements", () => {
    async function rejectionFor(
      entry: { replacedKey: string; byKey: string },
      extraTree: (sessionId: string) => Promise<void> = async () => {},
    ) {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      await extraTree(session.id);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        replacements(entry),
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(3);
      // The retry is stored; the rejected entry never was.
      expect(await readDecision("d-storage")).toMatchObject({
        supersededById: "d-storage-location",
      });
      return (interviewer.requests[2] as { rejectionReason: string | null })
        .rejectionReason;
    }

    it("rejects a decision the request never listed for replacement", async () => {
      expect(
        await rejectionFor({ replacedKey: "storage-location", byKey: "storage" }),
      ).toContain(
        '"storage-location" is not one of the decisions to check for replacement. Rule only on the ones listed.',
      );
    });

    it("rejects a decision replacing itself", async () => {
      expect(
        await rejectionFor({ replacedKey: "storage", byKey: "storage" }),
      ).toContain('"storage" cannot replace itself.');
    });

    it("rejects a replacing decision that was set aside", async () => {
      expect(
        await rejectionFor(
          { replacedKey: "storage", byKey: "hosting" },
          (sessionId) =>
            aSettledDecision(sessionId, "hosting", T3, {
              answerKind: "dispositioned",
              dispositionTarget: "out-of-scope",
            }),
        ),
      ).toContain(
        '"hosting" cannot replace "storage": it was set aside (dispositioned), not answered.',
      );
    });

    it("rejects a replacing decision that is not settled", async () => {
      expect(
        await rejectionFor({ replacedKey: "storage", byKey: "invented" }),
      ).toContain(
        '"invented" cannot replace "storage": it is not a settled decision of this tree.',
      );
    });

    it.each([
      ["earlier", T0],
      ["at the same moment", T1],
    ])("rejects a replacing decision that settled %s", async (_, settledAt) => {
      expect(
        await rejectionFor(
          { replacedKey: "storage", byKey: "shape" },
          (sessionId) => aSettledDecision(sessionId, "shape", settledAt),
        ),
      ).toContain('"shape" cannot replace "storage": it did not settle later.');
    });

    it("rejects a decision replaced twice", async () => {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      const twice = replacements(
        { replacedKey: "storage", byKey: "storage-location" },
        { replacedKey: "storage", byKey: "storage-location" },
      );
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        twice,
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'Decision "storage" was replaced twice. Give at most one replacing decision per decision.',
        ),
      });
    });

    it("overwrites a proposal the decision already had", async () => {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      await aSettledDecision(session.id, "sync", T3);
      await getDb()
        .update(schema.decisions)
        .set({ supersededById: "d-sync", supersessionReason: "Old guess." })
        .where(eq(schema.decisions.id, "d-storage"));
      scriptInterviewer([
        DONE_PROPOSAL,
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(await readDecision("d-storage")).toMatchObject({
        supersededById: "d-storage-location",
        supersessionReason: "The later decision moves the data off the local disk.",
      });
    });

    it("seam: a result built from exactly the fields the prompt names passes the schema and the check", () => {
      const parsed = findSupersededResultSchema.parse({
        replacements: [
          {
            replacedKey: "storage",
            byKey: "storage-location",
            reason: "The later decision moves the data off the local disk.",
          },
        ],
      });

      expect(parsed.supersessions).toEqual([]);
      expect(
        supersessionRejectionReasons({
          askedKeys: [],
          replaceableKeys: ["storage"],
          settledKeys: ["storage", "storage-location"],
          settledAtByKey: new Map([
            ["storage", T1],
            ["storage-location", T2],
          ]),
          dispositionedKeys: [],
          result: parsed,
        }),
      ).toEqual([]);
      // A recorded result from before replacements existed still parses.
      expect(
        findSupersededResultSchema.parse({ supersessions: [] }).replacements,
      ).toEqual([]);
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

    it("runs a turn of its own when there is no loose end but a replaceable decision", async () => {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      const interviewer = scriptInterviewer([
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      expect(await findSuperseded.run({ sessionId: session.id })).toEqual([]);

      expect(interviewer.requests).toMatchObject([
        { kind: "find-superseded", looseEndKeys: [], replaceableKeys: ["storage"] },
      ]);
      expect(await readDecision("d-storage")).toMatchObject({
        supersededById: "d-storage-location",
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
