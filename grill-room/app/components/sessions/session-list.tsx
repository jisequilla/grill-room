import { useFormatters } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { DeleteSessionAlert } from "@/components/sessions/delete-session-alert";
import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { formatRelativeTimestamp } from "@/lib/relative-time";

import type { SessionState } from "@shared/session-constants";

interface SessionListItem {
  id: string;
  title: string;
  state: SessionState;
  updatedAt: string;
}

export function SessionList({ sessions }: { sessions: SessionListItem[] }) {
  const formatters = useFormatters();

  return (
    <ul className="divide-y divide-border">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center gap-2">
          <Link
            to={`/sessions/${session.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {session.title}
            </span>
            <SessionStateBadge state={session.state} />
            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
              {formatRelativeTimestamp(formatters, session.updatedAt)}
            </span>
          </Link>
          <DeleteSessionAlert sessionId={session.id} />
        </li>
      ))}
    </ul>
  );
}
