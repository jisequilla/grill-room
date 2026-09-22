import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArchive } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { DecisionDispositionTarget } from "@shared/session-constants";

const TARGETS: readonly {
  value: DecisionDispositionTarget;
  labelKey: string;
  hintKey: string;
}[] = [
  {
    value: "out-of-scope",
    labelKey: "workspace.targetOutOfScope",
    hintKey: "workspace.targetOutOfScopeHint",
  },
  {
    value: "open-question",
    labelKey: "workspace.targetOpenQuestion",
    hintKey: "workspace.targetOpenQuestionHint",
  },
];

/**
 * Resolves a loose end without answering it: the decision leaves the tree's
 * open business either as something the spec says it does not cover, or as a
 * named open question the spec carries in its notes. Which of the two it is
 * changes where it ends up, so the choice is the dialog rather than a default.
 */
export function SetAsideDialog({
  decisionId,
  questionTitle,
}: {
  decisionId: string;
  questionTitle: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<DecisionDispositionTarget | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setNote("");
  }, [open]);

  const { mutate, isPending } = useActionMutation("disposition-decision", {
    onSuccess: () => setOpen(false),
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.setAsideFailed"));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target || isPending) return;
    mutate({ decisionId, target, note: note.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <IconArchive className="size-4" />
          {t("workspace.setAside")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workspace.setAsideTitle")}</DialogTitle>
          <DialogDescription>{questionTitle}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="pb-2 text-xs font-medium">
              {t("workspace.setAsideWhere")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TARGETS.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={target === choice.value}
                  onClick={() => setTarget(choice.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    target === choice.value &&
                      "border-foreground/40 bg-accent shadow-xs",
                  )}
                >
                  <span className="block text-sm font-medium">
                    {t(choice.labelKey)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(choice.hintKey)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={`set-aside-note-${decisionId}`} className="text-xs">
              {t("workspace.setAsideNoteLabel")}
            </Label>
            <Textarea
              id={`set-aside-note-${decisionId}`}
              value={note}
              rows={3}
              placeholder={t("workspace.setAsideNotePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("workspace.cancel")}
            </Button>
            <Button type="submit" disabled={target === null || isPending}>
              {isPending && <Spinner className="size-4" />}
              {t(isPending ? "workspace.settingAside" : "workspace.setAside")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
