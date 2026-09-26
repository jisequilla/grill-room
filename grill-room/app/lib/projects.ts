import type {
  DeliveryRecipe,
  ProjectTrackerKind,
  ProjectVisibility,
} from "@shared/session-constants";

/** One registered project, as `list-projects` returns it. */
export type Project = AgentNativeActionRegistry["list-projects"]["result"][number];

export type ProjectField =
  | "root"
  | "verifyCommand"
  | "workingExportFolder"
  | "durableExportFolder"
  | "slugPattern";

/**
 * Every code the project registry refuses with, mapped to the fields it belongs
 * beside and the sentence shown there, so a refusal lands where it can be fixed.
 * A code that concerns two fields (the export roots overlapping) lists both.
 */
export const PROJECT_ERROR: Record<string, { fields: ProjectField[]; key: string }> = {
  "root-required": { fields: ["root"], key: "projects.rootRequired" },
  "folder-not-absolute": { fields: ["root"], key: "projects.folderNotAbsolute" },
  "folder-not-found": { fields: ["root"], key: "projects.folderNotFound" },
  "folder-not-directory": { fields: ["root"], key: "projects.folderNotDirectory" },
  "not-a-git-repo": { fields: ["root"], key: "projects.notAGitRepo" },
  "git-unavailable": { fields: ["root"], key: "projects.gitUnavailable" },
  "project-exists": { fields: ["root"], key: "projects.projectExists" },
  "verify-command-required": {
    fields: ["verifyCommand"],
    key: "projects.verifyCommandRequired",
  },
  "export-folder-required": {
    fields: ["workingExportFolder"],
    key: "projects.workingExportFolderRequired",
  },
  "export-folder-outside-root": {
    fields: ["workingExportFolder"],
    key: "projects.workingExportFolderOutsideRoot",
  },
  "export-folder-is-root": {
    fields: ["workingExportFolder"],
    key: "projects.workingExportFolderIsRoot",
  },
  "durable-folder-required": {
    fields: ["durableExportFolder"],
    key: "projects.durableExportFolderRequired",
  },
  "durable-folder-outside-root": {
    fields: ["durableExportFolder"],
    key: "projects.durableExportFolderOutsideRoot",
  },
  "durable-folder-is-root": {
    fields: ["durableExportFolder"],
    key: "projects.durableExportFolderIsRoot",
  },
  "export-roots-overlap": {
    fields: ["durableExportFolder", "workingExportFolder"],
    key: "projects.exportRootsOverlap",
  },
  "invalid-slug-pattern": {
    fields: ["slugPattern"],
    key: "projects.invalidSlugPattern",
  },
};

export const TRACKER_KIND_LABEL_KEY: Record<ProjectTrackerKind, string> = {
  beads: "projects.trackerKindBeads",
  markdown: "projects.trackerKindMarkdown",
};

export const VISIBILITY_LABEL_KEY: Record<ProjectVisibility, string> = {
  tracked: "projects.visibilityTracked",
  ignored: "projects.visibilityIgnored",
};

export const DELIVERY_RECIPE_LABEL_KEY: Record<DeliveryRecipe, string> = {
  "pull-request": "projects.deliveryRecipePullRequest",
  "local-merge": "projects.deliveryRecipeLocalMerge",
};

export const DELIVERY_RECIPE_HINT_KEY: Record<DeliveryRecipe, string> = {
  "pull-request": "projects.deliveryRecipePullRequestHint",
  "local-merge": "projects.deliveryRecipeLocalMergeHint",
};

/** Radix Select reserves the empty string, so "no project" needs a value of its own. */
export const NO_PROJECT = "none";
