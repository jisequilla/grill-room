import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resultSchemas } from "./schemas.js";
import type { RequestKind } from "./schemas.js";
import type { Scenario, ScriptedTurn } from "./fake.js";

/** Name the demo scenario is registered under in {@link fakeScenarios}. */
export const DEMO_SCENARIO = "demo";

/**
 * The recorded demo session, committed as a fixture: one real interview,
 * grilled against this repository with `GRILL_ROOM_RECORD_TURNS` (see
 * `.grill-room/regression-scenarios/issues/05-recorded-demo.md`), reviewed and
 * checked in. `e2e/demo.spec.ts` replays it. Resolved relative to this file
 * rather than the process cwd, so it is found the same way whichever
 * directory the server is started from.
 */
const DEMO_RECORDING_PATH = fileURLToPath(
  new URL("../../e2e/fixtures/demo-recording.jsonl", import.meta.url),
);

/** Whether `value` is a key of `resultSchemas`, i.e. a real request kind. */
function isRequestKind(value: unknown): value is RequestKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(resultSchemas, value)
  );
}

/**
 * Loads the committed demo recording synchronously, so it can be added to
 * `fakeScenarios` at module load time alongside every other named scenario.
 *
 * This mirrors `loadRecording` in `./recording.ts` rather than importing it:
 * `recording.ts` already imports `fakeScenarios` from `./fake.ts`, and
 * `fake.ts` imports this module to register the demo scenario, so importing
 * `recording.ts` here as well would close a cycle. The duplication is a
 * dozen lines; the alternative is a load-bearing cycle between the two
 * modules that own the scenario registry.
 *
 * Returns null, rather than throwing, when the fixture file is missing —
 * for instance a build that does not ship `e2e/` — so an ordinary server
 * boot never fails over a demo-only fixture. A fixture that exists but
 * fails to parse or fails its request kind's schema still throws: that is a
 * stale or corrupt fixture, worth surfacing immediately rather than serving
 * silently wrong turns to the one test that replays it.
 */
export function loadDemoScenario(): Scenario | null {
  if (!existsSync(DEMO_RECORDING_PATH)) return null;

  const content = readFileSync(DEMO_RECORDING_PATH, "utf8");
  const turns: ScriptedTurn[] = [];

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim();
    if (!line) continue;
    const lineNumber = index + 1;

    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error(`Demo recording ${DEMO_RECORDING_PATH}, line ${lineNumber}: not valid JSON.`);
    }

    if (
      typeof entry !== "object" ||
      entry === null ||
      !("kind" in entry) ||
      !("result" in entry)
    ) {
      throw new Error(
        `Demo recording ${DEMO_RECORDING_PATH}, line ${lineNumber}: expected an object with "kind" and "result".`,
      );
    }

    const { kind, result } = entry as { kind: unknown; result: unknown };
    if (!isRequestKind(kind)) {
      throw new Error(
        `Demo recording ${DEMO_RECORDING_PATH}, line ${lineNumber}: unknown request kind ${JSON.stringify(kind)}.`,
      );
    }

    const parsed = resultSchemas[kind].safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `Demo recording ${DEMO_RECORDING_PATH}, line ${lineNumber}: the "${kind}" result does not match its schema: ${JSON.stringify(
          parsed.error.issues,
        ).slice(0, 1000)}`,
      );
    }

    turns.push({ kind, result: parsed.data } as ScriptedTurn);
  }

  return { turns };
}
