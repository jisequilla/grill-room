import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
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
    exportFolder: ".scratch",
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

  it("accepts a ticket that changes no files", async () => {
    const { session } = await aSessionWithHandoff();
    const spike = withTicket(1, (ticket) => {
      ticket.filesToChange = [];
    });
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

    it("a citation to a line past the file's end", async () => {
      const { session } = await aSessionWithHandoff();
      const reason = await refusedThenAccepted(
        session.id,
        withTicket(1, (ticket) => {
          ticket.facts = [{ statement: "Queue ADR.", citation: "docs/adr/0003-queue.md:5-10" }];
        }),
      );
      expect(reason).toMatch(/cites line 10, but docs\/adr\/0003-queue\.md has 9 lines/);
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
        /Ticket 2 marks src\/ingest\/broker\.ts as edit, but no such file exists in the project; mark it create/,
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
        tickets: [aHandoffScoutResult().tickets[0]!],
      });
      expect(reason).toMatch(/Ticket 2 is missing; report every ticket of the handoff \(1, 2\) exactly once/);
    });

    it("a ticket reported twice, or one the handoff does not have", async () => {
      const { session } = await aSessionWithHandoff();
      const [first, second] = aHandoffScoutResult().tickets;
      const reason = await refusedThenAccepted(session.id, {
        tickets: [first!, second!, first!, { ...first!, number: 7 }],
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
        exportFolder: ".scratch",
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
