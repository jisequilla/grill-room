import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import type {
  SessionAnsweringMode,
  SessionModel,
} from "@shared/session-constants";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AddDecisionDialog } from "@/components/workspace/add-decision-dialog";
import { AnsweringModeSwitch } from "@/components/workspace/answering-mode-switch";
import { BriefStrip } from "@/components/workspace/brief-strip";
import { DecisionDetailSheet } from "@/components/workspace/decision-detail-sheet";
import { DesignTree } from "@/components/workspace/design-tree";
import { DocsFolderChip } from "@/components/workspace/docs-folder-chip";
import { HeaderOverflowMenu } from "@/components/workspace/header-overflow-menu";
import { ReadinessPanel, ScoutReportPanel } from "@/components/workspace/readiness-panel";
import { RoundHistory } from "@/components/workspace/round-history";
import { RoundPanel } from "@/components/workspace/round-panel";
import { SessionIdea } from "@/components/workspace/session-idea";
import { SessionModelControl } from "@/components/workspace/session-model-control";
import { TreeFooter } from "@/components/workspace/tree-footer";
import { TreeSheet, TreeSheetTrigger } from "@/components/workspace/tree-sheet";
import { APP_TITLE } from "@/lib/app-config";
import {
  actionErrorCode,
  type SessionState,
  type TreeDecision,
} from "@/lib/decisions";

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

/**
 * How often the workspace re-reads the session once this tab has sent a
 * turn-starting request but the round it fetched hasn't caught up to
 * "working" yet. Faster than {@link TURN_POLL_MS}: this window is normally
 * closed within one round trip to the server (which marks the turn
 * "working" before doing anything else), and a short turn can start and
 * fail inside a single `TURN_POLL_MS` tick.
 */
const STARTING_POLL_MS = 500;

/** What the centre column is showing, which is the session's state, not "this round". */
const PANEL_HEADING_KEY: Record<SessionState, string> = {
  interviewing: "workspace.roundHeading",
  "done-proposed": "workspace.doneHeading",
  confirmed: "workspace.confirmedHeading",
};

/**
 * Failures the session's stored turn status already reports on screen. Toasting
 * them as well would say the same thing twice, in a place the user cannot act
 * on. `turn-in-progress` and `turn-working` are not failures at all: a turn is
 * simply already running, and the next poll shows it.
 */
const SILENT_ERROR_CODES = new Set([
  "turn-in-progress",
  "turn-working",
  "cli-missing",
  "not-logged-in",
  "rate-limited",
  "malformed-output",
  "invalid-proposal",
  "invalid-review",
  "invalid-readiness",
  "failed",
]);

/**
 * Refusals of a readiness judgment that only mean the page is out of date: a
 * round opened, or the session left interviewing, since it was last read. The
 * refresh that follows every failure hides the panel; nothing needs saying.
 */
const STALE_READINESS_CODES = new Set(["has-rounds", "wrong-session-state"]);

/**
 * Refusals of a scout run or a keep/drop that only mean the page is out of
 * date: the session left interviewing, or a turn started, since it was last
 * read. The refresh that follows every failure catches the page up; nothing
 * needs saying.
 */
const STALE_SCOUT_CODES = new Set(["wrong-session-state", "turn-working"]);

export default function SessionWorkspaceRoute() {
  const t = useT();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const id = sessionId ?? "";
  const enabled = id.length > 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [treeSheetOpen, setTreeSheetOpen] = useState(false);
  const treeTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: session, isLoading: sessionLoading } = useActionQuery(
    "get-session",
    { id },
    { enabled },
  );

  // One line whatever the width: the actions take what they need and the title
  // truncates in the rest, with the whole of it kept in `title`.
  const pageTitle = session?.title ?? t("pages.sessionWorkspaceTitle");
  useSetPageTitle(
    <h1
      className="min-w-0 truncate text-lg font-semibold tracking-tight"
      title={pageTitle}
      data-testid="session-title"
    >
      {pageTitle}
    </h1>,
  );

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

  // Declared before the polled queries below: the queries' `refetchInterval`
  // reads these mutations' `isPending`, which is true from the moment this
  // tab sends a turn-starting request — well before a fetched round can say
  // "working" itself. Without this, the tab that started the turn shows
  // nothing until its own request settles, by which point the turn is over.
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

  const assessReadiness = useActionMutation("assess-readiness", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: (error: unknown) => {
      refresh();
      const code = actionErrorCode(error) ?? "";
      if (SILENT_ERROR_CODES.has(code) || STALE_READINESS_CODES.has(code))
        return;
      toast.error(
        actionErrorMessage(error) ?? t("workspace.readinessAssessFailed"),
      );
    },
    onSettled: refresh,
  });

  // Refusals (an empty idea, a round that opened meanwhile) are shown inside
  // the editor, so this only keeps every view of the session current.
  const updateIdea = useActionMutation("update-session-idea", {
    onSettled: refresh,
  });

  function reportScoutError(fallbackKey: string) {
    return (error: unknown) => {
      refresh();
      const code = actionErrorCode(error) ?? "";
      if (SILENT_ERROR_CODES.has(code) || STALE_SCOUT_CODES.has(code)) return;
      toast.error(actionErrorMessage(error) ?? t(fallbackKey));
    };
  }

  const scoutProject = useActionMutation("scout-project", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: reportScoutError("workspace.scoutRunFailed"),
    onSettled: refresh,
  });

  const keepRepoDecision = useActionMutation("keep-repo-decision", {
    onError: reportScoutError("workspace.scoutKeepFailed"),
    onSettled: refresh,
  });

  const dropRepoDecision = useActionMutation("drop-repo-decision", {
    onError: reportScoutError("workspace.scoutDropFailed"),
    onSettled: refresh,
  });

  const startingTurn =
    nextRound.isPending ||
    submitRound.isPending ||
    assessReadiness.isPending ||
    scoutProject.isPending;

  // The turn runs on the server whether or not this tab is still waiting on the
  // request that started it, so the workspace polls its way back to the truth
  // rather than trusting a promise it may never see resolve. While this tab's
  // own request is pending but the round hasn't caught up yet, poll fast; once
  // the round itself reads "working", the normal cadence is enough to follow
  // it home.
  const { data: round, isLoading: roundLoading } = useActionQuery(
    "get-current-round",
    { sessionId: id },
    {
      enabled,
      refetchInterval: (query) => {
        if (query.state.data?.turnStatus === "working") return TURN_POLL_MS;
        return startingTurn ? STARTING_POLL_MS : false;
      },
    },
  );

  const working = round?.turnStatus === "working";
  const pollInterval = working
    ? TURN_POLL_MS
    : startingTurn
      ? STARTING_POLL_MS
      : false;

  const { data: tree } = useActionQuery(
    "get-tree",
    { sessionId: id },
    { enabled, refetchInterval: pollInterval },
  );

  const { data: rounds } = useActionQuery(
    "list-rounds",
    { sessionId: id },
    { enabled, refetchInterval: pollInterval },
  );

  // The turn the session's current turn status belongs to, of any kind: a
  // round proposal, a readiness judgment, a stale review, or a supersession
  // check all share the same turn lock, so the live turn status must read
  // whichever kind actually started it rather than assuming a round
  // proposal. Feeds the attempt log on the working and failed panels.
  const { data: activeTurn } = useActionQuery(
    "get-active-turn",
    { sessionId: id },
    { enabled, refetchInterval: pollInterval },
  );

  // The turn of the session's stored readiness judgment, stale review, and
  // supersession check — collapsed beside what each one produced, once it has
  // stopped. Fetched once the session carries the id, and refreshed like
  // everything else whenever an action settles.
  const { data: readinessTurn } = useActionQuery(
    "get-turn",
    { turnId: session?.readinessTurnId ?? "" },
    { enabled: enabled && session?.readinessTurnId != null },
  );

  const { data: staleReviewTurn } = useActionQuery(
    "get-turn",
    { turnId: session?.staleReviewTurnId ?? "" },
    { enabled: enabled && session?.staleReviewTurnId != null },
  );

  const { data: supersessionTurn } = useActionQuery(
    "get-turn",
    { turnId: session?.supersessionTurnId ?? "" },
    { enabled: enabled && session?.supersessionTurnId != null },
  );

  const hasProject = session?.projectId != null;

  // The session's scout report, kept reachable for the whole interview (not
  // just before the first round) so re-scout and keep/drop stay available.
  // Polled the same as the tree while a turn works, since a re-scout run
  // moves this the way any other turn moves its own result.
  const { data: scoutReportData } = useActionQuery(
    "get-scout-report",
    { sessionId: id },
    { enabled: enabled && hasProject, refetchInterval: pollInterval },
  );
  const scoutReport = scoutReportData?.report ?? null;

  const { data: scoutTurn } = useActionQuery(
    "get-turn",
    { turnId: scoutReport?.turnId ?? "" },
    { enabled: enabled && scoutReport?.turnId != null },
  );

  // The tree footer counts loose ends the way the loose ends list does, by
  // asking the same action, so the two can never disagree about what is open.
  const { data: looseEnds } = useActionQuery(
    "list-loose-ends",
    { sessionId: id },
    { enabled, refetchInterval: pollInterval },
  );

  const decisions: TreeDecision[] = tree?.decisions ?? [];

  // Readiness is judged before the first round only: the same moment the
  // centre column offers to start the interview.
  const showReadiness =
    round !== undefined &&
    round.state === "interviewing" &&
    round.round === null &&
    decisions.length === 0 &&
    rounds !== undefined &&
    rounds.rounds.length === 0;

  // The Brief strip's readiness half reads the session's stored judgment
  // (persisted across rounds while the idea is unchanged), independent of
  // `showReadiness` — which only gates the invitation panel's own presence.
  const readiness = round?.readiness ?? null;

  // Whether the currently working turn (if any) is this session's scout run
  // or its readiness judgment, so the Brief strip's summary can show
  // "Scout: reading…" / "Readiness · judging…" for the right one — this
  // tab's own request is known immediately through the mutation's own
  // pending state, another tab's through polling once `activeTurn` catches
  // up.
  const scoutTurnWorking =
    scoutProject.isPending || (working && activeTurn?.turnKind === "scout-project");
  const readinessTurnWorking =
    assessReadiness.isPending ||
    (working && activeTurn?.turnKind === "assess-readiness");

  // The strip's body shows `ReadinessPanel` whenever there is something for
  // it to show: the pre-round-1 invitation (`showReadiness`), or a stored
  // judgment that outlives round 1 (DESIGN.md's "no project, a readiness
  // judgment exists" row applies for the whole session, not only before the
  // first round). This must stay in exact lockstep with `BriefStrip`'s own
  // render gate (`hasProject || readiness !== null || showReadiness`) so a
  // strip that renders always has something in its body: `hasProject` gets
  // the scout panel, this gets the readiness panel, and the gate is the `||`
  // of both.
  const readinessBodyVisible = showReadiness || readiness !== null;

  // `assess-readiness` refuses with `has-rounds` once any round exists, so
  // the panel stops offering the control from then on — read-only after
  // that, not gone.
  const canAssessReadiness = rounds !== undefined && rounds.rounds.length === 0;

  const selected =
    decisions.find((decision) => decision.id === selectedId) ?? null;

  // What the "what changed" digest treats as already seen: everything up to
  // (and including) the last round the user actually submitted.
  const lastSubmittedAt =
    rounds?.rounds
      .filter(
        (round) => round.submissionState === "submitted" && round.submittedAt,
      )
      .reduce<string | null>(
        (latest, round) =>
          !latest || (round.submittedAt as string) > latest
            ? (round.submittedAt as string)
            : latest,
        null,
      ) ?? null;

  function selectDecision(decision: TreeDecision) {
    setTreeSheetOpen(false);
    openDecision(decision.id);
  }

  function openDecision(decisionId: string) {
    setSelectedId(decisionId);
    setDetailOpen(true);
  }

  const looseEndCount = looseEnds?.length ?? 0;

  // At `lg` and wider: the mode switch and "Add my own decision", then `…`.
  // Below `lg`: the tree button and `…`, which then holds every action.
  // Both sets stay mounted and CSS picks one, as the sidebar and its
  // hamburger do.
  useSetHeaderActions(
    session ? (
      <div className="flex min-w-0 items-center gap-2">
        <div className="hidden items-center gap-2 lg:flex">
          <AnsweringModeSwitch
            sessionId={id}
            answeringMode={session.answeringMode as SessionAnsweringMode}
          />
          <AddDecisionDialog sessionId={id} />
        </div>
        <TreeSheetTrigger
          className="lg:hidden"
          looseEnds={looseEndCount}
          buttonRef={treeTriggerRef}
          onOpen={() => setTreeSheetOpen(true)}
        />
        <HeaderOverflowMenu
          sessionId={id}
          answeringMode={session.answeringMode as SessionAnsweringMode}
        />
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

  const treePanel = (
    <>
      <DesignTree
        decisions={decisions}
        selectedId={selectedId}
        onSelect={selectDecision}
      />
      {decisions.length > 0 ? (
        <TreeFooter
          settled={
            decisions.filter((decision) => decision.state === "settled").length
          }
          total={
            decisions.filter((decision) => decision.withdrawnAt === null).length
          }
          looseEnds={looseEndCount}
        />
      ) : null}
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto w-full max-w-[1600px] p-6">
        {/* The shell header already carries the session's title, so this block
            is the idea rather than a second heading: the meta chips sit on
            their own row and the idea gets the width to be read whole. */}
        <header className="flex flex-col gap-2 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <SessionStateBadge state={session.state} />
            <SessionModelControl
              sessionId={id}
              model={session.model as SessionModel}
              modelLocked={session.modelLocked}
              onChanged={refresh}
            />
            <DocsFolderChip
              sessionId={id}
              docsFolder={session.docsFolder}
              onChanged={refresh}
            />
          </div>
          <SessionIdea
            idea={session.idea}
            canEdit={round?.canEditIdea ?? false}
            onSave={(idea) => updateIdea.mutateAsync({ sessionId: id, idea })}
          />
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 space-y-8">
            <BriefStrip
              key={id}
              hasProject={hasProject}
              scoutReport={scoutReport}
              scoutWorking={scoutTurnWorking}
              readiness={readiness}
              readinessWorking={readinessTurnWorking}
              showReadiness={showReadiness}
              roundsCount={rounds?.rounds.length}
            >
              {hasProject ? (
                <ScoutReportPanel
                  report={scoutReport}
                  busy={
                    working ||
                    scoutProject.isPending ||
                    keepRepoDecision.isPending ||
                    dropRepoDecision.isPending
                  }
                  isScouting={scoutProject.isPending}
                  onRescout={() => scoutProject.mutate({ sessionId: id })}
                  onKeep={(key) =>
                    keepRepoDecision.mutate({ sessionId: id, key })
                  }
                  onDrop={(key) =>
                    dropRepoDecision.mutate({ sessionId: id, key })
                  }
                  turn={scoutTurn ?? null}
                />
              ) : null}
              {readinessBodyVisible ? (
                <ReadinessPanel
                  readiness={readiness}
                  working={working}
                  isAssessing={assessReadiness.isPending}
                  onAssess={() => assessReadiness.mutate({ sessionId: id })}
                  turn={readinessTurn ?? null}
                  canAssess={canAssessReadiness}
                />
              ) : null}
            </BriefStrip>

            <section>
              <h3 className="pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t(PANEL_HEADING_KEY[session.state as SessionState])}
              </h3>
              <RoundPanel
                round={round}
                isLoading={roundLoading}
                hasDecisions={decisions.length > 0}
                decisions={decisions}
                lastSubmittedAt={lastSubmittedAt}
                activeTurn={activeTurn ?? null}
                staleReviewTurn={staleReviewTurn ?? null}
                supersessionTurn={supersessionTurn ?? null}
                onRequestNextRound={() => nextRound.mutate({ sessionId: id })}
                isRequesting={nextRound.isPending}
                onSubmit={(roundId) => submitRound.mutate({ id: roundId })}
                isSubmitting={submitRound.isPending}
                onOpenDecision={openDecision}
              />
            </section>

            <section>
              <h3 className="pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("workspace.historyHeading")}
              </h3>
              <RoundHistory
                rounds={rounds?.rounds ?? []}
                decisions={decisions}
              />
            </section>
          </div>

          {/* The column is sized to reach the bottom of the viewport from
              where it starts unscrolled, which is the state this page is
              read in: the centre column is what scrolls. Below `lg` it is
              hidden and the tree opens as a sheet from the header. */}
          <aside className="hidden min-w-0 flex-col lg:sticky lg:top-6 lg:flex lg:h-[calc(100dvh-15rem)] lg:self-start">
            <h3 className="pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.treeHeading")}
            </h3>
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card/50">
              {treePanel}
            </div>
          </aside>
        </div>

        <TreeSheet
          open={treeSheetOpen}
          onOpenChange={setTreeSheetOpen}
          returnFocusTo={treeTriggerRef}
        >
          {treePanel}
        </TreeSheet>

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
