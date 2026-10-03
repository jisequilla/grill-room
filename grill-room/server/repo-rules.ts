import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import picomatch from "picomatch";
import YAML from "yaml";

import { isInside, readableDoc } from "./handoff-fact-pack.js";
import { lineCount } from "./scout-report.js";

export interface RuleSource {
  path: string;
  globs: string[] | null;
  lineCount: number;
}

const ROOT_RULE_DOCS = ["CLAUDE.md", "AGENTS.md"];
const RULES_FOLDER = ".claude/rules";

function frontmatterLines(text: string): string[] | null {
  const lines = text
    .replace(/^﻿/, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  if (lines[0] !== "---") return null;
  const closing = lines.indexOf("---", 1);
  return closing === -1 ? null : lines.slice(1, closing);
}

function trimmedStrings(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readGlobs(text: string): string[] | null {
  const lines = frontmatterLines(text);
  if (!lines) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(lines.join("\n"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>).paths;
  const globs =
    typeof value === "string"
      ? trimmedStrings([value])
      : Array.isArray(value)
        ? trimmedStrings(value)
        : [];
  return globs.length > 0 ? globs : null;
}

function ruleFileNames(realRoot: string): string[] {
  let realRules: string;
  try {
    realRules = realpathSync(path.join(realRoot, RULES_FOLDER));
  } catch {
    return [];
  }
  if (!isInside(realRoot, realRules)) return [];
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
      else if (entry.name.endsWith(".md")) found.push(name);
    }
  };
  walk(realRules, "");
  return found.sort().map((name) => path.relative(realRoot, path.join(realRules, name)));
}

export function collectRuleSources(root: string): RuleSource[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const sources: RuleSource[] = [];
  for (const name of [...ROOT_RULE_DOCS, ...ruleFileNames(realRoot)]) {
    const doc = readableDoc(realRoot, name);
    if (!doc || seen.has(doc.relative)) continue;
    seen.add(doc.relative);
    sources.push({
      path: doc.relative,
      globs: readGlobs(doc.text),
      lineCount: lineCount(doc.text),
    });
  }
  return sources;
}

export function rulesForFiles(
  sources: RuleSource[],
  files: string[],
): { globMatched: { path: string; files: string[] }[]; unconditional: string[] } {
  const globMatched: { path: string; files: string[] }[] = [];
  const unconditional: string[] = [];
  for (const source of sources) {
    const globs = source.globs;
    if (!globs || globs.length === 0) {
      unconditional.push(source.path);
      continue;
    }
    const matched = files.filter((file) =>
      globs.some((glob) => picomatch.isMatch(file, glob, { dot: true })),
    );
    if (matched.length > 0) globMatched.push({ path: source.path, files: matched });
  }
  return { globMatched, unconditional };
}
