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
import dropRepoDecision from "./drop-repo-decision.js";
import getCurrentRound from "./get-current-round.js";
import getScoutReport from "./get-scout-report.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import getTurn from "./get-turn.js";
import keepRepoDecision from "./keep-repo-decision.js";
import registerProject from "./register-project.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import scoutProject from "./scout-project.js";
import submitRound from "./submit-round.js";
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

async function treeByKey(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return new Map(tree.decisions.map((decision) => [decision.key, decision]));
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

  it("refuses a proposal that restates a source a tracked decisions.md already supersedes, then accepts the retry", async () => {
    const decisionsMdLines = [
      "# Decisions: Simpler API error responses",
      "",
      "Generated by the Grill Room export from this session's settled design tree.",
      "",
      "## Decisions",
      "",
      '<a id="rfc7807-problem-details-for-all-errors"></a>',
      "### RFC 7807 Problem Details for all error responses",
      "",
      "- **Decision:** The workout complete and uncomplete endpoints return errors as a flat JSON body.",
      "- **Origin:** repo (recorded) · reopened",
      "- **Source:** docs/adr/003-rfc7807-problem-details.md:19",
      '- **Supersedes:** "We will use RFC 7807 Problem Details for all error responses."',
    ];
    const root = repos.create({
      files: {
        "CLAUDE.md": "# Agent instructions\n",
        "docs/adr/003-rfc7807-problem-details.md":
          Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        ".scratch/simpler-api-error-responses/decisions.md": decisionsMdLines.join("\n") + "\n",
      },
    });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Flat errors for the plan endpoints",
      idea: "Bring the plan endpoints onto the same flat error format too.",
      model: "opus",
      projectId: project.id,
    });

    const staleProposal = aScoutProjectResult({
      currentState: [
        {
          status: "gap",
          summary: "The plan endpoints still return RFC 7807 responses.",
          citations: ["docs/adr/003-rfc7807-problem-details.md:1"],
        },
      ],
      proposedDecisions: [
        {
          key: "adr003-rfc7807-default",
          title: "RFC 7807 Problem Details for all error responses",
          statement:
            "We will use RFC 7807 Problem Details for all error responses, extended with HATEOAS links for recovery navigation.",
          source: "recorded",
          citation: "docs/adr/003-rfc7807-problem-details.md:19",
          reason: "Extending flat errors elsewhere needs its own scoped override.",
        },
      ],
    });
    const retryProposal = aScoutProjectResult({
      currentState: staleProposal.currentState,
      proposedDecisions: [
        {
          key: "rfc7807-scoped-override",
          title: "The scoped RFC 7807 override",
          statement:
            "The workout complete and uncomplete endpoints return errors as a flat JSON body; every other endpoint keeps RFC 7807 until migrated.",
          source: "recorded",
          citation: ".scratch/simpler-api-error-responses/decisions.md:7-13",
          reason: "This is the entry that already carries the scoped override.",
        },
      ],
    });
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: staleProposal },
      { kind: "scout-project", result: retryProposal },
    ]);

    await scoutProject.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.facts.decisionFiles).toEqual([
      ".scratch/simpler-api-error-responses/decisions.md",
    ]);
    expect(requests[1]!.rejectionReason).toMatch(/rfc7807-problem-details-for-all-errors/);
    expect(requests[1]!.rejectionReason).toMatch(
      /\.scratch\/simpler-api-error-responses\/decisions\.md/,
    );

    const { report } = await getScoutReport.run({ sessionId: session.id });
    expect(report!.result).toEqual(retryProposal);
  });

  it("accepts a proposal citing a different line of the source file a decisions.md entry supersedes", async () => {
    const decisionsMdLines = [
      "# Decisions: Simpler API error responses",
      "",
      "Generated by the Grill Room export from this session's settled design tree.",
      "",
      "## Decisions",
      "",
      '<a id="rfc7807-problem-details-for-all-errors"></a>',
      "### RFC 7807 Problem Details for all error responses",
      "",
      "- **Decision:** The workout complete and uncomplete endpoints return errors as a flat JSON body.",
      "- **Origin:** repo (recorded) · reopened",
      "- **Source:** docs/adr/003-rfc7807-problem-details.md:19",
      '- **Supersedes:** "We will use RFC 7807 Problem Details for all error responses."',
    ];
    const root = repos.create({
      files: {
        "docs/adr/003-rfc7807-problem-details.md":
          Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        ".scratch/simpler-api-error-responses/decisions.md": decisionsMdLines.join("\n") + "\n",
      },
    });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Something else entirely",
      idea: "Cites a different clause of the same ADR, untouched by the override.",
      model: "opus",
      projectId: project.id,
    });

    const result = aScoutProjectResult({
      currentState: [
        {
          status: "gap",
          summary: "Still on the old format elsewhere.",
          citations: ["docs/adr/003-rfc7807-problem-details.md:1"],
        },
      ],
      proposedDecisions: [
        {
          key: "adr003-other-clause",
          title: "A different ADR-003 clause",
          statement: "Line 5 of the ADR, untouched by the scoped override.",
          source: "recorded",
          citation: "docs/adr/003-rfc7807-problem-details.md:5",
          reason: "Unrelated to the superseded clause.",
        },
      ],
    });
    const interviewer = scriptInterviewer([{ kind: "scout-project", result }]);

    await scoutProject.run({ sessionId: session.id });

    expect(scoutRequests(interviewer.requests)).toHaveLength(1);
    const { report } = await getScoutReport.run({ sessionId: session.id });
    expect(report!.result).toEqual(result);
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

  it("still sends a decision kept two re-runs ago, even though the latest report never proposed it again", async () => {
    const { session } = await aSessionWithProject();
    const unchanged = {
      kind: "scout-project" as const,
      result: aScoutProjectResult({
        proposedDecisions: [],
        previousDecisions: [
          { key: "no-message-broker", change: "unchanged" as const, statement: null },
        ],
      }),
    };
    const interviewer = scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
      unchanged,
      unchanged,
    ]);

    await scoutProject.run({ sessionId: session.id });
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });
    await scoutProject.run({ sessionId: session.id }); // first re-run: report row #1 replaced
    await scoutProject.run({ sessionId: session.id }); // second re-run: report row #2 replaced

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(3);
    const kept = {
      key: "no-message-broker",
      title: "No message broker",
      statement: "Ingest runs on a Postgres-backed queue, not a message broker.",
      source: "recorded",
      citation: "docs/adr/0003-queue.md:5-9",
      disposition: "kept",
    };
    // Kept two re-runs ago, and the report row of that first run is long gone
    // (a re-run replaces it) — it is still sent because it lives in the tree.
    expect(requests[1]!.previousDecisions).toEqual([kept]);
    expect(requests[2]!.previousDecisions).toEqual([kept]);
    expect(await getDb().select().from(schema.scoutReports)).toHaveLength(1);
  });

  it("carries a proposal's disposition forward across a re-run that reports it unchanged", async () => {
    const { session } = await aSessionWithProject();
    scriptInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          previousDecisions: [
            { key: "no-message-broker", change: "unchanged", statement: null },
          ],
        }),
      },
    ]);

    await scoutProject.run({ sessionId: session.id });
    await dropRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });

    await scoutProject.run({ sessionId: session.id });

    // Reported unchanged and re-proposed under the same key: the drop is not
    // forgotten just because the report row was replaced.
    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report!.dispositions).toEqual({ "no-message-broker": "dropped" });
    expect(read.report!.result.proposedDecisions.map((d) => d.key)).toEqual([
      "no-message-broker",
    ]);
  });

  it("carries a dropped or undecided proposal into the new report when the scout reports it unchanged but does not repropose it", async () => {
    const { session } = await aSessionWithProject();
    const BROKER_STATEMENT =
      "Ingest runs on a Postgres-backed queue, not a message broker.";
    const POSTGRES_STATEMENT = "Every service stores its state in Postgres.";
    scriptInterviewer([
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          proposedDecisions: [
            {
              key: "no-message-broker",
              title: "No message broker",
              statement: BROKER_STATEMENT,
              source: "recorded",
              citation: "docs/adr/0003-queue.md:5-9",
              reason: "An alert on ingest lag reads the queue this decision chose.",
            },
            {
              key: "postgres-only",
              title: "Postgres only",
              statement: POSTGRES_STATEMENT,
              source: "inferred",
              citation: "src/ingest/metrics.ts:1-2",
              reason: "Alert state would live beside the queue.",
            },
          ],
        }),
      },
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          // Neither proposal is resent — the scout only reports them
          // unchanged in `previousDecisions` this time.
          proposedDecisions: [],
          previousDecisions: [
            { key: "no-message-broker", change: "unchanged", statement: null },
            { key: "postgres-only", change: "unchanged", statement: null },
          ],
        }),
      },
    ]);

    await scoutProject.run({ sessionId: session.id });
    await dropRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });
    // "postgres-only" is left undecided.

    await scoutProject.run({ sessionId: session.id });

    // Neither proposal reached the port again, but the app carries both
    // forward from the previous report row rather than losing them.
    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report!.dispositions).toEqual({
      "no-message-broker": "dropped",
      "postgres-only": "undecided",
    });
    const byKey = new Map(
      read.report!.result.proposedDecisions.map((d) => [d.key, d]),
    );
    expect(byKey.get("no-message-broker")).toMatchObject({
      title: "No message broker",
      statement: BROKER_STATEMENT,
      source: "recorded",
      citation: "docs/adr/0003-queue.md:5-9",
    });
    expect(byKey.get("postgres-only")).toMatchObject({
      title: "Postgres only",
      statement: POSTGRES_STATEMENT,
      source: "inferred",
      citation: "src/ingest/metrics.ts:1-2",
    });
  });

  it("reopens a kept decision the re-run reports changed or removed, leaves one unchanged, and a new proposal awaits keep or drop — even after rounds exist", async () => {
    const BROKER_STATEMENT =
      "Ingest runs on a Postgres-backed queue, not a message broker.";
    const POSTGRES_STATEMENT = "Every service stores its state in Postgres.";
    const NEW_BROKER_STATEMENT =
      "Ingest now runs through a managed message broker.";

    const root = aFixtureRepo();
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Ingest lag alerts",
      idea: "Alert the on-call engineer when ingest falls behind.",
      model: "opus",
      projectId: project.id,
    });

    scriptInterviewer([
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          proposedDecisions: [
            {
              key: "no-message-broker",
              title: "No message broker",
              statement: BROKER_STATEMENT,
              source: "recorded",
              citation: "docs/adr/0003-queue.md:5-9",
              reason: "An alert on ingest lag reads the queue this decision chose.",
            },
            {
              key: "postgres-only",
              title: "Postgres only",
              statement: POSTGRES_STATEMENT,
              source: "inferred",
              citation: "src/ingest/metrics.ts:1-2",
              reason: "Alert state would live beside the queue.",
            },
            {
              key: "docs-in-claude-md",
              title: "Agent instructions live in CLAUDE.md",
              statement: "Agent instructions for this repo are kept in CLAUDE.md.",
              source: "recorded",
              citation: "CLAUDE.md:1",
              reason: "The scout itself reads that file for conventions.",
            },
          ],
        }),
      },
    ]);
    await scoutProject.run({ sessionId: session.id });

    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });
    await keepRepoDecision.run({ sessionId: session.id, key: "postgres-only" });
    await keepRepoDecision.run({ sessionId: session.id, key: "docs-in-claude-md" });

    // Rounds exist before the re-run: an interviewer-proposed decision depends
    // on two of the kept decisions and is settled.
    scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "alerting",
              title: "How is the on-call engineer alerted?",
              body: "",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "Page them",
              dependsOn: ["no-message-broker", "postgres-only"],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
    ]);
    await requestNextRound.run({ sessionId: session.id });
    const open = await getCurrentRound.run({ sessionId: session.id });
    await saveDraftAnswer.run({
      decisionId: open.round!.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "Page the on-call engineer",
    });
    await submitRound.run({ id: open.round!.id });

    // The re-run: one kept decision changed, one removed, one unchanged, and
    // one brand-new proposal.
    scriptInterviewer([
      {
        kind: "scout-project",
        result: aScoutProjectResult({
          proposedDecisions: [
            {
              key: "runbook",
              title: "Add a runbook",
              statement: "The project has no documented runbook yet.",
              source: "inferred",
              citation: "CLAUDE.md:1",
              reason: "An alert needs somewhere to point the on-call engineer.",
            },
          ],
          previousDecisions: [
            {
              key: "no-message-broker",
              change: "changed",
              statement: NEW_BROKER_STATEMENT,
            },
            { key: "postgres-only", change: "removed", statement: null },
            { key: "docs-in-claude-md", change: "unchanged", statement: null },
          ],
        }),
      },
    ]);
    await scoutProject.run({ sessionId: session.id });

    const tree = await treeByKey(session.id);
    expect(tree.get("no-message-broker")).toMatchObject({
      state: "frontier",
      introducedBy: "repo",
      answer: null,
      recommendedAnswer: NEW_BROKER_STATEMENT,
      repo: { statement: BROKER_STATEMENT },
    });
    expect(tree.get("postgres-only")).toMatchObject({
      state: "frontier",
      introducedBy: "repo",
      answer: null,
      recommendedAnswer: POSTGRES_STATEMENT,
      repo: { statement: POSTGRES_STATEMENT },
    });
    expect(tree.get("docs-in-claude-md")).toMatchObject({
      state: "settled",
      introducedBy: "repo",
      answer: { kind: "repo-established" },
    });
    // Its dependent, settled before the re-run, goes stale.
    expect(tree.get("alerting")!.state).toBe("stale");

    // The new proposal awaits keep or drop and is not yet in the tree.
    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report!.dispositions).toEqual({ runbook: "undecided" });
    expect(tree.get("runbook")).toBeUndefined();

    // The re-run itself worked, with rounds already in the session.
    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "interviewing",
      turnStatus: "idle",
    });
  });

  describe("excludes the session's own export folder from decisionFiles", () => {
    it("does not see its own decisions.md; another session on the same project does", async () => {
      const root = repos.create({
        files: {
          "src/ingest/metrics.ts": lines(30),
          "docs/adr/0003-queue.md": lines(9),
          "CLAUDE.md": "# Agent instructions\n",
          ".scratch/ingest-lag-alerts/decisions.md": "# Decisions\n",
          "docs/decisions.md": "# Project decisions\n",
        },
      });
      const project = await registerProject.run({
        root,
        verifyCommand: "pnpm test",
        exportFolder: ".scratch",
      });

      const exportedSession = await createSession.run({
        title: "Ingest lag alerts",
        idea: "Alert the on-call engineer when ingest falls behind.",
        model: "opus",
        projectId: project.id,
      });
      await getDb()
        .update(schema.sessions)
        .set({ lastExportFolder: ".scratch/ingest-lag-alerts" })
        .where(eq(schema.sessions.id, exportedSession.id));

      const otherSession = await createSession.run({
        title: "Another idea",
        idea: "Something else entirely.",
        model: "opus",
        projectId: project.id,
      });

      const exportedInterviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
      ]);
      await scoutProject.run({ sessionId: exportedSession.id });
      const [exportedRequest] = scoutRequests(exportedInterviewer.requests);
      expect(exportedRequest!.facts.decisionFiles).toEqual(["docs/decisions.md"]);

      const otherInterviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
      ]);
      await scoutProject.run({ sessionId: otherSession.id });
      const [otherRequest] = scoutRequests(otherInterviewer.requests);
      expect(otherRequest!.facts.decisionFiles).toEqual([
        ".scratch/ingest-lag-alerts/decisions.md",
        "docs/decisions.md",
      ]);
    });
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
