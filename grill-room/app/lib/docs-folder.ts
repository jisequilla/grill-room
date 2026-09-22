/**
 * Every code `set-docs-folder` and `create-session` refuse a docs folder with.
 * The refusals are about how wide the folder is, so each gets its own sentence
 * rather than a shared "invalid path": the user has to know which way to move.
 */
export const DOCS_FOLDER_ERROR_KEY: Record<string, string> = {
  "folder-not-absolute": "workspace.docsFolderNotAbsolute",
  "folder-not-found": "workspace.docsFolderNotFound",
  "folder-not-directory": "workspace.docsFolderNotDirectory",
  "folder-is-root": "workspace.docsFolderIsRoot",
  "folder-is-home": "workspace.docsFolderIsHome",
  "folder-contains-app": "workspace.docsFolderContainsApp",
};
