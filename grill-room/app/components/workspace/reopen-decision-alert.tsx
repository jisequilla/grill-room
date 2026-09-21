import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
import type { TreeDecision } from "@/lib/decisions";
import { transitiveDependentCount } from "@/lib/tree-outline";

/**
 * Reopening is cheap to click and expensive downstream, so the confirmation
 * says how many decisions the change puts in doubt before it happens.
 */
export function ReopenDecisionAlert({
  decision,
  decisions,
  children,
}: {
  decision: TreeDecision;
  decisions: readonly TreeDecision[];
  children: React.ReactNode;
}) {
  const t = useT();
  const affected = transitiveDependentCount(decisions, decision.id);

  const { mutate, isPending } = useActionMutation("reopen-decision", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.reopenFailed"));
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("workspace.reopenTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {affected === 0
              ? t("workspace.reopenDescriptionNone")
              : t("workspace.reopenDescription", { count: affected })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("workspace.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => mutate({ decisionId: decision.id })}
          >
            {t(isPending ? "workspace.reopening" : "workspace.reopenConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
