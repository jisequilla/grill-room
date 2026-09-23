/**
 * Export's pure parts: the bundle's folder name (slug proposal, slug pattern)
 * and the files the local-markdown tracker layout expects (see repo-root
 * `docs/agents/issue-tracker.md`), with their content. Nothing here touches the
 * filesystem — `server/export-bundle.ts` reads what already exists, enforces
 * containment and does the writes; this module only decides names and renders
 * content. Tested through the `preview-export` and `export-session` actions,
 * the same convention `tickets.ts` and `tree.ts` follow.
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
  /** Spec first, then issues in ticket-number order — the order `export-session` writes and reports them in. */
  files: PlannedExportFile[];
}

/**
 * Subfolders of a bundle whose `*.md` files the export owns outright: on
 * re-export, any `.md` file in one of them that the new plan does not contain
 * is removed. Later bundle parts (delegation briefs) join this list; files at
 * the top of the bundle are only ever overwritten, never removed.
 */
export const OWNED_BUNDLE_SUBFOLDERS = ["issues"] as const;

export interface PlanExportInput {
  sessionTitle: string;
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

/** At most this many words of the session title make up the proposed slug. */
export const PROPOSED_SLUG_MAX_WORDS = 4;

/** Longest slug accepted, after sanitizing. */
export const MAX_SLUG_LENGTH = 60;

/**
 * The slug proposed for a session's bundle: the session title lowercased and
 * split into words on every run of characters that are not ASCII letters or
 * digits, keeping the first {@link PROPOSED_SLUG_MAX_WORDS} words joined by
 * hyphens (then capped at {@link MAX_SLUG_LENGTH} characters). "Export anywhere
 * and generate a handoff" proposes `export-anywhere-and-generate`. Falls back
 * to `session-<first 8 of the id>` when the title has no usable word.
 */
export function proposeSlug(title: string, sessionId: string): string {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .slice(0, PROPOSED_SLUG_MAX_WORDS);
  const slug = slugify(words.join("-"), MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug : `session-${sessionId.slice(0, 8)}`;
}

/**
 * A slug as the operator typed it, made safe for a folder name: lowercased,
 * every run of characters that are not ASCII letters or digits collapsed to
 * one hyphen, leading and trailing hyphens trimmed, at most {@link
 * MAX_SLUG_LENGTH} characters. Returns `""` when nothing usable remains; the
 * caller refuses that.
 */
export function sanitizeSlug(rawSlug: string): string {
  return slugify(rawSlug, MAX_SLUG_LENGTH);
}

/** A date as local `YYYY-MM-DD`, the value of the `{date}` placeholder. */
export function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The `{seq}` value for a new bundle: one more than the highest numeric prefix
 * (leading digits) among the names already in the export folder, zero-padded
 * to two digits — `01` when no name starts with a digit.
 */
export function nextSequence(existingNames: readonly string[]): string {
  let highest = 0;
  for (const name of existingNames) {
    const match = /^(\d+)/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return String(highest + 1).padStart(2, "0");
}

export interface SlugPatternValues {
  slug: string;
  date: string;
  seq: string;
}

/**
 * The bundle's folder name: the project's slug pattern with every `{slug}`,
 * `{date}` and `{seq}` replaced by its value. Anything else in the pattern is
 * kept literally.
 */
export function applySlugPattern(pattern: string, values: SlugPatternValues): string {
  return pattern
    .split("{slug}")
    .join(values.slug)
    .split("{date}")
    .join(values.date)
    .split("{seq}")
    .join(values.seq);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * For a pattern containing `{seq}`, the existing folder that is this same
 * bundle exported before: one whose name matches the pattern with `{seq}` as
 * any run of digits and `{slug}` and `{date}` as their current values. When
 * several match, the highest number wins. Null for a pattern without `{seq}`
 * or when none matches. This is what lets a re-export land in the folder it
 * wrote last time instead of taking the next number.
 */
export function findSequencedFolder(
  pattern: string,
  values: Omit<SlugPatternValues, "seq">,
  existingNames: readonly string[],
): string | null {
  if (!pattern.includes("{seq}")) return null;

  const source = pattern
    .split(/(\{slug\}|\{date\}|\{seq\})/)
    .map((part) => {
      if (part === "{seq}") return "(\\d+)";
      if (part === "{slug}") return escapeRegExp(values.slug);
      if (part === "{date}") return escapeRegExp(values.date);
      return escapeRegExp(part);
    })
    .join("");
  const matcher = new RegExp(`^${source}$`);

  let best: { name: string; number: number } | null = null;
  for (const name of existingNames) {
    const match = matcher.exec(name);
    if (!match) continue;
    const number = Math.max(...match.slice(1).map(Number));
    if (!best || number > best.number) best = { name, number };
  }
  return best?.name ?? null;
}

/**
 * A ticket slug re-sanitized for use in a file name. A ticket's slug is
 * validated when tickets are generated (`validateTicketSet`), but export does
 * not trust that: a row can be edited or arranged directly in the database,
 * so this collapses anything that is not a lowercase letter, digit or hyphen —
 * which also destroys `.` and `/`, so a slug like `../../evil` sanitizes down
 * to `evil` rather than escaping the bundle directory.
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
 * filesystem access. `server/export-bundle.ts` resolves each `relativePath`
 * against the bundle directory and asserts containment before writing — see
 * `sanitizeTicketSlug` for why that is still checked even though this
 * function already sanitizes.
 */
export function planExport(input: PlanExportInput): ExportPlan {
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

  return { files };
}
