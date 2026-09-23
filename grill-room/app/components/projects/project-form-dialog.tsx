import {
  actionErrorMessage,
  callAction,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { actionErrorCode } from "@/lib/decisions";
import {
  PROJECT_ERROR,
  TRACKER_KIND_LABEL_KEY,
  VISIBILITY_LABEL_KEY,
  type Project,
  type ProjectField,
} from "@/lib/projects";

import {
  DEFAULT_PROJECT_SLUG_PATTERN,
  PROJECT_TRACKER_KINDS,
  PROJECT_VISIBILITIES,
  type ProjectTrackerKind,
  type ProjectVisibility,
} from "@shared/session-constants";

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project being edited, or null to register a new one. */
  project: Project | null;
}

type FieldErrors = Partial<Record<ProjectField, string>>;

export function ProjectFormDialog({ open, onOpenChange, project }: ProjectFormDialogProps) {
  const t = useT();
  const [root, setRoot] = useState("");
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [namePlaceholder, setNamePlaceholder] = useState("");
  const [verifyCommand, setVerifyCommand] = useState("");
  const [verifySuggested, setVerifySuggested] = useState(false);
  const [exportFolder, setExportFolder] = useState("");
  const [slugPattern, setSlugPattern] = useState(DEFAULT_PROJECT_SLUG_PATTERN);
  const [trackerKind, setTrackerKind] = useState<ProjectTrackerKind>("markdown");
  const [buildRecordLogging, setBuildRecordLogging] = useState(false);
  const [visibility, setVisibility] = useState<ProjectVisibility>("tracked");
  const [visibilitySeeded, setVisibilitySeeded] = useState(false);
  const [exportFolderSuggested, setExportFolderSuggested] = useState(false);
  const [slugPatternSuggested, setSlugPatternSuggested] = useState(false);
  const [trackerDiagnostic, setTrackerDiagnostic] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Whether the operator has set these by hand; a detection never overwrites that.
  const verifyTouched = useRef(false);
  const visibilityTouched = useRef(false);
  const exportFolderTouched = useRef(false);
  const slugPatternTouched = useRef(false);
  const detection = useRef(0);

  useEffect(() => {
    if (!open) return;
    setRoot(project?.rootPath ?? "");
    setResolvedRoot(project?.rootPath ?? null);
    setName(project?.name ?? "");
    setNamePlaceholder(project?.name ?? "");
    setVerifyCommand(project?.verifyCommand ?? "");
    setVerifySuggested(false);
    setExportFolder(project?.exportFolder ?? "");
    setExportFolderSuggested(false);
    setSlugPattern(project?.slugPattern ?? DEFAULT_PROJECT_SLUG_PATTERN);
    setSlugPatternSuggested(false);
    setTrackerKind((project?.trackerKind as ProjectTrackerKind) ?? "markdown");
    setBuildRecordLogging(project?.buildRecordLogging ?? false);
    setVisibility((project?.visibility as ProjectVisibility) ?? "tracked");
    setVisibilitySeeded(false);
    setTrackerDiagnostic(project?.trackerDiagnostic ?? null);
    setErrors({});
    verifyTouched.current = project !== null;
    visibilityTouched.current = project !== null;
    exportFolderTouched.current = project !== null;
    slugPatternTouched.current = project !== null;
  }, [open, project]);

  /** Ask the registry what it would detect, and pre-fill whatever the operator has not set. */
  async function detect(folder: string, exportTo: string) {
    if (folder.trim().length === 0) return;
    const run = ++detection.current;
    setDetecting(true);
    try {
      const found = await callAction(
        "suggest-project-defaults",
        {
          folder: folder.trim(),
          ...(exportTo.trim().length > 0 ? { exportFolder: exportTo.trim() } : {}),
        },
        { method: "GET" },
      );
      if (run !== detection.current) return;
      setResolvedRoot(found.root);
      setNamePlaceholder(found.name);
      setErrors((current) => ({ ...current, root: undefined, exportFolder: undefined }));
      if (!verifyTouched.current && found.verifyCommand) {
        setVerifyCommand(found.verifyCommand);
        setVerifySuggested(true);
      }
      if (!visibilityTouched.current && found.visibility) {
        setVisibility(found.visibility);
        setVisibilitySeeded(true);
      }
      if (!exportFolderTouched.current && found.trackerExportFolder) {
        setExportFolder(found.trackerExportFolder);
        setExportFolderSuggested(true);
      }
      if (!slugPatternTouched.current && found.trackerSlugPattern) {
        setSlugPattern(found.trackerSlugPattern);
        setSlugPatternSuggested(true);
      }
    } catch (error) {
      if (run !== detection.current) return;
      setResolvedRoot(null);
      showError(error);
    } finally {
      if (run === detection.current) setDetecting(false);
    }
  }

  function showError(error: unknown): boolean {
    const mapped = PROJECT_ERROR[actionErrorCode(error) ?? ""];
    if (!mapped) return false;
    setErrors((current) => ({ ...current, [mapped.field]: t(mapped.key) }));
    return true;
  }

  function onSaveError(error: unknown) {
    if (showError(error)) return;
    toast.error(actionErrorMessage(error) ?? t("projects.saveFailed"));
  }

  const register = useActionMutation("register-project", {
    onSuccess: () => onOpenChange(false),
    onError: onSaveError,
  });
  const update = useActionMutation("update-project", {
    onSuccess: () => onOpenChange(false),
    onError: onSaveError,
  });
  const saving = register.isPending || update.isPending;

  const refreshTracker = useActionMutation("refresh-project-tracker", {
    onSuccess: (updated) => {
      setExportFolder(updated.exportFolder);
      setSlugPattern(updated.slugPattern);
      setTrackerDiagnostic(updated.trackerDiagnostic ?? null);
      toast.success(t("projects.trackerRefreshed"));
    },
    onError: (error) => {
      toast.error(actionErrorMessage(error) ?? t("projects.trackerRefreshFailed"));
    },
  });

  const canSubmit =
    root.trim().length > 0 &&
    verifyCommand.trim().length > 0 &&
    exportFolder.trim().length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setErrors({});
    const fields = {
      root: root.trim(),
      verifyCommand: verifyCommand.trim(),
      exportFolder: exportFolder.trim(),
      name: name.trim(),
      slugPattern: slugPattern.trim(),
      trackerKind,
      buildRecordLogging,
      visibility,
    };
    if (project) update.mutate({ id: project.id, ...fields });
    else register.mutate(fields);
  }

  function hint(field: ProjectField, fallback: string | null, id: string) {
    const error = errors[field];
    if (!error && !fallback) return null;
    return (
      <p id={id} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {error ?? fallback}
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(project ? "projects.editTitle" : "projects.addTitle")}</DialogTitle>
          <DialogDescription>{t("projects.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="project-form">
          <div className="space-y-2">
            <Label htmlFor="project-root">{t("projects.rootLabel")}</Label>
            <Input
              id="project-root"
              value={root}
              onChange={(event) => {
                setRoot(event.target.value);
                setResolvedRoot(null);
                setErrors((current) => ({ ...current, root: undefined }));
              }}
              onBlur={() => void detect(root, exportFolder)}
              placeholder={t("projects.rootPlaceholder")}
              aria-invalid={errors.root !== undefined}
              aria-describedby="project-root-hint"
              spellCheck={false}
              autoFocus={!project}
            />
            {hint(
              "root",
              detecting
                ? t("projects.detecting")
                : resolvedRoot
                  ? t("projects.rootResolved", { root: resolvedRoot })
                  : t("projects.rootHint"),
              "project-root-hint",
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">{t("projects.nameLabel")}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={namePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-verify">{t("projects.verifyCommandLabel")}</Label>
              <Input
                id="project-verify"
                value={verifyCommand}
                onChange={(event) => {
                  verifyTouched.current = true;
                  setVerifySuggested(false);
                  setVerifyCommand(event.target.value);
                  setErrors((current) => ({ ...current, verifyCommand: undefined }));
                }}
                placeholder={t("projects.verifyCommandPlaceholder")}
                aria-invalid={errors.verifyCommand !== undefined}
                aria-describedby="project-verify-hint"
                className="font-mono"
                spellCheck={false}
              />
              {hint(
                "verifyCommand",
                verifySuggested ? t("projects.verifyCommandSuggested") : null,
                "project-verify-hint",
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-export">{t("projects.exportFolderLabel")}</Label>
              <Input
                id="project-export"
                value={exportFolder}
                onChange={(event) => {
                  exportFolderTouched.current = true;
                  setExportFolderSuggested(false);
                  setExportFolder(event.target.value);
                  setErrors((current) => ({ ...current, exportFolder: undefined }));
                }}
                onBlur={() => void detect(root, exportFolder)}
                placeholder={t("projects.exportFolderPlaceholder")}
                aria-invalid={errors.exportFolder !== undefined}
                aria-describedby="project-export-hint"
                className="font-mono"
                spellCheck={false}
              />
              {hint(
                "exportFolder",
                exportFolderSuggested
                  ? t("projects.exportFolderSuggested")
                  : t("projects.exportFolderHint"),
                "project-export-hint",
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-slug">{t("projects.slugPatternLabel")}</Label>
              <Input
                id="project-slug"
                value={slugPattern}
                onChange={(event) => {
                  slugPatternTouched.current = true;
                  setSlugPatternSuggested(false);
                  setSlugPattern(event.target.value);
                  setErrors((current) => ({ ...current, slugPattern: undefined }));
                }}
                placeholder={DEFAULT_PROJECT_SLUG_PATTERN}
                aria-invalid={errors.slugPattern !== undefined}
                aria-describedby="project-slug-hint"
                className="font-mono"
                spellCheck={false}
              />
              {hint(
                "slugPattern",
                slugPatternSuggested ? t("projects.slugPatternSuggested") : t("projects.slugPatternHint"),
                "project-slug-hint",
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-tracker">{t("projects.trackerKindLabel")}</Label>
              <Select
                value={trackerKind}
                onValueChange={(value) => setTrackerKind(value as ProjectTrackerKind)}
              >
                <SelectTrigger id="project-tracker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TRACKER_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(TRACKER_KIND_LABEL_KEY[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-visibility">{t("projects.visibilityLabel")}</Label>
              <Select
                value={visibility}
                onValueChange={(value) => {
                  visibilityTouched.current = true;
                  setVisibilitySeeded(false);
                  setVisibility(value as ProjectVisibility);
                }}
              >
                <SelectTrigger id="project-visibility" aria-describedby="project-visibility-hint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_VISIBILITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(VISIBILITY_LABEL_KEY[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {visibilitySeeded ? (
                <p id="project-visibility-hint" className="text-xs text-muted-foreground">
                  {t("projects.visibilitySeeded")}
                </p>
              ) : null}
            </div>
          </div>

          {project ? (
            <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
              <div className="space-y-0.5">
                <Label>{t("projects.trackerRefreshLabel")}</Label>
                <p
                  className={
                    trackerDiagnostic ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                  }
                >
                  {trackerDiagnostic ?? t("projects.trackerRefreshHint")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refreshTracker.mutate({ id: project.id })}
                disabled={refreshTracker.isPending}
              >
                {refreshTracker.isPending && <Spinner className="size-4" />}
                {t("projects.trackerRefresh")}
              </Button>
            </div>
          ) : null}

          <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="project-build-records">{t("projects.buildRecordLoggingLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("projects.buildRecordLoggingHint")}</p>
            </div>
            <Switch
              id="project-build-records"
              checked={buildRecordLogging}
              onCheckedChange={setBuildRecordLogging}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("projects.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || saving} data-testid="project-save">
              {saving && <Spinner className="size-4" />}
              {t(saving ? "projects.saving" : "projects.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
