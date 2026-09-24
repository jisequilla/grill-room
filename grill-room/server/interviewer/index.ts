import { createClaudeCliInterviewer } from "./claude-cli.js";
import {
  createFakeInterviewer,
  createScenarioInterviewer,
  type FakeInterviewer,
  type ScenarioInterviewer,
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
  createScenarioInterviewer,
  DEFAULT_SCENARIO,
  FAKE_CONVERSATION_ID,
  fakeScenarios,
  isFakeScenario,
  rateLimitedTurn,
  schemaInvalidTurn,
  treeRuleViolation,
  withResumeFallback,
} from "./fake.js";
export type {
  FakeInterviewer,
  Scenario,
  ScenarioInterviewer,
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
 * `fake` serves scripted scenarios, one queue per session: the canned interview
 * unless a scenario was chosen for the session, which is what the browser tests
 * run against. Anything else, including unset, is the real command line adapter.
 */
export const INTERVIEWER_ENV_VAR = "GRILL_ROOM_INTERVIEWER";

let configured: Interviewer | undefined;
let scenarioFake: ScenarioInterviewer | undefined;
let override: Interviewer | undefined;

function fakeSelected(): boolean {
  return process.env[INTERVIEWER_ENV_VAR] === "fake";
}

/**
 * The interviewer the app should use. Every caller goes through this rather
 * than constructing an adapter, so tests can substitute the fake in one place.
 */
export function getInterviewer(): Interviewer {
  if (override) return override;
  configured ??= selectedFakeInterviewer() ?? createClaudeCliInterviewer();
  return configured;
}

/**
 * The per-session fake the app serves when the fake is selected by environment
 * variable, or null when the real interviewer is. It is the same instance
 * `getInterviewer()` returns, so a scenario chosen on it reaches the app.
 */
export function selectedFakeInterviewer(): ScenarioInterviewer | null {
  if (!fakeSelected()) return null;
  scenarioFake ??= createScenarioInterviewer();
  return scenarioFake;
}

/** Substitutes an interviewer for the rest of the process. Tests only. */
export function setInterviewer(interviewer: Interviewer): void {
  override = interviewer;
}

/** Drops any substitution and the cached adapters. */
export function resetInterviewer(): void {
  override = undefined;
  configured = undefined;
  scenarioFake = undefined;
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
