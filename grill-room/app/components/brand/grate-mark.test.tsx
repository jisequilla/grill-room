import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GrateMark } from "./grate-mark";

const publicFile = (name: string) =>
  readFileSync(resolve(__dirname, "../../../public", name), "utf8");

describe("GrateMark", () => {
  const markup = renderToStaticMarkup(
    <GrateMark aria-hidden="true" className="size-5" />,
  );

  it("fills the top bar from the primary token, never a hex", () => {
    expect(markup).toContain("hsl(var(--primary))");
    expect(markup).not.toContain("#F26B38");
  });

  it("draws the frame and lower bars in currentColor", () => {
    expect(markup.match(/currentColor/g)).toHaveLength(3);
  });

  it("carries its test id, class and aria-hidden", () => {
    expect(markup).toContain('data-testid="grate-mark"');
    expect(markup).toContain('class="size-5"');
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe("the favicon and app icons", () => {
  for (const name of [
    "favicon.svg",
    "icon-180.svg",
    "icon-192.svg",
    "icon-512.svg",
  ]) {
    it(`${name} is the vector Grate on Charcoal`, () => {
      const svg = publicFile(name);
      expect(svg).toContain("#151311");
      expect(svg).toContain("#ECE7E1");
      expect(svg).toContain("#F26B38");
      expect(svg).toContain('viewBox="0 0 32 32"');
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("base64");
    });
  }
});
