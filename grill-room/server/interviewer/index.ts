import { createClaudeCliInterviewer } from "./claude-cli.js";
import {
  cannedInterviewTurns,
  createFakeInterviewer,
  type FakeInterviewer,
  type ScriptedTurn,
} from "./fake.js";
import type { Interviewer } from "./types.js";

export * from "./errors.js";
export * from "./schemas.js";
export * from "./types.js";
export {
  createClaudeCliInterviewer,
  DOCS_MODE_TOOLS,
  SCOUT_DENY_RULES,
  SCOUT_SECRET_FILE_PATTERNS,
} from "./claude-cli.js";
export type {
  CliInvocation,
  CliOutcome,
  CliRunner,
  ClaudeCliOptions,
} from "./claude-cli.js";
export {
  cannedInterviewTurns,
  createFakeInterviewer,
  FAKE_CONVERSATION_ID,
  rateLimitedTurn,
  schemaInvalidTurn,
  treeRuleViolation,
  withResumeFallback,
} from "./fake.js";
export type {
  FakeInterviewer,
  ScriptedError,
  ScriptedInvalidResult,
  ScriptedResult,
  ScriptedTurn,
} from "./fake.js";
export { outcomeOfFailure } from "./observe.js";
export { buildPrompt } from "./prompt.js";
export {
  APP_ADDENDUM,
  DOCS_FOLDER_ADDENDUM,
  GRILLING_SKILL_FILE,
  interviewerInstructions,
  loadGrillingSkill,
  loadSpecTemplate,
  SPEC_TEMPLATE_FILE,
} from "./instructions.js";

/**
 * Which adapter the app talks to.
 *
 * `fake` serves the canned interview, which is what the browser smoke test runs
 * against. Anything else, including unset, is the real command line adapter.
 */
export const INTERVIEWER_ENV_VAR = "GRILL_ROOM_INTERVIEWER";

let configured: Interviewer | undefined;
let override: Interviewer | undefined;

/**
 * The interviewer the app should use. Every caller goes through this rather
 * than constructing an adapter, so tests can substitute the fake in one place.
 */
export function getInterviewer(): Interviewer {
  if (override) return override;
  configured ??=
    process.env[INTERVIEWER_ENV_VAR] === "fake"
      ? createFakeInterviewer(cannedInterviewTurns())
      : createClaudeCliInterviewer();
  return configured;
}

/** Substitutes an interviewer for the rest of the process. Tests only. */
export function setInterviewer(interviewer: Interviewer): void {
  override = interviewer;
}

/** Drops any substitution and the cached adapter. */
export function resetInterviewer(): void {
  override = undefined;
  configured = undefined;
}

/**
 * Scripts the fake interviewer and installs it, so `getInterviewer()` returns
 * it for the rest of the test. One import and one call is all an action test
 * needs:
 *
 * ```ts
 * const interviewer = scriptInterviewer([
 *   { kind: "propose-round", result: { ... } },
 * ]);
 * await submitRound.run({ ... });
 * expect(interviewer.requests[0]).toMatchObject({ kind: "propose-round" });
 * ```
 */
export function scriptInterviewer(
  turns: ScriptedTurn[] = [],
): FakeInterviewer {
  const fake = createFakeInterviewer(turns);
  setInterviewer(fake);
  return fake;
}
