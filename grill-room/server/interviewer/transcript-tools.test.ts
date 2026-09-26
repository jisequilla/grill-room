import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClaudeCliInterviewer } from "./claude-cli.js";
import { aProposeRoundRequest, aProposeRoundResult } from "./test-fixtures.js";
import {
  claudeConfigDir,
  projectFolderName,
  readToolCalls,
  transcriptPath,
  type TranscriptQuery,
} from "./transcript-tools.js";
import type { ModelCallEnd } from "./types.js";

/*
 * Every transcript here is hand-written into a fixture config directory: the
 * reader never sees the real `~/.claude`.
 */

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const SINCE = new Date("2026-09-26T10:00:00.000Z");
const BEFORE = "2026-09-26T09:59:59.999Z";
const AT = "2026-09-26T10:00:00.000Z";
const AFTER = "2026-09-26T10:00:05.000Z";

let root: string;
let configDir: string;
let cwd: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "transcript-tools-")));
  configDir = path.join(root, "config");
  cwd = path.join(root, "work dir.project");
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let blockId = 0;

/** One assistant transcript line holding the given content blocks. */
function assistant(timestamp: string, ...blocks: object[]): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    sessionId: SESSION_ID,
    message: { role: "assistant", content: blocks },
  });
}

function toolUse(name: string): object {
  blockId += 1;
  return { type: "tool_use", id: `toolu_${blockId}`, name, input: {} };
}

function text(value: string): object {
  return { type: "text", text: value };
}

/** A user line carrying a tool result, as the command line writes one after each call. */
function toolResult(timestamp: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }],
    },
  });
}

async function writeTranscript(lines: string[]): Promise<void> {
  const file = transcriptPath({ configDir, cwd, sessionId: SESSION_ID });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

function read() {
  return readToolCalls({ configDir, cwd, sessionId: SESSION_ID, since: SINCE });
}

describe("where a transcript lives", () => {
  it("replaces every character that is not an ASCII letter or digit with a dash", () => {
    expect(projectFolderName("/no/such/Users/me/repos/app/.claude/x_y z")).toBe(
      "-no-such-Users-me-repos-app--claude-x-y-z",
    );
  });

  it("names a symlinked directory by the directory it points at", async () => {
    const link = path.join(root, "link");
    await symlink(cwd, link);
    expect(projectFolderName(link)).toBe(projectFolderName(cwd));
    expect(projectFolderName(cwd)).toBe(cwd.replace(/[^A-Za-z0-9]/g, "-"));
  });

  it("keeps a name of exactly 200 characters whole", () => {
    const cwd200 = `/${"b".repeat(199)}`;
    expect(projectFolderName(cwd200)).toBe(`-${"b".repeat(199)}`);
  });

  it("cuts a name over 200 characters to 200 and suffixes a hash of the directory", () => {
    const long = `/no/such/${"a".repeat(250)}`;
    expect(projectFolderName(long)).toBe(
      `${`-no-such-${"a".repeat(250)}`.slice(0, 200)}-g7n155`,
    );
  });

  it("files it under the config directory's projects folder, by session id", () => {
    expect(transcriptPath({ configDir, cwd, sessionId: SESSION_ID })).toBe(
      path.join(configDir, "projects", projectFolderName(cwd), `${SESSION_ID}.jsonl`),
    );
  });

  it("resolves the default config directory under the suite's temp home, never the real one", () => {
    // The account's home from the user database, which `HOME` does not change.
    const realHome = userInfo().homedir;
    const resolved = claudeConfigDir(process.env);

    expect(resolved.startsWith(`${realHome}${path.sep}`)).toBe(false);
    expect(path.basename(path.dirname(resolved))).toMatch(/^grill-room-test-home-/);
    expect(resolved.startsWith(tmpdir())).toBe(true);
  });

  it("uses CLAUDE_CONFIG_DIR when the child runs with it, otherwise ~/.claude", () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/fixture/config" })).toBe(
      "/fixture/config",
    );
    expect(claudeConfigDir({})).toMatch(/[/\\]\.claude$/);
  });
});

describe("counting one attempt's tool calls", () => {
  it("counts this attempt's tool_use blocks by name", async () => {
    await writeTranscript([
      assistant(AT, toolUse("Read"), toolUse("Grep")),
      toolResult(AFTER),
      assistant(AFTER, toolUse("Read")),
      assistant(AFTER, toolUse("Glob"), text("Looking around.")),
      assistant(AFTER, toolUse("Read"), toolUse("Glob")),
    ]);

    expect(read()).toEqual({ Glob: 2, Grep: 1, Read: 3 });
  });

  it("returns the counts with their tool names in sorted order", async () => {
    await writeTranscript([
      assistant(AFTER, toolUse("Read"), toolUse("Grep"), toolUse("Glob")),
      assistant(AFTER, toolUse("Read")),
    ]);

    expect(JSON.stringify(read())).toBe('{"Glob":1,"Grep":1,"Read":2}');
  });

  it("counts a tool_use block written twice with the same id once", async () => {
    const repeated = toolUse("Read");
    await writeTranscript([
      assistant(AFTER, repeated),
      assistant(AFTER, repeated, toolUse("Read")),
    ]);

    expect(read()).toEqual({ Read: 2 });
  });

  it("counts only the lines written at or after the attempt started, in a resumed conversation", async () => {
    await writeTranscript([
      assistant(BEFORE, toolUse("Read"), toolUse("Read"), toolUse("Bash")),
      toolResult(BEFORE),
      assistant(BEFORE, toolUse("Grep")),
      assistant(AT, toolUse("Read")),
      assistant(AFTER, toolUse("Glob")),
    ]);

    expect(read()).toEqual({ Glob: 1, Read: 1 });
  });

  it("stores {} when this attempt's lines hold no tool_use blocks", async () => {
    await writeTranscript([
      assistant(BEFORE, toolUse("Read")),
      assistant(AFTER, text("Here is the round.")),
    ]);

    expect(read()).toEqual({});
  });

  it("is null when the transcript file is missing", () => {
    expect(read()).toBeNull();
  });

  it("is null when the transcript cannot be read", async () => {
    // A directory where the file should be: it exists, but reading it fails.
    await mkdir(transcriptPath({ configDir, cwd, sessionId: SESSION_ID }), {
      recursive: true,
    });

    expect(read()).toBeNull();
  });

  it("skips a line that is not JSON and counts the rest", async () => {
    await writeTranscript([
      assistant(AFTER, toolUse("Read")),
      '{"type":"assistant","timestamp":"2026-09-26T10:00:06.000Z","message":{"content":[{"type":"tool_use","na',
      assistant(AFTER, toolUse("Grep")),
    ]);

    expect(read()).toEqual({ Grep: 1, Read: 1 });
  });

  it("does not count tool_use blocks outside assistant messages", async () => {
    await writeTranscript([
      JSON.stringify({
        type: "user",
        timestamp: AFTER,
        message: { content: [toolUse("Read")] },
      }),
      assistant(AFTER, toolUse("Grep")),
    ]);

    expect(read()).toEqual({ Grep: 1 });
  });

  it("reads nothing, and stores null, when the attempt has no session id", async () => {
    await writeTranscript([assistant(AFTER, toolUse("Read"))]);
    const queries: TranscriptQuery[] = [];
    const ended: ModelCallEnd[] = [];

    await createClaudeCliInterviewer({
      runCli: () =>
        Promise.resolve({
          stdout: JSON.stringify({
            structured_output: aProposeRoundResult(),
            is_error: false,
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          stderr: "",
          exitCode: 0,
        }),
      cwd,
      env: { CLAUDE_CONFIG_DIR: configDir },
      readToolCalls: (query) => {
        queries.push(query);
        return readToolCalls(query);
      },
    })
      .proposeRound(aProposeRoundRequest(), {
        callEnded: (call) => {
          ended.push(call);
        },
      })
      .catch(() => undefined);

    expect(queries).toEqual([]);
    expect(ended[0]?.metrics).toMatchObject({
      inputTokens: 10,
      sessionId: null,
      toolCalls: null,
    });
  });
});
