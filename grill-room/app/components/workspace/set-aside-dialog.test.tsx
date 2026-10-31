import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  actionErrorMessage: () => null,
}));

import { SET_ASIDE_TARGETS } from "@/components/workspace/set-aside-dialog";

describe("SetAsideDialog", () => {
  it("offers every target, in order", () => {
    expect(SET_ASIDE_TARGETS.map((target) => target.value)).toEqual([
      "out-of-scope",
      "open-question",
      "builders-call",
    ]);
    expect(SET_ASIDE_TARGETS[2]).toEqual({
      value: "builders-call",
      labelKey: "workspace.targetBuildersCall",
      hintKey: "workspace.targetBuildersCallHint",
    });
  });
});
