import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  clearSessionDraft,
  hasDraftText,
  readSessionDraft,
  withKnownProject,
  writeSessionDraft,
  type SessionDraft,
} from "@/lib/session-draft";
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

type SessionForm = Omit<SessionDraft, "model"> & { model: SessionModel };

function emptyForm(defaultModel: SessionModel | undefined): SessionForm {
  return {
    title: "",
    idea: "",
    model: defaultModel ?? "fable",
    answeringMode: "whole-round",
    docsFolder: "",
    projectId: null,
  };
}

/** `window.localStorage`, or undefined where reading it throws (some private modes). */
function draftStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function CreateSessionDialog({
  open,
  onOpenChange,
  defaultModel,
  onCreated,
}: CreateSessionDialogProps) {
  const t = useT();
  const [form, setForm] = useState<SessionForm>(() =>
    emptyForm(defaultModel),
  );
  const [docsFolderError, setDocsFolderError] = useState<string | null>(null);
  const { data: projects } = useActionQuery("list-projects", {});

  // The latest form, so two quick edits never write a stale draft.
  const formRef = useRef(form);
  // Whether the model in the form is the user's: a restored draft carried one,
  // or they picked one. Until then a late-arriving default may replace it.
  const modelIsUsersRef = useRef(false);
  const defaultModelRef = useRef(defaultModel);
  defaultModelRef.current = defaultModel;

  function apply(next: SessionForm) {
    formRef.current = next;
    setForm(next);
  }

  function toDraft(values: SessionForm): SessionDraft {
    return {
      ...values,
      model: modelIsUsersRef.current ? values.model : null,
    };
  }

  function update(patch: Partial<SessionForm>) {
    if (patch.model !== undefined) modelIsUsersRef.current = true;
    const next = { ...formRef.current, ...patch };
    apply(next);
    writeSessionDraft(draftStorage(), toDraft(next));
  }

  function resetForm() {
    modelIsUsersRef.current = false;
    apply(emptyForm(defaultModelRef.current));
    setDocsFolderError(null);
  }

  // Every open starts from the stored draft, or from a clean form when there is
  // none. Only edits write the draft, so this never touches storage.
  useEffect(() => {
    if (!open) return;
    const draft = readSessionDraft(draftStorage());
    if (!draft) {
      resetForm();
      return;
    }
    modelIsUsersRef.current = draft.model !== null;
    apply({
      ...draft,
      model: draft.model ?? defaultModelRef.current ?? "fable",
    });
    setDocsFolderError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The default model loads asynchronously; it fills the picker only while the
  // model is not the user's, and never touches the other fields.
  useEffect(() => {
    if (!open || modelIsUsersRef.current || defaultModel === undefined) return;
    apply({ ...formRef.current, model: defaultModel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultModel]);

  // A draft can name a project that no longer exists. Show none, without
  // rewriting storage: the next edit prunes it there too.
  useEffect(() => {
    if (!open || !projects) return;
    const known = withKnownProject(
      toDraft(formRef.current),
      projects.map((project) => project.id),
    );
    if (known.projectId !== formRef.current.projectId) {
      apply({ ...formRef.current, projectId: known.projectId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projects, form.projectId]);

  const { mutate, isPending } = useActionMutation("create-session", {
    onSuccess: (session: { id: string }) => {
      clearSessionDraft(draftStorage());
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

  const canSubmit =
    form.title.trim().length > 0 && form.idea.trim().length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || isPending) return;
    setDocsFolderError(null);
    const { title, idea, model, answeringMode, docsFolder, projectId } = form;
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
      <DialogContent
        onInteractOutside={(event) => {
          if (hasDraftText(formRef.current)) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (hasDraftText(formRef.current)) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("sessions.createTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-title">{t("sessions.titleLabel")}</Label>
            <Input
              id="session-title"
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder={t("sessions.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-idea">{t("sessions.ideaLabel")}</Label>
            <Textarea
              id="session-idea"
              value={form.idea}
              onChange={(event) => update({ idea: event.target.value })}
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
                value={form.model}
                onValueChange={(value) =>
                  update({ model: value as SessionModel })
                }
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
                value={form.answeringMode}
                onValueChange={(value) => {
                  if (value) {
                    update({ answeringMode: value as SessionAnsweringMode });
                  }
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
              value={form.docsFolder}
              onChange={(event) => {
                update({ docsFolder: event.target.value });
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
              value={form.projectId}
              onChange={(projectId) => update({ projectId })}
              aria-describedby="session-project-hint"
            />
            <p id="session-project-hint" className="text-xs text-muted-foreground">
              {t("projects.selectHint")}
            </p>
          </div>
          <DialogFooter>
            {hasDraftText(form) && (
              <Button
                type="button"
                variant="ghost"
                data-testid="discard-session-draft"
                onClick={() => {
                  clearSessionDraft(draftStorage());
                  resetForm();
                }}
              >
                {t("sessions.discardDraft")}
              </Button>
            )}
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
