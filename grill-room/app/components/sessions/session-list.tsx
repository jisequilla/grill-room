import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { Link } from "react-router";

import { DeleteSessionAlert } from "@/components/sessions/delete-session-alert";
import {
  ReadinessBadge,
  type ReadinessVerdict,
} from "@/components/sessions/readiness-badge";
import { SessionStateBadge } from "@/components/sessions/session-state-badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatRelativeTimestamp } from "@/lib/relative-time";

import type { SessionState } from "@shared/session-constants";

interface SessionListItem {
  id: string;
  title: string;
  state: SessionState;
  updatedAt: string;
  /** The current idea's readiness verdict; null when it has not been judged. */
  readinessVerdict: ReadinessVerdict | null;
  /** The registered project the session exports into; null when unassigned. */
  projectId: string | null;
}

const FILTER_ALL = "all";
const FILTER_UNASSIGNED = "unassigned";

/** The sessions a filter value keeps: everything, the unassigned, or one project's. */
export function filterSessions<T extends { projectId: string | null }>(
  sessions: T[],
  filter: string,
): T[] {
  if (filter === FILTER_ALL) return sessions;
  if (filter === FILTER_UNASSIGNED) {
    return sessions.filter((session) => session.projectId === null);
  }
  return sessions.filter((session) => session.projectId === filter);
}

/** The filter to apply: a selected project that is no longer loaded falls back to All. */
export function effectiveFilter(filter: string, projectIds: string[]): string {
  if (filter === FILTER_ALL || filter === FILTER_UNASSIGNED) return filter;
  return projectIds.includes(filter) ? filter : FILTER_ALL;
}

/** Radix emits an empty value when the active item is clicked again; the filter stays. */
export function nextFilter(current: string, emitted: string): string {
  return emitted === "" ? current : emitted;
}

export function SessionList({
  sessions,
  hideProject = false,
}: {
  sessions: SessionListItem[];
  /** Leave out the project filter and column, for a list already scoped to one project. */
  hideProject?: boolean;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { data: projects } = useActionQuery("list-projects", {});
  const [selectedFilter, setSelectedFilter] = useState(FILTER_ALL);

  const loadedProjects = projects ?? [];
  const projectNames = new Map(
    loadedProjects.map((project) => [project.id, project.name]),
  );
  const showFilter = !hideProject && loadedProjects.length > 0;
  const filter = showFilter
    ? effectiveFilter(
        selectedFilter,
        loadedProjects.map((project) => project.id),
      )
    : FILTER_ALL;
  const visible = filterSessions(sessions, filter);

  return (
    <div className="space-y-3">
      {showFilter ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(value) =>
            setSelectedFilter(nextFilter(filter, value))
          }
          className="flex-wrap justify-start"
          data-testid="session-project-filter"
        >
          <ToggleGroupItem
            value={FILTER_ALL}
            className="px-2.5 text-xs"
            data-testid="session-project-filter-all"
          >
            {t("projects.filterAll")}
          </ToggleGroupItem>
          {loadedProjects.map((project) => (
            <ToggleGroupItem
              key={project.id}
              value={project.id}
              className="px-2.5 text-xs"
              data-testid={`session-project-filter-${project.id}`}
            >
              {project.name}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem
            value={FILTER_UNASSIGNED}
            className="px-2.5 text-xs"
            data-testid="session-project-filter-unassigned"
          >
            {t("projects.filterUnassigned")}
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {sessions.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("projects.filterEmpty")}
        </p>
      ) : null}
      {/* A row's own padding lets its hover reach past the text; the negative
          margin puts the text back on the page's left edge, where the header's
          title sits. */}
      <ul className="-mx-2 divide-y divide-border">
        {visible.map((session) => {
          const projectName =
            hideProject || session.projectId === null
              ? undefined
              : projectNames.get(session.projectId);
          return (
            <li key={session.id} className="flex items-center gap-2">
              <Link
                to={`/sessions/${session.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {session.title}
                </span>
                {projectName ? (
                  <span
                    className="hidden max-w-[10rem] shrink-0 truncate font-mono text-xs text-muted-foreground sm:block"
                    data-testid="session-project"
                  >
                    {projectName}
                  </span>
                ) : null}
                {session.readinessVerdict ? (
                  <ReadinessBadge
                    verdict={session.readinessVerdict}
                    testId="session-readiness-badge"
                  />
                ) : null}
                <SessionStateBadge state={session.state} />
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                  {formatRelativeTimestamp(formatters, session.updatedAt)}
                </span>
              </Link>
              <DeleteSessionAlert sessionId={session.id} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
