/**
 * The consistency check: what a finished spec and its tickets leave a builder
 * to decide alone — a threshold with no number, a rule stated for one case, a
 * spec and a ticket that disagree, an "X or Y" left open, a value called
 * defined with no value, a target named only by its role.
 *
 * App computes, agent judges. The model judges whether a statement leaves
 * something open; the app checks, deterministically, that every quote really
 * is in the place the finding names, that the place exists, and that the
 * finding's fields agree with its kind. A finding that fails is sent back with
 * the reason; on the last attempt the valid findings are kept and the rest
 * dropped, so one bad quote never fails the pass.
 *
 * What passes is stored as **reopen cards** (`gr_consistency_findings`),
 * replacing the session's earlier cards whole, and the spec is stamped with
 * the breakdown it judged, so "checked and clean" differs from "never
 * checked". A card the owner dismissed stays dismissed when the same finding
 * comes back.
 *
 * Both entry points live here, as in `supersession.ts`: the pass that follows
 * every accepted breakdown, which never throws, and the turn of its own the
 * `check-consistency` action runs.
 */
import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import { getInterviewer, isInterviewerError } from "./interviewer/index.js";
import type {
  CheckConsistencyResult,
  ConsistencyFinding,
  ConsistencyPlace,
  ConsistencyTicket,
} from "./interviewer/index.js";
import { numberRanges, ticketsAreCurrent } from "./tickets.js";
import { deriveTreeStates, treeFacts } from "./tree.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  MAX_TURN_RETRIES,
  portKey,
  projectContextFor,
  runTurn,
  TurnRejected,
} from "./turn.js";
import {
  startTurnRecorder,
  TURN_SUCCEEDED,
  type TurnRecorder,
} from "./turn-recorder.js";

/** A session, as a consistency check needs it. */
type ConsistencySession = typeof schema.sessions.$inferSelect;

/** The failure of a consistency pass after a breakdown, stored once the breakdown's turn has finished. */
export interface ConsistencyFailure {
  code: string;
  message: string;
}

/** What the check judges a result against: the request as it was sent, never the rendered prompt. */
export interface ConsistencyFacts {
  specMarkdown: string;
  tickets: readonly {
    number: number;
    title: string;
    body: string;
    waitsFor: string | null;
  }[];
  /** The keys of every decision derived settled. */
  settledKeys: readonly string[];
}

/** Runs of whitespace collapse to one space, and the ends are trimmed. Case and punctuation stay. */
export function normaliseQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const SPEC_SECTION_HEADING = /^##[ \t]+(.+?)[ \t]*$/;
const SPEC_SECTION_END = /^#{1,2}[ \t]/;

/**
 * The spec's level-2 sections, in document order: each heading's text as
 * written after `## `, and the lines after it up to the next level-1 or
 * level-2 heading. A `###` heading stays inside its section.
 */
export function specSections(markdown: string): { name: string; text: string }[] {
  const lines = markdown.split(/\r?\n/);
  const sections: { name: string; text: string }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  const close = () => {
    if (current) sections.push({ name: current.name, text: current.lines.join("\n") });
    current = null;
  };
  for (const line of lines) {
    if (SPEC_SECTION_END.test(line)) {
      close();
      const heading = SPEC_SECTION_HEADING.exec(line);
      if (heading) current = { name: heading[1]!, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return sections;
}

/** The spec's section names, each once, in document order. */
function sectionNames(markdown: string): string[] {
  return [...new Set(specSections(markdown).map((section) => section.name))];
}

/** The text of the spec section of that name; the first, when the name repeats. */
function sectionText(markdown: string, name: string): string | undefined {
  return specSections(markdown).find((section) => section.name === name)?.text;
}

/** Why one place of a finding cannot be stored, with `subject` naming it. */
function placeReasons(
  place: ConsistencyPlace,
  subject: string,
  facts: ConsistencyFacts,
): string[] {
  const quote = normaliseQuote(place.quote);
  const missingQuote = (where: string) =>
    `${subject} quotes "${place.quote}", which is not in ${where}. Copy the words exactly as they are written there.`;

  if (place.artefact === "spec") {
    if (place.section === null || place.ticket !== null) {
      return [`${subject}: text in the spec needs \`section\` set and \`ticket\` null.`];
    }
    const text = sectionText(facts.specMarkdown, place.section);
    const reasons: string[] = [];
    if (text === undefined) {
      reasons.push(
        `${subject} names the spec section "${place.section}", which the spec does not have. Its sections are: ${sectionNames(facts.specMarkdown).join(", ")}.`,
      );
    }
    if (quote === "") {
      reasons.push(`${subject} has an empty quote.`);
    } else if (text !== undefined && !normaliseQuote(text).includes(quote)) {
      reasons.push(missingQuote(`the spec's "${place.section}" section`));
    }
    return reasons;
  }

  if (place.ticket === null || place.section !== null) {
    return [`${subject}: text in a ticket needs \`ticket\` set and \`section\` null.`];
  }
  const ticket = facts.tickets.find((candidate) => candidate.number === place.ticket);
  const reasons: string[] = [];
  if (!ticket) {
    reasons.push(
      `${subject} names ticket ${place.ticket}, which is not in the breakdown. The tickets are ${numberRanges(facts.tickets.map((candidate) => candidate.number))}.`,
    );
  }
  if (quote === "") {
    reasons.push(`${subject} has an empty quote.`);
  } else if (ticket) {
    const text = [ticket.title, ticket.body, ticket.waitsFor ?? ""].join("\n");
    if (!normaliseQuote(text).includes(quote)) {
      reasons.push(missingQuote(`ticket ${ticket.number}`));
    }
  }
  return reasons;
}

/** Two findings of the same kind quoting the same words at the same place. */
function sameFinding(a: ConsistencyFinding, b: ConsistencyFinding): boolean {
  return (
    a.kind === b.kind &&
    a.at.artefact === b.at.artefact &&
    a.at.section === b.at.section &&
    a.at.ticket === b.at.ticket &&
    normaliseQuote(a.at.quote) === normaliseQuote(b.at.quote)
  );
}

/**
 * Why each finding cannot be stored, written for the model: one list per
 * finding, in result order, empty for a finding that can be stored. Findings
 * are numbered from 1.
 */
export function consistencyReasons(
  result: CheckConsistencyResult,
  facts: ConsistencyFacts,
): string[][] {
  return result.findings.map((finding, index) => {
    const n = index + 1;
    const subject = `Finding ${n}`;
    const reasons = placeReasons(finding.at, subject, facts);
    if (finding.against !== null) {
      reasons.push(...placeReasons(finding.against, `${subject}'s \`against\``, facts));
    }

    if (finding.kind === "spec-ticket-contradiction") {
      if (finding.against === null) {
        reasons.push(
          `${subject} is a spec-ticket-contradiction, so \`against\` must give the other side.`,
        );
      } else if (finding.at.artefact === finding.against.artefact) {
        reasons.push(`${subject} must have one side in the spec and the other in a ticket.`);
      }
    } else if (finding.against !== null) {
      reasons.push(`${subject} is of kind ${finding.kind}, so \`against\` must be null.`);
    }

    if (finding.decisionKey !== null && !facts.settledKeys.includes(finding.decisionKey)) {
      reasons.push(
        `${subject} names decision "${finding.decisionKey}", which is not a settled decision of this tree. Give a settled decision's key, or null.`,
      );
    }

    if (!finding.question.trim().endsWith("?")) {
      reasons.push(`${subject}'s question must be one question to the owner, ending with "?".`);
    }

    const earlier = result.findings
      .slice(0, index)
      .findIndex((candidate) => sameFinding(candidate, finding));
    if (earlier !== -1) {
      reasons.push(`${subject} repeats finding ${earlier + 1}. Report each finding once.`);
    }

    return reasons;
  });
}

/**
 * The result with every finding that has a reason dropped, and the line for
 * the attempt log naming each dropped finding and why; null when nothing was
 * dropped.
 */
export function keepValidFindings(
  result: CheckConsistencyResult,
  reasons: readonly string[][],
): { result: CheckConsistencyResult; dropped: string | null } {
  const dropped = result.findings.flatMap((_, index) =>
    reasons[index]!.length === 0
      ? []
      : [`finding ${index + 1} (${reasons[index]!.join(" ")})`],
  );
  return {
    result: {
      findings: result.findings.filter((_, index) => reasons[index]!.length === 0),
    },
    dropped:
      dropped.length === 0
        ? null
        : `Kept the valid findings after the last retry. Dropped ${dropped.join("; ")}.`,
  };
}

/** A stored finding's dismissal match key: its kind and both quotes, normalised. */
function matchKey(finding: {
  kind: string;
  at: { quote: string };
  against: { quote: string } | null;
}): string {
  return JSON.stringify([
    finding.kind,
    normaliseQuote(finding.at.quote),
    normaliseQuote(finding.against?.quote ?? ""),
  ]);
}

/** Every ticket of the session, in number order, as the check reads it. */
async function consistencyTickets(sessionId: string): Promise<ConsistencyTicket[]> {
  const rows = await getDb()
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.sessionId, sessionId))
    .orderBy(schema.tickets.number);
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    body: row.body,
    kind: row.kind,
    waitsFor: row.waitsFor,
  }));
}

/**
 * Ask, check, and store the cards. No turn bookkeeping of its own: both
 * callers below wrap it. Nothing is written until a result is accepted, and
 * the session's conversation is never touched: every attempt starts fresh.
 */
async function scan(
  session: ConsistencySession,
  recorder: TurnRecorder | null,
): Promise<void> {
  const db = getDb();

  const [spec] = await db
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, session.id))
    .limit(1);
  if (!spec) throw new Error(`Session ${session.id} has no spec to check.`);

  const tickets = await consistencyTickets(session.id);
  const rows = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, session.id))
    .orderBy(schema.decisions.createdAt, schema.decisions.id);
  const states = deriveTreeStates(treeFacts(rows));

  const facts: ConsistencyFacts = {
    specMarkdown: spec.markdown,
    tickets: tickets.map(({ number, title, body, waitsFor }) => ({
      number,
      title,
      body,
      waitsFor,
    })),
    settledKeys: rows.filter((row) => states.get(row.id) === "settled").map(portKey),
  };

  const interviewer = getInterviewer();
  let attemptsAsked = 0;
  let previousResult: CheckConsistencyResult | null = null;

  const accepted = await askUntilAccepted<CheckConsistencyResult>({
    conversationId: null,
    recorder,
    ask: async ({ rejectionReason, observer }) => {
      attemptsAsked += 1;
      const turn = await interviewer.checkConsistency(
        {
          kind: "check-consistency",
          context: {
            sessionId: session.id,
            idea: session.idea,
            title: session.title,
            model: session.model,
            answeringMode: session.answeringMode,
            docsFolder: null,
            conversationId: null,
            decisions: await decisionSnapshots(rows),
            projectContext: await projectContextFor(session),
          },
          specMarkdown: spec.markdown,
          tickets,
          rejectionReason,
          previousResult: rejectionReason === null ? null : previousResult,
        },
        observer,
      );
      previousResult = turn.result;
      return turn;
    },
    // On the last attempt nothing refuses the result: the valid findings are
    // kept and the invalid ones dropped below.
    reasonsToRefuse: (result) =>
      attemptsAsked > MAX_TURN_RETRIES ? [] : consistencyReasons(result, facts).flat(),
    exhausted: (lastReason) =>
      new TurnRejected(
        "invalid-consistency",
        `The interviewer returned consistency findings the spec and tickets do not support ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
      ),
  });

  const kept = keepValidFindings(accepted.result, consistencyReasons(accepted.result, facts));
  if (kept.dropped) await recorder?.noted(kept.dropped);

  const earlier = await db
    .select()
    .from(schema.consistencyFindings)
    .where(eq(schema.consistencyFindings.sessionId, session.id));
  const dismissed = new Set(
    earlier
      .filter((row) => row.status === "dismissed")
      .map((row) =>
        matchKey({
          kind: row.kind,
          at: JSON.parse(row.atJson) as ConsistencyPlace,
          against: row.againstJson ? (JSON.parse(row.againstJson) as ConsistencyPlace) : null,
        }),
      ),
  );

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.consistencyFindings)
      .where(eq(schema.consistencyFindings.sessionId, session.id));
    if (kept.result.findings.length > 0) {
      await tx.insert(schema.consistencyFindings).values(
        kept.result.findings.map((finding, index) => ({
          id: randomUUID(),
          sessionId: session.id,
          number: index + 1,
          kind: finding.kind,
          atJson: JSON.stringify(finding.at),
          againstJson: finding.against ? JSON.stringify(finding.against) : null,
          question: finding.question,
          decisionKey: finding.decisionKey,
          status: dismissed.has(matchKey(finding)) ? ("dismissed" as const) : ("open" as const),
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    await tx
      .update(schema.specs)
      .set({
        consistencyCheckedFor: spec.ticketsGeneratedAt,
        consistencyTurnId: recorder?.turnId ?? null,
      })
      .where(eq(schema.specs.sessionId, session.id));
  });
}

/**
 * The message a skipped check leaves on the session, or the refusal of an
 * on-demand check, when the breakdown has more tickets than one check covers.
 */
export function tooManyTicketsMessage(count: number, cap: number, skipped: boolean): string {
  return skipped
    ? `The breakdown has ${count} tickets; one consistency check covers at most ${cap}, so the check was skipped.`
    : `The breakdown has ${count} tickets; one consistency check covers at most ${cap}.`;
}

/**
 * The second half of an accepted breakdown, run inside its turn once the
 * tickets and `ticketsGeneratedAt` are written.
 *
 * It never throws. The breakdown is the expensive half and is already stored;
 * the check is a convenience on top of it. The failure is handed back instead,
 * for the caller to record once `runTurn` has written the breakdown's own
 * result, which would otherwise clear it. It has its own `check-consistency`
 * turn record, closed here.
 */
export async function checkConsistencyForBreakdown(input: {
  session: ConsistencySession;
}): Promise<{ failure: ConsistencyFailure | null }> {
  let recorder: TurnRecorder | null = null;
  try {
    recorder = await startTurnRecorder({
      sessionId: input.session.id,
      turnKind: "check-consistency",
      model: input.session.model,
    });
    await scan(input.session, recorder);
    await recorder.finish(TURN_SUCCEEDED);
    return { failure: null };
  } catch (error) {
    const failure: ConsistencyFailure =
      isInterviewerError(error) || error instanceof TurnRejected
        ? { code: error.code, message: error.message }
        : {
            code: "failed",
            message:
              "The tickets were stored, but the consistency check that follows them failed.",
          };
    try {
      await recorder?.finish(failure.code);
    } catch {
      // The failure is still reported; a record that cannot be closed must
      // not cost the breakdown.
    }
    return { failure };
  }
}

/**
 * The whole turn, for the explicit action: the session reads as working while
 * the model thinks, and a failure is stored on it the way any other failed
 * turn is. The session's conversation is left as it was.
 */
export async function runConsistencyTurn(sessionId: string): Promise<void> {
  const [session] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) return;

  await runTurn({
    sessionId,
    failedMessage: "The consistency check failed.",
    record: { turnKind: "check-consistency", model: session.model },
    take: async (recorder) => {
      await scan(session, recorder);
      return session.conversationId;
    },
  });
}

/** One reopen card, as the actions return it. */
export interface ReopenCard {
  id: string;
  number: number;
  kind: string;
  at: ConsistencyPlace;
  against: ConsistencyPlace | null;
  question: string;
  decisionKey: string | null;
  status: "open" | "dismissed";
}

/**
 * A session's reopen cards in number order, whether a check has been
 * accepted at all (`checked`), and whether the cards judged today's tickets
 * (`current`): the stamp matches `ticketsGeneratedAt` and the tickets are
 * current with the spec.
 */
export async function listConsistencyFindings(sessionId: string): Promise<{
  findings: ReopenCard[];
  checked: boolean;
  current: boolean;
  turnId: string | null;
}> {
  const db = getDb();
  const [spec] = await db
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, sessionId))
    .limit(1);
  if (!spec) return { findings: [], checked: false, current: false, turnId: null };

  const rows = await db
    .select()
    .from(schema.consistencyFindings)
    .where(eq(schema.consistencyFindings.sessionId, sessionId))
    .orderBy(schema.consistencyFindings.number);

  const checked = spec.consistencyCheckedFor != null;
  return {
    findings: rows.map((row) => ({
      id: row.id,
      number: row.number,
      kind: row.kind,
      at: JSON.parse(row.atJson) as ConsistencyPlace,
      against: row.againstJson ? (JSON.parse(row.againstJson) as ConsistencyPlace) : null,
      question: row.question,
      decisionKey: row.decisionKey,
      status: row.status,
    })),
    checked,
    current:
      checked &&
      spec.consistencyCheckedFor === spec.ticketsGeneratedAt &&
      ticketsAreCurrent(spec),
    turnId: spec.consistencyTurnId,
  };
}
