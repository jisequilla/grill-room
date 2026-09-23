import { useT } from "@agent-native/core/client/i18n";
import { IconPencil } from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  changeDraft,
  READING,
  saveIdeaEdit,
  startEditing,
  type IdeaEditError,
  type IdeaEditState,
} from "@/lib/idea-edit";
import { cn } from "@/lib/utils";

/**
 * The idea the whole session is grilling, rendered to be read rather than
 * glanced at. It is deliberately not the page's heading — the shell header
 * already carries the session title, and two competing titles reads worse than
 * one long sentence.
 *
 * Before the first round it can be edited in place. Saving clears the
 * readiness judgment on the server, which described the old idea.
 */
export function SessionIdea({
  idea,
  canEdit = false,
  onSave,
}: {
  idea: string;
  /** No round yet and no turn working: the only time the idea may change. */
  canEdit?: boolean;
  onSave?: (idea: string) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<IdeaEditState>(READING);
  const [saving, setSaving] = useState(false);

  // A round opening or a turn starting elsewhere ends the chance to edit; the
  // open editor goes with it rather than offering a save that would be refused.
  if (edit.mode === "editing" && canEdit && onSave) {
    return (
      <IdeaEditor
        draft={edit.draft}
        error={edit.error}
        saving={saving}
        onChange={(draft) => setEdit(changeDraft(draft))}
        onCancel={() => setEdit(READING)}
        onSave={async () => {
          setSaving(true);
          try {
            setEdit(await saveIdeaEdit(edit.draft, onSave));
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  return (
    <IdeaText
      idea={idea}
      onEdit={canEdit && onSave ? () => setEdit(startEditing(idea)) : null}
    />
  );
}

function IdeaText({
  idea,
  onEdit,
}: {
  idea: string;
  onEdit: (() => void) | null;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // Only measurable while clamped: expanding removes the overflow that proves
  // the toggle is needed, so the answer is kept rather than recomputed.
  useLayoutEffect(() => {
    if (expanded) return;
    const element = ref.current;
    if (!element) return;

    function measure() {
      if (!element) return;
      setClipped(element.scrollHeight > element.clientHeight + 1);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, idea]);

  return (
    <div className="flex max-w-3xl flex-col items-start gap-0.5">
      <p
        ref={ref}
        data-testid="session-idea"
        className={cn(
          "text-[15px] leading-relaxed text-foreground/90",
          !expanded && "line-clamp-2",
        )}
      >
        {idea}
      </p>
      {clipped || onEdit ? (
        <div className="-ml-2 flex items-center gap-1">
          {clipped ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {t(expanded ? "workspace.ideaLess" : "workspace.ideaMore")}
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onEdit}
              data-testid="idea-edit"
            >
              <IconPencil className="size-3.5" />
              {t("workspace.ideaEdit")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IdeaEditor({
  draft,
  error,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: string;
  error: IdeaEditError | null;
  saving: boolean;
  onChange: (draft: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const errorMessage = error
    ? error.code === "idea-required"
      ? t("workspace.ideaRequired")
      : (error.message ?? t("workspace.ideaSaveFailed"))
    : null;

  return (
    <form
      className="flex max-w-3xl flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <Textarea
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t("workspace.ideaLabel")}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={errorMessage ? "idea-edit-error" : undefined}
        disabled={saving}
        rows={4}
        autoFocus
        data-testid="idea-textarea"
      />
      {errorMessage ? (
        <p
          id="idea-edit-error"
          className="text-sm text-destructive"
          data-testid="idea-error"
        >
          {errorMessage}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving} data-testid="idea-save">
          {saving && <Spinner className="size-4" />}
          {t(saving ? "workspace.ideaSaving" : "workspace.ideaSave")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={onCancel}
          data-testid="idea-cancel"
        >
          {t("workspace.ideaCancel")}
        </Button>
      </div>
    </form>
  );
}
