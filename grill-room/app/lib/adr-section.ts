import type { TreeDecision } from "@/lib/decisions";

const EDITABLE_KINDS = [
  "accepted-recommendation",
  "own-answer",
  "repo-established",
];

export type AdrDraft = { adrWorthy: boolean; consequences: string };

export type AdrSectionView = {
  editable: boolean;
  lockedReasonKey: string | null;
  saveEnabled: boolean;
  showRequiredHint: boolean;
  saveInput: {
    decisionId: string;
    adrWorthy: boolean;
    consequences: string;
  };
};

type AdrDecision = Pick<
  TreeDecision,
  "id" | "state" | "answer" | "replacedBy" | "adrWorthy" | "consequences"
>;

export function storedAdrDraft(decision: AdrDecision): AdrDraft {
  return {
    adrWorthy: decision.adrWorthy,
    consequences: decision.consequences ?? "",
  };
}

/**
 * What the ADR section of the decision sheet shows and sends. The editable
 * rule mirrors `set-adr-worthy`'s settled rule, so the sheet never offers a
 * save the server refuses.
 */
export function adrSectionView(
  decision: AdrDecision,
  draft: AdrDraft,
): AdrSectionView {
  const editable =
    decision.state === "settled" &&
    decision.answer !== null &&
    EDITABLE_KINDS.includes(decision.answer.kind) &&
    decision.replacedBy === null;

  const lockedReasonKey = editable
    ? null
    : decision.replacedBy
      ? "workspace.adrLockedReplaced"
      : "workspace.adrLockedNotSettled";

  const stored = storedAdrDraft(decision);
  const unchanged =
    draft.adrWorthy === stored.adrWorthy &&
    draft.consequences === stored.consequences;
  const blankFlag = draft.adrWorthy && draft.consequences.trim() === "";

  return {
    editable,
    lockedReasonKey,
    saveEnabled: editable && !blankFlag && !unchanged,
    showRequiredHint: editable && blankFlag,
    saveInput: {
      decisionId: decision.id,
      adrWorthy: draft.adrWorthy,
      consequences: draft.consequences,
    },
  };
}
