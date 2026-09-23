import { z } from "zod";

/**
 * The output schemas of the six request kinds. Each one is both the contract
 * the model is constrained by (converted to JSON Schema for the command line)
 * and the validator every result is checked against before it leaves the port.
 *
 * Objects are strict and every property is required; absence is spelled as
 * `null` or an empty array. That keeps the generated JSON Schema in the shape
 * structured output is happiest with, and leaves no "field quietly missing"
 * case for callers to handle.
 */

const decisionKey = z.string().min(1);

/**
 * One option on offer, and the case for it. The rationale is what makes the
 * alternatives judgeable: without it the user reads a sentence of reasoning for
 * the recommendation and a bare label for everything else, and the only
 * defensible move left is to accept.
 */
export const offeredChoice = z.strictObject({
  /** The short label the chip reads. */
  label: z.string().min(1),
  /** One or two sentences: what this option buys, and what it costs. */
  rationale: z.string(),
});

/** Index into a decision's `choices`, or null when the recommendation is none of them. */
const recommendedChoice = z.number().int().nonnegative().nullable();

/** A decision the interviewer proposes adding to the tree. */
const proposedDecision = z.strictObject({
  /** Stable key, unique within the session. The app links decisions by it. */
  key: decisionKey,
  title: z.string().min(1),
  body: z.string(),
  /** Offered choices, or empty when the question is open. */
  choices: z.array(offeredChoice),
  /**
   * Which of `choices` the recommendation picks, as an index, or null when the
   * question is open-ended or the recommendation is none of them. The app marks
   * the chip from this, and records a click on it as accepting the
   * recommendation rather than as the user's own answer.
   */
  recommendedChoice,
  /** The recommendation's reasoning. It explains the pick; it does not restate it. */
  recommendedAnswer: z.string(),
  /** Keys of the decisions this one hangs off. */
  dependsOn: z.array(decisionKey),
  /** True to ask it in this round, false to add it to the tree as blocked. */
  ask: z.boolean(),
});

/** One offered choice, as every layer of the app passes it around. */
export type OfferedChoice = z.infer<typeof offeredChoice>;

export const proposeRoundResultSchema = z.strictObject({
  proposedDecisions: z.array(proposedDecision),
  /** One entry per decision the user pushed back on, in the same round. */
  pushBackResponses: z.array(
    z.strictObject({
      decisionKey,
      response: z.enum(["withdraw", "replace", "restructure"]),
      explanation: z.string(),
      /** Key of the proposed decision that replaces it, when there is one. */
      replacementKey: decisionKey.nullable(),
    }),
  ),
  /** Where each decision the user added belongs in the tree. */
  userDecisionPlacements: z.array(proposedDecision),
  /** Set only when the interviewer believes the interview is finished. */
  done: z.strictObject({ summary: z.string().min(1) }).nullable(),
});

export const reviewStaleResultSchema = z.strictObject({
  reviews: z.array(
    z.strictObject({
      decisionKey,
      /** `reconfirm` keeps the old answer; `re-ask` returns it to the tree. */
      verdict: z.enum(["reconfirm", "re-ask"]),
      reason: z.string(),
      /** The updated question, set only when the verdict is `re-ask`. */
      title: z.string().nullable(),
      body: z.string().nullable(),
      choices: z.array(offeredChoice),
      recommendedChoice,
      recommendedAnswer: z.string().nullable(),
    }),
  ),
});

/**
 * Loose ends a later settled decision turns out to have answered.
 *
 * At most one entry per loose end, and only for loose ends genuinely answered:
 * the result is a set of proposals the user accepts or rejects one by one, so
 * an over-eager entry costs the user the same work it was meant to save.
 */
export const findSupersededResultSchema = z.strictObject({
  supersessions: z.array(
    z.strictObject({
      /** The loose end, by key. One of the keys the request listed. */
      looseEndKey: decisionKey,
      /** The settled decision that answers it. Must already be settled. */
      answeredByKey: decisionKey,
      /** The answer to record on the loose end, in the loose end's own terms. */
      answer: z.string().min(1),
      /** Which settled decision answers it, and why that answer covers it. */
      reason: z.string(),
    }),
  ),
});

export const synthesizeSpecResultSchema = z.strictObject({
  /** The whole spec as markdown, following the to-spec template. */
  markdown: z.string().min(1),
});

export const breakIntoTicketsResultSchema = z.strictObject({
  tickets: z.array(
    z.strictObject({
      number: z.number().int().positive(),
      slug: z.string().min(1),
      title: z.string().min(1),
      body: z.string(),
      /** Numbers of the tickets that must land first. */
      blockedBy: z.array(z.number().int().positive()),
    }),
  ),
});

/**
 * Whether an idea is ready to be grilled, judged before the first round.
 *
 * The verdict rule is stated to the model and checked by the app: ready needs
 * at least one evidence item, an objective that is not process, and at most
 * {@link MAX_READY_UNKNOWNS} unknowns. The app derives nothing else from it.
 */
export const assessReadinessResultSchema = z.strictObject({
  /** Concrete facts the idea states, each quoted in the idea's own words. */
  evidence: z.array(z.string().min(1)),
  /** The single buildable thing the idea is after, or null when it names none. */
  objective: z.string().min(1).nullable(),
  /** True when the objective is a process: evaluate, decide how, compare, define a method. */
  objectiveIsProcess: z.boolean(),
  /** What exists once the objective is done, or null when the idea does not say. */
  expectedOutcome: z.string().min(1).nullable(),
  /** The open questions the idea raises that the interview would have to settle. */
  unknowns: z.array(z.string().min(1)),
  verdict: z.enum(["ready", "not-ready"]),
  /** What the idea needs before it is worth grilling. Empty when nothing is missing. */
  missing: z.array(z.string().min(1)),
});

/** A ready verdict tolerates at most this many unknowns. */
export const MAX_READY_UNKNOWNS = 5;

export const resultSchemas = {
  "propose-round": proposeRoundResultSchema,
  "review-stale": reviewStaleResultSchema,
  "find-superseded": findSupersededResultSchema,
  "synthesize-spec": synthesizeSpecResultSchema,
  "break-into-tickets": breakIntoTicketsResultSchema,
  "assess-readiness": assessReadinessResultSchema,
} as const;

export type RequestKind = keyof typeof resultSchemas;

export type ResultFor<Kind extends RequestKind> = z.infer<
  (typeof resultSchemas)[Kind]
>;

export type ProposeRoundResult = ResultFor<"propose-round">;
export type ReviewStaleResult = ResultFor<"review-stale">;
export type FindSupersededResult = ResultFor<"find-superseded">;
export type SynthesizeSpecResult = ResultFor<"synthesize-spec">;
export type BreakIntoTicketsResult = ResultFor<"break-into-tickets">;
export type AssessReadinessResult = ResultFor<"assess-readiness">;

/** The JSON Schema handed to the command line's `--json-schema` flag. */
export function jsonSchemaFor(kind: RequestKind): Record<string, unknown> {
  return z.toJSONSchema(resultSchemas[kind], {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;
}
