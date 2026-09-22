/**
 * A deliberately small Markdown subset — paragraphs, headings, lists, bold,
 * italics, inline code — parsed into a tree the renderer turns into React
 * elements.
 *
 * The interviewer writes its question bodies, recommendations, and done
 * summaries as prose with light Markdown in it, and showing `**this**` on
 * screen reads as a bug. A full Markdown library would be a dependency this
 * app does not otherwise need, so this parses the handful of marks the
 * interviewer actually uses and treats everything else as text.
 *
 * Nothing here emits HTML. Anything unrecognised, raw HTML included, stays a
 * text node, and React escapes it on the way out; the renderer never touches
 * `dangerouslySetInnerHTML`.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "emphasis"; children: InlineNode[] };

export interface ParagraphNode {
  type: "paragraph";
  children: InlineNode[];
}

export interface HeadingNode {
  type: "heading";
  /** 1 to 6, as the leading run of `#` counted. */
  level: number;
  children: InlineNode[];
}

export interface ListNode {
  type: "list";
  ordered: boolean;
  /** Each item is a block list of its own, so an item can nest a list. */
  items: BlockNode[][];
}

export type BlockNode = ParagraphNode | HeadingNode | ListNode;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

/** Characters a backslash may hide from the inline scanner. */
const ESCAPABLE = "\\`*_{}[]()#+-.!>";

/** Parses Markdown into blocks. Never throws; unknown syntax becomes text. */
export function parseMarkdown(source: string): BlockNode[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function isOrderedMarker(marker: string): boolean {
  return /\d/.test(marker);
}

function parseBlocks(lines: readonly string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, index);
      blocks.push(list);
      index = next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.trim() === "" ||
        HEADING.test(current) ||
        LIST_ITEM.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

/** Whether `line` keeps an open list going across a blank line. */
function continuesList(
  line: string,
  indent: number,
  ordered: boolean,
): boolean {
  if (line.trim() === "") return false;
  const match = LIST_ITEM.exec(line);
  if (match && match[1].length === indent) {
    return isOrderedMarker(match[2]) === ordered;
  }
  return leadingSpaces(line) > indent;
}

/** Strips the common indentation from an item's continuation lines. */
function dedent(group: readonly string[]): string[] {
  const continuation = group.slice(1);
  const indents = continuation
    .filter((line) => line.trim() !== "")
    .map(leadingSpaces);
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return [
    group[0] ?? "",
    ...continuation.map((line) => (line.trim() === "" ? "" : line.slice(strip))),
  ];
}

/** The list starting at `start`, and the index of the first line after it. */
function parseList(
  lines: readonly string[],
  start: number,
): [ListNode, number] {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  // Only ever called on a line the caller already matched.
  if (!first) return [{ type: "list", ordered: false, items: [] }, start + 1];

  const indent = first[1].length;
  const ordered = isOrderedMarker(first[2]);
  const groups: string[][] = [];
  let current: string[] | null = null;
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      const next = lines[index + 1];
      if (next === undefined || !continuesList(next, indent, ordered)) break;
      current?.push("");
      index += 1;
      continue;
    }

    const match = LIST_ITEM.exec(line);
    if (match && match[1].length === indent) {
      if (isOrderedMarker(match[2]) !== ordered) break;
      current = [match[3]];
      groups.push(current);
      index += 1;
      continue;
    }

    if (current && leadingSpaces(line) > indent) {
      current.push(line);
      index += 1;
      continue;
    }

    break;
  }

  return [
    {
      type: "list",
      ordered,
      items: groups.map((group) => parseBlocks(dedent(group))),
    },
    index,
  ];
}

function runLength(text: string, from: number, char: string): number {
  let length = 0;
  while (text[from + length] === char) length += 1;
  return length;
}

/**
 * Whether a run of `_` at `at` may open emphasis. Underscores inside a word —
 * `snake_case_names`, which questions about code are full of — are text.
 */
function underscoreMayOpen(text: string, at: number): boolean {
  const before = text[at - 1];
  return before === undefined || !/[\p{L}\p{N}]/u.test(before);
}

/**
 * The index of the run that closes `delimiter`, or -1. A closer may not follow
 * whitespace, and an underscore may not be followed by a word character, for
 * the same reason {@link underscoreMayOpen} exists.
 */
function findCloser(
  text: string,
  from: number,
  delimiter: string,
): number {
  const char = delimiter[0];
  let index = from;

  while (index < text.length) {
    const found = text.indexOf(delimiter, index);
    if (found === -1) return -1;

    const previous = text[found - 1];
    const following = text[found + delimiter.length];
    const closesTightly = previous !== undefined && !/\s/.test(previous);
    const wordSafe =
      char !== "_" || following === undefined || !/[\p{L}\p{N}]/u.test(following);

    if (found > from && closesTightly && wordSafe) return found;
    index = found + delimiter.length;
  }

  return -1;
}

/** Parses one run of text into inline nodes. Adjacent text is merged. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  function flush(): void {
    if (buffer !== "") {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  }

  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];

    if (char === "\\" && next !== undefined && ESCAPABLE.includes(next)) {
      buffer += next;
      index += 2;
      continue;
    }

    if (char === "`") {
      const run = runLength(text, index, "`");
      const fence = "`".repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1 && close > index + run) {
        flush();
        nodes.push({ type: "code", value: text.slice(index + run, close).trim() });
        index = close + run;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const run = Math.min(runLength(text, index, char), 2);
      const delimiter = char.repeat(run);
      const opensTightly = !/\s/.test(text[index + run] ?? " ");
      const mayOpen =
        opensTightly && (char !== "_" || underscoreMayOpen(text, index));
      const close = mayOpen ? findCloser(text, index + run, delimiter) : -1;

      if (close !== -1) {
        flush();
        const children = parseInline(text.slice(index + run, close));
        nodes.push(
          run === 2
            ? { type: "strong", children }
            : { type: "emphasis", children },
        );
        index = close + run;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}
