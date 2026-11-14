import type {
  Depth,
  SessionAnsweringMode,
  SessionModel,
  TechnicalLevel,
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

export const DEPTH_LABEL_KEY: Record<Depth, string> = {
  "proof-of-concept": "sessions.depthProofOfConcept",
  "first-working-version": "sessions.depthFirstWorkingVersion",
  "full-spec": "sessions.depthFullSpec",
};

export const DEPTH_HELP_KEY: Record<Depth, string> = {
  "proof-of-concept": "sessions.depthProofOfConceptHelp",
  "first-working-version": "sessions.depthFirstWorkingVersionHelp",
  "full-spec": "sessions.depthFullSpecHelp",
};

export const TECHNICAL_LEVEL_LABEL_KEY: Record<TechnicalLevel, string> = {
  builder: "sessions.levelBuilder",
  "technical-not-building": "sessions.levelTechnicalNotBuilding",
  "not-technical": "sessions.levelNotTechnical",
};

export const TECHNICAL_LEVEL_HELP_KEY: Record<TechnicalLevel, string> = {
  builder: "sessions.levelBuilderHelp",
  "technical-not-building": "sessions.levelTechnicalNotBuildingHelp",
  "not-technical": "sessions.levelNotTechnicalHelp",
};
