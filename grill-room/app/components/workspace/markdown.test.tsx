import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/workspace/markdown";

const DIV = '<div class="space-y-2.5">';
const CODE_CLASS = 'class="rounded bg-muted px-1 py-px font-mono text-[0.9em]"';

function render(text: string): string {
  return renderToStaticMarkup(<Markdown text={text} />);
}

describe("Markdown links", () => {
  it("renders an http(s) link as an anchor that opens in a new tab", () => {
    const rows: Array<[string, string]> = [
      [
        "[site](https://example.com)",
        `${DIV}<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">site</a></p></div>`,
      ],
      [
        "[site](http://example.com/a?b=1&c=2)",
        `${DIV}<p><a href="http://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">site</a></p></div>`,
      ],
      [
        "[site](HTTPS://EXAMPLE.COM)",
        `${DIV}<p><a href="HTTPS://EXAMPLE.COM" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">site</a></p></div>`,
      ],
      [
        "[`npm` docs](https://docs.npmjs.com/cli)",
        `${DIV}<p><a href="https://docs.npmjs.com/cli" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2"><code ${CODE_CLASS}>npm</code> docs</a></p></div>`,
      ],
    ];

    for (const [input, expected] of rows) {
      const output = render(input);
      expect(output).toBe(expected);

      const anchor = /<a href="([^"]*)" target="([^"]*)" rel="([^"]*)"/.exec(output);
      expect(anchor).not.toBeNull();
      const [, href, target, rel] = anchor!;
      const rawHref = input.match(/\]\(([^)]*)\)/)?.[1] ?? "";
      expect(href).toBe(rawHref.replace(/&/g, "&amp;"));
      expect(target).toBe("_blank");
      expect(rel).toBe("noopener noreferrer");
    }
  });

  it("renders every other link as its label, with no anchor", () => {
    const rows: Array<[string, string]> = [
      ["[x](javascript:alert(1))", `${DIV}<p>x)</p></div>`],
      ["[x](data:text/html,hi)", `${DIV}<p>x</p></div>`],
      ["[mail](mailto:a@b.c)", `${DIV}<p>mail</p></div>`],
      ["[x](//example.com)", `${DIV}<p>x</p></div>`],
      ["[the spec](spec.md)", `${DIV}<p>the spec</p></div>`],
      [
        "- Brief: [`p/briefs/01.md`](briefs/01.md)",
        `${DIV}<ul class="space-y-1 pl-5 list-disc"><li class="space-y-1.5"><p>Brief: <code ${CODE_CLASS}>p/briefs/01.md</code></p></li></ul></div>`,
      ],
    ];

    for (const [input, expected] of rows) {
      const output = render(input);
      expect(output).toBe(expected);
      expect(output).not.toContain("<a");
      expect(output).not.toContain("href");
      expect(output).not.toContain("javascript:");
      expect(output).not.toContain("data:");
    }
  });

  it("never sets inner HTML", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "markdown.tsx"),
      "utf8",
    );
    expect(source).not.toContain("dangerouslySetInnerHTML");

    const output = render("[<b>x</b>](https://e.com)");
    expect(output).toBe(
      `${DIV}<p><a href="https://e.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">&lt;b&gt;x&lt;/b&gt;</a></p></div>`,
    );
  });
});
