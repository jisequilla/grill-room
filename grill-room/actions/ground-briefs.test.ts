import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_TICKETS,
  resetInterviewer,
  scriptInterviewer,
  type HandoffScoutRequest,
  type HandoffScoutResult,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { buildPrompt } from "../server/interviewer/prompt.js";
import { aHandoffScoutResult, NO_DELEGATION_PROPOSALS } from "../server/interviewer/test-fixtures.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import generateHandoff from "./generate-handoff.js";
import getBriefGrounding from "./get-brief-grounding.js";
import getSession from "./get-session.js";
import getTurn from "./get-turn.js";
import groundBriefs from "./ground-briefs.js";
import listTickets from "./list-tickets.js";
import registerProject from "./register-project.js";
import setTicketBlockedBy from "./set-ticket-blocked-by.js";
import synthesizeSpec from "./synthesize-spec.js";

const repos = useTempGitRepos();

const outsideFolders: string[] = [];
afterEach(() => {
  for (const folder of outsideFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

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

/** A repo holding every file `aHandoffScoutResult()` cites or edits, at the lengths it cites. */
function aFixtureRepo(): string {
  return repos.create({
    files: {
      "src/ingest/metrics.ts": lines(30),
      "src/ingest/queue.ts": lines(10),
      "docs/adr/0003-queue.md": lines(9),
      "CLAUDE.md": "# Agent instructions\n",
    },
    gitignore: "dist/\n",
  });
}

const SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "Ingest falls behind unnoticed.",
  "",
  "## Solution",
  "",
  "An alert on ingest lag.",
  "",
  "## User Stories",
  "",
  "1. As an on-call engineer, I want an alert, so that I know when ingest lags.",
  "",
  "## Implementation Decisions",
  "",
  "- The alert reads the lag metric.",
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

interface TicketSpec {
  number: number;
  blockedBy?: number[];
  kind?: "build" | "gate";
  waitsFor?: string | null;
  implements?: number[];
}

function ticketsTurn(tickets: TicketSpec[]): ScriptedTurn {
  return {
    kind: "break-into-tickets",
    result: {
      tickets: tickets.map((ticket) => ({
        slug: `ticket-${ticket.number}`,
        title: `Ticket ${ticket.number}`,
        body: `Do the work of ticket ${ticket.number}.`,
        blockedBy: [],
        // The spec numbers one story: every build ticket builds it; a gate builds none.
        implements: ticket.kind === "gate" ? [] : [1],
        ...ticket,
      })),
    },
  };
}

const TWO_TICKETS: TicketSpec[] = [{ number: 1 }, { number: 2, blockedBy: [1] }];

/**
 * A confirmed session in a fixture project, with a spec, tickets and a
 * generated handoff: everything grounding needs.
 */
async function aSessionWithHandoff(
  options: {
    root?: string;
    model?: "fable" | "opus" | "sonnet";
    tickets?: TicketSpec[];
  } = {},
) {
  const root = options.root ?? aFixtureRepo();
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    workingExportFolder: ".scratch",
  });
  const session = await createSession.run({
    title: "Ingest lag alerts",
    idea: "Alert the on-call engineer when ingest falls behind.",
    model: options.model ?? "opus",
    projectId: project.id,
  });
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, session.id));
  scriptInterviewer([
    { kind: "synthesize-spec", result: { markdown: SPEC_MARKDOWN } },
    ticketsTurn(options.tickets ?? TWO_TICKETS),
  ]);
  await synthesizeSpec.run({ sessionId: session.id });
  await breakIntoTickets.run({ sessionId: session.id });
  await generateHandoff.run({ sessionId: session.id });
  return { root, project, session };
}

async function ticketId(sessionId: string, number: number): Promise<string> {
  const { tickets } = await listTickets.run({ sessionId });
  return tickets.find((ticket) => ticket.number === number)!.id;
}

function scoutRequests(requests: readonly { kind: string }[]): HandoffScoutRequest[] {
  return requests.filter(
    (request): request is HandoffScoutRequest => request.kind === "handoff-scout",
  );
}

/** `aHandoffScoutResult()` with one ticket changed by `edit`. */
function withTicket(
  number: number,
  edit: (ticket: HandoffScoutResult["tickets"][number]) => void,
): HandoffScoutResult {
  const result = aHandoffScoutResult();
  edit(result.tickets.find((ticket) => ticket.number === number)!);
  return result;
}

/**
 * Grounds the session with `refused` first and a valid result second, and
 * returns the reason the second request carried.
 */
async function refusedThenAccepted(
  sessionId: string,
  refused: HandoffScoutResult,
): Promise<string> {
  const interviewer = scriptInterviewer([
    { kind: "handoff-scout", result: refused },
    { kind: "handoff-scout", result: aHandoffScoutResult() },
  ]);

  const grounded = await groundBriefs.run({ sessionId });

  const requests = scoutRequests(interviewer.requests);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.rejectionReason).toBeNull();
  expect(requests[0]!.previousResult).toBeNull();
  expect(requests[1]!.previousResult).toEqual(refused);
  expect(grounded.grounding).toMatchObject({
    result: aHandoffScoutResult(),
    current: true,
  });
  return requests[1]!.rejectionReason!;
}

describe("ground-briefs", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("stores a valid grounding and reads it back current", async () => {
    const { root, session } = await aSessionWithHandoff();
    const before = await getSession.run({ id: session.id });
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const [request] = scoutRequests(interviewer.requests);
    expect(request).toMatchObject({
      projectRoot: root,
      specMarkdown: SPEC_MARKDOWN,
      tickets: [
        { number: 1, title: "Ticket 1", body: "Do the work of ticket 1.", blockedBy: [] },
        { number: 2, title: "Ticket 2", body: "Do the work of ticket 2.", blockedBy: [1] },
      ],
      rejectionReason: null,
      context: { idea: session.idea, title: session.title, model: "sonnet", conversationId: null },
    });

    const handoffRow = (
      await getDb()
        .select()
        .from(schema.handoffs)
        .where(eq(schema.handoffs.sessionId, session.id))
    )[0]!;
    const read = await getBriefGrounding.run({ sessionId: session.id });
    expect(read.grounding).toEqual(grounded.grounding);
    expect(read.grounding).toMatchObject({
      sessionId: session.id,
      result: aHandoffScoutResult(),
      commitRead: request!.facts.headCommit,
      handoffFingerprint: handoffRow.fingerprint,
      model: "sonnet",
      current: true,
      staleReason: null,
    });
    expect(read.grounding!.commitRead).toMatch(/^[0-9a-f]{40}$/);
    expect(read.grounding!.turnId).not.toBeNull();

    // The scout never joins the session's own conversation.
    expect(await getSession.run({ id: session.id })).toMatchObject({
      conversationId: before.conversationId,
      turnStatus: "idle",
    });
  });

  it("sends the scout the fact pack", async () => {
    const { session } = await aSessionWithHandoff();
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);

    await groundBriefs.run({ sessionId: session.id });

    const [request] = scoutRequests(interviewer.requests);
    expect(request!.factPack.trackedFiles).toEqual(
      expect.arrayContaining([
        "CLAUDE.md",
        "README.md",
        "docs/adr/0003-queue.md",
        "src/ingest/metrics.ts",
        "src/ingest/queue.ts",
      ]),
    );
    expect(request!.factPack.namedDocs).toEqual([
      { paths: ["CLAUDE.md"], lines: ["# Agent instructions"], cutLines: [], truncated: false },
    ]);
    expect(request!.factPack.verifyCommand).not.toBeNull();
  });

  it("stores and returns the scout's rules, two-lens flags and delegation proposals", async () => {
    const { session } = await aSessionWithHandoff();
    const scripted = withTicket(1, (ticket) => {
      ticket.rules = [
        {
          citation: "CLAUDE.md:1",
          statement: "Every change updates the changelog.",
          requiredFiles: ["CHANGELOG.md"],
        },
      ];
      ticket.twoLensReview = { citation: "CLAUDE.md:1" };
    });
    scripted.delegationProposals = {
      ...NO_DELEGATION_PROPOSALS,
      maxTicketsInFlight: { value: 2, citation: "CLAUDE.md:1" },
    };
    scriptInterviewer([{ kind: "handoff-scout", result: scripted }]);

    await groundBriefs.run({ sessionId: session.id });

    const read = await getBriefGrounding.run({ sessionId: session.id });
    expect(read.grounding!.result.tickets[0]!.rules).toEqual(scripted.tickets[0]!.rules);
    expect(read.grounding!.result.tickets[0]!.twoLensReview).toEqual({ citation: "CLAUDE.md:1" });
    expect(read.grounding!.result.delegationProposals).toEqual(scripted.delegationProposals);
  });

  it("leaves the session's last export folder out of the fact pack", async () => {
    const root = repos.create({
      files: {
        "src/ingest/metrics.ts": lines(30),
        "src/ingest/queue.ts": lines(10),
        "docs/adr/0003-queue.md": lines(9),
        "CLAUDE.md": "# Agent instructions\n",
        ".scratch/out/spec.md": "spec\n",
        ".scratch/out/HANDOFF.md": "handoff\n",
      },
      gitignore: "dist/\n",
    });
    const { session } = await aSessionWithHandoff({ root });
    await getDb()
      .update(schema.sessions)
      .set({ lastExportFolder: ".scratch/out" })
      .where(eq(schema.sessions.id, session.id));
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);

    await groundBriefs.run({ sessionId: session.id });

    const [request] = scoutRequests(interviewer.requests);
    expect(request!.factPack.trackedFiles).toContain("src/ingest/queue.ts");
    expect(request!.factPack.trackedFiles.some((file) => file.startsWith(".scratch/out/"))).toBe(
      false,
    );
  });

  it("replaces the earlier grounding on a re-run", async () => {
    const { session } = await aSessionWithHandoff();
    scriptInterviewer([{ kind: "handoff-scout", result: aHandoffScoutResult() }]);
    const first = await groundBriefs.run({ sessionId: session.id });

    const second = withTicket(1, (ticket) => {
      ticket.facts = [];
    });
    scriptInterviewer([{ kind: "handoff-scout", result: second }]);
    const rerun = await groundBriefs.run({ sessionId: session.id });

    expect(rerun.grounding!.id).not.toBe(first.grounding!.id);
    expect((await getBriefGrounding.run({ sessionId: session.id })).grounding!.result).toEqual(second);
    expect(await getDb().select().from(schema.briefGroundings)).toHaveLength(1);
  });

  it("accepts a ticket that changes no files, and so lists no proving test", async () => {
    const { session } = await aSessionWithHandoff();
    const spike = withTicket(1, (ticket) => {
      ticket.filesToChange = [];
    });
    expect(spike.tickets[0]!.provedBy.testPath).toBe("src/ingest/lag-alert.test.ts");
    spike.tickets[1]!.buildsOn[0] = {
      ...spike.tickets[1]!.buildsOn[0]!,
      citation: "src/ingest/metrics.ts:1",
      createdPath: null,
    };
    scriptInterviewer([{ kind: "handoff-scout", result: spike }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    expect(grounded.grounding).toMatchObject({ result: spike, current: true });
  });

  it("records the turn as handoff-scout on sonnet for a session on another model", async () => {
    const { session } = await aSessionWithHandoff({ model: "fable" });
    scriptInterviewer([{ kind: "handoff-scout", result: aHandoffScoutResult() }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const latest = await findLatestTurn({ sessionId: session.id, turnKind: "handoff-scout" });
    expect(latest).not.toBeNull();
    const turn = await getTurn.run({ turnId: latest!.id });
    expect(turn).toMatchObject({
      sessionId: session.id,
      turnKind: "handoff-scout",
      model: "sonnet",
      outcome: "succeeded",
    });
    expect(grounded.grounding!.turnId).toBe(turn.id);
    expect((await getSession.run({ id: session.id })).model).toBe("fable");
  });

  it("clamps a citation range past the file's end and accepts it at once", async () => {
    const { session } = await aSessionWithHandoff();
    const raw = withTicket(1, (ticket) => {
      ticket.facts = [{ statement: "Queue ADR.", citation: "docs/adr/0003-queue.md:5-10" }];
    });
    const interviewer = scriptInterviewer([{ kind: "handoff-scout", result: raw }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    expect(scoutRequests(interviewer.requests)).toHaveLength(1);
    const stored = grounded.grounding!.result.tickets.find((ticket) => ticket.number === 1)!;
    expect(stored.facts[0]!.citation).toBe("docs/adr/0003-queue.md:5-9");
  });

  it("a retry shows the clamped citation, not the raw one", async () => {
    const { session } = await aSessionWithHandoff();
    const refused = withTicket(1, (ticket) => {
      ticket.buildsOnFiles = ["src/alerts.ts:1"];
      ticket.facts = [{ statement: "Queue ADR.", citation: "docs/adr/0003-queue.md:5-10" }];
    });
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: refused },
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);

    await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    const shown = requests[1]!.previousResult!.tickets.find((ticket) => ticket.number === 1)!;
    expect(shown.facts[0]!.citation).toBe("docs/adr/0003-queue.md:5-9");
    expect(refused.tickets.find((ticket) => ticket.number === 1)!.facts[0]!.citation).toBe(
      "docs/adr/0003-queue.md:5-10",
    );
  });

  it("clamps a buildsOnFiles entry and a buildsOn citation that run past the file's end", async () => {
    const { session } = await aSessionWithHandoff();
    const raw = withTicket(2, (ticket) => {
      ticket.buildsOnFiles = ["src/ingest/metrics.ts:25-99"];
      ticket.buildsOn[0] = {
        ...ticket.buildsOn[0]!,
        citation: "src/ingest/queue.ts:4-50",
        createdPath: null,
      };
    });
    const interviewer = scriptInterviewer([{ kind: "handoff-scout", result: raw }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    expect(scoutRequests(interviewer.requests)).toHaveLength(1);
    const stored = grounded.grounding!.result.tickets.find((ticket) => ticket.number === 2)!;
    expect(stored.buildsOnFiles).toEqual(["src/ingest/metrics.ts:25-30"]);
    expect(stored.buildsOn[0]!.citation).toBe("src/ingest/queue.ts:4-10");
    const rawTicket = raw.tickets.find((ticket) => ticket.number === 2)!;
    expect(rawTicket.buildsOnFiles).toEqual(["src/ingest/metrics.ts:25-99"]);
    expect(rawTicket.buildsOn[0]!.citation).toBe("src/ingest/queue.ts:4-50");
  });

  describe("the rejection check refuses and the retry is accepted", () => {
    it("a citation to a missing file", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.buildsOnFiles = ["src/alerts.ts:1"];
        }),
      );
      expect(reason).toMatch(/cites src\/alerts\.ts, which does not exist/);
    });

    it("refuses a citation that starts past the file's end", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.facts = [{ statement: "Queue ADR.", citation: "docs/adr/0003-queue.md:10-12" }];
        }),
      );
      expect(reason).toMatch(/cites line 12, but docs\/adr\/0003-queue\.md has 9 lines/);
    });

    it("a citation-form dependency to a missing file", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = {
            ...ticket.buildsOn[0]!,
            citation: "src/ingest/lag-alert.ts:1",
            createdPath: null,
          };
        }),
      );
      expect(reason).toMatch(/cites src\/ingest\/lag-alert\.ts, which does not exist/);
    });

    it("an edit of a missing file", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.filesToChange = [{ path: "src/ingest/broker.ts", change: "edit" }];
        }),
      );
      expect(reason).toMatch(
        /Ticket 2 marks src\/ingest\/broker\.ts as edit, but no such file exists in the project and none of its blockers creates it; mark it create/,
      );
    });

    it("a create inside an ignored path", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "dist/lag-alert.js", change: "create" });
        }),
      );
      expect(reason).toMatch(/Ticket 1 marks dist\/lag-alert\.js as create, but git ignores that path/);
    });

    it("a create inside an ignored path that git prints quoted", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push(
            { path: "dist/é.js", change: "create" },
            { path: 'dist/a"b.js', change: "create" },
          );
        }),
      );
      expect(reason).toContain("Ticket 1 marks dist/é.js as create, but git ignores that path");
      expect(reason).toContain('Ticket 1 marks dist/a"b.js as create, but git ignores that path');
    });

    it("a create inside .git", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: ".git/hooks/pre-commit", change: "create" });
        }),
      );
      expect(reason).toMatch(
        /Ticket 1 marks \.git\/hooks\/pre-commit as create, but it is inside a \.git folder/,
      );
    });

    it("an edit inside .git", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: ".git/config", change: "edit" });
        }),
      );
      expect(reason).toMatch(/Ticket 1 marks \.git\/config as edit, but it is inside a \.git folder/);
    });

    it("a blocker with no buildsOn entry", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn = [];
        }),
      );
      expect(reason).toMatch(
        /Ticket 2 is blocked by ticket 1, but its buildsOn has no entry for ticket 1/,
      );
    });

    it("a blocker named twice in buildsOn", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn = [ticket.buildsOn[0]!, ticket.buildsOn[0]!];
        }),
      );
      expect(reason).toMatch(/Ticket 2's buildsOn names ticket 1 2 times/);
    });

    it("a create outside the root, through a symlink", async () => {
      const root = aFixtureRepo();
      const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-outside-")));
      outsideFolders.push(outside);
      symlinkSync(outside, path.join(root, "linked"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "linked/escape.ts", change: "create" });
        }),
      );
      expect(reason).toMatch(
        /Ticket 1 marks linked\/escape\.ts as create, but it resolves outside the project/,
      );
    });

    it("a create under a symlinked folder inside the root names the link and its target", async () => {
      const root = aFixtureRepo();
      mkdirSync(path.join(root, "real-src"));
      symlinkSync(path.join(root, "real-src"), path.join(root, "linked"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "linked/new.ts", change: "create" });
        }),
      );
      expect(reason).toContain(
        "Ticket 1 marks linked/new.ts as create, but linked is a symbolic link, and git cannot track a path through one; plan it under real-src instead.",
      );
    });

    it("a create under a nested symlinked folder names the shallowest link", async () => {
      const root = aFixtureRepo();
      mkdirSync(path.join(root, "src", "real"), { recursive: true });
      symlinkSync(path.join(root, "src", "real"), path.join(root, "src", "linked"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "src/linked/deep/new.ts", change: "create" });
        }),
      );
      expect(reason).toContain(
        "Ticket 1 marks src/linked/deep/new.ts as create, but src/linked is a symbolic link, and git cannot track a path through one; plan it under src/real instead.",
      );
    });

    it("a create under a symlink to the root", async () => {
      const root = aFixtureRepo();
      symlinkSync(root, path.join(root, "self"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "self/new.ts", change: "create" });
        }),
      );
      expect(reason).toContain(
        "Ticket 1 marks self/new.ts as create, but self is a symbolic link, and git cannot track a path through one; plan it under the project root instead.",
      );
    });

    it("a create under a dangling symlink", async () => {
      const root = aFixtureRepo();
      symlinkSync(path.join(root, "missing-dir"), path.join(root, "gone"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "gone/new.ts", change: "create" });
        }),
      );
      expect(reason).toContain(
        "Ticket 1 marks gone/new.ts as create, but gone is a symbolic link, and git cannot track a path through one; plan it under a real folder instead.",
      );
    });

    it("a symlinked create does not hide an ignored one in the same set", async () => {
      const root = aFixtureRepo();
      mkdirSync(path.join(root, "real-src"));
      symlinkSync(path.join(root, "real-src"), path.join(root, "linked"));
      const { session } = await aSessionWithHandoff({ root });

      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push(
            { path: "linked/new.ts", change: "create" },
            { path: "dist/x.js", change: "create" },
          );
        }),
      );
      expect(reason).toContain(
        "Ticket 1 marks linked/new.ts as create, but linked is a symbolic link, and git cannot track a path through one; plan it under real-src instead.",
      );
      expect(reason).toContain(
        "Ticket 1 marks dist/x.js as create, but git ignores that path, so the repository would never track it; plan a path git tracks.",
      );
    });

    it("a create of an existing file", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "src/ingest/queue.ts", change: "create" });
        }),
      );
      expect(reason).toMatch(
        /Ticket 1 marks src\/ingest\/queue\.ts as create, but it already exists; mark it edit/,
      );
    });

    it("a buildsOn naming a ticket that does not block it", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.buildsOn = [
            {
              blocker: 2,
              provides: "The queue wiring.",
              citation: "src/ingest/queue.ts:1",
              createdPath: null,
              editedPath: null,
              symbol: null,
              check: "test -f src/ingest/queue.ts",
            },
          ];
        }),
      );
      expect(reason).toMatch(
        /Ticket 1's buildsOn names ticket 2, which does not block it; ticket 1 is blocked by none/,
      );
    });

    it("a missing ticket", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(session.id, {
        delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [aHandoffScoutResult().tickets[0]!],
      });
      expect(reason).toMatch(/Ticket 2 is missing; report every ticket of the handoff \(1, 2\) exactly once/);
    });

    it("a ticket reported twice, or one the handoff does not have", async () => {
      const { session } = await aSessionWithHandoff();
      const [first, second] = aHandoffScoutResult().tickets;
      const reason = await refusedThenAccepted(session.id, {
        delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [first!, second!, first!, { ...first!, number: 7 }],
      });
      expect(reason).toMatch(/Ticket 1 appears 2 times/);
      expect(reason).toMatch(/Ticket 7 is not a ticket of this handoff/);
    });

    it("a dependency on a path its blocker does not create", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = { ...ticket.buildsOn[0]!, createdPath: "src/ingest/alert-rules.ts" };
        }),
      );
      expect(reason).toMatch(
        /Ticket 2's buildsOn on ticket 1 depends on src\/ingest\/alert-rules\.ts, which ticket 1 does not list as a create/,
      );
    });

    it("a dependency with neither a citation nor a path", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = { ...ticket.buildsOn[0]!, citation: null, createdPath: null };
        }),
      );
      expect(reason).toMatch(
        /Ticket 2's buildsOn on ticket 1 says neither where it lives nor where ticket 1 puts it; set exactly one of citation/,
      );
    });

    it("a dependency with both a citation and a path", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = { ...ticket.buildsOn[0]!, citation: "src/ingest/metrics.ts:1" };
        }),
      );
      expect(reason).toMatch(
        /Ticket 2's buildsOn on ticket 1 sets more than one of citation, createdPath and editedPath/,
      );
    });

    it("a dependency on a file its blocker does not edit", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = {
            ...ticket.buildsOn[0]!,
            createdPath: null,
            editedPath: "src/ingest/queue.ts",
            symbol: "lagThreshold",
            check: "grep -n lagThreshold src/ingest/queue.ts",
          };
        }),
      );
      expect(reason).toMatch(
        /Ticket 2's buildsOn on ticket 1 says ticket 1 adds to src\/ingest\/queue\.ts, which ticket 1 does not list as an edit in its filesToChange/,
      );
    });

    it("a dependency on an edited file with no symbol, or a symbol with no edited file", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(session.id, {
        delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [
          aHandoffScoutResult().tickets[0]!,
          {
            ...aHandoffScoutResult().tickets[1]!,
            buildsOn: [
              {
                ...aHandoffScoutResult().tickets[1]!.buildsOn[0]!,
                createdPath: null,
                editedPath: "src/ingest/metrics.ts",
                symbol: null,
              },
            ],
          },
        ],
      });
      expect(reason).toMatch(
        /Ticket 2's buildsOn on ticket 1 names src\/ingest\/metrics\.ts but no symbol/,
      );

      const { session: other } = await aSessionWithHandoff();
      const otherReason = await refusedThenAccepted(
        other.id,
        withTicket(2, (ticket) => {
          ticket.buildsOn[0] = { ...ticket.buildsOn[0]!, symbol: "lagAlert" };
        }),
      );
      expect(otherReason).toMatch(
        /Ticket 2's buildsOn on ticket 1 names the symbol lagAlert without an editedPath/,
      );
    });

    it("a proving test outside the ticket's files to change", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(2, (ticket) => {
          ticket.provedBy = { ...ticket.provedBy, testPath: "src/ingest/metrics.test.ts" };
        }),
      );
      expect(reason).toMatch(
        /Ticket 2 is proved by src\/ingest\/metrics\.test\.ts, which is not one of its filesToChange; list the test file as a create or an edit/,
      );
    });

    it("a path that is not relative to the project root", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: "~/notes.ts", change: "create" });
          ticket.provedBy = { ...ticket.provedBy, testPath: "../elsewhere.test.ts" };
        }),
      );
      expect(reason).toContain(
        `Ticket 1's filesToChange "~/notes.ts" is not a path relative to the project root that stays inside it`,
      );
      expect(reason).toContain(
        `Ticket 1's provedBy.testPath "../elsewhere.test.ts" is not a path relative to the project root that stays inside it`,
      );
    });

    // The path-shape refusal is the only guard for these: the per-file checks
    // skip a path that fails it.
    it.each([
      ["a create that steps out of the repo", "../escape.ts", "create"],
      ["an edit of an absolute path", "/etc/hosts", "edit"],
      ["an edit that steps out of the repo midway", "src/../../etc/passwd", "edit"],
    ] as const)("%s", async (_label, escaping, change) => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.filesToChange.push({ path: escaping, change });
        }),
      );
      expect(reason).toContain(
        `Ticket 1's filesToChange "${escaping}" is not a path relative to the project root that stays inside it`,
      );
    });
  });

  it("retries a result that breaks a rule the schema once ended the turn on", async () => {
    // Run 1 of the real grounding run: a dependency on code the blocker adds
    // to a file it edits fit neither form, so the model left both null. The
    // schema's refine threw malformed-output and the turn ended.
    const { session } = await aSessionWithHandoff();
    const [first, second] = aHandoffScoutResult().tickets;
    const brokenRule = {
      tickets: [
        first,
        {
          ...second,
          buildsOn: [
            {
              blocker: 1,
              provides: "The lag alert module.",
              citation: null,
              createdPath: null,
              check: "test -f src/ingest/lag-alert.ts",
            },
          ],
        },
      ],
    };
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", invalidResult: brokenRule },
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.rejectionReason).toMatch(
      /Ticket 2's buildsOn on ticket 1 says neither where it lives nor where ticket 1 puts it/,
    );
    expect(grounded.grounding).toMatchObject({ result: aHandoffScoutResult(), current: true });
    const latest = await findLatestTurn({ sessionId: session.id, turnKind: "handoff-scout" });
    expect((await getTurn.run({ turnId: latest!.id })).outcome).toBe("succeeded");
  });

  it("converges when a retry changes only the refused entry: a test file two tickets created becomes the later one's edit", async () => {
    // The second real grounding run's split: ticket 1 creates the code and
    // its test file, and ticket 3, blocked by 1, extends that test file.
    const { session } = await aSessionWithHandoff({
      tickets: [{ number: 1 }, { number: 2, blockedBy: [1] }, { number: 3, blockedBy: [1] }],
    });
    const testFile = "src/ingest/lag-alert.test.ts";
    const ticket3 = (change: "create" | "edit"): HandoffScoutResult["tickets"][number] => ({
      number: 3,
      filesToChange: [{ path: testFile, change }],
      reach: [],
      buildsOnFiles: [],
      facts: [],
      buildsOn: [
        {
          blocker: 1,
          provides: "The lag alert module and its test file.",
          citation: null,
          createdPath: "src/ingest/lag-alert.ts",
          editedPath: null,
          symbol: null,
          check: "test -f src/ingest/lag-alert.ts",
        },
      ],
      rules: [],
      twoLensReview: null,
      provedBy: { testPath: testFile, command: "npm test -- lag-alert" },
    });
    const refused: HandoffScoutResult = {
      delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [...aHandoffScoutResult().tickets, ticket3("create")],
    };
    const accepted: HandoffScoutResult = {
      delegationProposals: NO_DELEGATION_PROPOSALS, tickets: [...aHandoffScoutResult().tickets, ticket3("edit")],
    };
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: refused },
      { kind: "handoff-scout", result: accepted },
    ]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.previousResult).toBeNull();
    expect(requests[1]!.previousResult).toEqual(refused);
    const reason = `Tickets 1 and 3 both mark ${testFile} as create; only one ticket may create a path. Ticket 1 comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create. Ticket 3 is blocked by ticket 1, so mark ${testFile} as edit in ticket 3: a ticket may edit a file one of its blockers creates.`;
    expect(requests[1]!.rejectionReason).toBe(reason);

    const retryPrompt = buildPrompt(requests[1]!);
    expect(retryPrompt).toContain(`## Your previous answer was rejected\n\n${reason}`);
    expect(retryPrompt).toContain(
      ["```json", JSON.stringify(requests[1]!.previousResult, null, 2), "```"].join("\n"),
    );
    expect(retryPrompt).toContain("- Keep every entry the reasons do not name exactly as it is in your");
    expect(retryPrompt).toContain("- Change only the entries the reasons name.");
    expect(retryPrompt).toContain("- Do not re-read files already read for your previous answer unless a");
    expect(retryPrompt).not.toContain("Do not repeat the rejected structure.");

    expect(grounded.grounding).toMatchObject({ result: accepted, current: true });
    const read = await getBriefGrounding.run({ sessionId: session.id });
    expect(read.grounding!.result).toEqual(accepted);
  });

  it("a reach no tracked file contains", async () => {
    const root = repos.create({
      files: {
        "src/ingest/metrics.ts": `${lines(30)}export const lagThreshold = 1;\n`,
        "src/ingest/queue.ts": `${lines(10)}lagThreshold\n`,
        "docs/adr/0003-queue.md": lines(9),
        "CLAUDE.md": "# Agent instructions\n",
      },
      gitignore: "dist/\n",
    });
    const { session } = await aSessionWithHandoff({ root });
    const refused = withTicket(1, (ticket) => {
      ticket.reach = [{ symbol: "lagThreshld" }];
    });
    const accepted = withTicket(1, (ticket) => {
      ticket.reach = [{ symbol: "lagThreshold" }];
    });
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", result: refused },
      { kind: "handoff-scout", result: accepted },
    ]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.rejectionReason).toBe(
      "Ticket 1 declares a reach for `lagThreshld`, which no tracked file contains; a reach is for a symbol that exists in the repository today. Spell it as the code does, or drop the reach.",
    );
    expect(requests[1]!.previousResult!.tickets[0]!.reach).toEqual([{ symbol: "lagThreshld" }]);
    expect(grounded.grounding!.result.tickets[0]!.reach).toEqual([
      { symbol: "lagThreshold", files: 2 },
    ]);
    const read = await getBriefGrounding.run({ sessionId: session.id });
    expect(read.grounding!.result.tickets[0]!.reach).toEqual([{ symbol: "lagThreshold", files: 2 }]);
  });

  it("accepts a dependency on what a blocker adds to a file it edits", async () => {
    const { session } = await aSessionWithHandoff();
    const edited = withTicket(2, (ticket) => {
      ticket.buildsOn[0] = {
        blocker: 1,
        provides: "The lag threshold the alert reads.",
        citation: null,
        createdPath: null,
        editedPath: "src/ingest/metrics.ts",
        symbol: "LAG_ALERT_THRESHOLD",
        check: "grep -n LAG_ALERT_THRESHOLD src/ingest/metrics.ts",
      };
    });
    scriptInterviewer([{ kind: "handoff-scout", result: edited }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    expect(grounded.grounding).toMatchObject({ result: edited, current: true });
  });

  it("fails the turn once every attempt is refused, storing nothing", async () => {
    const { session } = await aSessionWithHandoff();
    const refused = { tickets: [aHandoffScoutResult().tickets[0]!] };
    scriptInterviewer([
      { kind: "handoff-scout", result: refused },
      { kind: "handoff-scout", result: refused },
      { kind: "handoff-scout", result: refused },
    ]);

    await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "invalid-brief-grounding",
    });
    expect((await getBriefGrounding.run({ sessionId: session.id })).grounding).toBeNull();
    expect(await getSession.run({ id: session.id })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-brief-grounding",
    });
  });

  describe("staleness", () => {
    it("goes stale with head-moved after a new commit", async () => {
      const { root, session } = await aSessionWithHandoff();
      scriptInterviewer([{ kind: "handoff-scout", result: aHandoffScoutResult() }]);
      await groundBriefs.run({ sessionId: session.id });

      writeFileSync(path.join(root, "NOTES.md"), "A new file.\n");
      git(root, ["add", "NOTES.md"]);
      git(root, ["commit", "-q", "-m", "Add notes"]);

      expect((await getBriefGrounding.run({ sessionId: session.id })).grounding).toMatchObject({
        current: false,
        staleReason: "head-moved",
      });
    });

    it("goes stale with handoff-changed after a ticket edit", async () => {
      const { session } = await aSessionWithHandoff();
      scriptInterviewer([{ kind: "handoff-scout", result: aHandoffScoutResult() }]);
      await groundBriefs.run({ sessionId: session.id });

      await setTicketBlockedBy.run({ ticketId: await ticketId(session.id, 2), blockedBy: [] });

      expect((await getBriefGrounding.run({ sessionId: session.id })).grounding).toMatchObject({
        current: false,
        staleReason: "handoff-changed",
      });

      // Regenerating the handoff does not bring the grounding back: it was
      // made for the tickets as they were.
      await generateHandoff.run({ sessionId: session.id });
      expect((await getBriefGrounding.run({ sessionId: session.id })).grounding).toMatchObject({
        current: false,
        staleReason: "handoff-changed",
      });
    });
  });

  describe("refusals, before any turn", () => {
    it("refuses a session with no project", async () => {
      const session = await createSession.run({
        title: "Ingest lag alerts",
        idea: "Alert the on-call engineer when ingest falls behind.",
      });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "no-project",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses a project that is no longer a git repository", async () => {
      const { root, session } = await aSessionWithHandoff();
      rmSync(path.join(root, ".git"), { recursive: true, force: true });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "not-a-repo",
      });
      expect(interviewer.requests).toHaveLength(0);
      expect(await findLatestTurn({ sessionId: session.id, turnKind: "handoff-scout" })).toBeNull();
    });

    it("refuses a session with no handoff", async () => {
      const root = aFixtureRepo();
      const project = await registerProject.run({
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
      });
      const session = await createSession.run({
        title: "Ingest lag alerts",
        idea: "Alert the on-call engineer when ingest falls behind.",
        projectId: project.id,
      });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "handoff-missing",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses a stale handoff", async () => {
      const { session } = await aSessionWithHandoff();
      await setTicketBlockedBy.run({ ticketId: await ticketId(session.id, 2), blockedBy: [] });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "handoff-stale",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses while a turn is working", async () => {
      const { session } = await aSessionWithHandoff();
      await getDb()
        .update(schema.sessions)
        .set({ turnStatus: "working" })
        .where(eq(schema.sessions.id, session.id));
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "turn-working",
      });
      expect(interviewer.requests).toHaveLength(0);
    });

    it("refuses more tickets than one turn can ground", async () => {
      const tickets = Array.from({ length: MAX_HANDOFF_SCOUT_TICKETS + 1 }, (_, index) => ({
        number: index + 1,
      }));
      const { session } = await aSessionWithHandoff({ tickets });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "too-many-tickets",
      });
      expect(interviewer.requests).toHaveLength(0);
      expect(await findLatestTurn({ sessionId: session.id, turnKind: "handoff-scout" })).toBeNull();
    });

    it("refuses a ticket with more blockers than a grounded ticket can name", async () => {
      const blockers = Array.from({ length: MAX_HANDOFF_SCOUT_BUILDS_ON + 1 }, (_, index) => index + 1);
      const tickets = [
        ...blockers.map((number) => ({ number })),
        { number: blockers.length + 1, blockedBy: blockers },
      ];
      const { session } = await aSessionWithHandoff({ tickets });
      const interviewer = scriptInterviewer([]);

      await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
        errorCode: "too-many-blockers",
      });
      expect(interviewer.requests).toHaveLength(0);
      expect(await findLatestTurn({ sessionId: session.id, turnKind: "handoff-scout" })).toBeNull();
    });

    it("refuses an unknown session", async () => {
      await expect(groundBriefs.run({ sessionId: "missing" })).rejects.toThrow(
        "Session not found: missing",
      );
    });
  });
});

describe("gates are not grounded", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  const gate = (number: number, blockedBy: number[] = []): TicketSpec => ({
    number,
    blockedBy,
    kind: "gate",
    waitsFor: "A live account on the payment platform, with API keys issued.",
  });

  /** `aHandoffScoutResult()` with its second ticket renumbered to `number`. */
  function groundingFor(number: number): HandoffScoutResult {
    const result = aHandoffScoutResult();
    result.tickets[1]!.number = number;
    return result;
  }

  it("sends only the build tickets, each blocked through its gates, and accepts a grounding that names no gate", async () => {
    const { session } = await aSessionWithHandoff({
      tickets: [{ number: 1 }, gate(2, [1]), { number: 3, blockedBy: [2] }],
    });
    const interviewer = scriptInterviewer([{ kind: "handoff-scout", result: groundingFor(3) }]);

    const grounded = await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tickets.map((ticket) => [ticket.number, ticket.blockedBy])).toEqual([
      [1, []],
      [3, [1]],
    ]);
    expect(grounded.grounding).toMatchObject({ result: groundingFor(3), current: true });
  });

  it("accepts a grounding for a build ticket blocked only by a gate, with no buildsOn at all", async () => {
    const { session } = await aSessionWithHandoff({
      tickets: [{ number: 1 }, gate(2), { number: 3, blockedBy: [1, 2] }, { number: 4, blockedBy: [2] }],
    });
    const result = groundingFor(3);
    result.tickets.push({ ...aHandoffScoutResult().tickets[0]!, number: 4, filesToChange: [], buildsOn: [] });
    const interviewer = scriptInterviewer([{ kind: "handoff-scout", result }]);

    await groundBriefs.run({ sessionId: session.id });

    const requests = scoutRequests(interviewer.requests);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tickets.map((ticket) => [ticket.number, ticket.blockedBy])).toEqual([
      [1, []],
      [3, [1]],
      [4, []],
    ]);
  });

  it("counts a ticket's blockers through its gates for too-many-blockers", async () => {
    const builds = Array.from({ length: MAX_HANDOFF_SCOUT_BUILDS_ON + 1 }, (_, index) => index + 1);
    const gateNumber = builds.length + 1;
    const { session } = await aSessionWithHandoff({
      tickets: [
        ...builds.map((number) => ({ number })),
        gate(gateNumber, builds),
        { number: gateNumber + 1, blockedBy: [gateNumber] },
      ],
    });
    const interviewer = scriptInterviewer([]);

    await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "too-many-blockers",
    });
    expect(interviewer.requests).toHaveLength(0);
  });

  it("counts a gate neither as a ticket nor as a blocker of its own", async () => {
    const builds = Array.from({ length: MAX_HANDOFF_SCOUT_BUILDS_ON }, (_, index) => index + 1);
    const gateNumber = builds.length + 1;
    const { session } = await aSessionWithHandoff({
      tickets: [
        ...builds.map((number) => ({ number })),
        gate(gateNumber, [1]),
        // One blocker too many as stored, exactly the cap once the gate
        // collapses into ticket 1, which it already lists.
        { number: gateNumber + 1, blockedBy: [...builds, gateNumber] },
      ],
    });
    const interviewer = scriptInterviewer([
      { kind: "handoff-scout", invalidResult: { unexpected: true } },
    ]);

    await expect(groundBriefs.run({ sessionId: session.id })).rejects.toMatchObject({
      errorCode: "malformed-output",
    });

    const [request] = scoutRequests(interviewer.requests);
    expect(request!.tickets.map((ticket) => ticket.number)).not.toContain(gateNumber);
    expect(request!.tickets[request!.tickets.length - 1]).toMatchObject({
      number: gateNumber + 1,
      blockedBy: builds,
    });
  });
});

describe("get-brief-grounding", () => {
  useTestDatabase();

  it("returns null for a session never grounded", async () => {
    const { session } = await aSessionWithHandoff();
    expect(await getBriefGrounding.run({ sessionId: session.id })).toEqual({
      sessionId: session.id,
      grounding: null,
    });
  });

  it("refuses an unknown session", async () => {
    await expect(getBriefGrounding.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });
});
