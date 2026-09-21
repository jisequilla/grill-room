import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  CLEARED_ENVIRONMENT_MARKERS,
  createClaudeCliInterviewer,
  type CliInvocation,
  type CliOutcome,
} from "./claude-cli.js";
import { loadGrillingSkill } from "./instructions.js";
import { jsonSchemaFor } from "./schemas.js";
import {
  aProposeRoundRequest,
  aProposeRoundResult,
} from "./test-fixtures.js";

/**
 * The contract test for the real adapter. The command line is never invoked:
 * the runner that wraps `child_process.spawn` is injected, and these tests
 * assert on exactly what the adapter would have spawned and on how it reads
 * what came back.
 */

/** A well-formed envelope, as the command line's `--output-format json` returns. */
function anEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    structured_output: aProposeRoundResult(),
    session_id: "65f74ae9-6681-4ca7-89c9-efc3c8821877",
    is_error: false,
    ...overrides,
  });
}

function ok(stdout: string): CliOutcome {
  return { stdout, stderr: "", exitCode: 0 };
}

/** Records every invocation and replies with the queued outcomes in order. */
function recordingRunner(outcomes: CliOutcome[]) {
  const invocations: CliInvocation[] = [];
  return {
    invocations,
    runCli: (invocation: CliInvocation) => {
      invocations.push(invocation);
      const next = outcomes.shift();
      if (!next) throw new Error("No outcome queued for this invocation.");
      return Promise.resolve(next);
    },
  };
}

/** Reads the value that follows a flag in the argument list. */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("what the adapter sends to the command line", () => {
  it("disables every tool, names the model, and constrains the output", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);
    const interviewer = createClaudeCliInterviewer({ runCli: runner.runCli });

    await interviewer.proposeRound(
      aProposeRoundRequest({
        context: { ...aProposeRoundRequest().context, model: "fable" },
      }),
    );

    const [invocation] = runner.invocations;
    expect(invocation.command).toBe("claude");
    expect(valueOf(invocation.args, "--allowed-tools")).toBe("");
    expect(valueOf(invocation.args, "--model")).toBe("fable");
    expect(valueOf(invocation.args, "--output-format")).toBe("json");
    expect(
      JSON.parse(valueOf(invocation.args, "--json-schema") as string),
    ).toEqual(jsonSchemaFor("propose-round"));
  });

  it("sends the prompt, carrying the grilling skill verbatim", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest(),
    );

    const prompt = valueOf(runner.invocations[0].args, "-p") as string;
    expect(prompt).toContain(loadGrillingSkill().trimEnd());
  });

  it("passes the conversation id to resume when the session has one", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest({
        context: {
          ...aProposeRoundRequest().context,
          conversationId: "session-7",
        },
      }),
    );

    expect(valueOf(runner.invocations[0].args, "--resume")).toBe("session-7");
  });

  it("omits the resume flag entirely on a first turn", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest(),
    );

    expect(runner.invocations[0].args).not.toContain("--resume");
  });

  it("clears the nested-session markers from the child's environment", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      env: {
        PATH: "/usr/bin",
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
      },
    }).proposeRound(aProposeRoundRequest());

    const { env } = runner.invocations[0];
    for (const marker of CLEARED_ENVIRONMENT_MARKERS) {
      expect(env).not.toHaveProperty(marker);
    }
    expect(env.PATH).toBe("/usr/bin");
  });

  it("runs from a neutral directory that has no project configuration", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest(),
    );

    expect(runner.invocations[0].cwd).toBe(tmpdir());
  });
});

describe("what the adapter makes of what came back", () => {
  it("returns the validated result and the conversation id to store", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).proposeRound(aProposeRoundRequest());

    expect(turn.result).toEqual(aProposeRoundResult());
    expect(turn.conversationId).toBe("65f74ae9-6681-4ca7-89c9-efc3c8821877");
  });

  it("rejects structured output that does not match the schema", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: { proposedDecisions: "not a list" } })),
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("rejects output that is not JSON at all", async () => {
    const runner = recordingRunner([ok("Sure! Here is your round:")]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("rejects an envelope with no conversation id", async () => {
    const runner = recordingRunner([ok(anEnvelope({ session_id: "" }))]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("turns a non-zero exit into a typed failure", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "something went wrong", exitCode: 1 },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({
      name: "InterviewerError",
      code: "failed",
      detail: expect.stringContaining("something went wrong"),
    });
  });

  it("turns an is_error envelope into a typed failure", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ is_error: true, result: "the turn failed" })),
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "failed" });
  });
});

describe("telling failures apart", () => {
  it("reports a missing command line distinctly", async () => {
    const enoent: NodeJS.ErrnoException = new Error("spawn claude ENOENT");
    enoent.code = "ENOENT";
    const runner = recordingRunner([
      { stdout: "", stderr: "", exitCode: null, spawnError: enoent },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "cli-missing" });
  });

  it("reports a logged-out command line distinctly", async () => {
    const runner = recordingRunner([
      {
        stdout: "",
        stderr: "Invalid API key · Please run /login",
        exitCode: 1,
      },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "not-logged-in" });
  });

  it("reports a rate limit distinctly, so it is never read as a defect", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "Claude usage limit reached", exitCode: 1 },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
      ),
    ).rejects.toMatchObject({ code: "rate-limited" });
  });
});

describe("when a conversation cannot be resumed", () => {
  const resumingRequest = aProposeRoundRequest({
    context: {
      ...aProposeRoundRequest().context,
      conversationId: "gone-7",
      decisions: [
        {
          key: "shape",
          title: "What shape?",
          body: "Body.",
          choices: [],
          recommendedAnswer: "A workspace",
          dependsOn: [],
          state: "settled",
          answer: { kind: "own-answer", text: "A workspace, but narrower" },
          previousAnswers: [],
          introducedBy: "interviewer",
        },
      ],
    },
  });

  it("starts one fresh conversation primed with the decision history", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "No conversation found with session ID", exitCode: 1 },
      ok(anEnvelope({ session_id: "fresh-9" })),
    ]);

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).proposeRound(resumingRequest);

    expect(runner.invocations).toHaveLength(2);
    expect(valueOf(runner.invocations[0].args, "--resume")).toBe("gone-7");
    expect(runner.invocations[1].args).not.toContain("--resume");

    const primedPrompt = valueOf(runner.invocations[1].args, "-p") as string;
    expect(primedPrompt).toContain("could not be resumed");
    expect(primedPrompt).toContain("A workspace, but narrower");
    expect(turn.conversationId).toBe("fresh-9");
  });

  it("does not retry a second time when the fresh attempt also fails", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "gone", exitCode: 1 },
      { stdout: "", stderr: "still gone", exitCode: 1 },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        resumingRequest,
      ),
    ).rejects.toMatchObject({ code: "failed" });
    expect(runner.invocations).toHaveLength(2);
  });

  it("does not retry a rate limit, which a fresh conversation cannot fix", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "Claude usage limit reached", exitCode: 1 },
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        resumingRequest,
      ),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(runner.invocations).toHaveLength(1);
  });
});
