import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RoundPanel } from "@/components/workspace/round-panel";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined }),
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  actionErrorMessage: () => null,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  const { default: messages } = await import("@/i18n/en-US");
  return {
    ...original,
    useT: () =>
      ((key: string) =>
        key.startsWith("workspace.")
          ? ((messages.workspace as Record<string, string>)[key.slice("workspace.".length)] ?? key)
          : key) as ReturnType<typeof original.useT>,
  };
});

const NO_ROUND = {
  sessionId: "s1",
  round: null,
  state: "interviewing",
  turnStatus: "idle",
} as unknown as Parameters<typeof RoundPanel>[0]["round"];

function render(hasRounds: boolean | undefined): string {
  return renderToStaticMarkup(
    <RoundPanel
      round={NO_ROUND}
      isLoading={false}
      hasRounds={hasRounds}
      decisions={[]}
      lastSubmittedAt={null}
      activeTurn={null}
      staleReviewTurn={null}
      supersessionTurn={null}
      onRequestNextRound={() => {}}
      isRequesting={false}
      onSubmit={() => {}}
      isSubmitting={false}
      onOpenDecision={() => {}}
    />,
  );
}

describe("RoundPanel with no open round", () => {
  it("renders the start control from whether a round exists", () => {
    const start = "Start the interview";
    const next = "Ask for the next round";

    const afterRound = render(true);
    expect(afterRound).toContain(next);
    expect(afterRound).not.toContain(start);

    const beforeRound = render(false);
    expect(beforeRound).toContain(start);
    expect(beforeRound).not.toContain(next);

    const unknown = render(undefined);
    expect(unknown).not.toContain(start);
    expect(unknown).not.toContain(next);
  });
});
