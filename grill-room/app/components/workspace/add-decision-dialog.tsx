import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** A decision the interviewer never asked about, added by the user. */
export function AddDecisionDialog({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
  }, [open]);

  const { mutate, isPending } = useActionMutation("add-decision", {
    onSuccess: () => setOpen(false),
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.addFailed"));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0 || isPending) return;
    mutate({ sessionId, title: title.trim(), body: body.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconPlus className="size-4" />
          {t("workspace.addDecision")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workspace.addDecision")}</DialogTitle>
          <DialogDescription>
            {t("workspace.addDecisionDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-decision-title">
              {t("workspace.addDecisionTitleLabel")}
            </Label>
            <Input
              id="add-decision-title"
              value={title}
              autoFocus
              placeholder={t("workspace.addDecisionTitlePlaceholder")}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-decision-body">
              {t("workspace.addDecisionBodyLabel")}
            </Label>
            <Textarea
              id="add-decision-body"
              value={body}
              rows={3}
              placeholder={t("workspace.addDecisionBodyPlaceholder")}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("workspace.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={title.trim().length === 0 || isPending}
            >
              {isPending && <Spinner className="size-4" />}
              {t(isPending ? "workspace.adding" : "workspace.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
