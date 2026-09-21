import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODEL_LABEL_KEY } from "@/lib/session-labels";

import { SESSION_MODELS, type SessionModel } from "@shared/session-constants";

/** The global default model new sessions pre-fill their model picker with. */
export function DefaultModelPicker() {
  const t = useT();
  const { data } = useActionQuery("get-default-model", {});
  const { mutate } = useActionMutation("set-default-model", {
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("settings.defaultModelUpdateFailed"),
      );
    },
  });

  return (
    <Select
      value={data?.model ?? "fable"}
      onValueChange={(value) => mutate({ model: value as SessionModel })}
    >
      <SelectTrigger aria-label={t("settings.defaultModelTitle")}>
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
  );
}
