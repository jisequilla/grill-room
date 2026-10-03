import { afterEach, describe, expect, it } from "vitest";

import {
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
});
