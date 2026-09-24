import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScoutProjectRequest,
} from "../server/interviewer/index.js";
import { aScoutProjectResult } from "../server/interviewer/test-fixtures.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import getScoutReport from "./get-scout-report.js";
import getSession from "./get-session.js";
import getTurn from "./get-turn.js";
import registerProject from "./register-project.js";
import scoutProject from "./scout-project.js";
import updateSessionIdea from "./update-session-idea.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(root: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Grill Room Tests",
      "-c",
      "user.email=tests@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, stdio: "ignore" },
  );
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

/** A repo holding every file `aScoutProjectResult()` cites, at the lengths it cites. */
function aFixtureRepo(): string {
  return repos.create({
    files: {
      "src/ingest/metrics.ts": lines(30),
      "docs/adr/0003-queue.md": lines(9),
      "CLAUDE.md": "# Agent instructions\n",
    },
  });
}

async function aSessionWithProject(
  root = aFixtureRepo(),
  model: "fable" | "opus" | "sonnet" = "opus",
) {
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    exportFolder: ".scratch",
  });
  const session = await createSession.run({
    title: "Ingest lag alerts",
    idea: "Alert the on-call engineer when ingest falls behind.",
    model,
    projectId: project.id,
  });
  return { root, project, session };
}

function scoutRequests(requests: readonly { kind: string }[]): ScoutProjectRequest[] {
  return requests.filter(
    (request): request is ScoutProjectRequest => request.kind === "scout-project",
  );
}

describe("scout-project", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("stores a valid report and reads it back current, with every proposal undecided", async () => {
    const { root, project, session } = await aSessionWithProject();
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);

    const scouted = await scoutProject.run({ sessionId: session.id });

    const [request] = scoutRequests(interviewer.requests);
    expect(request).toMatchObject({
      projectRoot: root,
      previousDecisions: [],
      rejectionReason: null,
      context: { idea: session.idea, title: session.title, model: "sonnet" },
    });
    expect(request!.facts.hasAgentInstructions).toBe(true);

    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report).toEqual(scouted.report);
    expect(read.report).toMatchObject({
      sessionId: session.id,
      projectId: project.id,
      result: aScoutProjectResult(),
      commitRead: request!.facts.headCommit,
      ideaRead: session.idea,
      model: "sonnet",
      dispositions: { "no-message-broker": "undecided" },
      stale: false,
    });
    expect(read.report!.facts).toEqual(request!.facts);
    expect(read.report!.turnId).not.toBeNull();

    // The scout never joins or starts the interview's conversation.
    expect(await getSession.run({ id: session.id })).toMatchObject({
      conversationId: null,
      turnStatus: "idle",
      modelLocked: false,
    });
  });

  it("records the turn on sonnet for a session on another model", async () => {
    const { session } = await aSessionWithProject(undefined, "fable");
    scriptInterviewer([{ kind: "scout-project", result: aScoutProjectResult() }]);

    const scouted = await scoutProject.run({ sessionId: session.id });

    const latest = await findLatestTurn({ sessionId: session.id, turnKind: "scout-project" });
    expect(latest).not.toBeNull();
    const turn = await getTurn.run({ turnId: latest!.id });
    expect(turn).toMatchObject({
      sessionId: session.id,
      turnKind: "scout-project",
      model: "sonnet",
      outcome: "succeeded",
    });
    expect(scouted.report!.turnId).toBe(turn.id);
    expect((await getSession.run({ id: session.id })).model).toBe("fable");
  });

  it("strips credentials from remote URLs before storing them or sending them to the scout", async () => {
    const root = aFixtureRepo();
    git(root, ["remote", "add", "origin", "https://user:secret@example.invalid/x.git"]);
    const { session } = await aSessionWithProject(root);
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);

    await scoutProject.run({ sessionId: session.id });

    const [request] = scoutRequests(interviewer.requests);
    expect(request!.facts.remotes.map((remote) => remote.url)).toEqual([
      "https://example.invalid/x.git",
      "https://example.invalid/x.git",
    ]);
    expect(JSON.stringify(interviewer.requests)).not.toContain("secret");

    const { report } = await getScoutReport.run({ sessionId: session.id });
    expect(report!.facts.remotes.map((remote) => remote.url)).toEqual([
      "https://example.invalid/x.git",
      "https://example.invalid/x.git",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
    const rows = await getDb().select().from(schema.scoutReports);
    expect(JSON.stringify(rows)).not.toContain("secret");
  });

  it("refuses a citation to a missing file and asks again", async () => {
    const { session } = await aSessionWithProject();
    const interviewer = scriptInterviewer([
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          currentState: [
            { status: "gap", summary: "No alerting yet.", citations: ["src/alerts.ts:1"] },
          ],
        }),
      },
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);

    await scoutProject.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.rejectionReason).toMatch(/src\/alerts\.ts, which does not exist/);
    const { report } = await getScoutReport.run({ sessionId: session.id });
    expect(report!.result).toEqual(aScoutProjectResult());
  });

  it("refuses a citation to a line past the file's end and asks again", async () => {
    const { session } = await aSessionWithProject();
    const outOfRange = aScoutProjectResult();
    outOfRange.proposedDecisions[0]!.citation = "docs/adr/0003-queue.md:5-10";
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: outOfRange },
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);

    await scoutProject.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.rejectionReason).toMatch(/cites line 10, but docs\/adr\/0003-queue\.md has 9 lines/);
    expect((await getScoutReport.run({ sessionId: session.id })).report).not.toBeNull();
  });

  it("refuses a reused proposal key and asks again", async () => {
    const { session } = await aSessionWithProject();
    const [decision] = aScoutProjectResult().proposedDecisions;
    const interviewer = scriptInterviewer([
      {
        kind: "scout-project",
        result: aScoutProjectResult({ proposedDecisions: [decision!, decision!] }),
      },
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);

    await scoutProject.run({ sessionId: session.id });

    expect(scoutRequests(interviewer.requests)[1]!.rejectionReason).toMatch(
      /"no-message-broker" is used more than once/,
    );
  });

  it("stops the turn with invalid-scout-report after three refusals, storing nothing", async () => {
    const { session } = await aSessionWithProject();
    const bad = aScoutProjectResult({
      currentState: [{ status: "gap", summary: "Nothing.", citations: ["nowhere.ts:1"] }],
    });
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: bad },
      { kind: "scout-project", result: bad },
      { kind: "scout-project", result: bad },
    ]);

    await expect(scoutProject.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "invalid-scout-report",
    });

    expect(scoutRequests(interviewer.requests)).toHaveLength(3);
    expect(await getSession.run({ id: session.id })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-scout-report",
    });
    expect((await getScoutReport.run({ sessionId: session.id })).report).toBeNull();

    const latest = await findLatestTurn({ sessionId: session.id, turnKind: "scout-project" });
    const turn = await getTurn.run({ turnId: latest!.id });
    expect(turn.outcome).toBe("invalid-scout-report");
    expect(turn.runs[0]!.attempts).toHaveLength(3);
  });

  it("goes stale after a new commit in the project", async () => {
    const { root, session } = await aSessionWithProject();
    scriptInterviewer([{ kind: "scout-project", result: aScoutProjectResult() }]);
    await scoutProject.run({ sessionId: session.id });

    // Uncommitted changes do not move HEAD.
    writeFileSync(path.join(root, "notes.md"), "draft\n");
    expect((await getScoutReport.run({ sessionId: session.id })).report!.stale).toBe(false);

    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "Add notes"]);

    expect((await getScoutReport.run({ sessionId: session.id })).report!.stale).toBe(true);
  });

  it("goes stale after the idea is edited", async () => {
    const { session } = await aSessionWithProject();
    scriptInterviewer([{ kind: "scout-project", result: aScoutProjectResult() }]);
    await scoutProject.run({ sessionId: session.id });

    await updateSessionIdea.run({
      sessionId: session.id,
      idea: "Page the on-call engineer when ingest lag passes five minutes.",
    });

    expect((await getScoutReport.run({ sessionId: session.id })).report!.stale).toBe(true);
  });

  it("goes stale once the project root is no longer a git repository", async () => {
    const { root, session } = await aSessionWithProject();
    scriptInterviewer([{ kind: "scout-project", result: aScoutProjectResult() }]);
    await scoutProject.run({ sessionId: session.id });

    rmSync(path.join(root, ".git"), { recursive: true, force: true });

    expect((await getScoutReport.run({ sessionId: session.id })).report!.stale).toBe(true);
  });

  it("tells a re-run the previous decisions and refuses one that leaves any out", async () => {
    const { session } = await aSessionWithProject();
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
      { kind: "scout-project", result: aScoutProjectResult() },
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          previousDecisions: [{ key: "no-message-broker", change: "unchanged", statement: null }],
        }),
      },
    ]);

    const first = await scoutProject.run({ sessionId: session.id });
    const second = await scoutProject.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(3);
    expect(requests[1]!.previousDecisions).toEqual([
      {
        key: "no-message-broker",
        title: "No message broker",
        statement: "Ingest runs on a Postgres-backed queue, not a message broker.",
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        disposition: "proposed",
      },
    ]);
    expect(requests[2]!.rejectionReason).toMatch(/previousDecisions is missing "no-message-broker"/);

    // The re-run replaces the report.
    expect(second.report!.id).not.toBe(first.report!.id);
    expect((await getScoutReport.run({ sessionId: session.id })).report!.id).toBe(
      second.report!.id,
    );
    expect(await getDb().select().from(schema.scoutReports)).toHaveLength(1);
  });

  describe("refusals, before any turn", () => {
    it("refuses a session with no project", async () => {
      const session = await createSession.run({
        title: "Ingest lag alerts",
        idea: "Alert the on-call engineer when ingest falls behind.",
        model: "opus",
      });
      const interviewer = scriptInterviewer([]);

      await expect(scoutProject.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "no-project",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses a project that is no longer a git repository", async () => {
      const { root, session } = await aSessionWithProject();
      rmSync(path.join(root, ".git"), { recursive: true, force: true });
      const interviewer = scriptInterviewer([]);

      await expect(scoutProject.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "not-a-repo",
      });
      expect(interviewer.requests).toHaveLength(0);
      expect(await findLatestTurn({ sessionId: session.id, turnKind: "scout-project" })).toBeNull();
    });

    it("refuses a session that is not interviewing", async () => {
      const { session } = await aSessionWithProject();
      await getDb()
        .update(schema.sessions)
        .set({ state: "confirmed" })
        .where(eq(schema.sessions.id, session.id));
      const interviewer = scriptInterviewer([]);

      await expect(scoutProject.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "wrong-session-state",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses while a turn is working", async () => {
      const { session } = await aSessionWithProject();
      await getDb()
        .update(schema.sessions)
        .set({ turnStatus: "working" })
        .where(eq(schema.sessions.id, session.id));
      const interviewer = scriptInterviewer([]);

      await expect(scoutProject.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "turn-working",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses an unknown session", async () => {
      await expect(scoutProject.run({ sessionId: "missing" })).rejects.toThrow(
        "Session not found: missing",
      );
    });
  });
});

describe("get-scout-report", () => {
  useTestDatabase();

  it("returns null for a session never scouted", async () => {
    const { session } = await aSessionWithProject();
    expect(await getScoutReport.run({ sessionId: session.id })).toEqual({
      sessionId: session.id,
      report: null,
    });
  });
});
