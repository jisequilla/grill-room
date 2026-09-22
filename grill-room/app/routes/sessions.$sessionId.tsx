import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetHeaderActions, useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { AddDecisionDialog } from "@/components/workspace/add-decision-dialog";
import { AnsweringModeSwitch } from "@/components/workspace/answering-mode-switch";
import { DecisionDetailSheet } from "@/components/workspace/decision-detail-sheet";
import { DesignTree } from "@/components/workspace/design-tree";
import { RoundHistory } from "@/components/workspace/round-history";
import { RoundPanel } from "@/components/workspace/round-panel";
import { SessionIdea } from "@/components/workspace/session-idea";
import { TreeFooter } from "@/components/workspace/tree-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import {
  actionErrorCode,
  type SessionState,
  type TreeDecision,
} from "@/lib/decisions";
import { MODEL_LABEL_KEY } from "@/lib/session-labels";

import type { SessionAnsweringMode, SessionModel } from "@shared/session-constants";

export function meta() {
  return [{ title: APP_TITLE }];
}

/**
 * A turn is a Claude CLI call: a minute is normal, several happen. The client
 * helpers abort at 60 s by default, which cancels a turn that was about to
 * succeed and leaves the session reading `working` with nobody waiting on it.
 */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

/** How often the workspace re-reads the session while the interviewer works. */
const TURN_POLL_MS = 3000;

/** What the centre column is showing, which is the session's state, not "this round". */
const PANEL_HEADING_KEY: Record<SessionState, string> = {
  interviewing: "workspace.roundHeading",
  "done-proposed": "workspace.doneHeading",
  confirmed: "workspace.confirmedHeading",
};

/**
 * Failures the session's stored turn status already reports on screen. Toasting
 * them as well would say the same thing twice, in a place the user cannot act
 * on. `turn-in-progress` is not a failure at all: the turn is simply already
 * running, and the next poll shows it.
 */
const SILENT_ERROR_CODES = new Set([
  "turn-in-progress",
  "cli-missing",
  "not-logged-in",
  "rate-limited",
  "malformed-output",
  "invalid-proposal",
  "invalid-review",
  "failed",
]);

export default function SessionWorkspaceRoute() {
  const t = useT();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const id = sessionId ?? "";
  const enabled = id.length > 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: session, isLoading: sessionLoading } = useActionQuery(
    "get-session",
    { id },
    { enabled },
  );

  // The turn runs on the server whether or not this tab is still waiting on the
  // request that started it, so the workspace polls its way back to the truth
  // rather than trusting a promise it may never see resolve.
  const { data: round, isLoading: roundLoading } = useActionQuery(
    "get-current-round",
    { sessionId: id },
    {
      enabled,
      refetchInterval: (query) =>
        query.state.data?.turnStatus === "working" ? TURN_POLL_MS : false,
    },
  );

  const working = round?.turnStatus === "working";

  const { data: tree } = useActionQuery(
    "get-tree",
    { sessionId: id },
    { enabled, refetchInterval: working ? TURN_POLL_MS : false },
  );

  const { data: rounds } = useActionQuery(
    "list-rounds",
    { sessionId: id },
    { enabled, refetchInterval: working ? TURN_POLL_MS : false },
  );

  // The tree footer counts loose ends the way the loose ends list does, by
  // asking the same action, so the two can never disagree about what is open.
  const { data: looseEnds } = useActionQuery(
    "list-loose-ends",
    { sessionId: id },
    { enabled, refetchInterval: working ? TURN_POLL_MS : false },
  );

  useSetPageTitle(session?.title ?? t("pages.sessionWorkspaceTitle"));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["action"] });
  }

  function reportTurnError(fallbackKey: string) {
    return (error: unknown) => {
      refresh();
      if (SILENT_ERROR_CODES.has(actionErrorCode(error) ?? "")) return;
      toast.error(actionErrorMessage(error) ?? t(fallbackKey));
    };
  }

  const nextRound = useActionMutation("request-next-round", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: reportTurnError("workspace.errorGeneric"),
    onSettled: refresh,
  });

  const submitRound = useActionMutation("submit-round", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: reportTurnError("workspace.submitFailed"),
    onSettled: refresh,
  });

  const decisions: TreeDecision[] = tree?.decisions ?? [];
  const selected =
    decisions.find((decision) => decision.id === selectedId) ?? null;

  // What the "what changed" digest treats as already seen: everything up to
  // (and including) the last round the user actually submitted.
  const lastSubmittedAt =
    rounds?.rounds
      .filter((round) => round.submissionState === "submitted" && round.submittedAt)
      .reduce<string | null>(
        (latest, round) =>
          !latest || (round.submittedAt as string) > latest
            ? (round.submittedAt as string)
            : latest,
        null,
      ) ?? null;

  function selectDecision(decision: TreeDecision) {
    openDecision(decision.id);
  }

  function openDecision(decisionId: string) {
    setSelectedId(decisionId);
    setDetailOpen(true);
  }

  useSetHeaderActions(
    session ? (
      <div className="flex items-center gap-2">
        <AnsweringModeSwitch
          sessionId={id}
          answeringMode={session.answeringMode as SessionAnsweringMode}
        />
        <AddDecisionDialog sessionId={id} />
      </div>
    ) : null,
  );

  if (sessionLoading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto w-full max-w-[1600px] p-6">
        {/* The shell header already carries the session's title, so this block
            is the idea rather than a second heading: the meta chips sit on
            their own row and the idea gets the width to be read whole. */}
        <header className="flex flex-col gap-2 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <SessionStateBadge state={session.state} />
            <span className="text-sm text-muted-foreground">
              {t(MODEL_LABEL_KEY[session.model as SessionModel])}
            </span>
          </div>
          <SessionIdea idea={session.idea} />
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 space-y-8">
            <section>
              <h3 className="pb-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t(PANEL_HEADING_KEY[session.state as SessionState])}
              </h3>
              <RoundPanel
                round={round}
                isLoading={roundLoading}
                hasDecisions={decisions.length > 0}
                decisions={decisions}
                lastSubmittedAt={lastSubmittedAt}
                onRequestNextRound={() => nextRound.mutate({ sessionId: id })}
                isRequesting={nextRound.isPending}
                onSubmit={(roundId) => submitRound.mutate({ id: roundId })}
                isSubmitting={submitRound.isPending}
                onOpenDecision={openDecision}
              />
            </section>

            <section>
              <h3 className="pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("workspace.historyHeading")}
              </h3>
              <RoundHistory rounds={rounds?.rounds ?? []} decisions={decisions} />
            </section>
          </div>

          {/* The column is sized to reach the bottom of the viewport from
              where it starts unscrolled, which is the state this page is
              read in: the centre column is what scrolls. */}
          <aside className="flex min-w-0 flex-col lg:sticky lg:top-6 lg:h-[calc(100dvh-15rem)] lg:self-start">
            <h3 className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.treeHeading")}
            </h3>
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card/50">
              <DesignTree
                decisions={decisions}
                selectedId={selectedId}
                onSelect={selectDecision}
              />
              {decisions.length > 0 ? (
                <TreeFooter
                  settled={
                    decisions.filter(
                      (decision) => decision.state === "settled",
                    ).length
                  }
                  total={
                    decisions.filter(
                      (decision) => decision.withdrawnAt === null,
                    ).length
                  }
                  looseEnds={looseEnds?.length ?? 0}
                />
              ) : null}
            </div>
          </aside>
        </div>

        <DecisionDetailSheet
          decision={selected}
          decisions={decisions}
          open={detailOpen && selected !== null}
          onOpenChange={setDetailOpen}
        />
      </div>
    </TooltipProvider>
  );
}
