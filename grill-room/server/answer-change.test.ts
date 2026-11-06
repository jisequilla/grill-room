import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import { LEAVE_IT_TO_THE_BUILDER } from "../shared/session-constants.js";
import { defer, moveSetAside, reword, settle, unsettle, withdraw } from "./answer-change.js";
import { picksLeaveItToTheBuilder } from "./tree.js";

/**
 * While `active`, every `getDb()` handle records the queries made through it
 * (`outside`) and every transaction it opens (`transactions`), and hands that
 * transaction's callback a wrapper recording the queries made through the
 * transaction (`inside`). The embedded database runs one connection, so a
 * query that skipped the transaction would still roll back with it; only
 * these records show which handle it used. `failSpecUpdate` makes the
 * transaction's update of the specs table throw.
 */
const spy = vi.hoisted(() => ({
  active: false,
  failSpecUpdate: false,
  transactions: 0,
  outside: [] as string[],
  inside: [] as string[],
}));

vi.mock("./db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db/index.js")>();
  // `getDb()` may hand back a lazy chain-recording proxy (itself a function)
  // while the database starts: its members are passed through untouched.
  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === "function" && typeof target !== "function" ? value.bind(target) : value;
  };
  const name = (table: unknown) =>
    (
      [
        [original.schema.decisions, "decisions"],
        [original.schema.decisionHistory, "decisionHistory"],
        [original.schema.specs, "specs"],
        [original.schema.sessions, "sessions"],
      ] as const
    ).find(([candidate]) => candidate === table)?.[1] ?? "other";
  const QUERIES = new Set(["select", "insert", "update", "delete"]);
  const recordingTx = (tx: object) =>
    new Proxy(tx, {
      get(inner, prop) {
        if (typeof prop !== "string" || !QUERIES.has(prop)) return bind(inner, prop);
        return (...args: unknown[]) => {
          spy.inside.push(prop === "select" ? "select" : `${prop} ${name(args[0])}`);
          if (spy.failSpecUpdate && prop === "update" && args[0] === original.schema.specs) {
            throw new Error("spec update failed");
          }
          return (Reflect.get(inner, prop) as (...a: unknown[]) => unknown).apply(inner, args);
        };
      },
    });
  const getDb = () => {
    const db = original.getDb();
    if (!spy.active) return db;
    return new Proxy(db, {
      get(target, prop) {
        if (prop === "transaction") {
          return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => {
            spy.transactions += 1;
            return (target.transaction as (...args: unknown[]) => Promise<unknown>)(
              (tx: object) => callback(recordingTx(tx)),
              ...rest,
            );
          };
        }
        if (typeof prop === "string" && QUERIES.has(prop)) spy.outside.push(prop);
        return bind(target, prop);
      },
    });
  };
  return { ...original, getDb };
});

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";

const S = "session-s";
const X = "decision-x";
const Y = "decision-y";
const Z = "decision-z";
const N = "decision-n";
/** The decisions F's links name: U, U2, V, V2, W, and Q for row 2. */
const OTHERS = ["decision-u", "decision-u2", "decision-v", "decision-v2", "decision-w", "decision-q"];

type DecisionInsert = typeof schema.decisions.$inferInsert;

function decision(id: string, overrides: Partial<DecisionInsert> = {}): DecisionInsert {
  return {
    id,
    sessionId: S,
    key: id,
    questionTitle: `Question ${id}`,
    questionBody: `Body ${id}`,
    dependsOnJson: "[]",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/**
 * Fixture F, with `x` overriding X's columns, `session` S's, and `spec: false`
 * leaving the spec out.
 */
async function fixture(
  options: {
    x?: Partial<DecisionInsert>;
    session?: Partial<typeof schema.sessions.$inferInsert>;
    spec?: boolean;
  } = {},
) {
  const db = getDb();
  await db.insert(schema.sessions).values({
    id: S,
    title: "Grill Room",
    idea: "A local app.",
    state: "done-proposed",
    doneSummary: "Nothing left.",
    createdAt: T0,
    updatedAt: T0,
    ...options.session,
  });
  if (options.spec !== false) {
    await db.insert(schema.specs).values({
      id: "spec-s",
      sessionId: S,
      markdown: "# Spec\n",
      current: true,
      createdAt: T0,
      updatedAt: T0,
    });
  }
  // The links name real rows: every link column references a decision.
  await db
    .insert(schema.decisions)
    .values(OTHERS.map((id) => decision(id, { currentAnswer: `${id} answer`, answerKind: "own-answer", settledAt: T0 })));
  await db.insert(schema.decisions).values([
    decision(X, {
      currentAnswer: "A",
      answerKind: "accepted-recommendation",
      settledAt: T1,
      reopenedAt: T0,
      dispositionTarget: null,
      settledById: "decision-w",
      replacedById: "decision-v",
      replacedReason: "r",
      deferralReason: "d",
      restatementText: "t",
      restatementNotes: "t notes",
      restatementReason: "t reason",
      supersededById: "decision-u",
      supersessionAnswer: "u answer",
      supersessionReason: "u reason",
      ...options.x,
    }),
    decision(Y, {
      supersededById: X,
      supersessionAnswer: "y answer",
      supersessionReason: "y reason",
    }),
    decision(Z, { replacedById: X, replacedReason: "z" }),
    decision(N, {
      supersededById: "decision-u2",
      supersessionAnswer: "n answer",
      supersessionReason: "n reason",
      replacedById: "decision-v2",
      replacedReason: "n replaced",
    }),
  ]);
}

const DISPOSITIONED = {
  answerKind: "dispositioned",
  dispositionTarget: "open-question",
} as const;

async function row(id: string) {
  const [found] = await getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id));
  return found!;
}

async function historyOf(id: string) {
  return getDb()
    .select()
    .from(schema.decisionHistory)
    .where(eq(schema.decisionHistory.decisionId, id));
}

async function specs() {
  return getDb().select().from(schema.specs);
}

async function sessionRow() {
  const [found] = await getDb().select().from(schema.sessions).where(eq(schema.sessions.id, S));
  return found!;
}

/** Every row the fixture holds, to compare before and after a rolled-back change. */
async function everything() {
  const db = getDb();
  return {
    decisions: await db.select().from(schema.decisions).orderBy(schema.decisions.id),
    history: await db.select().from(schema.decisionHistory),
    specs: await db.select().from(schema.specs),
    sessions: await db.select().from(schema.sessions),
  };
}

const OWN_PROPOSALS_CLEARED = {
  deferralReason: null,
  restatementText: null,
  restatementNotes: null,
  restatementReason: null,
  supersededById: null,
  supersessionAnswer: null,
  supersessionReason: null,
};

const LINKS_CLEARED = { settledById: null, replacedById: null, replacedReason: null };

async function expectYAndZCleared() {
  expect(await row(Y)).toMatchObject({
    supersededById: null,
    supersessionAnswer: null,
    supersessionReason: null,
  });
  expect(await row(Z)).toMatchObject({ replacedById: null, replacedReason: null });
}

async function expectNUnchanged() {
  expect(await row(N)).toMatchObject({
    supersededById: "decision-u2",
    supersessionAnswer: "n answer",
    supersessionReason: "n reason",
    replacedById: "decision-v2",
    replacedReason: "n replaced",
  });
}

async function expectSpecNotCurrent() {
  expect(await specs()).toMatchObject([{ current: false }]);
}

async function expectSessionUntouched(state = "done-proposed") {
  expect(await sessionRow()).toMatchObject({ state, doneSummary: "Nothing left.", updatedAt: T0 });
}

describe("answer change", () => {
  useTestDatabase();
  afterEach(() => {
    spy.active = false;
    spy.failSpecUpdate = false;
    spy.transactions = 0;
    spy.outside.length = 0;
    spy.inside.length = 0;
  });

  it("throws for a decision id that does not exist", async () => {
    await fixture();
    await expect(settle("missing", { answer: "B", kind: "own-answer" }, { now: T2 })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("row 1: settle writes the answer, clears proposals and links, records history, withdraws claims and marks the spec", async () => {
    await fixture();

    const written = await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    expect(written).toEqual(await row(X));
    expect(written).toMatchObject({
      currentAnswer: "B",
      answerKind: "own-answer",
      settledAt: T2,
      reopenedAt: T0,
      ...OWN_PROPOSALS_CLEARED,
      ...LINKS_CLEARED,
    });
    expect(await historyOf(X)).toMatchObject([
      {
        questionTitle: `Question ${X}`,
        questionBody: `Body ${X}`,
        answer: "A",
        answerKind: "accepted-recommendation",
        interviewerReason: null,
        operatorNotes: null,
        recordedAt: T2,
      },
    ]);
    await expectYAndZCleared();
    await expectNUnchanged();
    await expectSpecNotCurrent();
    await expectSessionUntouched();
  });

  it("row 2: settle with settledById records where the answer came from", async () => {
    await fixture();

    const written = await settle(
      X,
      { answer: "B", kind: "own-answer", settledById: "decision-q" },
      { now: T2 },
    );

    expect(written).toMatchObject({
      currentAnswer: "B",
      answerKind: "own-answer",
      settledAt: T2,
      reopenedAt: T0,
      ...OWN_PROPOSALS_CLEARED,
      settledById: "decision-q",
      replacedById: null,
      replacedReason: null,
    });
    expect(await historyOf(X)).toHaveLength(1);
    await expectYAndZCleared();
    await expectNUnchanged();
    await expectSpecNotCurrent();
    await expectSessionUntouched();
  });

  it("row 3: settle with a kind that does not settle leaves settledAt null", async () => {
    await fixture();

    const written = await settle(X, { answer: "B", kind: "unknown" }, { now: T2 });

    expect(written).toMatchObject({ answerKind: "unknown", settledAt: null });
  });

  it("row 4: settle as dispositioned sets the given target", async () => {
    await fixture({ x: DISPOSITIONED });

    const written = await settle(
      X,
      { answer: "B", kind: "dispositioned", dispositionTarget: "out-of-scope" },
      { now: T2 },
    );

    expect(written).toMatchObject({ dispositionTarget: "out-of-scope" });
  });

  it("row 5: settle as another kind drops the disposition target", async () => {
    await fixture({ x: DISPOSITIONED });

    const written = await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    expect(written).toMatchObject({ dispositionTarget: null });
  });

  it("row 6: defer keeps the answer text, clears settledAt, and records the reason", async () => {
    await fixture();

    const written = await defer(X, { now: T2, reason: "later" });

    expect(written).toMatchObject({
      currentAnswer: "A",
      answerKind: "deferred",
      settledAt: null,
      reopenedAt: T0,
      ...OWN_PROPOSALS_CLEARED,
      ...LINKS_CLEARED,
    });
    expect(await historyOf(X)).toMatchObject([
      { answer: "A", answerKind: "accepted-recommendation", interviewerReason: "later", operatorNotes: null },
    ]);
    await expectYAndZCleared();
    await expectNUnchanged();
    await expectSpecNotCurrent();
  });

  it("row 7: defer drops the disposition target", async () => {
    await fixture({ x: DISPOSITIONED });

    const written = await defer(X, { now: T2 });

    expect(written).toMatchObject({ dispositionTarget: null });
  });

  it("row 8: reword replaces the text, keeps links and replaced-by records, and withdraws only supersessions", async () => {
    await fixture();

    const written = await reword(X, { text: "A2", notes: "" }, { now: T2, reason: "tidy" });

    expect(written).toMatchObject({
      currentAnswer: "A2",
      answerKind: "accepted-recommendation",
      settledAt: T1,
      reopenedAt: T0,
      ...OWN_PROPOSALS_CLEARED,
      settledById: "decision-w",
      replacedById: "decision-v",
      replacedReason: "r",
    });
    expect(await historyOf(X)).toMatchObject([
      { answer: "A", answerKind: "accepted-recommendation", interviewerReason: "tidy", operatorNotes: "" },
    ]);
    expect(await row(Y)).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(await row(Z)).toMatchObject({ replacedById: X, replacedReason: "z" });
    await expectNUnchanged();
    await expectSpecNotCurrent();
  });

  it("row 9: unsettle clears the answer and stamps a settled decision reopened", async () => {
    await fixture();

    const written = await unsettle(X, { now: T2 });

    expect(written).toMatchObject({
      currentAnswer: null,
      answerKind: null,
      dispositionTarget: null,
      settledAt: null,
      reopenedAt: T2,
      ...OWN_PROPOSALS_CLEARED,
      ...LINKS_CLEARED,
    });
    expect(await historyOf(X)).toMatchObject([
      { answer: "A", answerKind: "accepted-recommendation", interviewerReason: null, operatorNotes: null },
    ]);
    await expectYAndZCleared();
    await expectNUnchanged();
    await expectSpecNotCurrent();
  });

  it("row 10: unsettle drops the disposition target", async () => {
    await fixture({ x: DISPOSITIONED });

    const written = await unsettle(X, { now: T2 });

    expect(written).toMatchObject({ dispositionTarget: null });
  });

  it("row 11: unsettle leaves reopenedAt alone for a deferred decision", async () => {
    await fixture({ x: { answerKind: "deferred", settledAt: null } });

    const written = await unsettle(X, { now: T2 });

    expect(written).toMatchObject({ reopenedAt: T0 });
  });

  it("row 12: unsettle stamps reopenedAt for a settling kind with no settledAt", async () => {
    await fixture({ x: { settledAt: null } });

    const written = await unsettle(X, { now: T2 });

    expect(written).toMatchObject({ reopenedAt: T2 });
  });

  it("row 13: withdraw stamps withdrawnAt and keeps the answer, kind and target", async () => {
    await fixture({ x: DISPOSITIONED });

    const written = await withdraw(X, { now: T2, reason: "pushed back" });

    expect(written).toMatchObject({
      withdrawnAt: T2,
      currentAnswer: "A",
      answerKind: "dispositioned",
      dispositionTarget: "open-question",
      settledAt: T1,
      reopenedAt: T0,
      ...OWN_PROPOSALS_CLEARED,
      ...LINKS_CLEARED,
    });
    expect(await historyOf(X)).toMatchObject([
      { answer: "A", answerKind: "dispositioned", interviewerReason: "pushed back", operatorNotes: null },
    ]);
    await expectYAndZCleared();
    await expectNUnchanged();
    await expectSpecNotCurrent();
  });

  it("row 14: no history row when the decision had no answer and no kind", async () => {
    await fixture({ x: { currentAnswer: null, answerKind: null } });

    await settle(X, { answer: "A", kind: "own-answer" }, { now: T2 });

    expect(await historyOf(X)).toEqual([]);
  });

  it("row 15: no history row when the answer was empty and there was no kind", async () => {
    await fixture({ x: { currentAnswer: "", answerKind: null } });

    await settle(X, { answer: "A", kind: "own-answer" }, { now: T2 });

    expect(await historyOf(X)).toEqual([]);
  });

  it("row 16: a kind with no answer text is still a prior answer", async () => {
    await fixture({ x: { currentAnswer: null, answerKind: "unknown" } });

    await settle(X, { answer: "A", kind: "own-answer" }, { now: T2 });

    expect(await historyOf(X)).toMatchObject([{ answer: null, answerKind: "unknown" }]);
  });

  it("row 17: answer text with no kind is still a prior answer", async () => {
    await fixture({ x: { currentAnswer: "A", answerKind: null } });

    await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    expect(await historyOf(X)).toMatchObject([{ answer: "A", answerKind: null }]);
  });

  it("row 18: marks the spec not current in an interviewing session", async () => {
    await fixture({ session: { state: "interviewing" } });

    await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    await expectSpecNotCurrent();
    await expectSessionUntouched("interviewing");
  });

  it("row 19: marks the spec not current in a confirmed session", async () => {
    await fixture({ session: { state: "confirmed" } });

    await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    await expectSpecNotCurrent();
    await expectSessionUntouched("confirmed");
  });

  it("row 20: a session with no spec is left without one", async () => {
    await fixture({ spec: false });

    await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    expect(await specs()).toEqual([]);
  });

  it("row 21: runs every query through a given handle, and rolls back with the caller's transaction", async () => {
    await fixture();
    const before = await everything();

    const through: string[] = [];
    await expect(
      getDb().transaction(async (tx) => {
        const name = (table: unknown) =>
          table === schema.sessions
            ? "sessions"
            : table === schema.specs
              ? "specs"
              : table === schema.decisions
                ? "decisions"
                : table === schema.decisionHistory
                  ? "decisionHistory"
                  : "other";
        const recording = {
          select: ((...args: Parameters<typeof tx.select>) => {
            through.push("select");
            return tx.select(...args);
          }) as typeof tx.select,
          insert: ((table: Parameters<typeof tx.insert>[0]) => {
            through.push(`insert ${name(table)}`);
            return tx.insert(table);
          }) as typeof tx.insert,
          update: ((table: Parameters<typeof tx.update>[0]) => {
            through.push(`update ${name(table)}`);
            return tx.update(table);
          }) as typeof tx.update,
          delete: ((table: Parameters<typeof tx.delete>[0]) => {
            through.push(`delete ${name(table)}`);
            return tx.delete(table);
          }) as typeof tx.delete,
        };
        await settle(X, { answer: "B", kind: "own-answer" }, { now: T2, db: recording });
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");

    expect(through).toEqual([
      "select",
      "insert decisionHistory",
      "update decisions",
      "update decisions",
      "update decisions",
      "update specs",
    ]);
    expect(await everything()).toEqual(before);
  });

  it("row 22: without a handle, opens one transaction and runs every query through it", async () => {
    await fixture();
    spy.active = true;

    await settle(X, { answer: "B", kind: "own-answer" }, { now: T2 });

    spy.active = false;
    expect(spy.transactions).toBe(1);
    expect(spy.outside).toEqual([]);
    expect(spy.inside).toEqual([
      "select",
      "insert decisionHistory",
      "update decisions",
      "update decisions",
      "update decisions",
      "update specs",
    ]);
  });

  it("row 23: without a handle, a failing write rolls the whole change back", async () => {
    await fixture();
    const before = await everything();
    spy.active = true;
    spy.failSpecUpdate = true;

    await expect(settle(X, { answer: "B", kind: "own-answer" }, { now: T2 })).rejects.toThrow(
      "spec update failed",
    );

    spy.active = false;
    expect(await everything()).toEqual(before);
  });

  it("row 24: a target given with another kind is dropped", async () => {
    await fixture();

    const written = await settle(
      X,
      { answer: "B", kind: "own-answer", dispositionTarget: "out-of-scope" },
      { now: T2 },
    );

    expect(written).toMatchObject({ dispositionTarget: null });
  });

  it("row 25: settle as dispositioned without a target throws and writes nothing", async () => {
    await fixture();
    const before = await everything();

    await expect(settle(X, { answer: "B", kind: "dispositioned" }, { now: T2 })).rejects.toThrow(
      /disposition target/,
    );

    expect(await everything()).toEqual(before);
  });

  it("moveSetAside throws for a decision id that does not exist", async () => {
    await fixture();
    await expect(moveSetAside("missing", "builders-call", { now: T2 })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("moveSetAside opens one transaction without a handle, and none of its own inside a caller's", async () => {
    await fixture();
    spy.active = true;

    await moveSetAside(X, "builders-call", { now: T2 });
    expect(spy.transactions).toBe(1);
    expect(spy.outside).toEqual([]);

    spy.transactions = 0;
    await getDb().transaction((tx) => moveSetAside(X, "open-question", { now: T2, db: tx }));
    spy.active = false;
    expect(spy.transactions).toBe(1);
  });
});

describe("choosing the builder's call by picking Leave it to the builder", () => {
  const choices = (labels: string[]) => ({
    offeredChoicesJson: JSON.stringify(labels),
    choiceRationalesJson: JSON.stringify(labels.map((label) => `Why ${label}`)),
  });
  const B1_CHOICES = choices(["Use Postgres", LEAVE_IT_TO_THE_BUILDER]);
  const withRecommendation = (recommendedChoice: number | null) => ({
    ...B1_CHOICES,
    recommendedChoice,
  });

  it("B1: an accepted recommendation of the Leave-it choice picks it", () => {
    expect(
      picksLeaveItToTheBuilder(
        withRecommendation(1),
        "accepted-recommendation",
        "The builder knows which database engine fits.",
      ),
    ).toBe(true);
  });

  it("B2: an own answer equal to the Leave-it label, trimmed, picks it", () => {
    expect(
      picksLeaveItToTheBuilder(withRecommendation(1), "own-answer", " Leave it to the builder "),
    ).toBe(true);
  });

  it("B3: accepting or picking another choice does not", () => {
    expect(
      picksLeaveItToTheBuilder(withRecommendation(0), "accepted-recommendation", "Postgres fits."),
    ).toBe(false);
    expect(picksLeaveItToTheBuilder(withRecommendation(1), "own-answer", "Use Postgres")).toBe(
      false,
    );
  });

  it("B4: labels match exactly and case-sensitively, never by containment", () => {
    expect(
      picksLeaveItToTheBuilder(
        { ...choices(["Use Postgres", "Leave it to the builder to decide"]), recommendedChoice: 1 },
        "accepted-recommendation",
        "Reasoning",
      ),
    ).toBe(false);
    expect(
      picksLeaveItToTheBuilder(withRecommendation(1), "own-answer", "leave it to the builder"),
    ).toBe(false);
  });

  it("B5: an own answer matches only when such a choice is offered", () => {
    expect(
      picksLeaveItToTheBuilder(
        { ...choices(["Use Postgres"]), recommendedChoice: null },
        "own-answer",
        LEAVE_IT_TO_THE_BUILDER,
      ),
    ).toBe(false);
  });

  it("B5: an own answer with no text never picks it", () => {
    expect(picksLeaveItToTheBuilder(withRecommendation(1), "own-answer", null)).toBe(false);
  });

  it.each(["unknown", "deferred", "pushed-back"] as const)(
    "B6: a %s steering move is never a builder's call",
    (kind) => {
      expect(picksLeaveItToTheBuilder(withRecommendation(1), kind, LEAVE_IT_TO_THE_BUILDER)).toBe(
        false,
      );
    },
  );

  it("B10: an own answer matches any offered Leave-it choice, not only the recommended one", () => {
    expect(
      picksLeaveItToTheBuilder(
        { ...choices([LEAVE_IT_TO_THE_BUILDER, "Use Postgres"]), recommendedChoice: 1 },
        "own-answer",
        LEAVE_IT_TO_THE_BUILDER,
      ),
    ).toBe(true);
  });

  it("B11: an offered label is trimmed before it is compared", () => {
    const padded = {
      ...choices(["Use Postgres", " Leave it to the builder "]),
      recommendedChoice: 1,
    };
    expect(picksLeaveItToTheBuilder(padded, "accepted-recommendation", "Reasoning")).toBe(true);
    expect(picksLeaveItToTheBuilder(padded, "own-answer", LEAVE_IT_TO_THE_BUILDER)).toBe(true);
  });

  it("B12: an accepted recommendation with no recommended choice never scans the choices", () => {
    expect(
      picksLeaveItToTheBuilder(
        withRecommendation(null),
        "accepted-recommendation",
        LEAVE_IT_TO_THE_BUILDER,
      ),
    ).toBe(false);
  });

  describe("through settle", () => {
    useTestDatabase();

    const frontier = {
      currentAnswer: null,
      answerKind: null,
      settledAt: null,
      ...B1_CHOICES,
      recommendedChoice: 1,
    };

    it("B7: accepting the Leave-it recommendation records a builder's call", async () => {
      await fixture({ x: frontier });

      await settle(X, { answer: "R", kind: "accepted-recommendation" }, { now: T2 });

      expect(await row(X)).toMatchObject({
        answerKind: "dispositioned",
        dispositionTarget: "builders-call",
        currentAnswer: "R",
        settledAt: T2,
      });
    });

    it("B8: an ordinary own answer is written as given", async () => {
      await fixture({ x: frontier });

      await settle(X, { answer: "Use Postgres", kind: "own-answer" }, { now: T2 });

      expect(await row(X)).toMatchObject({
        answerKind: "own-answer",
        dispositionTarget: null,
        currentAnswer: "Use Postgres",
        settledAt: T2,
      });
    });
  });
});
