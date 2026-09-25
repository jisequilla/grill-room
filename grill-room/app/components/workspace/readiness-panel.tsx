import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";

import { ReadinessBadge } from "@/components/sessions/readiness-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";

type RoundResult = AgentNativeActionRegistry["get-current-round"]["result"];

/** A stored readiness judgment of the session's current idea. */
export type Readiness = NonNullable<RoundResult["readiness"]>;

type GetScoutReportResult = AgentNativeActionRegistry["get-scout-report"]["result"];

/** A session's stored scout report, with its staleness. */
export type ScoutReport = NonNullable<GetScoutReportResult["report"]>;
type ScoutResult = ScoutReport["result"];
type ScoutCurrentStateItem = ScoutResult["currentState"][number];
type ScoutProposedDecision = ScoutResult["proposedDecisions"][number];
type ScoutFacts = ScoutReport["facts"];
type ScoutProposalDisposition = ScoutReport["dispositions"][string];

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
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
                className="mt-1.5 flex items-start gap-1.5 text-xs text-owed"
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

const SOURCE_LABEL_KEY: Record<ScoutProposedDecision["source"], string> = {
  recorded: "workspace.scoutSourceRecorded",
  inferred: "workspace.scoutSourceInferred",
};

const STATE_STATUS_LABEL_KEY: Record<ScoutCurrentStateItem["status"], string> = {
  built: "workspace.scoutStateBuilt",
  partial: "workspace.scoutStatePartial",
  gap: "workspace.scoutStateGap",
};

const STATE_STATUS_ORDER = ["built", "partial", "gap"] as const;

function ScoutFactsSection({ facts }: { facts: ScoutFacts }) {
  const t = useT();
  const remoteNames = [...new Set(facts.remotes.map((remote) => remote.name))];

  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3"
      data-testid="scout-facts"
    >
      <Section label={t("workspace.scoutFactsCommit")} testId="scout-fact-commit">
        {facts.headCommit ? (
          <>
            <span className="font-mono">{facts.headCommit.slice(0, 12)}</span>
            {facts.headBranch ? ` (${facts.headBranch})` : ""}
          </>
        ) : (
          <span className="text-muted-foreground">
            {t("workspace.scoutFactsNoCommit")}
          </span>
        )}
      </Section>
      <Section label={t("workspace.scoutFactsDirty")} testId="scout-fact-dirty">
        {t(facts.dirty ? "workspace.scoutFactsYes" : "workspace.scoutFactsNo")}
      </Section>
      <Section label={t("workspace.scoutFactsRemotes")} testId="scout-fact-remotes">
        {remoteNames.length > 0 ? (
          remoteNames.join(", ")
        ) : (
          <span className="text-muted-foreground">{t("workspace.scoutFactsNone")}</span>
        )}
      </Section>
      <Section
        label={t("workspace.scoutFactsInstructions")}
        testId="scout-fact-instructions"
      >
        {t(
          facts.hasAgentInstructions
            ? "workspace.scoutFactsYes"
            : "workspace.scoutFactsNo",
        )}
      </Section>
      <Section
        label={t("workspace.scoutFactsDecisionsFolder")}
        testId="scout-fact-decisions-folder"
      >
        {facts.decisionsFolder ?? (
          <span className="text-muted-foreground">{t("workspace.scoutFactsNone")}</span>
        )}
      </Section>
      <Section
        label={t("workspace.scoutFactsRulesFolder")}
        testId="scout-fact-rules-folder"
      >
        {t(facts.hasRulesFolder ? "workspace.scoutFactsYes" : "workspace.scoutFactsNo")}
      </Section>
    </dl>
  );
}

function ScoutCurrentState({ items }: { items: readonly ScoutCurrentStateItem[] }) {
  const t = useT();

  if (items.length === 0) {
    return (
      <span className="text-muted-foreground" data-testid="scout-current-state-empty">
        {t("workspace.scoutCurrentStateEmpty")}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="scout-current-state">
      {STATE_STATUS_ORDER.map((status) => {
        const group = items.filter((item) => item.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status} data-testid="scout-current-state-group" data-status={status}>
            <p className="pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t(STATE_STATUS_LABEL_KEY[status])}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {group.map((item, index) => (
                <li
                  key={index}
                  className="text-sm"
                  data-testid="scout-current-state-item"
                >
                  {item.summary}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({item.citations.join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ScoutDecisionRow({
  proposal,
  disposition,
  busy,
  onKeep,
  onDrop,
}: {
  proposal: ScoutProposedDecision;
  disposition: ScoutProposalDisposition;
  busy: boolean;
  onKeep: () => void;
  onDrop: () => void;
}) {
  const t = useT();

  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5"
      data-testid="scout-decision"
      data-key={proposal.key}
      data-disposition={disposition}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{proposal.title}</p>
        <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t(SOURCE_LABEL_KEY[proposal.source])}
        </span>
      </div>
      <p className="text-sm">{proposal.statement}</p>
      <p className="text-xs text-muted-foreground">{proposal.citation}</p>
      <p className="text-xs text-muted-foreground">{proposal.reason}</p>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {disposition === "kept" ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="scout-decision-kept-note"
          >
            {t("workspace.scoutKeptNote")}
          </span>
        ) : (
          <>
            {disposition === "dropped" ? (
              <span
                className="text-xs text-muted-foreground"
                data-testid="scout-decision-dropped-note"
              >
                {t("workspace.scoutDroppedNote")}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onDrop}
              data-testid="scout-decision-drop"
            >
              {t("workspace.scoutDrop")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={onKeep}
              data-testid="scout-decision-keep"
            >
              {t("workspace.scoutKeep")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The session's scout report: server facts, current state grouped built /
 * partial / gap with citations, proposed repo decisions with keep and drop
 * controls, the commit and model it read, a stale badge, a re-scout control
 * and the scout turn's attempt log. Pure and prop-driven, like {@link
 * ReadinessPanel}: the route fetches the report and the scout turn and runs
 * the scout/keep/drop mutations, so this only renders what it is given. That
 * keeps it reachable past the first round — the route mounts it whenever the
 * session has a project, independent of the round/readiness gating below it —
 * and keeps it unit-testable without mocking the action hooks.
 */
export function ScoutReportPanel({
  report,
  busy,
  isScouting,
  onRescout,
  onKeep,
  onDrop,
  turn = null,
}: {
  report: ScoutReport | null;
  /** Some turn — this scout run, a keep/drop, or any other turn kind — is working. */
  busy: boolean;
  /** This tab's own re-scout request is in flight. */
  isScouting: boolean;
  onRescout: () => void;
  onKeep: (key: string) => void;
  onDrop: (key: string) => void;
  /** The turn that produced the current report, collapsed. */
  turn?: Turn | null;
}) {
  const t = useT();

  return (
    <div
      className="mb-4 flex flex-col gap-4 rounded-xl border px-5 py-4"
      data-testid="scout-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="text-sm font-medium">{t("workspace.scoutTitle")}</h4>
          {report?.stale ? (
            <Badge
              variant="outline"
              data-testid="scout-stale-badge"
              className="shrink-0 gap-1 border-owed/40 text-owed"
            >
              <IconAlertTriangle className="size-3" />
              {t("workspace.scoutStale")}
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant={report ? "outline" : "default"}
          disabled={busy}
          onClick={onRescout}
          data-testid={report ? "scout-rescout" : "scout-run"}
        >
          {isScouting && <Spinner className="size-4" />}
          {t(
            isScouting
              ? "workspace.scoutRunning"
              : report
                ? "workspace.scoutRescout"
                : "workspace.scoutRun",
          )}
        </Button>
      </div>

      <TurnAttemptLog turn={turn} />

      {report ? (
        <div className="flex flex-col gap-4">
          <ScoutFactsSection facts={report.facts} />

          <Section
            label={t("workspace.scoutCurrentStateLabel")}
            testId="scout-current-state-section"
          >
            <ScoutCurrentState items={report.result.currentState} />
          </Section>

          <Section
            label={t("workspace.scoutDecisionsLabel")}
            testId="scout-decisions-section"
          >
            {report.result.proposedDecisions.length > 0 ? (
              <ul className="flex flex-col gap-2" data-testid="scout-decisions">
                {report.result.proposedDecisions.map((proposal) => (
                  <ScoutDecisionRow
                    key={proposal.key}
                    proposal={proposal}
                    disposition={report.dispositions[proposal.key] ?? "undecided"}
                    busy={busy}
                    onKeep={() => onKeep(proposal.key)}
                    onDrop={() => onDrop(proposal.key)}
                  />
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t("workspace.scoutNoDecisions")}
              </span>
            )}
          </Section>

          <p className="text-xs text-muted-foreground" data-testid="scout-meta">
            {t("workspace.scoutMeta", {
              commit: report.commitRead
                ? report.commitRead.slice(0, 12)
                : t("workspace.scoutFactsNoCommit"),
              model: report.model,
            })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("workspace.scoutDescription")}</p>
      )}
    </div>
  );
}
