import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { ProjectsSection } from "@/components/projects/projects-section";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Projects - ${APP_TITLE}` }];
}

export default function ProjectsRoute() {
  const t = useT();
  useSetPageTitle(t("projects.heading"));

  return (
    <div className="w-full max-w-3xl p-6">
      <ProjectsSection />
    </div>
  );
}
