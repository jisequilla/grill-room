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
    "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  frontier:
    "border-sky-600/30 bg-sky-600/10 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300",
  blocked: "border-border bg-muted text-muted-foreground",
  stale:
    "border-amber-600/30 bg-amber-500/15 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  withdrawn: "border-border bg-transparent text-muted-foreground/70",
  unplaced:
    "border-violet-600/25 bg-violet-600/10 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-300",
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
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium tracking-wide uppercase",
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
        "inline-flex shrink-0 items-center rounded-full border border-orange-600/30 bg-orange-500/15 px-1.5 py-px text-[10px] leading-4 font-medium tracking-wide text-orange-700 uppercase dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300",
        className,
      )}
    >
      {t("workspace.looseEnd")}
    </span>
  );
}
