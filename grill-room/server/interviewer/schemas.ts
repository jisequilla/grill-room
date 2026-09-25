import { z } from "zod";

/**
 * The output schemas of the request kinds. Each one is both the contract
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
 * The shape the model is constrained to: a path, a colon, and a line number or
 * a line range. Kept to plain regex syntax so the structured-output pattern
 * stays portable; the refinements below add what the pattern cannot say.
 */
const CITATION_PATTERN = /^[^:\n]+:[1-9][0-9]*(-[1-9][0-9]*)?$/;

/**
 * Whether a path is relative to the repository root and cannot step outside
 * it: not absolute, not home-relative, no drive letter, no `..` segment, and
 * no surrounding whitespace.
 */
function staysInsideRepo(path: string): boolean {
  return (
    path.trim() === path &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !/^[A-Za-z]:[\\/]/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

/**
 * A repo-relative path with a line number or line range: `path:line` or
 * `path:start-end`. The path may not be absolute or step outside the repo, and
 * a range must not run backwards. Whether the file and lines exist at the
 * commit read is the app's check, not the schema's.
 */
export const citation = z
  .string()
  .regex(CITATION_PATTERN, "A citation is `path:line` or `path:start-end`.")
  .refine(
    (value) => staysInsideRepo(value.slice(0, value.lastIndexOf(":"))),
    "A citation's path is relative to the repository root and stays inside it.",
  )
  .refine((value) => {
    const [start, end] = value
      .slice(value.lastIndexOf(":") + 1)
      .split("-")
      .map(Number);
    return end === undefined || start <= end;
  }, "A citation's line range runs from its first line to its last.");

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
 * One item of a readiness judgment's evidence: a fact drawn from the idea's
 * own words, or from the session's scout report. A repo item carries the
 * citation it was read at; an idea item carries none.
 */
export const assessReadinessEvidenceItem = z.strictObject({
  text: z.string().min(1),
  source: z.enum(["idea", "repo"]),
  citation: citation.nullable(),
});

export type AssessReadinessEvidenceItem = z.infer<
  typeof assessReadinessEvidenceItem
>;

/**
 * Whether an idea is ready to be grilled, judged before the first round.
 *
 * The verdict rule is stated to the model and checked by the app: ready needs
 * at least one evidence item, an objective that is not process, and at most
 * {@link MAX_READY_UNKNOWNS} unknowns. The app derives nothing else from it.
 */
export const assessReadinessResultSchema = z.strictObject({
  /** Concrete facts the idea or the scout report states, sourced and cited. */
  evidence: z.array(assessReadinessEvidenceItem),
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

/** A scout report lists at most this many current-state items. */
export const MAX_SCOUT_CURRENT_STATE = 25;

/** A scout report proposes at most this many repo decisions. */
export const MAX_SCOUT_PROPOSED_DECISIONS = 15;

/**
 * What a scout found reading a project for one idea. Every item cites where it
 * lives. `previousDecisions` is empty on a first run and holds one entry per
 * decision of the previous report on a re-run; the app checks that coverage,
 * the uniqueness of keys, and every citation against the repo.
 */
export const scoutProjectResultSchema = z.strictObject({
  /** What already exists relative to the idea. */
  currentState: z
    .array(
      z.strictObject({
        status: z.enum(["built", "partial", "gap"]),
        summary: z.string().min(1),
        citations: z.array(citation).min(1),
      }),
    )
    .max(MAX_SCOUT_CURRENT_STATE),
  /** Choices the project has already made that bear on the idea. */
  proposedDecisions: z
    .array(
      z.strictObject({
        /** Stable across re-runs for the same decision. */
        key: decisionKey,
        title: z.string().min(1),
        /** The decision, stated as the project holds it. */
        statement: z.string().min(1),
        /** Written down (ADR, agent instructions, rules) or read from code or configuration. */
        source: z.enum(["recorded", "inferred"]),
        citation,
        /** One line: why it matters for this idea. */
        reason: z.string().min(1),
      }),
    )
    .max(MAX_SCOUT_PROPOSED_DECISIONS),
  /** On a re-run, how each decision of the previous report fared. */
  previousDecisions: z.array(
    z.strictObject({
      key: decisionKey,
      change: z.enum(["unchanged", "changed", "removed"]),
      /** The decision as the repo now holds it, when it changed; otherwise null. */
      statement: z.string().min(1).nullable(),
    }),
  ),
});

/**
 * A repo-relative file path with no line: a file a ticket creates or edits, or
 * the test that proves it. Like a citation's path, it may not be absolute or
 * step outside the repo. Whether it exists, or may be created, is the app's
 * check, not the schema's.
 */
export const repoPath = z
  .string()
  .min(1)
  .refine(
    staysInsideRepo,
    "A path is relative to the repository root and stays inside it.",
  );

/** A handoff scout grounds at most this many tickets in one turn. */
export const MAX_HANDOFF_SCOUT_TICKETS = 40;

/** A grounded ticket creates or edits at most this many files. */
export const MAX_HANDOFF_SCOUT_FILES_TO_CHANGE = 20;

/** A grounded ticket builds on at most this many existing files. */
export const MAX_HANDOFF_SCOUT_BUILDS_ON_FILES = 20;

/** A grounded ticket carries at most this many cited facts. */
export const MAX_HANDOFF_SCOUT_FACTS = 15;

/** A grounded ticket names at most this many dependencies: one per blocker. */
export const MAX_HANDOFF_SCOUT_BUILDS_ON = 15;

/**
 * What a ticket needs from one of the tickets it waits on: where it already
 * lives in the code (`citation`), or the path the blocker will create
 * (`createdPath`). Exactly one of the two is set.
 */
const handoffBuildsOn = z
  .strictObject({
    /** The number of the blocking ticket. */
    blocker: z.number().int().positive(),
    /** What this ticket needs from it: a file, a symbol, a table. */
    provides: z.string().min(1),
    citation: citation.nullable(),
    createdPath: repoPath.nullable(),
    /** The command or test that proves the dependency exists before work starts. */
    check: z.string().min(1),
  })
  .refine(
    (entry) => (entry.citation === null) !== (entry.createdPath === null),
    "A dependency carries either a citation or a path to be created, never both and never neither.",
  );

/** One ticket's grounding, as a handoff scout reports it. */
const groundedTicket = z.strictObject({
  /** The ticket's number, as the request listed it. */
  number: z.number().int().positive(),
  /**
   * The files the ticket may create or edit. Empty for a ticket that changes
   * no files, such as a spike run against a real project.
   */
  filesToChange: z
    .array(
      z.strictObject({
        path: repoPath,
        change: z.enum(["create", "edit"]),
      }),
    )
    .max(MAX_HANDOFF_SCOUT_FILES_TO_CHANGE),
  /** The existing code the ticket builds on, cited. */
  buildsOnFiles: z.array(citation).max(MAX_HANDOFF_SCOUT_BUILDS_ON_FILES),
  /** Verified facts about the code the ticket touches, each cited. */
  facts: z
    .array(z.strictObject({ statement: z.string().min(1), citation }))
    .max(MAX_HANDOFF_SCOUT_FACTS),
  /** One entry per ticket this one waits on; empty when it waits on none. */
  buildsOn: z.array(handoffBuildsOn).max(MAX_HANDOFF_SCOUT_BUILDS_ON),
  /** The test to add or extend, and the command that proves the ticket. */
  provedBy: z.strictObject({
    testPath: repoPath,
    command: z.string().min(1),
  }),
});

/**
 * What a handoff scout found reading a project for every ticket of one
 * handoff, one entry per ticket by number. The schema bounds the lists and
 * shapes; the app checks that every ticket appears exactly once, that each
 * dependency names a real blocker, and every citation and path against the
 * repository.
 */
export const handoffScoutResultSchema = z.strictObject({
  tickets: z.array(groundedTicket).max(MAX_HANDOFF_SCOUT_TICKETS),
});

export const resultSchemas = {
  "propose-round": proposeRoundResultSchema,
  "review-stale": reviewStaleResultSchema,
  "find-superseded": findSupersededResultSchema,
  "synthesize-spec": synthesizeSpecResultSchema,
  "break-into-tickets": breakIntoTicketsResultSchema,
  "assess-readiness": assessReadinessResultSchema,
  "scout-project": scoutProjectResultSchema,
  "handoff-scout": handoffScoutResultSchema,
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
export type ScoutProjectResult = ResultFor<"scout-project">;
export type HandoffScoutResult = ResultFor<"handoff-scout">;

/** The JSON Schema handed to the command line's `--json-schema` flag. */
export function jsonSchemaFor(kind: RequestKind): Record<string, unknown> {
  return z.toJSONSchema(resultSchemas[kind], {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;
}
