/**
 * Counts the tool calls one attempt made, by name, from the session transcript
 * the Claude Code command line writes for every conversation.
 *
 * This depends on Claude Code's own folder layout, which is not a published
 * contract: `<config dir>/projects/<encoded cwd>/<session id>.jsonl`, one JSON
 * object per line. Nothing here may fail a turn: every problem reads as null.
 */
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ToolCallCounts } from "./types.js";

/** Where one attempt's transcript lives, and which of its lines are the attempt's. */
export interface TranscriptQuery {
  /** The command line's config directory: `$CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  configDir: string;
  /** The working directory the child ran in. */
  cwd: string;
  sessionId: string;
  /** Lines stamped before this belong to earlier turns of a resumed conversation. */
  since: Date;
}

/** Reads one attempt's tool calls. The adapter's seam; tests inject their own. */
export type ToolCallReader = (query: TranscriptQuery) => ToolCallCounts | null;

/** The config directory a child run with `env` writes its transcripts under. */
export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
}

/**
 * The folder name the command line files a working directory's transcripts
 * under: the directory with symlinks resolved, every character that is not an
 * ASCII letter or digit replaced by `-`. So `/Users/me/repos/app/.claude/x`
 * becomes `-Users-me-repos-app--claude-x`, and on macOS `/tmp/x` becomes
 * `-private-tmp-x`, since `/tmp` links to `/private/tmp`.
 *
 * A name longer than {@link MAX_FOLDER_NAME_LENGTH} is cut to that length and
 * suffixed with `-` and a hash of the unreplaced directory: the 32-bit string
 * hash `h = h * 31 + charCode`, made non-negative, in base 36.
 */
export function projectFolderName(cwd: string): string {
  let resolved = cwd;
  try {
    resolved = realpathSync(cwd);
  } catch {
    // A directory that no longer exists is named as given.
  }
  const name = resolved.replace(/[^A-Za-z0-9]/g, "-");
  if (name.length <= MAX_FOLDER_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_FOLDER_NAME_LENGTH)}-${Math.abs(stringHash(resolved)).toString(36)}`;
}

/** The longest folder name the command line uses before it cuts and hashes. */
export const MAX_FOLDER_NAME_LENGTH = 200;

/** The command line's 32-bit string hash: `h = (h << 5) - h + charCode`, kept to 32 bits. */
function stringHash(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return hash;
}

export function transcriptPath(
  query: Pick<TranscriptQuery, "configDir" | "cwd" | "sessionId">,
): string {
  return path.join(
    query.configDir,
    "projects",
    projectFolderName(query.cwd),
    `${query.sessionId}.jsonl`,
  );
}

/**
 * Counts the `tool_use` blocks of the assistant messages written at or after
 * `since`, by tool name. A line that is not JSON, or carries no readable
 * timestamp, is skipped. Null when the file is missing or cannot be read.
 */
export const readToolCalls: ToolCallReader = (query) => {
  let text: string;
  try {
    text = readFileSync(transcriptPath(query), "utf8");
  } catch {
    return null;
  }

  const since = query.since.getTime();
  const counts: ToolCallCounts = {};
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.type !== "assistant") continue;
    if (typeof entry.timestamp !== "string") continue;
    const stamped = Date.parse(entry.timestamp);
    if (Number.isNaN(stamped) || stamped < since) continue;

    const content = isRecord(entry.message) ? entry.message.content : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use") continue;
      if (typeof block.name !== "string" || !block.name) continue;
      // The same block written twice is still one call.
      if (typeof block.id === "string") {
        if (seen.has(block.id)) continue;
        seen.add(block.id);
      }
      counts[block.name] = (counts[block.name] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
