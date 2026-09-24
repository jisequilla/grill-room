import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";

import { ReadinessBadge } from "@/components/sessions/readiness-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";

type RoundResult = AgentNativeActionRegistry["get-current-round"]["result"];

/** A stored readiness judgment of the session's current idea. */
export type Readiness = NonNullable<RoundResult["readiness"]>;

function Section({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Whether the idea is ready to grill, shown above the start panel while the
 * session has no rounds. It reports and never blocks: starting the interview
 * stays available whatever the verdict.
 *
 * While a turn works this panel only disables its action; the one working
 * panel below it carries the elapsed time, since the stored turn status cannot
 * say whether the turn is this judgment or the first round.
 */
export function ReadinessPanel({
  readiness,
  working,
  isAssessing,
  onAssess,
  turn = null,
}: {
  readiness: Readiness | null;
  /** The session's interviewer is working on some turn. */
  working: boolean;
  /** This tab's assess request is in flight. */
  isAssessing: boolean;
  onAssess: () => void;
  /**
   * The turn that produced the current judgment (the session's
   * `readinessTurnId`), collapsed beside the verdict. The live attempt log
   * while a judgment runs is shown in the turn status below this panel
   * instead, since the stored turn status cannot say whether the turn working
   * is this judgment or the first round.
   */
  turn?: Turn | null;
}) {
  const t = useT();
  const result = readiness?.result ?? null;
  const busy = working || isAssessing;

  return (
    <div
      className="mb-4 flex flex-col gap-4 rounded-xl border px-5 py-4"
      data-testid="readiness-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="text-sm font-medium">{t("workspace.readinessTitle")}</h4>
          {result ? (
            <ReadinessBadge verdict={result.verdict} testId="readiness-verdict" />
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant={result ? "outline" : "default"}
          disabled={busy}
          onClick={onAssess}
          data-testid={result ? "readiness-reassess" : "readiness-assess"}
        >
          {busy && <Spinner className="size-4" />}
          {t(
            busy
              ? "workspace.readinessAssessing"
              : result
                ? "workspace.readinessReassess"
                : "workspace.readinessAssess",
          )}
        </Button>
      </div>

      <TurnAttemptLog turn={turn} />

      {result ? (
        <dl className="flex flex-col gap-4">
          <Section label={t("workspace.readinessObjective")} testId="readiness-objective">
            {result.objective ?? (
              <span className="text-muted-foreground">
                {t("workspace.readinessNoObjective")}
              </span>
            )}
            {result.objectiveIsProcess ? (
              <p
                className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                data-testid="readiness-process-warning"
              >
                <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t("workspace.readinessProcessWarning")}
              </p>
            ) : null}
          </Section>

          <Section label={t("workspace.readinessEvidence")} testId="readiness-evidence">
            {result.evidence.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {result.evidence.map((item, index) => (
                  <li key={index}>
                    {item.text}
                    {item.source === "repo" ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({t("workspace.readinessEvidenceRepo")}
                        {item.citation ? `: ${item.citation}` : ""})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t("workspace.readinessNoEvidence")}
              </span>
            )}
          </Section>

          <Section
            label={t("workspace.readinessExpectedOutcome")}
            testId="readiness-expected-outcome"
          >
            {result.expectedOutcome ?? (
              <span className="text-muted-foreground">
                {t("workspace.readinessNotStated")}
              </span>
            )}
          </Section>

          <Section
            label={t("workspace.readinessUnknowns", {
              count: result.unknowns.length,
            })}
            testId="readiness-unknowns"
          >
            {result.unknowns.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {result.unknowns.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t("workspace.readinessNoUnknowns")}
              </span>
            )}
          </Section>

          {result.missing.length > 0 ? (
            <Section label={t("workspace.readinessMissing")} testId="readiness-missing">
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {result.missing.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("workspace.readinessDescription")}
        </p>
      )}
    </div>
  );
}
