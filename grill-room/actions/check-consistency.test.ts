import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { normaliseQuote, specSections } from "../server/consistency.js";
import {
  consistencyFindingsResult,
  consistencySpecMarkdown,
  consistencyTickets,
  createFakeInterviewer,
  FAKE_CLI_METRICS,
} from "../server/interviewer/fake.js";
import {
  buildPrompt,
  type CheckConsistencyRequest,
  type ConsistencyFinding,
  type ConsistencyPlace,
  MAX_HANDOFF_SCOUT_TICKETS,
  rateLimitedTurn,
  resetInterviewer,
  type ResultFor,
  scriptInterviewer,
  type ScriptedTurn,
  setInterviewer,
} from "../server/interviewer/index.js";
import { MAX_TURN_RETRIES } from "../server/turn.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import askConsistencyFindings from "./ask-consistency-findings.js";
import breakIntoTickets from "./break-into-tickets.js";
import checkConsistency from "./check-consistency.js";
import createSession from "./create-session.js";
import dismissConsistencyFinding from "./dismiss-consistency-finding.js";
import getSession from "./get-session.js";
import listConsistencyFindings from "./list-consistency-findings.js";
import reopenDecision from "./reopen-decision.js";
import synthesizeSpec from "./synthesize-spec.js";

type Ticket = ResultFor<"break-into-tickets">["tickets"][number];

/**
 * A spec holding none of the prompt task section's examples, like
 * `break-into-tickets.test.ts`'s own, which is private to that file.
 */
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

function aSession() {
  return createSession.run({
    title: "Run store",
    idea: "A run store that keeps benchmark data for the monitor.",
  });
}

async function confirm(sessionId: string) {
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, sessionId));
}

/** `storage`, settled: the decision the fixture's first finding comes from. */
async function aSettledStorageDecision(sessionId: string): Promise<string> {
  const now = new Date().toISOString();
  const id = `d-storage-${sessionId}`;
  await getDb().insert(schema.decisions).values({
    id,
    sessionId,
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
  return id;
}

/** A confirmed session with a settled `storage` decision and a current spec, not yet broken into tickets. */
async function aSessionWithSpec(markdown = consistencySpecMarkdown()): Promise<string> {
  const session = await aSession();
  await aSettledStorageDecision(session.id);
  await confirm(session.id);
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown } }]);
  await synthesizeSpec.run({ sessionId: session.id });
  return session.id;
}

/**
 * The same, broken into `tickets`. The check that follows the breakdown is
 * answered with no findings, unscripted, unless `check` scripts it.
 */
async function aSessionWithTickets(
  options: { markdown?: string; tickets?: Ticket[]; check?: ScriptedTurn } = {},
): Promise<string> {
  const sessionId = await aSessionWithSpec(options.markdown);
  scriptInterviewer([
    { kind: "break-into-tickets", result: { tickets: options.tickets ?? consistencyTickets() } },
    ...(options.check ? [options.check] : []),
  ]);
  await breakIntoTickets.run({ sessionId });
  return sessionId;
}

function checkTurn(findings: ConsistencyFinding[]): ScriptedTurn {
  return { kind: "check-consistency", result: { findings } };
}

function inSpec(quote: string, section = "Implementation Decisions"): ConsistencyPlace {
  return { artefact: "spec", section, ticket: null, quote };
}

function inTicket(ticket: number, quote: string): ConsistencyPlace {
  return { artefact: "ticket", section: null, ticket, quote };
}

const SEVEN = consistencyFindingsResult().findings;

/** The fixture's seven findings, with the given ones (by number) misquoted. */
function sevenWithMisquotes(...numbers: number[]): ConsistencyFinding[] {
  return SEVEN.map((finding, index) =>
    numbers.includes(index + 1)
      ? { ...finding, at: { ...finding.at, quote: `${finding.at.quote} (misquoted)` } }
      : finding,
  );
}

function misquote(finding: number, quote: string, where: string): string {
  return `Finding ${finding} quotes "${quote}", which is not in ${where}. Copy the words exactly as they are written there.`;
}

/** Build tickets 1 to `count`, none blocked, each building the good spec's one story. */
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

async function specRow(sessionId: string) {
  const [spec] = await getDb()
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, sessionId))
    .limit(1);
  return spec!;
}

describe("check-consistency", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  describe("the request", () => {
    it("sends the spec and every ticket in number order, in no conversation and with no docs folder on every attempt, and the refused result on the retry", async () => {
      const gate: Ticket = {
        number: 5,
        slug: "staging-account",
        title: "Get a staging account",
        body: "The owner provides a staging account.",
        blockedBy: [],
        implements: [],
        implementsDecisions: [],
        kind: "gate",
        waitsFor: "A staging account from the owner",
      };
      const tickets = consistencyTickets().map((ticket) =>
        ticket.number === 4 ? { ...ticket, blockedBy: [1, 2, 3, 5] } : ticket,
      );
      const sessionId = await aSessionWithTickets({ tickets: [gate, ...tickets].reverse() });
      await getDb()
        .update(schema.sessions)
        .set({ docsFolder: "/tmp/grill-room-docs" })
        .where(eq(schema.sessions.id, sessionId));
      const before = await getSession.run({ id: sessionId });
      expect(before.conversationId).not.toBeNull();
      const refused = sevenWithMisquotes(1);
      const interviewer = scriptInterviewer([checkTurn(refused), checkTurn(SEVEN)]);

      await checkConsistency.run({ sessionId });

      const requests = interviewer.requests as CheckConsistencyRequest[];
      expect(requests.map((request) => request.kind)).toEqual([
        "check-consistency",
        "check-consistency",
      ]);
      expect(requests[0]!.specMarkdown).toBe(consistencySpecMarkdown());
      expect(requests[0]!.tickets).toEqual(
        [...tickets, gate].map(({ number, title, body, kind, waitsFor }) => ({
          number,
          title,
          body,
          kind,
          waitsFor,
        })),
      );
      for (const request of requests) {
        expect(request.context.conversationId).toBeNull();
        expect(request.context.docsFolder).toBeNull();
      }
      expect(requests[0]!.previousResult).toBeNull();
      expect(requests[1]!.previousResult).toEqual({ findings: refused });
      expect((await getSession.run({ id: sessionId })).conversationId).toBe(before.conversationId);
    });
  });

  describe("retries", () => {
    it.each<[string, ConsistencyFinding, string]>([
      [
        "a misquote",
        { ...SEVEN[0]!, at: inSpec("must outlast the benchmark horizons") },
        misquote(1, "must outlast the benchmark horizons", `the spec's "Implementation Decisions" section`),
      ],
      [
        "a ticket not in the breakdown",
        { ...SEVEN[1]!, at: inTicket(7, "capped at N x cadence") },
        "Finding 1 names ticket 7, which is not in the breakdown. The tickets are 1-4.",
      ],
      [
        "a statement for a question",
        { ...SEVEN[0]!, question: "Define the horizon." },
        'Finding 1\'s question must be one question to the owner, ending with "?".',
      ],
    ])("rejects %s, and asks again", async (_, bad, reason) => {
      const sessionId = await aSessionWithTickets();
      const interviewer = scriptInterviewer([checkTurn([bad]), checkTurn([SEVEN[0]!])]);

      const list = await checkConsistency.run({ sessionId });

      expect(interviewer.requests).toHaveLength(2);
      expect((interviewer.requests[1] as CheckConsistencyRequest).rejectionReason).toBe(reason);
      expect(list.findings.map((finding) => finding.question)).toEqual([SEVEN[0]!.question]);
    });

    it("rejects a decision key the tree holds but has reopened, and asks again", async () => {
      const sessionId = await aSessionWithTickets();
      await reopenDecision.run({ decisionId: `d-storage-${sessionId}` });
      await confirm(sessionId);
      scriptInterviewer([
        { kind: "synthesize-spec", result: { markdown: consistencySpecMarkdown() } },
        { kind: "break-into-tickets", result: { tickets: consistencyTickets() } },
      ]);
      await synthesizeSpec.run({ sessionId });
      await breakIntoTickets.run({ sessionId });
      const [fromStorage] = SEVEN;
      expect(fromStorage!.decisionKey).toBe("storage");
      const interviewer = scriptInterviewer([
        checkTurn([fromStorage!]),
        checkTurn([{ ...fromStorage!, decisionKey: null }]),
      ]);

      const list = await checkConsistency.run({ sessionId });

      expect((interviewer.requests[0] as CheckConsistencyRequest).context.decisions).toContainEqual(
        expect.objectContaining({ key: "storage" }),
      );
      expect((interviewer.requests[1] as CheckConsistencyRequest).rejectionReason).toBe(
        'Finding 1 names decision "storage", which is not a settled decision of this tree. Give a settled decision\'s key, or null.',
      );
      expect(list.findings.map((finding) => finding.decisionKey)).toEqual([null]);
    });

    it("after the last retry, keeps the valid findings and notes the dropped ones", async () => {
      const sessionId = await aSessionWithTickets();
      const invalid = { ...SEVEN[1]!, at: inTicket(2, "capped at M x cadence") };
      const interviewer = scriptInterviewer(
        Array.from({ length: MAX_TURN_RETRIES + 1 }, () => checkTurn([SEVEN[0]!, invalid])),
      );

      const list = await checkConsistency.run({ sessionId });

      expect(interviewer.requests).toHaveLength(MAX_TURN_RETRIES + 1);
      expect(list.findings.map((finding) => finding.question)).toEqual([SEVEN[0]!.question]);
      const turn = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
      expect(turn?.outcome).toBe("succeeded");
      const attempts = turn!.runs[0]!.attempts;
      expect(attempts.map((attempt) => attempt.kind)).toEqual([
        "tree-rule-refusal",
        "tree-rule-refusal",
        "success",
      ]);
      expect(attempts[attempts.length - 1]!.reason).toBe(
        `Kept the valid findings after the last retry. Dropped finding 2 (${misquote(2, "capped at M x cadence", "ticket 2")}).`,
      );
    });
  });

  describe("reopen cards", () => {
    it("stores 7 findings as 7 open cards numbered in result order, and stamps the spec with the breakdown and the turn", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings.map((finding) => [finding.number, finding.status, finding.question])).toEqual(
        SEVEN.map((finding, index) => [index + 1, "open", finding.question]),
      );
      expect(list.findings.map(({ kind, at, against, decisionKey }) => ({ kind, at, against, decisionKey }))).toEqual(
        SEVEN.map(({ kind, at, against, decisionKey }) => ({ kind, at, against, decisionKey })),
      );
      const spec = await specRow(sessionId);
      const turn = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
      expect(spec.consistencyCheckedFor).toBe(spec.ticketsGeneratedAt);
      expect(spec.consistencyTurnId).toBe(turn!.id);
      expect(list).toMatchObject({ checked: true, current: true, turnId: turn!.id });
    });

    it("stores no cards for no findings, deleting the earlier ones, and stamps the spec", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN.slice(0, 3))]);
      expect((await checkConsistency.run({ sessionId })).findings).toHaveLength(3);
      const first = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
      scriptInterviewer([checkTurn([])]);

      const list = await checkConsistency.run({ sessionId });

      const second = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
      expect(second!.id).not.toBe(first!.id);
      expect(list).toEqual({
        findings: [],
        checked: true,
        current: true,
        askable: true,
        note: null,
        turnId: second!.id,
      });
      const spec = await specRow(sessionId);
      expect(spec.consistencyCheckedFor).toBe(spec.ticketsGeneratedAt);
      expect(spec.consistencyTurnId).toBe(second!.id);
    });

    it("stores a finding matching a dismissed card dismissed", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const first = await checkConsistency.run({ sessionId });
      await dismissConsistencyFinding.run({ findingId: first.findings[4]!.id });
      // The same finding, its quote wrapped differently: the match key is
      // the kind and both quotes, normalised.
      const again = SEVEN.map((finding, index) =>
        index === 4 ? { ...finding, at: inTicket(3, "Checkout or\n  Payment Element") } : finding,
      );
      scriptInterviewer([checkTurn(again)]);

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings.map((finding) => finding.status)).toEqual([
        "open",
        "open",
        "open",
        "open",
        "dismissed",
        "open",
        "open",
      ]);
    });

    it("stores a dismissed contradiction that recurs with its sides swapped dismissed", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const first = await checkConsistency.run({ sessionId });
      const contradiction = first.findings[3]!;
      expect(contradiction.kind).toBe("spec-ticket-contradiction");
      await dismissConsistencyFinding.run({ findingId: contradiction.id });
      const swapped = SEVEN.map((finding, index) =>
        index === 3 ? { ...finding, at: finding.against!, against: finding.at } : finding,
      );
      scriptInterviewer([checkTurn(swapped)]);

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings[3]).toMatchObject({
        at: SEVEN[3]!.against,
        against: SEVEN[3]!.at,
        status: "dismissed",
      });
    });

    it.each<[string, (finding: ConsistencyFinding) => ConsistencyFinding, number]>([
      [
        "another kind at the dismissed quote",
        (finding) => ({ ...finding, kind: "unnamed-target" }),
        4,
      ],
      [
        "a contradiction with another `against` quote",
        (finding) => ({
          ...finding,
          against: inTicket(1, "delete run data once it is older than the retention window"),
        }),
        3,
      ],
    ])("stores %s open", async (_, change, index) => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const first = await checkConsistency.run({ sessionId });
      await dismissConsistencyFinding.run({ findingId: first.findings[index]!.id });
      const changed = SEVEN.map((finding, position) =>
        position === index ? change(finding) : finding,
      );
      scriptInterviewer([checkTurn(changed)]);

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings).toHaveLength(7);
      expect(list.findings.map((finding) => finding.status)).toEqual(SEVEN.map(() => "open"));
    });

    it("stores one card for a contradiction reported in both orders", async () => {
      const sessionId = await aSessionWithTickets();
      const both = [
        SEVEN[3]!,
        { ...SEVEN[3]!, at: SEVEN[3]!.against!, against: SEVEN[3]!.at, question: "Now or later?" },
      ];
      const interviewer = scriptInterviewer(
        Array.from({ length: MAX_TURN_RETRIES + 1 }, () => checkTurn(both)),
      );

      const list = await checkConsistency.run({ sessionId });

      expect((interviewer.requests[1] as CheckConsistencyRequest).rejectionReason).toBe(
        "Finding 2 repeats finding 1. Report each finding once.",
      );
      expect(list.findings.map((finding) => finding.question)).toEqual([SEVEN[3]!.question]);
    });

    it("stores a finding matching an asked card open", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      const { findings } = await listConsistencyFindings.run({ sessionId });
      await askConsistencyFindings.run({ findingIds: [findings[1]!.id] });
      await dismissConsistencyFinding.run({ findingId: findings[4]!.id });
      // Asking sent the session back to the interview: confirm it again,
      // synthesize, and break into tickets, whose check reports the same seven.
      await confirm(sessionId);
      scriptInterviewer([
        { kind: "synthesize-spec", result: { markdown: consistencySpecMarkdown() } },
        { kind: "break-into-tickets", result: { tickets: consistencyTickets() } },
        checkTurn(SEVEN),
      ]);
      await synthesizeSpec.run({ sessionId });
      await breakIntoTickets.run({ sessionId });

      const list = await listConsistencyFindings.run({ sessionId });

      expect(list.findings.map((finding) => finding.status)).toEqual([
        "open",
        "open",
        "open",
        "open",
        "dismissed",
        "open",
        "open",
      ]);
      expect(list.findings[1]!.decision).toBeNull();
      expect(list.current).toBe(true);
    });

    it("stores a finding matching an open card open, as a fresh card", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const first = await checkConsistency.run({ sessionId });
      scriptInterviewer([checkTurn(SEVEN)]);

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings.map((finding) => finding.status)).toEqual(SEVEN.map(() => "open"));
      const earlierIds = new Set(first.findings.map((finding) => finding.id));
      expect(list.findings.filter((finding) => earlierIds.has(finding.id))).toEqual([]);
    });

    it("stores the 5 valid findings of 7 numbered 1-5 after the last retry, and notes the dropped ones", async () => {
      const sessionId = await aSessionWithTickets();
      const findings = sevenWithMisquotes(2, 5);
      scriptInterviewer(Array.from({ length: MAX_TURN_RETRIES + 1 }, () => checkTurn(findings)));

      const list = await checkConsistency.run({ sessionId });

      expect(list.findings.map((finding) => [finding.number, finding.question])).toEqual(
        [SEVEN[0]!, SEVEN[2]!, SEVEN[3]!, SEVEN[5]!, SEVEN[6]!].map((finding, index) => [
          index + 1,
          finding.question,
        ]),
      );
      const turn = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
      const attempts = turn!.runs[0]!.attempts;
      expect(attempts[attempts.length - 1]!.reason).toBe(
        `Kept the valid findings after the last retry. Dropped finding 2 (${misquote(2, "capped at N x cadence (misquoted)", "ticket 2")}); finding 5 (${misquote(5, "Checkout or Payment Element (misquoted)", "ticket 3")}).`,
      );
    });

    it("leaves the cards and the stamp unchanged when the pass fails at the port", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const before = await checkConsistency.run({ sessionId });
      const specBefore = await specRow(sessionId);
      scriptInterviewer([rateLimitedTurn("check-consistency")]);

      await expect(checkConsistency.run({ sessionId })).rejects.toMatchObject({
        errorCode: "rate-limited",
      });

      expect(await listConsistencyFindings.run({ sessionId })).toEqual(before);
      const specAfter = await specRow(sessionId);
      expect(specAfter.consistencyCheckedFor).toBe(specBefore.consistencyCheckedFor);
      expect(specAfter.consistencyTurnId).toBe(specBefore.consistencyTurnId);
    });

    it("leaves the cards and the stamp unchanged when the pass throws", async () => {
      const sessionId = await aSessionWithTickets();
      scriptInterviewer([checkTurn(SEVEN)]);
      const before = await checkConsistency.run({ sessionId });
      const specBefore = await specRow(sessionId);
      setInterviewer({
        ...createFakeInterviewer(),
        checkConsistency: () => Promise.reject(new Error("The check broke.")),
      });

      await expect(checkConsistency.run({ sessionId })).rejects.toThrow("The check broke.");

      expect(await listConsistencyFindings.run({ sessionId })).toEqual(before);
      const specAfter = await specRow(sessionId);
      expect(specAfter.consistencyCheckedFor).toBe(specBefore.consistencyCheckedFor);
      expect(specAfter.consistencyTurnId).toBe(specBefore.consistencyTurnId);
      expect(await getSession.run({ id: sessionId })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "failed",
        turnErrorMessage: "The consistency check failed.",
      });
    });
  });

  describe("list-consistency-findings reports whether the cards match today's tickets", () => {
    it("reads unchecked with no spec, unchecked before any pass, current after one, and not current once the spec is synthesized again", async () => {
      const bare = await aSession();
      expect(await listConsistencyFindings.run({ sessionId: bare.id })).toEqual({
        findings: [],
        checked: false,
        current: false,
        askable: false,
        note: null,
        turnId: null,
      });

      const sessionId = await aSessionWithSpec();
      expect(await listConsistencyFindings.run({ sessionId })).toMatchObject({
        checked: false,
        current: false,
        turnId: null,
      });

      scriptInterviewer([
        { kind: "break-into-tickets", result: { tickets: consistencyTickets() } },
        checkTurn(SEVEN),
      ]);
      await breakIntoTickets.run({ sessionId });
      expect(await listConsistencyFindings.run({ sessionId })).toMatchObject({
        checked: true,
        current: true,
      });

      scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: consistencySpecMarkdown() } }]);
      await synthesizeSpec.run({ sessionId });
      const list = await listConsistencyFindings.run({ sessionId });
      expect(list).toMatchObject({ checked: true, current: false });
      expect(list.findings).toHaveLength(7);
    });

    it("reads not current after a decision is reopened", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      expect((await listConsistencyFindings.run({ sessionId })).current).toBe(true);

      await reopenDecision.run({ decisionId: `d-storage-${sessionId}` });

      const list = await listConsistencyFindings.run({ sessionId });
      expect(list).toMatchObject({ checked: true, current: false });
      expect(list.findings).toHaveLength(7);
    });

    it("reads not current after a breakdown whose pass is rate-limited", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      scriptInterviewer([
        { kind: "break-into-tickets", result: { tickets: consistencyTickets() } },
        rateLimitedTurn("check-consistency"),
      ]);

      await breakIntoTickets.run({ sessionId });

      const list = await listConsistencyFindings.run({ sessionId });
      expect(list).toMatchObject({ checked: true, current: false });
      expect(list.findings).toHaveLength(7);
    });
  });

  describe("refusals", () => {
    const setups: [string, () => Promise<string>, string, number, string | RegExp][] = [
      ["an unknown session", async () => "missing", "action_failed", 404, "Session not found: missing"],
      [
        "a turn in progress",
        async () => {
          const sessionId = await aSessionWithTickets();
          await getDb()
            .update(schema.sessions)
            .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
            .where(eq(schema.sessions.id, sessionId));
          return sessionId;
        },
        "turn-in-progress",
        409,
        /interviewer is working/,
      ],
      [
        "a session that is not confirmed",
        async () => (await aSession()).id,
        "not-confirmed",
        409,
        /Only a confirmed session/,
      ],
      [
        "a session with no spec",
        async () => {
          const session = await aSession();
          await confirm(session.id);
          return session.id;
        },
        "spec-missing",
        409,
        /no spec yet/,
      ],
      ["a session with no tickets", () => aSessionWithSpec(), "no-tickets", 409, /no tickets yet/],
      [
        "tickets not current with the spec",
        async () => {
          const sessionId = await aSessionWithTickets();
          scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: consistencySpecMarkdown() } }]);
          await synthesizeSpec.run({ sessionId });
          return sessionId;
        },
        "tickets-not-current",
        409,
        "Break the current spec into tickets before checking them.",
      ],
    ];

    it.each(setups)("refuses %s", async (_, setup, errorCode, statusCode, message) => {
      const sessionId = await setup();
      const interviewer = scriptInterviewer([]);

      const refusal = checkConsistency.run({ sessionId });

      await expect(refusal).rejects.toMatchObject({ errorCode, statusCode });
      await expect(refusal).rejects.toThrow(message);
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses more tickets than one check covers", async () => {
      const sessionId = await aSessionWithTickets({
        markdown: GOOD_SPEC_MARKDOWN,
        tickets: flatTickets(MAX_HANDOFF_SCOUT_TICKETS + 1),
      });
      const before = await getSession.run({ id: sessionId });
      const interviewer = scriptInterviewer([]);

      const refusal = checkConsistency.run({ sessionId });

      await expect(refusal).rejects.toMatchObject({
        errorCode: "too-many-tickets",
        statusCode: 409,
        message: "The breakdown has 41 tickets; one consistency check covers at most 40.",
      });
      expect(interviewer.requests).toHaveLength(0);
      expect(await findLatestTurn({ sessionId, turnKind: "check-consistency" })).toBeNull();
      const after = await getSession.run({ id: sessionId });
      expect(after.turnErrorCode).toBe(before.turnErrorCode);
      expect(after.turnErrorMessage).toBe(before.turnErrorMessage);
      expect(after.turnStatus).toBe(before.turnStatus);
    });

    it("checks the ticket cap last: stale tickets over the cap are refused as not current", async () => {
      const sessionId = await aSessionWithTickets({
        markdown: GOOD_SPEC_MARKDOWN,
        tickets: flatTickets(MAX_HANDOFF_SCOUT_TICKETS + 1),
      });
      scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: GOOD_SPEC_MARKDOWN } }]);
      await synthesizeSpec.run({ sessionId });
      const interviewer = scriptInterviewer([]);

      await expect(checkConsistency.run({ sessionId })).rejects.toMatchObject({
        errorCode: "tickets-not-current",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("checks exactly as many tickets as one check covers", async () => {
      const sessionId = await aSessionWithTickets({
        markdown: GOOD_SPEC_MARKDOWN,
        tickets: flatTickets(MAX_HANDOFF_SCOUT_TICKETS),
      });
      const interviewer = scriptInterviewer([checkTurn([])]);

      await checkConsistency.run({ sessionId });

      expect(interviewer.requests.map((request) => request.kind)).toEqual(["check-consistency"]);
      expect((interviewer.requests[0] as CheckConsistencyRequest).tickets).toHaveLength(40);
    });
  });

  describe("dismiss-consistency-finding", () => {
    it("dismisses an open card and returns the session's cards", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      const { findings } = await listConsistencyFindings.run({ sessionId });

      const list = await dismissConsistencyFinding.run({ findingId: findings[1]!.id });

      expect(list.findings.map((finding) => finding.status)).toEqual([
        "open",
        "dismissed",
        "open",
        "open",
        "open",
        "open",
        "open",
      ]);
      expect(list.current).toBe(true);
    });

    it("refuses a card that does not exist", async () => {
      await expect(dismissConsistencyFinding.run({ findingId: "missing" })).rejects.toMatchObject({
        errorCode: "finding-not-found",
        statusCode: 404,
      });
    });

    it("refuses a card that is not open", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      const { findings } = await listConsistencyFindings.run({ sessionId });
      await dismissConsistencyFinding.run({ findingId: findings[0]!.id });

      await expect(
        dismissConsistencyFinding.run({ findingId: findings[0]!.id }),
      ).rejects.toMatchObject({ errorCode: "not-open", statusCode: 409 });
    });

    it("refuses an asked card", async () => {
      const sessionId = await aSessionWithTickets({ check: checkTurn(SEVEN) });
      const { findings } = await listConsistencyFindings.run({ sessionId });
      await askConsistencyFindings.run({ findingIds: [findings[1]!.id] });
      const before = await listConsistencyFindings.run({ sessionId });

      const refusal = dismissConsistencyFinding.run({ findingId: findings[1]!.id });

      await expect(refusal).rejects.toMatchObject({ errorCode: "not-open", statusCode: 409 });
      await expect(refusal).rejects.toThrow("Finding 2 is already asked.");
      expect(await listConsistencyFindings.run({ sessionId })).toEqual(before);
    });
  });

  it("records the pass as its own turn, with each attempt's usage", async () => {
    const sessionId = await aSessionWithTickets();
    const session = await getSession.run({ id: sessionId });
    scriptInterviewer([checkTurn(sevenWithMisquotes(1)), checkTurn(SEVEN)]);

    await checkConsistency.run({ sessionId });

    const turn = await findLatestTurn({ sessionId, turnKind: "check-consistency" });
    expect(turn).toMatchObject({
      sessionId,
      turnKind: "check-consistency",
      model: session.model,
      outcome: "succeeded",
    });
    const attempts = turn!.runs[0]!.attempts;
    expect(attempts.map((attempt) => attempt.kind)).toEqual(["tree-rule-refusal", "success"]);
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({ ...FAKE_CLI_METRICS });
    }
  });

  it("refuses a quote found only in the prompt's own examples", async () => {
    const sessionId = await aSessionWithTickets({
      markdown: GOOD_SPEC_MARKDOWN,
      tickets: [
        {
          number: 1,
          slug: "build-the-workspace",
          title: "Build the workspace",
          body: "Build the workspace shell.",
          blockedBy: [],
          implements: [1],
          implementsDecisions: [],
          kind: "build",
          waitsFor: null,
        },
      ],
    });
    const interviewer = scriptInterviewer([
      checkTurn([{ ...SEVEN[1]!, at: inTicket(1, "capped at N x cadence") }]),
      checkTurn([]),
    ]);

    await checkConsistency.run({ sessionId });

    const [first, retry] = interviewer.requests as CheckConsistencyRequest[];
    // The model was shown those words, wrapped across a line of the task
    // section's examples: a check matching against the prompt would accept them.
    expect(normaliseQuote(buildPrompt(first!))).toContain("capped at N x cadence");
    expect(retry!.rejectionReason).toBe(misquote(1, "capped at N x cadence", "ticket 1"));
  });

  describe("seam: every finding shaped as the prompt describes passes the check", () => {
    /** The fixture's tickets, and a gate ticket 5 that ticket 4 waits for. */
    const withGate: Ticket[] = [
      ...consistencyTickets().map((ticket) =>
        ticket.number === 4 ? { ...ticket, blockedBy: [1, 2, 3, 5] } : ticket,
      ),
      {
        number: 5,
        slug: "staging-account",
        title: "Get a staging account",
        body: "The owner provides a staging account.",
        blockedBy: [],
        implements: [],
        implementsDecisions: [],
        kind: "gate",
        waitsFor: "An account on the staging host, from the owner",
      },
    ];

    /** Each kind's example, exactly as the task section quotes it. */
    const EXAMPLES = {
      threshold: "Run data must outlast the benchmark horizon",
      cap: "capped at N x cadence",
      oneCase: "A run whose run_id starts with `wf_` gets a root span",
      placeholder: "a placeholder for a later ticket",
      choice: "Use Checkout or Payment Element",
      timeout: "Unpaid accepted bookings follow a defined timeout",
      target: "deployable to a staging environment",
    };

    it.each<[string, boolean]>([
      ["with the spec side first", true],
      ["with the ticket side first", false],
    ])(
      "accepts one finding of every kind, quoting the examples verbatim, %s, at once",
      async (_, specFirst) => {
        const sessionId = await aSessionWithSpec();
        const breakdown = scriptInterviewer([
          { kind: "break-into-tickets", result: { tickets: withGate } },
        ]);
        await breakIntoTickets.run({ sessionId });
        const sent = breakdown.requests.find(
          (request): request is CheckConsistencyRequest => request.kind === "check-consistency",
        )!;
        const prompt = buildPrompt(sent);

        // Every example is quoted as the prompt gives it.
        for (const example of Object.values(EXAMPLES)) {
          expect(normaliseQuote(prompt)).toContain(`"${example}"`);
        }
        // The section names as the model reads them: every "## " heading
        // inside the fenced spec under "## The spec", the same the check reads.
        const lines = prompt.split("\n");
        const specStart = lines.indexOf("## The spec") + 2;
        const fence = lines[specStart]!.replace("markdown", "");
        const specEnd = lines.indexOf(fence, specStart + 1);
        const sections = lines
          .slice(specStart + 1, specEnd)
          .flatMap((line) => (line.startsWith("## ") ? [line.slice(3)] : []));
        expect(sections).toEqual(
          specSections(consistencySpecMarkdown()).map((found) => found.name),
        );
        const section = sections.find((name) => name === "Implementation Decisions")!;
        // The one settled decision in the prompt's tree.
        expect(prompt).toContain("[storage]");
        expect(prompt).toContain("Waits for: An account on the staging host, from the owner");

        const spec = (quote: string): ConsistencyPlace => ({
          artefact: "spec",
          section,
          ticket: null,
          quote,
        });
        const ticket = (number: number, quote: string): ConsistencyPlace => ({
          artefact: "ticket",
          section: null,
          ticket: number,
          quote,
        });
        const [placeholder, fillIn] = [spec(EXAMPLES.placeholder), ticket(1, "Fill in Retention")];
        const shaped: ConsistencyFinding[] = [
          {
            kind: "unquantified-threshold",
            at: spec(EXAMPLES.threshold),
            against: null,
            question: "How long after the benchmark ends must run data be kept?",
            decisionKey: null,
          },
          {
            kind: "unquantified-threshold",
            at: ticket(2, EXAMPLES.cap),
            against: null,
            question: "What is N?",
            decisionKey: "storage",
          },
          {
            kind: "one-case-rule",
            at: spec(EXAMPLES.oneCase),
            against: null,
            question: "Which root span does a run driven by hand get?",
            decisionKey: null,
          },
          {
            kind: "spec-ticket-contradiction",
            at: specFirst ? placeholder : fillIn,
            against: specFirst ? fillIn : placeholder,
            question: "Is Retention filled in now or later?",
            decisionKey: null,
          },
          {
            kind: "open-choice",
            at: ticket(3, EXAMPLES.choice),
            against: null,
            question: "Which does the booking payment use: Checkout or Payment Element?",
            decisionKey: null,
          },
          {
            kind: "undefaulted-value",
            at: spec(EXAMPLES.timeout),
            against: null,
            question: "How long can an accepted booking stay unpaid?",
            decisionKey: null,
          },
          {
            kind: "unnamed-target",
            at: ticket(4, EXAMPLES.target),
            against: null,
            question: "Which host is the staging environment?",
            decisionKey: null,
          },
          {
            // A phrase from mid-sentence that opens on a capitalised word
            // keeps its capital: the case rule is the text's, letter by letter.
            kind: "open-choice",
            at: ticket(3, "Checkout or Payment Element"),
            against: null,
            question: "Checkout or Payment Element: which one?",
            decisionKey: null,
          },
          {
            // A gate's words are its title, its body and its `waitsFor` (D7).
            kind: "unnamed-target",
            at: ticket(5, "An account on the staging host"),
            against: null,
            question: "Which account, on which host?",
            decisionKey: null,
          },
        ];
        const interviewer = scriptInterviewer([checkTurn(shaped)]);

        const list = await checkConsistency.run({ sessionId });

        expect(interviewer.requests).toHaveLength(1);
        expect(list.findings).toHaveLength(shaped.length);
        expect(new Set(list.findings.map((finding) => finding.kind)).size).toBe(6);
      },
    );
  });
});

