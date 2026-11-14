import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionSetupStep } from "@/components/sessions/session-setup-step";

import {
  DEPTHS,
  TECHNICAL_LEVELS,
  type Depth,
  type TechnicalLevel,
} from "@shared/session-constants";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => ({ data: undefined }),
  actionErrorMessage: () => null,
}));

// Every `section.key` resolves against the app's real English strings, so the
// markup carries the copy the owner reads.
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  const { default: catalog } = await import("@/i18n/en-US");
  return {
    ...original,
    useT: () => {
      const frameworkT = original.useT();
      return ((key: string, ...rest: unknown[]) => {
        const value = key
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            catalog,
          );
        return typeof value === "string"
          ? value
          : (frameworkT as (...args: unknown[]) => string)(key, ...rest);
      }) as typeof frameworkT;
    },
  };
});

const LEVEL_COPY: Record<TechnicalLevel, [string, string]> = {
  builder: ["I build software", "Cards can name technologies and trade-offs."],
  "technical-not-building": [
    "Technical, not building this",
    "Cards can be technical; the builder makes the build calls.",
  ],
  "not-technical": [
    "Not technical",
    "Cards stay in plain language; technology is the builder's call.",
  ],
};

/** The exact en-US copy of the depth options, as the ticket's Copy table states it. */
const DEPTH_TABLE: Record<Depth, [string, string]> = {
  "proof-of-concept": ["Proof of concept", "Enough to see whether it works at all."],
  "first-working-version": ["First working version", "Enough for people to use it."],
  "full-spec": ["Full spec", "Nothing left to the builder's call."],
};

function render(depth: Depth, level: TechnicalLevel | null): string {
  return renderToStaticMarkup(
    <SessionSetupStep
      depth={depth}
      level={level}
      onDepthChange={() => {}}
      onLevelChange={() => {}}
    />,
  );
}

interface Option {
  testId: string;
  on: boolean;
  text: string;
  index: number;
}

/** Each option element (a button) with the given test id prefix, in markup order. */
function options(markup: string, prefix: string): Option[] {
  const pattern = new RegExp(
    `<button([^>]*data-testid="(${prefix}[^"]+)"[^>]*)>([\\s\\S]*?)</button>`,
    "g",
  );
  return [...markup.matchAll(pattern)].map((match) => ({
    testId: match[2]!,
    on: /data-state="on"/.test(match[1]!),
    text: match[3]!.replace(/<[^>]+>/g, "|").replace(/&#x27;/g, "'"),
    index: match.index!,
  }));
}

describe("SessionSetupStep", () => {
  it("R1", () => {
    const levels = options(render("first-working-version", null), "setup-level-");
    expect(levels).toHaveLength(3);
    expect(levels.filter((option) => option.on)).toEqual([]);
  });

  it("R2", () => {
    const levels = options(
      render("first-working-version", "technical-not-building"),
      "setup-level-",
    );
    expect(levels.map((option) => option.testId)).toEqual(
      TECHNICAL_LEVELS.map((value) => `setup-level-${value}`),
    );
    expect(levels.filter((option) => option.on).map((option) => option.testId)).toEqual([
      "setup-level-technical-not-building",
    ]);
    TECHNICAL_LEVELS.forEach((value, index) => {
      const [label, help] = LEVEL_COPY[value];
      const parts = levels[index]!.text.split("|").filter(Boolean);
      expect(parts).toEqual([label, help]);
    });
  });

  it("R3", () => {
    const depths = options(render("first-working-version", null), "setup-depth-");
    expect(depths.map((option) => option.testId)).toEqual(
      DEPTHS.map((value) => `setup-depth-${value}`),
    );
    expect(depths.filter((option) => option.on).map((option) => option.testId)).toEqual([
      "setup-depth-first-working-version",
    ]);
    DEPTHS.forEach((value, index) => {
      const parts = depths[index]!.text.split("|").filter(Boolean);
      expect(parts).toEqual(DEPTH_TABLE[value]);
    });
  });

  it("R4", () => {
    const markup = render("full-spec", "builder").replace(/&#x27;/g, "'");
    expect(markup).toContain(">Depth<");
    expect(markup).toContain(">Your technical level<");
    expect(markup).toContain(
      ">How far to grill this idea, and how technical you are. You can change both later.<",
    );
  });
});
