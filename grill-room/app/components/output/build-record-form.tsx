import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconChevronRight, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_STATUS_LABEL_KEY } from "@/lib/ticket-labels";

import { TICKET_STATUSES, type TicketStatus } from "@shared/session-constants";

type BuildSummaryResult = AgentNativeActionRegistry["get-build-summary"]["result"];
type BuildRecordRow = BuildSummaryResult["records"][number];

/** The documented `pnpm action` invocation, with this ticket's own identity filled in. */
function commandLineExample(sessionId: string, ticketNumber: number): string {
  return [
    "pnpm action set-build-record \\",
    `  --sessionId ${sessionId} --ticketNumber ${ticketNumber} \\`,
    "  --model <model> --firstAttemptPassed <true|false> --escalated <true|false> \\",
    '  --promptMissing "<what the prompt was missing>" \\',
    '  --notes "<notes>" \\',
    "  --ticketStatus <ready|in-progress|done>",
  ].join("\n");
}

function CommandBlock({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the code block is still selectable.
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {t("output.buildRecordCommandHeading")}
      </p>
      <div className="relative rounded-lg border bg-muted/40">
        <pre className="overflow-x-auto p-3 pr-16 font-mono text-xs whitespace-pre">
          {command}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute top-1.5 right-1.5"
          onClick={copy}
        >
          {copied ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconCopy className="size-3.5" />
          )}
          {t(
            copied
              ? "output.buildRecordCommandCopied"
              : "output.buildRecordCommandCopy",
          )}
        </Button>
      </div>
    </div>
  );
}

/** One ticket's expandable build record: its current state, and the form to write it. */
export function BuildRecordForm({
  sessionId,
  row,
}: {
  sessionId: string;
  row: BuildRecordRow;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const record = row.buildRecord;
  const [model, setModel] = useState(record?.model ?? "");
  const [firstAttemptPassed, setFirstAttemptPassed] = useState(
    record?.firstAttemptPassed ?? false,
  );
  const [escalated, setEscalated] = useState(record?.escalated ?? false);
  const [promptMissing, setPromptMissing] = useState(
    record?.promptMissing ?? "",
  );
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [ticketStatus, setTicketStatus] = useState<TicketStatus>(
    row.ticket.status,
  );

  // Re-sync the form whenever the stored record changes underneath it (an
  // agent logging a build from the command line while this is open).
  useEffect(() => {
    setModel(record?.model ?? "");
    setFirstAttemptPassed(record?.firstAttemptPassed ?? false);
    setEscalated(record?.escalated ?? false);
    setPromptMissing(record?.promptMissing ?? "");
    setNotes(record?.notes ?? "");
    setTicketStatus(row.ticket.status);
  }, [record?.updatedAt, row.ticket.status]);

  const { mutate, isPending } = useActionMutation("set-build-record", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("output.buildRecordSaveFailed"));
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (model.trim().length === 0 || isPending) return;
    mutate({
      sessionId,
      ticketNumber: row.ticket.number,
      model: model.trim(),
      firstAttemptPassed,
      escalated,
      promptMissing: promptMissing.trim(),
      notes: notes.trim(),
      ticketStatus,
    });
  }

  const idPrefix = `build-record-${row.ticket.number}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid={`build-record-trigger-${row.ticket.number}`}
      >
        <IconChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90"
          data-open={open}
        />
        <span className="font-mono text-xs text-muted-foreground">
          #{row.ticket.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {row.ticket.title}
        </span>
        <Badge variant="outline">{t(TICKET_STATUS_LABEL_KEY[row.ticket.status])}</Badge>
        {record ? (
          <Badge variant={record.firstAttemptPassed ? "outline" : "secondary"}>
            {record.model}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {t("output.buildRecordNone")}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-model`}>
                {t("output.buildRecordModelLabel")}
              </Label>
              <Input
                id={`${idPrefix}-model`}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={t("output.buildRecordModelPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-status`}>
                {t("output.buildRecordTicketStatusLabel")}
              </Label>
              <Select
                value={ticketStatus}
                onValueChange={(value) => setTicketStatus(value as TicketStatus)}
              >
                <SelectTrigger id={`${idPrefix}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(TICKET_STATUS_LABEL_KEY[status])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2.5">
              <Switch
                id={`${idPrefix}-passed`}
                checked={firstAttemptPassed}
                onCheckedChange={setFirstAttemptPassed}
              />
              <Label htmlFor={`${idPrefix}-passed`} className="font-normal">
                {t("output.buildRecordFirstAttemptPassedLabel")}
              </Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch
                id={`${idPrefix}-escalated`}
                checked={escalated}
                onCheckedChange={setEscalated}
              />
              <Label htmlFor={`${idPrefix}-escalated`} className="font-normal">
                {t("output.buildRecordEscalatedLabel")}
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-prompt-missing`}>
              {t("output.buildRecordPromptMissingLabel")}
            </Label>
            <Textarea
              id={`${idPrefix}-prompt-missing`}
              value={promptMissing}
              rows={2}
              placeholder={t("output.buildRecordPromptMissingPlaceholder")}
              onChange={(event) => setPromptMissing(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-notes`}>
              {t("output.buildRecordNotesLabel")}
            </Label>
            <Textarea
              id={`${idPrefix}-notes`}
              value={notes}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <Button
            type="submit"
            size="sm"
            disabled={model.trim().length === 0 || isPending}
            data-testid={`build-record-save-${row.ticket.number}`}
          >
            {isPending && <Spinner className="size-4" />}
            {t(isPending ? "output.buildRecordSaving" : "output.buildRecordSave")}
          </Button>
        </form>

        <CommandBlock
          command={commandLineExample(sessionId, row.ticket.number)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
