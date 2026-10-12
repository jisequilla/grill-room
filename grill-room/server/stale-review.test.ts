import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import createSession from "../actions/create-session.js";
import getCurrentRound from "../actions/get-current-round.js";
import reopenDecision from "../actions/reopen-decision.js";
import saveDraftAnswer from "../actions/save-draft-answer.js";
import submitRound from "../actions/submit-round.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "./interviewer/index.js";
import { runDueStaleReviews } from "./stale-review.js";

/**
 * The database mock of `actions/reopen-decision.test.ts`, extended to fail a
 * chosen write by count.
 *
 * While `recording` is set, every query and transaction is logged with the
 * handle it went through: `db` for a `getDb()` handle, `tx` for a transaction
 * opened on one, and `commit` when a transaction's callback finishes. The
 * embedded database runs one connection, so a query that skipped the
 * transaction would still roll back with it; only this log shows which handle
 * it used.
 *
 * `failDecisionsUpdateAt` fails the Nth `decisions` update made through a
 * transaction's handle, counted from that transaction's start; 0 fails none.
 */
const harness = vi.hoisted(() => ({
  recording: false,
  log: [] as string[],
  failDecisionsUpdateAt: 0,
  decisionsUpdates: 0,
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
        [original.schema.rounds, "rounds"],
        [original.schema.roundDecisions, "roundDecisions"],
      ] as const
    ).find(([candidate]) => candidate === table)?.[1] ?? "other";
  const record = (handle: "db" | "tx", prop: string, table?: unknown) => {
    if (!harness.recording) return;
    harness.log.push(
      prop === "select" || prop === "transaction"
        ? `${handle} ${prop}`
        : `${handle} ${prop} ${name(table)}`,
    );
  };
  const failing = <Handle extends object>(handle: Handle, kind: "db" | "tx"): Handle =>
    new Proxy(handle, {
      get(target, prop) {
        if (prop === "insert" || prop === "select" || prop === "update" || prop === "delete") {
          return (...args: unknown[]) => {
            record(kind, prop, args[0]);
            if (prop === "update" && kind === "tx" && args[0] === original.schema.decisions) {
              harness.decisionsUpdates += 1;
              if (harness.decisionsUpdates === harness.failDecisionsUpdateAt) {
                throw new Error("decisions update failed");
              }
            }
            return (target as Record<typeof prop, (...a: unknown[]) => unknown>)[prop](...args);
          };
        }
        if (prop === "transaction") {
          return (callback: (tx: object) => Promise<unknown>, ...rest: unknown[]) => {
            record(kind, "transaction");
            harness.decisionsUpdates = 0;
            return (Reflect.get(target, prop) as (...args: unknown[]) => Promise<unknown>).call(
              target,
              async (tx: object) => {
                const result = await callback(failing(tx, "tx"));
                if (harness.recording) harness.log.push("commit");
                return result;
              },
              ...rest,
            );
          };
        }
        return bind(target, prop);
      },
    });
  return { ...original, getDb: () => failing(original.getDb(), "db") };
});

/** Each transaction's entries in the log, between its `db transaction` and its `commit`. */
function transactionSpans(log: readonly string[]): string[][] {
  const spans: string[][] = [];
  let open: string[] | null = null;
  for (const entry of log) {
    if (entry === "db transaction") {
      open = [];
    } else if (entry === "commit" && open) {
      spans.push(open);
      open = null;
    } else {
      open?.push(entry);
    }
  }
  return spans;
}

/** The span of the first transaction holding `entry`, or null when none does. */
function spanHolding(log: readonly string[], entry: string): string[] | null {
  return transactionSpans(log).find((span) => span.includes(entry)) ?? null;
}

const DEFERRAL = "It waits on how long data is kept.";

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

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
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

/**
 * shape, storage hanging off it, and backup: a settled own answer carrying
 * both a pending replacement naming storage and a pending deferral of its own.
 * storage carries a pending deferral too.
 */
async function aChainWithPendingProposals() {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
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
    deferralReason: DEFERRAL,
  });
  await insertDecision(session.id, {
    id: "d-backup",
    key: "backup",
    questionTitle: "Is it backed up?",
    answerKind: "own-answer",
    currentAnswer: "Decide once retention is known",
    settledAt: "2026-09-01T00:00:00.000Z",
    supersededById: "d-storage",
    supersessionReason: "Storage changes how backups work.",
    deferralReason: DEFERRAL,
  });
  return session;
}

/** Reopens shape and answers it again, running the stale review that re-asks storage. */
async function reopenShapeAndReAskStorage(sessionId: string) {
  scriptInterviewer([
    {
      kind: "review-stale",
      result: {
        reviews: [
          {
            decisionKey: "storage",
            verdict: "re-ask",
            reason: "A page stores differently.",
            title: "Where does a page keep its data?",
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

describe("a stale review that re-asks a decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("clears the re-asked decision's own pending deferral", async () => {
    const session = await aChainWithPendingProposals();

    await reopenShapeAndReAskStorage(session.id);

    expect(await readDecision("d-storage")).toMatchObject({
      answerKind: null,
      deferralReason: null,
    });
  });

  it("withdraws another decision's supersession that names it, and leaves that decision's own deferral pending", async () => {
    const session = await aChainWithPendingProposals();

    await reopenShapeAndReAskStorage(session.id);

    expect(await readDecision("d-backup")).toMatchObject({
      answerKind: "own-answer",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      deferralReason: DEFERRAL,
    });
  });
});

/**
 * A review applies through Answer change (`server/answer-change.ts`) in one
 * transaction. Staleness is seeded directly: the ancestor's `reopenedAt` set,
 * S left settled, and the spec inserted current last. `reopen-decision` is
 * never called, since it would mark the spec itself and blind the spec
 * assertions.
 */
describe("applying a stale review through Answer change", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  afterEach(() => {
    harness.recording = false;
    harness.log = [];
    harness.failDecisionsUpdateAt = 0;
  });

  const SETTLED = "2026-09-01T00:00:00.000Z";
  /** The ancestor's reopen, later than the clock: the review's stamp. */
  const REOPENED = "2099-01-01T00:00:00.000Z";

  /**
   * An interviewing session with a current spec, where the ancestor A was
   * reopened after each stale decision named settled. Z is replaced by the
   * first stale decision, and Y carries a pending supersession by it.
   */
  async function aSessionWithStale(stale: { id: string; answer: string }[]) {
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
    });
    await insertDecision(session.id, {
      id: "a",
      key: "a",
      questionTitle: "What shape should this take?",
      answerKind: "own-answer",
      currentAnswer: "A page",
      settledAt: SETTLED,
      reopenedAt: REOPENED,
    });
    for (const decision of stale) {
      await insertDecision(session.id, {
        id: decision.id,
        key: decision.id,
        questionTitle: `The old question ${decision.id}`,
        answerKind: "own-answer",
        currentAnswer: decision.answer,
        dependsOnJson: JSON.stringify(["a"]),
        settledAt: SETTLED,
      });
    }
    const first = stale[0]!.id;
    await insertDecision(session.id, {
      id: "y",
      key: "y",
      questionTitle: "Is it backed up?",
      answerKind: "own-answer",
      currentAnswer: "Nightly",
      settledAt: SETTLED,
      supersededById: first,
      supersessionAnswer: null,
      supersessionReason: `${first} replaces it.`,
    });
    await insertDecision(session.id, {
      id: "z",
      key: "z",
      questionTitle: "Where are the backups kept?",
      answerKind: "own-answer",
      currentAnswer: "Next to the data",
      settledAt: SETTLED,
      replacedById: first,
      replacedReason: `${first} replaced it.`,
    });
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    return session;
  }

  function review(
    ...verdicts: { key: string; verdict: "reconfirm" | "re-ask"; reason: string; title?: string }[]
  ): ScriptedTurn {
    return {
      kind: "review-stale",
      result: {
        reviews: verdicts.map((verdict) => ({
          decisionKey: verdict.key,
          verdict: verdict.verdict,
          reason: verdict.reason,
          title: verdict.title ?? null,
          body: null,
          choices: [],
          recommendedChoice: null,
          recommendedAnswer: null,
        })),
      },
    };
  }

  function historyOf(decisionId: string) {
    return getDb()
      .select()
      .from(schema.decisionHistory)
      .where(eq(schema.decisionHistory.decisionId, decisionId));
  }

  async function specCurrent(sessionId: string) {
    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId));
    return spec!.current;
  }

  it("row 11: a re-ask unsettles first, so history keeps the old question, and withdraws the claims naming it", async () => {
    const session = await aSessionWithStale([{ id: "s", answer: "On disk" }]);
    scriptInterviewer([
      review({ key: "s", verdict: "re-ask", reason: "r", title: "The new question s" }),
    ]);

    await runDueStaleReviews(session.id);

    expect(await readDecision("s")).toMatchObject({
      currentAnswer: null,
      answerKind: null,
      settledAt: null,
      reopenedAt: REOPENED,
      questionTitle: "The new question s",
    });
    expect(await historyOf("s")).toMatchObject([
      { questionTitle: "The old question s", answer: "On disk", interviewerReason: "r" },
    ]);
    expect(await readDecision("z")).toMatchObject({ replacedById: null });
    expect(await readDecision("y")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(await specCurrent(session.id)).toBe(false);
  });

  it("row 11b: a re-ask with a blank reason records no reason", async () => {
    const session = await aSessionWithStale([{ id: "s", answer: "On disk" }]);
    scriptInterviewer([
      review({ key: "s", verdict: "re-ask", reason: "  ", title: "The new question s" }),
    ]);

    await runDueStaleReviews(session.id);

    expect(await historyOf("s")).toMatchObject([{ interviewerReason: null }]);
  });

  it("row 12: a reconfirm settles again at the review's stamp, keeping the claims and the spec", async () => {
    const session = await aSessionWithStale([{ id: "s", answer: "A" }]);
    scriptInterviewer([review({ key: "s", verdict: "reconfirm", reason: "still holds" })]);

    await runDueStaleReviews(session.id);

    expect(await readDecision("s")).toMatchObject({
      currentAnswer: "A",
      answerKind: "own-answer",
      settledAt: REOPENED,
      reopenedAt: null,
    });
    expect(await historyOf("s")).toMatchObject([
      { answer: "A", answerKind: "own-answer", interviewerReason: "still holds" },
    ]);
    expect(await readDecision("y")).toMatchObject({
      supersededById: "s",
      supersessionReason: "s replaces it.",
    });
    expect(await readDecision("z")).toMatchObject({ replacedById: "s" });
    expect(await specCurrent(session.id)).toBe(true);
  });

  it("row 12b: a reconfirm with a blank reason records no reason", async () => {
    const session = await aSessionWithStale([{ id: "s", answer: "A" }]);
    scriptInterviewer([review({ key: "s", verdict: "reconfirm", reason: "  " })]);

    await runDueStaleReviews(session.id);

    expect(await historyOf("s")).toMatchObject([{ interviewerReason: null }]);
  });

  it("row 13: rolls the whole review back when a later re-ask fails", async () => {
    const session = await aSessionWithStale([
      { id: "s1", answer: "On disk" },
      { id: "s2", answer: "Poll" },
    ]);
    scriptInterviewer([
      review(
        { key: "s1", verdict: "re-ask", reason: "r1", title: "The new question s1" },
        { key: "s2", verdict: "re-ask", reason: "r2", title: "The new question s2" },
      ),
    ]);
    const before = [await readDecision("s1"), await readDecision("s2")];

    // Each re-ask makes three `decisions` updates in unsettle, then its
    // question update: the eighth is the second re-ask's question.
    harness.failDecisionsUpdateAt = 8;
    await expect(runDueStaleReviews(session.id)).rejects.toThrow("decisions update failed");
    harness.failDecisionsUpdateAt = 0;

    expect([await readDecision("s1"), await readDecision("s2")]).toEqual(before);
    expect(await historyOf("s1")).toEqual([]);
    expect(await historyOf("s2")).toEqual([]);
  });

  it("runs every query of a review through one transaction's handle", async () => {
    const session = await aSessionWithStale([
      { id: "s1", answer: "On disk" },
      { id: "s2", answer: "Poll" },
    ]);
    scriptInterviewer([
      review(
        { key: "s1", verdict: "re-ask", reason: "r1", title: "The new question s1" },
        { key: "s2", verdict: "reconfirm", reason: "still holds" },
      ),
    ]);

    harness.recording = true;
    await runDueStaleReviews(session.id);
    harness.recording = false;

    expect(spanHolding(harness.log, "tx insert decisionHistory")).toEqual([
      // the re-ask's unsettle
      "tx select",
      "tx insert decisionHistory",
      "tx update decisions",
      "tx update decisions",
      "tx update decisions",
      "tx update specs",
      // the re-ask's question
      "tx update decisions",
      // the reconfirm
      "tx insert decisionHistory",
      "tx update decisions",
    ]);
  });
});
