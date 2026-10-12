import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type FakeInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import reopenDecision from "./reopen-decision.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/**
 * While `failRoundDecisionsInsert` is set, an insert into the round-decisions
 * table throws, whether it goes through `getDb()` or a transaction opened on
 * it: the one way to make a reopen fail after its other writes.
 */
const placing = vi.hoisted(() => ({ failRoundDecisionsInsert: false }));

vi.mock("../server/db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/db/index.js")>();
  // `getDb()` may hand back a lazy chain-recording proxy (itself a function)
  // while the database starts: its members are passed through untouched.
  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === "function" && typeof target !== "function" ? value.bind(target) : value;
  };
  const failing = <Handle extends object>(handle: Handle): Handle =>
    new Proxy(handle, {
      get(target, prop) {
        if (prop === "insert") {
          return (table: unknown) => {
            if (placing.failRoundDecisionsInsert && table === original.schema.roundDecisions) {
              throw new Error("placing failed");
            }
            return (target as { insert: (t: unknown) => unknown }).insert(table);
          };
        }
        if (prop === "transaction") {
          return (callback: (tx: object) => Promise<unknown>, ...rest: unknown[]) =>
            (Reflect.get(target, prop) as (...args: unknown[]) => Promise<unknown>).call(
              target,
              (tx: object) => callback(failing(tx)),
              ...rest,
            );
        }
        return bind(target, prop);
      },
    });
  return { ...original, getDb: () => failing(original.getDb()) };
});

/** One round proposing one question, which is all these tests need per turn. */
function proposal(key: string, dependsOn: string[] = []): ScriptedTurn {
  return {
    kind: "propose-round",
    result: {
      proposedDecisions: [
        {
          key,
          title: `Question ${key}`,
          body: `The body of ${key}`,
          choices: [],
          recommendedChoice: null,
          recommendedAnswer: `The usual answer to ${key}`,
          dependsOn,
          ask: true,
        },
      ],
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
}

const nothingMore: ScriptedTurn = {
  kind: "propose-round",
  result: {
    proposedDecisions: [],
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: null,
  },
};

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** Answers whatever the open round asks, and submits it. */
async function answerOpenRound(sessionId: string, answer: string) {
  const open = await getCurrentRound.run({ sessionId });
  for (const card of open.round?.decisions ?? []) {
    await saveDraftAnswer.run({
      decisionId: card.id,
      answerKind: "own-answer",
      answer,
    });
  }
  return submitRound.run({ id: open.round!.id });
}

/**
 * A session whose chain shape -> storage -> sync is settled, each answered in
 * its own round. `trailing` is what the interviewer says after the last one.
 */
async function aSettledChain(trailing: ScriptedTurn = nothingMore): Promise<{
  sessionId: string;
  interviewer: FakeInterviewer;
}> {
  const session = await aSession();
  const interviewer = scriptInterviewer([
    proposal("shape"),
    proposal("storage", ["shape"]),
    proposal("sync", ["storage"]),
    trailing,
  ]);

  await requestNextRound.run({ sessionId: session.id });
  await answerOpenRound(session.id, "A workspace");
  await answerOpenRound(session.id, "On disk");
  await answerOpenRound(session.id, "Poll");

  return { sessionId: session.id, interviewer };
}

async function statesOf(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return Object.fromEntries(
    tree.decisions.map((decision) => [decision.key, decision.state]),
  );
}

async function decisionId(sessionId: string, key: string) {
  const tree = await getTree.run({ sessionId });
  return tree.decisions.find((decision) => decision.key === key)!.id;
}

describe("reopen-decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  afterEach(() => {
    placing.failRoundDecisionsInsert = false;
  });

  it("throws for a decision id that does not exist", async () => {
    await expect(
      reopenDecision.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("puts a settled decision back on the frontier and everything under it in doubt", async () => {
    const { sessionId } = await aSettledChain();

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(await statesOf(sessionId)).toEqual({
      shape: "frontier",
      storage: "stale",
      sync: "stale",
    });
  });

  it("asks the question again as a round of its own, without troubling the interviewer", async () => {
    const { sessionId, interviewer } = await aSettledChain();
    const before = interviewer.requests.length;

    const result = await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(result.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
    expect(result.round?.decisions[0]).toMatchObject({
      questionTitle: "Question shape",
      state: "frontier",
      draft: null,
    });
    expect(interviewer.requests).toHaveLength(before);
  });

  it("appends the question to the round already open instead of opening another", async () => {
    // The interviewer's last word opens a round that is still unanswered.
    const { sessionId, interviewer } = await aSettledChain(proposal("tone"));
    const before = interviewer.requests.length;

    const result = await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(result.round?.decisions.map((card) => card.key)).toEqual([
      "tone",
      "shape",
    ]);
    expect(interviewer.requests).toHaveLength(before);
    expect(
      await getDb()
        .select()
        .from(schema.rounds)
        .where(eq(schema.rounds.sessionId, sessionId)),
    ).toHaveLength(4);
  });

  it("returns a session that had proposed done to interviewing, and clears the summary", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({
        state: "done-proposed",
        doneSummary: "Nothing left, we thought.",
      })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(await getSession.run({ id: sessionId })).toMatchObject({
      state: "interviewing",
      doneSummary: null,
    });
  });

  it("returns a confirmed session to interviewing, so a late realisation is not locked out, and clears the summary", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({
        state: "confirmed",
        doneSummary: "Nothing left, we thought.",
      })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "sync"),
    });

    expect(await getSession.run({ id: sessionId })).toMatchObject({
      state: "interviewing",
      doneSummary: null,
    });
  });

  it("marks an existing spec not current when reopening a decision in a confirmed session", async () => {
    const { sessionId } = await aSettledChain();
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId));
    expect(spec).toMatchObject({ current: false });
  });

  it("marks an existing spec not current when reopening a decision in a done-proposed session", async () => {
    const { sessionId } = await aSettledChain();
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed" })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId));
    expect(spec).toMatchObject({ current: false });
  });

  it("refuses a decision that was never settled", async () => {
    const session = await aSession();
    scriptInterviewer([proposal("shape")]);
    const opened = await requestNextRound.run({ sessionId: session.id });

    await expect(
      reopenDecision.run({ decisionId: opened.round!.decisions[0]!.id }),
    ).rejects.toThrow(/Only a decision that has been settled can be reopened/);
  });

  it("refuses a decision a push back's response withdrew", async () => {
    const { sessionId } = await aSettledChain();
    const withdrawn = await decisionId(sessionId, "storage");
    await getDb()
      .update(schema.decisions)
      .set({ withdrawnAt: new Date().toISOString() })
      .where(eq(schema.decisions.id, withdrawn));

    await expect(
      reopenDecision.run({ decisionId: withdrawn }),
    ).rejects.toThrow(/can be reopened\. "Question storage" is withdrawn\./);
  });

  it("refuses a decision the user added that the interviewer has not placed yet", async () => {
    const session = await aSession();
    const added = await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
      body: "Came to me in the shower.",
    });

    await expect(
      reopenDecision.run({ decisionId: added.id }),
    ).rejects.toThrow(/is unplaced\./);
  });

  it("refuses while the interviewer is working", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      reopenDecision.run({
        decisionId: await decisionId(sessionId, "shape"),
      }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("rolls back the reopen when placing it fails", async () => {
    const { sessionId } = await aSettledChain();
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed", doneSummary: "Nothing left, we thought." })
      .where(eq(schema.sessions.id, sessionId));
    const shapeId = await decisionId(sessionId, "shape");
    const snapshot = async () => ({
      decision: await getDb().select().from(schema.decisions).where(eq(schema.decisions.id, shapeId)),
      history: await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, shapeId)),
      session: await getDb().select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
      spec: await getDb().select().from(schema.specs).where(eq(schema.specs.sessionId, sessionId)),
      rounds: await getDb().select().from(schema.rounds).where(eq(schema.rounds.sessionId, sessionId)),
    });
    const before = await snapshot();
    expect(before.rounds.filter((round) => round.submissionState === "open")).toEqual([]);
    expect(before.session[0]).toMatchObject({ state: "done-proposed" });
    expect(before.spec[0]).toMatchObject({ current: true });

    placing.failRoundDecisionsInsert = true;
    await expect(reopenDecision.run({ decisionId: shapeId })).rejects.toThrow("placing failed");
    placing.failRoundDecisionsInsert = false;

    expect(await snapshot()).toEqual(before);
  });
});
