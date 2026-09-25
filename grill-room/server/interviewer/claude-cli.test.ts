import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLEARED_ENVIRONMENT_MARKERS,
  createClaudeCliInterviewer,
  DOCS_MODE_TOOLS,
  RECORD_TURNS_ENV_VAR,
  SCOUT_DENY_RULES,
  type CliInvocation,
  type CliOutcome,
} from "./claude-cli.js";
import { DOCS_FOLDER_ADDENDUM, loadGrillingSkill } from "./instructions.js";
import { jsonSchemaFor } from "./schemas.js";
import { SCOUT_MODEL } from "./types.js";
import type { ModelCallEnd, ModelCallObserver } from "./types.js";
import {
  anAssessReadinessRequest,
  anAssessReadinessResult,
  aFindSupersededRequest,
  aFindSupersededResult,
  aHandoffScoutRequest,
  aHandoffScoutResult,
  aProposeRoundRequest,
  aProposeRoundResult,
  aScoutProjectRequest,
  aScoutProjectResult,
  someProjectServerFacts,
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

  it("sends exactly this argument list when there is no docs folder", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);
    const request = aProposeRoundRequest();

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      request,
    );

    const { args } = runner.invocations[0];
    expect(args).toEqual([
      "-p",
      valueOf(args, "-p"),
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--allowed-tools",
      "",
      "--json-schema",
      JSON.stringify(jsonSchemaFor("propose-round")),
    ]);
  });
});

/**
 * The docs-folder turn is the one place the app points the model at the user's
 * own filesystem. These assertions are the security contract: what it may use,
 * where it may use it, and what it can never reach.
 */
describe("what the adapter sends for a readiness judgment", () => {
  it("constrains the output to the readiness schema, with every tool disabled", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: anAssessReadinessResult() })),
    ]);

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).assessReadiness(anAssessReadinessRequest());

    const { args } = runner.invocations[0];
    expect(valueOf(args, "--allowed-tools")).toBe("");
    expect(JSON.parse(valueOf(args, "--json-schema") as string)).toEqual(
      jsonSchemaFor("assess-readiness"),
    );
    expect(turn.result).toEqual(anAssessReadinessResult());
  });

  it("asks for a judgment of the idea, without the grilling method", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: anAssessReadinessResult() })),
    ]);
    const request = anAssessReadinessRequest();

    await createClaudeCliInterviewer({ runCli: runner.runCli }).assessReadiness(
      request,
    );

    const prompt = valueOf(runner.invocations[0].args, "-p") as string;
    expect(prompt).toContain(request.context.idea);
    expect(prompt).toContain("judge whether the idea is ready to grill");
    expect(prompt).not.toContain(loadGrillingSkill().trimEnd());
  });
});

describe("what the adapter sends when the session has a docs folder", () => {
  const DOCS_FOLDER = "/Users/someone/projects/observability";

  function aDocsRequest() {
    const base = aProposeRoundRequest();
    return aProposeRoundRequest({
      context: { ...base.context, docsFolder: DOCS_FOLDER },
    });
  }

  async function invocationWithDocsFolder() {
    const runner = recordingRunner([ok(anEnvelope())]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aDocsRequest(),
    );
    return runner.invocations[0];
  }

  it("runs the turn from the docs folder itself", async () => {
    expect((await invocationWithDocsFolder()).cwd).toBe(DOCS_FOLDER);
  });

  it("allows exactly the three read tools, and makes them the whole tool set", async () => {
    const { args } = await invocationWithDocsFolder();

    expect(DOCS_MODE_TOOLS).toEqual(["Read", "Grep", "Glob"]);
    expect(valueOf(args, "--tools")).toBe("Read,Grep,Glob");
    expect(valueOf(args, "--allowed-tools")).toBe("Read,Grep,Glob");
  });

  it("names no tool that writes, runs a command, or reaches the network", async () => {
    const { args } = await invocationWithDocsFolder();

    const named = [valueOf(args, "--tools"), valueOf(args, "--allowed-tools")]
      .join(",")
      .split(",");
    for (const forbidden of [
      "Bash",
      "Write",
      "Edit",
      "NotebookEdit",
      "WebFetch",
      "WebSearch",
      "Agent",
      "Task",
    ]) {
      expect(named).not.toContain(forbidden);
    }
  });

  it("scopes the file tools to that one directory, and to nothing else", async () => {
    const { args } = await invocationWithDocsFolder();

    // `--add-dir` alone widens; `--restricted` is what confines the file tools
    // to the working directories, this one included.
    expect(valueOf(args, "--add-dir")).toBe(DOCS_FOLDER);
    expect(args).toContain("--restricted");
    expect(args.filter((arg) => arg === "--add-dir")).toHaveLength(1);
  });

  it("honours nothing the folder itself configures", async () => {
    const { args } = await invocationWithDocsFolder();

    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
  });

  it("denies anything that would prompt rather than waiting or granting it", async () => {
    const { args } = await invocationWithDocsFolder();

    expect(valueOf(args, "--permission-prompts")).toBe("none");
    expect(args).not.toContain("--permission-mode");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allow-dangerously-skip-permissions");
  });

  it("tells the interviewer how to use the folder", async () => {
    const { args } = await invocationWithDocsFolder();
    const prompt = valueOf(args, "-p") as string;

    expect(prompt).toContain(DOCS_FOLDER_ADDENDUM);
    expect(prompt).toContain(DOCS_FOLDER);
  });

  it("still clears the nested-session markers from the child's environment", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      env: { PATH: "/usr/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" },
    }).proposeRound(aDocsRequest());

    const { env } = runner.invocations[0];
    for (const marker of CLEARED_ENVIRONMENT_MARKERS) {
      expect(env).not.toHaveProperty(marker);
    }
  });

  it("still resumes the conversation the session is carrying", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);
    const base = aProposeRoundRequest();

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest({
        context: {
          ...base.context,
          docsFolder: DOCS_FOLDER,
          conversationId: "session-7",
        },
      }),
    );

    expect(valueOf(runner.invocations[0].args, "--resume")).toBe("session-7");
  });
});

/**
 * The scout is the one turn pointed at a whole project, secrets and all. These
 * assertions are its security contract: sonnet, a conversation of its own, the
 * project root and nothing else, read-only, and the secret files denied.
 */
describe("what the adapter sends for a project scout", () => {
  const PROJECT_ROOT = "/Users/someone/projects/observability";

  async function scoutInvocation(
    request = aScoutProjectRequest({ projectRoot: PROJECT_ROOT }),
  ) {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aScoutProjectResult() })),
    ]);
    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).scoutProject(request);
    return { invocation: runner.invocations[0], turn, runner };
  }

  it("runs on sonnet whatever model the session interviews on", async () => {
    for (const model of ["fable", "opus", "sonnet"] as const) {
      const base = aScoutProjectRequest({ projectRoot: PROJECT_ROOT });
      const { invocation } = await scoutInvocation({
        ...base,
        context: { ...base.context, model },
      });
      expect(SCOUT_MODEL).toBe("sonnet");
      expect(valueOf(invocation.args, "--model")).toBe("sonnet");
    }
  });

  it("runs in a conversation of its own, never resuming the session's", async () => {
    const base = aScoutProjectRequest({ projectRoot: PROJECT_ROOT });
    const { invocation } = await scoutInvocation({
      ...base,
      context: { ...base.context, conversationId: "session-7" },
    });

    expect(invocation.args).not.toContain("--resume");
  });

  it("runs from the project root, its only added directory, even when the session has a docs folder", async () => {
    const base = aScoutProjectRequest({ projectRoot: PROJECT_ROOT });
    const { invocation } = await scoutInvocation({
      ...base,
      context: { ...base.context, docsFolder: "/Users/someone/notes" },
    });

    expect(invocation.cwd).toBe(PROJECT_ROOT);
    expect(invocation.args.filter((arg) => arg === "--add-dir")).toHaveLength(1);
    expect(valueOf(invocation.args, "--add-dir")).toBe(PROJECT_ROOT);
    expect(invocation.args).not.toContain("/Users/someone/notes");
  });

  it("allows exactly the three read tools, and makes them the whole tool set", async () => {
    const { invocation } = await scoutInvocation();

    expect(valueOf(invocation.args, "--tools")).toBe("Read,Grep,Glob");
    expect(valueOf(invocation.args, "--allowed-tools")).toBe("Read,Grep,Glob");
  });

  it("applies every restriction docs mode applies", async () => {
    const { invocation } = await scoutInvocation();
    const { args } = invocation;

    expect(args).toContain("--restricted");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(valueOf(args, "--permission-prompts")).toBe("none");
    expect(args).not.toContain("--permission-mode");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allow-dangerously-skip-permissions");
  });

  it("denies reading environment files, keys, certificates and credentials", async () => {
    const { invocation } = await scoutInvocation();
    const denied = (valueOf(invocation.args, "--disallowed-tools") ?? "").split(
      ",",
    );

    expect(invocation.args.filter((arg) => arg === "--disallowed-tools")).toHaveLength(1);
    expect(denied).toEqual(SCOUT_DENY_RULES);
    for (const rule of [
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/id_rsa*)",
      "Read(**/credentials)",
      "Read(**/credentials.*)",
      "Read(**/.git/**)",
    ]) {
      expect(denied).toContain(rule);
    }
  });

  it("tells the scout that a file missing from Glob or Grep may only be hidden", async () => {
    const { invocation } = await scoutInvocation();
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("hidden from you on purpose");
    expect(prompt).toContain(
      "never evidence that it does not",
    );
  });

  it("tells the scout an inferred decision may not claim exclusivity from one citation", async () => {
    const { invocation } = await scoutInvocation();
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("one cited line cannot show an absence");
  });

  it("sends exactly this argument list", async () => {
    const { invocation } = await scoutInvocation();
    const { args } = invocation;

    expect(args).toEqual([
      "-p",
      valueOf(args, "-p"),
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--allowed-tools",
      "Read,Grep,Glob",
      "--json-schema",
      JSON.stringify(jsonSchemaFor("scout-project")),
      "--tools",
      "Read,Grep,Glob",
      "--add-dir",
      PROJECT_ROOT,
      "--restricted",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--permission-prompts",
      "none",
      "--disallowed-tools",
      SCOUT_DENY_RULES.join(","),
    ]);
  });

  it("asks for a scout report of the idea, with the facts, without the grilling method", async () => {
    const request = aScoutProjectRequest({ projectRoot: PROJECT_ROOT });
    const { invocation } = await scoutInvocation(request);
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain(request.context.idea);
    expect(prompt).toContain(PROJECT_ROOT);
    expect(prompt).toContain(String(request.facts.headCommit));
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("Record the broker decision");
    expect(prompt).toContain("docs/adr");
    expect(prompt).toContain("Never invent a path");
    expect(prompt).toContain("`recorded`");
    expect(prompt).toContain("`inferred`");
    expect(prompt).toContain("return an empty list");
    expect(prompt).not.toContain(loadGrillingSkill().trimEnd());
    expect(prompt.startsWith("-")).toBe(false);
  });

  it("lists the facts' decisionFiles as recorded decision sources", async () => {
    const request = aScoutProjectRequest({
      projectRoot: PROJECT_ROOT,
      facts: someProjectServerFacts({
        decisionFiles: ["docs/decisions.md", "packages/api/decisions.md"],
      }),
    });
    const { invocation } = await scoutInvocation(request);
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("Recorded decision files (decisions.md)");
    expect(prompt).toContain("docs/decisions.md");
    expect(prompt).toContain("packages/api/decisions.md");
  });

  it("says there are none when the facts' decisionFiles list is empty", async () => {
    const request = aScoutProjectRequest({
      projectRoot: PROJECT_ROOT,
      facts: someProjectServerFacts({ decisionFiles: [] }),
    });
    const { invocation } = await scoutInvocation(request);
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("Recorded decision files (decisions.md)");
    expect(prompt).toContain("(none)");
  });

  it("states the Supersedes rule", async () => {
    const { invocation } = await scoutInvocation();
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("Supersedes line overrides the source");
    expect(prompt).toContain("not the statement it supersedes");
  });

  it("on a re-run, asks for a verdict on every previous decision by key", async () => {
    const request = aScoutProjectRequest({
      projectRoot: PROJECT_ROOT,
      previousDecisions: [
        {
          key: "no-message-broker",
          title: "No message broker",
          statement: "Ingest runs on a Postgres-backed queue.",
          source: "recorded",
          citation: "docs/adr/0003-queue.md:5-9",
          disposition: "kept",
        },
      ],
    });
    const { invocation } = await scoutInvocation(request);
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).toContain("[no-message-broker]");
    expect(prompt).toContain("kept by the user");
    expect(prompt).toContain("exactly one entry for every one of them");
  });

  it("passes the rejection reason back on a retry", async () => {
    const { invocation } = await scoutInvocation(
      aScoutProjectRequest({
        rejectionReason: "src/missing.ts:4 does not exist at the commit read.",
      }),
    );

    expect(valueOf(invocation.args, "-p")).toContain(
      "src/missing.ts:4 does not exist at the commit read.",
    );
  });

  it("returns the validated report and reports its one call as new", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aScoutProjectResult() })),
    ]);
    const calls: ModelCallEnd[] = [];

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).scoutProject(aScoutProjectRequest(), {
      callEnded: (call) => void calls.push(call),
    });

    expect(turn.result).toEqual(aScoutProjectResult());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      requestKind: "scout-project",
      conversation: "new",
      outcome: { kind: "success" },
    });
  });

  it("rejects a report whose citation is malformed", async () => {
    const result = aScoutProjectResult();
    const runner = recordingRunner([
      ok(
        anEnvelope({
          structured_output: {
            ...result,
            currentState: [{ ...result.currentState[0], citations: ["src/a.ts"] }],
          },
        }),
      ),
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).scoutProject(
        aScoutProjectRequest(),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });
});

/**
 * The handoff scout reads the same whole project as the project scout, so it
 * carries the same security contract, and its prompt carries the work it
 * grounds: the spec, every ticket with its blockers, and the facts.
 */
describe("what the adapter sends for a handoff scout", () => {
  const PROJECT_ROOT = "/Users/someone/projects/observability";

  async function handoffInvocation(
    request = aHandoffScoutRequest({ projectRoot: PROJECT_ROOT }),
  ) {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aHandoffScoutResult() })),
    ]);
    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).scoutHandoff(request);
    const invocation = runner.invocations[0]!;
    return { invocation, prompt: valueOf(invocation.args, "-p") as string, turn };
  }

  it("runs on sonnet whatever model the session interviews on", async () => {
    for (const model of ["fable", "opus", "sonnet"] as const) {
      const base = aHandoffScoutRequest({ projectRoot: PROJECT_ROOT });
      const { invocation } = await handoffInvocation({
        ...base,
        context: { ...base.context, model },
      });
      expect(valueOf(invocation.args, "--model")).toBe(SCOUT_MODEL);
      expect(valueOf(invocation.args, "--model")).toBe("sonnet");
    }
  });

  it("runs in a conversation of its own, never resuming the session's", async () => {
    const base = aHandoffScoutRequest({ projectRoot: PROJECT_ROOT });
    const { invocation } = await handoffInvocation({
      ...base,
      context: { ...base.context, conversationId: "session-7" },
    });

    expect(invocation.args).not.toContain("--resume");
    expect(invocation.args).not.toContain("session-7");
  });

  it("runs from the project root, its only added directory, even when the session has a docs folder", async () => {
    const base = aHandoffScoutRequest({ projectRoot: PROJECT_ROOT });
    const { invocation } = await handoffInvocation({
      ...base,
      context: { ...base.context, docsFolder: "/Users/someone/notes" },
    });

    expect(invocation.cwd).toBe(PROJECT_ROOT);
    expect(invocation.args.filter((arg) => arg === "--add-dir")).toHaveLength(1);
    expect(valueOf(invocation.args, "--add-dir")).toBe(PROJECT_ROOT);
    expect(invocation.args).not.toContain("/Users/someone/notes");
  });

  it("sends exactly the project scout's read-only, deny-ruled argument list, with its own schema", async () => {
    const { invocation } = await handoffInvocation();
    const { args } = invocation;

    expect(args).toEqual([
      "-p",
      valueOf(args, "-p"),
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--allowed-tools",
      "Read,Grep,Glob",
      "--json-schema",
      JSON.stringify(jsonSchemaFor("handoff-scout")),
      "--tools",
      "Read,Grep,Glob",
      "--add-dir",
      PROJECT_ROOT,
      "--restricted",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--permission-prompts",
      "none",
      "--disallowed-tools",
      SCOUT_DENY_RULES.join(","),
    ]);
  });

  it("carries the spec, every ticket with its blockers, and the facts", async () => {
    const request = aHandoffScoutRequest({ projectRoot: PROJECT_ROOT });
    const { prompt } = await handoffInvocation(request);

    expect(prompt).toContain(request.context.idea);
    expect(prompt).toContain(request.specMarkdown);
    expect(prompt).toContain(PROJECT_ROOT);
    for (const ticket of request.tickets) {
      expect(prompt).toContain(`### Ticket ${ticket.number}: ${ticket.title}`);
      expect(prompt).toContain(ticket.body);
    }
    expect(prompt).toContain(
      "### Ticket 1: Measure the lag alert threshold\n\nBlocked by: none",
    );
    expect(prompt).toContain(
      "### Ticket 2: Page the on-call engineer\n\nBlocked by: 1",
    );
    expect(prompt).toContain(String(request.facts.headCommit));
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("Record the broker decision");
    expect(prompt).not.toContain(loadGrillingSkill().trimEnd());
    expect(prompt.startsWith("-")).toBe(false);
  });

  it("says the spec and tickets define the work, and the code defines the facts", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("the spec and the tickets define the work; the code defines the");
    expect(prompt).toContain("facts.");
  });

  it("asks for every fact cited at a line, and only from files the scout opened", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("Cite only files you actually opened");
    expect(prompt).toContain("Never invent a path");
    expect(prompt).toContain("one cited line cannot show an absence");
    expect(prompt).toContain("hidden from you on purpose");
  });

  it("says a file to create must be new and inside the project", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("`create` is a new");
    expect(prompt).toContain("it must not exist yet, it must sit inside the project");
  });

  it("lets a ticket change no files", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("empty for a ticket that changes no files");
    expect(prompt).not.toContain("at least one and at most");
  });

  it("asks, for each blocker, what the ticket needs from it and the check that proves it", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("exactly one entry for every ticket in its Blocked by line");
    expect(prompt).toContain("`provides` names what this ticket needs from");
    expect(prompt).toContain("`check` is the command or test that");
  });

  it("passes the rejection reason back on a retry", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        rejectionReason: "Ticket 2 is missing from the result.",
      }),
    );

    expect(prompt).toContain("Ticket 2 is missing from the result.");
  });

  it("returns the validated grounding and reports its one call as new", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aHandoffScoutResult() })),
    ]);
    const calls: ModelCallEnd[] = [];

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).scoutHandoff(aHandoffScoutRequest(), {
      callEnded: (call) => void calls.push(call),
    });

    expect(turn.result).toEqual(aHandoffScoutResult());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      requestKind: "handoff-scout",
      conversation: "new",
      outcome: { kind: "success" },
    });
  });

  it("rejects a grounding whose path to create leaves the project", async () => {
    const [first, second] = aHandoffScoutResult().tickets;
    const runner = recordingRunner([
      ok(
        anEnvelope({
          structured_output: {
            tickets: [
              { ...first, filesToChange: [{ path: "../elsewhere.ts", change: "create" }] },
              second,
            ],
          },
        }),
      ),
    ]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).scoutHandoff(
        aHandoffScoutRequest(),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
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
          recommendedChoice: null,
          recommendedAnswer: "A workspace",
          dependsOn: [],
          state: "settled",
          answer: { kind: "own-answer", text: "A workspace, but narrower" },
          previousAnswers: [],
          introducedBy: "interviewer",
          repo: null,
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

/**
 * Recording mode: `GRILL_ROOM_RECORD_TURNS` names a file, and every accepted
 * result gets appended to it. These write to a fresh temp directory, never
 * the repository.
 */
describe("recording mode", () => {
  async function tempRecordingFile(): Promise<{ dir: string; file: string }> {
    const dir = await mkdtemp(path.join(tmpdir(), "grill-room-recording-"));
    return { dir, file: path.join(dir, "recording.jsonl") };
  }

  it("appends each accepted result as one JSON line, in the order the turns happen", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      const runner = recordingRunner([
        ok(anEnvelope({ structured_output: aProposeRoundResult() })),
        ok(
          anEnvelope({ structured_output: aFindSupersededResult() }),
        ),
      ]);
      const interviewer = createClaudeCliInterviewer({
        runCli: runner.runCli,
        env: { PATH: "/usr/bin", [RECORD_TURNS_ENV_VAR]: file },
      });

      await interviewer.proposeRound(aProposeRoundRequest());
      await interviewer.findSuperseded(aFindSupersededRequest());

      const lines = (await readFile(file, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual({
        kind: "propose-round",
        result: aProposeRoundResult(),
      });
      expect(JSON.parse(lines[1]!)).toEqual({
        kind: "find-superseded",
        result: aFindSupersededResult(),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing when the variable is unset", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      const runner = recordingRunner([ok(anEnvelope())]);

      await createClaudeCliInterviewer({
        runCli: runner.runCli,
        env: { PATH: "/usr/bin" },
      }).proposeRound(aProposeRoundRequest());

      await expect(readFile(file, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never records a refused or failed call", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      const runner = recordingRunner([
        { stdout: "", stderr: "boom", exitCode: 1 },
      ]);

      await expect(
        createClaudeCliInterviewer({
          runCli: runner.runCli,
          env: { PATH: "/usr/bin", [RECORD_TURNS_ENV_VAR]: file },
        }).proposeRound(aProposeRoundRequest()),
      ).rejects.toMatchObject({ code: "failed" });

      await expect(readFile(file, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never records output that fails its schema", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      const runner = recordingRunner([
        ok(anEnvelope({ structured_output: { proposedDecisions: "not a list" } })),
      ]);

      await expect(
        createClaudeCliInterviewer({
          runCli: runner.runCli,
          env: { PATH: "/usr/bin", [RECORD_TURNS_ENV_VAR]: file },
        }).proposeRound(aProposeRoundRequest()),
      ).rejects.toMatchObject({ code: "malformed-output" });

      await expect(readFile(file, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** An observer that records every call it hears about, in order. */
function recordingObserver() {
  const events: string[] = [];
  const ended: ModelCallEnd[] = [];
  const observer: ModelCallObserver = {
    callStarted: (call) => {
      events.push(`start ${call.call} ${call.conversation}`);
    },
    callEnded: (call) => {
      events.push(`end ${call.call} ${call.outcome.kind}`);
      ended.push(call);
    },
  };
  return { observer, events, ended };
}

describe("telling each model call's outcome apart", () => {
  const resumingRequest = aProposeRoundRequest({
    context: { ...aProposeRoundRequest().context, conversationId: "gone-7" },
  });

  it("reports a clean call as one success carrying the raw output", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);
    const { observer, events, ended } = recordingObserver();

    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest(),
      observer,
    );

    expect(events).toEqual(["start 1 new", "end 1 success"]);
    const [call] = ended;
    expect(call.requestKind).toBe("propose-round");
    expect(call.outcome).toEqual({
      kind: "success",
      rawOutput: JSON.stringify(aProposeRoundResult()),
    });
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(call.endedAt.getTime()).toBeGreaterThanOrEqual(
      call.startedAt.getTime(),
    );
  });

  it("tells the observer a call started before the command line runs", async () => {
    const events: string[] = [];
    const interviewer = createClaudeCliInterviewer({
      runCli: () => {
        events.push("spawn");
        return Promise.resolve(ok(anEnvelope()));
      },
    });

    await interviewer.proposeRound(aProposeRoundRequest(), {
      callStarted: async () => {
        await Promise.resolve();
        events.push("started");
      },
      callEnded: () => {
        events.push("ended");
      },
    });

    expect(events).toEqual(["started", "spawn", "ended"]);
  });

  it("reports a failed resume as its own call, then the fresh primed call", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "No conversation found with session ID", exitCode: 1 },
      ok(anEnvelope({ session_id: "fresh-9" })),
    ]);
    const { observer, events, ended } = recordingObserver();

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
    }).proposeRound(resumingRequest, observer);

    expect(events).toEqual([
      "start 1 resumed",
      "end 1 resume-fallback",
      "start 2 primed-after-resume",
      "end 2 success",
    ]);
    expect(ended[0].outcome).toMatchObject({
      kind: "resume-fallback",
      reason: expect.stringContaining("exit code 1"),
    });
    expect(turn.conversationId).toBe("fresh-9");
    // The resume fallback keeps its existing contract.
    expect(valueOf(runner.invocations[0].args, "--resume")).toBe("gone-7");
    expect(runner.invocations[1].args).not.toContain("--resume");
  });

  it("reports a fresh call that also fails as an error, after the fallback", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "gone", exitCode: 1 },
      { stdout: "", stderr: "still gone", exitCode: 1 },
    ]);
    const { observer, events, ended } = recordingObserver();

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        resumingRequest,
        observer,
      ),
    ).rejects.toMatchObject({ code: "failed" });
    expect(events).toEqual([
      "start 1 resumed",
      "end 1 resume-fallback",
      "start 2 primed-after-resume",
      "end 2 error",
    ]);
    expect(ended[1].outcome).toMatchObject({ kind: "error", code: "failed" });
  });

  it("reports a rate limit as a rate limit, with no fallback and no error", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "Claude usage limit reached", exitCode: 1 },
    ]);
    const { observer, events, ended } = recordingObserver();

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        resumingRequest,
        observer,
      ),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(events).toEqual(["start 1 resumed", "end 1 rate-limited"]);
    expect(ended[0].outcome).toEqual({
      kind: "rate-limited",
      reason: expect.stringContaining("rate limited"),
    });
    expect(ended[0].outcome.kind).not.toBe("error");
  });

  it("reports schema-invalid output with the raw output and a one-line reason", async () => {
    const invalid = { proposedDecisions: "not a list" };
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: invalid })),
    ]);
    const { observer, ended } = recordingObserver();

    const error = await createClaudeCliInterviewer({ runCli: runner.runCli })
      .proposeRound(aProposeRoundRequest(), observer)
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      code: "malformed-output",
      rawOutput: JSON.stringify(invalid),
    });
    expect(ended).toHaveLength(1);
    const { outcome } = ended[0];
    expect(outcome.kind).toBe("schema-invalid");
    if (outcome.kind !== "schema-invalid") return;
    expect(outcome.rawOutput).toBe(JSON.stringify(invalid));
    expect(outcome.reason).toContain("proposedDecisions");
    expect(outcome.reason).not.toContain("\n");
  });

  it("reports output that is not JSON as schema-invalid, keeping what came back", async () => {
    const runner = recordingRunner([ok("Sure! Here is your round:")]);
    const { observer, ended } = recordingObserver();

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
        observer,
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
    expect(ended[0].outcome).toEqual({
      kind: "schema-invalid",
      rawOutput: "Sure! Here is your round:",
      reason: "The output is not JSON.",
    });
  });

  it("never reports a failed resume, a rate limit and schema-invalid output alike", async () => {
    async function outcomeKinds(
      request: ReturnType<typeof aProposeRoundRequest>,
      outcomes: CliOutcome[],
    ): Promise<string[]> {
      const runner = recordingRunner(outcomes);
      const { observer, ended } = recordingObserver();
      await createClaudeCliInterviewer({ runCli: runner.runCli })
        .proposeRound(request, observer)
        .catch(() => undefined);
      return ended.map((call) => call.outcome.kind);
    }

    const failedResume = await outcomeKinds(resumingRequest, [
      { stdout: "", stderr: "No conversation found", exitCode: 1 },
      ok(anEnvelope()),
    ]);
    const rateLimited = await outcomeKinds(aProposeRoundRequest(), [
      { stdout: "", stderr: "429 Too Many Requests", exitCode: 1 },
    ]);
    const schemaInvalid = await outcomeKinds(aProposeRoundRequest(), [
      ok(anEnvelope({ structured_output: { proposedDecisions: 3 } })),
    ]);

    expect(failedResume).toEqual(["resume-fallback", "success"]);
    expect(rateLimited).toEqual(["rate-limited"]);
    expect(schemaInvalid).toEqual(["schema-invalid"]);
  });

  it("keeps every invocation guarantee while an observer is listening", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      env: { PATH: "/usr/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" },
    }).proposeRound(
      aProposeRoundRequest({
        context: {
          ...aProposeRoundRequest().context,
          model: "opus",
          conversationId: "session-7",
        },
      }),
      recordingObserver().observer,
    );

    const [invocation] = runner.invocations;
    expect(valueOf(invocation.args, "--allowed-tools")).toBe("");
    expect(valueOf(invocation.args, "--model")).toBe("opus");
    expect(valueOf(invocation.args, "--resume")).toBe("session-7");
    expect(
      JSON.parse(valueOf(invocation.args, "--json-schema") as string),
    ).toEqual(jsonSchemaFor("propose-round"));
    for (const marker of CLEARED_ENVIRONMENT_MARKERS) {
      expect(invocation.env).not.toHaveProperty(marker);
    }
  });

  it("fails the method when the observer itself fails", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);

    await expect(
      createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
        aProposeRoundRequest(),
        {
          callStarted: () => {
            throw new Error("could not record the attempt");
          },
        },
      ),
    ).rejects.toThrow("could not record the attempt");
    expect(runner.invocations).toHaveLength(0);
  });
});
