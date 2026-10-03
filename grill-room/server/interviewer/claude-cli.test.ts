import type { HandoffFactPack } from "../handoff-fact-pack.js";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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
import { InterviewerError } from "./errors.js";
import { DOCS_FOLDER_ADDENDUM, loadGrillingSkill } from "./instructions.js";
import { transcriptPath, type TranscriptQuery } from "./transcript-tools.js";
import { jsonSchemaFor, type CheckConsistencyResult } from "./schemas.js";
import { SCOUT_MODEL } from "./types.js";
import type {
  CheckConsistencyRequest,
  ModelCallEnd,
  ModelCallObserver,
} from "./types.js";
import {
  aContext,
  anAssessReadinessRequest,
  anAssessReadinessResult,
  aFindSupersededRequest,
  aFindSupersededResult,
  aHandoffScoutRequest,
  aHandoffScoutResult,
  someHandoffFactPack,
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

describe("what the adapter sends for a find-superseded check", () => {
  const LOOSE_END_SECTION = [
    "## Your task: find the loose ends a later decision already answered",
    "",
    "Every decision below marked with a loose-end answer was left open by the",
    "user at the time. The interview has moved on since, and some of them may",
    "already be answered by a decision that settled later, under a different",
    "question.",
    "",
    "Loose ends to judge: storage, tone",
    "",
    "Return one entry in `supersessions` for each loose end above that a",
    "settled decision in the tree fully answers, naming that decision in",
    "`answeredByKey`, the answer to record on the loose end in `answer`, in",
    "the loose end's own terms, and in `reason` which decision answers it and",
    "why. Leave out every loose end you are not sure about; an empty list is",
    "the right answer when nothing has been superseded.",
    "",
    "Be conservative. A partial overlap is not a supersession: the settled",
    "decision must answer the whole of the question the loose end asks, not",
    "merely touch on it. Never invent an answer no settled decision carries —",
    "the user will see it as something they already decided.",
  ].join("\n");

  const REPLACEMENT_BODY = [
    "Decisions to check, each followed by the decisions that settled after it:",
    "- shape: storage, storage-location",
    "- storage: storage-location",
    "",
    "Return one entry in `replacements` for each decision above whose answer one",
    "of the decisions listed after it changes, narrows or reverses, so that a builder",
    "reading the earlier answer alone would build the wrong thing. Name the earlier",
    "decision in `replacedKey`, the later one (from its list) in `byKey`, and say in `reason` what",
    "the later decision changes. A later decision that only adds detail the earlier",
    "one left open is not a replacement. Be conservative: an empty list is the right",
    "answer when nothing was replaced.",
  ].join("\n");

  const DEFERRAL_BODY = [
    "Own answers to check: vetting, hold",
    "",
    "Each decision above was settled with the user's own words. Return one entry in",
    "`deferrals` for each whose answer does not decide the question but postpones it",
    "until something else is known: \"wait until…\", \"decide later\", \"TBD\", \"once X",
    "is settled\", \"depends on Y\" with no choice made. Name the decision in `key` and",
    "say in `reason` what the answer waits on.",
    "",
    "An answer that decides and names a condition for revisiting it is not a deferral:",
    "\"48 h hold; revisit after launch\" decides 48 h. Be conservative: an empty list is",
    "the right answer when every own answer decides its question.",
  ].join("\n");

  const LATER_KEYS = {
    shape: ["storage", "storage-location"],
    storage: ["storage-location"],
  };

  async function promptFor(
    looseEndKeys: string[],
    replaceableKeys: string[],
    deferrableKeys: string[] = [],
  ) {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aFindSupersededResult() })),
    ]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).findSuperseded(
      aFindSupersededRequest({
        looseEndKeys,
        replaceableKeys,
        laterKeys: replaceableKeys.length > 0 ? LATER_KEYS : {},
        deferrableKeys,
      }),
    );
    return valueOf(runner.invocations[0].args, "-p") as string;
  }

  it("sends the loose-end section, then the replacement section, when both lists have keys", async () => {
    const prompt = await promptFor(
      ["storage", "tone"],
      ["shape", "storage"],
    );

    expect(prompt).toContain(
      `${LOOSE_END_SECTION}\n\n## Also: settled decisions a later decision replaced\n\n${REPLACEMENT_BODY}`,
    );
  });

  it("sends today's loose-end section alone when nothing is replaceable", async () => {
    const prompt = await promptFor(["storage", "tone"], []);

    expect(prompt).toContain(LOOSE_END_SECTION);
    expect(prompt).not.toContain("replacements");
    expect(prompt).not.toContain("Decisions to check");
  });

  it("sends the replacement section alone, as the task, when there are no loose ends", async () => {
    const prompt = await promptFor([], ["shape", "storage"]);

    expect(prompt).toContain(
      `## Your task: find settled decisions a later decision replaced\n\n${REPLACEMENT_BODY}`,
    );
    expect(prompt).not.toContain("Loose ends to judge");
    expect(prompt).not.toContain("## Also:");
  });

  it("sends no deferral section when no own answer is deferrable", async () => {
    const prompt = await promptFor(["storage", "tone"], ["shape", "storage"]);

    expect(prompt).not.toContain("deferrals");
    expect(prompt).not.toContain("Own answers to check");
  });

  it("appends the deferral section after the other two, leaving their text as it was", async () => {
    const prompt = await promptFor(
      ["storage", "tone"],
      ["shape", "storage"],
      ["vetting", "hold"],
    );

    expect(prompt).toContain(
      `${LOOSE_END_SECTION}\n\n## Also: settled decisions a later decision replaced\n\n${REPLACEMENT_BODY}\n\n## Also: own answers that defer the question instead of deciding it\n\n${DEFERRAL_BODY}`,
    );
  });

  it("sends the deferral section alone, as the task, when there is nothing else to check", async () => {
    const prompt = await promptFor([], [], ["vetting", "hold"]);

    expect(prompt).toContain(
      `## Your task: find own answers that defer the question instead of deciding it\n\n${DEFERRAL_BODY}`,
    );
    expect(prompt).not.toContain("Loose ends to judge");
    expect(prompt).not.toContain("Decisions to check");
    expect(prompt).not.toContain("## Also:");
  });

  const RESTATEMENT_BODY = [
    "Own answers to check: vetting, hold",
    "",
    "Each decision above was settled with the user's own words, and its answer is",
    "exported as the decision for build agents to read. Return one entry in",
    "`restatements` for each answer that holds text that is not part of the",
    "decision: an instruction or question addressed to the AI or the interviewer,",
    "a note to self, or an obvious typo. Name the decision in `key`.",
    "",
    "`statement` is the decision in the owner's words, with typos fixed, nothing",
    "added and the meaning unchanged. `operatorNotes` is the text you removed,",
    "verbatim, or `\"\"` when you only fixed typos. Say in `reason` what you removed",
    "or fixed.",
    "",
    "Be conservative: an answer that is already a clean decision gets no entry,",
    "and an empty list is the right answer when every own answer is one.",
  ].join("\n");

  const ALSO_RESTATEMENT = `## Also: own answers that hold more than the decision\n\n${RESTATEMENT_BODY}`;

  async function restatementPromptFor(
    looseEndKeys: string[],
    replaceableKeys: string[],
    deferrableKeys: string[],
    restatableKeys: string[],
  ) {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aFindSupersededResult() })),
    ]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).findSuperseded(
      aFindSupersededRequest({
        looseEndKeys,
        replaceableKeys,
        laterKeys: replaceableKeys.length > 0 ? LATER_KEYS : {},
        deferrableKeys,
        restatableKeys,
      }),
    );
    return valueOf(runner.invocations[0].args, "-p") as string;
  }

  it("sends no restatement section when no own answer is restatable", async () => {
    const prompt = await restatementPromptFor(
      ["storage", "tone"],
      ["shape", "storage"],
      ["vetting", "hold"],
      [],
    );

    expect(prompt).not.toContain("restatements");
    expect(prompt).not.toContain("hold more than the decision");
  });

  it("appends the restatement section after the other three, leaving their text byte for byte as it was", async () => {
    const lists: [string[], string[], string[]] = [
      ["storage", "tone"],
      ["shape", "storage"],
      ["vetting", "hold"],
    ];
    const without = await restatementPromptFor(...lists, []);
    const withRestatements = await restatementPromptFor(...lists, [
      "vetting",
      "hold",
    ]);

    expect(withRestatements).toContain(
      `${LOOSE_END_SECTION}\n\n## Also: settled decisions a later decision replaced\n\n${REPLACEMENT_BODY}\n\n## Also: own answers that defer the question instead of deciding it\n\n${DEFERRAL_BODY}\n\n${ALSO_RESTATEMENT}`,
    );
    expect(withRestatements.replace(`\n\n${ALSO_RESTATEMENT}`, "")).toBe(without);
  });

  it("heads the restatement section 'Also' after any single earlier section", async () => {
    for (const [looseEnds, replaceable, deferrable] of [
      [["storage", "tone"], [], []],
      [[], ["shape", "storage"], []],
      [[], [], ["vetting", "hold"]],
    ] as [string[], string[], string[]][]) {
      const prompt = await restatementPromptFor(looseEnds, replaceable, deferrable, [
        "vetting",
        "hold",
      ]);
      expect(prompt).toContain(`\n\n${ALSO_RESTATEMENT}`);
      expect(prompt).not.toContain("## Your task: find own answers that hold more");
    }
  });

  it("sends the restatement section alone, as the task, when there is nothing else to check", async () => {
    const prompt = await restatementPromptFor([], [], [], ["vetting", "hold"]);

    expect(prompt).toContain(
      `## Your task: find own answers that hold more than the decision\n\n${RESTATEMENT_BODY}`,
    );
    expect(prompt).not.toContain("Loose ends to judge");
    expect(prompt).not.toContain("Decisions to check");
    expect(prompt).not.toContain("## Also:");
  });
});

describe("what the adapter sends for a consistency check", () => {
  const SPEC = "## Implementation Decisions\n\n- Run data must outlast the benchmark horizon.";
  const aResult = (): CheckConsistencyResult => ({
    findings: [
      {
        kind: "unquantified-threshold",
        at: {
          artefact: "spec",
          section: "Implementation Decisions",
          ticket: null,
          quote: "must outlast the benchmark horizon",
        },
        against: null,
        question: "How long after the benchmark ends must run data be kept?",
        decisionKey: null,
      },
    ],
  });
  const aRequest = (
    overrides: Partial<CheckConsistencyRequest> = {},
  ): CheckConsistencyRequest => ({
    kind: "check-consistency",
    context: aContext({ model: "opus" }),
    specMarkdown: SPEC,
    tickets: [
      {
        number: 1,
        title: "Poll the hook events",
        body: "Polling is capped at N x cadence.",
        kind: "build",
        waitsFor: null,
      },
      {
        number: 2,
        title: "Get a staging account",
        body: "The owner provides one.",
        kind: "gate",
        waitsFor: "A staging account from the owner",
      },
    ],
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  });

  const TASK_SECTION = [
    "## Your task: find what a builder would have to decide alone",
    "",
    "A builder who meets a statement that leaves something undecided picks an",
    "answer on their own, and the owner finds out in review. Find every such",
    "statement in the spec and the tickets above, and turn each into one question",
    "for the owner.",
    "",
    "The six kinds of finding, each with an example:",
    "",
    '- `unquantified-threshold`: a limit, bound or duration with no value. "Run',
    '  data must outlast the benchmark horizon" names no horizon; "capped at N x',
    '  cadence" gives no N.',
    "- `one-case-rule`: a rule stated for one case, leaving its sibling cases",
    '  unhandled. "A run whose run_id starts with `wf_` gets a root span" says',
    "  nothing about runs driven by hand.",
    "- `spec-ticket-contradiction`: the spec and a ticket say different things",
    '  about the same point. The spec calls Retention "a placeholder for a later',
    '  ticket" while a ticket says to fill it in.',
    '- `open-choice`: an "X or Y" the text leaves open. "Use Checkout or Payment',
    '  Element" never says which.',
    "- `undefaulted-value`: a value called defined, configurable or set, with no",
    '  value and no default. "Unpaid accepted bookings follow a defined timeout"',
    "  gives no timeout.",
    "- `unnamed-target`: a host, service, account or place named only by its",
    '  role. "deployable to a staging environment" names no host.',
    "",
    "Return one entry in `findings` for each, at most 20:",
    "",
    "- `kind`: one of the six kinds above.",
    '- `at`: where the text is. In the spec: `artefact` "spec", `section` the',
    '  heading of the spec section it sits under, exactly as written after "## ",',
    '  and `ticket` null. In a ticket: `artefact` "ticket", `ticket` its number,',
    "  and `section` null.",
    "- `at.quote`: the words that leave the question open, copied exactly: the",
    "  same words, case, punctuation and markup. Quote a phrase or a sentence, not",
    "  a paragraph. Keep every letter's case as the text has it, even where an",
    "  example above starts with a capital: a phrase from mid-sentence starts as",
    "  it does there.",
    "- `against`: for a `spec-ticket-contradiction` only, the other side, in the",
    "  same form as `at`: one side in the spec and the other in a ticket. Null for",
    "  every other kind.",
    "- `question`: one question the owner can answer in a sentence, ending with",
    '  "?". Ask for the missing value or choice itself: "How long after the',
    '  benchmark ends must run data be kept?", not "Should the horizon be',
    '  defined?".',
    "- `decisionKey`: the key of the settled decision in the tree above that the",
    "  text comes from, or null when none does.",
    "",
    "Be conservative. A value given anywhere in the spec, the tickets or the tree",
    'is not missing: "a defined timeout" is not a finding when a decision sets it',
    "to 48 hours. Detail a builder can settle alone without changing what the",
    "owner gets, such as a name or a file layout, is not a finding. An empty list",
    "is the right answer when nothing is left open.",
  ].join("\n");

  it("constrains the output to the consistency schema, on the session's model, with every tool disabled and no conversation resumed", async () => {
    const runner = recordingRunner([ok(anEnvelope({ structured_output: aResult() }))]);

    const turn = await createClaudeCliInterviewer({ runCli: runner.runCli }).checkConsistency(
      aRequest(),
    );

    const { args } = runner.invocations[0];
    expect(valueOf(args, "--allowed-tools")).toBe("");
    expect(valueOf(args, "--model")).toBe("opus");
    expect(JSON.parse(valueOf(args, "--json-schema") as string)).toEqual(
      jsonSchemaFor("check-consistency"),
    );
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--add-dir");
    expect(turn.result).toEqual(aResult());
  });

  it("sends the opening line, the rendered spec and tickets, then the task section exactly", async () => {
    const runner = recordingRunner([ok(anEnvelope({ structured_output: aResult() }))]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).checkConsistency(aRequest());

    const prompt = valueOf(runner.invocations[0].args, "-p") as string;
    expect(
      prompt.startsWith(
        "You are checking a finished spec and its implementation tickets inside the Grill Room app, before a builder reads them. The design tree the spec was written from comes first, then the spec, then the tickets, then your task.\n\n## The session\n",
      ),
    ).toBe(true);
    const rendered = [
      "## The spec",
      "",
      "```markdown",
      SPEC,
      "```",
      "",
      "## The tickets",
      "",
      "### Ticket 1: Poll the hook events",
      "Kind: build",
      "",
      "```markdown",
      "Polling is capped at N x cadence.",
      "```",
      "",
      "### Ticket 2: Get a staging account",
      "Kind: gate",
      "Waits for: A staging account from the owner",
      "",
      "```markdown",
      "The owner provides one.",
      "```",
      "",
      TASK_SECTION,
    ].join("\n");
    expect(prompt.endsWith(`\n\n${rendered}`)).toBe(true);
    expect(prompt).not.toContain(loadGrillingSkill().trimEnd());
  });

  it("hands a retry its previous answer in a fenced json block", async () => {
    const previous = aResult();
    const runner = recordingRunner([ok(anEnvelope({ structured_output: aResult() }))]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).checkConsistency(
      aRequest({ rejectionReason: "Finding 1 has an empty quote.", previousResult: previous }),
    );

    const { args } = runner.invocations[0];
    const prompt = valueOf(args, "-p") as string;
    expect(args).not.toContain("--resume");
    expect(prompt).toContain(
      [
        `${TASK_SECTION.split("\n").slice(-1)[0]}`,
        "",
        "## Your previous answer was rejected",
        "",
        "Finding 1 has an empty quote.",
        "",
        "Your previous answer, exactly as the app received it:",
        "",
        "```json",
        JSON.stringify(previous, null, 2),
        "```",
      ].join("\n"),
    );
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

  it("passes the rejection reason back on a retry", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: anAssessReadinessResult() })),
    ]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).assessReadiness(
      anAssessReadinessRequest({
        rejectionReason: "The verdict is ready, but no evidence was returned.",
      }),
    );

    const prompt = valueOf(runner.invocations[0].args, "-p") as string;
    expect(prompt).toContain("The verdict is ready, but no evidence was returned.");
  });

  it("hands a retry its previous answer and tells it to change only what the reasons name", async () => {
    const previous = anAssessReadinessResult();
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: anAssessReadinessResult() })),
    ]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).assessReadiness(
      anAssessReadinessRequest({
        rejectionReason: "The verdict is ready, but no evidence was returned.",
        previousResult: previous,
      }),
    );

    const { args } = runner.invocations[0];
    const prompt = valueOf(args, "-p") as string;
    expect(args).not.toContain("--resume");
    expect(prompt).toContain(
      [
        "## Your previous answer was rejected",
        "",
        "The verdict is ready, but no evidence was returned.",
        "",
        "Your previous answer, exactly as the app received it:",
        "",
        "```json",
        JSON.stringify(previous, null, 2),
        "```",
        "",
        "Correct only what the reasons above name:",
        "",
        "- Keep every entry the reasons do not name exactly as it is in your",
        "  previous answer: it already passed every check.",
        "- Change only the entries the reasons name.",
        "- Do not re-read files already read for your previous answer unless a",
        "  reason concerns them.",
      ].join("\n"),
    );
    expect(prompt.endsWith("  reason concerns them.")).toBe(true);
    expect(prompt).not.toContain("Do not repeat the rejected structure.");
  });

  it("sends no retry section on the first attempt", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: anAssessReadinessResult() })),
    ]);

    await createClaudeCliInterviewer({ runCli: runner.runCli }).assessReadiness(
      anAssessReadinessRequest(),
    );

    const prompt = valueOf(runner.invocations[0].args, "-p") as string;
    expect(prompt).not.toContain("## Your previous answer was rejected");
    expect(prompt).not.toContain("Correct only what the reasons above name");
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
    expect(prompt).toContain("never invent a path");
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

  it("hands a retry its previous answer and tells it to change only what the reasons name", async () => {
    const previous = aScoutProjectResult();
    const { invocation } = await scoutInvocation(
      aScoutProjectRequest({
        projectRoot: PROJECT_ROOT,
        rejectionReason: "src/missing.ts:4 does not exist at the commit read.",
        previousResult: previous,
      }),
    );
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(invocation.args).not.toContain("--resume");
    expect(prompt).toContain(
      [
        "## Your previous answer was rejected",
        "",
        "src/missing.ts:4 does not exist at the commit read.",
        "",
        "Your previous answer, exactly as the app received it:",
        "",
        "```json",
        JSON.stringify(previous, null, 2),
        "```",
        "",
        "Correct only what the reasons above name:",
        "",
        "- Keep every entry the reasons do not name exactly as it is in your",
        "  previous answer: it already passed every check.",
        "- Change only the entries the reasons name.",
        "- Do not re-read files already read for your previous answer unless a",
        "  reason concerns them.",
      ].join("\n"),
    );
    expect(prompt.endsWith("  reason concerns them.")).toBe(true);
    expect(prompt).not.toContain("Do not repeat the rejected structure.");
  });

  it("sends no retry section on the first attempt", async () => {
    const { invocation } = await scoutInvocation();
    const prompt = valueOf(invocation.args, "-p") as string;

    expect(prompt).not.toContain("## Your previous answer was rejected");
    expect(prompt).not.toContain("Correct only what the reasons above name");
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

  it("shows the fact pack: tracked files, root documents already opened, and the verify command", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({
          trackedFiles: ["src/a.ts", "src/b.ts"],
          trackedFilesOmitted: 200,
          namedDocs: [
            { paths: ["AGENTS.md", "CLAUDE.md"], lines: ["# CLAUDE.md", "second"], cutLines: [], truncated: false },
          ],
          verifyCommand: { command: "pnpm test", source: "registered" },
        }),
      }),
    );

    expect(prompt).toContain(
      "## Files the repository tracks\n\nTracked files only, with secret files left out: a path missing from this\nlist is never evidence that a file does not exist.\n\nsrc/a.ts\nsrc/b.ts\n(and 200 more not listed)\n",
    );
    expect(prompt).toContain(
      "## Root documents, already opened\n\nThese count as files you opened: cite their shown lines, and mark them\n`edit`, without opening them. For a line past a truncation, open the file.\n\n### AGENTS.md (also CLAUDE.md)\n\n     1\t# CLAUDE.md\n     2\tsecond\n",
    );
    expect(prompt).toContain("## Verify command\n\n`pnpm test` (registered for this project)");
    expect(prompt.indexOf("## Files the repository tracks")).toBeGreaterThan(
      prompt.indexOf("- Recent commit subjects, newest first:"),
    );
    expect(prompt.indexOf("## Files the repository tracks")).toBeLessThan(prompt.indexOf("## The spec"));
  });

  it("lists the repository's rules after the root documents", async () => {
    const intro =
      "## The repository's rules\n\nThese files are the repository's own rules. Read each one that applies to a\nticket before you ground it; the root documents above are already open.\n\n";
    const rendered = async (ruleSources: HandoffFactPack["ruleSources"]) =>
      (
        await handoffInvocation(
          aHandoffScoutRequest({
            projectRoot: PROJECT_ROOT,
            factPack: someHandoffFactPack({ ruleSources }),
          }),
        )
      ).prompt;

    expect(await rendered([])).toContain(
      `${intro}None: no root CLAUDE.md or AGENTS.md and no .claude/rules/.\n\n## Verify command`,
    );
    expect(await rendered([{ path: ".claude/rules/versioning.md", globs: ["VERSION", "web/**/*"], lineCount: 9 }])).toContain(
      `${intro}- \`.claude/rules/versioning.md\`: applies to a ticket that changes a file matching \`VERSION\`, \`web/**/*\`\n\n## Verify command`,
    );
    expect(await rendered([{ path: "CLAUDE.md", globs: null, lineCount: 3 }])).toContain(
      `${intro}- \`CLAUDE.md\`: applies to every ticket\n\n## Verify command`,
    );
    const several = await rendered([
      { path: ".claude/rules/versioning.md", globs: ["VERSION"], lineCount: 9 },
      { path: "CLAUDE.md", globs: null, lineCount: 3 },
    ]);
    expect(several).toContain(
      "- `.claude/rules/versioning.md`: applies to a ticket that changes a file matching `VERSION`\n- `CLAUDE.md`: applies to every ticket\n\n## Verify command",
    );
    expect(several.indexOf("## Root documents, already opened")).toBeLessThan(
      several.indexOf("## The repository's rules"),
    );
    expect(several.indexOf("## The repository's rules")).toBeLessThan(several.indexOf("## Verify command"));
  });

  it("heads a root document with its first path and joins every alias with a comma", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({
          namedDocs: [
            { paths: ["package.json", "CLAUDE.md", "AGENTS.md"], lines: ["{}"], cutLines: [], truncated: false },
            { paths: ["docs/agent.md", "CLAUDE.md"], lines: ["x"], cutLines: [], truncated: false },
          ],
        }),
      }),
    );
    expect(prompt).toContain("### package.json (also CLAUDE.md, AGENTS.md)\n");
    expect(prompt).toContain("### docs/agent.md (also CLAUDE.md)\n");
  });

  it("omits the omitted-count line when every tracked file is listed", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({ trackedFiles: ["src/a.ts"] }),
      }),
    );

    expect(prompt).toContain("src/a.ts\n\n## Root documents");
    expect(prompt).not.toContain("more not listed");
  });

  it("notes a truncated root document, naming the line it stopped at", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({
          namedDocs: [
            {
              paths: ["package.json"],
              lines: Array.from({ length: 400 }, (_, index) => `l${index + 1}`),
              cutLines: [],
              truncated: true,
            },
          ],
        }),
      }),
    );

    expect(prompt).toContain("### package.json\n\n     1\tl1\n");
    expect(prompt).toContain("   400\tl400\n");
    expect(prompt).toContain(
      "(truncated after line 400: line 400 is not this file's last line; open it for the rest)",
    );
  });

  it("marks a root document line cut at 500 characters and says which lines were cut", async () => {
    const cases: { cutLines: number[]; note: string }[] = [
      {
        cutLines: [3],
        note: "(line 3 was cut at 500 characters; open the file to read it whole)",
      },
      {
        cutLines: [3, 17],
        note: "(lines 3, 17 were cut at 500 characters; open the file to read them whole)",
      },
      {
        cutLines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        note: "(lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 1 more were cut at 500 characters; open the file to read them whole)",
      },
      {
        cutLines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        note: "(lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 2 more were cut at 500 characters; open the file to read them whole)",
      },
    ];
    for (const { cutLines, note } of cases) {
      const lastCut = cutLines[cutLines.length - 1]!;
      const docLines = Array.from({ length: lastCut }, (_, index) =>
        cutLines.includes(index + 1) ? `${"x".repeat(500)} …` : "short",
      );
      const { prompt } = await handoffInvocation(
        aHandoffScoutRequest({
          projectRoot: PROJECT_ROOT,
          factPack: someHandoffFactPack({
            namedDocs: [{ paths: ["package.json"], lines: docLines, cutLines, truncated: true }],
          }),
        }),
      );
      expect(prompt).toContain(`${String(lastCut).padStart(6)}\t${"x".repeat(500)} …\n${note}\n(truncated after line`);
    }
  });

  it("does not note a truncation for a document shown whole", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({
          namedDocs: [{ paths: ["package.json"], lines: ["{}"], cutLines: [], truncated: false }],
        }),
      }),
    );

    expect(prompt).not.toContain("(truncated after line");
  });

  it("says a suggested verify command was suggested from the project's recipes", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        factPack: someHandoffFactPack({
          verifyCommand: { command: "just verify", source: "suggested" },
        }),
      }),
    );

    expect(prompt).toContain("`just verify` (suggested from the project's recipes)");
  });

  it("says so when there is no verify command, no tracked file and no root document", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({ projectRoot: PROJECT_ROOT, factPack: someHandoffFactPack() }),
    );

    expect(prompt).toContain("None registered or found in a justfile, package.json or Makefile.");
    expect(prompt).toContain("No tracked files yet.");
    expect(prompt).toContain("None at the root.");
  });

  it("lets the handoff scout cite and edit root documents it was shown, and the project scout not", async () => {
    const { prompt } = await handoffInvocation();
    const runner = recordingRunner([ok(anEnvelope({ structured_output: aScoutProjectResult() }))]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).scoutProject(
      aScoutProjectRequest({ projectRoot: PROJECT_ROOT }),
    );
    const projectPrompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    expect(prompt).toContain("`edit` is a file that exists and that you opened (a root document shown");
    expect(prompt).toContain(
      "The root documents shown above count as opened and read for the lines shown.",
    );
    expect(projectPrompt).not.toContain("root document");
    expect(projectPrompt).not.toContain("count as opened");
    expect(projectPrompt).not.toContain("## Files the repository tracks");
  });

  it("says the spec and tickets define the work, and the code defines the facts", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("the spec and the tickets define the work; the code defines the");
    expect(prompt).toContain("facts.");
  });

  it("asks for every fact cited at a line, and only from files the scout opened", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("Cite only files you actually opened");
    expect(prompt).toContain("never invent a path");
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

  it("offers three forms for a dependency, including what a blocker adds to a file it edits", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("Say where it is in exactly one of");
    expect(prompt).toContain("It already exists in the code: give its `citation`.");
    expect(prompt).toContain("give the path in `createdPath`, which must be");
    expect(prompt).toContain("one of that blocker's `create` files.");
    expect(prompt).toContain("`editedPath`, which must be one of that blocker's `edit` files, and");
    expect(prompt).toContain("name what it adds in `symbol`: a function, a route, a table, a field.");
  });

  it("says a dependency's check must fail until the blocker lands", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("The `check` must fail until the blocker lands and pass once it has");
    expect(prompt).toContain("A build or");
    expect(prompt).toContain("a command that already passes on today's code proves nothing.");
  });

  it("says testPath names the test to add or extend, or is null when the spec rules out tests, before assuming a test file exists", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "- `provedBy`: the `testPath` of the test file to add or extend,",
        "  relative to the project root, or null when the spec rules out",
        "  tests for this ticket's kind of change or when no runner exists",
        "  yet, as below. `command`",
        "  is the shell command that proves the ticket, in the form the",
        "  project already runs its tests.",
      ].join("\n"),
    );
    expect(prompt.indexOf("or null when the spec rules out")).toBeLessThan(
      prompt.indexOf("The test file is one of this ticket's"),
    );
    expect(prompt).not.toContain("The `command` runs it,");
  });

  it("tells the scout to declare a reach for a rename of existing code instead of listing its uses", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("- `reach`: at most 3 symbols");
    expect(prompt).toContain("renames, removes or reshapes something that already exists in the");
    expect(prompt).toContain("so do not list those uses in `filesToChange`");
    expect(prompt).toContain("One identifier");
    expect(prompt).toContain("(letters, digits, underscore), and none twice");
    expect(prompt).toContain("Give no reach");
    expect(prompt).toContain("the app refuses a symbol no");
    expect(prompt).toContain("Empty when the ticket reshapes nothing.");
    expect(prompt.indexOf("- `reach`")).toBeGreaterThan(prompt.indexOf("- `filesToChange`"));
    expect(prompt.indexOf("- `reach`")).toBeLessThan(prompt.indexOf("- `buildsOnFiles`"));
  });

  it("says the proving test is one of the ticket's own files, unless it changes none", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("The test file is one of this ticket's");
    expect(prompt).toContain("own `filesToChange`, as a `create` or an `edit`");
    expect(prompt).toContain("Only a ticket that changes no files may name");
  });

  it("says provedBy's testPath must be a real test, never a source file the ticket changes", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("`testPath` is a test in the project's own test");
    expect(prompt).toContain("layout, never a source file the ticket changes.");
  });

  it("qualifies the must-run-and-fail rule to when testPath names a test, and narrows it to that test file or package", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("When `testPath` names a test, `command` must run that test and");
    expect(prompt).toContain(
      "fail without this ticket's change; narrow it to that test file or",
    );
    expect(prompt).toContain("package where the project's runner allows one — a project-wide");
    expect(prompt).toContain("command that runs every test is not a proof on its own.");
  });

  it("limits the new-test rule to a ticket that changes files, when the spec does not rule out tests, so a no-files ticket or a spec-excluded change does not require adding one", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  For a ticket that changes files, when the spec does not rule",
        "  out tests for this kind of change and no existing test covers",
        "  its acceptance criteria, add one: list it as a `create` in",
        "  `filesToChange` and name it here as `testPath`. When",
      ].join("\n"),
    );
  });

  it("says a build-only ticket's command chains the build with the command that runs the named test, only once testPath is set", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  `testPath` is set, a ticket proved only by a build — codegen,",
        "  configuration — gives `command` as the build command followed",
        "  by the command that runs the test named in `testPath`, for",
        "  example `<build> && <test command>`, so `command` exercises",
        "  the test it names.",
      ].join("\n"),
    );
  });

  it("never claims command always exercises a test, since testPath may be null", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).not.toContain("always exercises the test it names");
  });

  it("says a set testPath must be collected by the project's own test command, cited in a fact, addressing the scout as you", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  When `testPath` is set, it must sit where the project's own test",
        "  command collects it: a runner config's include globs, the test",
        "  recipe in a justfile, Makefile or package.json, or the runner's",
        "  default discovery. When a runner already exists (a config, a",
        "  recipe, or a test file), you confirm this and state it in a fact,",
        "  citing the config or recipe line that collects it. With no",
        "  explicit include globs, cite the line that invokes the runner",
        '  (e.g. `package.json`\'s `"test": "vitest run"`) and name the',
        "  runner's default pattern in the fact's text. When no file",
        "  invokes the runner either, state the runner's default",
        "  discovery rule in the fact and cite an existing test file the",
        "  same runner already collects under the same pattern, as",
        "  evidence of that pattern. Never cite a line that neither",
        "  invokes the runner, configures what it collects, nor is such",
        "  a test file. This fact may cite a config, recipe, or existing",
        "  test file the ticket does not change, an exception to facts",
        "  being about the code the ticket touches.",
      ].join("\n"),
    );
    expect(prompt).toContain(
      [
        "  When a runner already exists, a path the runner",
        "  does not collect — a file under `scripts/` when the runner",
        "  only globs `src/**/*.test.ts` — is not a proof: pick a path",
        "  the runner collects.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("The scout confirms this and states it in a");
  });

  it("states the runner's default discovery example line, naming its default pattern, when no include globs are explicit", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  explicit include globs, cite the line that invokes the runner",
        '  (e.g. `package.json`\'s `"test": "vitest run"`) and name the',
        "  runner's default pattern in the fact's text. When no file",
      ].join("\n"),
    );
  });

  it("tells the scout that when no file invokes the runner either, the cited existing test file is evidence of the pattern, not a self-contradictory ban on citing it", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  invokes the runner either, state the runner's default",
        "  discovery rule in the fact and cite an existing test file the",
        "  same runner already collects under the same pattern, as",
        "  evidence of that pattern. Never cite a line that neither",
        "  invokes the runner, configures what it collects, nor is such",
        "  a test file.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("cite a line that does not show collection");
  });

  it("lets the collection fact cite a config, recipe, or existing test file the ticket does not change", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  a test file. This fact may cite a config, recipe, or existing",
        "  test file the ticket does not change, an exception to facts",
        "  being about the code the ticket touches.",
        "  When no runner exists yet, the facts say",
      ].join("\n"),
    );
    expect(prompt).not.toContain("This fact may cite a config or recipe file the ticket");
  });

  it("says checks and commands run from the repository root, and paths after a cd are relative to it", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  Every `check`, and every `provedBy.command`, runs from the repository",
        "  root. After a `cd`, paths are relative to the new directory: after",
        "  `cd backend`, write `export/export.go`, never `backend/export/export.go`.",
        "  Otherwise do not `cd`: name paths from the repository root.",
      ].join("\n"),
    );
  });

  it("says the proof must fail on the current commit, and a file the ticket edits is no proof unless it is a test", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  The proof must fail on the current commit, before this ticket's",
        "  change, and pass after it. A file the ticket edits is never its own",
        "  proof unless it is a test: a spec, a configuration file or a generated",
        "  file parses and builds today, so it proves nothing about the change.",
        "  Prove such a change with a test, or with a command that fails today: a",
        "  build, or a grep for what the ticket adds.",
      ].join("\n"),
    );
  });

  it("says a ticket whose kind of change the spec keeps untested sets testPath to null and is proved by its command, and a fact says so", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  When the spec rules out tests for this ticket's kind of change, set",
        "  `testPath` to null and give as `command` a command over the ticket's",
        "  own files, such as a build or a grep, that fails on the current commit;",
        "  say in a fact that the spec excludes tests.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("do not\n  add one");
  });

  it("tells the scout how to ground a ticket that sets up the test runner, and one whose blocker sets it up", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("When no runner exists yet, the facts say");
    expect(prompt).toContain("or no runner config, recipe or test file exists");
    expect(prompt).toContain("creates the runner\n  config or recipe itself and whose body names a test command it");
    expect(prompt).toContain("`testPath` null and `command`\n  the test command its body names");
    expect(prompt).toContain("or a grep for the\n  runner config it creates, is also accepted");
    expect(prompt).toContain("feature ticket that creates no runner config or recipe is not.");
    expect(prompt).toContain("that blocker's `buildsOn`\n  entry uses `createdPath` (or `editedPath` with `symbol`) naming it.");
    expect(prompt).toContain("`provides` says the test is collected by the runner that ticket\n  sets up.");
    expect(prompt).toContain("Give `facts: []` for collection");
    expect(prompt).toContain(
      "When the runner comes from a ticket further up the chain, the\n  `buildsOn` entry for its direct blocker stays as usual, and its\n  `provides` says the test is collected by the runner that ticket\n  sets up.",
    );
    expect(prompt).toContain(
      "the test command its body names, which fails before the ticket\n  (nothing to run) and passes after it.",
    );
    expect(prompt).toContain("a build or a grep over\n  its own files that fails today, with no fact about tests");
    expect(prompt).toContain("or when no runner exists\n  yet, as below.");
    expect(prompt).toContain("State no fact about\n  collection and none that the spec excludes tests.");
    expect(prompt).toContain("`testPath` to null and gives");
    expect(prompt).toContain(
      "A ticket that waits, directly or through its blockers, on a ticket\n  that creates the runner config or recipe sets `testPath` to a file\n  it creates under the pattern that runner will collect.",
    );
    expect(prompt).toContain(
      "A ticket\n  that neither sets up a runner nor waits on one that does sets\n  `testPath` to null",
    );

    const start = prompt.indexOf("A ticket that sets up the test runner itself");
    const runnerSetupSentence = prompt.slice(start, prompt.indexOf("is required.", start) + "is required.".length);
    expect(start).toBeGreaterThan(-1);
    expect(runnerSetupSentence).toContain("`testPath` to\n  null");
    expect(runnerSetupSentence).toContain("in a project with\n  none yet, sets");
    expect(runnerSetupSentence).not.toMatch(/exclud|rules? out/);
    expect(prompt).toContain("no fact about tests is required.");
  });

  it("says a ticket proved by a build builds the whole module, adding any file outside its own the build needs", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  A ticket proved by a build builds the whole module or app, not only",
        "  the package it changes: `go build ./...`, not `go build ./export/...`.",
        "  When that build needs a change outside the ticket's files, such as a",
        "  stub for a method a regenerated interface gains, add that file to",
        "  `filesToChange` and say why in a fact.",
      ].join("\n"),
    );
  });

  it("warns that a proof by an edited non-test file, or a path that ignores its cd, rejects the report, with the closing rejected-reports summary byte-identical", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "Paths to create are checked too: a path outside the project, one that",
        "already exists, or one the repository ignores rejects the whole report.",
        "So does a dependency that names a path its blocker does not create or",
        "edit, a test that is not among its ticket's files to change, a proof",
        "by a file the ticket edits that is not a test by its name, and a check",
        "or command that names a path from the repository root after a `cd`.",
      ].join("\n"),
    );
  });

  it("asks a fact to cite the whole declaration and state a positive consequence, not a claim of absence", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      "the code shows contradicts the ticket, the spec, or what a blocker is",
    );
    expect(prompt).toContain("scoped to provide, cite the whole type or declaration involved and");
    expect(prompt).toContain("state what it holds, then name the consequence for this ticket as a");
    expect(prompt).toContain("positive claim about that range");
    expect(prompt).toContain(
      "the cited response",
    );
    expect(prompt).toContain("type declares only text/csv, so this ticket needs the blocker to");
    expect(prompt).toContain("declare a 404.");
  });

  it("asks for a fact stating the real shape of data a ticket depends on, cited where it is produced or stored", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  When the ticket reads or writes data and its behaviour depends on that",
        "  data's shape (a payload's fields, which of them can be null, a column's",
        "  meaning, or how a value is encoded or stored, such as a JSON column",
        "  holding an object or a string, a timestamp as a Date or a string, or a",
        "  big integer as a number or a string), state that shape in a fact, and",
        "  cite where you read it being produced or stored: the code that emits or",
        "  inserts it, or the schema or migration that defines it. For a column or",
        "  field whose meaning the ticket relies on, cite what writes it, not only",
        "  its declaration: a name such as `created_at` is never evidence of what",
        "  it holds. Cite an existing fixture or sample only when you could read no",
        "  producer and no schema or migration for the data, and then say in the",
        "  fact that the shape was not confirmed against production. When you",
        "  cannot read the shape where it is produced or stored, cite the closest",
        "  producer or schema you did read, state what those lines hold, and name",
        "  which part of the shape the ticket must confirm. When the ticket's",
        "  behaviour does not depend on data shape, no such fact is required.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("cannot find the shape in the repository");
    expect(prompt).not.toContain("say so in a fact that cites the");
  });

  it("asks the handoff scout for the rules that apply to each ticket, a two-lens flag, and the repository's delegation values", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("- `rules`: one entry for every rule file the fact pack lists with globs");
    expect(prompt).toContain("none skipped");
    expect(prompt).toContain("matches `web/.env.example`");
    expect(prompt).toContain("applies to every ticket`,\n  give an entry only when it requires something of this ticket");
    expect(prompt).toContain("`citation` of the rule's lines as `path:line` or\n  `path:start-end`");
    expect(prompt).toContain("`statement` of what the rule requires of this");
    expect(prompt).toContain("`requiredFiles`: every file the rule requires this ticket\n  to create or edit, relative to the root");
    expect(prompt).toContain("`requiredFiles: []` says the");
    expect(prompt).toContain("List a required file even when\n  it is outside `filesToChange`");
    expect(prompt).toContain("- `twoLensReview`: `{ citation }` of the rule line that gives this ticket");
    expect(prompt).toContain("two reviewers (or two review lenses)");
    expect(prompt).toContain("- `delegationProposals`, once per report");
    expect(prompt).toContain("`maxTicketsInFlight` is `{ value, citation }`");
    expect(prompt).toContain("`pruneCommand` is `{ command, citation }`");
    expect(prompt).toContain("when a rule source says so and\n  this ticket qualifies; otherwise null.");
    expect(prompt).toContain("or null when\n  none states it");
    expect(prompt).toContain("each with the `citation` of its line");
    expect(prompt).toContain("whole number from 1 to 10");
    expect(prompt).toContain("`reviewRule` is `{ citation }`");
    expect(prompt).toContain("`preflight` is `{ citation }`");
    expect(prompt.indexOf("- `rules`:")).toBeGreaterThan(prompt.indexOf("- `provedBy`:"));
  });

  it("lets a fact cite a fixture only when no producer or schema is readable, and says the shape was not confirmed against production", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  it holds. Cite an existing fixture or sample only when you could read no",
        "  producer and no schema or migration for the data, and then say in the",
        "  fact that the shape was not confirmed against production. When you",
      ].join("\n"),
    );
    expect(prompt).not.toContain("or an existing\n  fixture or sample in the repository");
  });

  it("does not let the facts rule contradict the exclusivity rule that follows it", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).not.toContain("a field the spec assumes that does not exist");
    expect(prompt).not.toContain("a response it must return that the code cannot yet");
    expect(prompt).toContain("A fact states only what its cited lines show");
    expect(prompt).not.toContain("closest producer or schema you did read, and name what is unknown");
    expect(prompt).not.toContain("the repository does not define");
  });

  it("asks buildsOn.provides to say when this ticket needs something its blocker does not promise", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      "it (a file, a symbol, a table). When this ticket needs something its",
    );
    expect(prompt).toContain("blocker's ticket text does not promise, say so in `provides` too.");
  });

  it("asks a statement about a whole file to cite the full range, or split into facts with their own citation", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      "declare a 404.\" A statement about a whole file or component cites",
    );
    expect(prompt).toContain("the full range it describes, or it is split into facts that each");
    expect(prompt).toContain("carry their own citation.");
  });

  it("says a fact never claims a field matches a column unless the cited code holds that data", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      "carry their own citation. A fact never says a field matches, holds or",
    );
    expect(prompt).toContain("maps to a column or field the spec asks for unless the cited code");
    expect(prompt).toContain("shows it holds that data. When the spec asks for data the code does");
    expect(prompt).toContain(
      "not hold, use that same positive-claim form instead: cite the whole",
    );
    expect(prompt).toContain("type and state what it holds, then name the consequence for this");
    expect(prompt).toContain("ticket.");
  });

  it("limits buildsOnFiles to code this ticket itself reads, calls or imports", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      "Only code this ticket itself reads, calls or imports: leave out code",
    );
    expect(prompt).toContain("elsewhere in the system that this ticket never touches.");
  });

  it("does not ask the project scout for provedBy at all", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: aScoutProjectResult() })),
    ]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).scoutProject(
      aScoutProjectRequest({ projectRoot: "/Users/someone/projects/observability" }),
    );
    const prompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    expect(prompt).not.toContain("`testPath` is a test in the project's own test");
    expect(prompt).not.toContain("provedBy");
  });

  it("passes the rejection reason back on a retry", async () => {
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        rejectionReason: "Ticket 2 is missing from the result.",
      }),
    );

    expect(prompt).toContain("Ticket 2 is missing from the result.");
  });

  it("hands a retry its previous answer and tells it to change only what the reasons name", async () => {
    const previous = aHandoffScoutResult();
    const { prompt, invocation } = await handoffInvocation(
      aHandoffScoutRequest({
        projectRoot: PROJECT_ROOT,
        rejectionReason: "Ticket 2 marks src/ingest/queue.ts as edit, but no such file exists.",
        previousResult: previous,
      }),
    );

    expect(invocation.args).not.toContain("--resume");
    expect(prompt).toContain(
      [
        "## Your previous answer was rejected",
        "",
        "Ticket 2 marks src/ingest/queue.ts as edit, but no such file exists.",
        "",
        "Your previous answer, exactly as the app received it:",
        "",
        "```json",
        JSON.stringify(previous, null, 2),
        "```",
        "",
        "Correct only what the reasons above name:",
        "",
        "- Keep every entry the reasons do not name exactly as it is in your",
        "  previous answer: it already passed every check.",
        "- Change only the entries the reasons name.",
        "- Do not re-read files already read for your previous answer unless a",
        "  reason concerns them.",
      ].join("\n"),
    );
    expect(prompt.endsWith("  reason concerns them.")).toBe(true);
    expect(prompt).not.toContain("Do not repeat the rejected structure.");
  });

  it("sends no retry section on the first attempt", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).not.toContain("## Your previous answer was rejected");
    expect(prompt).not.toContain("Correct only what the reasons above name");
  });

  it("keeps the session-conversation kinds' retry wording unchanged, unlike the scouts and the readiness judge", async () => {
    const runner = recordingRunner([ok(anEnvelope())]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).proposeRound(
      aProposeRoundRequest({ rejectionReason: "A decision is missing a recommendation." }),
    );
    const prompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    expect(prompt).toContain("Produce a corrected result. Do not repeat the rejected structure.");
    expect(prompt).not.toContain("Correct only what the reasons above name");
  });

  it("lets a ticket edit a file one of its blockers creates, keeping one buildsOn entry per direct blocker", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain(
      [
        "  `edit` is a file that exists and that you opened (a root document shown",
        "  above counts as opened), or a file one of",
        "  this ticket's blockers marks as `create`, directly or through their",
        "  own blockers: the blocker lands first, so the file is there when this",
        "  ticket starts. `buildsOn` stays one entry per ticket in the Blocked by",
        "  line, whatever this ticket edits: when a direct blocker creates the",
        "  file and the file is what this ticket needs from it, that blocker's",
        "  single entry may give it as `createdPath`; never add a second entry",
        "  for the same blocker. A blocker further up the chain, one not in the",
        "  Blocked by line, gets no `buildsOn` entry at all.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("Name that dependency as a `createdPath` on the blocker.");
  });

  it("fences the previous answer so a string holding a code fence cannot close it early", async () => {
    const previous = aHandoffScoutResult();
    previous.tickets[0]!.provedBy.command = "printf '```\\n' && npm test -- lag-alert";
    const { prompt } = await handoffInvocation(
      aHandoffScoutRequest({
        rejectionReason: "Ticket 2 is missing from the result.",
        previousResult: previous,
      }),
    );

    const json = JSON.stringify(previous, null, 2);
    expect(json).toContain("```");
    expect(prompt).toContain(["````json", json, "````"].join("\n"));
    const afterOpening = prompt.slice(prompt.indexOf("````json") + "````json".length);
    expect(afterOpening.indexOf("\n````\n")).toBe(afterOpening.indexOf(json) + json.length);
  });

  it("says only one ticket may create a path, and the later one edits it or creates its own test file", async () => {
    const { prompt } = await handoffInvocation();

    expect(prompt).toContain("must not be in a folder the repository ignores. Only one ticket may");
    expect(prompt).toContain("mark a path as `create`.");
    expect(prompt).toContain("the earlier ticket marks it `create` and the later one,");
    expect(prompt).toContain("which must be blocked by it, marks it `edit`.");
    expect(prompt).toContain("beside the blocker's: Go, for example, allows several `_test.go` files");
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

  it("hands a grounding that breaks a rule beyond its shape to the app, which refuses and retries it", async () => {
    const [first, second] = aHandoffScoutResult().tickets;
    const brokenRules = {
      tickets: [
        { ...first, filesToChange: [{ path: "../elsewhere.ts", change: "create" }] },
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
    const runner = recordingRunner([ok(anEnvelope({ structured_output: brokenRules }))]);

    const turn = await createClaudeCliInterviewer({ runCli: runner.runCli }).scoutHandoff(
      aHandoffScoutRequest(),
    );

    expect(turn.result.tickets[0]!.filesToChange[0]!.path).toBe("../elsewhere.ts");
    expect(turn.result.tickets[1]!.buildsOn[0]).toMatchObject({
      citation: null,
      createdPath: null,
      editedPath: null,
      symbol: null,
    });
  });

  it("still rejects a grounding that does not match the shape", async () => {
    const [first, second] = aHandoffScoutResult().tickets;
    const runner = recordingRunner([
      ok(
        anEnvelope({
          structured_output: {
            tickets: [{ ...first, filesToChange: [{ path: "a.ts", change: "delete" }] }, second],
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

describe("what the adapter sends to break a spec into tickets", () => {
  it("keeps a contract change with its regeneration and build fix, and code with its tests, in one ticket", async () => {
    const runner = recordingRunner([
      ok(anEnvelope({ structured_output: { tickets: [] } })),
    ]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
      kind: "break-into-tickets",
      context: aContext(),
      specMarkdown: "## Problem Statement\n\nExport the training log.",
      greenfield: false,
      verifyCommand: null,
      userStories: [],
      rejectionReason: null,
    });
    const prompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    expect(prompt).toContain("## Your task: break the spec into tickets");
    // The opening never makes build order a dependency: numbering is just
    // numbering, and `blockedBy` names the tickets whose output a ticket uses.
    expect(prompt).toContain(
      [
        "complete it. Number them 1, 2, 3 and so on. Give",
        "each a short kebab-case `slug`, a title, and a body that states what to",
        "build and how it will be judged. In `blockedBy`, list the numbers of the",
        "tickets whose output this ticket uses; leave it empty for tickets that",
        "can start at once.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("in the order they should be built");
    expect(prompt).not.toContain("must land first");
    expect(prompt).toContain(
      [
        "Each ticket must leave the build green on its own, since its builder",
        "verifies it alone. So keep together in one ticket:",
        "",
        "- a spec or contract change, its regeneration, and whatever keeps the",
        "  build green after it, such as a stub handler for a method the",
        "  regenerated interface gains;",
        "- a unit of code and its tests: the ticket that builds the code writes",
        "  its tests, rather than leaving them to a tests-only ticket.",
      ].join("\n"),
    );
  });

  it.each([
    ["without greenfield", false],
    ["with greenfield", true],
  ] as const)("states when to make a gate, right after the rules, %s", async (_, greenfield) => {
    const runner = recordingRunner([ok(anEnvelope({ structured_output: { tickets: [] } }))]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
      kind: "break-into-tickets",
      context: aContext(),
      specMarkdown: "## Problem Statement\n\nExport the training log.",
      greenfield,
      verifyCommand: "pnpm test",
      userStories: [],
      rejectionReason: null,
    });
    const prompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    const paragraph = [
      "Some of what the tickets need is not code: an account with an outside",
      "service, a signed agreement, terms reviewed by a lawyer, or a condition the",
      "spec sets before later work may start, such as a first part being used",
      "before a second part is built. Make each such prerequisite a gate: a ticket",
      'with `kind` "gate", a one-line `waitsFor` naming exactly what it waits for,',
      "and a body saying who provides it and how to tell it is in place. A gate has",
      "no builder and changes no files. List it in the `blockedBy` of every ticket",
      "that cannot start or go live without it; a gate that waits for built work",
      "lists those tickets in its own `blockedBy`. Every other ticket has `kind`",
      '"build" and `waitsFor` null. Never make ordinary work a gate: anything an',
      "agent can build, configure or test in the repository is a build ticket.",
      "Every gate must be in the `blockedBy` of at least one other ticket: a gate",
      "that holds back no ticket is refused.",
    ].join("\n");
    expect(prompt).toContain(
      `  its tests, rather than leaving them to a tests-only ticket.\n\n${paragraph}`,
    );
    if (greenfield) {
      expect(prompt).toContain(
        `${paragraph}\n\n${CHAIN_PARAGRAPH}\n\n## This repository has no commits yet`,
      );
    } else {
      expect(prompt.endsWith(`${paragraph}\n\n${CHAIN_PARAGRAPH}`)).toBe(true);
    }
  });

  const GATE_END = "that holds back no ticket is refused.";
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
    ["no greenfield, no stories", false, [], null],
    ["greenfield", true, [], "## This repository has no commits yet"],
    ["stories", false, [1, 2], "## User stories"],
    ["greenfield and stories", true, [1, 2], "## This repository has no commits yet"],
  ] as const)("states how to keep chains short, after the gate paragraph, %s", async (_, greenfield, userStories, next) => {
    const runner = recordingRunner([ok(anEnvelope({ structured_output: { tickets: [] } }))]);
    await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
      kind: "break-into-tickets",
      context: aContext(),
      specMarkdown: "## Problem Statement\n\nExport the training log.",
      greenfield,
      verifyCommand: "pnpm test",
      userStories: [...userStories],
      rejectionReason: null,
    });
    const prompt = valueOf(runner.invocations[0]!.args, "-p") as string;

    expect(prompt.split(CHAIN_PARAGRAPH)).toHaveLength(2);
    if (next === null) {
      expect(prompt.endsWith(`${GATE_END}\n\n${CHAIN_PARAGRAPH}`)).toBe(true);
      expect(prompt.endsWith("rather than chaining them one after another through that file.")).toBe(true);
    } else {
      expect(prompt).toContain(`${GATE_END}\n\n${CHAIN_PARAGRAPH}\n\n${next}`);
    }
    if (greenfield && userStories.length > 0) {
      expect(prompt.indexOf("## This repository has no commits yet")).toBeLessThan(
        prompt.indexOf("## User stories"),
      );
    }
    if (userStories.length > 0) {
      expect(prompt.lastIndexOf("## ")).toBe(prompt.indexOf("## User stories"));
    }
  });

  describe("in a repository with no commits yet", () => {
    const RULES_END = "rather than chaining them one after another through that file.";

    async function promptFor(greenfield: boolean, verifyCommand: string | null): Promise<string> {
      const runner = recordingRunner([ok(anEnvelope({ structured_output: { tickets: [] } }))]);
      await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
        kind: "break-into-tickets",
        context: aContext(),
        specMarkdown: "## Problem Statement\n\nExport the training log.",
        greenfield,
        verifyCommand,
        userStories: [],
        rejectionReason: null,
      });
      return valueOf(runner.invocations[0]!.args, "-p") as string;
    }

    it("adds one section after the rules: ticket 1 sets up the verify command, every other ticket depends on it", async () => {
      const plain = await promptFor(false, "pnpm test");
      const greenfield = await promptFor(true, "pnpm test");

      const section = [
        "## This repository has no commits yet",
        "",
        "The project's repository is empty, so its verify command does not work",
        "yet:",
        "",
        "```bash",
        "pnpm test",
        "```",
        "",
        "Ticket 1 sets up the project and its test runner so that this command,",
        "run from the repository root, runs and passes.",
        "Ticket 1's body names that command in its acceptance, written as inline",
        "code: `pnpm test`.",
        "Ticket 1 is a build ticket. Every other build ticket depends on ticket 1,",
        "directly or through another ticket's `blockedBy`; a gate need not.",
      ].join("\n");
      expect(plain).toContain(RULES_END);
      expect(greenfield).toBe(plain.replace(RULES_END, `${RULES_END}\n\n${section}`));
    });

    it("asks for no inline form when the command itself contains a backtick", async () => {
      const prompt = await promptFor(true, "echo `date`");

      expect(prompt).toContain("## This repository has no commits yet");
      expect(prompt).toContain("```bash\necho `date`\n```");
      expect(prompt).toContain("Ticket 1's body names that command in its acceptance.\n");
      expect(prompt).not.toContain("written as inline");
    });

    it.each([
      ["not greenfield, with a verify command", false, "pnpm test"],
      ["not greenfield, no project", false, null],
    ] as const)("%s: no section, and the prompt is byte for byte as without the new fields", async (_, greenfield, verifyCommand) => {
      const prompt = await promptFor(greenfield, verifyCommand);

      expect(prompt).not.toContain("## This repository has no commits yet");
      expect(prompt).not.toContain("pnpm test");
      // With no retry reason, today's prompt ends with the rules.
      expect(prompt.endsWith(RULES_END)).toBe(true);
      expect(prompt).toBe(await promptFor(false, null));
    });
  });

  it.each([
    ["not greenfield", false],
    ["greenfield", true],
  ] as const)("adds the user stories section last, only when the spec numbers stories: %s", async (_, greenfield) => {
    async function promptFor(userStories: number[]): Promise<string> {
      const runner = recordingRunner([ok(anEnvelope({ structured_output: { tickets: [] } }))]);
      await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
        kind: "break-into-tickets",
        context: aContext(),
        specMarkdown: "## Problem Statement\n\nExport the training log.",
        greenfield,
        verifyCommand: "pnpm test",
        userStories,
        rejectionReason: null,
      });
      return valueOf(runner.invocations[0]!.args, "-p") as string;
    }

    const without = await promptFor([]);
    const withStories = await promptFor([1, 2, 3, 5]);

    const section = [
      "## User stories",
      "",
      "The spec numbers its user stories: 1-3, 5.",
      "",
      "In each ticket's `implements`, list the numbers of the user stories that",
      "ticket builds, as the spec numbers them. Every one of those stories must be",
      "in the `implements` of at least one ticket. A ticket that builds no story,",
      "such as one that only sets up the project, leaves `implements` empty. A gate",
      "implements no story: leave its `implements` empty.",
    ].join("\n");

    expect(without).not.toContain("## User stories");
    expect(withStories).toBe(`${without}\n\n${section}`);
    if (greenfield) {
      expect(withStories).toContain(
        "directly or through another ticket's `blockedBy`; a gate need not.\n\n## User stories",
      );
    } else {
      expect(withStories).toContain(
        "rather than chaining them one after another through that file.\n\n## User stories",
      );
    }
  });

  describe("the tracked files", () => {
    const CHAIN_END = "rather than chaining them one after another through that file.";
    const GREENFIELD_END =
      "directly or through another ticket's `blockedBy`; a gate need not.";
    const NAMING_RULE = [
      "When a ticket creates, edits or reshapes something whose path or symbol you",
      "know from this list or from the project section above, name it in the",
      "ticket's body as inline code, such as `src/ingest/metrics.ts` or",
      "`exportFolder`. Name a path as existing only when this list or the",
      "project section shows it; a file the ticket creates may be named as a new",
      "path.",
    ].join("\n");
    const HEADING = [
      "## Files the repository tracks",
      "",
      "Tracked files only, with secret files left out: a path missing from this",
      "list is never evidence that a file does not exist.",
      "",
    ].join("\n");

    async function promptFor(options: {
      trackedFiles?: { files: string[]; omitted: number } | null;
      greenfield?: boolean;
      userStories?: number[];
    }): Promise<string> {
      const runner = recordingRunner([ok(anEnvelope({ structured_output: { tickets: [] } }))]);
      await createClaudeCliInterviewer({ runCli: runner.runCli }).breakIntoTickets({
        kind: "break-into-tickets",
        context: aContext(),
        specMarkdown: "## Problem Statement\n\nExport the training log.",
        greenfield: options.greenfield ?? false,
        verifyCommand: "pnpm test",
        userStories: options.userStories ?? [],
        rejectionReason: null,
        ...("trackedFiles" in options ? { trackedFiles: options.trackedFiles } : {}),
      });
      return valueOf(runner.invocations[0]!.args, "-p") as string;
    }

    it("renders null exactly as an absent field", async () => {
      expect(await promptFor({ trackedFiles: null })).toBe(await promptFor({}));
    });

    it("shows the tickets turn the tracked files and asks it to name what each ticket touches in backticks", async () => {
      const plain = await promptFor({});
      const listed = await promptFor({ trackedFiles: { files: ["src/a.ts"], omitted: 0 } });
      expect(listed).toBe(`${plain}\n\n${HEADING}\nsrc/a.ts\n\n${NAMING_RULE}`);
      expect(listed.endsWith(`${CHAIN_END}\n\n${HEADING}\nsrc/a.ts\n\n${NAMING_RULE}`)).toBe(true);

      const empty = await promptFor({ trackedFiles: { files: [], omitted: 0 } });
      expect(empty).toBe(`${plain}\n\n${HEADING}\nNo tracked files yet.\n\n${NAMING_RULE}`);

      const cut = await promptFor({ trackedFiles: { files: ["src/a.ts"], omitted: 5 } });
      expect(cut).toBe(
        `${plain}\n\n${HEADING}\nsrc/a.ts\n(and 5 more not listed)\n\n${NAMING_RULE}`,
      );

      const everything = await promptFor({
        greenfield: true,
        userStories: [1, 2],
        trackedFiles: { files: ["src/a.ts"], omitted: 0 },
      });
      const greenfieldIndex = everything.indexOf("## This repository has no commits yet");
      const filesIndex = everything.indexOf("## Files the repository tracks");
      const storiesIndex = everything.indexOf("## User stories");
      expect(everything).toContain(`${GREENFIELD_END}\n\n## Files the repository tracks`);
      expect(greenfieldIndex).toBeLessThan(filesIndex);
      expect(filesIndex).toBeLessThan(storiesIndex);
      expect(everything).toContain(`${NAMING_RULE}\n\n## User stories`);
      expect(everything.lastIndexOf("## ")).toBe(storiesIndex);
    });
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

describe("what each attempt costs and does", () => {
  const SESSION = "65f74ae9-6681-4ca7-89c9-efc3c8821877";

  /** An envelope carrying every usage field, with the counts the spike saw. */
  function aMeteredEnvelope(overrides: Record<string, unknown> = {}): string {
    return anEnvelope({
      usage: {
        input_tokens: 10,
        output_tokens: 165,
        cache_read_input_tokens: 13856,
        cache_creation_input_tokens: 33442,
        service_tier: "standard",
      },
      total_cost_usd: 0.0691046,
      num_turns: 3,
      duration_ms: 4188,
      duration_api_ms: 3601,
      ...overrides,
    });
  }

  const allMetrics = {
    inputTokens: 10,
    outputTokens: 165,
    cacheReadTokens: 13856,
    cacheCreationTokens: 33442,
    costUsd: 0.0691046,
    cliTurns: 3,
    cliDurationMs: 4188,
    cliApiDurationMs: 3601,
    sessionId: SESSION,
    toolCalls: { Read: 2 },
  };

  /** A reader that records what it was asked and answers `{ Read: 2 }`. */
  function aReader() {
    const queries: TranscriptQuery[] = [];
    return {
      queries,
      readToolCalls: (query: TranscriptQuery) => {
        queries.push(query);
        return { Read: 2 };
      },
    };
  }

  it("stores every field when all are present and numeric", async () => {
    const runner = recordingRunner([ok(aMeteredEnvelope())]);
    const reader = aReader();
    const { observer, ended } = recordingObserver();

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: reader.readToolCalls,
    }).proposeRound(aProposeRoundRequest(), observer);

    expect(ended).toHaveLength(1);
    expect(ended[0]!.outcome.kind).toBe("success");
    expect(ended[0]!.metrics).toEqual(allMetrics);
  });

  it("stores a missing or mistyped field as null, keeps the others, and leaves the turn unaffected", async () => {
    const runner = recordingRunner([
      ok(
        aMeteredEnvelope({
          usage: {
            input_tokens: "10",
            output_tokens: 165,
            cache_read_input_tokens: null,
          },
          total_cost_usd: "0.07",
          num_turns: undefined,
          duration_api_ms: 12.5,
        }),
      ),
    ]);
    const { observer, ended } = recordingObserver();

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: aReader().readToolCalls,
    }).proposeRound(aProposeRoundRequest(), observer);

    expect(turn.result).toEqual(aProposeRoundResult());
    expect(ended[0]!.metrics).toEqual({
      ...allMetrics,
      inputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
      cliTurns: null,
      cliApiDurationMs: null,
    });
  });

  it("still carries the usage of a call whose result failed its schema", async () => {
    const runner = recordingRunner([
      ok(aMeteredEnvelope({ structured_output: { nope: true } })),
    ]);
    const { observer, ended } = recordingObserver();

    const error = await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: aReader().readToolCalls,
    })
      .proposeRound(aProposeRoundRequest(), observer)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InterviewerError);
    expect((error as InterviewerError).code).toBe("malformed-output");
    expect((error as InterviewerError).metrics).toEqual(allMetrics);
    expect(ended[0]!.outcome.kind).toBe("schema-invalid");
    expect(ended[0]!.metrics).toEqual(allMetrics);
  });

  it("still carries the usage of a call the command line reported as an error", async () => {
    const runner = recordingRunner([
      ok(aMeteredEnvelope({ is_error: true, result: "Something broke." })),
    ]);
    const { observer, ended } = recordingObserver();

    await expect(
      createClaudeCliInterviewer({
        runCli: runner.runCli,
        readToolCalls: aReader().readToolCalls,
      }).proposeRound(aProposeRoundRequest(), observer),
    ).rejects.toThrow(InterviewerError);

    expect(ended[0]!.outcome.kind).toBe("error");
    expect(ended[0]!.metrics).toEqual(allMetrics);
  });

  it("carries the usage and tool calls of an error result the command line exits 1 on", async () => {
    // What the command line prints for `error_max_turns` and its kin: the
    // whole metered result, then exit code 1.
    const runner = recordingRunner([
      {
        stdout: aMeteredEnvelope({
          is_error: true,
          subtype: "error_max_turns",
          structured_output: undefined,
        }),
        stderr: "",
        exitCode: 1,
      },
    ]);
    const reader = aReader();
    const { observer, ended } = recordingObserver();

    const error = await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: reader.readToolCalls,
    })
      .proposeRound(aProposeRoundRequest(), observer)
      .catch((caught: unknown) => caught);

    expect((error as InterviewerError).code).toBe("failed");
    expect((error as InterviewerError).metrics).toEqual(allMetrics);
    expect(ended[0]!.outcome.kind).toBe("error");
    expect(ended[0]!.metrics).toEqual(allMetrics);
    expect(reader.queries).toHaveLength(1);
  });

  it("keeps a count past 32 bits and nulls one JavaScript cannot represent exactly", async () => {
    const runner = recordingRunner([
      ok(
        aMeteredEnvelope({
          usage: {
            input_tokens: 3_000_000_000,
            output_tokens: 2 ** 60,
            cache_read_input_tokens: 13856,
            cache_creation_input_tokens: 33442,
          },
        }),
      ),
    ]);
    const { observer, ended } = recordingObserver();

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: aReader().readToolCalls,
    }).proposeRound(aProposeRoundRequest(), observer);

    expect(ended[0]!.metrics).toMatchObject({
      inputTokens: 3_000_000_000,
      outputTokens: null,
    });
  });

  it("carries no usage and reads no transcript when the output is not JSON", async () => {
    const runner = recordingRunner([ok("this is not json")]);
    const reader = aReader();
    const { observer, ended } = recordingObserver();

    const error = await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: reader.readToolCalls,
    })
      .proposeRound(aProposeRoundRequest(), observer)
      .catch((caught: unknown) => caught);

    expect((error as InterviewerError).metrics).toBeNull();
    expect(ended[0]!.outcome.kind).toBe("schema-invalid");
    expect(ended[0]!.metrics).toBeUndefined();
    expect(reader.queries).toEqual([]);
  });

  it("carries no usage and reads no transcript when the process fails", async () => {
    const runner = recordingRunner([
      { stdout: "", stderr: "boom", exitCode: 1 },
    ]);
    const reader = aReader();
    const { observer, ended } = recordingObserver();

    await expect(
      createClaudeCliInterviewer({
        runCli: runner.runCli,
        readToolCalls: reader.readToolCalls,
      }).proposeRound(aProposeRoundRequest(), observer),
    ).rejects.toThrow(InterviewerError);

    expect(ended[0]!.outcome.kind).toBe("error");
    expect(ended[0]!.metrics).toBeUndefined();
    expect(reader.queries).toEqual([]);
  });

  it("asks the reader for the child's config dir, cwd and session, from just before the child started", async () => {
    const reader = aReader();
    let spawnedAt = 0;
    const before = Date.now();

    await createClaudeCliInterviewer({
      runCli: () => {
        spawnedAt = Date.now();
        return Promise.resolve(ok(aMeteredEnvelope()));
      },
      cwd: "/fixture/interview-cwd",
      env: { PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/fixture/config" },
      readToolCalls: reader.readToolCalls,
    }).proposeRound(aProposeRoundRequest());

    expect(reader.queries).toHaveLength(1);
    const [query] = reader.queries;
    expect(query).toMatchObject({
      configDir: "/fixture/config",
      cwd: "/fixture/interview-cwd",
      sessionId: SESSION,
    });
    expect(query!.since.getTime()).toBeGreaterThanOrEqual(before);
    expect(query!.since.getTime()).toBeLessThanOrEqual(spawnedAt);
  });

  it("reads a scout's transcript from the project root it ran in", async () => {
    const reader = aReader();
    const runner = recordingRunner([
      ok(aMeteredEnvelope({ structured_output: aScoutProjectResult() })),
    ]);

    await createClaudeCliInterviewer({
      runCli: runner.runCli,
      env: { PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/fixture/config" },
      readToolCalls: reader.readToolCalls,
    }).scoutProject(aScoutProjectRequest({ projectRoot: "/fixture/project" }));

    expect(reader.queries[0]).toMatchObject({ cwd: "/fixture/project" });
    expect(runner.invocations[0]!.cwd).toBe("/fixture/project");
  });

  it("never fails the turn when the transcript read throws", async () => {
    const runner = recordingRunner([ok(aMeteredEnvelope())]);
    const { observer, ended } = recordingObserver();

    const turn = await createClaudeCliInterviewer({
      runCli: runner.runCli,
      readToolCalls: () => {
        throw new Error("EACCES: the transcript folder is locked");
      },
    }).proposeRound(aProposeRoundRequest(), observer);

    expect(turn.result).toEqual(aProposeRoundResult());
    expect(ended[0]!.outcome.kind).toBe("success");
    expect(ended[0]!.metrics).toEqual({ ...allMetrics, toolCalls: null });
  });

  it("counts only this attempt's tool calls in a resumed conversation's transcript", async () => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "claude-cli-transcript-")),
    );
    try {
      const configDir = path.join(root, "config");
      const cwd = path.join(root, "cwd");
      await mkdir(cwd, { recursive: true });
      const file = transcriptPath({ configDir, cwd, sessionId: SESSION });
      await mkdir(path.dirname(file), { recursive: true });

      const line = (timestamp: string, ...names: string[]) =>
        JSON.stringify({
          type: "assistant",
          timestamp,
          message: {
            content: names.map((name, index) => ({
              type: "tool_use",
              id: `${timestamp}-${index}`,
              name,
            })),
          },
        });
      // An earlier turn of the same conversation, long before this attempt.
      await writeFile(
        file,
        `${line("2020-01-01T00:00:00.000Z", "Read", "Read", "Grep")}\n`,
      );

      const { observer, ended } = recordingObserver();
      await createClaudeCliInterviewer({
        runCli: async () => {
          // What this attempt writes while it runs.
          const now = new Date().toISOString();
          await appendFile(file, `${line(now, "Glob", "Read")}\n`);
          return ok(aMeteredEnvelope());
        },
        cwd,
        env: { PATH: "/usr/bin", CLAUDE_CONFIG_DIR: configDir },
      }).proposeRound(
        aProposeRoundRequest({
          context: { ...aProposeRoundRequest().context, conversationId: SESSION },
        }),
        observer,
      );

      expect(ended[0]!.metrics?.toolCalls).toEqual({ Glob: 1, Read: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the citation rule the scouts are told", () => {
  const CUT_RULE = [
    "Every citation is a path relative to the project root, a colon, and a",
    "line number or an inclusive line range: `src/server.ts:42` or",
    "`docs/adr/0003-queue.md:5-12`. Cite only files you actually opened and",
    "lines you actually read, and never invent a path. Read numbers every",
    "line, and the last numbered line is the file's length. The app checks",
    "every citation against the repository: a range that runs past the end",
    "is cut to the last line, and a citation that starts past the end, or a",
    "path that does not exist, rejects the whole report.",
  ].join("\n");

  async function promptOfFirstInvocation(
    structuredOutput: unknown,
    run: (interviewer: ReturnType<typeof createClaudeCliInterviewer>) => Promise<unknown>,
  ): Promise<string> {
    const runner = recordingRunner([ok(anEnvelope({ structured_output: structuredOutput }))]);
    await run(createClaudeCliInterviewer({ runCli: runner.runCli }));
    return valueOf(runner.invocations[0].args, "-p") as string;
  }

  it("tells the scouts a range past the end is cut and a start past the end is refused", async () => {
    const projectScout = await promptOfFirstInvocation(aScoutProjectResult(), (interviewer) =>
      interviewer.scoutProject(aScoutProjectRequest({ projectRoot: "/Users/someone/p" })),
    );
    const handoffScout = await promptOfFirstInvocation(aHandoffScoutResult(), (interviewer) =>
      interviewer.scoutHandoff(aHandoffScoutRequest({ projectRoot: "/Users/someone/p" })),
    );
    const readiness = await promptOfFirstInvocation(anAssessReadinessResult(), (interviewer) =>
      interviewer.assessReadiness(anAssessReadinessRequest()),
    );

    expect(projectScout).toContain(CUT_RULE);
    expect(handoffScout).toContain(CUT_RULE);
    for (const prompt of [projectScout, handoffScout, readiness]) {
      expect(prompt).not.toContain("if any one is wrong");
    }
  });
});
