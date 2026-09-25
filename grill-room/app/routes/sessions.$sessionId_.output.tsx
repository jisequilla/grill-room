import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import type { SessionModel } from "@shared/session-constants";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";

import { BuildRecordsSection } from "@/components/output/build-records-section";
import { ExportSection } from "@/components/output/export-section";
import { GenerateAllAction } from "@/components/output/generate-all-action";
import { GroundBriefsControl } from "@/components/output/ground-briefs-control";
import { HandoffSection } from "@/components/output/handoff-section";
import { NotConfirmedNotice } from "@/components/output/not-confirmed-notice";
import { SessionProjectSection } from "@/components/output/session-project-section";
import { SpecSection } from "@/components/output/spec-section";
import { TicketsSection } from "@/components/output/tickets-section";
import { TurnStatusBanner } from "@/components/output/turn-status-banner";
import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { MODEL_LABEL_KEY } from "@/lib/session-labels";

export function meta() {
  return [{ title: APP_TITLE }];
}

/** How often the page re-reads the session while a turn is running. */
const TURN_POLL_MS = 3000;

/**
 * How often the page re-reads the session once this tab has sent a request
 * that may have started a turn (`synthesize-spec`, `break-into-tickets`) but
 * the session it fetched hasn't caught up to "working" yet. Faster than
 * {@link TURN_POLL_MS}: the server marks the turn "working" before doing
 * anything else, so this window normally closes within one round trip, and a
 * short turn can start and fail inside a single `TURN_POLL_MS` tick.
 *
 * `synthesize-spec` and `break-into-tickets` are mutations owned by
 * `SpecSection` and `TicketsSection`, not this route, so their own
 * `isPending` isn't available here. Any mutation pending anywhere in this
 * route's tree — which, mounted, is exactly this page's sections — is close
 * enough: the extra poll while an unrelated quick edit (e.g. editing a
 * ticket's blockers) settles is harmless.
 */
const STARTING_POLL_MS = 500;

export default function SessionOutputRoute() {
  const t = useT();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const id = sessionId ?? "";
  const enabled = id.length > 0;

  const startingTurn = useIsMutating() > 0;

  const { data: session, isLoading } = useActionQuery(
    "get-session",
    { id },
    {
      enabled,
      refetchInterval: (query) => {
        if (query.state.data?.turnStatus === "working") return TURN_POLL_MS;
        return startingTurn ? STARTING_POLL_MS : false;
      },
    },
  );

  // The turn the session's current turn status belongs to, of any kind — on
  // this route, either a spec synthesis or a ticket breakdown, since those
  // are the only two turn kinds this route can run. Each section shows it
  // live only while it is both still running and its own kind, so the log
  // appears beside whichever of the two is actually in flight.
  const { data: activeTurn } = useActionQuery(
    "get-active-turn",
    { sessionId: id },
    {
      enabled,
      refetchInterval:
        session?.turnStatus === "working"
          ? TURN_POLL_MS
          : startingTurn
            ? STARTING_POLL_MS
            : false,
    },
  );

  useSetPageTitle(session?.title ?? t("pages.sessionOutputTitle"));

  // synthesize-spec and break-into-tickets share the session's turn columns —
  // only one turn runs at a time — so both sections settle from one refresh.
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["action"] });
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) return null;

  if (session.state !== "confirmed") {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <NotConfirmedNotice sessionId={id} />
      </div>
    );
  }

  const working = session.turnStatus === "working";
  const turnError = session.turnErrorCode
    ? { code: session.turnErrorCode, message: session.turnErrorMessage ?? "" }
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <header className="flex flex-wrap items-center gap-2">
        <SessionStateBadge state={session.state} />
        <span className="text-sm text-muted-foreground">
          {t(MODEL_LABEL_KEY[session.model as SessionModel])}
        </span>
        <span className="text-sm text-muted-foreground">·</span>
        <span className="max-w-md truncate text-sm text-muted-foreground">
          {session.idea}
        </span>
      </header>

      <TurnStatusBanner
        turnStatus={session.turnStatus}
        turnStartedAt={session.turnStartedAt}
        turnError={turnError}
      />

      <SpecSection
        sessionId={id}
        working={working}
        activeTurn={activeTurn ?? null}
        onSettled={refresh}
      />

      <Separator />

      <TicketsSection
        sessionId={id}
        working={working}
        activeTurn={activeTurn ?? null}
        onSettled={refresh}
      />

      <Separator />

      <HandoffSection sessionId={id} />

      <GroundBriefsControl
        sessionId={id}
        projectId={session.projectId}
        working={working}
        activeTurn={activeTurn ?? null}
        onSettled={refresh}
      />

      <Separator />

      <BuildRecordsSection sessionId={id} />

      <Separator />

      <SessionProjectSection sessionId={id} projectId={session.projectId} />

      <GenerateAllAction sessionId={id} working={working} onSettled={refresh} />

      <ExportSection sessionId={id} projectId={session.projectId} />
    </div>
  );
}
