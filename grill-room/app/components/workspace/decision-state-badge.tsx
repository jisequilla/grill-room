import { useT } from "@agent-native/core/client/i18n";

import { DECISION_STATE_LABEL_KEY, type DecisionState } from "@/lib/decisions";
import { cn } from "@/lib/utils";

/**
 * A state's colour, on a canvas that is otherwise entirely neutral. Settled is
 * the only calm one; stale and the loose ends are meant to catch the eye,
 * because they are what the session still owes.
 */
const CLASS_BY_STATE: Record<DecisionState, string> = {
  settled:
    "border-settled/25 bg-settled/10 text-settled",
  frontier:
    "border-frontier/30 bg-frontier/10 text-frontier",
  blocked: "border-border bg-muted text-muted-foreground",
  stale:
    "border-owed/30 bg-owed/15 text-owed",
  withdrawn: "border-border bg-transparent text-muted-foreground/70",
  unplaced:
    "border-unplaced/25 bg-unplaced/10 text-unplaced",
};

export function DecisionStateBadge({
  state,
  className,
}: {
  state: DecisionState;
  className?: string;
}) {
  const t = useT();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-xs leading-4 font-medium tracking-wide uppercase",
        CLASS_BY_STATE[state],
        className,
      )}
    >
      {t(DECISION_STATE_LABEL_KEY[state])}
    </span>
  );
}

/** The loose-end marker: an answer was given, but it left the decision open. */
export function LooseEndBadge({ className }: { className?: string }) {
  const t = useT();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-owed/30 bg-owed/15 px-1.5 py-px text-xs leading-4 font-medium tracking-wide text-owed uppercase",
        className,
      )}
    >
      {t("workspace.looseEnd")}
    </span>
  );
}
