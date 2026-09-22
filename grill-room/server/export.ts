/**
 * Export's pure parts: turning a session's title, spec markdown, and tickets
 * into the file names and file contents the local-markdown tracker layout
 * expects (see repo-root `docs/agents/issue-tracker.md`). Nothing here touches
 * the filesystem — `export-session` resolves the target folder, checks it,
 * and does the actual writes; this module only plans what those writes should
 * be and renders their content. Tested through the `export-session` and
 * `set-export-target` actions, the same convention `tickets.ts` and `tree.ts`
 * follow.
 */

const STATUS_LINE = "Status: ready-for-agent";

/** A ticket as `export-session` hands it here: `blockedBy` already resolved to ticket numbers. */
export interface ExportTicket {
  number: number;
  slug: string;
  title: string;
  body: string;
  blockedBy: readonly number[];
}

export interface PlannedExportFile {
  /** Path relative to the feature directory, e.g. `"spec.md"` or `"issues/01-slug.md"`. */
  relativePath: string;
  content: string;
}

export interface ExportPlan {
  featureSlug: string;
  /** Spec first, then issues in ticket-number order — the order `export-session` writes and reports them in. */
  files: PlannedExportFile[];
}

export interface PlanExportInput {
  sessionTitle: string;
  sessionId: string;
  specMarkdown: string;
  /** Tickets to export, already in ascending number order. Empty when tickets are not being exported. */
  tickets: readonly ExportTicket[];
}

/** Lowercase; anything not a letter or digit collapses to one hyphen; leading/trailing hyphens trimmed. */
function slugify(input: string, maxLength: number): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/**
 * The feature directory's name: the session title slugified, lowercase
 * letters/digits/hyphens only, collapsed and trimmed, at most 60 characters.
 * Falls back to `session-<first 8 of the id>` when nothing usable remains.
 */
export function deriveFeatureSlug(title: string, sessionId: string): string {
  const slug = slugify(title, 60);
  return slug.length > 0 ? slug : `session-${sessionId.slice(0, 8)}`;
}

/**
 * A ticket slug re-sanitized for use in a file name. A ticket's slug is
 * validated when tickets are generated (`validateTicketSet`), but export does
 * not trust that: a row can be edited or arranged directly in the database,
 * so this collapses anything that is not a lowercase letter, digit or hyphen —
 * which also destroys `.` and `/`, so a slug like `../../evil` sanitizes down
 * to `evil` rather than escaping the feature directory.
 */
export function sanitizeTicketSlug(rawSlug: string, ticketNumber: number): string {
  const slug = slugify(rawSlug, 200);
  return slug.length > 0 ? slug : `ticket-${ticketNumber}`;
}

/** Zero-padded ticket number: two digits, or three once the set holds 100 or more tickets. */
export function padTicketNumber(number: number, totalTickets: number): string {
  const width = totalTickets >= 100 ? 3 : 2;
  return String(number).padStart(width, "0");
}

/**
 * `spec.md`'s content: the spec markdown preceded by a `# <session title>`
 * heading and a `Status: ready-for-agent` line — unless the markdown already
 * starts with a level-1 heading, in which case only the status line is
 * inserted right after it.
 */
export function renderSpecFile(sessionTitle: string, specMarkdown: string): string {
  const headingMatch = /^# .*(?:\r?\n|$)/.exec(specMarkdown);

  if (headingMatch) {
    const heading = headingMatch[0].replace(/\r?\n$/, "");
    const rest = specMarkdown.slice(headingMatch[0].length).replace(/^\r?\n+/, "");
    return `${heading}\n\n${STATUS_LINE}\n\n${rest}`;
  }

  return `# ${sessionTitle}\n\n${STATUS_LINE}\n\n${specMarkdown}`;
}

/**
 * One ticket file's content: `# <NN> <title>`, blank line, `Status:`, then
 * `Blocked by:` (numbers padded the same as the file name, or `none`), blank
 * line, then the ticket body.
 */
export function renderTicketFile(params: {
  label: string;
  title: string;
  body: string;
  blockedByLabels: readonly string[];
}): string {
  const blockedByLine =
    params.blockedByLabels.length > 0
      ? `Blocked by: ${params.blockedByLabels.join(", ")}`
      : "Blocked by: none";

  return `# ${params.label} ${params.title}\n\n${STATUS_LINE}\n${blockedByLine}\n\n${params.body}`;
}

/**
 * The full set of files an export would write, and their content, with no
 * filesystem access. `export-session` resolves each `relativePath` against
 * the feature directory and asserts containment before writing — see
 * `sanitizeTicketSlug` for why that is still checked even though this
 * function already sanitizes.
 */
export function planExport(input: PlanExportInput): ExportPlan {
  const featureSlug = deriveFeatureSlug(input.sessionTitle, input.sessionId);
  const totalTickets = input.tickets.length;

  const files: PlannedExportFile[] = [
    { relativePath: "spec.md", content: renderSpecFile(input.sessionTitle, input.specMarkdown) },
  ];

  for (const ticket of input.tickets) {
    const label = padTicketNumber(ticket.number, totalTickets);
    const slug = sanitizeTicketSlug(ticket.slug, ticket.number);
    const blockedByLabels = [...ticket.blockedBy]
      .sort((a, b) => a - b)
      .map((number) => padTicketNumber(number, totalTickets));

    files.push({
      relativePath: `issues/${label}-${slug}.md`,
      content: renderTicketFile({
        label,
        title: ticket.title,
        body: ticket.body,
        blockedByLabels,
      }),
    });
  }

  return { featureSlug, files };
}
