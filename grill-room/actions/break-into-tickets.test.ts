import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  type BreakIntoTicketsRequest,
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { buildPrompt } from "../server/interviewer/prompt.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import getSpec from "./get-spec.js";
import getTurn from "./get-turn.js";
import listTickets from "./list-tickets.js";
import registerProject from "./register-project.js";
import synthesizeSpec from "./synthesize-spec.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

async function confirm(sessionId: string) {
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, sessionId));
}

const GOOD_SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
  "",
  "## User Stories",
  "",
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
  "",
  "## Implementation Decisions",
  "",
  "- The shape is a workspace.",
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

/** A session confirmed and carrying a current spec, ready to break into tickets. */
async function aConfirmedSessionWithSpec(): Promise<string> {
  const session = await aSession();
  await confirm(session.id);
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: GOOD_SPEC_MARKDOWN } }]);
  await synthesizeSpec.run({ sessionId: session.id });
  return session.id;
}

function ticketsTurn(
  tickets: {
    number: number;
    slug: string;
    title?: string;
    body?: string;
    blockedBy?: number[];
  }[],
): ScriptedTurn {
  return {
    kind: "break-into-tickets",
    result: {
      tickets: tickets.map((ticket) => ({
        title: `Ticket ${ticket.number}`,
        body: `Do the work of ticket ${ticket.number}.`,
        blockedBy: [],
        ...ticket,
      })),
    },
  };
}

const oneGoodTicket = ticketsTurn([{ number: 1, slug: "build-the-workspace" }]);

const twoGoodTickets = ticketsTurn([
  { number: 1, slug: "build-the-workspace" },
  { number: 2, slug: "store-on-disk", blockedBy: [1] },
]);

describe("break-into-tickets", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("refuses a session that is not confirmed", async () => {
    const session = await aSession();

    await expect(
      breakIntoTickets.run({ sessionId: session.id }),
    ).rejects.toThrow(/Only a confirmed session can be broken into tickets/);
  });

  it("refuses while a turn is working", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      breakIntoTickets.run({ sessionId }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("refuses when no spec has been synthesized yet", async () => {
    const session = await aSession();
    await confirm(session.id);

    await expect(
      breakIntoTickets.run({ sessionId: session.id }),
    ).rejects.toThrow(/no spec yet/);
  });

  it("refuses when the spec is not current", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    await getDb()
      .update(schema.specs)
      .set({ current: false })
      .where(eq(schema.specs.sessionId, sessionId));

    await expect(
      breakIntoTickets.run({ sessionId }),
    ).rejects.toThrow(/spec is out of date/);
  });

  it("sends the spec's markdown in the request", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer([oneGoodTicket]);

    await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests[0]).toMatchObject({
      kind: "break-into-tickets",
      specMarkdown: GOOD_SPEC_MARKDOWN,
    });
  });

  it("stores the tickets a well-formed result proposes", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([twoGoodTickets]);

    const { tickets, ticketsCurrent } = await breakIntoTickets.run({ sessionId });

    expect(tickets.map((ticket) => [ticket.number, ticket.slug])).toEqual([
      [1, "build-the-workspace"],
      [2, "store-on-disk"],
    ]);
    expect(tickets[1]?.blockedBy).toEqual([1]);
    expect(ticketsCurrent).toBe(true);
  });

  describe("ticket set validation", () => {
    it("rejects a duplicate ticket number", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one" },
          { number: 1, slug: "one-again" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("used more than once"),
      });
    });

    it("rejects numbers that leave a gap", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one" },
          { number: 3, slug: "three" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("no gaps"),
      });
    });

    it("rejects a slug that is not lowercase letters, digits and hyphens", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "Build The Thing!" }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("must be lowercase"),
      });
    });

    it("rejects a slug used by more than one ticket", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "same-slug" },
          { number: 2, slug: "same-slug" },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining('"same-slug" is used by more than one'),
      });
    });

    it("rejects a blockedBy entry that names no ticket in the set", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "one", blockedBy: [99] }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("not a ticket number in this set"),
      });
    });

    it("rejects a ticket that blocks itself", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([{ number: 1, slug: "one", blockedBy: [1] }]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("cannot block itself"),
      });
    });

    it("rejects a blockedBy cycle", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one", blockedBy: [2] },
          { number: 2, slug: "two", blockedBy: [1] },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("blocking cycle"),
      });
    });

    it("gives up after exhausting retries and records a failed turn", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const bad = ticketsTurn([{ number: 1, slug: "one", blockedBy: [1] }]);
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(breakIntoTickets.run({ sessionId })).rejects.toThrow(
        /does not validate 3 times/,
      );

      expect(interviewer.requests).toHaveLength(3);
      expect((await listTickets.run({ sessionId })).tickets).toEqual([]);
      expect(await getSession.run({ id: sessionId })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "invalid-tickets",
      });
    });
  });

  describe("regeneration and build records", () => {
    it("replaces existing tickets when none carry a build record", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      await breakIntoTickets.run({ sessionId });

      scriptInterviewer([twoGoodTickets]);
      const { tickets } = await breakIntoTickets.run({ sessionId });

      expect(tickets.map((ticket) => ticket.slug)).toEqual([
        "build-the-workspace",
        "store-on-disk",
      ]);
    });

    it("refuses to replace a ticket that carries a build record", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      const { tickets } = await breakIntoTickets.run({ sessionId });
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.buildRecords)
        .values({
          id: "build-1",
          ticketId: tickets[0]!.id,
          model: "sonnet",
          firstAttemptPassed: true,
          createdAt: now,
          updatedAt: now,
        });

      scriptInterviewer([twoGoodTickets]);

      await expect(
        breakIntoTickets.run({ sessionId }),
      ).rejects.toThrow(/would delete 1 build record/);
      expect((await listTickets.run({ sessionId })).tickets).toHaveLength(1);
    });

    it("replaces tickets and their build records when force is set", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([oneGoodTicket]);
      const { tickets } = await breakIntoTickets.run({ sessionId });
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.buildRecords)
        .values({
          id: "build-1",
          ticketId: tickets[0]!.id,
          model: "sonnet",
          firstAttemptPassed: true,
          createdAt: now,
          updatedAt: now,
        });

      scriptInterviewer([twoGoodTickets]);
      const { tickets: replaced } = await breakIntoTickets.run({
        sessionId,
        force: true,
      });

      expect(replaced.map((ticket) => ticket.slug)).toEqual([
        "build-the-workspace",
        "store-on-disk",
      ]);
      expect(
        await getDb().select().from(schema.buildRecords),
      ).toEqual([]);
    });
  });

  describe("turn records", () => {
    it("records a clean breakdown as one successful attempt, on the session's model, linked to the spec", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const session = await getSession.run({ id: sessionId });
      scriptInterviewer([oneGoodTicket]);

      await breakIntoTickets.run({ sessionId });

      const latest = await findLatestTurn({
        sessionId,
        turnKind: "break-into-tickets",
      });
      expect(latest).not.toBeNull();
      const turn = await getTurn.run({ turnId: latest!.id });
      expect(turn).toMatchObject({
        sessionId,
        turnKind: "break-into-tickets",
        model: session.model,
        outcome: "succeeded",
      });
      expect(turn.runs).toHaveLength(1);
      expect(turn.runs[0]!.attempts).toEqual([
        expect.objectContaining({ attemptNumber: 1, kind: "success" }),
      ]);
      expect(
        (await getSpec.run({ sessionId })).spec?.ticketsTurnId,
      ).toBe(turn.id);
    });

    it("records a cyclic blockedBy proposal as a refusal, then the accepted retry as a success", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one", blockedBy: [2] },
          { number: 2, slug: "two", blockedBy: [1] },
        ]),
        oneGoodTicket,
      ]);

      await breakIntoTickets.run({ sessionId });

      const latest = await findLatestTurn({
        sessionId,
        turnKind: "break-into-tickets",
      });
      expect(latest).not.toBeNull();
      expect(latest!.outcome).toBe("succeeded");
      expect(
        latest!.runs[0]!.attempts.map((attempt) => attempt.kind),
      ).toEqual(["tree-rule-refusal", "success"]);
      expect(latest!.runs[0]!.attempts[0]!.reason).toContain(
        "blocking cycle",
      );
    });
  });
});

describe("break-into-tickets in a repository with no commits yet", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  const repos = useTempGitRepos();

  /** A confirmed session with a current spec, in a real project whose repository has commits or not. */
  async function aSessionInProject(options: {
    commit: boolean;
    verifyCommand?: string;
  }): Promise<string> {
    const root = repos.create({ commit: options.commit });
    const project = await registerProject.run({
      root,
      verifyCommand: options.verifyCommand ?? "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    await confirm(session.id);
    scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: GOOD_SPEC_MARKDOWN } }]);
    await synthesizeSpec.run({ sessionId: session.id });
    return session.id;
  }

  type Row = { number: number; slug: string; body?: string; blockedBy?: number[] };

  /** A set shaped as the greenfield section asks: ticket 1 names the command, every other ticket waits for it. */
  function aGreenfieldSet(verifyCommand: string): ScriptedTurn {
    return ticketsTurn([
      { number: 1, slug: "set-up", body: `Set up the runner. Acceptance: \`${verifyCommand}\` passes.` },
      { number: 2, slug: "build", blockedBy: [1] },
    ]);
  }

  function rejectionOf(request: unknown): string {
    return (request as BreakIntoTicketsRequest).rejectionReason ?? "";
  }

  describe("the request", () => {
    it("carries greenfield and the verify command for a repository without commits", async () => {
      const sessionId = await aSessionInProject({ commit: false, verifyCommand: "just verify" });
      const interviewer = scriptInterviewer([aGreenfieldSet("just verify")]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[0]).toMatchObject({
        kind: "break-into-tickets",
        greenfield: true,
        verifyCommand: "just verify",
      });
    });

    it("carries greenfield false and the verify command for a repository with commits", async () => {
      const sessionId = await aSessionInProject({ commit: true, verifyCommand: "just verify" });
      const interviewer = scriptInterviewer([oneGoodTicket]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[0]).toMatchObject({
        kind: "break-into-tickets",
        greenfield: false,
        verifyCommand: "just verify",
      });
    });

    it("carries greenfield false and no verify command for a session with no project", async () => {
      const sessionId = await aConfirmedSessionWithSpec();
      const interviewer = scriptInterviewer([oneGoodTicket]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests[0]).toMatchObject({
        kind: "break-into-tickets",
        greenfield: false,
        verifyCommand: null,
      });
    });
  });

  describe("the ticket set", () => {
    const NAMES_IT = "Set up the runner so that `pnpm test` passes.";
    const LACKS_IT = "Set up the runner.";
    const dependsOnFirst = (number: number) => `Ticket ${number} does not depend on ticket 1.`;
    const DOES_NOT_NAME = "Ticket 1 does not name the verify command.";

    it.each<[string, string, Row[]]>([
      [
        "1 names the command, 2 blocked by 1, 3 blocked by 2",
        "pnpm test",
        [
          { number: 1, slug: "one", body: NAMES_IT },
          { number: 2, slug: "two", blockedBy: [1] },
          { number: 3, slug: "three", blockedBy: [2] },
        ],
      ],
      ["1 names the command, alone", "pnpm test", [{ number: 1, slug: "one", body: NAMES_IT }]],
      [
        "a command with a backtick: 1 does not name it, 2 blocked by 1",
        "echo `date`",
        [
          { number: 1, slug: "one", body: LACKS_IT },
          { number: 2, slug: "two", blockedBy: [1] },
        ],
      ],
      [
        "a command with a backtick: ticket 1 alone, not naming it",
        "echo `date`",
        [{ number: 1, slug: "one", body: LACKS_IT }],
      ],
    ])("accepts %s", async (_, verifyCommand, rows) => {
      const sessionId = await aSessionInProject({ commit: false, verifyCommand });
      const interviewer = scriptInterviewer([ticketsTurn(rows)]);

      const { tickets } = await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests).toHaveLength(1);
      expect(tickets.map((ticket) => ticket.number)).toEqual(rows.map((row) => row.number));
    });

    const GREENFIELD_REJECTIONS: [string, string, Row[], string[], string[]][] = [
      [
        "3 not blocked by anything",
        "pnpm test",
        [
          { number: 1, slug: "one", body: NAMES_IT },
          { number: 2, slug: "two", blockedBy: [1] },
          { number: 3, slug: "three" },
        ],
        [dependsOnFirst(3)],
        [dependsOnFirst(2), DOES_NOT_NAME],
      ],
      [
        "1 lacks the command",
        "pnpm test",
        [
          { number: 1, slug: "one", body: LACKS_IT },
          { number: 2, slug: "two", blockedBy: [1] },
        ],
        [DOES_NOT_NAME],
        [dependsOnFirst(2)],
      ],
      [
        "verify `test`: 1 says test, but not as inline code",
        "test",
        [{ number: 1, slug: "one", body: "This is not a test of the runner" }],
        [DOES_NOT_NAME],
        [],
      ],
      [
        "a command with a backtick: 2 not blocked by 1",
        "echo `date`",
        [
          { number: 1, slug: "one", body: LACKS_IT },
          { number: 2, slug: "two" },
        ],
        [dependsOnFirst(2)],
        [DOES_NOT_NAME],
      ],
    ];

    it.each(GREENFIELD_REJECTIONS)(
      "rejects %s, and asks again",
      async (_, verifyCommand, rows, expected, notExpected) => {
        const sessionId = await aSessionInProject({ commit: false, verifyCommand });
        const interviewer = scriptInterviewer([ticketsTurn(rows), aGreenfieldSet(verifyCommand)]);

        await breakIntoTickets.run({ sessionId });

        expect(interviewer.requests).toHaveLength(2);
        const reason = rejectionOf(interviewer.requests[1]);
        for (const text of expected) expect(reason).toContain(text);
        for (const text of notExpected) expect(reason).not.toContain(text);
      },
    );

    it.each(GREENFIELD_REJECTIONS)(
      "accepts %s in a repository with commits",
      async (_, verifyCommand, rows) => {
        const sessionId = await aSessionInProject({ commit: true, verifyCommand });
        const interviewer = scriptInterviewer([ticketsTurn(rows)]);

        await breakIntoTickets.run({ sessionId });

        expect(interviewer.requests).toHaveLength(1);
      },
    );

    it("gives a set with a duplicate number only today's reasons, greenfield or not", async () => {
      const rows: Row[] = [
        { number: 1, slug: "one", body: NAMES_IT },
        { number: 1, slug: "one-again" },
        { number: 3, slug: "three" },
      ];
      const reasonFor = async (commit: boolean) => {
        const sessionId = await aSessionInProject({ commit });
        const interviewer = scriptInterviewer([ticketsTurn(rows), aGreenfieldSet("pnpm test")]);
        await breakIntoTickets.run({ sessionId });
        return rejectionOf(interviewer.requests[1]);
      };

      const greenfield = await reasonFor(false);

      expect(greenfield).toBe(
        "Ticket number 1 is used more than once. Every ticket needs its own number. Ticket numbers must run from 1 to 3 with no gaps. Missing: 2.",
      );
      expect(greenfield).toBe(await reasonFor(true));
    });

    it("gives a cyclic set only the cycle reason", async () => {
      const sessionId = await aSessionInProject({ commit: false });
      const interviewer = scriptInterviewer([
        ticketsTurn([
          { number: 1, slug: "one", body: LACKS_IT },
          { number: 2, slug: "two", blockedBy: [3] },
          { number: 3, slug: "three", blockedBy: [2] },
        ]),
        aGreenfieldSet("pnpm test"),
      ]);

      await breakIntoTickets.run({ sessionId });

      expect(rejectionOf(interviewer.requests[1])).toBe("These tickets form a blocking cycle: 2, 3.");
    });

    it("gives up after exhausting retries and records a failed turn", async () => {
      const sessionId = await aSessionInProject({ commit: false });
      const bad = ticketsTurn([
        { number: 1, slug: "one", body: NAMES_IT },
        { number: 2, slug: "two" },
      ]);
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(breakIntoTickets.run({ sessionId })).rejects.toThrow(
        /does not validate 3 times\. Last reason: Ticket 2 does not depend on ticket 1/,
      );

      expect(interviewer.requests).toHaveLength(3);
      expect((await listTickets.run({ sessionId })).tickets).toEqual([]);
      expect(await getSession.run({ id: sessionId })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "invalid-tickets",
      });
    });
  });

  describe("seam: a set shaped as the prompt section describes passes the check", () => {
    it.each(["pnpm test", "echo `date`"])("verify command %s", async (verifyCommand) => {
      const sessionId = await aSessionInProject({ commit: false, verifyCommand });
      const first = scriptInterviewer([aGreenfieldSet(verifyCommand)]);
      await breakIntoTickets.run({ sessionId });
      const prompt = buildPrompt(first.requests[0] as BreakIntoTicketsRequest);

      // Follow the section's words: ticket 1 names the command in the inline
      // form the section writes (none when it asks for none), and the others
      // wait for ticket 1, one of them only through another ticket.
      expect(prompt).toContain("## This repository has no commits yet");
      const inlineForm = /written as inline\ncode: (.*)\.\n/.exec(prompt)?.[1] ?? null;
      expect(inlineForm === null).toBe(verifyCommand.includes("`"));
      const shaped = ticketsTurn([
        {
          number: 1,
          slug: "set-up-the-runner",
          body: `Set up the project and its test runner.${inlineForm ? ` Acceptance: ${inlineForm} passes from the repository root.` : ""}`,
        },
        { number: 2, slug: "build-the-workspace", blockedBy: [1] },
        { number: 3, slug: "store-on-disk", blockedBy: [2] },
      ]);
      const second = scriptInterviewer([shaped]);

      await breakIntoTickets.run({ sessionId });

      expect(second.requests).toHaveLength(1);
      expect((await listTickets.run({ sessionId })).tickets.map((ticket) => ticket.slug)).toEqual([
        "set-up-the-runner",
        "build-the-workspace",
        "store-on-disk",
      ]);
    });
  });
});

describe("list-tickets", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a session id that does not exist", async () => {
    await expect(
      listTickets.run({ sessionId: "missing" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("returns an empty list and ticketsCurrent false before any tickets are generated", async () => {
    const sessionId = await aConfirmedSessionWithSpec();

    expect(await listTickets.run({ sessionId })).toEqual({
      tickets: [],
      ticketsCurrent: false,
      waves: [],
    });
  });

  it("orders tickets by number and resolves blockedBy to ticket numbers", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([
      ticketsTurn([
        { number: 2, slug: "second", blockedBy: [1] },
        { number: 1, slug: "first" },
      ]),
    ]);

    await breakIntoTickets.run({ sessionId });
    const { tickets, ticketsCurrent } = await listTickets.run({ sessionId });

    expect(tickets.map((ticket) => ticket.number)).toEqual([1, 2]);
    expect(tickets[0]?.blockedBy).toEqual([]);
    expect(tickets[1]?.blockedBy).toEqual([1]);
    expect(tickets.every((ticket) => ticket.status === "ready")).toBe(true);
    expect(ticketsCurrent).toBe(true);
  });

  it("exposes the wave order derived from blockedBy", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "one" },
        { number: 2, slug: "two", blockedBy: [1] },
        { number: 3, slug: "three", blockedBy: [1] },
        { number: 4, slug: "four", blockedBy: [2, 3] },
      ]),
    ]);

    await breakIntoTickets.run({ sessionId });
    const { waves } = await listTickets.run({ sessionId });

    expect(waves).toEqual([[1], [2, 3], [4]]);
  });

  it("returns identical waves across repeated calls", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([twoGoodTickets]);
    await breakIntoTickets.run({ sessionId });

    const first = await listTickets.run({ sessionId });
    const second = await listTickets.run({ sessionId });

    expect(first.waves).toEqual(second.waves);
    expect(first.waves).toEqual([[1], [2]]);
  });
});
