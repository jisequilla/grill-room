import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useParams } from "react-router";

import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { MODEL_LABEL_KEY } from "@/lib/session-labels";

import type { SessionModel } from "@shared/session-constants";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function SessionWorkspaceRoute() {
  const t = useT();
  const { sessionId } = useParams();
  const { data: session, isLoading } = useActionQuery(
    "get-session",
    { id: sessionId ?? "" },
    { enabled: Boolean(sessionId) },
  );

  useSetPageTitle(session?.title ?? t("pages.sessionWorkspaceTitle"));

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      {isLoading ? (
        <Skeleton className="h-6 w-48" />
      ) : session ? (
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{session.title}</h2>
          <SessionStateBadge state={session.state} />
          <span className="text-sm text-muted-foreground">
            {t(MODEL_LABEL_KEY[session.model as SessionModel])}
          </span>
        </div>
      ) : null}
    </div>
  );
}
