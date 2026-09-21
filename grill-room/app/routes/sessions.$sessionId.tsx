import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function SessionWorkspaceRoute() {
  const t = useT();
  const { sessionId } = useParams();
  useSetPageTitle(t("pages.sessionWorkspaceTitle"));

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">{sessionId}</p>
    </div>
  );
}
