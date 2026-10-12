import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import { unsettle } from "./answer-change.js";
import {
  accept,
  dismiss,
  dismissals,
  eligibleFor,
  forgetDismissal,
  propose,
  type Dismissal,
} from "./proposal.js";

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
const T3 = "2026-01-04T00:00:00.000Z";
const NOW = "2026-01-05T00:00:00.000Z";

const SESSION = "session-p";
const S = "decision-s";
const L = "decision-l";
const V = "decision-v";
const W = "decision-w";
const Y = "decision-y";

type DecisionInsert = typeof schema.decisions.$inferInsert;

function decision(id: string, createdAt: string, overrides: Partial<DecisionInsert>): DecisionInsert {
  return {
    id,
    sessionId: SESSION,
    key: id,
    questionTitle: `Question ${id}`,
    questionBody: `Body ${id}`,
    dependsOnJson: "[]",
    createdAt,
    updatedAt: T0,
    ...overrides,
  };
}

/**
 * A session with a current spec, holding S (settled own answer "A" at T1), L
 * (a loose end, `unknown`, "dunno"), and V and W (own answers settled at T2).
 * Each override replaces that decision's columns; `extra` adds decisions.
 */
async function fixture(
  overrides: Partial<Record<"s" | "l" | "v" | "w", Partial<DecisionInsert>>> = {},
  extra: DecisionInsert[] = [],
) {
  const db = getDb();
  await db.insert(schema.sessions).values({
    id: SESSION,
    title: "Grill Room",
    idea: "A local app.",
    state: "interviewing",
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(schema.specs).values({
    id: "spec-p",
    sessionId: SESSION,
    markdown: "# Spec\n",
    current: true,
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(schema.decisions).values([
    decision(S, "2026-01-01T00:00:00.001Z", {
      currentAnswer: "A",
      answerKind: "own-answer",
      settledAt: T1,
      ...overrides.s,
    }),
    decision(L, "2026-01-01T00:00:00.002Z", {
      currentAnswer: "dunno",
      answerKind: "unknown",
      ...overrides.l,
    }),
    decision(V, "2026-01-01T00:00:00.003Z", {
      currentAnswer: "V answer",
      answerKind: "own-answer",
      settledAt: T2,
      ...overrides.v,
    }),
    decision(W, "2026-01-01T00:00:00.004Z", {
      currentAnswer: "W answer",
      answerKind: "own-answer",
      settledAt: T2,
      ...overrides.w,
    }),
    ...extra,
  ]);
}

function remembered(...entries: Dismissal[]): string {
  return JSON.stringify(entries);
}

const DEFERRAL_DISMISSAL: Dismissal = { kind: "deferral", reason: "earlier", dismissedAt: T0 };

const PENDING_DEFERRAL = { deferralReason: "later", proposalKind: "deferral" } as const;

async function row(id: string) {
  const [found] = await getDb().select().from(schema.decisions).where(eq(schema.decisions.id, id));
  return found!;
}

async function sessionRows() {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, SESSION))
    .orderBy(schema.decisions.createdAt, schema.decisions.id);
}

async function historyOf(id: string) {
  return getDb().select().from(schema.decisionHistory).where(eq(schema.decisionHistory.decisionId, id));
}

async function specCurrent() {
  const [spec] = await getDb().select().from(schema.specs);
  return spec!.current;
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

const NO_PROPOSAL = {
  proposalKind: null,
  supersededById: null,
  supersessionAnswer: null,
  supersessionReason: null,
  deferralReason: null,
  restatementText: null,
  restatementNotes: null,
  restatementReason: null,
};

describe("proposal", () => {
  useTestDatabase();
  afterEach(() => {
    spy.active = false;
    spy.failSpecUpdate = false;
    spy.transactions = 0;
    spy.outside.length = 0;
    spy.inside.length = 0;
  });

  it("row 1: propose stores an answered-by on a loose end with its kind", async () => {
    await fixture();

    const result = await propose(L, { kind: "answered-by", byId: V, answer: "B", reason: "r" }, { now: NOW });

    expect(result).toEqual({ stored: true, row: await row(L) });
    expect(await row(L)).toMatchObject({
      proposalKind: "answered-by",
      supersededById: V,
      supersessionAnswer: "B",
      supersessionReason: "r",
      updatedAt: NOW,
    });
  });

  it("row 2: propose stores a replacement on a settled decision with its kind", async () => {
    await fixture();

    const result = await propose(S, { kind: "replacement", byId: V, reason: "r" }, { now: NOW });

    expect(result.stored).toBe(true);
    expect(await row(S)).toMatchObject({
      proposalKind: "replacement",
      supersededById: V,
      supersessionAnswer: null,
      supersessionReason: "r",
      updatedAt: NOW,
    });
  });

  it("row 3: propose stores a deferral on a settled own answer with its kind", async () => {
    await fixture();

    const result = await propose(S, { kind: "deferral", reason: "later" }, { now: NOW });

    expect(result.stored).toBe(true);
    expect(await row(S)).toMatchObject({ proposalKind: "deferral", deferralReason: "later", updatedAt: NOW });
  });

  it("row 4: propose stores a restatement on a settled own answer with its kind", async () => {
    await fixture();

    const result = await propose(
      S,
      { kind: "restatement", text: "A clean", notes: "n", reason: "r" },
      { now: NOW },
    );

    expect(result.stored).toBe(true);
    expect(await row(S)).toMatchObject({
      proposalKind: "restatement",
      restatementText: "A clean",
      restatementNotes: "n",
      restatementReason: "r",
      updatedAt: NOW,
    });
  });

  it("row 5: a decision holding a pending deferral is skipped as already-pending", async () => {
    await fixture({ s: PENDING_DEFERRAL });
    const before = await row(S);

    const result = await propose(
      S,
      { kind: "restatement", text: "A clean", notes: "n", reason: "r" },
      { now: NOW },
    );

    expect(result).toEqual({ stored: false, skip: "already-pending" });
    expect(await row(S)).toEqual(before);
  });

  it("row 6: a loose end holding an answered-by is not overwritten by another", async () => {
    await fixture({
      l: { supersededById: V, supersessionAnswer: "B", supersessionReason: "r", proposalKind: "answered-by" },
    });

    const result = await propose(L, { kind: "answered-by", byId: W, answer: "C", reason: "s" }, { now: NOW });

    expect(result).toEqual({ stored: false, skip: "already-pending" });
    expect(await row(L)).toMatchObject({ supersededById: V, supersessionAnswer: "B", supersessionReason: "r" });
  });

  it("row 7: an accepted recommendation is not eligible for a deferral", async () => {
    await fixture({ s: { answerKind: "accepted-recommendation" } });
    const before = await row(S);

    const result = await propose(S, { kind: "deferral", reason: "later" }, { now: NOW });

    expect(result).toEqual({ stored: false, skip: "not-eligible" });
    expect(await row(S)).toEqual(before);
  });

  it("row 8: a remembered deferral dismissal skips a deferral, not a restatement", async () => {
    await fixture({ s: { dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL) } });

    const first = await propose(S, { kind: "deferral", reason: "later" }, { now: NOW });
    const second = await propose(
      S,
      { kind: "restatement", text: "A clean", notes: "n", reason: "r" },
      { now: NOW },
    );

    expect(first).toEqual({ stored: false, skip: "dismissed" });
    expect(second.stored).toBe(true);
    expect(await row(S)).toMatchObject({ proposalKind: "restatement" });
  });

  it("row 9: a remembered replacement dismissal skips its own target only", async () => {
    await fixture({
      s: { dismissedProposalsJson: remembered({ kind: "replacement", targetId: V, reason: "r", dismissedAt: T0 }) },
    });

    const first = await propose(S, { kind: "replacement", byId: V, reason: "r" }, { now: NOW });
    const second = await propose(S, { kind: "replacement", byId: W, reason: "r2" }, { now: NOW });

    expect(first).toEqual({ stored: false, skip: "dismissed" });
    expect(second.stored).toBe(true);
    expect(await row(S)).toMatchObject({ proposalKind: "replacement", supersededById: W });
  });

  it("row 9b: dismissed is checked before eligibility", async () => {
    await fixture({
      s: { replacedById: W, replacedReason: "r", dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL) },
    });

    const result = await propose(S, { kind: "deferral", reason: "later" }, { now: NOW });

    expect(result).toEqual({ stored: false, skip: "dismissed" });
  });

  it("row 10: eligibility for a deferral and a restatement leaves out a pending row and a dismissed kind", async () => {
    await fixture({
      s: { dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL) },
      v: { restatementText: "V clean", restatementNotes: "", restatementReason: "r", proposalKind: "restatement" },
    });
    const rows = await sessionRows();

    expect(eligibleFor("deferral", rows).map((r) => r.id)).toEqual([W]);
    expect(eligibleFor("restatement", rows).map((r) => r.id)).toEqual([S, W]);
  });

  it("row 11: eligibility for an answered-by leaves out a loose end holding one", async () => {
    await fixture({
      l: { supersededById: V, supersessionAnswer: "B", supersessionReason: "r", proposalKind: "answered-by" },
    });
    const rows = await sessionRows();

    expect(eligibleFor("answered-by", rows).map((r) => r.id)).not.toContain(L);
  });

  it("row 12: eligibility for a replacement leaves out a decision holding one", async () => {
    await fixture({
      s: { supersededById: V, supersessionReason: "r", proposalKind: "replacement" },
    });
    const rows = await sessionRows();

    expect(eligibleFor("replacement", rows).map((r) => r.id)).not.toContain(S);
  });

  it("row 13: accepting an answered-by settles the loose end through Answer change", async () => {
    await fixture({
      l: { supersededById: V, supersessionAnswer: "B", supersessionReason: "r", proposalKind: "answered-by" },
    });

    const written = await accept(L, { now: NOW });

    expect(written).toEqual(await row(L));
    expect(written).toMatchObject({
      currentAnswer: "B",
      answerKind: "own-answer",
      settledById: V,
      settledAt: NOW,
      ...NO_PROPOSAL,
    });
    expect(await historyOf(L)).toMatchObject([
      { answer: "dunno", answerKind: "unknown", interviewerReason: "r", recordedAt: NOW },
    ]);
  });

  it("row 14: accepting a replacement links it, clears the proposal, keeps the answer and dismissals, and marks the spec", async () => {
    await fixture(
      {
        s: {
          supersededById: V,
          supersessionReason: "r",
          proposalKind: "replacement",
          dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
        },
      },
      [
        decision(Y, "2026-01-01T00:00:00.005Z", {
          currentAnswer: "dunno",
          answerKind: "unknown",
          supersededById: S,
          supersessionAnswer: "A",
          supersessionReason: "S answers it",
          proposalKind: "answered-by",
        }),
      ],
    );

    const written = await accept(S, { now: NOW });

    expect(written).toEqual(await row(S));
    expect(written).toMatchObject({
      replacedById: V,
      replacedReason: "r",
      ...NO_PROPOSAL,
      currentAnswer: "A",
      answerKind: "own-answer",
      settledAt: T1,
      dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
      updatedAt: NOW,
    });
    expect(await historyOf(S)).toEqual([]);
    expect(await row(Y)).toMatchObject({
      supersededById: S,
      supersessionAnswer: "A",
      supersessionReason: "S answers it",
      proposalKind: "answered-by",
    });
    expect(await specCurrent()).toBe(false);
  });

  it("row 15: accepting a deferral defers through Answer change and forgets the dismissals", async () => {
    await fixture({
      s: {
        ...PENDING_DEFERRAL,
        dismissedProposalsJson: remembered({ kind: "restatement", reason: "r", dismissedAt: T0, text: "A." }),
      },
    });

    const written = await accept(S, { now: NOW });

    expect(written).toMatchObject({
      answerKind: "deferred",
      currentAnswer: "A",
      ...NO_PROPOSAL,
      dismissedProposalsJson: null,
    });
    expect(await historyOf(S)).toMatchObject([
      { answer: "A", answerKind: "own-answer", interviewerReason: "later" },
    ]);
  });

  it("row 16: accepting a restatement with an edited statement rewords and forgets the dismissals", async () => {
    await fixture({
      s: {
        restatementText: "A clean",
        restatementNotes: "n",
        restatementReason: "r",
        proposalKind: "restatement",
        dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
      },
    });

    const written = await accept(S, { now: NOW, statement: " B " });

    expect(written).toMatchObject({
      currentAnswer: "B",
      answerKind: "own-answer",
      settledAt: T1,
      ...NO_PROPOSAL,
      dismissedProposalsJson: null,
    });
    expect(await historyOf(S)).toMatchObject([
      { answer: "A", answerKind: "own-answer", interviewerReason: "r", operatorNotes: "n", recordedAt: NOW },
    ]);
  });

  it("row 17: accept and dismiss with nothing pending return null and write nothing", async () => {
    await fixture();
    const before = await everything();

    expect(await accept(S, { now: NOW })).toBeNull();
    expect(await dismiss(S, { now: NOW })).toBeNull();

    expect(await everything()).toEqual(before);
  });

  it("row 18: dismissing a deferral clears it and remembers it, with no history and the spec still current", async () => {
    await fixture({ s: PENDING_DEFERRAL });

    const written = await dismiss(S, { now: T3 });

    expect(written).toEqual(await row(S));
    expect(written).toMatchObject({ ...NO_PROPOSAL, currentAnswer: "A", updatedAt: T3 });
    expect(dismissals(written!)).toEqual([{ kind: "deferral", reason: "later", dismissedAt: T3 }]);
    expect(written!.dismissedProposalsJson).toBe(
      JSON.stringify([{ kind: "deferral", reason: "later", dismissedAt: T3 }]),
    );
    expect(await historyOf(S)).toEqual([]);
    expect(await specCurrent()).toBe(true);
  });

  it("row 19: dismissing an answered-by remembers its target", async () => {
    await fixture({
      l: { supersededById: V, supersessionAnswer: "B", supersessionReason: "r", proposalKind: "answered-by" },
    });

    const written = await dismiss(L, { now: NOW });

    expect(written).toMatchObject(NO_PROPOSAL);
    expect(dismissals(written!)).toEqual([{ kind: "answered-by", targetId: V, reason: "r", dismissedAt: NOW }]);
  });

  it("row 20: dismissing a restatement appends it after the earlier dismissals, with its text", async () => {
    await fixture({
      s: {
        restatementText: "A clean",
        restatementNotes: "n",
        restatementReason: "r",
        proposalKind: "restatement",
        dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
      },
    });

    const written = await dismiss(S, { now: NOW });

    expect(dismissals(written!)).toEqual([
      DEFERRAL_DISMISSAL,
      { kind: "restatement", reason: "r", dismissedAt: NOW, text: "A clean" },
    ]);
  });

  it("row 21: forgetDismissal removes the matching kind and target, changing nothing else", async () => {
    await fixture({
      s: {
        dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL, {
          kind: "replacement",
          targetId: V,
          reason: "r",
          dismissedAt: T0,
        }),
      },
    });
    const before = await row(S);

    const written = await forgetDismissal(S, { kind: "replacement", targetId: V }, { now: NOW });

    expect(written).toEqual({
      ...before,
      dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
      updatedAt: NOW,
    });
    expect(await row(S)).toEqual(written);
    expect(await historyOf(S)).toEqual([]);
    expect(await specCurrent()).toBe(true);
  });

  it("row 21b: forgetDismissal with no target matches no dismissal that names one", async () => {
    const entries: Dismissal[] = [
      { kind: "answered-by", targetId: V, reason: "r", dismissedAt: T0 },
      { kind: "answered-by", targetId: W, reason: "s", dismissedAt: T0 },
    ];
    await fixture({ s: { dismissedProposalsJson: remembered(...entries) } });
    const before = await row(S);

    const written = await forgetDismissal(S, { kind: "answered-by" }, { now: NOW });

    expect(written).toEqual(before);
    expect(await row(S)).toEqual(before);
  });

  it("row 22: forgetting the last dismissal writes null", async () => {
    await fixture({ s: { dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL) } });

    const written = await forgetDismissal(S, { kind: "deferral" }, { now: NOW });

    expect(written.dismissedProposalsJson).toBeNull();
    expect((await row(S)).dismissedProposalsJson).toBeNull();
  });

  it("row 23: unsettling forgets the decision's dismissals", async () => {
    await fixture({ s: { dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL) } });

    await unsettle(S, { now: NOW });

    expect((await row(S)).dismissedProposalsJson).toBeNull();
  });

  it("row 24: unsettling withdraws another decision's answered-by naming it, with its kind", async () => {
    await fixture({}, [
      decision(Y, "2026-01-01T00:00:00.005Z", {
        currentAnswer: "dunno",
        answerKind: "unknown",
        supersededById: S,
        supersessionAnswer: "A",
        supersessionReason: "S answers it",
        proposalKind: "answered-by",
      }),
    ]);

    await unsettle(S, { now: NOW });

    expect(await row(Y)).toMatchObject({ supersededById: null, proposalKind: null });
  });

  it("row 25: every transition throws for an unknown id", async () => {
    await fixture();

    await expect(propose("missing", { kind: "deferral", reason: "r" }, { now: NOW })).rejects.toThrow(
      "Decision not found: missing",
    );
    await expect(accept("missing", { now: NOW })).rejects.toThrow("Decision not found: missing");
    await expect(dismiss("missing", { now: NOW })).rejects.toThrow("Decision not found: missing");
    await expect(forgetDismissal("missing", { kind: "deferral" }, { now: NOW })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("routing: with a caller's handle, every query goes through it", async () => {
    const answeredBy = { supersededById: V, supersessionAnswer: "B", supersessionReason: "r", proposalKind: "answered-by" } as const;
    await fixture(
      { l: answeredBy },
      [
        decision("decision-r", "2026-01-01T00:00:00.006Z", {
          currentAnswer: "R",
          answerKind: "own-answer",
          settledAt: T1,
          supersededById: V,
          supersessionReason: "r",
          proposalKind: "replacement",
        }),
        decision("decision-d", "2026-01-01T00:00:00.007Z", {
          currentAnswer: "D",
          answerKind: "own-answer",
          settledAt: T1,
          ...PENDING_DEFERRAL,
        }),
        decision("decision-t", "2026-01-01T00:00:00.008Z", {
          currentAnswer: "T",
          answerKind: "own-answer",
          settledAt: T1,
          restatementText: "T clean",
          restatementNotes: "",
          restatementReason: "r",
          proposalKind: "restatement",
        }),
        decision("decision-x", "2026-01-01T00:00:00.009Z", {
          currentAnswer: "X",
          answerKind: "own-answer",
          settledAt: T1,
          ...PENDING_DEFERRAL,
          dismissedProposalsJson: remembered(DEFERRAL_DISMISSAL),
        }),
      ],
    );

    spy.active = true;
    const through = (fn: (db: Parameters<typeof propose>[2]["db"]) => Promise<unknown>) =>
      getDb().transaction((tx) => fn(tx) as Promise<unknown>);

    await through((db) => propose(S, { kind: "deferral", reason: "later" }, { now: NOW, db }));
    await through((db) => accept(L, { now: NOW, db }));
    await through((db) => accept("decision-r", { now: NOW, db }));
    await through((db) => accept("decision-d", { now: NOW, db }));
    await through((db) => accept("decision-t", { now: NOW, db }));
    await through((db) => dismiss("decision-x", { now: NOW, db }));
    await through((db) => forgetDismissal("decision-x", { kind: "deferral" }, { now: NOW, db }));
    spy.active = false;

    expect(spy.outside).toEqual([]);
    expect(spy.inside).toContain("update specs");
    expect(spy.inside.filter((query) => query === "update decisions").length).toBeGreaterThanOrEqual(7);
    expect(await row("decision-r")).toMatchObject({ replacedById: V, proposalKind: null });
    expect(await row("decision-x")).toMatchObject({ dismissedProposalsJson: null, proposalKind: null });
  });

  it("atomicity: without a handle, a failing spec update rolls a replacement accept back", async () => {
    await fixture({ s: { supersededById: V, supersessionReason: "r", proposalKind: "replacement" } });
    const before = await everything();
    spy.active = true;
    spy.failSpecUpdate = true;

    await expect(accept(S, { now: NOW })).rejects.toThrow("spec update failed");

    spy.active = false;
    expect(spy.transactions).toBe(1);
    expect(await everything()).toEqual(before);
  });
});
