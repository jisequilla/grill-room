import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionDepthLevelControl } from "@/components/workspace/session-depth-level-control";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
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

type Props = ComponentProps<typeof SessionDepthLevelControl>;

const H5: Props = {
  sessionId: "s1",
  hasRound: true,
  state: "interviewing",
  turnStatus: "idle",
  depth: "full-spec",
  pendingDepth: null,
  specCurrent: false,
  technicalLevel: "builder",
  onChanged: () => {},
};
const H6: Props = { ...H5, turnStatus: "working" };
const H9: Props = { ...H5, specCurrent: true };
const H10: Props = { ...H5, state: "confirmed", specCurrent: true };

function render(props: Props): string {
  return renderToStaticMarkup(<SessionDepthLevelControl {...props} />).replace(
    /&#x27;/g,
    "'",
  );
}

/** The opening tag and text of the element carrying the test id. */
function element(markup: string, testId: string): { tag: string; text: string } {
  const pattern = new RegExp(
    `<(\\w+)([^>]*data-testid="${testId}"[^>]*)>([\\s\\S]*?)</\\1>`,
  );
  const match = pattern.exec(markup);
  if (!match) throw new Error(`no element with data-testid="${testId}"`);
  return { tag: match[2]!, text: match[3]!.replace(/<[^>]+>/g, "") };
}

describe("SessionDepthLevelControl", () => {
  it("N1", () => {
    expect(render({ ...H5, hasRound: undefined })).toBe("");
  });

  it("N4", () => {
    expect(render({ ...H9, specCurrent: undefined })).toBe("");
  });

  it("N2", () => {
    const markup = render(H10);
    expect(element(markup, "depth-warning-reopens").text).toBe(
      "Changing depth reopens the grill.",
    );
    expect(element(markup, "depth-warning-stale").text).toBe(
      "Changing depth marks the spec, its tickets and the consistency check stale.",
    );
    expect(element(markup, "depth-control-note").text).toBe(
      "Applies from the next round.",
    );
  });

  it("N3", () => {
    const markup = render({ ...H6, technicalLevel: null });
    expect(element(markup, "depth-control").tag).toMatch(/\sdisabled=""/);
    const level = element(markup, "level-control");
    expect(level.tag).not.toMatch(/\sdisabled=""/);
    expect(level.text).toContain("Not set");
    expect(element(markup, "level-control-note").text).toBe(
      "Applies from the next round, in every session.",
    );
  });
});
