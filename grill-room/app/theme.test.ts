import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Ember on the Ledger theme, checked against its contract. DESIGN.md's
 * "Tokens" tables are the source of truth: every triplet they list must be the
 * one `global.css` defines, every pairing they give a ratio for must clear
 * WCAG AA, and no component may reach past the tokens for a raw Tailwind hue
 * or an off-scale label size.
 */

const APP_DIR = __dirname;
const CSS = readFileSync(path.join(APP_DIR, "global.css"), "utf8");
const DESIGN = readFileSync(path.join(APP_DIR, "..", "DESIGN.md"), "utf8");
const PACKAGE = JSON.parse(
  readFileSync(path.join(APP_DIR, "..", "package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

type Theme = "light" | "dark";

/** The custom properties one top-level rule of global.css declares. */
function declarations(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`^${escaped} \\{\\n([\\s\\S]*?)^\\}`, "m"));
  if (!match) throw new Error(`global.css has no top-level ${selector} rule`);
  const vars = new Map<string, string>();
  for (const [, name, value] of match[1].matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) {
    vars.set(name, value.trim());
  }
  return vars;
}

const DECLARED: Record<Theme, Map<string, string>> = {
  light: declarations(":root"),
  dark: declarations(".dark"),
};

/** A variable's HSL triplet in a theme, following `var(--x)` to what it names. */
function triplet(theme: Theme, name: string): string {
  const value = DECLARED[theme].get(name);
  if (value === undefined) throw new Error(`--${name} is not defined for ${theme}`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  return alias ? triplet(theme, alias[1]) : value;
}

/** The rows of the DESIGN.md table under a heading, as cell arrays. */
function tableRows(heading: string): string[][] {
  const start = DESIGN.indexOf(heading);
  if (start < 0) throw new Error(`DESIGN.md has no "${heading}" section`);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of DESIGN.slice(start).split("\n").slice(1)) {
    if (line.startsWith("|")) {
      inTable = true;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (!/^-+$/.test(cells[0]) && !cells[0].startsWith("Variable")) rows.push(cells);
    } else if (inTable) {
      break;
    }
  }
  return rows;
}

const codeSpans = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * Every variable → triplet pair a colour table states. A cell may name two
 * variables (`--card` / `--popover`) sharing one triplet or two
 * (`a` / `b`), matched in order.
 */
function expectedFromTable(heading: string, tripletColumn: number): [string, string][] {
  const pairs: [string, string][] = [];
  for (const cells of tableRows(heading)) {
    const names = codeSpans(cells[0]).map((name) => name.replace(/^--/, ""));
    const triplets = codeSpans(cells[tripletColumn]);
    names.forEach((name, index) => {
      pairs.push([name, triplets.length === 1 ? triplets[0] : triplets[index]]);
    });
  }
  return pairs;
}

const LIGHT_EXPECTED = expectedFromTable("### Colour: light", 3);
const DARK_EXPECTED = expectedFromTable("### Colour: dark", 3);

const STATE_VARIABLES = ["settled", "owed", "repo", "frontier", "unplaced"] as const;

/** The decision-semantics table: light and dark per state, `= --x` meaning an alias. */
function stateExpectations(): { name: string; light: string; dark: string }[] {
  return tableRows("### Colour: decision semantics").map((cells) => {
    const name = codeSpans(cells[0])[0].replace(/^--/, "");
    const resolve = (theme: Theme, cell: string) => {
      const [span] = codeSpans(cell);
      return span.startsWith("--") ? triplet(theme, span.slice(2)) : span;
    };
    return { name, light: resolve("light", cells[2]), dark: resolve("dark", cells[3]) };
  });
}

describe("theme tokens", () => {
  it("reads every row of the DESIGN.md colour tables", () => {
    expect(LIGHT_EXPECTED).toHaveLength(27);
    expect(DARK_EXPECTED).toHaveLength(25);
    expect(stateExpectations().map((row) => row.name)).toEqual([...STATE_VARIABLES]);
  });

  it.each(LIGHT_EXPECTED)("light --%s is %s", (name, expected) => {
    expect(DECLARED.light.get(name)).toBe(expected);
  });

  it.each(DARK_EXPECTED)("dark --%s is %s", (name, expected) => {
    expect(DECLARED.dark.get(name)).toBe(expected);
  });

  it.each(stateExpectations())("decision state --$name has its light and dark triplet", (row) => {
    expect(triplet("light", row.name)).toBe(row.light);
    expect(triplet("dark", row.name)).toBe(row.dark);
  });

  it("makes --unplaced the muted foreground in both themes", () => {
    expect(DECLARED.light.get("unplaced")).toBe("var(--muted-foreground)");
    expect(DECLARED.dark.get("unplaced")).toBe("var(--muted-foreground)");
  });

  it.each(STATE_VARIABLES)("registers --%s as a Tailwind colour", (name) => {
    expect(CSS).toMatch(
      new RegExp(`@theme inline \\{[^}]*--color-${name}: hsl\\(var\\(--${name}\\)\\);`),
    );
  });
});

/** WCAG 2.x relative luminance of an `H S% L%` triplet. */
function luminance(hsl: string): number {
  const [h, s, l] = hsl.split(/\s+/).map((part) => Number.parseFloat(part));
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] =
    h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  const channel = (value: number) => {
    const c = value + m;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(theme: Theme, fg: string, bg: string): number {
  const a = luminance(triplet(theme, fg));
  const b = luminance(triplet(theme, bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ...STATE_VARIABLES.map((state): [string, string] => [state, "card"]),
];

describe("theme contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    it.each(TEXT_PAIRS)(`${theme}: --%s on --%s is at least 4.5`, (fg, bg) => {
      expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: the input border on card is at least 3.0`, () => {
      expect(contrast(theme, "input", "card")).toBeGreaterThanOrEqual(3.0);
    });
  }
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

/** `file:line` hits of a pattern across app/**\/*.tsx. */
function hits(pattern: RegExp): string[] {
  return tsxFiles(APP_DIR).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${path.relative(APP_DIR, file)}:${index + 1}`] : [],
      ),
  );
}

const HUE_CLASS =
  /(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/;

/**
 * Hard-coded hue classes whose meaning fits no decision-state token, left as
 * they are on purpose. Each entry is a `file:line` the PR that added it flags.
 */
const HUE_ALLOWLIST: string[] = [];

const OFF_SCALE_SIZE = /text-\[(9|10|11|13)px\]/;

describe("components stay on the tokens", () => {
  it("uses no hard-coded Tailwind hue outside the allowlist", () => {
    expect(hits(HUE_CLASS).filter((hit) => !HUE_ALLOWLIST.includes(hit))).toEqual([]);
  });

  it("uses no arbitrary label size between the scale's steps", () => {
    expect(hits(OFF_SCALE_SIZE)).toEqual([]);
  });
});

describe("theme fonts", () => {
  it("self-hosts IBM Plex Sans and JetBrains Mono through Fontsource", () => {
    expect(CSS).toMatch(/^@import "@fontsource-variable\/ibm-plex-sans";$/m);
    expect(CSS).toMatch(/^@import "@fontsource-variable\/jetbrains-mono";$/m);
    expect(PACKAGE.dependencies).toHaveProperty("@fontsource-variable/ibm-plex-sans");
    expect(PACKAGE.dependencies).toHaveProperty("@fontsource-variable/jetbrains-mono");
  });

  it("sets them as the sans and mono families", () => {
    expect(CSS).toMatch(/--font-sans:\s*"IBM Plex Sans Variable",/);
    expect(CSS).toMatch(/--font-mono:\s*"JetBrains Mono Variable",/);
  });

  it("drops Inter entirely", () => {
    expect(CSS).not.toMatch(/\binter\b/i);
    expect({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies }).not.toHaveProperty(
      "@fontsource-variable/inter",
    );
  });
});
