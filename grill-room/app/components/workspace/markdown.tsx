import { Fragment } from "react";

import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders the Markdown subset {@link parseMarkdown} understands as React
 * elements. Every leaf goes in as a React child, so text the interviewer wrote
 * is escaped by React and nothing here ever sets inner HTML.
 */

function Inline({ nodes }: { nodes: readonly InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <Fragment key={index}>{node.value}</Fragment>;
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-muted px-1 py-px font-mono text-[0.9em]"
              >
                {node.value}
              </code>
            );
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "emphasis":
            return (
              <em key={index}>
                <Inline nodes={node.children} />
              </em>
            );
        }
      })}
    </>
  );
}

/** Heading sizes stay close to the body: a summary is prose, not a document. */
const HEADING_CLASS: Record<number, string> = {
  1: "text-[15px] font-semibold text-foreground",
  2: "text-sm font-semibold text-foreground",
  3: "text-sm font-medium text-foreground",
};

function Block({ node }: { node: BlockNode }) {
  switch (node.type) {
    case "heading": {
      const Tag = `h${Math.min(node.level + 2, 6)}` as "h3";
      return (
        <Tag className={HEADING_CLASS[Math.min(node.level, 3)]}>
          <Inline nodes={node.children} />
        </Tag>
      );
    }
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          className={cn(
            "space-y-1 pl-5",
            node.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {node.items.map((item, index) => (
            <li key={index} className="space-y-1.5">
              {item.map((child, childIndex) => (
                <Block key={childIndex} node={child} />
              ))}
            </li>
          ))}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inline nodes={node.children} />
        </p>
      );
  }
}

export function Markdown({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const blocks = text ? parseMarkdown(text) : [];
  if (blocks.length === 0) return null;

  return (
    <div className={cn("space-y-2.5", className)}>
      {blocks.map((block, index) => (
        <Block key={index} node={block} />
      ))}
    </div>
  );
}
