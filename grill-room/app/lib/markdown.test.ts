import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown, type BlockNode } from "@/lib/markdown";

/** The text of a block tree, marks dropped: what the reader ends up seeing. */
function plainText(blocks: readonly BlockNode[]): string {
  function inline(nodes: readonly { type: string }[]): string {
    return nodes
      .map((node) => {
        const entry = node as {
          type: string;
          value?: string;
          children?: { type: string }[];
        };
        if (entry.value !== undefined) return entry.value;
        return inline(entry.children ?? []);
      })
      .join("");
  }

  return blocks
    .map((block) =>
      block.type === "list"
        ? block.items.map((item) => plainText(item)).join(" ")
        : inline(block.children),
    )
    .join(" ");
}

describe("parseInline", () => {
  it("reads bold, italics, and inline code", () => {
    expect(parseInline("**bold** and *italic* and `code`")).toEqual([
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " and " },
      { type: "emphasis", children: [{ type: "text", value: "italic" }] },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("nests marks", () => {
    expect(parseInline("**bold with *italic* inside**")).toEqual([
      {
        type: "strong",
        children: [
          { type: "text", value: "bold with " },
          { type: "emphasis", children: [{ type: "text", value: "italic" }] },
          { type: "text", value: " inside" },
        ],
      },
    ]);
  });

  it("reads underscore marks", () => {
    expect(parseInline("__bold__ then _italic_")).toEqual([
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " then " },
      { type: "emphasis", children: [{ type: "text", value: "italic" }] },
    ]);
  });

  it("leaves underscores inside a word alone", () => {
    expect(parseInline("call answer_decision_now once")).toEqual([
      { type: "text", value: "call answer_decision_now once" },
    ]);
  });

  it("leaves an unclosed delimiter as text", () => {
    expect(parseInline("2 * 3 * 4 is not emphasis")).toEqual([
      { type: "text", value: "2 * 3 * 4 is not emphasis" },
    ]);
    expect(parseInline("a `backtick that never closes")).toEqual([
      { type: "text", value: "a `backtick that never closes" },
    ]);
  });

  it("honours backslash escapes", () => {
    expect(parseInline("literal \\*stars\\* here")).toEqual([
      { type: "text", value: "literal *stars* here" },
    ]);
  });

  it("does not read marks across code spans", () => {
    expect(parseInline("`a * b`")).toEqual([{ type: "code", value: "a * b" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs on blank lines", () => {
    const blocks = parseMarkdown("First line.\nstill first.\n\nSecond.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(plainText([blocks[0]])).toBe("First line.\nstill first.");
    expect(plainText([blocks[1]])).toBe("Second.");
  });

  it("reads headings with their level", () => {
    const blocks = parseMarkdown("## Settled decisions\n\nBody.");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(plainText([blocks[0]])).toBe("Settled decisions");
  });

  it("reads a bulleted list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect((blocks[0] as { items: BlockNode[][] }).items).toHaveLength(3);
    expect(plainText(blocks)).toBe("one two three");
  });

  it("reads a numbered list", () => {
    const blocks = parseMarkdown("1. first\n2. second");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("keeps marks inside list items", () => {
    const blocks = parseMarkdown("- the **shape** is a workspace");
    const items = (blocks[0] as { items: BlockNode[][] }).items;
    expect(items[0][0]).toMatchObject({ type: "paragraph" });
    expect(items[0][0]).toMatchObject({
      children: [
        { type: "text", value: "the " },
        { type: "strong", children: [{ type: "text", value: "shape" }] },
        { type: "text", value: " is a workspace" },
      ],
    });
  });

  it("nests a list inside a list item", () => {
    const blocks = parseMarkdown("- outer\n  - inner\n- second");
    const items = (blocks[0] as { items: BlockNode[][] }).items;
    expect(items).toHaveLength(2);
    expect(items[0][1]).toMatchObject({ type: "list", ordered: false });
    expect(plainText(items[0])).toBe("outer inner");
  });

  it("ends a list at the paragraph after it", () => {
    const blocks = parseMarkdown("- one\n- two\n\nAfter the list.");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: "paragraph" });
    expect(plainText([blocks[1]])).toBe("After the list.");
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });

  it("keeps HTML as text rather than markup", () => {
    const injection =
      '<script>alert("xss")</script><img src=x onerror="alert(1)">';
    const blocks = parseMarkdown(injection);

    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", value: injection }] },
    ]);
    // The tree has no node that could carry markup: every leaf is text or
    // code, and the renderer puts both in as React children, which escape.
    expect(plainText(blocks)).toBe(injection);
  });

  it("keeps HTML inside marks as text too", () => {
    const blocks = parseMarkdown("**<b onmouseover=steal()>bold</b>**");
    expect(blocks[0]).toMatchObject({
      type: "paragraph",
      children: [
        {
          type: "strong",
          children: [
            { type: "text", value: "<b onmouseover=steal()>bold</b>" },
          ],
        },
      ],
    });
  });

  it("reads a realistic done summary whole", () => {
    const blocks = parseMarkdown(
      [
        "## Where we landed",
        "",
        "The shape is a **workspace**, not a single page.",
        "",
        "- Data lives *on disk*, under `~/.grill-room`.",
        "- Sessions resume from where they stopped.",
        "",
        "That is everything the frontier held.",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "paragraph",
    ]);
  });
});
