import { useT } from "@agent-native/core/client/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type VisibilityReport = AgentNativeActionRegistry["get-export-visibility"]["result"];
type ClassifiedFile = VisibilityReport["files"][number];

/** A file's git standing, on a canvas that is otherwise neutral: tracked is calm, unchecked is a neutral unknown, the other two want attention. */
const CLASS_BY_VISIBILITY: Record<ClassifiedFile["visibility"], string> = {
  tracked:
    "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  ignored:
    "border-amber-600/30 bg-amber-500/15 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  untracked:
    "border-orange-600/30 bg-orange-500/15 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300",
  unchecked:
    "border-slate-600/30 bg-slate-500/15 text-slate-700 dark:border-slate-400/30 dark:bg-slate-400/10 dark:text-slate-300",
};

const VISIBILITY_LABEL_KEY: Record<ClassifiedFile["visibility"], string> = {
  tracked: "output.visibilityTracked",
  ignored: "output.visibilityIgnored",
  untracked: "output.visibilityUntracked",
  unchecked: "output.visibilityUnchecked",
};

function VisibilityBadge({ visibility }: { visibility: ClassifiedFile["visibility"] }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium tracking-wide uppercase",
        CLASS_BY_VISIBILITY[visibility],
      )}
    >
      {t(VISIBILITY_LABEL_KEY[visibility])}
    </span>
  );
}

/**
 * The post-export visibility report: what each written file is (tracked,
 * ignored, or untracked) in the target repository, a plain warning plus the
 * exact remedy commands when agents will not see something, and a separate
 * warning when the project's declared visibility flag disagrees with what
 * was observed. The report itself is built server-side (`server/visibility.ts`)
 * with real paths and commands already filled in, so its warning and remedy
 * text is shown as-is rather than run through translation.
 */
export function ExportVisibilityReport({ report }: { report: VisibilityReport }) {
  const t = useT();

  return (
    <div className="space-y-3" data-testid="export-visibility-report">
      <p className="text-xs font-medium">{t("output.visibilityHeading")}</p>
      <ul className="space-y-1" data-testid="export-visibility-files">
        {report.files.map((file) => (
          <li key={file.path} className="flex items-center gap-2">
            <VisibilityBadge visibility={file.visibility} />
            <span className="font-mono text-xs break-all text-muted-foreground">
              {file.relativePath}
            </span>
          </li>
        ))}
      </ul>

      {report.warning ? (
        <Alert variant="destructive" data-testid="export-visibility-warning">
          <AlertTitle>{t("output.visibilityWarningHeading")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-sm">{report.warning}</p>
            {report.untrackedRemedy ? (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t("output.visibilityUntrackedRemedyHeading")}</p>
                <pre
                  className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
                  data-testid="export-visibility-untracked-remedy"
                >
                  {report.untrackedRemedy}
                </pre>
              </div>
            ) : null}
            {report.ignoredRemedy ? (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t("output.visibilityIgnoredRemedyHeading")}</p>
                <pre
                  className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
                  data-testid="export-visibility-ignored-remedy"
                >
                  {report.ignoredRemedy}
                </pre>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {report.uncheckedWarning ? (
        <Alert data-testid="export-visibility-unchecked">
          <AlertTitle>{t("output.visibilityUncheckedHeading")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap">
              {report.uncheckedWarning}
            </pre>
          </AlertDescription>
        </Alert>
      ) : null}

      {report.mismatchWarning ? (
        <Alert variant="destructive" data-testid="export-visibility-mismatch">
          <AlertTitle>{t("output.visibilityMismatchHeading")}</AlertTitle>
          <AlertDescription>{report.mismatchWarning}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
