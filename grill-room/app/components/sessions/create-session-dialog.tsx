import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ProjectSelect } from "@/components/projects/project-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { actionErrorCode } from "@/lib/decisions";
import { DOCS_FOLDER_ERROR_KEY } from "@/lib/docs-folder";
import {
  ANSWERING_MODE_LABEL_KEY,
  MODEL_LABEL_KEY,
} from "@/lib/session-labels";

import {
  SESSION_ANSWERING_MODES,
  SESSION_MODELS,
  type SessionAnsweringMode,
  type SessionModel,
} from "@shared/session-constants";

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The global default model, pre-filling the picker once it has loaded. */
  defaultModel: SessionModel | undefined;
  onCreated: (sessionId: string) => void;
}

export function CreateSessionDialog({
  open,
  onOpenChange,
  defaultModel,
  onCreated,
}: CreateSessionDialogProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [model, setModel] = useState<SessionModel>(defaultModel ?? "fable");
  const [answeringMode, setAnsweringMode] =
    useState<SessionAnsweringMode>("whole-round");
  const [docsFolder, setDocsFolder] = useState("");
  const [docsFolderError, setDocsFolderError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Reset the form to a clean slate, pre-filled with the current global
  // default model, every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setIdea("");
    setAnsweringMode("whole-round");
    setDocsFolder("");
    setDocsFolderError(null);
    setProjectId(null);
    setModel(defaultModel ?? "fable");
  }, [open, defaultModel]);

  const { mutate, isPending } = useActionMutation("create-session", {
    onSuccess: (session: { id: string }) => {
      onOpenChange(false);
      onCreated(session.id);
    },
    onError: (error: unknown) => {
      // A refused docs folder belongs beside the field that caused it; the
      // dialog stays open so the path can be corrected rather than retyped.
      const key = DOCS_FOLDER_ERROR_KEY[actionErrorCode(error) ?? ""];
      if (key) {
        setDocsFolderError(t(key));
        return;
      }
      toast.error(actionErrorMessage(error) ?? t("sessions.createFailed"));
    },
  });

  const canSubmit = title.trim().length > 0 && idea.trim().length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || isPending) return;
    setDocsFolderError(null);
    const folder = docsFolder.trim();
    mutate({
      title: title.trim(),
      idea: idea.trim(),
      model,
      answeringMode,
      ...(folder.length > 0 ? { docsFolder: folder } : {}),
      ...(projectId !== null ? { projectId } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sessions.createTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-title">{t("sessions.titleLabel")}</Label>
            <Input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("sessions.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-idea">{t("sessions.ideaLabel")}</Label>
            <Textarea
              id="session-idea"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder={t("sessions.ideaPlaceholder")}
              rows={4}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="session-model">
                {t("sessions.modelLabel")}
              </Label>
              <Select
                value={model}
                onValueChange={(value) => setModel(value as SessionModel)}
              >
                <SelectTrigger id="session-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_MODELS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(MODEL_LABEL_KEY[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("sessions.answeringModeLabel")}</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={answeringMode}
                onValueChange={(value) => {
                  if (value) setAnsweringMode(value as SessionAnsweringMode);
                }}
                className="w-full"
              >
                {SESSION_ANSWERING_MODES.map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className="flex-1 text-xs"
                  >
                    {t(ANSWERING_MODE_LABEL_KEY[value])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-docs-folder">
              {t("sessions.docsFolderLabel")}
            </Label>
            <Input
              id="session-docs-folder"
              value={docsFolder}
              onChange={(event) => {
                setDocsFolder(event.target.value);
                setDocsFolderError(null);
              }}
              placeholder={t("sessions.docsFolderPlaceholder")}
              aria-invalid={docsFolderError !== null}
              aria-describedby="session-docs-folder-hint"
              spellCheck={false}
            />
            <p
              id="session-docs-folder-hint"
              className={
                docsFolderError
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {docsFolderError ?? t("sessions.docsFolderHint")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-project">
              {t("projects.selectOptionalLabel")}
            </Label>
            <ProjectSelect
              id="session-project"
              value={projectId}
              onChange={setProjectId}
              aria-describedby="session-project-hint"
            />
            <p id="session-project-hint" className="text-xs text-muted-foreground">
              {t("projects.selectHint")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("sessions.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending && <Spinner className="size-4" />}
              {t(isPending ? "sessions.creating" : "sessions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
