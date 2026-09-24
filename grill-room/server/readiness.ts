/**
 * Idea readiness: whether a session's idea is ready to be grilled, judged once
 * before its first round and stored on the session with the idea it judged.
 *
 * The app warns and never blocks: nothing here stops a round from opening. It
 * only decides when a judgment may be asked for or the idea edited (while the
 * session has no rounds and no turn is working), and when a stored judgment
 * still describes the idea (only while the idea is the one it judged) and,
 * when it was judged with a scout report, that report (only while that report
 * is still current).
 */
import { fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "./db/index.js";
import {
  assessReadinessEvidenceItem,
  assessReadinessResultSchema,
  MAX_READY_UNKNOWNS,
  type AssessReadinessResult,
} from "./interviewer/index.js";
import { checkCitation, currentScoutReport } from "./scout-report.js";

/**
 * A readiness result's evidence as it may be stored: the current shape, or,
 * from before this ticket, a plain string. A plain string reads as idea
 * evidence with no citation, so an old stored judgment still reads instead of
 * failing to parse.
 */
const storedEvidenceItem = z.union([
  assessReadinessEvidenceItem,
  z.string().min(1).transform((text) => ({
    text,
    source: "idea" as const,
    citation: null as string | null,
  })),
]);

const storedAssessReadinessResultSchema = assessReadinessResultSchema.extend({
  evidence: z.array(storedEvidenceItem),
});

const storedReadinessSchema = z.object({
  ideaJudged: z.string(),
  result: storedAssessReadinessResultSchema,
  judgedAt: z.string(),
  /** The scout report the judgment read, or null without a project or report.
   *  Absent on a judgment stored before this ticket, which reads as null. */
  scoutReportId: z.string().nullable().default(null),
});

/** What `gr_sessions.readiness_json` holds. */
export type StoredReadiness = z.infer<typeof storedReadinessSchema>;

export type ReadinessVerdict = AssessReadinessResult["verdict"];

type ReadinessSession = Pick<
  typeof schema.sessions.$inferSelect,
  "idea" | "readinessJson"
>;

type ReadinessSessionWithReport = ReadinessSession &
  Pick<typeof schema.sessions.$inferSelect, "id" | "projectId">;

/**
 * The session's stored judgment, parsed, or null when it has none, when what
 * is stored cannot be read, or when it judged an idea other than the current
 * one. Does not check a linked scout report's staleness — see
 * {@link currentReadiness}.
 */
function parseStoredReadiness(session: ReadinessSession): StoredReadiness | null {
  if (!session.readinessJson) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(session.readinessJson);
  } catch {
    return null;
  }

  const parsed = storedReadinessSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.ideaJudged !== session.idea) return null;
  return parsed.data;
}

/**
 * The session's readiness judgment, or null when it has none, when what is
 * stored cannot be read, when it judged an idea other than the current one,
 * or, when it was judged with a scout report, when that report is gone or has
 * itself gone stale. Async only because of that last check: a judgment made
 * without a project never touches the scout report table.
 */
export async function currentReadiness(
  session: ReadinessSessionWithReport,
): Promise<StoredReadiness | null> {
  const parsed = parseStoredReadiness(session);
  if (!parsed) return null;
  if (parsed.scoutReportId !== null) {
    const report = await currentScoutReport(session);
    if (!report || report.id !== parsed.scoutReportId || report.stale) {
      return null;
    }
  }
  return parsed;
}

/**
 * The current judgment's verdict alone, for the session list. Idea-only: it
 * does not check a linked scout report's staleness, since the list would
 * otherwise pay for a scout-report and git lookup per row.
 */
export function readinessVerdict(
  session: ReadinessSession,
): ReadinessVerdict | null {
  return parseStoredReadiness(session)?.result.verdict ?? null;
}

/** Serializes a judgment of `idea`, made reading `scoutReportId`, for storage. */
export function storeReadiness(
  idea: string,
  result: AssessReadinessResult,
  judgedAt: string,
  scoutReportId: string | null,
): string {
  const stored: StoredReadiness = {
    ideaJudged: idea,
    result,
    judgedAt,
    scoutReportId,
  };
  return JSON.stringify(stored);
}

/**
 * Case, whitespace and trailing-punctuation insensitive form, for comparing an
 * evidence item against the objective or the idea it was drawn from.
 */
function normalizeForComparison(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

/**
 * Why a judgment cannot be stored, written for the interviewer: every evidence
 * item's source and citation are checked whatever the verdict, since a
 * fabricated or unresolvable citation is never acceptable; the ready-verdict
 * content rules (evidence count, objective, unknowns) are checked only when
 * the verdict is `ready` — the rule says what ready requires, and a judge may
 * still find an idea that meets it not ready. `projectRoot` is the session's
 * project, when it has one; without it, a `repo`-sourced item's citation
 * cannot be resolved and is refused outright.
 */
export function reasonsToRefuseReadiness(
  result: AssessReadinessResult,
  idea: string,
  projectRoot: string | null = null,
): string[] {
  const reasons: string[] = [];

  for (const item of result.evidence) {
    if (item.source === "repo") {
      if (item.citation === null) {
        reasons.push(
          `Evidence item "${item.text}" is sourced from the repo but carries no citation. Cite the scout report's path and line it came from.`,
        );
      } else if (!projectRoot) {
        reasons.push(
          `Evidence item "${item.text}" is sourced from the repo, but this session has no project to check its citation against.`,
        );
      } else {
        const problem = checkCitation(projectRoot, item.citation);
        if (problem) reasons.push(problem);
      }
    } else if (item.citation !== null) {
      reasons.push(
        `Evidence item "${item.text}" is sourced from the idea but carries a citation "${item.citation}"; only repo evidence cites a location.`,
      );
    }
  }

  if (result.verdict !== "ready") return reasons;

  if (result.evidence.length === 0) {
    reasons.push("A ready verdict needs at least one evidence item.");
  }

  const normalizedIdea = normalizeForComparison(idea);
  const normalizedObjective =
    result.objective === null ? null : normalizeForComparison(result.objective);
  // The restated-goal check applies to idea-sourced items only: a repo item
  // that happens to echo the objective is still a fact about the project, not
  // a restatement of the goal.
  const restated = result.evidence.find((item) => {
    if (item.source !== "idea") return false;
    const normalized = normalizeForComparison(item.text);
    return (
      normalized === normalizedIdea || normalized === normalizedObjective
    );
  });
  if (restated !== undefined) {
    reasons.push(
      `Evidence item "${restated.text}" only restates the idea's goal, not a fact about the world. A ready verdict needs evidence other than the objective: a constraint, a user, an existing system, or an observed problem.`,
    );
  }

  if (result.objective === null) {
    reasons.push("A ready verdict needs an objective.");
  } else if (result.objectiveIsProcess) {
    reasons.push("A ready verdict needs an objective that is not a process.");
  }
  if (result.unknowns.length > MAX_READY_UNKNOWNS) {
    reasons.push(
      `A ready verdict allows at most ${MAX_READY_UNKNOWNS} unknowns; this one has ${result.unknowns.length}.`,
    );
  }
  return reasons;
}

/** Whether the session has any round at all, open or submitted. */
export async function sessionHasRounds(sessionId: string): Promise<boolean> {
  const [round] = await getDb()
    .select({ id: schema.rounds.id })
    .from(schema.rounds)
    .where(eq(schema.rounds.sessionId, sessionId))
    .limit(1);
  return round !== undefined;
}

type IdeaLockSession = Pick<
  typeof schema.sessions.$inferSelect,
  "turnStatus"
>;

/** Whether the idea may still change: no round yet, and no turn working. */
export function canEditIdea(
  session: IdeaLockSession,
  hasRounds: boolean,
): boolean {
  return !hasRounds && session.turnStatus !== "working";
}

/**
 * Refuse what only a session still before its first round may do — judge the
 * idea, or edit it — once a round exists (`has-rounds`) or while a turn is
 * working (`turn-working`).
 */
export function failIfPastFirstRound(
  session: IdeaLockSession,
  hasRounds: boolean,
  what: string,
): void {
  if (hasRounds) {
    fail(`${what} only before the session's first round.`, {
      errorCode: "has-rounds",
      statusCode: 409,
    });
  }
  if (session.turnStatus === "working") {
    fail(
      `${what} only while no turn is working. Wait for the turn to finish.`,
      { errorCode: "turn-working", statusCode: 409 },
    );
  }
}
