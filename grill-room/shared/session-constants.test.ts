/**
 * The enums have one definition and three ways in: the `@shared` alias that
 * client code uses, a relative path, and `server/db/schema.ts`, which
 * re-exports them so a column's `enum` and the UI's options cannot drift. All
 * three must reach the same array — a second copy would typecheck perfectly
 * and be wrong only at runtime, which is how they drifted before.
 */

import * as aliased from "@shared/session-constants";
import { describe, expect, it } from "vitest";

import * as schema from "../server/db/schema.js";
import * as relative from "./session-constants.js";

const ENUM_NAMES = [
  "SESSION_MODELS",
  "SESSION_ANSWERING_MODES",
  "SESSION_STATES",
  "SESSION_TURN_STATUSES",
  "DECISION_ANSWER_KINDS",
  "DECISION_DISPOSITION_TARGETS",
  "DECISION_INTRODUCED_BY",
  "ROUND_SUBMISSION_STATES",
  "TICKET_STATUSES",
] as const;

describe("session constants", () => {
  it("resolves through the @shared alias and a relative path to one module", () => {
    expect(aliased).toBe(relative);
  });

  it.each(ENUM_NAMES)("re-exports %s from the schema unchanged", (name) => {
    expect(schema[name]).toBe(relative[name]);
  });

  it("defines every enum the schema constrains a column to", () => {
    for (const name of ENUM_NAMES) {
      expect(Array.isArray(relative[name])).toBe(true);
      expect(relative[name].length).toBeGreaterThan(0);
    }
  });
});
