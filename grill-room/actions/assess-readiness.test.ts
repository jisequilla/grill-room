import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import type { Depth } from "../shared/session-constants.js";
import { getDb, schema } from "../server/db/index.js";
import { parseStoredReadiness } from "../server/readiness.js";
import {
  rateLimitedTurn,
  resetInterviewer,
  scriptInterviewer,
  type AssessReadinessRequest,
} from "../server/interviewer/index.js";
import {
  anAssessReadinessResult,
  aScoutProjectResult,
  ideaEvidence,
  repoEvidence,
} from "../server/interviewer/test-fixtures.js";
import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import assessReadiness from "./assess-readiness.js";
import createSession from "./create-session.js";
import registerProject from "./register-project.js";

const repos = useTempGitRepos();

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

function readinessRequests(
  requests: readonly { kind: string }[],
): AssessReadinessRequest[] {
  return requests.filter(
    (request): request is AssessReadinessRequest =>
      request.kind === "assess-readiness",
  );
}

describe("assess-readiness", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("hands a retry the reason and the previous answer, then stores the accepted result", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A local app that helps a runner follow a 16-week marathon plan.",
      model: "opus",
    });
    // A `ready` verdict with no evidence breaks the app's own rule, so the
    // first attempt is refused and retried; the second passes.
    const refused = anAssessReadinessResult({ verdict: "ready", evidence: [] });
    const accepted = anAssessReadinessResult();
    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: refused },
      { kind: "assess-readiness", result: accepted },
    ]);

    const judged = await assessReadiness.run({ sessionId: session.id });

    const requests = readinessRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ rejectionReason: null, previousResult: null });
    expect(requests[1]!.rejectionReason).toMatch(/at least one evidence item/);
    expect(requests[1]!.previousResult).toEqual(refused);

    expect(judged.readiness!.result).toEqual(accepted);
  });

  it("a retry shows the clamped citation, not the raw one", async () => {
    const root = repos.create({
      files: {
        "src/ingest/metrics.ts": lines(30),
        "docs/adr/0003-queue.md": lines(9),
      },
    });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Ingest lag alerts",
      idea: "Alert the on-call engineer when ingest falls behind.",
      model: "opus",
      projectId: project.id,
    });
    const refused = anAssessReadinessResult({
      evidence: [
        repoEvidence("The queue is Postgres-backed", "docs/adr/0003-queue.md:5-10"),
        repoEvidence("Alerting lives elsewhere", "src/missing.ts:1"),
      ],
    });
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
      { kind: "assess-readiness", result: refused },
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);

    await assessReadiness.run({ sessionId: session.id });

    const requests = readinessRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.rejectionReason).toMatch(/src\/missing\.ts/);
    const shown = requests[1]!.previousResult!;
    expect(shown.evidence[0]!.citation).toBe("docs/adr/0003-queue.md:5-9");
    expect(shown.evidence[1]!.citation).toBe("src/missing.ts:1");
  });

  it("stores a repo item's citation clamped to its file's end", async () => {
    const root = repos.create({
      files: {
        "src/ingest/metrics.ts": lines(30),
        "docs/adr/0003-queue.md": lines(9),
      },
    });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Ingest lag alerts",
      idea: "Alert the on-call engineer when ingest falls behind.",
      model: "opus",
      projectId: project.id,
    });
    const raw = anAssessReadinessResult({
      evidence: [
        ideaEvidence("Alert the on-call engineer"),
        repoEvidence("The queue is Postgres-backed", "docs/adr/0003-queue.md:5-10"),
      ],
    });
    // With a project and no report the action runs the scout first.
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
      { kind: "assess-readiness", result: raw },
    ]);

    const judged = await assessReadiness.run({ sessionId: session.id });

    expect(readinessRequests(interviewer.requests)).toHaveLength(1);
    expect(judged.readiness!.result.evidence[1]!.citation).toBe("docs/adr/0003-queue.md:5-9");
    expect(raw.evidence[1]!.citation).toBe("docs/adr/0003-queue.md:5-10");
  });

  describe("the session's depth", () => {
    async function sessionAt(depth: Depth, pendingDepth: Depth | null = null) {
      const session = await createSession.run({
        title: "Marathon tracker",
        idea: "A local app that helps a runner follow a 16-week marathon plan.",
        model: "opus",
      });
      await getDb()
        .update(schema.sessions)
        .set({ depth, pendingDepth })
        .where(eq(schema.sessions.id, session.id));
      return session;
    }

    async function storedDepth(sessionId: string) {
      const [row] = await getDb()
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);
      return parseStoredReadiness(row!)?.depth;
    }

    const readyWithNoEvidence = () =>
      anAssessReadinessResult({ verdict: "ready", evidence: [] });

    it("A1: a proof of concept reaches the request, the check and the store", async () => {
      const session = await sessionAt("proof-of-concept");
      const interviewer = scriptInterviewer([
        { kind: "assess-readiness", result: readyWithNoEvidence() },
      ]);

      const judged = await assessReadiness.run({ sessionId: session.id });

      const requests = readinessRequests(interviewer.requests);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.context.depth).toBe("proof-of-concept");
      expect(await storedDepth(session.id)).toBe("proof-of-concept");
      expect(judged.readiness!.result.verdict).toBe("ready");
    });

    it("A2: a full spec refuses a ready verdict with no evidence and stores its depth", async () => {
      const session = await sessionAt("full-spec");
      const interviewer = scriptInterviewer([
        { kind: "assess-readiness", result: readyWithNoEvidence() },
        { kind: "assess-readiness", result: anAssessReadinessResult() },
      ]);

      await assessReadiness.run({ sessionId: session.id });

      const requests = readinessRequests(interviewer.requests);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.rejectionReason).toContain(
        "A ready verdict needs at least one evidence item.",
      );
      expect(await storedDepth(session.id)).toBe("full-spec");
    });
  });

  describe("a queued depth", () => {
    const OVERRIDE = JSON.stringify({
      missing: ["A buildable objective"],
      verdictJudgedAt: "2026-10-31T09:00:00.000Z",
      at: "2026-10-31T10:00:00.000Z",
    });

    async function queued(
      columns: Partial<typeof schema.sessions.$inferInsert> = {},
      projectId?: string,
    ) {
      const session = await createSession.run({
        title: "Marathon tracker",
        idea: "A local app that helps a runner follow a 16-week marathon plan.",
        model: "opus",
        ...(projectId ? { projectId } : {}),
      });
      await getDb()
        .update(schema.sessions)
        .set({
          depth: "first-working-version",
          pendingDepth: "full-spec",
          readinessOverrideJson: OVERRIDE,
          ...columns,
        })
        .where(eq(schema.sessions.id, session.id));
      return session.id;
    }

    async function row(sessionId: string) {
      const [found] = await getDb()
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);
      return found!;
    }

    const judgment = () => ({
      kind: "assess-readiness" as const,
      result: anAssessReadinessResult(),
    });

    it("Q3: applies the queue after the judgment and judges again at it", async () => {
      const id = await queued();
      const interviewer = scriptInterviewer([judgment(), judgment()]);

      const result = await assessReadiness.run({ sessionId: id });

      const requests = readinessRequests(interviewer.requests);
      expect(requests.map((request) => request.context.depth)).toEqual([
        "first-working-version",
        "full-spec",
      ]);
      const after = await row(id);
      expect(after.depth).toBe("full-spec");
      expect(after.pendingDepth).toBeNull();
      expect(after.readinessOverrideJson).toBeNull();
      expect(parseStoredReadiness(after)?.depth).toBe("full-spec");
      expect(result.readiness!.depth).toBe("full-spec");
    });

    it("Q4: with a project, the scout runs once and the queue applies only after the judge", async () => {
      const root = repos.create({
        files: {
          "src/ingest/metrics.ts": lines(30),
          "docs/adr/0003-queue.md": lines(9),
        },
      });
      const project = await registerProject.run({
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
      });
      const id = await queued({}, project.id);
      const interviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
        judgment(),
        judgment(),
      ]);

      await assessReadiness.run({ sessionId: id });

      expect(
        interviewer.requests.filter((request) => request.kind === "scout-project"),
      ).toHaveLength(1);
      const requests = readinessRequests(interviewer.requests);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.context.depth).toBe("full-spec");
      expect(parseStoredReadiness(await row(id))?.depth).toBe("full-spec");
    });

    it("Q5: a first judge that fails leaves the queue as it was", async () => {
      const id = await queued();
      scriptInterviewer([rateLimitedTurn("assess-readiness")]);

      await expect(assessReadiness.run({ sessionId: id })).rejects.toThrow(/rate limited/);

      const after = await row(id);
      expect(after.pendingDepth).toBe("full-spec");
      expect(after.depth).toBe("first-working-version");
      expect(after.readinessOverrideJson).toBe(OVERRIDE);
    });

    it("Q6: a second judge that fails keeps the applied depth", async () => {
      const id = await queued();
      scriptInterviewer([judgment(), rateLimitedTurn("assess-readiness")]);

      await expect(assessReadiness.run({ sessionId: id })).rejects.toThrow(/rate limited/);

      const after = await row(id);
      expect(after.depth).toBe("full-spec");
      expect(after.pendingDepth).toBeNull();
      expect(after.readinessOverrideJson).toBeNull();
      expect(parseStoredReadiness(after)?.depth).toBe("first-working-version");
    });

    it("Q7: a queue equal to the depth is cleared with no second judge", async () => {
      const id = await queued({ pendingDepth: "first-working-version" });
      const interviewer = scriptInterviewer([judgment(), judgment()]);

      await assessReadiness.run({ sessionId: id });

      expect(readinessRequests(interviewer.requests)).toHaveLength(1);
      const after = await row(id);
      expect(after.pendingDepth).toBeNull();
      expect(after.depth).toBe("first-working-version");
    });
  });
});
