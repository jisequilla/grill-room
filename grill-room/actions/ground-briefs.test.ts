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
import { buildPrompt } from "../server/interviewer/prompt.js";
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
        tickets: [
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
      provedBy: { testPath: testFile, command: "npm test -- lag-alert" },
    });
    const refused: HandoffScoutResult = {
      tickets: [...aHandoffScoutResult().tickets, ticket3("create")],
    };
    const accepted: HandoffScoutResult = {
      tickets: [...aHandoffScoutResult().tickets, ticket3("edit")],
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
