import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function SessionOutputRoute() {
  const t = useT();
  const { sessionId } = useParams();
  useSetPageTitle(t("pages.sessionOutputTitle"));

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <p className="text-sm text-muted-foreground">{sessionId}</p>
    </div>
  );
}
