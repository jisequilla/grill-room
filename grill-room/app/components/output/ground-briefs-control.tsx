import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconGitBranch } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";
import { actionErrorCode } from "@/lib/decisions";

/** A turn takes a minute or more; the default 60 s client timeout cancels one about to succeed. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

/** Failures the shared turn status banner above already reports; showing them again here would say it twice. */
const SILENT_ERROR_CODES = new Set([
  "turn-in-progress",
  "cli-missing",
  "not-logged-in",
  "rate-limited",
  "malformed-output",
  "invalid-brief-grounding",
  "failed",
]);

/**
 * Mirrors `MAX_HANDOFF_SCOUT_TICKETS` in `server/interviewer/schemas.ts`,
 * server-only code this client bundle cannot import.
 */
const MAX_HANDOFF_SCOUT_TICKETS = 40;

/** Mirrors `MAX_HANDOFF_SCOUT_BUILDS_ON` in `server/interviewer/schemas.ts`. */
const MAX_HANDOFF_SCOUT_BUILDS_ON = 15;

/** A commit's first 7 characters, or null for a repository with no commits yet. */
function shortSha(commit: string | null): string | null {
  return commit ? commit.slice(0, 7) : null;
}

/**
 * The "Ground the briefs" control, shown near the Handoff block: runs the
 * handoff scout (`ground-briefs`) and shows the session's current grounding
 * state. Disabled with a reason for every refusal this component can read
 * ahead of time from data it already has (no project, no handoff, a stale
 * handoff, a turn already working, too many tickets or blockers); any other
 * refusal — chiefly `not-a-repo`, which needs a real git check this component
 * cannot make in advance — surfaces as the action's own refusal message once
 * an attempt actually fails.
 */
export function GroundBriefsControl({
  sessionId,
  projectId,
  working,
  activeTurn,
}: {
  sessionId: string;
  /** The project this session exports into, or null when it has none. */
  projectId: string | null;
  /** Whether the session's stored turn is currently running, of any kind. */
  working: boolean;
  /** The turn the session's current turn status belongs to, of any kind. */
  activeTurn: Turn | null;
}) {
  const t = useT();
  const [refusal, setRefusal] = useState<string | null>(null);

  const { data: handoffData } = useActionQuery("get-handoff", { sessionId });
  const handoff = handoffData?.handoff ?? null;

  const { data: ticketsData } = useActionQuery("list-tickets", { sessionId });
  const tickets = ticketsData?.tickets ?? [];

  const { data: groundingData } = useActionQuery("get-brief-grounding", { sessionId });
  const grounding = groundingData?.grounding ?? null;

  // Collapsed once grounding has stopped: the turn linked from the grounding
  // row's `turnId`, only set once a grounding has actually completed.
  const { data: completedTurn } = useActionQuery(
    "get-turn",
    { turnId: grounding?.turnId ?? "" },
    { enabled: grounding?.turnId != null },
  );

  // Live while this route's active turn is actually a handoff scout still
  // running; the collapsed, already-stopped turn otherwise.
  const attemptLogTurn =
    activeTurn != null &&
    activeTurn.turnKind === "handoff-scout" &&
    activeTurn.completedAt === null
      ? activeTurn
      : (completedTurn ?? null);

  const groundBriefs = useActionMutation("ground-briefs", {
    timeoutMs: TURN_TIMEOUT_MS,
    onSuccess: () => setRefusal(null),
    onError: (error: unknown) => {
      if (SILENT_ERROR_CODES.has(actionErrorCode(error) ?? "")) return;
      setRefusal(actionErrorMessage(error) ?? t("output.groundBriefsFailed"));
    },
  });

  const tooManyTickets = tickets.length > MAX_HANDOFF_SCOUT_TICKETS;
  const tooManyBlockers = tickets.some(
    (ticket) => ticket.blockedBy.length > MAX_HANDOFF_SCOUT_BUILDS_ON,
  );

  const disabledReason = working
    ? t("output.groundBriefsTurnWorking")
    : projectId === null
      ? t("output.groundBriefsNeedsProject")
      : !handoff
        ? t("output.groundBriefsNeedsHandoff")
        : handoff.stale
          ? t("output.groundBriefsHandoffStale")
          : tooManyTickets
            ? t("output.groundBriefsTooManyTickets", { max: MAX_HANDOFF_SCOUT_TICKETS })
            : tooManyBlockers
              ? t("output.groundBriefsTooManyBlockers", { max: MAX_HANDOFF_SCOUT_BUILDS_ON })
              : null;

  const busy = working || groundBriefs.isPending;
  const canGround = disabledReason === null && !busy;

  function run() {
    setRefusal(null);
    groundBriefs.mutate({ sessionId });
  }

  const sha = shortSha(grounding?.commitRead ?? null) ?? t("output.groundingNoCommit");
  const groundingState: "absent" | "current" | "stale" = !grounding
    ? "absent"
    : grounding.current
      ? "current"
      : "stale";
  const groundingLabel =
    groundingState === "absent"
      ? t("output.groundingAbsent")
      : groundingState === "current"
        ? t("output.groundingCurrent", { sha })
        : grounding!.staleReason === "head-moved"
          ? t("output.groundingStaleHeadMoved", { sha })
          : t("output.groundingStaleHandoffChanged", { sha });

  return (
    <section className="space-y-2" data-testid="output-ground-briefs-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("output.groundBriefsHeading")}</h3>
        <Badge
          variant={groundingState === "stale" ? "secondary" : "outline"}
          data-testid="grounding-state"
          data-state={groundingState}
        >
          {groundingLabel}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{t("output.groundBriefsHint")}</p>

      <TurnAttemptLog turn={attemptLogTurn} />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canGround}
        onClick={run}
        data-testid="ground-briefs"
      >
        {groundBriefs.isPending ? (
          <Spinner className="size-4" />
        ) : (
          <IconGitBranch className="size-4" />
        )}
        {t(groundBriefs.isPending ? "output.groundingBriefs" : "output.groundBriefs")}
      </Button>

      {disabledReason ? (
        <p className="text-xs text-muted-foreground" data-testid="ground-briefs-disabled-reason">
          {disabledReason}
        </p>
      ) : null}

      {refusal ? (
        <p className="text-xs text-destructive" data-testid="ground-briefs-error">
          {refusal}
        </p>
      ) : null}
    </section>
  );
}
