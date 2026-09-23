import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TRACKER_KIND_LABEL_KEY,
  VISIBILITY_LABEL_KEY,
  type Project,
} from "@/lib/projects";

import type { ProjectTrackerKind, ProjectVisibility } from "@shared/session-constants";

import { ProjectFormDialog } from "./project-form-dialog";

/** The project registry on the settings page: every registered repository, with add and edit. */
export function ProjectsSection() {
  const t = useT();
  const { data: projects, isLoading } = useActionQuery("list-projects", {});
  const [editing, setEditing] = useState<Project | null>(null);
  const [open, setOpen] = useState(false);

  function openForm(project: Project | null) {
    setEditing(project);
    setOpen(true);
  }

  return (
    <section id="projects" className="space-y-3" data-testid="projects-section">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{t("projects.heading")}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{t("projects.description")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => openForm(null)}>
          <IconPlus className="size-4" />
          {t("projects.add")}
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : !projects || projects.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm font-medium">{t("projects.empty")}</p>
            <p className="text-xs text-muted-foreground">{t("projects.emptyDescription")}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex items-start justify-between gap-4 px-5 py-3.5"
                data-testid="project-row"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {project.rootPath}/{project.exportFolder}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="font-mono">
                      {project.verifyCommand}
                    </Badge>
                    <Badge variant="outline">
                      {t(TRACKER_KIND_LABEL_KEY[project.trackerKind as ProjectTrackerKind])}
                    </Badge>
                    <Badge variant="outline">
                      {t(VISIBILITY_LABEL_KEY[project.visibility as ProjectVisibility])}
                    </Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openForm(project)}
                >
                  {t("projects.edit")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectFormDialog open={open} onOpenChange={setOpen} project={editing} />
    </section>
  );
}
