import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  findSupersededResultSchema,
  InterviewerError,
  resetInterviewer,
  scriptInterviewer,
  type FindSupersededRequest,
} from "../server/interviewer/index.js";
import {
  deferrableDecisions,
  supersessionRejectionReasons,
} from "../server/supersession.js";
import { describeDecisions } from "../server/tree.js";
import { findLatestTurn } from "../server/turn-records.js";
import { MAX_TURN_RETRIES, portKey } from "../server/turn.js";
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
      deferrals: [],
    },
  };
}

const DEFERRAL_REASON =
  "The answer waits on dispute handling instead of choosing a hold period.";

function deferrals(...entries: { key: string; reason?: string }[]) {
  return {
    kind: "find-superseded" as const,
    result: {
      supersessions: [],
      replacements: [],
      deferrals: entries.map((entry) => ({ reason: DEFERRAL_REASON, ...entry })),
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
      deferrals: [],
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
          kind: "answers-loose-end",
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
      // An accepted recommendation, not an own answer: an own answer is
      // always checked for a deferral.
      await insertDecision(session.id, {
        id: "d-shape",
        key: "shape",
        questionTitle: "What shape should this take?",
        answerKind: "accepted-recommendation",
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
      // Each one's possible replacers, in tree order: b counts although it
      // was itself replaced.
      expect((interviewer.requests[1] as FindSupersededRequest).laterKeys).toEqual({
        "late-first": ["c"],
        a: ["late-first", "b", "c"],
      });
      expect(result.state).toBe("done-proposed");
    });

    it("counts a later decision that was itself replaced, when it is the only later one", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "shape", T1);
      await aSettledDecision(session.id, "storage", T2, {
        replacedById: "d-elsewhere",
      });
      const interviewer = scriptInterviewer([DONE_PROPOSAL, replacements()]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        replaceableKeys: ["shape"],
      });
      expect((interviewer.requests[1] as FindSupersededRequest).laterKeys).toEqual({
        shape: ["storage"],
      });
    });

    it("never offers a kept repo decision, as replaceable or as a replacer", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "stack", T0, {
        answerKind: "repo-established",
        introducedBy: "repo",
        repoSource: "recorded",
        repoCitation: "AGENTS.md:12",
        repoStatement: "The app is a React Router app.",
      });
      await aSettledDecision(session.id, "shape", T1);
      await aSettledDecision(session.id, "repo-late", T3, {
        answerKind: "repo-established",
        introducedBy: "repo",
        repoSource: "recorded",
        repoCitation: "AGENTS.md:14",
        repoStatement: "Data lives in Postgres.",
      });
      await aSettledDecision(session.id, "storage", T2);
      const interviewer = scriptInterviewer([DONE_PROPOSAL, replacements()]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        replaceableKeys: ["shape"],
      });
      expect((interviewer.requests[1] as FindSupersededRequest).laterKeys).toEqual({
        shape: ["storage"],
      });
    });

    it("leaves a stale decision out of the replaceable set", async () => {
      const session = await aSession();
      // Reopened at T1 and answered again at T3: what hangs off it and settled
      // before the reopen is stale.
      await aSettledDecision(session.id, "shape", T3, { reopenedAt: T1 });
      await aSettledDecision(session.id, "storage", T0, {
        dependsOnJson: JSON.stringify(["d-shape"]),
      });
      await aSettledDecision(session.id, "tone", T2);
      const interviewer = scriptInterviewer([replacements()]);

      await findSuperseded.run({ sessionId: session.id });

      expect(interviewer.requests[0]).toMatchObject({
        kind: "find-superseded",
        replaceableKeys: ["tone"],
      });
      expect((interviewer.requests[0] as FindSupersededRequest).laterKeys).toEqual({
        tone: ["shape"],
      });
    });

    it("counts only a strictly later settlement, and runs no turn when nothing is replaceable", async () => {
      const session = await aSession();
      // Accepted recommendations, so neither is checked for a deferral.
      await aSettledDecision(session.id, "shape", T1, {
        answerKind: "accepted-recommendation",
      });
      await aSettledDecision(session.id, "storage", T1, {
        answerKind: "accepted-recommendation",
      });
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
      ).toContain(
        '"shape" cannot replace "storage": it is not one of the decisions listed after it.',
      );
    });

    it("rejects a kept repo decision as the replacer", async () => {
      expect(
        await rejectionFor(
          { replacedKey: "storage", byKey: "stack" },
          (sessionId) =>
            aSettledDecision(sessionId, "stack", T3, {
              answerKind: "repo-established",
              introducedBy: "repo",
              repoSource: "recorded",
              repoCitation: "AGENTS.md:12",
              repoStatement: "Data lives in a synced folder.",
            }),
        ),
      ).toContain(
        '"stack" cannot replace "storage": only an interview answer can replace one.',
      );
    });

    it("rejects a replacer that exists but is still open", async () => {
      const session = await aSession();
      await aTreeWithOneReplaceableDecision(session.id);
      await insertDecision(session.id, {
        id: "d-tone",
        key: "tone",
        questionTitle: "How blunt should it be?",
      });
      const interviewer = scriptInterviewer([
        replacements({ replacedKey: "storage", byKey: "tone" }),
        replacements({ replacedKey: "storage", byKey: "storage-location" }),
      ]);

      await findSuperseded.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          '"tone" cannot replace "storage": it is not a settled decision of this tree.',
        ),
      });
    });

    it("after the last retry, keeps the valid entries, drops the invalid replacements and says so in the attempt log", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "shape", T3);
      await insertDecision(session.id, {
        id: "d-storage-open",
        key: "storage-open",
        questionTitle: "Where are backups kept?",
        answerKind: "unknown",
        currentAnswer: "Not sure yet",
      });
      await aSettledDecision(session.id, "early", T0);
      await aTreeWithOneReplaceableDecision(session.id);
      const stillWrong = {
        kind: "find-superseded" as const,
        result: {
          supersessions: [
            {
              looseEndKey: "storage-open",
              answeredByKey: "shape",
              answer: "On disk",
              reason: "The shape decision already commits to data on disk.",
            },
          ],
          replacements: [
            {
              replacedKey: "storage",
              byKey: "storage-location",
              reason: "The later decision moves the data off the local disk.",
            },
            { replacedKey: "early", byKey: "early", reason: "Itself." },
          ],
          deferrals: [],
        },
      };
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        ...Array.from({ length: MAX_TURN_RETRIES + 1 }, () => stillWrong),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(MAX_TURN_RETRIES + 2);
      expect(result.state).toBe("done-proposed");
      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnErrorCode: null,
      });
      // The valid loose-end supersession and the valid replacement are stored.
      expect(await readDecision("d-storage-open")).toMatchObject({
        supersededById: "d-shape",
      });
      expect(await readDecision("d-storage")).toMatchObject({
        supersededById: "d-storage-location",
      });
      // The invalid one is dropped, and the last attempt says so.
      expect(await readDecision("d-early")).toMatchObject({
        supersededById: null,
      });
      const turn = await findLatestTurn({
        sessionId: session.id,
        turnKind: "find-superseded",
      });
      expect(turn?.outcome).toBe("succeeded");
      const attempts = turn!.runs[0]!.attempts;
      expect(attempts).toHaveLength(MAX_TURN_RETRIES + 1);
      expect(attempts[attempts.length - 1]).toMatchObject({
        kind: "success",
        reason:
          'Kept the valid entries after the last retry. Dropped this replacement: "early" by "early" ("early" cannot replace itself.)',
      });
    });

    it("still fails the scan when a loose-end entry stays invalid after the last retry", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "shape", T3);
      await insertDecision(session.id, {
        id: "d-storage-open",
        key: "storage-open",
        questionTitle: "Where are backups kept?",
        answerKind: "unknown",
        currentAnswer: "Not sure yet",
      });
      await aTreeWithOneReplaceableDecision(session.id);
      const stillWrong = {
        kind: "find-superseded" as const,
        result: {
          supersessions: [
            {
              looseEndKey: "storage-open",
              answeredByKey: "invented",
              answer: "On disk",
              reason: "Invented.",
            },
          ],
          replacements: [
            {
              replacedKey: "storage",
              byKey: "storage-location",
              reason: "The later decision moves the data off the local disk.",
            },
          ],
          deferrals: [],
        },
      };
      scriptInterviewer([
        DONE_PROPOSAL,
        ...Array.from({ length: MAX_TURN_RETRIES + 1 }, () => stillWrong),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnErrorCode: "invalid-supersession",
      });
      expect(await readDecision("d-storage")).toMatchObject({
        supersededById: null,
      });
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
          laterKeys: { storage: ["storage-location"] },
          deferrableKeys: [],
          settledKeys: ["storage", "storage-location"],
          dispositionedKeys: [],
          repoEstablishedKeys: [],
          result: parsed,
        }),
      ).toEqual([]);
      // A recorded result from before replacements existed still parses.
      expect(
        findSupersededResultSchema.parse({ supersessions: [] }).replacements,
      ).toEqual([]);
    });
  });

  describe("own answers that defer: which are checked", () => {
    async function sessionRows(sessionId: string) {
      return getDb()
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, sessionId))
        .orderBy(schema.decisions.createdAt, schema.decisions.id);
    }

    it("holds exactly the settled, unreplaced own answers with nothing pending, in tree order", async () => {
      const session = await aSession();
      const created = (second: number) =>
        `2026-08-01T00:00:${String(second).padStart(2, "0")}.000Z`;
      await aSettledDecision(session.id, "late-own", T2, { createdAt: created(0) });
      await aSettledDecision(session.id, "own", T1, { createdAt: created(1) });
      await aSettledDecision(session.id, "recommended", T1, {
        answerKind: "accepted-recommendation",
        createdAt: created(2),
      });
      await aSettledDecision(session.id, "set-aside", T1, {
        answerKind: "dispositioned",
        dispositionTarget: "out-of-scope",
        createdAt: created(3),
      });
      await aSettledDecision(session.id, "repo", T1, {
        answerKind: "repo-established",
        introducedBy: "repo",
        repoSource: "recorded",
        repoCitation: "AGENTS.md:1",
        repoStatement: "Data lives in Postgres.",
        createdAt: created(4),
      });
      await insertDecision(session.id, {
        id: "d-loose",
        key: "loose",
        questionTitle: "Title of loose",
        answerKind: "deferred",
        currentAnswer: "Later",
        createdAt: created(5),
      });
      await aSettledDecision(session.id, "replaced", T1, {
        replacedById: "d-late-own",
        createdAt: created(6),
      });
      await aSettledDecision(session.id, "supersession-pending", T1, {
        supersededById: "d-late-own",
        supersessionReason: "Replaced later.",
        createdAt: created(7),
      });
      await aSettledDecision(session.id, "deferral-pending", T1, {
        deferralReason: "Waits on something.",
        createdAt: created(8),
      });
      // Reopened at T1 after this settled at T0: stale, not settled.
      await aSettledDecision(session.id, "parent", T3, {
        reopenedAt: T1,
        answerKind: "accepted-recommendation",
        createdAt: created(9),
      });
      await aSettledDecision(session.id, "stale", T0, {
        dependsOnJson: JSON.stringify(["d-parent"]),
        createdAt: created(10),
      });
      await aSettledDecision(session.id, "withdrawn", T1, {
        withdrawnAt: T2,
        createdAt: created(11),
      });

      expect(deferrableDecisions(await sessionRows(session.id)).map(portKey)).toEqual(
        ["late-own", "own"],
      );
    });

    it("sends the deferrable own answers with the done proposal's check, in tree order", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "hold", T1, {
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      await aSettledDecision(session.id, "service", T1, {
        answerKind: "accepted-recommendation",
        createdAt: "2026-08-01T00:00:01.000Z",
      });
      await aSettledDecision(session.id, "vetting", T1, {
        createdAt: "2026-08-01T00:00:02.000Z",
      });
      const interviewer = scriptInterviewer([DONE_PROPOSAL, deferrals()]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        kind: "find-superseded",
        looseEndKeys: [],
        replaceableKeys: [],
        deferrableKeys: ["hold", "vetting"],
      });
    });

    it("never offers a decision with a pending deferral for replacement", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "hold", T1, {
        currentAnswer: "Wait until dispute handling is settled",
        deferralReason: DEFERRAL_REASON,
      });
      await aSettledDecision(session.id, "disputes", T2);
      const interviewer = scriptInterviewer([
        replacements({ replacedKey: "hold", byKey: "disputes" }),
        deferrals(),
      ]);

      await findSuperseded.run({ sessionId: session.id });

      expect(interviewer.requests[0]).toMatchObject({
        kind: "find-superseded",
        replaceableKeys: [],
        deferrableKeys: ["disputes"],
      });
      expect((interviewer.requests[0] as FindSupersededRequest).laterKeys).toEqual(
        {},
      );
      // The replacement it was offered anyway is refused, and never stored.
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          '"hold" is not one of the decisions to check for replacement.',
        ),
      });
      expect(await readDecision("d-hold")).toMatchObject({
        supersededById: null,
        deferralReason: DEFERRAL_REASON,
      });
    });

    it("runs the check when a deferrable own answer is the only thing to check", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "hold", T1);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        deferrals({ key: "hold" }),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
        "find-superseded",
      ]);
      expect(result.state).toBe("done-proposed");
      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: DEFERRAL_REASON,
      });
    });
  });

  describe("own answers that defer: what comes back", () => {
    /** Two own answers, the only candidates, settled in one round. */
    async function aTreeWithTwoOwnAnswers(sessionId: string) {
      await aSettledDecision(sessionId, "hold", T1, {
        currentAnswer: "Wait until dispute handling is settled",
      });
      await aSettledDecision(sessionId, "service", T1, {
        currentAnswer: "Dog walking",
      });
    }

    it("stores a valid deferral as a proposal and changes nothing else", async () => {
      const session = await aSession();
      await aTreeWithTwoOwnAnswers(session.id);
      scriptInterviewer([DONE_PROPOSAL, deferrals({ key: "hold" })]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.state).toBe("done-proposed");
      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: DEFERRAL_REASON,
        currentAnswer: "Wait until dispute handling is settled",
        answerKind: "own-answer",
        settledAt: T1,
        supersededById: null,
        supersessionAnswer: null,
        supersessionReason: null,
        replacedById: null,
      });
      expect(await readDecision("d-service")).toMatchObject({
        deferralReason: null,
        answerKind: "own-answer",
      });
      // Still settled: nothing blocks confirmation while it is pending.
      expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
      const rows = await getDb()
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, session.id));
      expect(describeDecisions(rows).find((d) => d.key === "hold")).toMatchObject({
        state: "settled",
        deferralReason: DEFERRAL_REASON,
      });
    });

    async function rejectionFor(
      wrong: ReturnType<typeof deferrals>,
      extraTree: (sessionId: string) => Promise<void> = async () => {},
    ) {
      const session = await aSession();
      await aTreeWithTwoOwnAnswers(session.id);
      await extraTree(session.id);
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        wrong,
        deferrals({ key: "hold" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(3);
      // The retry is stored; the rejected entry never was.
      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: DEFERRAL_REASON,
      });
      return (interviewer.requests[2] as { rejectionReason: string | null })
        .rejectionReason;
    }

    it("rejects a key the request never listed, and asks again", async () => {
      expect(await rejectionFor(deferrals({ key: "invented" }))).toContain(
        '"invented" is not one of the own answers to check for a deferral. Rule only on the ones listed.',
      );
    });

    it("rejects an accepted recommendation, which was never listed", async () => {
      expect(
        await rejectionFor(deferrals({ key: "tone" }), (sessionId) =>
          aSettledDecision(sessionId, "tone", T1, {
            answerKind: "accepted-recommendation",
          }),
        ),
      ).toContain('"tone" is not one of the own answers to check for a deferral.');
    });

    it("rejects a decision flagged twice, and asks again", async () => {
      expect(
        await rejectionFor(deferrals({ key: "hold" }, { key: "hold" })),
      ).toContain(
        'Decision "hold" was flagged as a deferral twice. Give at most one deferral per decision.',
      );
    });

    it("rejects a decision both replaced and flagged, and asks again", async () => {
      const session = await aSession();
      await aSettledDecision(session.id, "hold", T1, {
        currentAnswer: "Wait until dispute handling is settled",
      });
      await aSettledDecision(session.id, "disputes", T2);
      const both = {
        kind: "find-superseded" as const,
        result: {
          supersessions: [],
          replacements: [
            { replacedKey: "hold", byKey: "disputes", reason: "Disputes changed it." },
          ],
          deferrals: [{ key: "hold", reason: DEFERRAL_REASON }],
        },
      };
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        both,
        deferrals({ key: "hold" }),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[2]).toMatchObject({
        rejectionReason: expect.stringContaining(
          '"hold" is both replaced and flagged as a deferral. Give it one or the other.',
        ),
      });
      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: DEFERRAL_REASON,
        supersededById: null,
      });
    });

    it("after the last retry, keeps the valid deferral, drops the invalid one and says so in the attempt log", async () => {
      const session = await aSession();
      await aTreeWithTwoOwnAnswers(session.id);
      // A decision of the tree, but an accepted recommendation: never listed.
      await aSettledDecision(session.id, "tone", T1, {
        answerKind: "accepted-recommendation",
      });
      const stillWrong = deferrals({ key: "hold" }, { key: "tone" });
      const interviewer = scriptInterviewer([
        DONE_PROPOSAL,
        ...Array.from({ length: MAX_TURN_RETRIES + 1 }, () => stillWrong),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(MAX_TURN_RETRIES + 2);
      expect(result.state).toBe("done-proposed");
      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnErrorCode: null,
      });
      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: DEFERRAL_REASON,
      });
      expect(await readDecision("d-tone")).toMatchObject({
        deferralReason: null,
      });
      const turn = await findLatestTurn({
        sessionId: session.id,
        turnKind: "find-superseded",
      });
      expect(turn?.outcome).toBe("succeeded");
      const attempts = turn!.runs[0]!.attempts;
      expect(attempts[attempts.length - 1]).toMatchObject({
        kind: "success",
        reason:
          'Kept the valid entries after the last retry. Dropped this deferral: "tone" ("tone" is not one of the own answers to check for a deferral. Rule only on the ones listed.)',
      });
    });

    /**
     * Runs one result on every attempt, so the last one is judged by the
     * last-retry drop, and returns the attempt log's closing line.
     */
    async function lastRetryOf(
      sessionId: string,
      result: {
        replacements: { replacedKey: string; byKey: string; reason: string }[];
        deferrals: { key: string; reason: string }[];
      },
    ) {
      scriptInterviewer([
        DONE_PROPOSAL,
        ...Array.from({ length: MAX_TURN_RETRIES + 1 }, () => ({
          kind: "find-superseded" as const,
          result: { supersessions: [], ...result },
        })),
      ]);

      const done = await requestNextRound.run({ sessionId });

      expect(done.state).toBe("done-proposed");
      expect(await getSession.run({ id: sessionId })).toMatchObject({
        turnErrorCode: null,
      });
      const turn = await findLatestTurn({
        sessionId,
        turnKind: "find-superseded",
      });
      expect(turn?.outcome).toBe("succeeded");
      const attempts = turn!.runs[0]!.attempts;
      expect(attempts).toHaveLength(MAX_TURN_RETRIES + 1);
      return attempts[attempts.length - 1];
    }

    /** hold, an own answer, and disputes, settled after it: hold is replaceable and deferrable. */
    async function aTreeWhereHoldIsBoth(sessionId: string) {
      await aSettledDecision(sessionId, "hold", T1, {
        currentAnswer: "Wait until dispute handling is settled",
      });
      await aSettledDecision(sessionId, "disputes", T2);
    }

    it("after the last retry, keeps the first of two deferrals of one decision and drops the second", async () => {
      const session = await aSession();
      await aTreeWithTwoOwnAnswers(session.id);

      const last = await lastRetryOf(session.id, {
        replacements: [],
        deferrals: [
          { key: "hold", reason: "First: it waits on dispute handling." },
          { key: "hold", reason: "Second: it waits on the payment provider." },
        ],
      });

      expect(await readDecision("d-hold")).toMatchObject({
        deferralReason: "First: it waits on dispute handling.",
      });
      expect(last).toMatchObject({
        kind: "success",
        reason:
          'Kept the valid entries after the last retry. Dropped this deferral: "hold" (Decision "hold" was flagged as a deferral twice. Give at most one deferral per decision.)',
      });
    });

    it("after the last retry, keeps a valid replacement and drops the deferral of the same decision", async () => {
      const session = await aSession();
      await aTreeWhereHoldIsBoth(session.id);

      const last = await lastRetryOf(session.id, {
        replacements: [
          { replacedKey: "hold", byKey: "disputes", reason: "Disputes decide it." },
        ],
        deferrals: [{ key: "hold", reason: DEFERRAL_REASON }],
      });

      expect(await readDecision("d-hold")).toMatchObject({
        supersededById: "d-disputes",
        supersessionReason: "Disputes decide it.",
        deferralReason: null,
      });
      expect(last).toMatchObject({
        kind: "success",
        reason:
          'Kept the valid entries after the last retry. Dropped this deferral: "hold" ("hold" is both replaced and flagged as a deferral. Give it one or the other.)',
      });
    });

    it("after the last retry, drops the deferral of a decision whose replacement is itself dropped", async () => {
      const session = await aSession();
      await aTreeWhereHoldIsBoth(session.id);

      const last = await lastRetryOf(session.id, {
        replacements: [{ replacedKey: "hold", byKey: "hold", reason: "Itself." }],
        deferrals: [{ key: "hold", reason: DEFERRAL_REASON }],
      });

      expect(await readDecision("d-hold")).toMatchObject({
        supersededById: null,
        deferralReason: null,
      });
      expect(last).toMatchObject({
        kind: "success",
        reason:
          'Kept the valid entries after the last retry. Dropped this replacement: "hold" by "hold" ("hold" cannot replace itself.); and this deferral: "hold" ("hold" is both replaced and flagged as a deferral. Give it one or the other.)',
      });
    });

    it("still fails the scan when a loose-end entry stays invalid after the last retry, storing no deferral", async () => {
      const session = await aSession();
      await aTreeWithOneLooseEnd(session.id);
      const stillWrong = {
        kind: "find-superseded" as const,
        result: {
          supersessions: [
            {
              looseEndKey: "storage",
              answeredByKey: "invented",
              answer: "On disk",
              reason: "Invented.",
            },
          ],
          replacements: [],
          deferrals: [{ key: "shape", reason: DEFERRAL_REASON }],
        },
      };
      scriptInterviewer([
        DONE_PROPOSAL,
        ...Array.from({ length: MAX_TURN_RETRIES + 1 }, () => stillWrong),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnErrorCode: "invalid-supersession",
      });
      expect(await readDecision("d-shape")).toMatchObject({
        deferralReason: null,
      });
    });

    it("seam: every deferral shape the prompt describes passes the check for a request built from the same rows", async () => {
      const session = await aSession();
      await aTreeWithTwoOwnAnswers(session.id);
      const rows = await getDb()
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, session.id))
        .orderBy(schema.decisions.createdAt, schema.decisions.id);
      const deferrableKeys = deferrableDecisions(rows).map(portKey);

      // What the prompt asks for: one entry per listed key, naming it in
      // `key` and saying in `reason` what the answer waits on.
      const parsed = findSupersededResultSchema.parse({
        deferrals: deferrableKeys.map((key) => ({
          key,
          reason: `The answer for ${key} waits on dispute handling.`,
        })),
      });

      expect(deferrableKeys).toEqual(["hold", "service"]);
      expect(parsed.supersessions).toEqual([]);
      expect(parsed.replacements).toEqual([]);
      expect(
        supersessionRejectionReasons({
          askedKeys: [],
          replaceableKeys: [],
          laterKeys: {},
          deferrableKeys,
          settledKeys: rows.map(portKey),
          dispositionedKeys: [],
          repoEstablishedKeys: [],
          result: parsed,
        }),
      ).toEqual([]);
      // A result with only the other two lists, as recorded before deferrals
      // existed, still parses.
      expect(
        findSupersededResultSchema.parse({ supersessions: [], replacements: [] })
          .deferrals,
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
