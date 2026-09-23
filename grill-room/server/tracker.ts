import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The declared tracker: a front-matter block with three fixed keys at the
 * very top of `docs/agents/issue-tracker.md`, relative to a project's root.
 *
 * Accepted shape, YAML-style, between two `---` lines:
 *
 *     ---
 *     tickets_dir: .scratch/tickets
 *     ticket_format: "{seq}-{slug}"
 *     commands:
 *       claim: bd update {id} --claim
 *       close: bd close {id}
 *     ---
 *
 * - `tickets_dir` — a folder relative to the project root. It must not be an
 *   absolute path, and must not resolve outside the root.
 * - `ticket_format` — a slug pattern using the same placeholders a project's
 *   `slugPattern` accepts (e.g. `{seq}`, `{date}`, `{slug}`). It names one
 *   folder, so it may not contain a path separator or `..`.
 * - `commands` — a map of command name to shell command, one `name: command`
 *   pair per line, indented under `commands:`.
 *
 * This is a small, strict parser for exactly this fixed shape, not a general
 * YAML parser: anything outside it (nested blocks, multi-line scalars,
 * anchors, flow style) is not recognised and the surrounding key is treated
 * as missing.
 *
 * A missing file, or a file whose first line is not `---` (prose only, or no
 * block at all), reads as "no tracker": the fixed layout applies with no
 * diagnostic. A block that is present but missing a key, or whose
 * `tickets_dir`/`ticket_format` is invalid, reads as "invalid": the
 * diagnostic names the offending key, and the fixed layout still applies.
 */
export const TRACKER_FILE_RELATIVE_PATH = "docs/agents/issue-tracker.md";

export interface ProjectTracker {
  ticketsDir: string;
  ticketFormat: string;
  commands: Record<string, string>;
}

export type TrackerReadResult =
  | { kind: "none" }
  | { kind: "valid"; tracker: ProjectTracker }
  | { kind: "invalid"; diagnostic: string };

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

interface ParsedBlock {
  ticketsDir?: string;
  ticketFormat?: string;
  commands?: Record<string, string>;
}

/** Parse the lines strictly between the two `---` markers. */
function parseBlock(lines: string[]): ParsedBlock {
  const result: ParsedBlock = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }

    const scalar = /^(tickets_dir|ticket_format):\s*(.*)$/.exec(line);
    if (scalar) {
      const value = stripQuotes(scalar[2]!.trim());
      if (scalar[1] === "tickets_dir") result.ticketsDir = value;
      else result.ticketFormat = value;
      i++;
      continue;
    }

    if (/^commands:\s*$/.test(line)) {
      const commands: Record<string, string> = {};
      i++;
      while (i < lines.length) {
        const sub = lines[i] ?? "";
        if (sub.trim() === "") {
          i++;
          continue;
        }
        const entry = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(sub);
        if (!entry) break;
        commands[entry[1]!] = stripQuotes(entry[2]!.trim());
        i++;
      }
      result.commands = commands;
      continue;
    }

    // Anything else (an unrecognised top-level line) is skipped rather than
    // failing the whole block; the missing/invalid-key checks below catch
    // whatever that left out.
    i++;
  }
  return result;
}

function checkTicketsDir(
  root: string,
  ticketsDir: string,
): { value: string } | { diagnostic: string } {
  if (ticketsDir.length === 0) {
    return { diagnostic: `The tracker block's "tickets_dir" is empty.` };
  }
  if (path.isAbsolute(ticketsDir)) {
    return {
      diagnostic: `The tracker block's "tickets_dir" must be a relative path: ${ticketsDir}`,
    };
  }
  const resolved = path.resolve(root, ticketsDir);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      diagnostic: `The tracker block's "tickets_dir" must resolve inside the project root: ${ticketsDir}`,
    };
  }
  return { value: relative.split(path.sep).join("/") };
}

function checkTicketFormat(ticketFormat: string): { value: string } | { diagnostic: string } {
  if (ticketFormat.length === 0) {
    return { diagnostic: `The tracker block's "ticket_format" is empty.` };
  }
  if (/[\\/]/.test(ticketFormat) || ticketFormat.includes("..")) {
    return {
      diagnostic: `The tracker block's "ticket_format" names one folder, so it cannot contain a path separator or "..": ${ticketFormat}`,
    };
  }
  return { value: ticketFormat };
}

/**
 * Read and parse a project's declared tracker at `root`. A plain filesystem
 * read only — this never runs git, and never writes anything.
 */
export function readProjectTracker(root: string): TrackerReadResult {
  let content: string;
  try {
    content = readFileSync(path.join(root, TRACKER_FILE_RELATIVE_PATH), "utf8");
  } catch {
    return { kind: "none" };
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { kind: "none" };
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { kind: "none" };

  const parsed = parseBlock(lines.slice(1, closingIndex));

  if (parsed.ticketsDir === undefined) {
    return {
      kind: "invalid",
      diagnostic: `The tracker block at ${TRACKER_FILE_RELATIVE_PATH} is missing "tickets_dir".`,
    };
  }
  const ticketsDir = checkTicketsDir(root, parsed.ticketsDir);
  if ("diagnostic" in ticketsDir) return { kind: "invalid", diagnostic: ticketsDir.diagnostic };

  if (parsed.ticketFormat === undefined) {
    return {
      kind: "invalid",
      diagnostic: `The tracker block at ${TRACKER_FILE_RELATIVE_PATH} is missing "ticket_format".`,
    };
  }
  const ticketFormat = checkTicketFormat(parsed.ticketFormat);
  if ("diagnostic" in ticketFormat) return { kind: "invalid", diagnostic: ticketFormat.diagnostic };

  if (parsed.commands === undefined) {
    return {
      kind: "invalid",
      diagnostic: `The tracker block at ${TRACKER_FILE_RELATIVE_PATH} is missing "commands".`,
    };
  }

  return {
    kind: "valid",
    tracker: {
      ticketsDir: ticketsDir.value,
      ticketFormat: ticketFormat.value,
      commands: parsed.commands,
    },
  };
}
