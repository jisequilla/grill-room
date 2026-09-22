import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetHeaderActions, useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { CreateSessionDialog } from "@/components/sessions/create-session-dialog";
import { SessionList } from "@/components/sessions/session-list";
import { SessionListSkeleton } from "@/components/sessions/session-list-skeleton";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function SessionListRoute() {
  const t = useT();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  useSetPageTitle(t("pages.sessionsTitle"));

  const { data: sessions, isLoading } = useActionQuery("list-sessions", {});
  const { data: defaultModelData } = useActionQuery("get-default-model", {});

  useSetHeaderActions(
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <IconPlus className="size-4" />
      {t("sessions.newSession")}
    </Button>,
  );

  return (
    <div className="w-full max-w-3xl p-6">
      {isLoading ? (
        <SessionListSkeleton />
      ) : sessions && sessions.length > 0 ? (
        <SessionList sessions={sessions} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("pages.sessionsEmpty")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>
              <IconPlus className="size-4" />
              {t("sessions.emptyAction")}
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <CreateSessionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultModel={defaultModelData?.model}
        onCreated={(sessionId) => navigate(`/sessions/${sessionId}`)}
      />
    </div>
  );
}
