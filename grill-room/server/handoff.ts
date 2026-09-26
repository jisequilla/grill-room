/**
 * The handoff: a session-level `HANDOFF.md` (the entry point pasted into a
 * fresh orchestrating session) and one delegation brief per ticket. Both are
 * rendered by plain TypeScript templates from the session, its spec, its
 * tickets and their waves, and its project. No model is involved: the same
 * inputs always render the same text.
 *
 * ## Bundle paths
 *
 * The bundle's folder name is only fixed at export (the slug is confirmed in
 * the export preview, and `{seq}`/`{date}` depend on the day and on what is
 * already on disk). The stored markdown therefore writes every bundle path as
 * {@link BUNDLE_TOKEN}, and export fills it in with {@link fillBundlePath}:
 * the path relative to the repository root when the bundle is `tracked`, or
 * the absolute path into the main checkout when it is `ignored`. At export,
 * that visibility (and whether the repository has any commits yet) is
 * measured fresh from git and passed to the templates as {@link ExportFacts};
 * anywhere else the stored visibility flag decides.
 *
 * ## Staleness
 *
 * HANDOFF.md opens with the spec's Problem Statement and Solution, then the
 * session's idea as first written, labelled (`openingSections` in
 * `./export.ts`, which `intent.md` shares).
 *
 * {@link handoffFingerprint} hashes everything the templates render from:
 * the session's title and idea, the spec's `updatedAt` (every write of its
 * text sets it, so the text itself is not hashed) and
 * `ticketsGeneratedAt`, each ticket's id, number, slug, title, body and
 * `blockedBy` (ids change whenever tickets are regenerated), and the project
 * fields the templates read. A stored handoff is stale when the fingerprint
 * over today's inputs differs from the one it was generated from. This catches a blocker edit (`set-ticket-blocked-by` touches
 * the ticket row but not `ticketsGeneratedAt`) as well as a regeneration or a
 * project edit.
 */
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";

import type {
  DeliveryRecipe,
  ProjectTrackerKind,
  ProjectVisibility,
} from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";
import { hashExportContent, openingSections, padTicketNumber, sanitizeTicketSlug } from "./export.js";
// Type-only: erased at compile time, so this never becomes a runtime import.
// `server/brief-grounding.ts` already imports this module at runtime, and a
// runtime import back into it would be a cycle.
import type { HandoffScoutResult } from "./interviewer/index.js";
import { getProject } from "./projects.js";
import { computeWaves, describeTickets, type ImplicitEdge } from "./tickets.js";

/** Stands for the bundle directory in stored markdown; export replaces it. */
export const BUNDLE_TOKEN = "{{BUNDLE}}";

/** The handoff's file name at the top of the bundle. */
export const HANDOFF_FILE = "HANDOFF.md";

export const FILE_BOUNDARIES_SLOT = "<!-- slot: file-boundaries -->";
export const CODEBASE_FACTS_SLOT = "<!-- slot: codebase-facts -->";

export interface HandoffTicket {
  /** A regeneration replaces every ticket row, so a new id marks it even when the content is the same. */
  id: string;
  number: number;
  slug: string;
  title: string;
  body: string;
  blockedBy: readonly number[];
}

/** Everything the templates render from, and nothing else. */
export interface HandoffSource {
  session: { id: string; title: string; idea: string };
  /**
   * `markdown` feeds HANDOFF.md's opening but never the fingerprint: every
   * write of the spec's text also sets `updatedAt`, which it already hashes.
   */
  spec: { updatedAt: string; ticketsGeneratedAt: string | null; markdown: string };
  /** In number order. */
  tickets: readonly HandoffTicket[];
  /** Ticket numbers grouped by wave, wave 1 first. */
  waves: readonly (readonly number[])[];
  project: {
    rootPath: string;
    workingExportFolder: string;
    verifyCommand: string;
    trackerKind: ProjectTrackerKind;
    buildRecordLogging: boolean;
    visibility: ProjectVisibility;
    deliveryRecipe: DeliveryRecipe;
    adversarialReview: boolean;
    trackerCommandsJson: string | null;
  };
}

export interface HandoffBrief {
  ticketNumber: number;
  /** Relative to the bundle: `briefs/NN-slug.md`, the same `NN-slug` as the ticket's file. */
  relativePath: string;
  markdown: string;
}

/**
 * What git reported about the project when the bundle was exported: whether
 * the bundle folder is ignored, and whether the repository has no commits
 * yet. Measured at export only; they never enter {@link handoffFingerprint},
 * so a changed answer from git never makes a handoff stale.
 */
export interface ExportFacts {
  visibility: ProjectVisibility;
  greenfield: boolean;
  /**
   * Present exactly when the brief grounding is current: the waves in which
   * no two tickets change the same file, and the orderings that separation
   * added. Absent, HANDOFF says overlaps were not checked.
   */
  waves?: readonly (readonly number[])[];
  implicitEdges?: readonly ImplicitEdge[];
}

/** The facts a render uses: the export's when given, otherwise the stored flag and not greenfield. */
function factsFor(source: HandoffSource, exportFacts?: ExportFacts): ExportFacts {
  return exportFacts ?? { visibility: source.project.visibility, greenfield: false };
}

/** Why a brief grounding no longer describes the session's handoff and project. */
export type HandoffGroundingStaleReason = "head-moved" | "handoff-changed";

/** One ticket's grounding, as a handoff scout reports it. */
export type HandoffTicketGrounding = HandoffScoutResult["tickets"][number];

/**
 * The session's brief grounding, as brief rendering needs it: every ticket
 * the scout covered, the commit it read, and whether it is still current.
 * `server/brief-grounding.ts` holds the stored record (id, session,
 * fingerprint, model, turn); this is only the shape rendering reads from it,
 * kept separate so this module never needs a runtime import of that one.
 */
export interface HandoffGrounding {
  /** The scout's result for every ticket it covered. */
  tickets: readonly HandoffTicketGrounding[];
  /** The commit it read, or null for a repository with no commits yet. */
  commitRead: string | null;
  current: boolean;
  /** Null while current. */
  staleReason: HandoffGroundingStaleReason | null;
}

/** A ticket as the blocker graph needs it. */
interface BlockedTicket {
  number: number;
  blockedBy: readonly number[];
}

/**
 * Every ticket that blocks `ticketNumber`, directly or through its blockers'
 * own blockers: nearest first, then lowest number among equally near. A
 * cycle ends where it meets a ticket already listed.
 */
export function transitiveBlockers(
  ticketNumber: number,
  tickets: readonly BlockedTicket[],
): number[] {
  const blockersOf = new Map(tickets.map((ticket) => [ticket.number, ticket.blockedBy]));
  const seen = new Set<number>([ticketNumber]);
  const ordered: number[] = [];
  let frontier = [ticketNumber];
  while (frontier.length > 0) {
    const next = [...new Set(frontier.flatMap((number) => blockersOf.get(number) ?? []))]
      .filter((number) => !seen.has(number))
      .sort((a, b) => a - b);
    for (const number of next) seen.add(number);
    ordered.push(...next);
    frontier = next;
  }
  return ordered;
}

/**
 * The blocker of `ticketNumber`, direct or transitive, whose grounding lists
 * `filePath` as a `create`, or null when none does. A ticket may edit such a
 * file: its blocker has merged, and so created it, before the ticket starts.
 * The nearest blocker wins, then the lowest number.
 */
export function blockerThatCreates(
  filePath: string,
  ticketNumber: number,
  tickets: readonly BlockedTicket[],
  entries: readonly HandoffTicketGrounding[],
): number | null {
  const target = path.posix.normalize(filePath);
  for (const blocker of transitiveBlockers(ticketNumber, tickets)) {
    const creates = entries.some(
      (entry) =>
        entry.number === blocker &&
        entry.filesToChange.some(
          (file) => file.change === "create" && path.posix.normalize(file.path) === target,
        ),
    );
    if (creates) return blocker;
  }
  return null;
}

export interface RenderedHandoff {
  markdown: string;
  briefs: HandoffBrief[];
}

/**
 * A hash over every input the templates render from. The field list is fixed
 * and ordered here, so the same inputs always hash the same.
 *
 * `deliveryRecipe` and `adversarialReview` join the canonical object only
 * when they differ from the migration default (`pull-request`, `true`):
 * these two fields were added to every existing project by an additive
 * migration, so a project still on the defaults must hash exactly as it did
 * before these fields existed, or every handoff stored before this change
 * goes stale on upgrade for nothing that actually changed.
 */
export function handoffFingerprint(source: HandoffSource): string {
  const canonical = {
    version: 1,
    session: { id: source.session.id, title: source.session.title, idea: source.session.idea },
    spec: {
      updatedAt: source.spec.updatedAt,
      ticketsGeneratedAt: source.spec.ticketsGeneratedAt,
    },
    tickets: source.tickets.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      slug: ticket.slug,
      title: ticket.title,
      body: ticket.body,
      blockedBy: [...ticket.blockedBy].sort((a, b) => a - b),
    })),
    project: {
      rootPath: source.project.rootPath,
      exportFolder: source.project.workingExportFolder, // key kept so existing handoffs do not go stale
      verifyCommand: source.project.verifyCommand,
      trackerKind: source.project.trackerKind,
      buildRecordLogging: source.project.buildRecordLogging,
      visibility: source.project.visibility,
      ...(source.project.deliveryRecipe === "pull-request"
        ? {}
        : { deliveryRecipe: source.project.deliveryRecipe }),
      ...(source.project.adversarialReview === false ? { adversarialReview: false } : {}),
      trackerCommandsJson: source.project.trackerCommandsJson,
    },
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** The stored tracker commands as a name → command map; empty when absent or unreadable. */
export function parseTrackerCommands(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * What {@link BUNDLE_TOKEN} becomes at export: the bundle directory relative
 * to the repository root (forward slashes) for a tracked project, or its
 * absolute path for an ignored one.
 */
export function bundlePathFor(
  visibility: ProjectVisibility,
  rootPath: string,
  bundleDir: string,
): string {
  if (visibility === "ignored") return bundleDir;
  const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  const relative = bundleDir.startsWith(prefix) ? bundleDir.slice(prefix.length) : bundleDir;
  return relative.split("\\").join("/");
}

export function fillBundlePath(markdown: string, bundlePath: string): string {
  return markdown.split(BUNDLE_TOKEN).join(bundlePath);
}

interface TicketNames {
  label: string;
  fileStem: string;
}

function ticketNames(ticket: HandoffTicket, total: number): TicketNames {
  const label = padTicketNumber(ticket.number, total);
  return { label, fileStem: `${label}-${sanitizeTicketSlug(ticket.slug, ticket.number)}` };
}

function blockerLabels(ticket: HandoffTicket, total: number): string[] {
  return [...ticket.blockedBy].sort((a, b) => a - b).map((n) => padTicketNumber(n, total));
}

function codeBlock(text: string, language = "bash"): string {
  return ["```" + language, text, "```"].join("\n");
}

/**
 * Wraps `value` as CommonMark inline code, safe for a value that itself
 * contains backticks: the fence is one backtick longer than the longest run
 * of backticks inside `value`, and a value that starts or ends with a
 * backtick is padded with a single space on that side, per the CommonMark
 * rule for inline code spans. A value with no backticks gets the usual
 * single-backtick fence.
 */
function inlineCode(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function pathsNote(source: HandoffSource, facts: ExportFacts): string {
  const { project } = source;
  if (facts.visibility === "tracked" && facts.greenfield) {
    return [
      `Paths below are relative to the repository root (\`${project.rootPath}\`).`,
      `The bundle lives in \`${project.workingExportFolder}\`, which git will track once it is committed; this repository has no commits yet.`,
    ].join(" ");
  }
  if (facts.visibility === "tracked") {
    return [
      `Paths below are relative to the repository root (\`${project.rootPath}\`).`,
      `The bundle lives in \`${project.workingExportFolder}\`, which git tracks.`,
    ].join(" ");
  }
  return [
    `Paths below are absolute, into the main checkout at \`${project.rootPath}\`.`,
    `The bundle lives in \`${project.workingExportFolder}\`, which git ignores: it never reaches a worktree through git.`,
  ].join(" ");
}

function beforeDelegatingSection(source: HandoffSource, facts: ExportFacts): string {
  const lines = ["## Before delegating the first ticket", ""];
  const { deliveryRecipe } = source.project;
  const { visibility } = facts;

  if (facts.greenfield) {
    lines.push(
      "This repository has no commits yet (greenfield). A worktree branches from a commit, so make the first commit before delegating the first ticket.",
      "",
    );
  }

  if (deliveryRecipe === "local-merge") {
    lines.push(
      `Add the \`worktree.baseRef\` key, set to \`"head"\`, to this repository's \`.claude/settings.json\` — merge it into whatever settings are already there, never replace the file — before delegating the first ticket, and keep \`main\` checked out in this session for as long as you keep delegating: with this recipe, a new worktree branches from your current local \`main\`, so each one needs it to already hold everything merged so far. Use \`.claude/settings.local.json\` instead when this setting should stay personal rather than shared with the repository.`,
      "",
    );
  }

  if (visibility === "tracked") {
    if (deliveryRecipe === "pull-request") {
      lines.push(
        "Worktree agents start from `origin/main`, so they see the bundle only once it is committed and pushed. Grill Room never commits in this repository; do it yourself, once, before delegating:",
        "",
        codeBlock(
          [
            `git add ${BUNDLE_TOKEN}`,
            `git commit -m "Add the ${source.session.title} handoff bundle"`,
            "git push",
          ].join("\n"),
        ),
        "",
        "Commit and push again whenever the bundle is re-exported.",
      );
    } else {
      lines.push(
        "Grill Room never commits in this repository; commit the bundle yourself, once, before delegating, so the first worktree contains it:",
        "",
        codeBlock(
          [`git add ${BUNDLE_TOKEN}`, `git commit -m "Add the ${source.session.title} handoff bundle"`].join(
            "\n",
          ),
        ),
        "",
        "Commit again whenever the bundle is re-exported.",
      );
    }
  } else {
    lines.push(
      `The bundle is ignored by git, so no worktree will ever contain it. Worktree agents must read the spec, their ticket and their brief by absolute path into this main checkout (\`${BUNDLE_TOKEN}\`); every brief says so. Do not copy the bundle into a worktree and do not commit it.`,
    );
  }
  return lines.join("\n");
}

/**
 * The "Before launching a ticket" bullet about the brief's two slots. With
 * current grounding they are already filled, so the orchestrator checks them
 * instead of filling them by hand; with no grounding, or stale grounding that
 * still needs checking against today's code, today's fill-them-in wording is
 * unchanged.
 */
function fillSlotsLine(groundingCurrent: boolean): string {
  if (groundingCurrent) {
    return "- The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand. Then paste the whole brief as the delegation prompt.";
  }
  return "- Fill the brief's **File boundaries** slot, naming the files the ticket builds on: the agent's first step is to confirm they exist, and it stops and reports rather than recreating them. Fill the **Codebase facts** slot. Then paste the whole brief as the delegation prompt.";
}

/** Paths as inline code: `` `a` and `b` ``, or `` `a`, `b` and `c` ``. */
function pathList(paths: readonly string[]): string {
  const codes = paths.map(inlineCode);
  return codes.length <= 1 ? codes.join("") : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/**
 * The waves. When the export checked for overlapping files
 * (`exportFacts.waves` present), they are the separated waves with one line
 * per ordering the separation added. Otherwise they come from Blocked-by, and
 * the section says overlaps were not checked.
 */
function wavesSection(source: HandoffSource, exportFacts?: ExportFacts): string {
  const total = source.tickets.length;
  const byNumber = new Map(source.tickets.map((ticket) => [ticket.number, ticket]));
  const checked = exportFacts?.waves !== undefined;
  const waves = exportFacts?.waves ?? source.waves;
  const lines = [
    "## Waves",
    "",
    checked
      ? "Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most two at a time. Start a wave only once every ticket of the previous wave is merged and verified."
      : "Tickets in one wave have no Blocked-by between them. Whether they change the same files was not checked, because the briefs are not grounded against the current code: run them one at a time, or ground the briefs first. Start a wave only once every ticket of the previous wave is merged and verified.",
  ];

  if (checked) {
    const waveOf = new Map(waves.flatMap((wave, index) => wave.map((number) => [number, index] as const)));
    const edges = [...(exportFacts?.implicitEdges ?? [])].sort(
      (a, b) =>
        (waveOf.get(a.ticket) ?? 0) - (waveOf.get(b.ticket) ?? 0) ||
        a.ticket - b.ticket ||
        a.waitsFor - b.waitsFor,
    );
    if (edges.length > 0) lines.push("");
    for (const edge of edges) {
      lines.push(
        `- Ticket ${padTicketNumber(edge.ticket, total)} waits for ticket ${padTicketNumber(edge.waitsFor, total)}: both change ${pathList(edge.sharedPaths)}.`,
      );
    }
  }

  waves.forEach((wave, index) => {
    lines.push("", `### Wave ${index + 1}`, "");
    for (const number of wave) {
      const ticket = byNumber.get(number);
      if (!ticket) continue;
      const { label, fileStem } = ticketNames(ticket, total);
      const blockers = blockerLabels(ticket, total);
      lines.push(
        `- **${label} ${ticket.title}**${blockers.length > 0 ? ` (blocked by ${blockers.join(", ")})` : ""}`,
        `  - Ticket: \`${BUNDLE_TOKEN}/issues/${fileStem}.md\``,
        `  - Brief: [\`${BUNDLE_TOKEN}/briefs/${fileStem}.md\`](briefs/${fileStem}.md)`,
      );
      if (source.project.trackerKind === "markdown") {
        lines.push("  - Status: ready-for-agent");
      }
    }
  });
  return lines.join("\n");
}

/**
 * The pull-request worktree lifecycle, embedded whole so the target
 * repository needs no rules file of its own. The pull request is always
 * opened as a draft, and a draft is never merged, whether or not the review
 * gate is on: with the gate on, the reviewer marks it ready on approval;
 * with it off, the main session marks it ready itself once satisfied.
 */
function pullRequestLifecycle(source: HandoffSource, groundingCurrent: boolean): string {
  const verify = `\`${source.project.verifyCommand}\``;
  const review = source.project.adversarialReview;
  const closeStep =
    source.project.trackerKind === "beads"
      ? "Close the ticket's bead with a comment naming the PR."
      : "Set the ticket's `Status:` line in this file to `done (PR #<n>)`.";

  const mainSessionSteps = review
    ? [
        "1. Read the PR diff (`gh pr diff <n>`) against the brief's file boundaries.",
        '2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below) and wait for its verdict comment on the pull request.',
        `3. Once the reviewer approves and marks the pull request ready, re-run ${verify} yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.`,
        "4. If it fails, run `gh pr ready --undo <n>` to put the pull request back in draft, then send the failure back to the same agent on its branch; the fix lands as a new commit on the same PR, and goes back to the reviewer.",
        "5. Merge only a ready, approved pull request whose re-verification in step 3 has passed: `gh pr merge <n> --merge --delete-branch`. Never merge a draft.",
        `6. \`git pull\` on local \`main\` and re-run ${verify} on the merged result.`,
        `7. ${closeStep}`,
        "8. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).",
      ]
    : [
        "1. Read the PR diff (`gh pr diff <n>`) against the brief's file boundaries.",
        `2. Re-run ${verify} yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.`,
        "3. Send failures back to the same agent on its branch; the fix lands as a new commit on the same PR.",
        "4. Mark the pull request ready (`gh pr ready <n>`) once you are satisfied, then merge: `gh pr merge <n> --merge --delete-branch`. Never merge a draft.",
        `5. \`git pull\` on local \`main\` and re-run ${verify} on the merged result.`,
        `6. ${closeStep}`,
        "7. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).",
      ];

  return [
    "## Delegation lifecycle",
    "",
    "Every ticket runs in its own worktree (Agent tool, `isolation: \"worktree\"`) and reaches `main` only through a pull request you have reviewed and verified. Worktrees are created from `origin/main`, not from local `main`, so work merged only locally is invisible to the next worktree.",
    "",
    "### Before launching a ticket",
    "",
    "- Local `main` holds nothing unpushed (`git status`, `git log origin/main..main`). Push it first if it does, so the worktree's base includes it.",
    fillSlotsLine(groundingCurrent),
    "",
    "### The subagent",
    "",
    "- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.",
    `- Runs ${verify}; it must pass.`,
    "- Checks `gh auth status`. If the active account is not the one this repository expects, it stops before pushing and reports \"push pending: gh account\" with its commit hash.",
    "- Otherwise pushes its branch (`git push -u origin HEAD`) and opens a **draft** pull request against `main` with `gh pr create --draft`. The title names the ticket; the body carries the ticket path, files changed, the exact verification output, and anything the brief left ambiguous.",
    "- Reports the PR, then stops. It never merges, and a draft is never merged by anyone.",
    "",
    "### You, the main session",
    "",
    mainSessionSteps.join("\n"),
  ].join("\n");
}

/**
 * The local-merge worktree lifecycle: every ticket still runs on its own
 * worktree branch, but it reaches `main` only once the main session merges
 * it in locally, never through a push, `gh`, or a pull request. Chosen for a
 * repository with no remote, or by hand for one that has a remote but is
 * kept local for this workflow; either way `worktree.baseRef: "head"` (set
 * in "Before delegating the first ticket") is what makes a new worktree
 * branch from the main session's current `main`.
 */
function localMergeLifecycle(source: HandoffSource, groundingCurrent: boolean): string {
  const verify = `\`${source.project.verifyCommand}\``;
  const review = source.project.adversarialReview;
  const closeStep =
    source.project.trackerKind === "beads"
      ? `Close the ticket's bead with a comment naming the merge commit${review ? " and the reviewer's verdict" : ""}.`
      : `Set the ticket's \`Status:\` line in this file to \`done (merged)\`${review ? " (the ticket's \`## Review\` section already carries the reviewer's verdict)" : ""}.`;

  const mainSessionSteps = review
    ? [
        "1. Read the branch diff (`git diff main..<branch>`) against the brief's file boundaries.",
        '2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below) and wait for its verdict.',
        `3. Once the reviewer approves, re-run ${verify} yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.`,
        "4. Send failures back to the same agent on its branch; the fix lands as a new commit there, and goes back to the reviewer.",
        "5. Merge only approved, verified work, locally: `git merge --no-ff <branch>`.",
        `6. Re-run ${verify} on \`main\` after merging.`,
        `7. ${closeStep}`,
        "8. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).",
      ]
    : [
        "1. Read the branch diff (`git diff main..<branch>`) against the brief's file boundaries.",
        `2. Re-run ${verify} yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.`,
        "3. Send failures back to the same agent on its branch; the fix lands as a new commit there.",
        "4. Merge only verified work, locally: `git merge --no-ff <branch>`.",
        `5. Re-run ${verify} on \`main\` after merging.`,
        `6. ${closeStep}`,
        "7. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).",
      ];

  return [
    "## Delegation lifecycle",
    "",
    "Every ticket runs in its own worktree (Agent tool, `isolation: \"worktree\"`), on its own branch, and reaches `main` only once you merge it in locally. With `worktree.baseRef` set to `head` (see \"Before delegating the first ticket\"), each new worktree branches from your current local `main`, so work merged there is immediately visible to the next one.",
    "",
    "### Before launching a ticket",
    "",
    "- Local `main` holds every change you want the next worktree to start from — commit it before delegating.",
    fillSlotsLine(groundingCurrent),
    "",
    "### The subagent",
    "",
    "- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.",
    `- Runs ${verify}; it must pass.`,
    "- Reports its branch name, then stops. It never merges.",
    "",
    "### You, the main session",
    "",
    mainSessionSteps.join("\n"),
  ].join("\n");
}

function lifecycleSection(source: HandoffSource, groundingCurrent: boolean): string {
  return source.project.deliveryRecipe === "pull-request"
    ? pullRequestLifecycle(source, groundingCurrent)
    : localMergeLifecycle(source, groundingCurrent);
}

/**
 * The fixed "Reviewing a ticket" section, present only when the project's
 * adversarial review switch is on. Its verdict paragraph is the one part
 * that varies: a pull-request comment and `gh pr ready`, or, for local
 * merge, the reviewer only reports its verdict — it writes to neither the
 * tracker nor the bundle — and the main session is the one who records it: a
 * bead comment naming the merge commit and the verdict together (the close
 * step already does), or, for a markdown tracker, a `## Review` section
 * appended to the ticket file, since the one-line `Status:` line has no room
 * for a rejected round's findings.
 */
function reviewingSection(source: HandoffSource): string {
  let verdict: string;
  if (source.project.deliveryRecipe === "pull-request") {
    verdict =
      'It posts its verdict as a pull request comment, starting "Review verdict: approved" or "Review verdict: changes requested" with each finding, then runs `gh pr ready <n>` on approval.';
  } else {
    verdict =
      source.project.trackerKind === "beads"
        ? 'It reports its verdict to you — approved, or changes requested with each finding — starting "Review verdict: approved" or "Review verdict: changes requested"; it writes to neither the tracker nor the bundle. You record it through the project\'s tracker, the same way you record the merge: as a comment on the ticket\'s bead.'
        : 'It reports its verdict to you — approved, or changes requested with each finding — starting "Review verdict: approved" or "Review verdict: changes requested"; it writes to neither the tracker nor the bundle. You record it yourself: append a `## Review` section to the ticket file with the verdict and any findings — the one-line `Status:` line has no room for them — then set `Status:` once the ticket actually closes.';
  }
  return [
    "## Reviewing a ticket",
    "",
    "Every ticket is reviewed by a second, fresh-context agent before it can be merged.",
    "",
    "**Inputs.** The reviewer gets the spec, the ticket, its delegation brief and the diff — never the builder's report.",
    "",
    "**What to try to break.** Unmet acceptance criteria, changes outside the file boundaries, untested edge cases, seams with the tickets this one builds on, and claims the diff does not support.",
    "",
    `**Verdict.** ${verdict}`,
    "",
    "**Changes requested.** They go back to the builder on the same branch, and the same reviewer reviews again. After two rejected rounds, the operator decides.",
    "",
    "The reviewer changes no code and never merges.",
  ].join("\n");
}

function recordingSection(): string {
  return [
    "## What to record per ticket",
    "",
    "When a ticket closes, record:",
    "",
    "- the model the subagent ran on;",
    "- whether its first attempt passed verification;",
    "- whether it escalated to a stronger model;",
    "- what the delegation prompt was missing, when an attempt failed.",
    "",
    "An escalation is the most useful data point: it shows where the brief, not the model, was the weak link.",
  ].join("\n");
}

function commandsList(commands: Record<string, string>): string[] {
  return Object.entries(commands).map(([name, command]) => `- \`${name}\`: \`${command}\``);
}

function trackingSection(source: HandoffSource): string {
  const commands = parseTrackerCommands(source.project.trackerCommandsJson);
  const hasCommands = Object.keys(commands).length > 0;

  if (source.project.trackerKind === "beads") {
    const lines = [
      "## Tracking with beads",
      "",
      "Create one bead per ticket. Claim a bead before delegating its ticket, and close it only after you have verified and merged the change, naming the merge in the close comment. Recover state with `bd ready` and `git log`, never from memory.",
      "",
    ];
    if (hasCommands) {
      lines.push("The repository's declared tracker commands:", "", ...commandsList(commands));
    } else {
      lines.push(
        "- `bd ready`: find work that is ready",
        "- `bd update <id> --claim`: claim a bead before delegating",
        "- `bd close <id>`: close it after merging",
      );
    }
    return lines.join("\n");
  }

  const doneStatus = source.project.deliveryRecipe === "pull-request" ? "done (PR #<n>)" : "done (merged)";
  const lines = [
    "## Tracking in this file",
    "",
    `This repository tracks tickets as plain markdown. Each ticket above carries a \`Status:\` line: set it to \`in-progress\` when you delegate the ticket and to \`${doneStatus}\` once you have verified and merged it.`,
  ];
  if (hasCommands) {
    lines.push("", "The repository's declared tracker commands:", "", ...commandsList(commands));
  }
  return lines.join("\n");
}

function buildRecordSection(source: HandoffSource): string {
  const commands = source.tickets.map((ticket) =>
    [
      "pnpm action set-build-record",
      `--sessionId ${source.session.id} --ticketNumber ${ticket.number}`,
      '--model <model> --firstAttemptPassed <true|false> --escalated <true|false>',
      '--promptMissing "<what the brief was missing>" --ticketStatus done',
    ].join(" "),
  );
  return [
    "## Build records",
    "",
    "Log each ticket's outcome in Grill Room once it closes. Run these from the Grill Room app folder (they reach its running dev server); fill in the placeholders.",
    "",
    codeBlock(commands.join("\n")),
  ].join("\n");
}

export function renderHandoffMarkdown(
  source: HandoffSource,
  groundingCurrent = false,
  exportFacts?: ExportFacts,
): string {
  const facts = factsFor(source, exportFacts);
  const sections = [
    `# Handoff: ${source.session.title}`,
    ...openingSections(source.spec.markdown, source.session.idea),
    [
      "## Where things are",
      "",
      "This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.",
      "",
      pathsNote(source, facts),
      "",
      `- Spec: \`${BUNDLE_TOKEN}/spec.md\``,
      `- Tickets: \`${BUNDLE_TOKEN}/issues/\``,
      groundingCurrent
        ? `- Briefs: \`${BUNDLE_TOKEN}/briefs/\`, one per ticket, grounded and ready to paste as a delegation prompt`
        : `- Briefs: \`${BUNDLE_TOKEN}/briefs/\`, one per ticket, each ready to paste as a delegation prompt once its two slots are filled`,
      `- Grill Room session: \`${source.session.id}\``,
    ].join("\n"),
    [
      "## Verify command",
      "",
      codeBlock(source.project.verifyCommand),
      "",
      "Run from the repository root: once by the subagent before it hands the ticket back, and again by you before you merge it in.",
      ...(facts.greenfield ? ["", greenfieldVerifyLine(source)] : []),
    ].join("\n"),
    beforeDelegatingSection(source, facts),
    wavesSection(source, exportFacts),
    lifecycleSection(source, groundingCurrent),
  ];
  if (source.project.adversarialReview) sections.push(reviewingSection(source));
  sections.push(recordingSection(), trackingSection(source));
  if (source.project.buildRecordLogging) sections.push(buildRecordSection(source));
  return `${sections.join("\n\n")}\n`;
}

function bundleAccess(facts: ExportFacts, fileStem: string): string {
  const specPath = `\`${BUNDLE_TOKEN}/spec.md\``;
  const ticketPath = `\`${BUNDLE_TOKEN}/issues/${fileStem}.md\``;
  if (facts.visibility === "tracked" && facts.greenfield) {
    return `This repository had no commits when the bundle was exported. HANDOFF.md has the operator commit the bundle before delegating, so your worktree should have it: read the spec at ${specPath} and your ticket at ${ticketPath}, relative to the repository root in your worktree. If they are missing, stop and report.`;
  }
  if (facts.visibility === "tracked") {
    return `The bundle is committed in this repository, so your worktree has it. Read the spec at ${specPath} and your ticket at ${ticketPath}, relative to the repository root in your worktree.`;
  }
  return `The bundle is ignored by git, so it is NOT in your worktree. Read it by absolute path from the main checkout: the spec at ${specPath} and your ticket at ${ticketPath}. Never write to it.`;
}

/**
 * Every ticket other than 1 that does not reach ticket 1 through
 * Blocked-by, in ticket order (`source.tickets` is already number-ordered).
 * `break-into-tickets` requires every ticket to reach ticket 1 at the time
 * tickets are made, but a ticket set can drift from that afterwards: made
 * with no project before a greenfield one was attached, made before this
 * rule existed, or edited by `set-ticket-blocked-by` to drop the path.
 */
function ticketsNotReachingOne(tickets: readonly HandoffTicket[]): number[] {
  return tickets
    .map((ticket) => ticket.number)
    .filter((number) => number !== 1 && !transitiveBlockers(number, tickets).includes(1));
}

/** English list join for the greenfield reach note: "A", "A and B", "A, B and C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * In a repository with no commits, the verify command does not exist yet:
 * ticket 1 sets it up. Whether every other ticket actually waits for it
 * depends on whether it reaches ticket 1 through Blocked-by
 * ({@link transitiveBlockers}) — true at the time `break-into-tickets` makes
 * the tickets, but not guaranteed afterwards (see
 * {@link ticketsNotReachingOne}). This is HANDOFF's line under "Verify
 * command"; {@link greenfieldVerifyNote} is the brief's.
 */
function greenfieldVerifyLine(source: HandoffSource): string {
  const total = source.tickets.length;
  const first = padTicketNumber(1, total);
  const setUp = `This repository has no commits yet, so this command does not exist until ticket ${first} sets it up.`;
  const nonReaching = ticketsNotReachingOne(source.tickets).map((number) => padTicketNumber(number, total));
  if (nonReaching.length === 0) {
    return `${setUp} Ticket ${first}'s acceptance includes it passing, and every other ticket waits for ticket ${first}.`;
  }
  const acceptance = `Ticket ${first}'s acceptance includes it passing.`;
  if (nonReaching.length === 1) {
    const [only] = nonReaching;
    return `${setUp} ${acceptance} Ticket ${only} does not depend on ticket ${first}, so run ticket ${first} first and merge it before starting ticket ${only}.`;
  }
  return `${setUp} ${acceptance} Tickets ${joinList(nonReaching)} do not depend on ticket ${first}, so run ticket ${first} first and merge it before starting them.`;
}

function greenfieldVerifyNote(source: HandoffSource, ticketNumber: number): string {
  const verify = inlineCode(source.project.verifyCommand);
  if (ticketNumber === 1) {
    return `This repository has no commits yet: this ticket sets up ${verify}. Make it run and pass from the repository root; that is part of your acceptance.`;
  }
  const first = padTicketNumber(1, source.tickets.length);
  if (transitiveBlockers(ticketNumber, source.tickets).includes(1)) {
    return `${verify} is established by ticket ${first}, which is merged before this ticket starts.`;
  }
  return `${verify} is set up by ticket ${first}, but this ticket does not depend on it, so it may not exist yet. If ${verify} does not run from the repository root, stop and report; do not create it yourself.`;
}

function briefStepZero(
  source: HandoffSource,
  fileStem: string,
  facts: ExportFacts,
  ticketNumber: number,
): string {
  const base =
    source.project.deliveryRecipe === "pull-request"
      ? "`origin/main`"
      : "the main session's current `main`";
  return [
    "## Step 0: confirm your base",
    "",
    `Your worktree was created from ${base}. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.`,
    "",
    bundleAccess(facts, fileStem),
    ...(facts.greenfield ? ["", greenfieldVerifyNote(source, ticketNumber)] : []),
  ].join("\n");
}

/**
 * The brief's delivery section, selected by the project's delivery recipe:
 * a draft pull request, or a plain commit-and-report-your-branch step with
 * no push, `gh`, pull request or `origin` anywhere. On the pull-request
 * recipe, who marks it ready matches HANDOFF.md's lifecycle: the reviewer,
 * with the review switch on, or the main session, with it off.
 */
function briefDeliverySection(source: HandoffSource, prTitle: string): string {
  if (source.project.deliveryRecipe === "pull-request") {
    const readyLine = source.project.adversarialReview
      ? "Never merge, and never mark it ready — the reviewer does that once it approves."
      : "Never merge, and never mark it ready — the main session does that once it is satisfied.";
    return [
      "## Delivery",
      "",
      "When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report \"push pending: gh account\" with your commit hash.",
      "",
      `Otherwise run \`git push -u origin HEAD\`, then \`gh pr create --draft\` against \`main\`, titled ${prTitle}, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. ${readyLine}`,
    ].join("\n");
  }
  return [
    "## Delivery",
    "",
    "Commit your work on your worktree branch, then report its name: this project uses the local-merge recipe, so nothing you do here reaches `main` on its own. The main session reads the branch diff, verifies it, and merges it in locally.",
  ].join("\n");
}

/**
 * The brief's closing report, ending with the reviewer note only when the
 * project's adversarial review switch is on: with it off, the section says
 * nothing about a reviewer.
 */
function briefReportSection(source: HandoffSource): string {
  const verify = source.project.verifyCommand;
  const isPr = source.project.deliveryRecipe === "pull-request";
  const lines = ["## Report, then stop", "", "Report:", "", "- worktree path and branch;"];
  if (isPr) {
    lines.push("- the PR URL, or \"push pending: gh account\" with your commit hash;");
  }
  lines.push(
    "- commits and files changed;",
    `- the exact output of \`${verify}\`;`,
    "- anything ambiguous, and anything this brief was missing.",
  );
  if (source.project.adversarialReview) {
    lines.push("", "A separate reviewer reviews the work before any merge.");
  }
  lines.push("", "Then stop. Do no further work of any kind.");
  return lines.join("\n");
}

/** The grounding entry for `ticket`, or null when the grounding has none (absent, or this ticket is not in it). */
function groundingEntryFor(
  grounding: HandoffGrounding | null,
  ticket: HandoffTicket,
): HandoffTicketGrounding | null {
  return grounding?.tickets.find((entry) => entry.number === ticket.number) ?? null;
}

/**
 * The one line rendered when a grounded brief's grounding is stale: which
 * commit it read (a short hash, or "before this repository had a commit" for
 * one with none yet), and why it no longer describes today's handoff or
 * project.
 */
function groundingStaleLine(grounding: HandoffGrounding): string {
  const at = grounding.commitRead
    ? `at commit \`${grounding.commitRead.slice(0, 7)}\``
    : "before this repository had a commit";
  return grounding.staleReason === "handoff-changed"
    ? `_Grounded ${at} for an earlier version of the handoff (tickets or project settings)._`
    : `_Grounded ${at}; the repository has moved since._`;
}

/**
 * The files to create, the files to edit, and the existing files it builds
 * on. A file to edit that one of the ticket's blockers creates is marked
 * "(created by ticket NN)", so the builder knows it waits on that file rather
 * than finding it today.
 */
function fileBoundariesContent(
  source: HandoffSource,
  entry: HandoffTicketGrounding,
  grounding: HandoffGrounding,
): string {
  const creates = entry.filesToChange.filter((file) => file.change === "create");
  const edits = entry.filesToChange.filter((file) => file.change === "edit");
  const total = source.tickets.length;
  const editLine = (filePath: string): string => {
    const creator = blockerThatCreates(filePath, entry.number, source.tickets, grounding.tickets);
    return creator === null
      ? `- \`${filePath}\``
      : `- \`${filePath}\` (created by ticket ${padTicketNumber(creator, total)})`;
  };
  const groups: string[] = [];
  if (creates.length > 0) {
    groups.push(["Files to create:", "", ...creates.map((file) => `- \`${file.path}\``)].join("\n"));
  }
  if (edits.length > 0) {
    groups.push(["Files to edit:", "", ...edits.map((file) => editLine(file.path))].join("\n"));
  }
  if (entry.buildsOnFiles.length > 0) {
    groups.push(
      ["Existing files it builds on:", "", ...entry.buildsOnFiles.map((citation) => `- \`${citation}\``)].join(
        "\n",
      ),
    );
  }
  return groups.length > 0 ? groups.join("\n\n") : "No files to create or edit.";
}

function codebaseFactsContent(entry: HandoffTicketGrounding): string {
  if (entry.facts.length === 0) return "No codebase facts cited.";
  return entry.facts.map((fact) => `- ${fact.statement} (\`${fact.citation}\`)`).join("\n");
}

/**
 * The "File boundaries" section: today's empty slot when the ticket has no
 * grounding entry (absent grounding, or one that does not cover this
 * ticket), otherwise the files to create and edit and the existing files it
 * builds on, cited — with the staleness line first when the grounding is
 * stale.
 */
function fileBoundariesSection(
  source: HandoffSource,
  ticket: HandoffTicket,
  grounding: HandoffGrounding | null,
): string {
  const entry = groundingEntryFor(grounding, ticket);
  if (!entry) {
    return [
      "## File boundaries",
      "",
      FILE_BOUNDARIES_SLOT,
      "",
      "_Slot for the orchestrating session: the files and folders this ticket may create or edit, and the existing files it builds on._",
    ].join("\n");
  }
  const lines = ["## File boundaries", ""];
  if (!grounding!.current) lines.push(groundingStaleLine(grounding!), "");
  lines.push(fileBoundariesContent(source, entry, grounding!));
  return lines.join("\n");
}

/** The "Codebase facts" section: today's empty slot, or the grounded facts, cited. */
function codebaseFactsSection(ticket: HandoffTicket, grounding: HandoffGrounding | null): string {
  const entry = groundingEntryFor(grounding, ticket);
  if (!entry) {
    return [
      "## Codebase facts",
      "",
      CODEBASE_FACTS_SLOT,
      "",
      "_Slot for the orchestrating session: verified facts about the code this ticket touches._",
    ].join("\n");
  }
  return ["## Codebase facts", "", codebaseFactsContent(entry)].join("\n");
}

/**
 * A new "Builds on" section, one line per blocker: what this ticket needs
 * from it, where — a citation, "created by ticket NN at <path>" for a
 * dependency on a path the blocker has not created yet, or "ticket NN adds
 * <symbol> to <path>" for one on what the blocker adds to a file it edits —
 * and the check to run first. Absent entirely when the ticket has no grounding entry or the
 * entry names no dependency (no blockers).
 */
function buildsOnSection(
  source: HandoffSource,
  ticket: HandoffTicket,
  grounding: HandoffGrounding | null,
): string | null {
  const entry = groundingEntryFor(grounding, ticket);
  if (!entry || entry.buildsOn.length === 0) return null;
  const total = source.tickets.length;
  const lines = entry.buildsOn.map((dependency) => {
    const label = padTicketNumber(dependency.blocker, total);
    const where =
      dependency.citation !== null
        ? inlineCode(dependency.citation)
        : dependency.createdPath !== null
          ? `created by ticket ${label} at ${inlineCode(dependency.createdPath)}`
          : `ticket ${label} adds ${inlineCode(dependency.symbol!)} to ${inlineCode(dependency.editedPath!)}`;
    return `- Ticket ${label}: ${dependency.provides} — ${where} — check: ${inlineCode(dependency.check)}`;
  });
  return ["## Builds on", "", ...lines].join("\n");
}

/**
 * A new "Proved by" section: the test to add or extend, and the command that
 * proves the ticket. A ticket with no test path, one the spec keeps untested,
 * shows the command alone. Absent entirely when the ticket has no grounding
 * entry.
 */
function provedBySection(ticket: HandoffTicket, grounding: HandoffGrounding | null): string | null {
  const entry = groundingEntryFor(grounding, ticket);
  if (!entry) return null;
  const { testPath, command } = entry.provedBy;
  return [
    "## Proved by",
    "",
    ...(testPath === null ? [] : [`Test: \`${testPath}\``, ""]),
    codeBlock(command),
  ].join("\n");
}

export interface RenderBriefOptions {
  /** The session's grounding, current or stale; null or omitted when it has none. */
  grounding?: HandoffGrounding | null;
}

/**
 * Renders one brief fresh from today's template. Whether a *stored* brief
 * should be rendered fresh at all — versus kept exactly as it is because the
 * user edited it — is not this function's concern: `server/export-bundle.ts`
 * decides that at export time, the only place grounding reaches a brief's
 * text. This function always renders; it never returns anything but a fresh
 * render.
 */
export function renderBrief(
  source: HandoffSource,
  ticket: HandoffTicket,
  options: RenderBriefOptions = {},
  exportFacts?: ExportFacts,
): string {
  const facts = factsFor(source, exportFacts);
  const grounding = options.grounding ?? null;
  const total = source.tickets.length;
  const { label, fileStem } = ticketNames(ticket, total);
  const blockers = blockerLabels(ticket, total);
  const verify = source.project.verifyCommand;
  const prTitle =
    source.project.trackerKind === "beads"
      ? `\`<bead id>: ${ticket.title}\``
      : `\`${label}: ${ticket.title}\``;

  const sections: (string | null)[] = [
    `# Brief ${label}: ${ticket.title}`,
    `You are implementing ticket ${label} of "${source.session.title}". You work only inside the git worktree you were started in.`,
    briefStepZero(source, fileStem, facts, ticket.number),
    [
      "## The ticket",
      "",
      `Blocked by: ${blockers.length > 0 ? `${blockers.join(", ")} (merged before this brief was delegated)` : "none"}`,
      "",
      `### ${label} ${ticket.title}`,
      "",
      ticket.body,
    ].join("\n"),
    fileBoundariesSection(source, ticket, grounding),
    codebaseFactsSection(ticket, grounding),
    buildsOnSection(source, ticket, grounding),
    provedBySection(ticket, grounding),
    [
      "## Rules",
      "",
      "- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.",
      "- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.",
      "- Commit on your worktree branch as you go.",
    ].join("\n"),
    ["## Verify", "", "From the repository root in your worktree, this must exit 0:", "", codeBlock(verify)].join("\n"),
    briefDeliverySection(source, prTitle),
    briefReportSection(source),
  ];

  return `${sections.filter((section): section is string => section !== null).join("\n\n")}\n`;
}

export interface RenderHandoffOptions {
  /** The session's grounding, current or stale; null or omitted when it has none. */
  grounding?: HandoffGrounding | null;
}

export function renderHandoff(source: HandoffSource, options: RenderHandoffOptions = {}): RenderedHandoff {
  const total = source.tickets.length;
  const groundingCurrent = (options.grounding ?? null)?.current === true;
  return {
    markdown: renderHandoffMarkdown(source, groundingCurrent),
    briefs: source.tickets.map((ticket) => ({
      ticketNumber: ticket.number,
      relativePath: `briefs/${ticketNames(ticket, total).fileStem}.md`,
      markdown: renderBrief(source, ticket, { grounding: options.grounding }),
    })),
  };
}

export type HandoffSourceRefusal =
  | { errorCode: "session-not-found"; message: string }
  | { errorCode: "no-project"; message: string }
  | { errorCode: "project-not-found"; message: string }
  | { errorCode: "spec-missing"; message: string }
  | { errorCode: "no-tickets"; message: string }
  | { errorCode: "ticket-cycle"; message: string };

/** Reads today's inputs for a session's handoff, or the reason there are none. */
export async function loadHandoffSource(
  sessionId: string,
): Promise<{ source: HandoffSource } | { refusal: HandoffSourceRefusal }> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) {
    return { refusal: { errorCode: "session-not-found", message: `Session not found: ${sessionId}` } };
  }
  if (!session.projectId) {
    return {
      refusal: {
        errorCode: "no-project",
        message: "Choose the project this session exports into before generating a handoff.",
      },
    };
  }
  const project = await getProject(session.projectId);
  if (!project) {
    return {
      refusal: { errorCode: "project-not-found", message: `Project not found: ${session.projectId}` },
    };
  }
  const [spec] = await db
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, sessionId))
    .limit(1);
  if (!spec) {
    return {
      refusal: { errorCode: "spec-missing", message: "This session has no spec yet." },
    };
  }
  const rows = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.sessionId, sessionId))
    .orderBy(schema.tickets.number);
  if (rows.length === 0) {
    return {
      refusal: {
        errorCode: "no-tickets",
        message: "This session has no tickets. Break the spec into tickets first.",
      },
    };
  }
  const tickets = describeTickets(rows);
  const waves = computeWaves(tickets);
  if (!waves.ok) {
    return {
      refusal: {
        errorCode: "ticket-cycle",
        message: `These tickets form a blocking cycle: ${waves.cycle.join(", ")}.`,
      },
    };
  }

  return {
    source: {
      session: { id: session.id, title: session.title, idea: session.idea },
      spec: {
        updatedAt: spec.updatedAt,
        ticketsGeneratedAt: spec.ticketsGeneratedAt,
        markdown: spec.markdown,
      },
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        slug: ticket.slug,
        title: ticket.title,
        body: ticket.body,
        blockedBy: ticket.blockedBy,
      })),
      waves: waves.waves,
      project: {
        rootPath: project.rootPath,
        workingExportFolder: project.workingExportFolder,
        verifyCommand: project.verifyCommand,
        trackerKind: project.trackerKind,
        buildRecordLogging: project.buildRecordLogging,
        visibility: project.visibility,
        deliveryRecipe: project.deliveryRecipe,
        adversarialReview: project.adversarialReview,
        trackerCommandsJson: project.trackerCommandsJson,
      },
    },
  };
}

export type HandoffRow = typeof schema.handoffs.$inferSelect;

export async function getHandoffRow(sessionId: string): Promise<HandoffRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.handoffs)
    .where(eq(schema.handoffs.sessionId, sessionId))
    .limit(1);
  return row;
}

/**
 * A brief as stored. `generatedSha256` is its baseline: the
 * {@link hashExportContent} of the text Grill Room generated for it (the
 * ungrounded render with no export facts). The brief is edited exactly when
 * its text no longer hashes to it. A legacy row's briefs have none.
 */
export interface StoredHandoffBrief extends HandoffBrief {
  generatedSha256?: string;
}

/** Stored briefs; malformed entries are dropped rather than trusted, and a non-string baseline is dropped. */
export function parseBriefs(json: string): StoredHandoffBrief[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { ticketNumber, relativePath, markdown, generatedSha256 } = entry as Record<string, unknown>;
    if (
      typeof ticketNumber !== "number" ||
      typeof relativePath !== "string" ||
      typeof markdown !== "string"
    ) {
      return [];
    }
    return typeof generatedSha256 === "string"
      ? [{ ticketNumber, relativePath, markdown, generatedSha256 }]
      : [{ ticketNumber, relativePath, markdown }];
  });
}

/**
 * The stored texts, their baselines and `editedAt`: everything the edit
 * report and a regeneration read from a handoff row. A **legacy** handoff,
 * stored before baselines existed, has `markdownGeneratedSha256` null.
 */
export interface StoredHandoffText {
  markdown: string;
  markdownGeneratedSha256: string | null;
  briefs: readonly StoredHandoffBrief[];
  editedAt: string | null;
}

export function storedHandoffText(row: HandoffRow): StoredHandoffText {
  return {
    markdown: row.markdown,
    markdownGeneratedSha256: row.markdownGeneratedSha256,
    briefs: parseBriefs(row.briefsJson),
    editedAt: row.editedAt,
  };
}

function isBriefEdited(brief: StoredHandoffBrief): boolean {
  return brief.generatedSha256 !== undefined && hashExportContent(brief.markdown) !== brief.generatedSha256;
}

function byTicketNumber(a: StoredHandoffBrief, b: StoredHandoffBrief): number {
  return a.ticketNumber - b.ticketNumber;
}

/** Which texts carry a hand edit, and which edited briefs Grill Room would now generate differently. */
export interface HandoffEdits {
  handoffEdited: boolean;
  /** Ticket numbers, ascending. */
  editedBriefs: number[];
  /**
   * Edited briefs whose ticket is gone, or whose fresh render today differs
   * from the one they were baselined on (their ticket, the project or the
   * template changed). Empty when today's inputs cannot be read.
   */
  outdatedBriefs: number[];
}

export function describeHandoffEdits(stored: StoredHandoffText, source: HandoffSource | null): HandoffEdits {
  if (stored.markdownGeneratedSha256 === null) {
    return { handoffEdited: false, editedBriefs: [], outdatedBriefs: [] };
  }
  const edited = stored.briefs.filter(isBriefEdited).sort(byTicketNumber);
  const outdated =
    source === null
      ? []
      : edited.filter((brief) => {
          const ticket = source.tickets.find((candidate) => candidate.number === brief.ticketNumber);
          return !ticket || hashExportContent(renderBrief(source, ticket)) !== brief.generatedSha256;
        });
  return {
    handoffEdited: hashExportContent(stored.markdown) !== stored.markdownGeneratedSha256,
    editedBriefs: edited.map((brief) => brief.ticketNumber),
    outdatedBriefs: outdated.map((brief) => brief.ticketNumber),
  };
}

/** What a regeneration stores: the texts, their baselines, and `editedAt`. */
export interface RegeneratedHandoff {
  markdown: string;
  markdownGeneratedSha256: string;
  briefs: StoredHandoffBrief[];
  editedAt: string | null;
}

export const HANDOFF_EDITED_MESSAGE =
  "The handoff was edited since it was generated. Confirm to overwrite the edits.";
export const HANDOFF_MARKDOWN_EDITED_MESSAGE =
  "HANDOFF.md was edited since it was generated, and regenerating rewrites it. Confirm to overwrite the edits.";

function removedEditedBriefsMessage(paths: readonly string[]): string {
  return paths.length === 1
    ? `The edited brief ${paths[0]} has no ticket any more, so regenerating removes it. Confirm to overwrite the edits.`
    : `The edited briefs ${joinList(paths)} have no ticket any more, so regenerating removes them. Confirm to overwrite the edits.`;
}

function freshlyGenerated(rendered: RenderedHandoff): RegeneratedHandoff {
  return {
    markdown: rendered.markdown,
    markdownGeneratedSha256: hashExportContent(rendered.markdown),
    briefs: rendered.briefs.map((brief) => ({ ...brief, generatedSha256: hashExportContent(brief.markdown) })),
    editedAt: null,
  };
}

/**
 * Merges today's render into a stored handoff. Without `overwriteEdits` it
 * never loses an edit: every unedited text is rewritten with a new baseline,
 * and every edited brief whose ticket still exists is kept word for word, at
 * today's path, with its old baseline (so it still reads as edited, and as
 * outdated when its render changed). It refuses when keeping an edit is
 * impossible, the first match winning: a legacy handoff that carries edits
 * (it has no baselines to tell which), an edited HANDOFF.md (it is never
 * kept: it lists every ticket and brief, so a kept copy would be an
 * out-of-date entry point), or an edited brief whose ticket is gone.
 * `editedAt` stays as it was while a brief is kept, and is cleared otherwise.
 */
export function regenerateHandoff(
  stored: StoredHandoffText | null,
  rendered: RenderedHandoff,
  overwriteEdits: boolean,
): { refusal: string } | { handoff: RegeneratedHandoff } {
  const fresh = freshlyGenerated(rendered);
  if (stored === null || overwriteEdits) return { handoff: fresh };

  if (stored.markdownGeneratedSha256 === null) {
    return stored.editedAt ? { refusal: HANDOFF_EDITED_MESSAGE } : { handoff: fresh };
  }
  if (hashExportContent(stored.markdown) !== stored.markdownGeneratedSha256) {
    return { refusal: HANDOFF_MARKDOWN_EDITED_MESSAGE };
  }

  const edited = stored.briefs.filter(isBriefEdited).sort(byTicketNumber);
  const renderedNumbers = new Set(rendered.briefs.map((brief) => brief.ticketNumber));
  const removed = edited.filter((brief) => !renderedNumbers.has(brief.ticketNumber));
  if (removed.length > 0) {
    return { refusal: removedEditedBriefsMessage(removed.map((brief) => brief.relativePath)) };
  }

  const kept = new Map(edited.map((brief) => [brief.ticketNumber, brief]));
  return {
    handoff: {
      ...fresh,
      briefs: fresh.briefs.map((brief) => {
        const keep = kept.get(brief.ticketNumber);
        return keep
          ? {
              ticketNumber: brief.ticketNumber,
              relativePath: brief.relativePath,
              markdown: keep.markdown,
              generatedSha256: keep.generatedSha256,
            }
          : brief;
      }),
      editedAt: kept.size > 0 ? stored.editedAt : null,
    },
  };
}

/**
 * The baseline a brief carries after `update-handoff` replaces its text.
 * Saving an edited brief while the handoff is current marks it reviewed: its
 * baseline moves to today's render, so it stays edited but is no longer
 * outdated. Anything else (a legacy row, a text back to its generated one, a
 * stale handoff, no source, a ticket that is gone) leaves the baseline alone.
 */
export function baselineAfterEdit(
  brief: StoredHandoffBrief,
  markdown: string,
  context: { legacy: boolean; current: boolean; source: HandoffSource | null },
): string | undefined {
  const old = brief.generatedSha256;
  if (context.legacy || old === undefined || !context.current || context.source === null) return old;
  if (hashExportContent(markdown) === old) return old;
  const ticket = context.source.tickets.find((candidate) => candidate.number === brief.ticketNumber);
  return ticket ? hashExportContent(renderBrief(context.source, ticket)) : old;
}

/** Writes a regenerated handoff over the session's row (or creates it), with today's fingerprint. */
export async function saveGeneratedHandoff(
  sessionId: string,
  regenerated: RegeneratedHandoff,
  fingerprint: string,
): Promise<HandoffRow> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await getHandoffRow(sessionId);
  const texts = {
    markdown: regenerated.markdown,
    markdownGeneratedSha256: regenerated.markdownGeneratedSha256,
    briefsJson: JSON.stringify(regenerated.briefs),
    fingerprint,
    generatedAt: now,
    editedAt: regenerated.editedAt,
    updatedAt: now,
  };
  if (existing) {
    const [row] = await db
      .update(schema.handoffs)
      .set({ ...texts, revision: existing.revision + 1 })
      .where(eq(schema.handoffs.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(schema.handoffs)
    .values({ ...texts, id: randomUUID(), sessionId, revision: 1, createdAt: now })
    .returning();
  return row!;
}

/** Records that an export wrote this handoff at its current revision. */
export async function recordHandoffExport(row: HandoffRow): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .update(schema.handoffs)
    .set({
      exportedFingerprint: row.fingerprint,
      exportedRevision: row.revision,
      exportedAt: now,
    })
    .where(eq(schema.handoffs.id, row.id));
}

export interface HandoffView extends HandoffEdits {
  markdown: string;
  /** Exactly `{ ticketNumber, relativePath, markdown }`: baselines never reach the API. */
  briefs: HandoffBrief[];
  fingerprint: string;
  /** The fingerprint over today's inputs, or null when they cannot be read (no project, no tickets…). */
  currentFingerprint: string | null;
  /** Today's inputs differ from the ones this handoff was generated from, or can no longer be read. */
  stale: boolean;
  generatedAt: string;
  editedAt: string | null;
  exportedAt: string | null;
  /** The handoff was edited or regenerated after the last export that included it. */
  exportStale: boolean;
}

/** A stored handoff as the actions return it, against today's inputs (null when they cannot be read). */
export function describeHandoff(row: HandoffRow, source: HandoffSource | null): HandoffView {
  const currentFingerprint = source === null ? null : handoffFingerprint(source);
  const stored = storedHandoffText(row);
  return {
    markdown: row.markdown,
    briefs: stored.briefs.map(({ ticketNumber, relativePath, markdown }) => ({
      ticketNumber,
      relativePath,
      markdown,
    })),
    ...describeHandoffEdits(stored, source),
    fingerprint: row.fingerprint,
    currentFingerprint,
    stale: currentFingerprint !== row.fingerprint,
    generatedAt: row.generatedAt,
    editedAt: row.editedAt,
    exportedAt: row.exportedAt,
    exportStale: row.exportedRevision !== null && row.exportedRevision !== row.revision,
  };
}

/** Why `export-session` refuses to write, from the current handoff's gate. */
export type ExportGateReason = "handoff-missing" | "handoff-stale";

export interface ExportGate {
  blocked: boolean;
  reason: ExportGateReason | null;
}

/**
 * Whether a session's handoff is current enough to export: missing entirely,
 * stale against today's inputs (the same fingerprint comparison
 * {@link describeHandoff}'s `stale` makes, so a `set-ticket-blocked-by` edit
 * that never touches `ticketsGeneratedAt` counts here too), or clear. An
 * edited-but-current handoff is not blocked: an edit is not a change of
 * inputs, only a regeneration or an input change is.
 */
export async function getExportGate(sessionId: string): Promise<ExportGate> {
  const row = await getHandoffRow(sessionId);
  if (!row) return { blocked: true, reason: "handoff-missing" };

  const loaded = await loadHandoffSource(sessionId);
  const currentFingerprint = "source" in loaded ? handoffFingerprint(loaded.source) : null;
  if (currentFingerprint !== row.fingerprint) return { blocked: true, reason: "handoff-stale" };

  return { blocked: false, reason: null };
}
