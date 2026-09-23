import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_PROJECT } from "@/lib/projects";

interface ProjectSelectProps {
  id: string;
  /** The chosen project id, or null for none. */
  value: string | null;
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/** Choose one registered project, or none. */
export function ProjectSelect({
  id,
  value,
  onChange,
  disabled,
  "aria-describedby": describedBy,
}: ProjectSelectProps) {
  const t = useT();
  const { data: projects } = useActionQuery("list-projects", {});

  return (
    <Select
      value={value ?? NO_PROJECT}
      onValueChange={(next) => onChange(next === NO_PROJECT ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-describedby={describedBy} data-testid={`${id}-trigger`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROJECT}>{t("projects.selectNone")}</SelectItem>
        {(projects ?? []).map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
