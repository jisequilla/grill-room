import { useT } from "@agent-native/core/client/i18n";
import { IconArrowLeft, IconLock } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

/**
 * The output surface only exists for a confirmed session: a spec is
 * synthesized from settled decisions, and nothing is settled until the user
 * says so. Shown for `interviewing` and `done-proposed` alike — the session
 * may have never been confirmed, or may have returned to interviewing after a
 * reopen.
 */
export function NotConfirmedNotice({ sessionId }: { sessionId: string }) {
  const t = useT();

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="text-muted-foreground">
        <IconLock className="size-6" />
      </div>
      <h3 className="text-base font-medium">{t("output.notConfirmedTitle")}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("output.notConfirmedDescription")}
      </p>
      <Button asChild variant="outline" className="mt-1">
        <Link to={`/sessions/${sessionId}`}>
          <IconArrowLeft className="size-4" />
          {t("output.backToWorkspace")}
        </Link>
      </Button>
    </div>
  );
}
