import { actionErrorCode } from "@/lib/decisions";

/**
 * Editing a session's idea in place, kept apart from the component so the flow
 * (open, save through `update-session-idea`, keep an empty idea open with its
 * reason, close on success) is testable without a DOM.
 */
export type IdeaEditState =
  | { mode: "reading" }
  | {
      mode: "editing";
      draft: string;
      /** Why the last save was refused; null until a save fails. */
      error: IdeaEditError | null;
    };

export interface IdeaEditError {
  code: string;
  message: string | null;
}

export const READING: IdeaEditState = { mode: "reading" };

export function startEditing(idea: string): IdeaEditState {
  return { mode: "editing", draft: idea, error: null };
}

export function changeDraft(draft: string): IdeaEditState {
  return { mode: "editing", draft, error: null };
}

/**
 * Saves the draft through `save` and returns the state to show next: reading
 * once the idea is stored, still editing with the refusal otherwise, so an
 * empty idea (`idea-required`) is corrected where it was typed.
 */
export async function saveIdeaEdit(
  draft: string,
  save: (idea: string) => Promise<unknown>,
): Promise<IdeaEditState> {
  try {
    await save(draft);
    return READING;
  } catch (error) {
    return {
      mode: "editing",
      draft,
      error: {
        code: actionErrorCode(error) ?? "failed",
        message: error instanceof Error && error.message ? error.message : null,
      },
    };
  }
}
