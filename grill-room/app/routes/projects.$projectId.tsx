import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { SessionList, filterSessions } from "@/components/sessions/session-list";
import { SessionListSkeleton } from "@/components/sessions/session-list-skeleton";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_TITLE } from "@/lib/app-config";
import { actionErrorCode } from "@/lib/decisions";
import {
  DELIVERY_RECIPE_LABEL_KEY,
  TRACKER_KIND_LABEL_KEY,
  VISIBILITY_LABEL_KEY,
  type Project,
} from "@/lib/projects";

import type {
  DeliveryRecipe,
  ProjectTrackerKind,
  ProjectVisibility,
} from "@shared/session-constants";

export function meta() {
  return [{ title: `Project - ${APP_TITLE}` }];
}

export default function ProjectRoute() {
  const t = useT();
  const { projectId } = useParams();
  const id = projectId ?? "";
  const [editOpen, setEditOpen] = useState(false);

  const {
    data: project,
    isLoading,
    error,
  } = useActionQuery("get-project", { id }, { enabled: id.length > 0 });

  useSetPageTitle(project?.name ?? t("projects.heading"));

  if (isLoading) {
    return (
      <div className="w-full max-w-3xl space-y-3 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  if (error || !project) {
    const notFound = actionErrorCode(error) === "project-not-found";
    return (
      <div className="w-full max-w-3xl p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {notFound ? t("projects.notFound") : t("projects.loadFailed")}
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/projects">{t("projects.backToProjects")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl p-6">
      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sessions" data-testid="project-tab-sessions">
            {t("projects.tabSessions")}
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="project-tab-settings">
            {t("projects.tabSettings")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <ProjectSessions projectId={project.id} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <ProjectFields project={project} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            data-testid="project-page-edit"
          >
            {t("projects.edit")}
          </Button>
          <ProjectFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            project={project}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectSessions({ projectId }: { projectId: string }) {
  const t = useT();
  const { data: sessions, isLoading } = useActionQuery("list-sessions", {});

  if (isLoading) return <SessionListSkeleton />;

  const inProject = filterSessions(sessions ?? [], projectId);
  if (inProject.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("projects.noSessions")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return <SessionList sessions={inProject} hideProject />;
}

function ProjectFields({ project }: { project: Project }) {
  const t = useT();
  const fields: { label: string; value: string; mono?: boolean }[] = [
    { label: t("projects.nameLabel"), value: project.name },
    { label: t("projects.rootLabel"), value: project.rootPath, mono: true },
    {
      label: t("projects.workingExportFolderLabel"),
      value: project.workingExportFolder,
      mono: true,
    },
    {
      label: t("projects.verifyCommandLabel"),
      value: project.verifyCommand,
      mono: true,
    },
    {
      label: t("projects.trackerKindLabel"),
      value: t(TRACKER_KIND_LABEL_KEY[project.trackerKind as ProjectTrackerKind]),
    },
    {
      label: t("projects.visibilityLabel"),
      value: t(VISIBILITY_LABEL_KEY[project.visibility as ProjectVisibility]),
    },
    {
      label: t("projects.deliveryRecipeLabel"),
      value: t(
        DELIVERY_RECIPE_LABEL_KEY[project.deliveryRecipe as DeliveryRecipe],
      ),
    },
    {
      label: t("projects.adversarialReviewLabel"),
      value: project.adversarialReview ? t("projects.yes") : t("projects.no"),
    },
    {
      label: t("projects.maxTicketsInFlightLabel"),
      value: String(project.maxTicketsInFlight),
    },
  ];

  return (
    <dl className="divide-y rounded-xl border bg-card">
      {fields.map((field) => (
        <div
          key={field.label}
          className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:gap-4"
        >
          <dt className="w-48 shrink-0 text-xs text-muted-foreground">
            {field.label}
          </dt>
          <dd
            className={
              field.mono
                ? "min-w-0 break-all font-mono text-xs"
                : "min-w-0 text-sm"
            }
          >
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
