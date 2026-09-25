import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";

import { BuildRecordForm } from "@/components/output/build-record-form";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function BuildRecordsSection({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { formatNumber } = useFormatters();

  const { data, isLoading } = useActionQuery("get-build-summary", {
    sessionId,
  });

  if (isLoading || !data) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("output.buildRecordsHeading")}</h2>
        <Skeleton className="h-32 w-full rounded-xl" />
      </section>
    );
  }

  const passRate =
    data.firstAttemptPassRate === null
      ? t("output.buildSummaryNoRecords")
      : formatNumber(data.firstAttemptPassRate, { style: "percent" });

  return (
    <section className="space-y-4" data-testid="output-build-records-section">
      <h2 className="text-sm font-medium">{t("output.buildRecordsHeading")}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label={t("output.buildSummaryTickets")} value={data.tickets} />
        <SummaryStat label={t("output.buildSummaryRecorded")} value={data.recorded} />
        <SummaryStat label={t("output.buildSummaryPassRate")} value={passRate} />
        <SummaryStat label={t("output.buildSummaryEscalated")} value={data.escalated} />
      </div>

      {data.byModel.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("output.buildSummaryByModel")}
          </p>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("output.buildSummaryModelColumn")}</TableHead>
                  <TableHead className="text-right">
                    {t("output.buildSummaryRecordedColumn")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("output.buildSummaryPassedColumn")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("output.buildSummaryEscalatedColumn")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byModel.map((entry) => (
                  <TableRow key={entry.model || "—"}>
                    <TableCell className="font-mono text-xs">
                      {entry.model || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.recorded}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.firstAttemptPassed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.escalated}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {data.records.map((row) => (
          <BuildRecordForm key={row.ticket.number} sessionId={sessionId} row={row} />
        ))}
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-card/50 px-3.5 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
