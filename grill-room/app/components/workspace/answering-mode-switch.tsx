import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { toast } from "sonner";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ANSWERING_MODE_LABEL_KEY } from "@/lib/session-labels";

import {
  SESSION_ANSWERING_MODES,
  type SessionAnsweringMode,
} from "@shared/session-constants";

/**
 * Switch a session's answering mode, ignoring a pick of the mode it already
 * has or one made while the last switch is still saving. Shared by the header
 * switch and the overflow menu's radio items, so both write the same way.
 */
export function useSetAnsweringMode(
  sessionId: string,
  answeringMode: SessionAnsweringMode,
) {
  const t = useT();
  const { mutate, isPending } = useActionMutation(
    "set-session-answering-mode",
    {
      onError: (error: unknown) => {
        toast.error(actionErrorMessage(error) ?? t("workspace.draftFailed"));
      },
    },
  );

  return (value: string) => {
    if (!value || value === answeringMode || isPending) return;
    mutate({ id: sessionId, answeringMode: value as SessionAnsweringMode });
  };
}

/**
 * Whole round or one question at a time. The switch takes effect on the next
 * round the interviewer opens; the round already on screen is untouched.
 */
export function AnsweringModeSwitch({
  sessionId,
  answeringMode,
}: {
  sessionId: string;
  answeringMode: SessionAnsweringMode;
}) {
  const t = useT();
  const setAnsweringMode = useSetAnsweringMode(sessionId, answeringMode);

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={answeringMode}
      aria-label={t("workspace.answeringMode")}
      onValueChange={setAnsweringMode}
    >
      {SESSION_ANSWERING_MODES.map((value) => (
        <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs">
          {t(ANSWERING_MODE_LABEL_KEY[value])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
