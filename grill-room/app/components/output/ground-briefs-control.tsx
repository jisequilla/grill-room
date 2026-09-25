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

import {
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_TICKETS,
} from "@shared/session-constants";

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

/** A commit's first 7 characters, or null for a repository with no commits yet. */
export function shortSha(commit: string | null): string | null {
  return commit ? commit.slice(0, 7) : null;
}

/** The grounding badge's state, from `get-brief-grounding`'s `current` flag alone. */
export function groundingBadgeState(
  grounding: { current: boolean } | null,
): "absent" | "current" | "stale" {
  if (!grounding) return "absent";
  return grounding.current ? "current" : "stale";
}

/** Every reason the "Ground the briefs" button can be disabled for, in the order they are checked. */
export type GroundBriefsDisabledCode =
  | "turn-working"
  | "no-project"
  | "no-handoff"
  | "handoff-stale"
  | "too-many-tickets"
  | "too-many-blockers"
  | null;

/**
 * Which refusal, if any, this component can already see coming — the same
 * order `ground-briefs` itself checks in (`actions/ground-briefs.ts`):
 * turn-working, no-project, handoff-missing, handoff-stale, then the two
 * caps. Pure and data-only, so it is cheap to test without rendering
 * anything or mocking a query.
 */
export function groundBriefsDisabledCode(input: {
  working: boolean;
  hasProject: boolean;
  hasHandoff: boolean;
  handoffStale: boolean;
  tooManyTickets: boolean;
  tooManyBlockers: boolean;
}): GroundBriefsDisabledCode {
  if (input.working) return "turn-working";
  if (!input.hasProject) return "no-project";
  if (!input.hasHandoff) return "no-handoff";
  if (input.handoffStale) return "handoff-stale";
  if (input.tooManyTickets) return "too-many-tickets";
  if (input.tooManyBlockers) return "too-many-blockers";
  return null;
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
  onSettled,
}: {
  sessionId: string;
  /** The project this session exports into, or null when it has none. */
  projectId: string | null;
  /** Whether the session's stored turn is currently running, of any kind. */
  working: boolean;
  /** The turn the session's current turn status belongs to, of any kind. */
  activeTurn: Turn | null;
  /** Called once the `ground-briefs` mutation settles, success or failure, so the route can refresh every query. */
  onSettled: () => void;
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
    // Success already invalidates every `["action"]` query on its own
    // (`useActionMutation`'s built-in behaviour), but that only runs in
    // `onSuccess`. A failed grounding stores no row, so nothing else refreshes
    // `get-active-turn`/`get-session` here — without this, the attempt log can
    // stay on a running turn that has actually already failed.
    onSettled,
  });

  const tooManyTickets = tickets.length > MAX_HANDOFF_SCOUT_TICKETS;
  const tooManyBlockers = tickets.some(
    (ticket) => ticket.blockedBy.length > MAX_HANDOFF_SCOUT_BUILDS_ON,
  );

  const disabledCode = groundBriefsDisabledCode({
    working,
    hasProject: projectId !== null,
    hasHandoff: handoff !== null,
    handoffStale: handoff?.stale ?? false,
    tooManyTickets,
    tooManyBlockers,
  });

  const DISABLED_REASON_KEY: Record<Exclude<GroundBriefsDisabledCode, null>, string> = {
    "turn-working": "output.groundBriefsTurnWorking",
    "no-project": "output.groundBriefsNeedsProject",
    "no-handoff": "output.groundBriefsNeedsHandoff",
    "handoff-stale": "output.groundBriefsHandoffStale",
    "too-many-tickets": "output.groundBriefsTooManyTickets",
    "too-many-blockers": "output.groundBriefsTooManyBlockers",
  };
  const disabledReason =
    disabledCode === null
      ? null
      : disabledCode === "too-many-tickets"
        ? t(DISABLED_REASON_KEY[disabledCode], { max: MAX_HANDOFF_SCOUT_TICKETS })
        : disabledCode === "too-many-blockers"
          ? t(DISABLED_REASON_KEY[disabledCode], { max: MAX_HANDOFF_SCOUT_BUILDS_ON })
          : t(DISABLED_REASON_KEY[disabledCode]);

  const busy = working || groundBriefs.isPending;
  const canGround = disabledCode === null && !busy;

  function run() {
    setRefusal(null);
    groundBriefs.mutate({ sessionId });
  }

  const groundingState = groundingBadgeState(grounding);
  const sha = shortSha(grounding?.commitRead ?? null);
  const at = sha
    ? t("output.groundingAtCommit", { sha })
    : t("output.groundingBeforeFirstCommit");
  const groundingLabel =
    groundingState === "absent"
      ? t("output.groundingAbsent")
      : groundingState === "current"
        ? t("output.groundingCurrent", { at })
        : grounding!.staleReason === "head-moved"
          ? t("output.groundingStaleHeadMoved", { at })
          : t("output.groundingStaleHandoffChanged", { at });

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
