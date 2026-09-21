import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconHourglassHigh,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Elapsed time as `1:07`, ticking once a second. */
function useElapsed(since: string | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  if (!since) return "0:00";
  const startedAt = new Date(since).getTime();
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h3 className="text-base font-medium">{title}</h3>
      {children}
    </div>
  );
}

export function StartInterviewPanel({
  onStart,
  isPending,
}: {
  onStart: () => void;
  isPending: boolean;
}) {
  const t = useT();

  return (
    <Panel
      icon={<IconPlayerPlay className="size-6" />}
      title={t("workspace.startTitle")}
    >
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("workspace.startDescription")}
      </p>
      <Button onClick={onStart} disabled={isPending} className="mt-1">
        {isPending && <Spinner className="size-4" />}
        {t("workspace.startAction")}
      </Button>
    </Panel>
  );
}

export function NextRoundPanel({
  onRequest,
  isPending,
}: {
  onRequest: () => void;
  isPending: boolean;
}) {
  const t = useT();

  return (
    <Panel
      icon={<IconRefresh className="size-6" />}
      title={t("workspace.nextRoundTitle")}
    >
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("workspace.nextRoundDescription")}
      </p>
      <Button onClick={onRequest} disabled={isPending} className="mt-1">
        {isPending && <Spinner className="size-4" />}
        {t("workspace.nextRoundAction")}
      </Button>
    </Panel>
  );
}

export function TurnWorkingPanel({ startedAt }: { startedAt: string | null }) {
  const t = useT();
  const elapsed = useElapsed(startedAt);

  return (
    <Panel
      icon={<IconHourglassHigh className="size-6 animate-pulse" />}
      title={t("workspace.workingTitle")}
    >
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("workspace.workingDescription")}
      </p>
      <p
        className="font-mono text-sm tabular-nums"
        aria-live="polite"
        data-testid="turn-elapsed"
      >
        {t("workspace.workingElapsed", { elapsed })}
      </p>
    </Panel>
  );
}

/**
 * What the user is told about each failure. A rate limit is the shared
 * subscription running out, not a defect, and the two setup failures are the
 * user's machine rather than the app; each says so in its own words instead of
 * leaving the interviewer's message to carry it.
 */
const HEADLINE_KEY_BY_CODE: Record<string, string> = {
  "rate-limited": "workspace.errorRateLimited",
  "cli-missing": "workspace.errorCliMissing",
  "not-logged-in": "workspace.errorNotLoggedIn",
  "malformed-output": "workspace.errorMalformed",
};

const HINT_KEY_BY_CODE: Record<string, string> = {
  "rate-limited": "workspace.errorRateLimitedHint",
  "cli-missing": "workspace.errorCliMissingHint",
  "not-logged-in": "workspace.errorNotLoggedInHint",
};

export function TurnFailedPanel({
  error,
  onRetry,
  isPending,
}: {
  error: { code: string; message: string } | null;
  onRetry: () => void;
  isPending: boolean;
}) {
  const t = useT();
  const code = error?.code ?? "failed";
  const isRateLimit = code === "rate-limited";
  const headline = t(HEADLINE_KEY_BY_CODE[code] ?? "workspace.errorGeneric");
  const hintKey = HINT_KEY_BY_CODE[code];

  return (
    <div
      className={
        isRateLimit
          ? "rounded-xl border border-amber-600/30 bg-amber-500/10 px-6 py-8 dark:border-amber-400/25 dark:bg-amber-400/5"
          : "rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8"
      }
      data-testid="turn-failed"
      data-error-code={code}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <IconAlertTriangle
          className={
            isRateLimit
              ? "size-6 text-amber-600 dark:text-amber-400"
              : "size-6 text-destructive"
          }
        />
        <h3 className="text-base font-medium">{headline}</h3>
        {hintKey ? (
          <p className="max-w-md text-sm text-muted-foreground">{t(hintKey)}</p>
        ) : null}
        {error?.message && error.message !== headline ? (
          <p className="max-w-md font-mono text-xs break-words text-muted-foreground">
            {error.message}
          </p>
        ) : null}
        <Button
          variant={isRateLimit ? "outline" : "default"}
          onClick={onRetry}
          disabled={isPending}
          className="mt-1"
        >
          {isPending && <Spinner className="size-4" />}
          {t(isPending ? "workspace.retrying" : "workspace.retry")}
        </Button>
      </div>
    </div>
  );
}
