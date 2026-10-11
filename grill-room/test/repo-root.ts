import path from "node:path";
import { fileURLToPath } from "node:url";

/** The environment variable naming the repository root, for copies of the app that live elsewhere. */
export const REPO_ROOT_ENV = "GRILL_ROOM_REPO_ROOT";

const APP_DIRECTORY = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

/**
 * The repository that holds this app, for tests that compare against files
 * outside it (the upstream skills, the review-loop workflow). It is the app's
 * parent directory, unless `GRILL_ROOM_REPO_ROOT` names it: Stryker runs the
 * suite in a sandbox copy at `.stryker-tmp/sandbox-*`, whose parent is not the
 * repository, so `stryker.config.mjs` sets the variable before the dry run.
 */
export const REPO_ROOT =
  process.env[REPO_ROOT_ENV] ?? path.dirname(APP_DIRECTORY);

export const repoPath = (...segments: string[]): string =>
  path.join(REPO_ROOT, ...segments);
