import { readFile } from "node:fs/promises";

import { fakeScenarios } from "./fake.js";
import type { Scenario, ScriptedTurn } from "./fake.js";
import { resultSchemas } from "./schemas.js";
import type { RequestKind } from "./schemas.js";

/** Whether `value` is a key of `resultSchemas`, i.e. a real request kind. */
function isRequestKind(value: unknown): value is RequestKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(resultSchemas, value)
  );
}

/** A recording line that failed to become a scripted turn, with its 1-based line number. */
class RecordingLoadError extends Error {
  constructor(file: string, line: number, reason: string) {
    super(`Recording ${file}, line ${line}: ${reason}`);
    this.name = "RecordingLoadError";
  }
}

/**
 * Reads a recording written by the real adapter's recording mode
 * (`GRILL_ROOM_RECORD_TURNS`, one JSON line per accepted turn — `{ kind,
 * result }`) into a {@link Scenario} whose turns replay in the file's order.
 *
 * Every non-blank line is validated against `resultSchemas[kind]`, exactly as
 * the real adapter validated it before writing. The first line that is not
 * valid JSON, is not a `{ kind, result }` object, names a kind with no
 * schema, or fails that schema refuses the whole file, naming the 1-based
 * line number so a stale recording fails loudly instead of misbehaving.
 */
export async function loadRecording(file: string): Promise<Scenario> {
  const content = await readFile(file, "utf8");
  const turns: ScriptedTurn[] = [];

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const lineNumber = index + 1;

    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new RecordingLoadError(file, lineNumber, "not valid JSON.");
    }

    if (
      typeof entry !== "object" ||
      entry === null ||
      !("kind" in entry) ||
      !("result" in entry)
    ) {
      throw new RecordingLoadError(
        file,
        lineNumber,
        `expected an object with "kind" and "result".`,
      );
    }

    const { kind, result } = entry as { kind: unknown; result: unknown };
    if (!isRequestKind(kind)) {
      throw new RecordingLoadError(
        file,
        lineNumber,
        `unknown request kind ${JSON.stringify(kind)}.`,
      );
    }

    const parsed = resultSchemas[kind].safeParse(result);
    if (!parsed.success) {
      throw new RecordingLoadError(
        file,
        lineNumber,
        `the "${kind}" result does not match its schema: ${JSON.stringify(
          parsed.error.issues,
        ).slice(0, 1000)}`,
      );
    }

    turns.push({ kind, result: parsed.data } as ScriptedTurn);
  }

  return { turns };
}

/**
 * Loads a recording and registers it in {@link fakeScenarios} under `name`, so
 * a test or `just demo` walk can select it like any other scenario. One call:
 * load, validate, register. Replaces any scenario already registered under
 * that name; throws whatever {@link loadRecording} throws without registering
 * anything.
 */
export async function registerRecording(name: string, file: string): Promise<void> {
  const scenario = await loadRecording(file);
  fakeScenarios[name] = scenario;
}
