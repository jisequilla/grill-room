/**
 * Mirrors the enum constants defined in `server/db/schema.ts`. Duplicated
 * here, rather than re-exported, because that module pulls in server-only
 * schema helpers that should not enter the client bundle. Keep this file in
 * sync if the schema's enums change.
 */
export const SESSION_MODELS = ["fable", "opus", "sonnet"] as const;
export type SessionModel = (typeof SESSION_MODELS)[number];

export const SESSION_ANSWERING_MODES = [
  "whole-round",
  "one-at-a-time",
] as const;
export type SessionAnsweringMode = (typeof SESSION_ANSWERING_MODES)[number];

export const SESSION_STATES = [
  "interviewing",
  "done-proposed",
  "confirmed",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];
