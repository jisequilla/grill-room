import { z } from "zod";

import { MAX_TICKETS_IN_FLIGHT, MIN_TICKETS_IN_FLIGHT } from "../shared/session-constants.js";

const CITATION_FORMAT = /^[^\s:][^:]*:(\d+)(?:-(\d+))?$/;

const citation = z.string().refine((text) => {
  const match = CITATION_FORMAT.exec(text);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] === undefined ? undefined : Number(match[2]);
  return start >= 1 && (end === undefined || end >= start);
}, "A citation is a repo-relative path, a colon and a line, optionally a dash and an end line not below it");

const command = z.string().trim().min(1);

const proposedCap = z.number().int().min(MIN_TICKETS_IN_FLIGHT).max(MAX_TICKETS_IN_FLIGHT);

export const delegationValuesSchema = z
  .object({
    maxTicketsInFlight: z.object({ citation }).strict().optional(),
    pruneCommand: z.object({ command, citation }).strict().optional(),
    reviewRule: z.object({ citation }).strict().optional(),
    preflight: z.object({ citation }).strict().optional(),
  })
  .strict();

export const delegationProposalsSchema = z
  .object({
    maxTicketsInFlight: z.object({ value: proposedCap, citation }).strict().optional(),
    pruneCommand: z.object({ command, citation }).strict().optional(),
    reviewRule: z.object({ citation }).strict().optional(),
    preflight: z.object({ citation }).strict().optional(),
  })
  .strict();

export type DelegationValues = z.infer<typeof delegationValuesSchema>;
export type DelegationProposals = z.infer<typeof delegationProposalsSchema>;

function parseWith<T>(schema: z.ZodType<T>, text: string | null): T {
  if (text === null) return schema.parse({});
  return schema.parse(JSON.parse(text));
}

function serializeWith<T extends object>(schema: z.ZodType<T>, value: T): string | null {
  const text = JSON.stringify(schema.parse(value));
  return text === "{}" ? null : text;
}

export function parseDelegationValues(text: string | null): DelegationValues {
  return parseWith(delegationValuesSchema, text);
}

export function serializeDelegationValues(values: DelegationValues): string | null {
  return serializeWith(delegationValuesSchema, values);
}

export function parseDelegationProposals(text: string | null): DelegationProposals {
  return parseWith(delegationProposalsSchema, text);
}

export function serializeDelegationProposals(proposals: DelegationProposals): string | null {
  return serializeWith(delegationProposalsSchema, proposals);
}
