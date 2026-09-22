import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actionErrorCode, actionErrorDetails } from "@/lib/decisions";
import { MODEL_LABEL_KEY } from "@/lib/session-labels";

import { SESSION_MODELS, type SessionModel } from "@shared/session-constants";

/**
 * The session header's model label: a select over the supported models while
 * the session is changeable, and the same static text it always rendered once
 * the interviewer conversation exists or a turn is working. The lock rule
 * itself lives only on the server (`isModelLocked`); this component reads the
 * derived `modelLocked` flag rather than reconstructing it.
 */
export function SessionModelControl({
  sessionId,
  model,
  modelLocked,
  onChanged,
}: {
  sessionId: string;
  model: SessionModel;
  modelLocked: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { mutate, isPending } = useActionMutation("set-session-model", {
    onSuccess: () => {
      setErrorMessage(null);
      onChanged();
    },
    onError: (error: unknown) => {
      const code = actionErrorCode(error);
      if (code === "model-locked") {
        const details = actionErrorDetails(error);
        const recordedModel = details?.recordedModel as SessionModel | undefined;
        // A 28 ms-lived inline message is unreadable: a stale tab just
        // learned the session locked underneath it, so this is a toast, and
        // the header drops straight to the same static text a fresh load
        // would show rather than holding an inline message no one can read.
        toast.error(
          t("workspace.modelLockedError", {
            model: recordedModel
              ? t(MODEL_LABEL_KEY[recordedModel])
              : t(MODEL_LABEL_KEY[model]),
          }),
        );
        onChanged();
        return;
      }
      setErrorMessage(
        actionErrorMessage(error) ?? t("workspace.modelChangeFailed"),
      );
    },
  });

  if (modelLocked) {
    return (
      <span
        className="text-sm text-muted-foreground"
        data-testid="session-model-static"
      >
        {t(MODEL_LABEL_KEY[model])}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={model}
        disabled={isPending}
        onValueChange={(value) => {
          if (value === model || isPending) return;
          setErrorMessage(null);
          mutate({ sessionId, model: value as SessionModel });
        }}
      >
        <SelectTrigger
          className="h-7 w-auto gap-1 border-none bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:bg-accent focus:ring-1 focus:ring-ring focus:ring-offset-0"
          aria-label={t("workspace.modelSelectLabel")}
          data-testid="session-model-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SESSION_MODELS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(MODEL_LABEL_KEY[value])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMessage ? (
        <span
          className="text-xs text-destructive"
          data-testid="session-model-error"
        >
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
