import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import { BETTER_AUTH_MIGRATIONS } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cardsAskable, cardsCurrent } from "../server/consistency.js";
import { hashExportContent } from "../server/export.js";
import {
  rateLimitedTurn,
  resetInterviewer,
  scriptInterviewer,
  type AssessReadinessRequest,
} from "../server/interviewer/index.js";
import { anAssessReadinessResult } from "../server/interviewer/test-fixtures.js";
import { parseStoredReadiness, storeReadiness } from "../server/readiness.js";
import { ticketsAreCurrent } from "../server/tickets.js";
import type { Depth } from "../shared/session-constants.js";
import { applyMigrations, getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import requestNextRound from "./request-next-round.js";
import setSessionDepth from "./set-session-depth.js";

useTestDatabase();

let authTablesBuilt = false;
beforeEach(async () => {
  if (!authTablesBuilt) {
    await applyMigrations(BETTER_AUTH_MIGRATIONS, "_better_auth_migrations");
    authTablesBuilt = true;
  }
  await getDb().delete(schema.ownerProfiles);
  await getDb().delete(schema.migrationInheritance);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetInterviewer();
});

const ANA = { id: "u-ana", email: "ana@example.test" };
const BEN = { id: "u-ben", email: "ben@example.test" };

function loginOn(): void {
  vi.stubEnv("AUTH_DISABLED", "");
  vi.stubEnv("AGENT_USER_EMAIL", "");
}

async function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  return await runWithRequestContext({ userEmail: email }, fn);
}

async function insertUsers(): Promise<void> {
  const now = new Date().toISOString();
  for (const user of [ANA, BEN]) {
    await getDbExec().execute({
      sql: 'INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [user.id, user.email, user.id, false, now, now],
    });
  }
}

async function insertSession(ownerId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await getDb().insert(schema.sessions).values({
    id,
    title: `Session ${id.slice(0, 4)}`,
    idea: "An idea",
    ownerId,
    state: "interviewing",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function readinessRequests(
  requests: readonly { kind: string }[],
): AssessReadinessRequest[] {
  return requests.filter(
    (request): request is AssessReadinessRequest =>
      request.kind === "assess-readiness",
  );
}

function requestsOf(requests: readonly { kind: string }[], kind: string) {
  return requests.filter((request) => request.kind === kind);
}

const IDEA = "A local app that helps a runner follow a 16-week marathon plan.";
const OVERRIDE = JSON.stringify({
  missing: ["A buildable objective"],
  verdictJudgedAt: "2026-10-31T09:00:00.000Z",
  at: "2026-10-31T10:00:00.000Z",
});

type SessionColumns = Partial<typeof schema.sessions.$inferInsert>;

async function sessionWith(columns: SessionColumns = {}) {
  const session = await createSession.run({
    title: "Marathon tracker",
    idea: IDEA,
    model: "opus",
  });
  await getDb()
    .update(schema.sessions)
    .set({ depth: "first-working-version", ...columns })
    .where(eq(schema.sessions.id, session.id));
  return session.id;
}

/** A stored not-ready judgment made at `depth`. */
function judgedAt(depth: Depth): string {
  return storeReadiness(
    IDEA,
    anAssessReadinessResult({ verdict: "not-ready", missing: ["An objective"] }),
    "2026-10-31T09:00:00.000Z",
    null,
    depth,
  );
}

async function row(sessionId: string) {
  const [found] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  return found!;
}

async function addSubmittedRound(sessionId: string) {
  const now = new Date().toISOString();
  await getDb().insert(schema.rounds).values({
    id: randomUUID(),
    sessionId,
    submissionState: "submitted",
    createdAt: now,
    submittedAt: now,
  });
}

async function spec(sessionId: string) {
  const [found] = await getDb()
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, sessionId));
  return found!;
}

describe("set-session-depth before the interview starts", () => {
  it("D1: an idle change re-judges at the new depth and clears the override", async () => {
    const id = await sessionWith({
      readinessJson: judgedAt("first-working-version"),
      readinessOverrideJson: OVERRIDE,
    });
    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);

    const result = await setSessionDepth.run({ sessionId: id, depth: "proof-of-concept" });

    const after = await row(id);
    expect(after.depth).toBe("proof-of-concept");
    expect(after.pendingDepth).toBeNull();
    expect(after.readinessOverrideJson).toBeNull();
    const requests = readinessRequests(interviewer.requests);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.context.depth).toBe("proof-of-concept");
    expect(parseStoredReadiness(after)?.depth).toBe("proof-of-concept");
    expect(result.depth).toBe("proof-of-concept");
    expect(result).toHaveProperty("technicalLevel");
  });

  it("D2: a re-judge that fails keeps the new depth and the cleared override", async () => {
    const stored = judgedAt("first-working-version");
    const id = await sessionWith({ readinessJson: stored, readinessOverrideJson: OVERRIDE });
    scriptInterviewer([rateLimitedTurn("assess-readiness")]);

    await expect(
      setSessionDepth.run({ sessionId: id, depth: "proof-of-concept" }),
    ).rejects.toThrow(/rate limited/);

    const after = await row(id);
    expect(after.depth).toBe("proof-of-concept");
    expect(after.readinessOverrideJson).toBeNull();
    expect(after.readinessJson).toBe(stored);
  });

  it("D3: a session never judged changes depth with no model turn", async () => {
    const id = await sessionWith({ readinessJson: null });
    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);

    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    expect((await row(id)).depth).toBe("full-spec");
    expect(readinessRequests(interviewer.requests)).toHaveLength(0);
  });

  it("D4: the same depth runs no re-judge and keeps the override", async () => {
    const stored = judgedAt("first-working-version");
    const id = await sessionWith({ readinessJson: stored, readinessOverrideJson: OVERRIDE });
    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);

    await setSessionDepth.run({ sessionId: id, depth: "first-working-version" });

    const after = await row(id);
    expect(interviewer.requests).toHaveLength(0);
    expect(after.readinessJson).toBe(stored);
    expect(after.readinessOverrideJson).toBe(OVERRIDE);
  });

  it("D5: a pending value a failed turn left is dropped by a new depth", async () => {
    const id = await sessionWith({
      pendingDepth: "full-spec",
      turnStatus: "failed",
      readinessJson: null,
    });

    await setSessionDepth.run({ sessionId: id, depth: "proof-of-concept" });

    const after = await row(id);
    expect(after.depth).toBe("proof-of-concept");
    expect(after.pendingDepth).toBeNull();
  });

  it("D6: the same depth after a failed turn clears only the pending value", async () => {
    const stored = judgedAt("first-working-version");
    const id = await sessionWith({
      pendingDepth: "full-spec",
      turnStatus: "failed",
      readinessJson: stored,
      readinessOverrideJson: OVERRIDE,
    });
    const interviewer = scriptInterviewer([]);

    await setSessionDepth.run({ sessionId: id, depth: "first-working-version" });

    const after = await row(id);
    expect(after.pendingDepth).toBeNull();
    expect(after.readinessOverrideJson).toBe(OVERRIDE);
    expect(after.readinessJson).toBe(stored);
    expect(interviewer.requests).toHaveLength(0);
  });

  it("Q1: while a turn works the latest value is queued and the depth kept", async () => {
    const id = await sessionWith({ turnStatus: "working" });
    const interviewer = scriptInterviewer([]);

    await setSessionDepth.run({ sessionId: id, depth: "proof-of-concept" });
    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    const after = await row(id);
    expect(after.depth).toBe("first-working-version");
    expect(after.pendingDepth).toBe("full-spec");
    expect(interviewer.requests).toHaveLength(0);
  });

  it("Q2: queuing the current depth while a turn works clears the queue", async () => {
    const id = await sessionWith({ turnStatus: "working", pendingDepth: "proof-of-concept" });

    await setSessionDepth.run({ sessionId: id, depth: "first-working-version" });

    const after = await row(id);
    expect(after.pendingDepth).toBeNull();
    expect(after.depth).toBe("first-working-version");
  });
});

describe("set-session-depth after the interview starts", () => {
  it("R1: the stored judgment is kept", async () => {
    const stored = judgedAt("first-working-version");
    const id = await sessionWith({ readinessJson: stored });
    await addSubmittedRound(id);
    const interviewer = scriptInterviewer([]);

    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    const after = await row(id);
    expect(after.depth).toBe("full-spec");
    expect(after.readinessJson).toEqual(stored);
    expect(interviewer.requests).toHaveLength(0);
  });

  it("R2: a done proposal is withdrawn and the next round opens", async () => {
    const id = await sessionWith({ state: "done-proposed", doneSummary: "All settled." });
    await addSubmittedRound(id);

    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    const after = await row(id);
    expect(after.state).toBe("interviewing");
    expect(after.doneSummary).toBeNull();

    scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "shape",
              title: "What shape should this take?",
              body: "The first thing to settle.",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "A workspace",
              dependsOn: [],
              ask: true,
              adrWorthy: false,
              consequences: null,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
    ]);
    const next = await requestNextRound.run({ sessionId: id });
    expect(next.round?.decisions).toHaveLength(1);
  });

  it("R3: a confirmed session returns to interviewing and its spec, tickets and cards go not current, with nothing regenerated", async () => {
    const id = await sessionWith({ state: "confirmed" });
    await addSubmittedRound(id);
    const specAt = "2026-10-31T09:00:00.000Z";
    const ticketsAt = "2026-10-31T10:00:00.000Z";
    const markdown = "## Problem Statement\n\nA settled idea.\n\n## Solution\n\nA workspace.";
    await getDb().insert(schema.specs).values({
      id: randomUUID(),
      sessionId: id,
      markdown,
      current: true,
      ticketsGeneratedAt: ticketsAt,
      consistencyCheckedFor: ticketsAt,
      consistencySpecSha256: hashExportContent(markdown),
      createdAt: specAt,
      updatedAt: specAt,
    });
    expect(cardsCurrent(await spec(id))).toBe(true);
    const interviewer = scriptInterviewer([]);

    await setSessionDepth.run({ sessionId: id, depth: "proof-of-concept" });

    expect((await row(id)).state).toBe("interviewing");
    const after = await spec(id);
    expect(after.current).toBe(false);
    expect(after.markdown).toBe(markdown);
    expect(ticketsAreCurrent(after)).toBe(false);
    expect(cardsCurrent(after)).toBe(false);
    expect(cardsAskable(after)).toBe(true);
    for (const kind of ["synthesize-spec", "break-into-tickets", "check-consistency"]) {
      expect(requestsOf(interviewer.requests, kind)).toHaveLength(0);
    }
  });

  it("R4: an interviewing session's spec is marked not current", async () => {
    const id = await sessionWith();
    await addSubmittedRound(id);
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: randomUUID(),
      sessionId: id,
      markdown: "## Problem Statement\n\nAn idea.",
      current: true,
      createdAt: now,
      updatedAt: now,
    });

    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    expect((await row(id)).state).toBe("interviewing");
    const after = await spec(id);
    expect(after.current).toBe(false);
    expect(after.markdown).toBe("## Problem Statement\n\nAn idea.");
  });

  it("R5: refused while a turn works, writing nothing", async () => {
    const id = await sessionWith({ state: "done-proposed", doneSummary: "All settled.", turnStatus: "working" });
    await addSubmittedRound(id);
    const before = await row(id);

    await expect(
      setSessionDepth.run({ sessionId: id, depth: "full-spec" }),
    ).rejects.toMatchObject({ errorCode: "turn-in-progress", statusCode: 409 });

    expect(await row(id)).toEqual(before);
  });

  it("R6: the same depth keeps a done proposal", async () => {
    const id = await sessionWith({ state: "done-proposed", doneSummary: "All settled." });
    await addSubmittedRound(id);

    await setSessionDepth.run({ sessionId: id, depth: "first-working-version" });

    const after = await row(id);
    expect(after.state).toBe("done-proposed");
    expect(after.doneSummary).toBe("All settled.");
  });

  it("R7: a queue left on a started session is dropped", async () => {
    const id = await sessionWith({ pendingDepth: "proof-of-concept" });
    await addSubmittedRound(id);

    await setSessionDepth.run({ sessionId: id, depth: "full-spec" });

    const after = await row(id);
    expect(after.depth).toBe("full-spec");
    expect(after.pendingDepth).toBeNull();
  });
});

describe("set-session-depth with login on", () => {
  it("O1: another owner's session is not found", async () => {
    loginOn();
    await insertUsers();
    const anaSession = await insertSession(ANA.id);
    const before = await row(anaSession);

    await expect(
      as(BEN.email, async () => setSessionDepth.run({ sessionId: anaSession, depth: "full-spec" })),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await row(anaSession)).toEqual(before);
  });
});
