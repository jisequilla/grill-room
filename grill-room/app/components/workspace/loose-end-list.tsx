import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh } from "@tabler/icons-react";

import { AnswerNow } from "@/components/workspace/answer-now";
import { SetAsideDialog } from "@/components/workspace/set-aside-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  isResolvableByUser,
  LOOSE_END_REASON_LABEL_KEY,
  type LooseEnd,
} from "@/lib/decisions";

function Row({
  looseEnd,
  onOpenDecision,
  children,
}: {
  looseEnd: LooseEnd;
  onOpenDecision: (decisionId: string) => void;
  children?: React.ReactNode;
}) {
  const t = useT();

  return (
    <li
      className="rounded-lg border bg-card px-4 py-3"
      data-testid="loose-end"
      data-reason={looseEnd.reason}
    >
      <button
        type="button"
        onClick={() => onOpenDecision(looseEnd.id)}
        className="rounded-sm text-left text-sm leading-snug font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {looseEnd.questionTitle}
      </button>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t(LOOSE_END_REASON_LABEL_KEY[looseEnd.reason])}
      </p>
      {children ? (
        <div className="mt-2.5 flex flex-wrap items-start gap-2">{children}</div>
      ) : null}
    </li>
  );
}

/**
 * Everything still blocking confirmation. The four steering moves are the
 * user's to close, by answering or setting aside; stale, unplaced and never
 * answered are the interviewer's, so they are grouped under the one thing that
 * resolves them — another round.
 */
export function LooseEndList({
  looseEnds,
  isLoading,
  onOpenDecision,
  onContinueInterview,
  isContinuing,
}: {
  looseEnds: readonly LooseEnd[];
  isLoading: boolean;
  onOpenDecision: (decisionId: string) => void;
  onContinueInterview: () => void;
  isContinuing: boolean;
}) {
  const t = useT();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (looseEnds.length === 0) {
    return (
      <p
        className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"
        data-testid="loose-ends-clear"
      >
        {t("workspace.looseEndsClear")}
      </p>
    );
  }

  const mine = looseEnds.filter((end) => isResolvableByUser(end.reason));
  const theirs = looseEnds.filter((end) => !isResolvableByUser(end.reason));

  return (
    <div className="space-y-4">
      {mine.length > 0 ? (
        <ul className="space-y-2">
          {mine.map((looseEnd) => (
            <Row
              key={looseEnd.id}
              looseEnd={looseEnd}
              onOpenDecision={onOpenDecision}
            >
              <AnswerNow decisionId={looseEnd.id} />
              <SetAsideDialog
                decisionId={looseEnd.id}
                questionTitle={looseEnd.questionTitle}
              />
            </Row>
          ))}
        </ul>
      ) : null}

      {theirs.length > 0 ? (
        <div className="space-y-2">
          <ul className="space-y-2">
            {theirs.map((looseEnd) => (
              <Row
                key={looseEnd.id}
                looseEnd={looseEnd}
                onOpenDecision={onOpenDecision}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t("workspace.looseEndsInterviewerNote")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isContinuing}
              onClick={onContinueInterview}
            >
              {isContinuing ? (
                <Spinner className="size-4" />
              ) : (
                <IconRefresh className="size-4" />
              )}
              {t("workspace.continueInterview")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
