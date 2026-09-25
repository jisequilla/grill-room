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
 * the path relative to the repository root when the project's visibility is
 * `tracked`, or the absolute path into the main checkout when it is `ignored`.
 * The visibility flag decides; git is not consulted again.
 *
 * ## Staleness
 *
 * {@link handoffFingerprint} hashes everything the templates render from:
 * the session's title and idea, the spec's `updatedAt` and
 * `ticketsGeneratedAt`, each ticket's id, number, slug, title, body and
 * `blockedBy` (ids change whenever tickets are regenerated), and the project
 * fields the templates read. A stored handoff is stale when the fingerprint
 * over today's inputs differs from the one it was generated from. This catches a blocker edit (`set-ticket-blocked-by` touches
 * the ticket row but not `ticketsGeneratedAt`) as well as a regeneration or a
 * project edit.
 */
import { createHash, randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

import type {
  DeliveryRecipe,
  ProjectTrackerKind,
  ProjectVisibility,
} from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";
import { padTicketNumber, sanitizeTicketSlug } from "./export.js";
import { getProject } from "./projects.js";
import { computeWaves, describeTickets } from "./tickets.js";

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
  spec: { updatedAt: string; ticketsGeneratedAt: string | null };
  /** In number order. */
  tickets: readonly HandoffTicket[];
  /** Ticket numbers grouped by wave, wave 1 first. */
  waves: readonly (readonly number[])[];
  project: {
    rootPath: string;
    exportFolder: string;
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
      exportFolder: source.project.exportFolder,
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

function pathsNote(source: HandoffSource): string {
  const { project } = source;
  if (project.visibility === "tracked") {
    return [
      `Paths below are relative to the repository root (\`${project.rootPath}\`).`,
      `The bundle lives in \`${project.exportFolder}\`, which git tracks.`,
    ].join(" ");
  }
  return [
    `Paths below are absolute, into the main checkout at \`${project.rootPath}\`.`,
    `The bundle lives in \`${project.exportFolder}\`, which git ignores: it never reaches a worktree through git.`,
  ].join(" ");
}

function beforeDelegatingSection(source: HandoffSource): string {
  const lines = ["## Before delegating the first ticket", ""];
  if (source.project.visibility === "tracked") {
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
      `The bundle is ignored by git, so no worktree will ever contain it. Worktree agents must read the spec, their ticket and their brief by absolute path into this main checkout (\`${BUNDLE_TOKEN}\`); every brief says so. Do not copy the bundle into a worktree and do not commit it.`,
    );
  }
  return lines.join("\n");
}

function wavesSection(source: HandoffSource): string {
  const total = source.tickets.length;
  const byNumber = new Map(source.tickets.map((ticket) => [ticket.number, ticket]));
  const lines = [
    "## Waves",
    "",
    "Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most two at a time. Start a wave only once every ticket of the previous wave is merged and verified.",
  ];

  source.waves.forEach((wave, index) => {
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
 * The PR-based worktree lifecycle, embedded whole so the target repository
 * needs no rules file of its own.
 */
function lifecycleSection(source: HandoffSource): string {
  const verify = `\`${source.project.verifyCommand}\``;
  const closeStep =
    source.project.trackerKind === "beads"
      ? "Close the ticket's bead with a comment naming the PR."
      : "Set the ticket's `Status:` line in this file to `done (PR #<n>)`.";
  return [
    "## Delegation lifecycle",
    "",
    "Every ticket runs in its own worktree (Agent tool, `isolation: \"worktree\"`) and reaches `main` only through a pull request you have reviewed and verified. Worktrees are created from `origin/main`, not from local `main`, so work merged only locally is invisible to the next worktree.",
    "",
    "### Before launching a ticket",
    "",
    "- Local `main` holds nothing unpushed (`git status`, `git log origin/main..main`). Push it first if it does, so the worktree's base includes it.",
    "- Fill the brief's **File boundaries** slot, naming the files the ticket builds on: the agent's first step is to confirm they exist, and it stops and reports rather than recreating them. Fill the **Codebase facts** slot. Then paste the whole brief as the delegation prompt.",
    "",
    "### The subagent",
    "",
    "- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.",
    `- Runs ${verify}; it must pass.`,
    "- Checks `gh auth status`. If the active account is not the one this repository expects, it stops before pushing and reports \"push pending: gh account\" with its commit hash.",
    "- Otherwise pushes its branch (`git push -u origin HEAD`) and opens a pull request against `main` with `gh pr create`. The title names the ticket; the body carries the ticket path, files changed, the exact verification output, and anything the brief left ambiguous.",
    "- Reports the PR, then stops. It never merges.",
    "",
    "### You, the main session",
    "",
    "1. Read the PR diff (`gh pr diff <n>`) against the brief's file boundaries.",
    `2. Re-run ${verify} yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.`,
    "3. Send failures back to the same agent on its branch; the fix lands as a new commit on the same PR.",
    "4. Merge only verified work: `gh pr merge <n> --merge --delete-branch`.",
    `5. \`git pull\` on local \`main\` and re-run ${verify} on the merged result.`,
    `6. ${closeStep}`,
    "7. Prune merged worktrees (`git worktree remove <path>`, then `git worktree prune`).",
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
      "Create one bead per ticket. Claim a bead before delegating its ticket, and close it only after you have verified and merged the PR, naming the PR in the close comment. Recover state with `bd ready` and `git log`, never from memory.",
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

  const lines = [
    "## Tracking in this file",
    "",
    "This repository tracks tickets as plain markdown. Each ticket above carries a `Status:` line: set it to `in-progress` when you delegate the ticket and to `done (PR #<n>)` once you have verified and merged it.",
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

export function renderHandoffMarkdown(source: HandoffSource): string {
  const sections = [
    `# Handoff: ${source.session.title}`,
    source.session.idea,
    "This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.",
    pathsNote(source),
    [
      "## Where things are",
      "",
      `- Spec: \`${BUNDLE_TOKEN}/spec.md\``,
      `- Tickets: \`${BUNDLE_TOKEN}/issues/\``,
      `- Briefs: \`${BUNDLE_TOKEN}/briefs/\`, one per ticket, each ready to paste as a delegation prompt once its two slots are filled`,
      `- Grill Room session: \`${source.session.id}\``,
    ].join("\n"),
    [
      "## Verify command",
      "",
      codeBlock(source.project.verifyCommand),
      "",
      "Run from the repository root, by the subagent before it opens its PR and again by you before you merge.",
    ].join("\n"),
    beforeDelegatingSection(source),
    wavesSection(source),
    lifecycleSection(source),
    recordingSection(),
    trackingSection(source),
  ];
  if (source.project.buildRecordLogging) sections.push(buildRecordSection(source));
  return `${sections.join("\n\n")}\n`;
}

function bundleAccess(source: HandoffSource, fileStem: string): string {
  const specPath = `\`${BUNDLE_TOKEN}/spec.md\``;
  const ticketPath = `\`${BUNDLE_TOKEN}/issues/${fileStem}.md\``;
  if (source.project.visibility === "tracked") {
    return `The bundle is committed in this repository, so your worktree has it. Read the spec at ${specPath} and your ticket at ${ticketPath}, relative to the repository root in your worktree.`;
  }
  return `The bundle is ignored by git, so it is NOT in your worktree. Read it by absolute path from the main checkout: the spec at ${specPath} and your ticket at ${ticketPath}. Never write to it.`;
}

export function renderBrief(source: HandoffSource, ticket: HandoffTicket): string {
  const total = source.tickets.length;
  const { label, fileStem } = ticketNames(ticket, total);
  const blockers = blockerLabels(ticket, total);
  const verify = source.project.verifyCommand;
  const prTitle =
    source.project.trackerKind === "beads"
      ? `\`<bead id>: ${ticket.title}\``
      : `\`${label}: ${ticket.title}\``;

  return `${[
    `# Brief ${label}: ${ticket.title}`,
    `You are implementing ticket ${label} of "${source.session.title}". You work only inside the git worktree you were started in.`,
    ["## Step 0: confirm your base", "", "Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.", "", bundleAccess(source, fileStem)].join("\n"),
    [
      "## The ticket",
      "",
      `Blocked by: ${blockers.length > 0 ? `${blockers.join(", ")} (merged before this brief was delegated)` : "none"}`,
      "",
      `### ${label} ${ticket.title}`,
      "",
      ticket.body,
    ].join("\n"),
    [
      "## File boundaries",
      "",
      FILE_BOUNDARIES_SLOT,
      "",
      "_Slot for the orchestrating session: the files and folders this ticket may create or edit, and the existing files it builds on._",
    ].join("\n"),
    [
      "## Codebase facts",
      "",
      CODEBASE_FACTS_SLOT,
      "",
      "_Slot for the orchestrating session: verified facts about the code this ticket touches._",
    ].join("\n"),
    [
      "## Rules",
      "",
      "- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.",
      "- Run git only inside your worktree. Never run git against another checkout, never commit on or push to `main`, and never merge anything.",
      "- Commit on your worktree branch as you go.",
    ].join("\n"),
    ["## Verify", "", "From the repository root in your worktree, this must exit 0:", "", codeBlock(verify)].join("\n"),
    [
      "## Pull request",
      "",
      "When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report \"push pending: gh account\" with your commit hash.",
      "",
      `Otherwise run \`git push -u origin HEAD\`, then \`gh pr create\` against \`main\`, titled ${prTitle}, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge.`,
    ].join("\n"),
    [
      "## Report, then stop",
      "",
      "Report:",
      "",
      "- worktree path and branch;",
      "- the PR URL, or \"push pending: gh account\" with your commit hash;",
      "- commits and files changed;",
      `- the exact output of \`${verify}\`;`,
      "- anything ambiguous, and anything this brief was missing.",
      "",
      "Then stop. Do no further work of any kind.",
    ].join("\n"),
  ].join("\n\n")}\n`;
}

export function renderHandoff(source: HandoffSource): RenderedHandoff {
  const total = source.tickets.length;
  return {
    markdown: renderHandoffMarkdown(source),
    briefs: source.tickets.map((ticket) => ({
      ticketNumber: ticket.number,
      relativePath: `briefs/${ticketNames(ticket, total).fileStem}.md`,
      markdown: renderBrief(source, ticket),
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
      spec: { updatedAt: spec.updatedAt, ticketsGeneratedAt: spec.ticketsGeneratedAt },
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
        exportFolder: project.exportFolder,
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

/** Stored briefs; malformed entries are dropped rather than trusted. */
export function parseBriefs(json: string): HandoffBrief[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { ticketNumber, relativePath, markdown } = entry as Record<string, unknown>;
    if (
      typeof ticketNumber !== "number" ||
      typeof relativePath !== "string" ||
      typeof markdown !== "string"
    ) {
      return [];
    }
    return [{ ticketNumber, relativePath, markdown }];
  });
}

/** Writes a freshly rendered handoff over the session's row, clearing any edits. */
export async function saveGeneratedHandoff(
  sessionId: string,
  rendered: RenderedHandoff,
  fingerprint: string,
): Promise<HandoffRow> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await getHandoffRow(sessionId);
  if (existing) {
    const [row] = await db
      .update(schema.handoffs)
      .set({
        markdown: rendered.markdown,
        briefsJson: JSON.stringify(rendered.briefs),
        fingerprint,
        revision: existing.revision + 1,
        generatedAt: now,
        editedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.handoffs.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(schema.handoffs)
    .values({
      id: randomUUID(),
      sessionId,
      markdown: rendered.markdown,
      briefsJson: JSON.stringify(rendered.briefs),
      fingerprint,
      revision: 1,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
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

export interface HandoffView {
  markdown: string;
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

export function describeHandoff(row: HandoffRow, currentFingerprint: string | null): HandoffView {
  return {
    markdown: row.markdown,
    briefs: parseBriefs(row.briefsJson),
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
