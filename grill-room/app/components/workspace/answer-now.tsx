import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPencilCheck } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * Gives a loose end a real answer, outside a round and without the
 * interviewer. Opened from the decision sheet and from the list of loose ends
 * that blocks confirmation, so the two places offer the same one flow.
 */
export function AnswerNow({ decisionId }: { decisionId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const { mutate, isPending } = useActionMutation("answer-decision", {
    onSuccess: () => {
      setOpen(false);
      setText("");
    },
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.answerFailed"));
    },
  });

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <IconPencilCheck className="size-4" />
        {t("workspace.answerNow")}
      </Button>
    );
  }

  const fieldId = `answer-now-${decisionId}`;

  return (
    <div className="w-full space-y-2 rounded-lg border bg-muted/30 p-3">
      <Label htmlFor={fieldId} className="text-xs">
        {t("workspace.answerNowTitle")}
      </Label>
      <Textarea
        id={fieldId}
        value={text}
        rows={3}
        autoFocus
        placeholder={t("workspace.ownAnswerPlaceholder")}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {t("workspace.answerNowDescription")}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          {t("workspace.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isPending || text.trim().length === 0}
          onClick={() => mutate({ decisionId, answer: text.trim() })}
        >
          {isPending && <Spinner className="size-4" />}
          {t("workspace.save")}
        </Button>
      </div>
    </div>
  );
}
