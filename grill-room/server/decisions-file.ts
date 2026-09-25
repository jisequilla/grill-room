/**
 * A pure parser over a rendered `decisions.md`'s text (`renderDecisionsFile`
 * in `server/export.ts`). It never touches the filesystem or git — reading
 * the file is the caller's job — and it never changes the renderer's output.
 *
 * Used by `server/scout-report.ts` to refuse a scout proposal that restates a
 * source a decisions.md entry has already superseded: see
 * `docs/spikes/decisions-round-trip.md`, check 3.
 */

/** One decisions.md entry that carries a `Supersedes:` line. */
export interface SupersededEntry {
  /** The entry's decision key, from its `<a id="...">` anchor. */
  key: string;
  /** The entry's `###` title. */
  title: string;
  /** The `Source:` citation this entry's `Supersedes:` line overrides. */
  source: string;
}

const ANCHOR_LINE = /^<a id="([^"]*)"><\/a>\s*$/;
const TITLE_LINE = /^###\s+(.+?)\s*$/;
const SOURCE_FIELD = /^- \*\*Source:\*\*\s*(.+?)\s*$/;
const SUPERSEDES_FIELD = /^- \*\*Supersedes:\*\*/;

/**
 * Every entry of a decisions.md that carries both a `Supersedes:` line and a
 * `Source:` line, with the entry's key, title and the citation it supersedes.
 * An entry with neither, or with `Supersedes:` but no `Source:` (which
 * `renderDecisionsFile` never writes — the two are always written together),
 * is left out: there is nothing to compare a proposal's citation against.
 *
 * The text is split on each `<a id="...">` anchor, so entries are found
 * wherever they appear — the Decisions section is the only place
 * `renderDecisionsFile` writes one, but this does not assume that.
 */
export function supersededEntries(decisionsMarkdown: string): SupersededEntry[] {
  const blocks = decisionsMarkdown.split(/\n(?=<a id="[^"]*"><\/a>)/);
  const results: SupersededEntry[] = [];

  for (const block of blocks) {
    const blockLines = block.split("\n");
    const anchorMatch = ANCHOR_LINE.exec(blockLines[0] ?? "");
    if (!anchorMatch) continue;
    const key = anchorMatch[1]!;

    const titleMatch = TITLE_LINE.exec(blockLines[1] ?? "");
    const title = titleMatch ? titleMatch[1]! : key;

    let source: string | null = null;
    let hasSupersedes = false;
    for (const line of blockLines) {
      const sourceMatch = SOURCE_FIELD.exec(line);
      if (sourceMatch) source = sourceMatch[1]!;
      if (SUPERSEDES_FIELD.test(line)) hasSupersedes = true;
    }

    if (hasSupersedes && source) results.push({ key, title, source });
  }

  return results;
}
