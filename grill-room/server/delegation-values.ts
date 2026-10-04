import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { MAX_TICKETS_IN_FLIGHT, MIN_TICKETS_IN_FLIGHT } from "../shared/session-constants.js";
import type { HandoffScoutResult } from "./interviewer/index.js";

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

export const DELEGATION_SLOTS = ["maxTicketsInFlight", "pruneCommand", "reviewRule", "preflight"] as const;

export type DelegationSlot = (typeof DELEGATION_SLOTS)[number];

export type PendingDelegationProposal =
  | {
      slot: "maxTicketsInFlight";
      proposal: { value: number; citation: string };
      confirmed: { value: number; citation: string } | null;
    }
  | {
      slot: "pruneCommand";
      proposal: { command: string; citation: string };
      confirmed: { command: string; citation: string } | null;
    }
  | { slot: "reviewRule"; proposal: { citation: string }; confirmed: { citation: string } | null }
  | { slot: "preflight"; proposal: { citation: string }; confirmed: { citation: string } | null };

/** The pending proposals for a project's stored columns, given the grounding's proposals. */
export function pendingForProject(
  project: {
    delegationValuesJson: string | null;
    delegationProposalsJson: string | null;
    maxTicketsInFlight: number;
  },
  proposed: HandoffScoutResult["delegationProposals"] | undefined,
): PendingDelegationProposal[] {
  return pendingDelegationProposals({
    proposed,
    values: parseDelegationValues(project.delegationValuesJson),
    dismissed: parseDelegationProposals(project.delegationProposalsJson),
    maxTicketsInFlight: project.maxTicketsInFlight,
  });
}

/**
 * The scout's proposals the owner has neither confirmed nor dismissed: one
 * entry per slot, in slot order. A dismissal covers only the exact proposal
 * it recorded; a proposal equal to the confirmed value is not pending.
 */
export function pendingDelegationProposals(input: {
  proposed: HandoffScoutResult["delegationProposals"] | undefined;
  values: DelegationValues;
  dismissed: DelegationProposals;
  maxTicketsInFlight: number;
}): PendingDelegationProposal[] {
  const { proposed, values, dismissed, maxTicketsInFlight } = input;
  if (!proposed) return [];
  const pending: PendingDelegationProposal[] = [];

  const cap = proposed.maxTicketsInFlight;
  if (cap && !isDeepStrictEqual(cap, dismissed.maxTicketsInFlight)) {
    const confirmedCitation = values.maxTicketsInFlight?.citation;
    if (confirmedCitation === undefined) {
      pending.push({ slot: "maxTicketsInFlight", proposal: cap, confirmed: null });
    } else if (cap.value !== maxTicketsInFlight) {
      pending.push({
        slot: "maxTicketsInFlight",
        proposal: cap,
        confirmed: { value: maxTicketsInFlight, citation: confirmedCitation },
      });
    }
  }

  const prune = proposed.pruneCommand;
  if (prune && !isDeepStrictEqual(prune, dismissed.pruneCommand)) {
    const confirmed = values.pruneCommand;
    if (!confirmed || confirmed.command !== prune.command) {
      pending.push({ slot: "pruneCommand", proposal: prune, confirmed: confirmed ?? null });
    }
  }

  for (const slot of ["reviewRule", "preflight"] as const) {
    const proposal = proposed[slot];
    if (!proposal || isDeepStrictEqual(proposal, dismissed[slot])) continue;
    const confirmed = values[slot];
    if (confirmed?.citation === proposal.citation) continue;
    pending.push({ slot, proposal, confirmed: confirmed ?? null });
  }
  return pending;
}
