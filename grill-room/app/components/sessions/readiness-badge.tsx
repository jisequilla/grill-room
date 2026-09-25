import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ReadinessVerdict = "ready" | "not-ready";

/**
 * Whether the session's current idea was judged ready to grill. A warning,
 * never a gate: a not-ready idea can still be interviewed.
 */
export function ReadinessBadge({
  verdict,
  testId,
  className,
}: {
  verdict: ReadinessVerdict;
  testId: string;
  className?: string;
}) {
  const t = useT();
  const ready = verdict === "ready";

  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-verdict={verdict}
      className={cn(
        "shrink-0 gap-1",
        ready
          ? "border-settled/40 text-settled"
          : "border-owed/40 text-owed",
        className,
      )}
    >
      {ready ? (
        <IconCircleCheck className="size-3" />
      ) : (
        <IconAlertTriangle className="size-3" />
      )}
      {t(ready ? "sessions.readinessReady" : "sessions.readinessNotReady")}
    </Badge>
  );
}
