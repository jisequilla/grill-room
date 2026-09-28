import {
  SESSION_ANSWERING_MODES,
  SESSION_MODELS,
  type SessionAnsweringMode,
  type SessionModel,
} from "@shared/session-constants";

export const SESSION_DRAFT_KEY = "grill-room:new-session-draft";

export interface SessionDraft {
  title: string;
  idea: string;
  /** null when the stored value is missing or not a known model: the dialog then uses its default. */
  model: SessionModel | null;
  answeringMode: SessionAnsweringMode;
  docsFolder: string;
  projectId: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseSessionDraft(raw: string | null): SessionDraft | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const model = SESSION_MODELS.find((known) => known === record.model) ?? null;
  const answeringMode =
    SESSION_ANSWERING_MODES.find((known) => known === record.answeringMode) ??
    "whole-round";
  return {
    title: text(record.title),
    idea: text(record.idea),
    model,
    answeringMode,
    docsFolder: text(record.docsFolder),
    projectId: typeof record.projectId === "string" ? record.projectId : null,
  };
}

export function hasDraftText(
  draft: Pick<SessionDraft, "title" | "idea" | "docsFolder">,
): boolean {
  return [draft.title, draft.idea, draft.docsFolder].some(
    (value) => value.trim().length > 0,
  );
}

export function withKnownProject(
  draft: SessionDraft,
  projectIds: readonly string[],
): SessionDraft {
  if (draft.projectId === null || projectIds.includes(draft.projectId)) {
    return draft;
  }
  return { ...draft, projectId: null };
}

export function readSessionDraft(
  storage: Pick<Storage, "getItem"> | undefined,
): SessionDraft | null {
  if (!storage) return null;
  try {
    const draft = parseSessionDraft(storage.getItem(SESSION_DRAFT_KEY));
    return draft && hasDraftText(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function writeSessionDraft(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  draft: SessionDraft,
): void {
  if (!storage) return;
  try {
    if (hasDraftText(draft)) {
      storage.setItem(SESSION_DRAFT_KEY, JSON.stringify(draft));
    } else {
      storage.removeItem(SESSION_DRAFT_KEY);
    }
  } catch {
    // A blocked or full storage just means no draft survives.
  }
}

export function clearSessionDraft(
  storage: Pick<Storage, "removeItem"> | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_DRAFT_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
