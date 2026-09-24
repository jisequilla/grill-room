import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh, IconTicket } from "@tabler/icons-react";
import { useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";
import { actionErrorCode, actionErrorDetails } from "@/lib/decisions";
import { TICKET_STATUS_LABEL_KEY } from "@/lib/ticket-labels";

import type { TicketStatus } from "@shared/session-constants";

const TURN_TIMEOUT_MS = 10 * 60 * 1000;

const SILENT_ERROR_CODES = new Set([
  "turn-in-progress",
  "cli-missing",
  "not-logged-in",
  "rate-limited",
  "malformed-output",
  "invalid-tickets",
  "failed",
]);

/** `set-ticket-blocked-by` refusals shown inline under the ticket row, never as a toast. */
const INLINE_BLOCKED_BY_ERROR_CODES = new Set([
  "cycle",
  "self-reference",
  "unknown-ticket-number",
]);

const STATUS_VARIANT: Record<TicketStatus, "secondary" | "default" | "outline"> = {
  ready: "secondary",
  "in-progress": "default",
  done: "outline",
};

export function TicketsSection({
  sessionId,
  working,
  activeTurn,
  onSettled,
}: {
  sessionId: string;
  working: boolean;
  /** The turn the session's current turn status belongs to, of any kind. */
  activeTurn: Turn | null;
  onSettled: () => void;
}) {
  const t = useT();
  const [confirmForce, setConfirmForce] = useState(false);
  const [buildRecordCount, setBuildRecordCount] = useState(0);
  const [blockedByError, setBlockedByError] = useState<{
    ticketId: string;
    message: string;
  } | null>(null);

  const { data: specData } = useActionQuery("get-spec", { sessionId });
  const spec = specData?.spec ?? null;

  // Collapsed once breakdown has stopped: the turn linked from the spec row's
  // `ticketsTurnId`, only set once a breakdown has actually completed.
  const { data: completedTurn } = useActionQuery(
    "get-turn",
    { turnId: spec?.ticketsTurnId ?? "" },
    { enabled: spec?.ticketsTurnId != null },
  );

  // Live while this route's active turn is actually a breakdown still
  // running; the collapsed, already-stopped turn otherwise.
  const attemptLogTurn =
    activeTurn != null &&
    activeTurn.turnKind === "break-into-tickets" &&
    activeTurn.completedAt === null
      ? activeTurn
      : (completedTurn ?? null);

  const { data, isLoading } = useActionQuery("list-tickets", { sessionId });
  const tickets = data?.tickets ?? [];
  const ticketsCurrent = data?.ticketsCurrent ?? false;
  const waves = data?.waves ?? [];

  const waveByNumber = new Map<number, number>();
  waves.forEach((wave, index) => {
    wave.forEach((number) => waveByNumber.set(number, index + 1));
  });

  const setTicketBlockedBy = useActionMutation("set-ticket-blocked-by", {
    onSuccess: (_result, variables) => {
      setBlockedByError((current) =>
        current?.ticketId === variables.ticketId ? null : current,
      );
    },
    onError: (error: unknown, variables) => {
      const code = actionErrorCode(error);
      const message = actionErrorMessage(error) ?? t("output.editBlockedByFailed");
      if (INLINE_BLOCKED_BY_ERROR_CODES.has(code ?? "")) {
        setBlockedByError({ ticketId: variables.ticketId, message });
        return;
      }
      toast.error(message);
    },
  });

  function toggleBlockedBy(
    ticket: (typeof tickets)[number],
    otherNumber: number,
    checked: boolean,
  ) {
    const nextBlockedBy = checked
      ? [...ticket.blockedBy, otherNumber]
      : ticket.blockedBy.filter((number) => number !== otherNumber);
    setTicketBlockedBy.mutate({ ticketId: ticket.id, blockedBy: nextBlockedBy });
  }

  const breakIntoTickets = useActionMutation("break-into-tickets", {
    timeoutMs: TURN_TIMEOUT_MS,
    onSuccess: () => setConfirmForce(false),
    onError: (error: unknown) => {
      const code = actionErrorCode(error);
      if (code === "build-records-exist") {
        const details = actionErrorDetails(error);
        setBuildRecordCount(
          typeof details?.buildRecordCount === "number"
            ? details.buildRecordCount
            : 0,
        );
        setConfirmForce(true);
        return;
      }
      if (SILENT_ERROR_CODES.has(code ?? "")) return;
      toast.error(
        actionErrorMessage(error) ?? t("output.breakIntoTicketsFailed"),
      );
    },
    onSettled,
  });

  const busy = working || breakIntoTickets.isPending;

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("output.ticketsHeading")}</h2>
        <Skeleton className="h-40 w-full rounded-xl" />
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="output-tickets-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("output.ticketsHeading")}</h2>
        {tickets.length > 0 ? (
          <Badge variant={ticketsCurrent ? "outline" : "secondary"}>
            {t(
              ticketsCurrent
                ? "output.ticketsCurrent"
                : "output.ticketsOutOfDate",
            )}
          </Badge>
        ) : null}
      </div>

      <TurnAttemptLog turn={attemptLogTurn} />

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <IconTicket className="size-6 text-muted-foreground" />
          <h3 className="text-base font-medium">
            {t("output.ticketsEmptyTitle")}
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t(
              spec
                ? "output.ticketsEmptyReady"
                : "output.ticketsEmptyNoSpec",
            )}
          </p>
          <Button
            className="mt-1"
            disabled={busy || !spec}
            onClick={() => breakIntoTickets.mutate({ sessionId, force: false })}
            data-testid="break-into-tickets"
          >
            {breakIntoTickets.isPending && <Spinner className="size-4" />}
            {t(
              breakIntoTickets.isPending
                ? "output.breakingIntoTickets"
                : "output.breakIntoTickets",
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead>{t("output.ticketColumnHeading")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id} data-testid={`ticket-row-${ticket.number}`}>
                    <TableCell className="align-top font-mono text-xs text-muted-foreground">
                      {t("output.ticketNumber", { number: ticket.number })}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {ticket.title}
                          </span>
                          <Badge variant={STATUS_VARIANT[ticket.status]}>
                            {t(TICKET_STATUS_LABEL_KEY[ticket.status])}
                          </Badge>
                          {waveByNumber.has(ticket.number) ? (
                            <Badge
                              variant="outline"
                              className="font-normal"
                              data-testid={`ticket-wave-${ticket.number}`}
                            >
                              {t("output.ticketWave", {
                                wave: waveByNumber.get(ticket.number),
                              })}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">
                          {ticket.slug}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs text-muted-foreground">
                            {t("output.ticketBlockedBy")}:{" "}
                            {ticket.blockedBy.length === 0
                              ? t("output.ticketBlockedByNone")
                              : ticket.blockedBy
                                  .map((number) => `#${number}`)
                                  .join(", ")}
                          </p>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={
                                  setTicketBlockedBy.isPending &&
                                  setTicketBlockedBy.variables?.ticketId === ticket.id
                                }
                                data-testid={`edit-blocked-by-${ticket.number}`}
                              >
                                {t("output.editBlockedBy")}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {tickets.length <= 1 ? (
                                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                  {t("output.editBlockedByNoOthers")}
                                </DropdownMenuLabel>
                              ) : (
                                tickets
                                  .filter((other) => other.id !== ticket.id)
                                  .map((other) => (
                                    <DropdownMenuCheckboxItem
                                      key={other.id}
                                      checked={ticket.blockedBy.includes(other.number)}
                                      onSelect={(event) => event.preventDefault()}
                                      onCheckedChange={(checked) =>
                                        toggleBlockedBy(ticket, other.number, checked === true)
                                      }
                                      data-testid={`blocked-by-option-${ticket.number}-${other.number}`}
                                    >
                                      {t("output.ticketNumber", { number: other.number })}{" "}
                                      {other.title}
                                    </DropdownMenuCheckboxItem>
                                  ))
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {blockedByError?.ticketId === ticket.id ? (
                          <p
                            className="text-xs text-destructive"
                            data-testid={`blocked-by-error-${ticket.number}`}
                          >
                            {blockedByError.message}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !spec}
            onClick={() => breakIntoTickets.mutate({ sessionId, force: false })}
            data-testid="regenerate-tickets"
          >
            {breakIntoTickets.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <IconRefresh className="size-4" />
            )}
            {t(
              breakIntoTickets.isPending
                ? "output.regeneratingTickets"
                : "output.regenerateTickets",
            )}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmForce} onOpenChange={setConfirmForce}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("output.regenerateTicketsTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("output.regenerateTicketsDescription")}{" "}
              {t("output.regenerateTicketsBuildRecordsWarning", {
                count: buildRecordCount,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("workspace.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={breakIntoTickets.isPending}
              onClick={() =>
                breakIntoTickets.mutate({ sessionId, force: true })
              }
            >
              {t("output.regenerateTicketsConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
