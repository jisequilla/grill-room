import {
  DECISION_DISPOSITION_TARGETS,
  type DecisionDispositionTarget,
} from "@shared/session-constants";

/** The targets a set-aside decision can move to: every one but its own. */
export function moveTargets(
  current: DecisionDispositionTarget,
): DecisionDispositionTarget[] {
  return DECISION_DISPOSITION_TARGETS.filter((target) => target !== current);
}

export const SET_ASIDE_KIND_LABEL_KEY: Record<DecisionDispositionTarget, string> = {
  "out-of-scope": "workspace.setAsideKindOutOfScope",
  "open-question": "workspace.setAsideKindOpenQuestion",
  "builders-call": "workspace.setAsideKindBuildersCall",
};
