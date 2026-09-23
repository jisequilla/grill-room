import type {
  ProjectTrackerKind,
  ProjectVisibility,
} from "@shared/session-constants";

/** One registered project, as `list-projects` returns it. */
export type Project = AgentNativeActionRegistry["list-projects"]["result"][number];

export type ProjectField = "root" | "verifyCommand" | "exportFolder" | "slugPattern";

/**
 * Every code the project registry refuses with, mapped to the field it belongs
 * beside and the sentence shown there, so a refusal lands where it can be fixed.
 */
export const PROJECT_ERROR: Record<string, { field: ProjectField; key: string }> = {
  "root-required": { field: "root", key: "projects.rootRequired" },
  "folder-not-absolute": { field: "root", key: "projects.folderNotAbsolute" },
  "folder-not-found": { field: "root", key: "projects.folderNotFound" },
  "folder-not-directory": { field: "root", key: "projects.folderNotDirectory" },
  "not-a-git-repo": { field: "root", key: "projects.notAGitRepo" },
  "git-unavailable": { field: "root", key: "projects.gitUnavailable" },
  "project-exists": { field: "root", key: "projects.projectExists" },
  "verify-command-required": {
    field: "verifyCommand",
    key: "projects.verifyCommandRequired",
  },
  "export-folder-required": {
    field: "exportFolder",
    key: "projects.exportFolderRequired",
  },
  "export-folder-outside-root": {
    field: "exportFolder",
    key: "projects.exportFolderOutsideRoot",
  },
  "export-folder-is-root": {
    field: "exportFolder",
    key: "projects.exportFolderIsRoot",
  },
  "invalid-slug-pattern": {
    field: "slugPattern",
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

/** Radix Select reserves the empty string, so "no project" needs a value of its own. */
export const NO_PROJECT = "none";
