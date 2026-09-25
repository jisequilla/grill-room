import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPrompt,
  resetInterviewer,
  scriptInterviewer,
  type InterviewerRequest,
  type ProposeRoundRequest,
  type ScriptedTurn,
  type SynthesizeSpecRequest,
} from "../server/interviewer/index.js";
import {
  aScoutProjectResult,
  ideaEvidence,
  anAssessReadinessResult,
} from "../server/interviewer/test-fixtures.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import assessReadiness from "./assess-readiness.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import dropRepoDecision from "./drop-repo-decision.js";
import findSuperseded from "./find-superseded.js";
import getCurrentRound from "./get-current-round.js";
import getScoutReport from "./get-scout-report.js";
import getTree from "./get-tree.js";
import keepRepoDecision from "./keep-repo-decision.js";
import registerProject from "./register-project.js";
import reopenDecision from "./reopen-decision.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import scoutProject from "./scout-project.js";
import submitRound from "./submit-round.js";
import synthesizeSpec from "./synthesize-spec.js";

const repos = useTempGitRepos();

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

const BROKER_STATEMENT =
  "Ingest runs on a Postgres-backed queue, not a message broker.";
const POSTGRES_STATEMENT = "Every service stores its state in Postgres.";

/** A scout report proposing two repo decisions: one to keep, one to drop. */
function twoProposals() {
  return aScoutProjectResult({
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
  });
}

/** A session on a real fixture repository, scouted once, with no rounds yet. */
async function aScoutedSession() {
  const root = repos.create({
    files: {
      "src/ingest/metrics.ts": lines(30),
      "docs/adr/0003-queue.md": lines(9),
      "CLAUDE.md": "# Agent instructions\n",
    },
  });
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
  scriptInterviewer([{ kind: "scout-project", result: twoProposals() }]);
  const scouted = await scoutProject.run({ sessionId: session.id });
  return { root, session, report: scouted.report! };
}

function aProposal(
  key: string,
  dependsOn: string[] = [],
  ask = true,
): ScriptedTurn {
  return {
    kind: "propose-round",
    result: {
      proposedDecisions: [
        {
          key,
          title: `Question ${key}`,
          body: `The body of ${key}`,
          choices: [],
          recommendedChoice: null,
          recommendedAnswer: `The usual answer to ${key}`,
          dependsOn,
          ask,
        },
      ],
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
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

async function treeByKey(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return new Map(tree.decisions.map((decision) => [decision.key, decision]));
}

async function answerOpenRound(sessionId: string, answer: string) {
  const open = await getCurrentRound.run({ sessionId });
  for (const card of open.round?.decisions ?? []) {
    await saveDraftAnswer.run({
      decisionId: card.id,
      answerKind: "own-answer",
      answer,
    });
  }
  return submitRound.run({ id: open.round!.id });
}

function proposeRequests(requests: readonly InterviewerRequest[]) {
  return requests.filter(
    (request): request is ProposeRoundRequest => request.kind === "propose-round",
  );
}

describe("keep-repo-decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("adds a settled repo decision carrying its origin, and records it kept", async () => {
    const { session, report } = await aScoutedSession();

    const kept = await keepRepoDecision.run({
      sessionId: session.id,
      key: "no-message-broker",
    });

    expect(kept.decision).toMatchObject({
      key: "no-message-broker",
      questionTitle: "No message broker",
      introducedBy: "repo",
      state: "settled",
      answer: { kind: "repo-established", text: BROKER_STATEMENT },
      repo: {
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        statement: BROKER_STATEMENT,
        scoutReportId: report.id,
      },
    });
    expect(kept.dispositions).toEqual({
      "no-message-broker": "kept",
      "postgres-only": "undecided",
    });

    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report!.dispositions["no-message-broker"]).toBe("kept");

    const tree = await treeByKey(session.id);
    expect(tree.get("no-message-broker")).toMatchObject({
      state: "settled",
      introducedBy: "repo",
    });
  });

  it("is never offered by the frontier, and a proposed round cannot re-ask it", async () => {
    const { session } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });

    const interviewer = scriptInterviewer([
      // Re-proposing the kept decision's key is refused and sent back...
      aProposal("no-message-broker"),
      // ...and so is asking the same question under a fresh key.
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "broker-again",
              title: "No message broker",
              body: "",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "",
              dependsOn: [],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
      aProposal("alerting"),
    ]);

    const round = await requestNextRound.run({ sessionId: session.id });

    const requests = proposeRequests(interviewer.requests);
    expect(requests).toHaveLength(3);
    expect(requests[1]!.rejectionReason).toContain(
      'Decision "no-message-broker" is already in the tree',
    );
    expect(requests[2]!.rejectionReason).toContain(
      'asks the same question as "no-message-broker"',
    );
    expect(round.round!.decisions.map((card) => card.key)).toEqual(["alerting"]);

    // The interviewer saw it as settled, from the repo, with its citation.
    const snapshot = requests[0]!.context.decisions.find(
      (decision) => decision.key === "no-message-broker",
    );
    expect(snapshot).toMatchObject({
      state: "settled",
      introducedBy: "repo",
      answer: { kind: "repo-established", text: BROKER_STATEMENT },
      repo: {
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        statement: BROKER_STATEMENT,
      },
    });
    const prompt = buildPrompt(requests[0]!);
    expect(prompt).toContain(
      "[no-message-broker] (settled, added by repo) No message broker",
    );
    expect(prompt).toContain(
      `from the repo (recorded, cited at docs/adr/0003-queue.md:5-9): ${BROKER_STATEMENT}`,
    );
    expect(prompt).toContain("They are the project's");
  });

  it("refuses to keep a key twice rather than duplicating it", async () => {
    const { session } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });

    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" }),
    ).rejects.toMatchObject({ errorCode: "already-kept" });

    const tree = await getTree.run({ sessionId: session.id });
    expect(
      tree.decisions.filter((decision) => decision.key === "no-message-broker"),
    ).toHaveLength(1);
  });

  it("refuses a key the current report does not propose", async () => {
    const { session } = await aScoutedSession();
    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "no-such-decision" }),
    ).rejects.toMatchObject({ errorCode: "proposal-not-found" });
  });

  it("refuses a session with no scout report", async () => {
    const session = await createSession.run({
      title: "No project",
      idea: "Something with no project.",
    });
    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" }),
    ).rejects.toMatchObject({ errorCode: "no-scout-report" });
  });

  it("refuses while a turn is working, and outside interviewing", async () => {
    const { session } = await aScoutedSession();
    const db = getDb();

    await db
      .update(schema.sessions)
      .set({ turnStatus: "working" })
      .where(eq(schema.sessions.id, session.id));
    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" }),
    ).rejects.toMatchObject({ errorCode: "turn-working" });
    await expect(
      dropRepoDecision.run({ sessionId: session.id, key: "postgres-only" }),
    ).rejects.toMatchObject({ errorCode: "turn-working" });

    await db
      .update(schema.sessions)
      .set({ turnStatus: "idle", state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));
    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" }),
    ).rejects.toMatchObject({ errorCode: "wrong-session-state" });
    await expect(
      dropRepoDecision.run({ sessionId: session.id, key: "postgres-only" }),
    ).rejects.toMatchObject({ errorCode: "wrong-session-state" });
  });

  it("refuses a key the tree already uses for another decision", async () => {
    const { session } = await aScoutedSession();
    scriptInterviewer([aProposal("postgres-only")]);
    await requestNextRound.run({ sessionId: session.id });

    await expect(
      keepRepoDecision.run({ sessionId: session.id, key: "postgres-only" }),
    ).rejects.toMatchObject({ errorCode: "key-in-use" });
    const read = await getScoutReport.run({ sessionId: session.id });
    expect(read.report!.dispositions["postgres-only"]).toBe("undecided");
  });

  it("lets an interviewer-proposed decision depend on it, and a reopen stales that dependent", async () => {
    const { session } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });

    const interviewer = scriptInterviewer([
      // Depends on the repo decision and is asked at once: it is settled.
      aProposal("alerting", ["no-message-broker"]),
      nothingMore,
    ]);
    await requestNextRound.run({ sessionId: session.id });
    expect(interviewer.requests).toHaveLength(1);
    expect(interviewer.requests[0]!.rejectionReason).toBeNull();

    let tree = await treeByKey(session.id);
    expect(tree.get("alerting")!.dependsOn).toEqual([
      tree.get("no-message-broker")!.id,
    ]);
    expect(tree.get("alerting")!.state).toBe("frontier");

    await answerOpenRound(session.id, "Page the on-call engineer");
    tree = await treeByKey(session.id);
    expect(tree.get("alerting")!.state).toBe("settled");

    // Reopen works on a repo decision unchanged: its repo answer becomes
    // history, it is asked again, and what depends on it goes stale.
    const reopened = await reopenDecision.run({
      decisionId: tree.get("no-message-broker")!.id,
    });
    expect(reopened.round!.decisions.map((card) => card.key)).toEqual([
      "no-message-broker",
    ]);

    tree = await treeByKey(session.id);
    expect(tree.get("no-message-broker")).toMatchObject({
      state: "frontier",
      introducedBy: "repo",
      answer: null,
      recommendedAnswer: BROKER_STATEMENT,
      repo: { statement: BROKER_STATEMENT },
    });
    expect(tree.get("no-message-broker")!.previousAnswers).toMatchObject([
      { kind: "repo-established", text: BROKER_STATEMENT },
    ]);
    expect(tree.get("alerting")!.state).toBe("stale");
  });
});

describe("drop-repo-decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("adds nothing to the tree, and the dropped proposal reaches the next turn as context", async () => {
    const { session, report } = await aScoutedSession();

    const dropped = await dropRepoDecision.run({
      sessionId: session.id,
      key: "postgres-only",
    });
    expect(dropped.dispositions).toEqual({
      "no-message-broker": "undecided",
      "postgres-only": "dropped",
    });
    expect((await getTree.run({ sessionId: session.id })).decisions).toEqual([]);

    const interviewer = scriptInterviewer([aProposal("alerting")]);
    await requestNextRound.run({ sessionId: session.id });

    const [request] = proposeRequests(interviewer.requests);
    expect(request!.context.projectContext).toEqual({
      commitRead: report.commitRead,
      stale: false,
      currentState: report.result.currentState,
      droppedDecisions: [
        {
          key: "postgres-only",
          title: "Postgres only",
          statement: POSTGRES_STATEMENT,
          source: "inferred",
          citation: "src/ingest/metrics.ts:1-2",
          reason: "Alert state would live beside the queue.",
        },
      ],
    });

    const prompt = buildPrompt(request!);
    expect(prompt).toContain("## The project");
    expect(prompt).toContain(`The scout report is current, read at commit ${report.commitRead}`);
    expect(prompt).toContain("(partial) Ingest lag is measured but never alerted on.");
    expect(prompt).toContain(
      `[postgres-only] (inferred, cited at src/ingest/metrics.ts:1-2) Postgres only: ${POSTGRES_STATEMENT}`,
    );
  });

  it("refuses to drop a proposal already kept in the tree", async () => {
    const { session } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });

    await expect(
      dropRepoDecision.run({ sessionId: session.id, key: "no-message-broker" }),
    ).rejects.toMatchObject({ errorCode: "already-kept" });
  });

  it("lets a dropped proposal be kept afterwards", async () => {
    const { session } = await aScoutedSession();
    await dropRepoDecision.run({ sessionId: session.id, key: "postgres-only" });

    const kept = await keepRepoDecision.run({
      sessionId: session.id,
      key: "postgres-only",
    });
    expect(kept.decision.state).toBe("settled");
    expect(kept.dispositions["postgres-only"]).toBe("kept");
  });
});

describe("project context on every turn", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("is null for a session with no scout report", async () => {
    const session = await createSession.run({
      title: "No project",
      idea: "Something with no project.",
    });
    const interviewer = scriptInterviewer([aProposal("shape")]);
    await requestNextRound.run({ sessionId: session.id });

    const [request] = proposeRequests(interviewer.requests);
    expect(request!.context.projectContext).toBeNull();
    expect(buildPrompt(request!)).not.toContain("## The project");
  });

  it("is still sent once the report is stale, marked stale with its commit", async () => {
    const { root, session, report } = await aScoutedSession();
    writeFileSync(path.join(root, "NOTES.md"), "notes\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "Add notes"]);

    const interviewer = scriptInterviewer([aProposal("alerting")]);
    await requestNextRound.run({ sessionId: session.id });

    const [request] = proposeRequests(interviewer.requests);
    expect(request!.context.projectContext).toMatchObject({
      stale: true,
      commitRead: report.commitRead,
      currentState: report.result.currentState,
    });
    expect(buildPrompt(request!)).toContain(
      `The scout report is stale: it was read at commit ${report.commitRead}`,
    );
  });

  it("reaches a re-scout's request too", async () => {
    const { session } = await aScoutedSession();
    await dropRepoDecision.run({ sessionId: session.id, key: "postgres-only" });

    const interviewer = scriptInterviewer([
      {
        kind: "scout-project",
        result: {
          ...twoProposals(),
          previousDecisions: [
            { key: "no-message-broker", change: "unchanged", statement: null },
            { key: "postgres-only", change: "unchanged", statement: null },
          ],
        },
      },
    ]);
    await scoutProject.run({ sessionId: session.id });

    const [request] = interviewer.requests;
    expect(request!.kind).toBe("scout-project");
    expect(request!.context.projectContext).toMatchObject({
      stale: false,
      droppedDecisions: [{ key: "postgres-only" }],
    });
  });

  it("is carried by every turn kind, and spec synthesis receives the repo decisions the interview reopened", async () => {
    const { session, report } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });
    await dropRepoDecision.run({ sessionId: session.id, key: "postgres-only" });

    const expectedContext = {
      commitRead: report.commitRead,
      stale: false,
      currentState: report.result.currentState,
      droppedDecisions: [expect.objectContaining({ key: "postgres-only" })],
    };

    const interviewer = scriptInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult({
        evidence: [ideaEvidence("when ingest falls behind")],
      }) },
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
              dependsOn: ["no-message-broker"],
              ask: true,
            },
            {
              key: "channel",
              title: "Which channel carries the alert?",
              body: "",
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: "PagerDuty",
              dependsOn: [],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
      nothingMore,
      { kind: "find-superseded", result: { supersessions: [], replacements: [] } },
      {
        kind: "review-stale",
        result: {
          reviews: [
            {
              decisionKey: "alerting",
              verdict: "reconfirm",
              reason: "Paging does not depend on the queue.",
              title: null,
              body: null,
              choices: [],
              recommendedChoice: null,
              recommendedAnswer: null,
            },
          ],
        },
      },
      nothingMore,
      {
        kind: "synthesize-spec",
        result: {
          markdown: [
            "## Problem Statement",
            "## Solution",
            "## User Stories",
            "## Implementation Decisions",
            "## Testing Decisions",
            "## Out of Scope",
            "## Further Notes",
          ].join("\n\n"),
        },
      },
      {
        kind: "break-into-tickets",
        result: {
          tickets: [
            { number: 1, slug: "alerts", title: "Alerts", body: "Build it.", blockedBy: [] },
          ],
        },
      },
    ]);

    await assessReadiness.run({ sessionId: session.id });
    await requestNextRound.run({ sessionId: session.id });

    // Settle "alerting" and leave "channel" a loose end for the supersession check.
    const open = await getCurrentRound.run({ sessionId: session.id });
    const cards = new Map(open.round!.decisions.map((card) => [card.key, card]));
    await saveDraftAnswer.run({
      decisionId: cards.get("alerting")!.id,
      answerKind: "own-answer",
      answer: "Page the on-call engineer",
    });
    await saveDraftAnswer.run({
      decisionId: cards.get("channel")!.id,
      answerKind: "unknown",
    });
    await submitRound.run({ id: open.round!.id });
    await findSuperseded.run({ sessionId: session.id });

    // Change the project's decision in the interview.
    const tree = await treeByKey(session.id);
    await reopenDecision.run({ decisionId: tree.get("no-message-broker")!.id });
    await answerOpenRound(session.id, "Move ingest onto Kafka");

    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));
    await synthesizeSpec.run({ sessionId: session.id });
    await breakIntoTickets.run({ sessionId: session.id });

    expect(interviewer.remaining).toBe(0);
    const kinds = interviewer.requests.map((request) => request.kind);
    expect(new Set(kinds)).toEqual(
      new Set([
        "assess-readiness",
        "propose-round",
        "find-superseded",
        "review-stale",
        "synthesize-spec",
        "break-into-tickets",
      ]),
    );
    for (const request of interviewer.requests) {
      expect(request.context.projectContext, request.kind).toEqual(
        expectedContext,
      );
    }

    const synthesis = interviewer.requests.find(
      (request): request is SynthesizeSpecRequest =>
        request.kind === "synthesize-spec",
    )!;
    expect(synthesis.reopenedRepoDecisions).toEqual([
      {
        key: "no-message-broker",
        title: "No message broker",
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        replacedStatement: BROKER_STATEMENT,
        answer: "Move ingest onto Kafka",
      },
    ]);
    const prompt = buildPrompt(synthesis);
    expect(prompt).toContain("were reopened in\n  the interview and changed");
    expect(prompt).toContain("as a deliberate change to the project");
    expect(prompt).toContain(
      `the project held "${BROKER_STATEMENT}"; the interview changed it to "Move ingest onto Kafka"`,
    );

    // After the reopen, the decision keeps its repo origin beside the
    // interview's answer.
    const after = await treeByKey(session.id);
    expect(after.get("no-message-broker")).toMatchObject({
      introducedBy: "repo",
      answer: { kind: "own-answer", text: "Move ingest onto Kafka" },
      repo: { statement: BROKER_STATEMENT },
    });
  });

  it("gives spec synthesis no reopened repo decisions while every repo decision holds its repo answer", async () => {
    const { session } = await aScoutedSession();
    await keepRepoDecision.run({ sessionId: session.id, key: "no-message-broker" });
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));

    const interviewer = scriptInterviewer([
      {
        kind: "synthesize-spec",
        result: {
          markdown: [
            "## Problem Statement",
            "## Solution",
            "## User Stories",
            "## Implementation Decisions",
            "## Testing Decisions",
            "## Out of Scope",
            "## Further Notes",
          ].join("\n\n"),
        },
      },
    ]);
    await synthesizeSpec.run({ sessionId: session.id });

    const [request] = interviewer.requests as SynthesizeSpecRequest[];
    expect(request!.reopenedRepoDecisions).toEqual([]);
    expect(buildPrompt(request!)).not.toContain(
      "were reopened in\n  the interview and changed",
    );
  });
});
