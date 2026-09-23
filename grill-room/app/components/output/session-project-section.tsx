import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { toast } from "sonner";

import { ProjectSelect } from "@/components/projects/project-select";
import { Label } from "@/components/ui/label";

/** Which registered project this session exports into, changeable at any time. */
export function SessionProjectSection({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string | null;
}) {
  const t = useT();
  const setProject = useActionMutation("set-session-project", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("projects.sessionProjectSaveFailed"));
    },
  });

  return (
    <section className="space-y-2" data-testid="output-project-section">
      <Label htmlFor="output-project">{t("projects.selectLabel")}</Label>
      <div className="max-w-sm">
        <ProjectSelect
          id="output-project"
          value={setProject.isPending ? (setProject.variables?.projectId ?? null) : projectId}
          onChange={(next) => setProject.mutate({ sessionId, projectId: next })}
          disabled={setProject.isPending}
          aria-describedby="output-project-hint"
        />
      </div>
      <p id="output-project-hint" className="text-xs text-muted-foreground">
        {t("projects.selectHint")}
      </p>
    </section>
  );
}
