import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";

import {
  HEADLINE_KEY_BY_CODE,
  HINT_KEY_BY_CODE,
} from "@/components/workspace/turn-panels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useElapsed } from "@/lib/use-elapsed";

import type { SessionTurnStatus } from "@shared/session-constants";

/**
 * The session's stored turn status, shown once above every output section
 * rather than per-section: `synthesize-spec` and `break-into-tickets` share
 * the same `turnStatus`/`turnStartedAt`/`turnErrorCode` columns on the
 * session row (only one turn can run at a time), so this is the truth for
 * both the spec and the tickets sections at once. Sections disable their own
 * actions while `working` and read the failure straight off the same props
 * rather than duplicating this display.
 */
export function TurnStatusBanner({
  turnStatus,
  turnStartedAt,
  turnError,
}: {
  turnStatus: SessionTurnStatus;
  turnStartedAt: string | null;
  turnError: { code: string; message: string } | null;
}) {
  const t = useT();
  const elapsed = useElapsed(turnStatus === "working" ? turnStartedAt : null);

  if (turnStatus === "working") {
    return (
      <div
        className="flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
        data-testid="output-turn-working"
      >
        <Spinner className="size-4" />
        <span aria-live="polite">{t("output.turnWorking", { elapsed })}</span>
      </div>
    );
  }

  if (turnStatus === "failed" && turnError) {
    const isRateLimit = turnError.code === "rate-limited";
    const headline = t(
      HEADLINE_KEY_BY_CODE[turnError.code] ?? "workspace.errorGeneric",
    );
    const hintKey = HINT_KEY_BY_CODE[turnError.code];

    return (
      <Alert
        variant={isRateLimit ? "default" : "destructive"}
        data-testid="output-turn-failed"
        data-error-code={turnError.code}
      >
        <IconAlertTriangle className="size-4" />
        <AlertTitle>{headline}</AlertTitle>
        {hintKey ? <AlertDescription>{t(hintKey)}</AlertDescription> : null}
      </Alert>
    );
  }

  return null;
}
