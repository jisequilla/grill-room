/**
 * The scout report: what a scout found reading a session's project for its
 * idea, stored with what the server knew for certain and what the scout read.
 *
 * A report is tied to the idea and the HEAD commit it read. It is current only
 * while both still match; staleness is computed here on every read and never
 * stored, the same way readiness staleness is (`server/readiness.ts`).
 *
 * See `.scratch/project-scout/spec.md` ("Scout report schema", "Storage") and
 * `.scratch/project-scout/issues/03-scout-report-and-action.md`.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { and, desc, eq, isNull } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "./db/index.js";
import { runGit } from "./git.js";
import {
  scoutProjectResultSchema,
  type InterviewerModel,
  type PreviousRepoDecision,
  type ProjectContext,
  type ProjectServerFacts,
  type ScoutProjectResult,
  type ScoutReportForReadiness,
} from "./interviewer/index.js";

/** Where the user stands on one proposed repo decision. */
export type ScoutProposalDisposition = "undecided" | "kept" | "dropped";

const dispositionsSchema = z.record(
  z.string(),
  z.enum(["undecided", "kept", "dropped"]),
);

const factsSchema = z.object({
  headCommit: z.string().nullable(),
  headBranch: z.string().nullable(),
  remotes: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      type: z.enum(["fetch", "push"]),
    }),
  ),
  dirty: z.boolean(),
  recentCommitSubjects: z.array(z.string()),
  hasAgentInstructions: z.boolean(),
  decisionsFolder: z.string().nullable(),
  hasRulesFolder: z.boolean(),
}) satisfies z.ZodType<ProjectServerFacts>;

/** A stored scout report, as every reader sees it. */
export interface ScoutReport {
  id: string;
  sessionId: string;
  /** The project it read, or null once that project was unregistered. */
  projectId: string | null;
  facts: ProjectServerFacts;
  result: ScoutProjectResult;
  /** The HEAD commit it read, or null for a repository with no commits yet. */
  commitRead: string | null;
  /** The session's idea as it read it. */
  ideaRead: string;
  model: InterviewerModel;
  ranAt: string;
  /** The turn record that produced it. */
  turnId: string | null;
  /** Keep or drop for every proposed decision, by key. */
  dispositions: Record<string, ScoutProposalDisposition>;
}

/** A report with whether it still describes the session's idea and project. */
export interface ScoutReportWithStaleness extends ScoutReport {
  stale: boolean;
}

type ScoutReportRow = typeof schema.scoutReports.$inferSelect;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A stored row as a report, or null when what is stored cannot be read. */
function readRow(row: ScoutReportRow): ScoutReport | null {
  const facts = factsSchema.safeParse(parseJson(row.factsJson));
  const result = scoutProjectResultSchema.safeParse(parseJson(row.resultJson));
  const dispositions = dispositionsSchema.safeParse(
    parseJson(row.dispositionsJson),
  );
  if (!facts.success || !result.success || !dispositions.success) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId,
    facts: facts.data,
    result: result.data,
    commitRead: row.commitRead,
    ideaRead: row.ideaRead,
    model: row.model as InterviewerModel,
    ranAt: row.ranAt,
    turnId: row.turnId,
    dispositions: dispositions.data,
  };
}

/** The session's scout report, stale or not, or null when it has none. */
export async function latestScoutReport(
  sessionId: string,
): Promise<ScoutReport | null> {
  const [row] = await getDb()
    .select()
    .from(schema.scoutReports)
    .where(eq(schema.scoutReports.sessionId, sessionId))
    .orderBy(desc(schema.scoutReports.ranAt), desc(schema.scoutReports.id))
    .limit(1);
  return row ? readRow(row) : null;
}

/**
 * Store an accepted report as the session's report, replacing any it had.
 * Every proposed decision starts `undecided`, unless `carriedDispositions`
 * gives its key a disposition already reached before this run — a re-run's
 * proposal the scout reports `unchanged` and re-proposes under the same key
 * keeps whatever the user had it as (kept or dropped) rather than reverting
 * to undecided; see `.scratch/project-scout/issues/06-rescout-drift.md`
 * ("Dispositions carry forward"). Returns what was stored.
 */
export async function storeScoutReport(input: {
  sessionId: string;
  projectId: string;
  facts: ProjectServerFacts;
  result: ScoutProjectResult;
  ideaRead: string;
  model: InterviewerModel;
  turnId: string | null;
  ranAt: string;
  carriedDispositions?: Record<string, ScoutProposalDisposition>;
}): Promise<ScoutReport> {
  const dispositions: Record<string, ScoutProposalDisposition> =
    Object.fromEntries(
      input.result.proposedDecisions.map((decision) => [
        decision.key,
        input.carriedDispositions?.[decision.key] ?? ("undecided" as const),
      ]),
    );
  const report: ScoutReport = {
    id: randomUUID(),
    sessionId: input.sessionId,
    projectId: input.projectId,
    facts: input.facts,
    result: input.result,
    commitRead: input.facts.headCommit,
    ideaRead: input.ideaRead,
    model: input.model,
    ranAt: input.ranAt,
    turnId: input.turnId,
    dispositions,
  };
  const db = getDb();
  await db
    .delete(schema.scoutReports)
    .where(eq(schema.scoutReports.sessionId, input.sessionId));
  await db.insert(schema.scoutReports).values({
    id: report.id,
    sessionId: report.sessionId,
    projectId: report.projectId,
    factsJson: JSON.stringify(report.facts),
    resultJson: JSON.stringify(report.result),
    commitRead: report.commitRead,
    ideaRead: report.ideaRead,
    model: report.model,
    ranAt: report.ranAt,
    turnId: report.turnId,
    dispositionsJson: JSON.stringify(report.dispositions),
  });
  return report;
}

/**
 * Record the user's keep or drop of one proposed decision on a stored report,
 * leaving every other proposal's disposition as it was. Returns the report's
 * dispositions as now stored, or null when the report no longer exists.
 *
 * The caller checks that `key` is one of the report's proposals and that the
 * change is allowed; this only writes it.
 */
export async function setScoutProposalDisposition(
  reportId: string,
  key: string,
  disposition: ScoutProposalDisposition,
): Promise<Record<string, ScoutProposalDisposition> | null> {
  const db = getDb();
  const [row] = await db
    .select({ dispositionsJson: schema.scoutReports.dispositionsJson })
    .from(schema.scoutReports)
    .where(eq(schema.scoutReports.id, reportId))
    .limit(1);
  if (!row) return null;
  const parsed = dispositionsSchema.safeParse(parseJson(row.dispositionsJson));
  const dispositions = {
    ...(parsed.success ? parsed.data : {}),
    [key]: disposition,
  };
  await db
    .update(schema.scoutReports)
    .set({ dispositionsJson: JSON.stringify(dispositions) })
    .where(eq(schema.scoutReports.id, reportId));
  return dispositions;
}

/**
 * The report as every interviewer turn reads it: the current state and the
 * proposals the user dropped, which reach the interviewer as context and are
 * never enforced. Kept proposals are not here; they are decisions in the tree.
 * A stale report is still described, marked stale with the commit it read.
 */
export function projectContextOf(
  report: ScoutReportWithStaleness,
): ProjectContext {
  return {
    commitRead: report.commitRead,
    stale: report.stale,
    currentState: report.result.currentState,
    droppedDecisions: report.result.proposedDecisions
      .filter((decision) => report.dispositions[decision.key] === "dropped")
      .map((decision) => ({
        key: decision.key,
        title: decision.title,
        statement: decision.statement,
        source: decision.source,
        citation: decision.citation,
        reason: decision.reason,
      })),
  };
}

/**
 * The project's HEAD commit now: a hash, null for a repository with no commits
 * yet, or undefined when the root is no longer a git repository at all.
 */
async function currentHead(root: string): Promise<string | null | undefined> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return undefined;
  const head = await runGit(root, ["rev-parse", "HEAD"]);
  return head.exitCode === 0 ? head.stdout.trim() : null;
}

type StalenessSession = Pick<
  typeof schema.sessions.$inferSelect,
  "idea" | "projectId"
>;

/**
 * Whether a report no longer describes the session: its idea changed, its
 * project changed or is gone, or the project's HEAD moved since the report
 * read it.
 */
export async function isScoutReportStale(
  report: ScoutReport,
  session: StalenessSession,
): Promise<boolean> {
  if (report.ideaRead !== session.idea) return true;
  if (report.projectId === null || report.projectId !== session.projectId) {
    return true;
  }
  const [project] = await getDb()
    .select({ rootPath: schema.projects.rootPath })
    .from(schema.projects)
    .where(eq(schema.projects.id, report.projectId))
    .limit(1);
  if (!project) return true;
  const head = await currentHead(project.rootPath);
  return head === undefined || head !== report.commitRead;
}

/** The session's latest report with its staleness, or null when it has none. */
export async function currentScoutReport(
  session: StalenessSession & { id: string },
): Promise<ScoutReportWithStaleness | null> {
  const report = await latestScoutReport(session.id);
  if (!report) return null;
  return { ...report, stale: await isScoutReportStale(report, session) };
}

/**
 * The report's proposed decisions as the next scout run is told about them,
 * with the user's keep or drop. An undecided proposal is still `proposed`.
 */
export function previousRepoDecisions(
  report: ScoutReport,
): PreviousRepoDecision[] {
  return report.result.proposedDecisions.map((decision) => {
    const disposition = report.dispositions[decision.key] ?? "undecided";
    return {
      key: decision.key,
      title: decision.title,
      statement: decision.statement,
      source: decision.source,
      citation: decision.citation,
      disposition: disposition === "undecided" ? "proposed" : disposition,
    };
  });
}

/**
 * Every repo decision live in the session's design tree, as the next scout
 * run is told about it: always disposition `kept`, since a decision only
 * lives in the tree because the user kept it — dropping never adds one. A
 * kept decision's key, title, source and citation are exactly as they were
 * kept with; its statement is the repo statement it was kept with too — the
 * one the scout is asked to check the project still holds, even once the
 * interview has since reopened and re-answered the decision itself (the
 * decision keeps its repo origin; see `actions/reopen-decision.ts`).
 *
 * Independent of any report's own content: a decision kept several re-runs
 * ago is still returned here once its report row has long since been
 * replaced, because it lives in `gr_decisions`, not in a report. See
 * `.scratch/project-scout/issues/06-rescout-drift.md`
 * ("Which decisions a re-run carries").
 */
export async function repoDecisionsInTree(
  sessionId: string,
): Promise<PreviousRepoDecision[]> {
  const rows = await getDb()
    .select()
    .from(schema.decisions)
    .where(
      and(
        eq(schema.decisions.sessionId, sessionId),
        eq(schema.decisions.introducedBy, "repo"),
        isNull(schema.decisions.withdrawnAt),
      ),
    );
  return rows.flatMap((row) =>
    row.key
      ? [
          {
            key: row.key,
            title: row.questionTitle,
            statement: row.repoStatement ?? row.currentAnswer ?? "",
            source: (row.repoSource ?? "inferred") as "recorded" | "inferred",
            citation: row.repoCitation ?? "",
            disposition: "kept" as const,
          },
        ]
      : [],
  );
}

/**
 * The session's current scout report, shaped for the readiness judge: its
 * current-state findings and proposed decisions (each with the user's
 * disposition), its commit, and its own staleness. Used whether or not the
 * report is stale — the judge is told either way (`server/interviewer/prompt.ts`).
 */
export function scoutReportForReadiness(
  report: ScoutReportWithStaleness,
): ScoutReportForReadiness {
  return {
    currentState: report.result.currentState,
    proposedDecisions: report.result.proposedDecisions.map((decision) => ({
      ...decision,
      disposition: report.dispositions[decision.key] ?? "undecided",
    })),
    commitRead: report.commitRead,
    stale: report.stale,
  };
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const pieces = text.split("\n").length;
  return text.endsWith("\n") ? pieces - 1 : pieces;
}

/**
 * Why a citation (`path:line` or `path:start-end`, relative to the project
 * root) does not point at real lines of the project's working tree, written
 * for the interviewer; null when it does.
 *
 * The path is resolved against the project root, through any symlinks, and
 * refused when it lands outside the root, does not exist, or is not a file.
 * The cited line, or a range's last line, must not lie past the file's last
 * line. The working tree is what the scout reads, so it is what is checked,
 * not a commit.
 */
export function checkCitation(
  projectRoot: string,
  citation: string,
): string | null {
  const separator = citation.lastIndexOf(":");
  const citedPath = separator > 0 ? citation.slice(0, separator) : "";
  const range = separator > 0 ? citation.slice(separator + 1) : "";
  const match = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(range);
  if (!citedPath || !match) {
    return `Citation "${citation}" is not \`path:line\` or \`path:start-end\`.`;
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (end < start) {
    return `Citation "${citation}" has a line range that ends before it starts.`;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    return `Citation "${citation}" cannot be checked: the project root ${projectRoot} does not exist.`;
  }

  const resolved = path.resolve(realRoot, citedPath);
  if (path.isAbsolute(citedPath) || !isInside(realRoot, resolved)) {
    return `Citation "${citation}" points outside the project; cite a path relative to the project root.`;
  }

  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    return `Citation "${citation}" cites ${citedPath}, which does not exist in the project.`;
  }
  if (!isInside(realRoot, realPath)) {
    return `Citation "${citation}" cites ${citedPath}, which leads outside the project.`;
  }
  let isFile: boolean;
  try {
    isFile = statSync(realPath).isFile();
  } catch {
    return `Citation "${citation}" cites ${citedPath}, which does not exist in the project.`;
  }
  if (!isFile) {
    return `Citation "${citation}" cites ${citedPath}, which is not a file; cite a file and a line.`;
  }

  let lines: number;
  try {
    lines = lineCount(readFileSync(realPath, "utf8"));
  } catch {
    return `Citation "${citation}" cites ${citedPath}, which cannot be read.`;
  }
  if (end > lines) {
    return `Citation "${citation}" cites line ${end}, but ${citedPath} has ${lines} line${lines === 1 ? "" : "s"}.`;
  }
  return null;
}

/**
 * Why a scout result cannot be stored, written for the scout. Empty when it
 * can: every citation points at real lines of the project, every proposed
 * decision has its own key, and on a re-run every decision of the previous
 * report is accounted for in `previousDecisions`.
 */
export function reasonsToRefuseScoutReport(
  result: ScoutProjectResult,
  input: { projectRoot: string; previousDecisionKeys: readonly string[] },
): string[] {
  const reasons: string[] = [];

  const citations = [
    ...result.currentState.flatMap((item) => item.citations),
    ...result.proposedDecisions.map((decision) => decision.citation),
  ];
  for (const citation of new Set(citations)) {
    const problem = checkCitation(input.projectRoot, citation);
    if (problem) reasons.push(problem);
  }

  const seen = new Set<string>();
  const reused = new Set<string>();
  for (const decision of result.proposedDecisions) {
    if (seen.has(decision.key)) reused.add(decision.key);
    seen.add(decision.key);
  }
  for (const key of reused) {
    reasons.push(
      `Proposed decision key "${key}" is used more than once; give each proposed decision its own key.`,
    );
  }

  const reported = new Set(result.previousDecisions.map((entry) => entry.key));
  const missing = input.previousDecisionKeys.filter((key) => !reported.has(key));
  if (missing.length > 0) {
    reasons.push(
      `previousDecisions is missing ${missing.map((key) => `"${key}"`).join(", ")}; report every decision of the previous report as unchanged, changed or removed.`,
    );
  }

  return reasons;
}
