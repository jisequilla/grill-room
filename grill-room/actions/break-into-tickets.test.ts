import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  type BreakIntoTicketsRequest,
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { longChainTurns } from "../server/interviewer/fake.js";
import { buildPrompt } from "../server/interviewer/prompt.js";
import { type ProposedTicket, validateTicketSet } from "../server/tickets.js";
import { MAX_TURN_RETRIES } from "../server/turn.js";
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
async function aConfirmedSessionWithSpec(markdown: string = GOOD_SPEC_MARKDOWN): Promise<string> {
  const session = await aSession();
  await confirm(session.id);
  scriptInterviewer([{ kind: "synthesize-spec", result: { markdown } }]);
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
    kind?: "build" | "gate";
    waitsFor?: string | null;
    implements?: number[];
  }[],
): ScriptedTurn {
  return {
    kind: "break-into-tickets",
    result: {
      tickets: tickets.map((ticket) => ({
        title: `Ticket ${ticket.number}`,
        body: `Do the work of ticket ${ticket.number}.`,
        blockedBy: [],
        // GOOD_SPEC_MARKDOWN numbers one story: every build ticket builds it.
        implements: ticket.kind === "gate" ? [] : [1],
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

  type Row = {
    number: number;
    slug: string;
    body?: string;
    blockedBy?: number[];
    kind?: "build" | "gate";
    waitsFor?: string | null;
  };

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

  describe("gates", () => {
    const NAMES_IT = "Set up the runner so that `pnpm test` passes.";
    const ACCOUNT = "An account";
    const G4 =
      "Ticket 1 is a gate. This repository has no commits yet, so ticket 1 must be a build ticket that sets up the verify command.";
    const dependsOnFirst = (number: number) =>
      `Ticket ${number} does not depend on ticket 1. This repository has no commits yet and ticket 1 sets up the verify command, so every other ticket must list 1 in its \`blockedBy\`, directly or through another ticket's \`blockedBy\`.`;

    it.each<[string, Row[]]>([
      [
        "1 build names it; 2 gate, no blockedBy; 3 build ←[1, 2] (a gate need not reach ticket 1)",
        [
          { number: 1, slug: "one", body: NAMES_IT },
          { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT },
          { number: 3, slug: "three", blockedBy: [1, 2] },
        ],
      ],
      [
        "1 build names it; 2 gate ←[1]; 3 build ←[2] (3 reaches 1 through the gate)",
        [
          { number: 1, slug: "one", body: NAMES_IT },
          { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT, blockedBy: [1] },
          { number: 3, slug: "three", blockedBy: [2] },
        ],
      ],
    ])("accepts %s", async (_, rows) => {
      const sessionId = await aSessionInProject({ commit: false });
      const interviewer = scriptInterviewer([ticketsTurn(rows)]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests).toHaveLength(1);
    });

    it.each<[string, Row[], string]>([
      [
        "1 gate; 2 build ←[1]",
        [
          { number: 1, slug: "one", kind: "gate", waitsFor: ACCOUNT, body: NAMES_IT },
          { number: 2, slug: "two", blockedBy: [1] },
        ],
        G4,
      ],
      [
        "1 gate; 2 build ←[1]; 3 build, no blockedBy (G4, then the reach loop)",
        [
          { number: 1, slug: "one", kind: "gate", waitsFor: ACCOUNT },
          { number: 2, slug: "two", blockedBy: [1] },
          { number: 3, slug: "three" },
        ],
        `${G4} ${dependsOnFirst(3)}`,
      ],
      [
        "1 build names it; 2 gate; 3 build ←[2] (only 3 is refused)",
        [
          { number: 1, slug: "one", body: NAMES_IT },
          { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT },
          { number: 3, slug: "three", blockedBy: [2] },
        ],
        dependsOnFirst(3),
      ],
    ])("rejects %s, and asks again", async (_, rows, expected) => {
      const sessionId = await aSessionInProject({ commit: false });
      const interviewer = scriptInterviewer([ticketsTurn(rows), aGreenfieldSet("pnpm test")]);

      await breakIntoTickets.run({ sessionId });

      expect(interviewer.requests).toHaveLength(2);
      expect(rejectionOf(interviewer.requests[1])).toBe(expected);
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

describe("gates", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  type Row = Parameters<typeof ticketsTurn>[0][number];

  const ACCOUNT = "A live account on the payment platform, with API keys issued.";
  const G1 = (number: number) =>
    `Ticket ${number} is a gate, so its \`waitsFor\` must say in one line what it waits for.`;
  const G2 = (number: number) =>
    `Ticket ${number} is a build ticket, so its \`waitsFor\` must be null. Only a gate waits for something outside the code.`;
  const G3 = (number: number) =>
    `Ticket ${number} is a gate that no ticket lists in \`blockedBy\`. A gate exists to hold back the tickets that need it: list it in their \`blockedBy\`.`;

  function rejectionOf(request: unknown): string {
    return (request as BreakIntoTicketsRequest).rejectionReason ?? "";
  }

  it.each<[string, Row[]]>([
    [
      "1 build; 2 gate; 3 build ←[1, 2]",
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT },
        { number: 3, slug: "three", blockedBy: [1, 2] },
      ],
    ],
    [
      "1 build; 2 gate ←[1] (Part 1 is used); 3 build ←[2]",
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "gate", waitsFor: "Part 1 is used.", blockedBy: [1] },
        { number: 3, slug: "three", blockedBy: [2] },
      ],
    ],
    [
      "1 build; 2 gate; 3 gate ←[2]; 4 build ←[3] (a gate may block a gate)",
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT },
        { number: 3, slug: "three", kind: "gate", waitsFor: "The partner agreement is signed.", blockedBy: [2] },
        { number: 4, slug: "four", blockedBy: [3] },
      ],
    ],
    [
      "every ticket a build, no kind in the result",
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", blockedBy: [1] },
      ],
    ],
    [
      'a build with waitsFor ""',
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "build", waitsFor: "" },
      ],
    ],
    [
      'a build with waitsFor "  "',
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "build", waitsFor: "  " },
      ],
    ],
  ])("accepts %s", async (_, rows) => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer([ticketsTurn(rows)]);

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(1);
    expect(tickets.map((ticket) => ticket.number)).toEqual(rows.map((row) => row.number));
  });

  const gateAt3 = (waitsFor: string | null): Row[] => [
    { number: 1, slug: "one" },
    { number: 2, slug: "two" },
    { number: 3, slug: "three", kind: "gate", waitsFor },
    { number: 4, slug: "four", blockedBy: [3] },
  ];

  it.each<[string, Row[], string]>([
    ["G1: a gate whose waitsFor is null", gateAt3(null), G1(3)],
    ['G1: a gate whose waitsFor is ""', gateAt3(""), G1(3)],
    ['G1: a gate whose waitsFor is "  "', gateAt3("  "), G1(3)],
    ["G1: a gate whose waitsFor holds a line feed", gateAt3("An account\nand a card"), G1(3)],
    ["G1: a gate whose waitsFor holds a carriage return", gateAt3("An account\rand a card"), G1(3)],
    [
      'G2: a build whose waitsFor is "An account"',
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", kind: "build", waitsFor: "An account" },
      ],
      G2(2),
    ],
    [
      "G3: a gate no ticket lists in blockedBy",
      [
        { number: 1, slug: "one" },
        { number: 2, slug: "two", blockedBy: [1] },
        { number: 3, slug: "three", kind: "gate", waitsFor: ACCOUNT },
      ],
      G3(3),
    ],
    [
      "every gate rule at once, by rule and then by number",
      [
        { number: 1, slug: "one", kind: "gate", waitsFor: null },
        { number: 2, slug: "two", kind: "build", waitsFor: "An account" },
        { number: 3, slug: "three", kind: "gate", waitsFor: "" },
        { number: 4, slug: "four", kind: "build", waitsFor: "A card", blockedBy: [3] },
      ],
      [G1(1), G1(3), G2(2), G2(4), G3(1)].join(" "),
    ],
    [
      "a link error and a gate rule: the link reason first",
      [
        { number: 1, slug: "one", blockedBy: [9] },
        { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT },
      ],
      `Ticket 1 is blocked by 9, which is not a ticket number in this set. ${G3(2)}`,
    ],
    [
      "a cycle and a gate rule: the gate reason, and no cycle check",
      [
        { number: 1, slug: "one", blockedBy: [2] },
        { number: 2, slug: "two", blockedBy: [1] },
        { number: 3, slug: "three", kind: "gate", waitsFor: ACCOUNT },
      ],
      G3(3),
    ],
  ])("rejects %s, and asks again", async (_, rows, expected) => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer([ticketsTurn(rows), oneGoodTicket]);

    await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(2);
    expect(rejectionOf(interviewer.requests[1])).toBe(expected);
  });
});

describe("seam: gates shaped as the prompt describes pass the check", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  const repos = useTempGitRepos();

  async function aSessionInProject(commit: boolean): Promise<string> {
    const root = repos.create({ commit });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
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

  it.each([
    ["in a repository with commits", true],
    ["in a repository with no commits yet", false],
  ])("%s", async (_, commit) => {
    const sessionId = await aSessionInProject(commit);
    const first = scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "set-up", body: "Set up the runner so that `pnpm test` passes." },
      ]),
    ]);
    await breakIntoTickets.run({ sessionId });
    const prompt = buildPrompt(first.requests[0] as BreakIntoTicketsRequest);

    // Follow the paragraph's words: the kinds it names, a one-line
    // `waitsFor`, an external gate listed in the `blockedBy` of the ticket
    // that needs it, a spec gate listing the built work it waits for, and
    // every build ticket waiting for nothing.
    const gateKind = /with `kind` "([a-z]+)", a one-line `waitsFor`/.exec(prompt)?.[1];
    const buildKind = /Every other ticket has `kind`\n"([a-z]+)" and `waitsFor` null\./.exec(prompt)?.[1];
    expect(gateKind).toBe("gate");
    expect(buildKind).toBe("build");
    expect(prompt.includes("## This repository has no commits yet")).toBe(!commit);

    const shaped = ticketsTurn([
      {
        number: 1,
        slug: "set-up-the-workspace",
        body: "Set up the workspace and its test runner. Acceptance: `pnpm test` passes.",
        kind: buildKind as "build",
        waitsFor: null,
      },
      {
        number: 2,
        slug: "payment-account",
        body: "The owner opens the account; it is in place once API keys are issued.",
        kind: gateKind as "gate",
        waitsFor: "A live account on the payment platform, with API keys issued.",
      },
      {
        number: 3,
        slug: "take-payments",
        kind: buildKind as "build",
        waitsFor: null,
        blockedBy: [1, 2],
      },
      {
        number: 4,
        slug: "part-one-used",
        body: "The owner uses part one on one real export; it is in place once that export is reviewed.",
        kind: gateKind as "gate",
        waitsFor: "Part one used on one real export first.",
        blockedBy: [3],
      },
      {
        number: 5,
        slug: "part-two",
        kind: buildKind as "build",
        waitsFor: null,
        blockedBy: [4],
      },
    ]);
    const second = scriptInterviewer([shaped]);

    await breakIntoTickets.run({ sessionId });

    expect(second.requests).toHaveLength(1);
    expect(
      (await listTickets.run({ sessionId })).tickets.map((ticket) => [ticket.number, ticket.kind]),
    ).toEqual([
      [1, "build"],
      [2, "gate"],
      [3, "build"],
      [4, "gate"],
      [5, "build"],
    ]);
  });
});

describe("list-tickets", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("reports each ticket's kind and waitsFor", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "one", kind: "build", waitsFor: "  " },
        {
          number: 2,
          slug: "two",
          kind: "gate",
          waitsFor: "  A live account on the payment platform, with API keys issued.  ",
        },
        { number: 3, slug: "three", blockedBy: [1, 2] },
      ]),
    ]);

    await breakIntoTickets.run({ sessionId });
    const { tickets, waves } = await listTickets.run({ sessionId });

    expect(tickets.map((ticket) => [ticket.number, ticket.kind, ticket.waitsFor])).toEqual([
      [1, "build", null],
      [2, "gate", "A live account on the payment platform, with API keys issued."],
      [3, "build", null],
    ]);
    expect(waves).toEqual([[1, 2], [3]]);
  });

  it("reports each ticket's implements", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "one", implements: [1, 1] },
        { number: 2, slug: "two", implements: [] },
        { number: 3, slug: "three" },
      ]),
    ]);
    await breakIntoTickets.run({ sessionId });

    const listed = await listTickets.run({ sessionId });
    expect(listed.tickets.map((ticket) => [ticket.number, ticket.implements])).toEqual([
      [1, [1]],
      [2, []],
      [3, [1]],
    ]);

    await getDb()
      .update(schema.tickets)
      .set({ implementsJson: null })
      .where(eq(schema.tickets.id, listed.tickets[0]!.id));
    expect((await listTickets.run({ sessionId })).tickets.map((ticket) => ticket.implements)).toEqual([
      null,
      [],
      [1],
    ]);
  });

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

/** A spec that numbers user stories 1 to `count`. */
function aSpecWithStories(count: number): string {
  return GOOD_SPEC_MARKDOWN.replace(
    "1. As a user, I want a workspace, so that I can see what I am deciding.",
    Array.from({ length: count }, (_, index) => `${index + 1}. As a user, I want part ${index + 1}.`).join("\n"),
  );
}

const NO_STORIES_SPEC = GOOD_SPEC_MARKDOWN.replace(
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
  "- As a user, I want a workspace.",
);

describe("user stories", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  type Row = Parameters<typeof ticketsTurn>[0][number];

  const ALL = Array.from({ length: 62 }, (_, index) => index + 1);
  const ACCOUNT = "A live account on the payment platform, with API keys issued.";
  const SOFT_TAIL =
    "in no ticket's `implements`. Every user story must be implemented by at least one ticket: add its number to the ticket that builds it, or add a ticket for it.";

  function rejectionOf(request: unknown): string {
    return (request as BreakIntoTicketsRequest).rejectionReason ?? "";
  }

  /** Ticket 1 builds every story; ticket 2 is a gate ticket 3 waits for. */
  const covering = (overrides: { two?: Partial<Row>; three?: Partial<Row>; one?: Partial<Row> } = {}): Row[] => [
    { number: 1, slug: "one", implements: ALL, ...overrides.one },
    { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT, ...overrides.two },
    { number: 3, slug: "three", blockedBy: [2], implements: [], ...overrides.three },
  ];

  it("carries the spec's story numbers in the request", async () => {
    const withStory = await aConfirmedSessionWithSpec();
    const first = scriptInterviewer([oneGoodTicket]);
    await breakIntoTickets.run({ sessionId: withStory });
    expect(first.requests[0]).toMatchObject({ userStories: [1] });

    const without = await aConfirmedSessionWithSpec(NO_STORIES_SPEC);
    const second = scriptInterviewer([oneGoodTicket]);
    await breakIntoTickets.run({ sessionId: without });
    expect(second.requests[0]).toMatchObject({ userStories: [] });
  });

  it.each<[string, Row[], [number, number[]][]]>([
    [
      "a build ticket citing [4, 4], stored [4]",
      covering({ three: { implements: [4, 4] } }),
      [[1, ALL], [2, []], [3, [4]]],
    ],
    [
      "a build ticket citing no story",
      covering({ three: { implements: [] } }),
      [[1, ALL], [2, []], [3, []]],
    ],
  ])("accepts %s", async (_, rows, stored) => {
    const sessionId = await aConfirmedSessionWithSpec(aSpecWithStories(62));
    const interviewer = scriptInterviewer([ticketsTurn(rows)]);

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(1);
    expect(tickets.map((ticket) => [ticket.number, ticket.implements])).toEqual(stored);
  });

  it.each<[string, Row[], string]>([
    [
      "a build ticket citing story 70",
      covering({ three: { implements: [70] } }),
      "Ticket 3 implements user story 70, which the spec does not have. The spec's user stories are 1-62.",
    ],
    [
      "a build ticket citing stories 2, 63, 64 and 70",
      covering({ three: { implements: [2, 63, 64, 70] } }),
      "Ticket 3 implements user stories 63-64, 70, which the spec does not have. The spec's user stories are 1-62.",
    ],
    [
      "a gate citing story 5",
      covering({ two: { implements: [5] } }),
      "Ticket 2 is a gate, so it implements no user story. Leave its `implements` empty.",
    ],
    [
      "a gate citing story 70",
      covering({ two: { implements: [70] } }),
      "Ticket 2 is a gate, so it implements no user story. Leave its `implements` empty.",
    ],
    [
      "story 4 in no build ticket's implements",
      covering({ one: { implements: ALL.filter((n) => n !== 4) } }),
      `User story 4 is ${SOFT_TAIL}`,
    ],
    [
      "stories 4, 9, 10 and 11 in no build ticket's implements",
      covering({ one: { implements: ALL.filter((n) => ![4, 9, 10, 11].includes(n)) } }),
      `User stories 4, 9-11 are ${SOFT_TAIL}`,
    ],
    [
      "story 4 cited only by a gate",
      covering({ one: { implements: ALL.filter((n) => n !== 4) }, two: { implements: [4] } }),
      `Ticket 2 is a gate, so it implements no user story. Leave its \`implements\` empty. User story 4 is ${SOFT_TAIL}`,
    ],
  ])("rejects %s, and asks again", async (_, rows, expected) => {
    const sessionId = await aConfirmedSessionWithSpec(aSpecWithStories(62));
    const interviewer = scriptInterviewer([ticketsTurn(rows), ticketsTurn(covering())]);

    await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(2);
    expect(rejectionOf(interviewer.requests[1])).toBe(expected);
  });

  it("stores a ticket's implements deduplicated and ascending", async () => {
    const sessionId = await aConfirmedSessionWithSpec(aSpecWithStories(3));
    const interviewer = scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "one", implements: [3, 1, 3] },
        { number: 2, slug: "two", implements: [2] },
      ]),
    ]);

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(1);
    expect(tickets.map((ticket) => ticket.implements)).toEqual([[1, 3], [2]]);
  });

  it("puts the story reasons after the ticket set's own reasons", async () => {
    const sessionId = await aConfirmedSessionWithSpec(aSpecWithStories(62));
    const interviewer = scriptInterviewer([
      ticketsTurn(covering({ one: { blockedBy: [9], implements: [70] } })),
      ticketsTurn(covering()),
    ]);

    await breakIntoTickets.run({ sessionId });

    expect(rejectionOf(interviewer.requests[1])).toBe(
      `Ticket 1 is blocked by 9, which is not a ticket number in this set. Ticket 1 implements user story 70, which the spec does not have. The spec's user stories are 1-62. User stories 1-62 are ${SOFT_TAIL}`,
    );
  });

  it("accepts the last attempt with stories still uncovered, and notes it", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const uncovered = ticketsTurn([{ number: 1, slug: "one", implements: [] }]);
    const interviewer = scriptInterviewer(
      Array.from({ length: MAX_TURN_RETRIES + 1 }, () => uncovered),
    );

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(MAX_TURN_RETRIES + 1);
    expect(tickets.map((ticket) => [ticket.slug, ticket.implements])).toEqual([["one", []]]);
    const turn = await findLatestTurn({ sessionId, turnKind: "break-into-tickets" });
    expect(turn?.outcome).toBe("succeeded");
    const attempts = turn!.runs[0]!.attempts;
    expect(attempts.map((attempt) => attempt.kind)).toEqual([
      "tree-rule-refusal",
      "tree-rule-refusal",
      "success",
    ]);
    expect(attempts[attempts.length - 1]).toMatchObject({
      kind: "success",
      reason: "Accepted after the last retry, with user story 1 in no ticket's implements.",
    });
  });

  it("notes several stories still uncovered on the last attempt as ranges", async () => {
    const sessionId = await aConfirmedSessionWithSpec(aSpecWithStories(11));
    const uncovered = ticketsTurn([
      { number: 1, slug: "one", implements: [1, 2, 3, 5, 6, 7, 8] },
    ]);
    scriptInterviewer(Array.from({ length: MAX_TURN_RETRIES + 1 }, () => uncovered));

    await breakIntoTickets.run({ sessionId });

    const turn = await findLatestTurn({ sessionId, turnKind: "break-into-tickets" });
    const attempts = turn!.runs[0]!.attempts;
    expect(attempts[attempts.length - 1]).toMatchObject({
      kind: "success",
      reason: "Accepted after the last retry, with user stories 4, 9-11 in no ticket's implements.",
    });
  });

  it("still refuses a wrong citation on the last attempt", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const wrong = ticketsTurn([{ number: 1, slug: "one", implements: [1, 70] }]);
    const interviewer = scriptInterviewer(
      Array.from({ length: MAX_TURN_RETRIES + 1 }, () => wrong),
    );

    await expect(breakIntoTickets.run({ sessionId })).rejects.toThrow(
      /does not validate 3 times\. Last reason: Ticket 1 implements user story 70, which the spec does not have\. The spec's user stories are 1\.$/,
    );

    expect(interviewer.requests).toHaveLength(MAX_TURN_RETRIES + 1);
    expect((await listTickets.run({ sessionId })).tickets).toEqual([]);
    expect(await getSession.run({ id: sessionId })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-tickets",
    });
  });

  it("a spec with no numbered stories skips the check and stores implements empty", async () => {
    const sessionId = await aConfirmedSessionWithSpec(NO_STORIES_SPEC);
    const interviewer = scriptInterviewer([
      ticketsTurn([
        { number: 1, slug: "one", implements: [70, 3] },
        { number: 2, slug: "two", kind: "gate", waitsFor: ACCOUNT, implements: [5] },
        { number: 3, slug: "three", blockedBy: [2], implements: [] },
      ]),
    ]);

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(1);
    expect(tickets.map((ticket) => ticket.implements)).toEqual([[], [], []]);
    const prompt = buildPrompt(interviewer.requests[0] as BreakIntoTicketsRequest);
    expect(prompt).not.toContain("## User stories");
    expect(prompt).not.toContain("implements");
  });
});

describe("seam: a set shaped as the user stories section describes passes the check", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  const repos = useTempGitRepos();

  it.each([
    ["in a repository with commits", true],
    ["in a repository with no commits yet", false],
  ])("%s", async (_, commit) => {
    const root = repos.create({ commit });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    await confirm(session.id);
    scriptInterviewer([{ kind: "synthesize-spec", result: { markdown: aSpecWithStories(3) } }]);
    await synthesizeSpec.run({ sessionId: session.id });
    const sessionId = session.id;

    const first = scriptInterviewer([
      ticketsTurn([
        {
          number: 1,
          slug: "set-up",
          body: "Set up the runner so that `pnpm test` passes.",
          implements: [1, 2, 3],
        },
      ]),
    ]);
    await breakIntoTickets.run({ sessionId });
    const prompt = buildPrompt(first.requests[0] as BreakIntoTicketsRequest);

    // Read the numbers the section names, then follow its words: a setup
    // ticket and a gate cite nothing, and every story is in some build
    // ticket's `implements`.
    const listed = /^The spec numbers its user stories: (.*)\.$/m.exec(prompt)?.[1];
    expect(listed).toBeDefined();
    const stories = listed!.split(", ").flatMap((piece) => {
      const [from, to] = piece.split("-").map(Number);
      return Array.from({ length: (to ?? from!) - from! + 1 }, (_, index) => from! + index);
    });
    expect(stories).toEqual([1, 2, 3]);
    expect(prompt.includes("## This repository has no commits yet")).toBe(!commit);

    const shaped = ticketsTurn([
      {
        number: 1,
        slug: "set-up-the-project",
        body: "Set up the project and its test runner. Acceptance: `pnpm test` passes.",
        implements: [],
      },
      { number: 2, slug: "build-the-workspace", blockedBy: [1], implements: stories.slice(0, 2) },
      { number: 3, slug: "store-on-disk", blockedBy: [1, 4], implements: stories.slice(2) },
      {
        number: 4,
        slug: "payment-account",
        body: "The owner opens the account; it is in place once API keys are issued.",
        kind: "gate",
        waitsFor: "A live account on the payment platform, with API keys issued.",
        implements: [],
      },
    ]);
    const second = scriptInterviewer([shaped]);

    await breakIntoTickets.run({ sessionId });

    expect(second.requests).toHaveLength(1);
    expect(
      (await listTickets.run({ sessionId })).tickets.map((ticket) => [ticket.number, ticket.implements]),
    ).toEqual([
      [1, []],
      [2, [1, 2]],
      [3, [3]],
      [4, []],
    ]);
  });
});

describe("the longest chain", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  type Row = Parameters<typeof ticketsTurn>[0][number];

  function rejectionOf(request: unknown): string {
    return (request as BreakIntoTicketsRequest).rejectionReason ?? "";
  }

  const SLUGS = ["one", "two", "three", "four", "five", "six"];
  /** Six build tickets, each waiting for `blockedBy(number)`. */
  const six = (blockedBy: (number: number) => number[]): Row[] =>
    SLUGS.map((slug, index) => ({ number: index + 1, slug, blockedBy: blockedBy(index + 1) }));

  const LONG = six((number) => (number === 1 ? [] : [number - 1]));
  const FLAT = six((number) => (number === 1 ? [] : [1]));
  const LONG_WITH_H = six((number) => (number === 1 ? [9] : [number - 1]));
  const FLAT_WITH_H = six((number) => (number === 1 ? [9] : [1]));
  const CYCLE = six((number) => (number === 1 ? [6] : [number - 1]));

  const H = "Ticket 1 is blocked by 9, which is not a ticket number in this set.";
  const CHAIN =
    "The longest chain of tickets that must be built one after another is 6 build tickets (1 → 2 → 3 → 4 → 5 → 6), in a set of 6 build tickets; keep it to 4 or fewer. List a ticket in `blockedBy` only when it uses that ticket's output, and give a file that many tickets change its own early ticket, so more tickets can be built side by side.";
  const NOTE =
    "Accepted with the longest chain at 6 build tickets (1 → 2 → 3 → 4 → 5 → 6), over the limit of 4 for a set of 6 build tickets.";

  it.each<[string, Row[][], string[], Row[], string | null]>([
    ["1: L (refused with the chain reason; 2 is asked)", [LONG, FLAT], [CHAIN], FLAT, null],
    ["1: L; 2: L", [LONG, LONG], [CHAIN], LONG, NOTE],
    ["1: L; 2: flat", [LONG, FLAT], [CHAIN], FLAT, null],
    ["1: H and L", [LONG_WITH_H, FLAT], [`${H} ${CHAIN}`], FLAT, null],
    ["1: H and L; 2: H and L", [LONG_WITH_H, LONG_WITH_H, FLAT], [`${H} ${CHAIN}`, H], FLAT, null],
    ["1: H; 2: L; 3: L", [FLAT_WITH_H, LONG, LONG], [H, CHAIN], LONG, NOTE],
    [
      "1: H, short chain; 2: H, short chain; 3: no H, L for the first time",
      [FLAT_WITH_H, FLAT_WITH_H, LONG],
      [H, H],
      LONG,
      NOTE,
    ],
    ["1: flat", [FLAT], [], FLAT, null],
  ])("%s", async (_, attempts, rejections, stored, note) => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer(attempts.map((rows) => ticketsTurn(rows)));

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(attempts.length);
    expect(interviewer.requests.slice(1).map(rejectionOf)).toEqual(rejections);
    expect(tickets.map((ticket) => ticket.blockedBy)).toEqual(stored.map((row) => row.blockedBy));
    const turn = await findLatestTurn({ sessionId, turnKind: "break-into-tickets" });
    const recorded = turn!.runs[0]!.attempts;
    const last = recorded[recorded.length - 1]!;
    expect(last.kind).toBe("success");
    if (note === null) {
      expect(String(last.reason ?? "")).not.toContain("longest chain");
    } else {
      expect(last.reason).toBe(note);
    }
  });

  it("a cycle: refused as today, and the chain check adds nothing", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer([ticketsTurn(CYCLE), ticketsTurn(FLAT)]);
    const expected = validateTicketSet(
      (ticketsTurn(CYCLE) as { result: { tickets: ProposedTicket[] } }).result.tickets,
      null,
    ).reasons.join(" ");

    await breakIntoTickets.run({ sessionId });

    expect(expected).toMatch(/cycle/);
    expect(rejectionOf(interviewer.requests[1])).toBe(expected);
  });

  it("notes uncovered stories and a long chain in one note", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const uncoveredLong = ticketsTurn(LONG.map((row) => ({ ...row, implements: [] })));
    scriptInterviewer(Array.from({ length: MAX_TURN_RETRIES + 1 }, () => uncoveredLong));

    await breakIntoTickets.run({ sessionId });

    const turn = await findLatestTurn({ sessionId, turnKind: "break-into-tickets" });
    const attempts = turn!.runs[0]!.attempts;
    expect(attempts[attempts.length - 1]).toMatchObject({
      kind: "success",
      reason: `Accepted after the last retry, with user story 1 in no ticket's implements. ${NOTE}`,
    });
  });

  it("the long-chain scenario is sent back once and its flatter retry is stored", async () => {
    const sessionId = await aConfirmedSessionWithSpec();
    const interviewer = scriptInterviewer(longChainTurns().slice(-2));

    const result = await breakIntoTickets.run({ sessionId });

    expect(interviewer.requests).toHaveLength(2);
    expect(rejectionOf(interviewer.requests[1])).toBe(CHAIN);
    expect(result.tickets.map((ticket) => [ticket.number, ticket.slug, ticket.blockedBy])).toEqual([
      [1, "build-the-workspace", []],
      [2, "store-on-disk", [1]],
      [3, "list-items", [2]],
      [4, "edit-items", [2]],
      [5, "delete-items", [2]],
      [6, "export-items", [2]],
    ]);
    expect(result.waves).toEqual([[1], [2], [3, 4, 5, 6]]);
  });
});

describe("seam: a set shaped as the chain paragraph describes is accepted at once", () => {
  useTestDatabase();
  afterEach(resetInterviewer);
  const repos = useTempGitRepos();

  const CHAIN_PARAGRAPH = [
    "Keep chains of `blockedBy` short, so that tickets can be built side by side.",
    "List a ticket in another's `blockedBy` only when that ticket uses its output:",
    "code it calls, a file it creates, a table it reads. Build order alone is not",
    "a reason, and neither is testing: each ticket writes its own tests, as above,",
    "so no ticket waits for a tests-only ticket. When many tickets would change",
    "the same file, such as a shared schema, a route table or a registration list,",
    "make that change its own early ticket that the others list in `blockedBy`,",
    "rather than chaining them one after another through that file.",
  ].join("\n");

  it.each([
    ["with commits, no stories, no gate", true, false, false],
    ["greenfield, stories, gate", false, true, true],
    ["with commits, stories, gate", true, true, true],
    ["greenfield, no stories, no gate", false, false, false],
  ])("%s", async (_, commit, withStories, withGate) => {
    const root = repos.create({ commit });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    await confirm(session.id);
    scriptInterviewer([
      {
        kind: "synthesize-spec",
        result: { markdown: withStories ? aSpecWithStories(3) : NO_STORIES_SPEC },
      },
    ]);
    await synthesizeSpec.run({ sessionId: session.id });
    const sessionId = session.id;

    // A first breakdown only to read the prompt the action sends.
    const first = scriptInterviewer([
      ticketsTurn([
        {
          number: 1,
          slug: "set-up",
          body: "Set up the runner so that `pnpm test` passes.",
          implements: withStories ? [1, 2, 3] : [],
        },
      ]),
    ]);
    await breakIntoTickets.run({ sessionId });
    const prompt = buildPrompt(first.requests[0] as BreakIntoTicketsRequest);
    expect(prompt).toContain(CHAIN_PARAGRAPH);
    expect(prompt.includes("## This repository has no commits yet")).toBe(!commit);
    const listed = /^The spec numbers its user stories: (.*)\.$/m.exec(prompt)?.[1];
    expect(listed).toBe(withStories ? "1-3" : undefined);
    const stories = withStories ? [1, 2, 3] : [];

    // Following the paragraph: the shared file is its own early ticket that
    // the others list, a ticket lists another only because it uses its
    // output, and a gate is listed by the ticket that needs it.
    const shaped = ticketsTurn([
      {
        number: 1,
        slug: "shared-schema",
        body: commit
          ? "Add the shared schema every other ticket reads."
          : "Set up the project and its test runner, and the shared schema. Acceptance: `pnpm test` passes.",
        implements: [],
      },
      { number: 2, slug: "store-items", blockedBy: [1], implements: stories },
      { number: 3, slug: "list-items", blockedBy: [1], implements: [] },
      { number: 4, slug: "edit-items", blockedBy: [1], implements: [] },
      { number: 5, slug: "delete-items", blockedBy: [1], implements: [] },
      {
        number: 6,
        slug: "export-items",
        body: "Export the items, calling the store ticket 2 builds.",
        blockedBy: withGate ? [2, 7] : [2],
        implements: [],
      },
      ...(withGate
        ? [
            {
              number: 7,
              slug: "export-account",
              body: "The owner opens the account; it is in place once API keys are issued.",
              kind: "gate" as const,
              waitsFor: "A live account on the export service, with API keys issued.",
              implements: [],
            },
          ]
        : []),
    ]);
    const second = scriptInterviewer([shaped]);

    const { tickets } = await breakIntoTickets.run({ sessionId });

    expect(second.requests).toHaveLength(1);
    expect(tickets).toHaveLength(withGate ? 7 : 6);
  });
});
