import type {
  SessionAnsweringMode,
  SessionModel,
} from "@shared/session-constants";

export const MODEL_LABEL_KEY: Record<SessionModel, string> = {
  fable: "sessions.modelFable",
  opus: "sessions.modelOpus",
  sonnet: "sessions.modelSonnet",
};

export const ANSWERING_MODE_LABEL_KEY: Record<SessionAnsweringMode, string> =
  {
    "whole-round": "sessions.answeringModeWholeRound",
    "one-at-a-time": "sessions.answeringModeOneAtATime",
  };
