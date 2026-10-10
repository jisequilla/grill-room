import { eq } from "@agent-native/core/db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionBody } from "../server/consistency.js";
import { hashExportContent } from "../server/export.js";
import {
  consistencyFindingsResult,
  consistencySpecMarkdown,
  consistencyTickets,
} from "../server/interviewer/fake.js";
import {
  type ConsistencyFinding,
  MAX_HANDOFF_SCOUT_TICKETS,
  rateLimitedTurn,
  resetInterviewer,
  type ResultFor,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import answerDecision from "./answer-decision.js";
import askConsistencyFindings from "./ask-consistency-findings.js";
import breakIntoTickets from "./break-into-tickets.js";
import checkConsistency from "./check-consistency.js";
import createSession from "./create-session.js";
import dismissConsistencyFinding from "./dismiss-consistency-finding.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import listConsistencyFindings from "./list-consistency-findings.js";
import reopenDecision from "./reopen-decision.js";
import synthesizeSpec from "./synthesize-spec.js";

/**
 * Every call to `addDecisionCore`, in order, and a way to make one of them
 * hand back a decision id no row has, so the card update that follows it
 * violates the foreign key: the only way to fail part way through an ask.
 */
const core = vi.hoisted(() => ({
  titles: [] as string[],
  /** The handle each `addDecisionCore` call was given. */
  handles: [] as unknown[],
  badIdOnCall: null as number | null,
}));

/**
 * Every transaction opened through `getDb()` hands its callback a recording
 * wrapper of the real transaction, noting each table updated through it. The
 * embedded database binds `getDb()` to an open transaction, so a write that
 * went around the handle would still roll back with it here; only these
 * records show whether the ask uses its transaction.
 */
const transactions = vi.hoisted(() => ({
  handles: [] as unknown[],
  cardUpdates: 0,
}));

vi.mock("../server/db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/db/index.js")>();
  // `getDb()` may hand back a lazy chain-recording proxy (itself a function)
  // while the database starts: its members are passed through untouched.
  const bind = <T extends object>(target: T, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === "function" && typeof target !== "function" ? value.bind(target) : value;
  };
  const getDb = () => {
    const db = original.getDb();
    return new Proxy(db, {
      get(target, prop) {
        if (prop !== "transaction") return bind(target, prop);
        return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
          (target.transaction as (...args: unknown[]) => Promise<unknown>)(
            (tx: object) => {
              const recording = new Proxy(tx, {
                get(inner, innerProp) {
                  if (innerProp !== "update") return bind(inner, innerProp);
                  return (table: unknown) => {
                    if (table === original.schema.consistencyFindings) transactions.cardUpdates += 1;
                    return (inner as { update: (t: unknown) => unknown }).update(table);
                  };
                },
              });
              transactions.handles.push(recording);
              return callback(recording);
            },
            ...rest,
          );
      },
    });
  };
  return { ...original, getDb };
});

vi.mock("./add-decision.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./add-decision.js")>();
  return {
    ...original,
    addDecisionCore: async (...args: Parameters<typeof original.addDecisionCore>) => {
      core.titles.push(args[0].title);
      core.handles.push(args[1]);
      const view = await original.addDecisionCore(...args);
      return core.badIdOnCall === core.titles.length
        ? { ...view!, id: "no-such-decision" }
        : view;
    },
  };
});

type Ticket = ResultFor<"break-into-tickets">["tickets"][number];

const SEVEN = consistencyFindingsResult().findings;

const GOOD_SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
  "",
  "## User Stories",
  "",
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
  "",
  "## Implementation Decisions",
  "",
  "- The shape is a workspace.",
  "",
  "## Testing Decisions",
  "",
  "- Behaviour is tested at the action boundary.",
  "",
  "## Out of Scope",
  "",
  "- Anything not decided above.",
  "",
  "## Further Notes",
  "",
  "- None.",
].join("\n");

function checkTurn(findings: ConsistencyFinding[]): ScriptedTurn {
  return { kind: "check-consistency", result: { findings } };
}

function flatTickets(count: number): Ticket[] {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    slug: `ticket-${index + 1}`,
    title: `Ticket ${index + 1}`,
    body: `Do the work of ticket ${index + 1}.`,
    blockedBy: [],
    implements: [1],
    implementsDecisions: [],
    kind: "build" as const,
    waitsFor: null,
  }));
}

/** A confirmed session with a settled `storage` decision and a current spec. */
async function aSessionWithSpec(markdown = consistencySpecMarkdown()): Promise<string> {
  const session = await createSession.run({
    title: "Run store",
    idea: "A run store that keeps benchmark data for the monitor.",
  });
  const now = new Date().toISOString();
  await getDb().insert(schema.decisions).values({
    id: `d-storage-${session.id}`,
    sessionId: session.id,
    key: "storage",
    questionTitle: "Where does the data live?",
    questionBody: "",
    offeredChoicesJson: "[]",
    dependsOnJson: "[]",
    introducedBy: "interviewer",
    answerKind: "accepted-recommendation",
    currentAnswer: "On disk",
    settledAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, session.id));
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown } }]);
  await synthesizeSpec.run({ sessionId: session.id });
  return session.id;
}

/** The same, broken into the scenario's tickets, and checked by `check` (seven findings by default). */
async function aCheckedSession(
  options: { markdown?: string; tickets?: Ticket[]; check?: ScriptedTurn } = {},
): Promise<string> {
  const sessionId = await aSessionWithSpec(options.markdown);
  scriptInterviewer([
    { kind: "break-into-tickets", result: { tickets: options.tickets ?? consistencyTickets() } },
    options.check ?? checkTurn(SEVEN),
  ]);
  await breakIntoTickets.run({ sessionId });
  return sessionId;
}

async function cards(sessionId: string) {
  return (await listConsistencyFindings.run({ sessionId })).findings;
}

async function cardId(sessionId: string, number: number): Promise<string> {
  return (await cards(sessionId)).find((card) => card.number === number)!.id;
}

async function specRow(sessionId: string) {
  const [spec] = await getDb()
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, sessionId))
    .limit(1);
  return spec!;
}

async function decisionRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1);
  return row!;
}

/** Re-synthesize the spec with `markdown`, confirming the session again first when an ask left it interviewing. */
async function resynthesize(sessionId: string, markdown: string): Promise<void> {
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, sessionId));
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown } }]);
  await synthesizeSpec.run({ sessionId });
}

describe("ask-consistency-findings", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  beforeEach(() => {
    core.titles = [];
    core.handles = [];
    core.badIdOnCall = null;
    transactions.handles = [];
    transactions.cardUpdates = 0;
  });

  it("asks each card as a decision, in number order, and links it", async () => {
    const sessionId = await aCheckedSession();
    const before = await specRow(sessionId);
    expect(before.current).toBe(true);
    const interviewer = scriptInterviewer([]);
    const [fifth, second] = [await cardId(sessionId, 5), await cardId(sessionId, 2)];
    transactions.handles = [];
    transactions.cardUpdates = 0;

    // Given out of number order on purpose.
    const list = await askConsistencyFindings.run({
      findingIds: [fifth, second],
    });

    expect(core.titles).toEqual([SEVEN[1]!.question, SEVEN[4]!.question]);
    expect(interviewer.requests).toHaveLength(0);
    // Both decisions and both card updates went through the ask's one transaction.
    expect(transactions.handles).toHaveLength(1);
    expect(core.handles).toEqual([transactions.handles[0], transactions.handles[0]]);
    expect(transactions.cardUpdates).toBe(2);

    expect(list.findings.map((card) => [card.number, card.status])).toEqual([
      [1, "open"],
      [2, "asked"],
      [3, "open"],
      [4, "open"],
      [5, "asked"],
      [6, "open"],
      [7, "open"],
    ]);
    for (const number of [2, 5]) {
      const card = list.findings[number - 1]!;
      expect(card.decision).toMatchObject({ state: "unplaced", answer: null });
      const row = await decisionRow(card.decision!.id);
      expect(row).toMatchObject({
        sessionId,
        questionTitle: SEVEN[number - 1]!.question,
        questionBody: decisionBody(SEVEN[number - 1]!),
        introducedBy: "user",
      });
      expect(row.awaitingPlacementSince).not.toBeNull();
      expect(card.decision!.key).toBe(row.key);
    }
    const [stored] = await getDb()
      .select()
      .from(schema.consistencyFindings)
      .where(eq(schema.consistencyFindings.id, list.findings[1]!.id));
    expect(stored!.decisionId).toBe(list.findings[1]!.decision!.id);
    expect(stored!.updatedAt >= stored!.createdAt).toBe(true);

    const tree = await getTree.run({ sessionId });
    expect(
      tree.decisions.filter((decision) => decision.state === "unplaced").map((d) => d.questionTitle).sort(),
    ).toEqual([SEVEN[1]!.question, SEVEN[4]!.question].sort());

    expect(await getSession.run({ id: sessionId })).toMatchObject({
      state: "interviewing",
      doneSummary: null,
    });
    const after = await specRow(sessionId);
    expect(after.current).toBe(false);
    expect(list).toMatchObject({ checked: true, current: false, askable: true });
    expect(list.findings.filter((card) => card.status === "open").map((card) => card.number)).toEqual([
      1, 3, 4, 6, 7,
    ]);
  });

  describe("refusals", () => {
    type Setup = () => Promise<{ findingIds: string[]; sessionIds: string[] }>;
    const rows: [string, Setup, string | null, number | null, string | RegExp][] = [
      [
        "an empty list",
        async () => ({ findingIds: [], sessionIds: [await aCheckedSession()] }),
        null,
        null,
        /Invalid action parameters.*findingIds/,
      ],
      [
        "21 ids",
        async () => ({
          findingIds: Array.from({ length: 21 }, (_, index) => `card-${index}`),
          sessionIds: [await aCheckedSession()],
        }),
        null,
        null,
        /Invalid action parameters.*findingIds/,
      ],
      [
        "the same id twice",
        async () => {
          const sessionId = await aCheckedSession();
          const id = await cardId(sessionId, 2);
          return { findingIds: [id, await cardId(sessionId, 3), id], sessionIds: [sessionId] };
        },
        "duplicate-finding",
        400,
        /^Finding [\w-]+ is listed twice\.$/,
      ],
      [
        "an id no card has, naming the first unknown in input order",
        async () => {
          const sessionId = await aCheckedSession();
          return {
            findingIds: [await cardId(sessionId, 2), "missing-a", "missing-b"],
            sessionIds: [sessionId],
          };
        },
        "finding-not-found",
        404,
        "Reopen card not found: missing-a",
      ],
      [
        "cards from two sessions",
        async () => {
          const first = await aCheckedSession();
          const second = await aCheckedSession();
          return {
            findingIds: [await cardId(first, 2), await cardId(second, 3)],
            sessionIds: [first, second],
          };
        },
        "mixed-sessions",
        400,
        "These cards belong to more than one session. Ask one session's cards at a time.",
      ],
      [
        "a session whose turn is working",
        async () => {
          const sessionId = await aCheckedSession();
          await getDb()
            .update(schema.sessions)
            .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
            .where(eq(schema.sessions.id, sessionId));
          return { findingIds: [await cardId(sessionId, 2)], sessionIds: [sessionId] };
        },
        "turn-in-progress",
        409,
        "The interviewer is working on this session. Wait for the turn to finish before asking a card in the interview.",
      ],
      [
        "a dismissed card, naming the first in number order",
        async () => {
          const sessionId = await aCheckedSession();
          await dismissConsistencyFinding.run({ findingId: await cardId(sessionId, 5) });
          await dismissConsistencyFinding.run({ findingId: await cardId(sessionId, 3) });
          return {
            findingIds: [await cardId(sessionId, 5), await cardId(sessionId, 3), await cardId(sessionId, 1)],
            sessionIds: [sessionId],
          };
        },
        "not-open",
        409,
        "Finding 3 is already dismissed.",
      ],
      [
        "an asked card",
        async () => {
          const sessionId = await aCheckedSession();
          await askConsistencyFindings.run({ findingIds: [await cardId(sessionId, 3)] });
          return {
            findingIds: [await cardId(sessionId, 6), await cardId(sessionId, 3)],
            sessionIds: [sessionId],
          };
        },
        "not-open",
        409,
        "Finding 3 is already asked.",
      ],
      [
        "a card that is not askable",
        async () => {
          const sessionId = await aCheckedSession();
          await resynthesize(sessionId, `${consistencySpecMarkdown()}\nOne more line.\n`);
          return { findingIds: [await cardId(sessionId, 2)], sessionIds: [sessionId] };
        },
        "card-outdated",
        409,
        "These cards came from an earlier spec or breakdown. Check the current tickets first.",
      ],
      [
        "a dismissed card from an outdated check, as not open rather than outdated",
        async () => {
          const sessionId = await aCheckedSession();
          await dismissConsistencyFinding.run({ findingId: await cardId(sessionId, 4) });
          await resynthesize(sessionId, `${consistencySpecMarkdown()}\nOne more line.\n`);
          return {
            findingIds: [await cardId(sessionId, 2), await cardId(sessionId, 4)],
            sessionIds: [sessionId],
          };
        },
        "not-open",
        409,
        "Finding 4 is already dismissed.",
      ],
    ];

    it.each(rows)("refuses %s and writes nothing", async (_, setup, errorCode, statusCode, message) => {
      const { findingIds, sessionIds } = await setup();
      const before = await Promise.all(
        sessionIds.map(async (sessionId) => ({
          cards: await listConsistencyFindings.run({ sessionId }),
          tree: await getTree.run({ sessionId }),
          session: await getSession.run({ id: sessionId }),
          spec: await specRow(sessionId),
        })),
      );
      core.titles = [];
      const interviewer = scriptInterviewer([]);

      const refusal = askConsistencyFindings.run({ findingIds });

      if (errorCode === null) {
        await expect(refusal).rejects.toThrow(message);
      } else {
        await expect(refusal).rejects.toMatchObject({ errorCode, statusCode });
        await expect(refusal).rejects.toThrow(message);
      }
      expect(interviewer.requests).toHaveLength(0);
      expect(core.titles).toEqual([]);
      const after = await Promise.all(
        sessionIds.map(async (sessionId) => ({
          cards: await listConsistencyFindings.run({ sessionId }),
          tree: await getTree.run({ sessionId }),
          session: await getSession.run({ id: sessionId }),
          spec: await specRow(sessionId),
        })),
      );
      expect(after).toEqual(before);
    });
  });

  describe("askable", () => {
    it.each<[string, (sessionId: string) => Promise<void>, boolean]>([
      [
        "after card 2 is asked, card 5 still is, although the spec is not current and updated_at moved",
        async (sessionId) => {
          const before = await specRow(sessionId);
          await askConsistencyFindings.run({ findingIds: [await cardId(sessionId, 2)] });
          const after = await specRow(sessionId);
          expect(after.current).toBe(false);
          expect(after.updatedAt > before.updatedAt).toBe(true);
        },
        true,
      ],
      [
        "after synthesize-spec with different markdown, card 5 is outdated",
        (sessionId) => resynthesize(sessionId, `${consistencySpecMarkdown()}\nOne more line.\n`),
        false,
      ],
      [
        "after synthesize-spec with byte-identical markdown, card 5 still is",
        (sessionId) => resynthesize(sessionId, consistencySpecMarkdown()),
        true,
      ],
    ])("cardsAskable: %s", async (_, change, askable) => {
      const sessionId = await aCheckedSession();
      const spec = await specRow(sessionId);
      expect(spec.consistencySpecSha256).toBe(hashExportContent(spec.markdown));
      await change(sessionId);
      const card5 = await cardId(sessionId, 5);

      if (askable) {
        const list = await askConsistencyFindings.run({ findingIds: [card5] });
        expect(list.findings[4]).toMatchObject({ number: 5, status: "asked" });
      } else {
        expect((await listConsistencyFindings.run({ sessionId })).askable).toBe(false);
        await expect(askConsistencyFindings.run({ findingIds: [card5] })).rejects.toMatchObject({
          errorCode: "card-outdated",
          statusCode: 409,
        });
      }
    });
  });

  it("a failure part way stores nothing", async () => {
    const sessionId = await aCheckedSession();
    const before = {
      cards: await listConsistencyFindings.run({ sessionId }),
      tree: await getTree.run({ sessionId }),
    };
    core.badIdOnCall = 2;

    await expect(
      askConsistencyFindings.run({
        findingIds: [await cardId(sessionId, 1), await cardId(sessionId, 2)],
      }),
    ).rejects.toThrow();

    // The second card was reached: the failure is part way, not before the first write.
    expect(core.titles).toEqual([SEVEN[0]!.question, SEVEN[1]!.question]);
    expect(await getTree.run({ sessionId })).toEqual(before.tree);
    const list = await listConsistencyFindings.run({ sessionId });
    expect(list).toEqual(before.cards);
    expect(list.findings[0]).toMatchObject({ status: "open", decision: null });
    expect(await getSession.run({ id: sessionId })).toMatchObject({ state: "confirmed" });
    expect((await specRow(sessionId)).current).toBe(true);
  });

  describe("list-consistency-findings follows the asked card's decision", () => {
    const ANSWER = "Keep it 30 days after the benchmark ends.";

    /** Place the decision in the tree with no dependency, as a placement round would. */
    async function place(decisionId: string, dependsOn: string[] = []) {
      await getDb()
        .update(schema.decisions)
        .set({ awaitingPlacementSince: null, dependsOnJson: JSON.stringify(dependsOn) })
        .where(eq(schema.decisions.id, decisionId));
    }

    /** Settle it through answer-decision, from an unknown answer. */
    async function settle(decisionId: string) {
      await getDb()
        .update(schema.decisions)
        .set({ answerKind: "unknown", currentAnswer: null })
        .where(eq(schema.decisions.id, decisionId));
      await answerDecision.run({ decisionId, answer: ANSWER });
    }

    it.each<[string, (decisionId: string, sessionId: string) => Promise<void>, Record<string, unknown> | null]>([
      ["added, awaiting placement", async () => {}, { state: "unplaced", answer: null }],
      ["placed and asked", (id) => place(id), { state: "frontier", answer: null }],
      [
        "placed under an open decision",
        async (id, sessionId) => {
          await reopenDecision.run({ decisionId: `d-storage-${sessionId}` });
          await place(id, [`d-storage-${sessionId}`]);
        },
        { state: "blocked", answer: null },
      ],
      [
        "settled with an own answer",
        async (id) => {
          await place(id);
          await settle(id);
        },
        { state: "settled", answer: ANSWER },
      ],
      [
        "later reopened",
        async (id) => {
          await place(id);
          await settle(id);
          await reopenDecision.run({ decisionId: id });
        },
        { state: "frontier", answer: null },
      ],
      [
        "withdrawn by the interviewer",
        async (id) => {
          await place(id);
          await getDb()
            .update(schema.decisions)
            .set({ withdrawnAt: new Date().toISOString() })
            .where(eq(schema.decisions.id, id));
        },
        { state: "withdrawn", answer: null },
      ],
      [
        "stale: a decision it depends on was reopened",
        async (id, sessionId) => {
          await place(id, [`d-storage-${sessionId}`]);
          await settle(id);
          await reopenDecision.run({ decisionId: `d-storage-${sessionId}` });
        },
        { state: "stale", answer: null },
      ],
      [
        "gone",
        async (id) => {
          await getDb().delete(schema.decisions).where(eq(schema.decisions.id, id));
        },
        null,
      ],
    ])("%s", async (_, change, expected) => {
      const sessionId = await aCheckedSession();
      const list = await askConsistencyFindings.run({ findingIds: [await cardId(sessionId, 1)] });
      const decision = list.findings[0]!.decision!;

      await change(decision.id, sessionId);

      const after = await listConsistencyFindings.run({ sessionId });
      expect(after.findings[0]!.status).toBe("asked");
      expect(after.findings[0]!.decision).toEqual(
        expected === null ? null : { id: decision.id, key: decision.key, ...expected },
      );
      // A card never asked has no decision.
      expect(after.findings[1]!.decision).toBeNull();
    });
  });

  describe("list-consistency-findings reports the check's note", () => {
    const RATE_LIMITED = rateLimitedTurn("check-consistency");

    it.each<[string, () => Promise<string>, { code: string; message: string } | null]>([
      [
        "a breakdown whose check is rate limited",
        () => aCheckedSession({ check: RATE_LIMITED }),
        {
          code: "rate-limited",
          message:
            "The Claude subscription is rate limited right now. This is not an interviewer failure: wait and retry the turn.",
        },
      ],
      [
        "a breakdown of 41 tickets",
        () =>
          aCheckedSession({
            markdown: GOOD_SPEC_MARKDOWN,
            tickets: flatTickets(MAX_HANDOFF_SCOUT_TICKETS + 1),
          }),
        {
          code: "too-many-tickets",
          message:
            "The breakdown has 41 tickets; one consistency check covers at most 40, so the check was skipped.",
        },
      ],
      ["a breakdown whose check is accepted", () => aCheckedSession(), null],
      [
        "the note, then an accepted check-consistency",
        async () => {
          const sessionId = await aCheckedSession({ check: RATE_LIMITED });
          scriptInterviewer([checkTurn(SEVEN)]);
          await checkConsistency.run({ sessionId });
          return sessionId;
        },
        null,
      ],
      [
        "the note, then a failed check-consistency",
        async () => {
          const sessionId = await aCheckedSession({ check: RATE_LIMITED });
          scriptInterviewer([RATE_LIMITED]);
          await expect(checkConsistency.run({ sessionId })).rejects.toMatchObject({
            errorCode: "rate-limited",
          });
          expect((await getSession.run({ id: sessionId })).turnStatus).toBe("failed");
          return sessionId;
        },
        null,
      ],
      [
        "a failed turn after an accepted check",
        async () => {
          const sessionId = await aCheckedSession();
          scriptInterviewer([RATE_LIMITED]);
          await expect(checkConsistency.run({ sessionId })).rejects.toThrow();
          return sessionId;
        },
        null,
      ],
      [
        "an idle error the check did not leave (a supersession failure) on a breakdown from before the attempt stamp",
        async () => {
          const sessionId = await aCheckedSession({ check: RATE_LIMITED });
          await getDb()
            .update(schema.specs)
            .set({ consistencyAttemptedFor: null })
            .where(eq(schema.specs.sessionId, sessionId));
          await getDb()
            .update(schema.sessions)
            .set({
              turnStatus: "idle",
              turnErrorCode: "supersession-failed",
              turnErrorMessage: "Could not check for superseded answers.",
            })
            .where(eq(schema.sessions.id, sessionId));
          return sessionId;
        },
        null,
      ],
      [
        "an idle error while the accepted check's stamp matches the breakdown",
        async () => {
          const sessionId = await aCheckedSession();
          await getDb()
            .update(schema.sessions)
            .set({
              turnStatus: "idle",
              turnErrorCode: "supersession-failed",
              turnErrorMessage: "Could not check for superseded answers.",
            })
            .where(eq(schema.sessions.id, sessionId));
          return sessionId;
        },
        null,
      ],
      ["no breakdown yet", () => aSessionWithSpec(), null],
      [
        "no spec",
        async () =>
          (await createSession.run({ title: "Bare", idea: "Nothing yet." })).id,
        null,
      ],
    ])("%s", async (_, setup, note) => {
      const sessionId = await setup();
      expect((await listConsistencyFindings.run({ sessionId })).note).toEqual(note);
    });
  });
});
