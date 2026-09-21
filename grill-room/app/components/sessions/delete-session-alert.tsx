import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DeleteSessionAlertProps {
  sessionId: string;
}

export function DeleteSessionAlert({ sessionId }: DeleteSessionAlertProps) {
  const t = useT();

  const { mutate, isPending } = useActionMutation("delete-session", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("sessions.deleteFailed"));
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("sessions.deleteSession")}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <IconTrash className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("sessions.deleteConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("sessions.deleteConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("sessions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => mutate({ id: sessionId })}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {t(isPending ? "sessions.deleting" : "sessions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
