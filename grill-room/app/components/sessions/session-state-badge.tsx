import { useT } from "@agent-native/core/client/i18n";

import { Badge } from "@/components/ui/badge";

import type { SessionState } from "@shared/session-constants";

const VARIANT_BY_STATE: Record<
  SessionState,
  "secondary" | "default" | "outline"
> = {
  interviewing: "secondary",
  "done-proposed": "default",
  confirmed: "outline",
};

const LABEL_KEY_BY_STATE: Record<SessionState, string> = {
  interviewing: "sessions.stateInterviewing",
  "done-proposed": "sessions.stateDoneProposed",
  confirmed: "sessions.stateConfirmed",
};

export function SessionStateBadge({ state }: { state: SessionState }) {
  const t = useT();

  return (
    <Badge variant={VARIANT_BY_STATE[state]} className="shrink-0">
      {t(LABEL_KEY_BY_STATE[state])}
    </Badge>
  );
}
