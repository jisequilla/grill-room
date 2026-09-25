/**
 * The project registry: the one entry point for creating or editing a project.
 *
 * Every caller — the actions behind the settings form, and the command-line
 * recipe that registers a project from a shell — goes through
 * {@link registerProject} and {@link updateProject}, so required fields, git
 * root resolution and every refusal behave identically wherever a project
 * comes from. Nothing here depends on HTTP: it is plain async functions over
 * the database and read-only git, callable from any Node code.
 *
 * The repo's declared tracker (`server/tracker.ts`) is read only by
 * {@link registerProject} and {@link refreshProjectTracker}; {@link
 * updateProject} never re-reads it, so editing a project cannot change its
 * stored tracker commands or diagnostic out from under the operator.
 *
 * Refusals are returned, not thrown, as `{ refusal: { errorCode, message } }`,
 * in the style of `resolveDocsFolder`. The caller decides how to surface one.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";

import {
  DEFAULT_PROJECT_SLUG_PATTERN,
  DELIVERY_RECIPES,
  PROJECT_TRACKER_KINDS,
  PROJECT_VISIBILITIES,
  type DeliveryRecipe,
  type ProjectTrackerKind,
  type ProjectVisibility,
} from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";
import { GitUnavailableError, runGit } from "./git.js";
import { readProjectTracker } from "./tracker.js";

export type Project = typeof schema.projects.$inferSelect;

export type ProjectErrorCode =
  | "root-required"
  | "verify-command-required"
  | "export-folder-required"
  | "folder-not-absolute"
  | "folder-not-found"
  | "folder-not-directory"
  | "not-a-git-repo"
  | "git-unavailable"
  | "export-folder-outside-root"
  | "export-folder-is-root"
  | "invalid-slug-pattern"
  | "invalid-tracker-kind"
  | "invalid-visibility"
  | "invalid-delivery-recipe"
  | "project-exists"
  | "project-not-found";

export interface ProjectRefusal {
  errorCode: ProjectErrorCode;
  message: string;
}

type Refused = { refusal: ProjectRefusal };

function refuse(errorCode: ProjectErrorCode, message: string): Refused {
  return { refusal: { errorCode, message } };
}

/**
 * The fields of a project as a caller supplies them. Loose on purpose: a
 * command line hands over whatever flags it was given, so every field is
 * checked here rather than trusted to a schema in front of this module.
 */
export interface ProjectInput {
  /** Any absolute folder inside the repository; resolved to its git top-level. */
  root?: string | null;
  /** Defaults to the root folder's name. */
  name?: string | null;
  verifyCommand?: string | null;
  /** Relative to the root, or an absolute path inside it. */
  exportFolder?: string | null;
  /** Defaults to {@link DEFAULT_PROJECT_SLUG_PATTERN}. */
  slugPattern?: string | null;
  /** `beads` or `markdown`; defaults to `markdown`. */
  trackerKind?: string | null;
  /** Defaults to false. */
  buildRecordLogging?: boolean | null;
  /** `tracked` or `ignored`; seeded from `git check-ignore` when omitted. */
  visibility?: string | null;
  /**
   * `pull-request` or `local-merge`; guessed from the repository's remotes
   * (registration only) when omitted.
   */
  deliveryRecipe?: string | null;
  /** Defaults to true. */
  adversarialReview?: boolean | null;
}

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

/** `~` alone, or `~/...`, expands to the user's home directory. */
function expandHome(folder: string): string {
  if (folder === "~") return os.homedir();
  if (folder.startsWith("~/")) return path.join(os.homedir(), folder.slice(2));
  return folder;
}

/**
 * Resolve any folder inside a git working tree to the tree's top-level, with
 * read-only `git rev-parse --show-toplevel`. A folder outside every git
 * repository is refused: a project's identity is its repository.
 *
 * The root comes back as git reports it, which is the real path — on macOS a
 * folder under `/var` resolves to `/private/var`.
 */
export async function resolveGitRoot(
  folder: string,
): Promise<{ root: string } | Refused> {
  const expanded = expandHome(folder.trim());
  if (!path.isAbsolute(expanded)) {
    return refuse(
      "folder-not-absolute",
      `The project root must be an absolute path: ${folder}`,
    );
  }
  const resolved = path.resolve(expanded);

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    return refuse("folder-not-found", `The project root does not exist: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    return refuse(
      "folder-not-directory",
      `The project root is not a directory: ${resolved}`,
    );
  }

  let result;
  try {
    result = await runGit(resolved, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof GitUnavailableError) {
      return refuse("git-unavailable", error.message);
    }
    throw error;
  }

  const root = result.stdout.trim();
  if (result.exitCode !== 0 || root.length === 0) {
    const reason = result.stderr.trim().split("\n")[0];
    return refuse(
      "not-a-git-repo",
      `The project root is not inside a git repository: ${resolved}${reason ? ` (${reason})` : ""}`,
    );
  }
  return { root: path.resolve(root) };
}

/**
 * Normalise an export folder to a path relative to `root`, in forward-slash
 * form. An absolute path is accepted when it lies inside the root. The folder
 * does not need to exist: export creates it.
 */
export function normalizeExportFolder(
  root: string,
  exportFolder: string,
): { exportFolder: string } | Refused {
  const trimmed = exportFolder.trim();
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);
  const relative = path.relative(root, absolute);

  if (relative === "") {
    return refuse(
      "export-folder-is-root",
      "The export folder must be a folder inside the repository, not its root.",
    );
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return refuse(
      "export-folder-outside-root",
      `The export folder must be inside the project root: ${exportFolder}`,
    );
  }
  return { exportFolder: relative.split(path.sep).join("/") };
}

/**
 * Seed the visibility flag from read-only `git check-ignore` on the export
 * folder: `ignored` when the repository ignores it, `tracked` otherwise. The
 * folder is asked about with a trailing slash so a directory-only pattern such
 * as `.scratch/` matches even before the folder exists.
 */
export async function seedVisibility(
  root: string,
  exportFolder: string,
): Promise<ProjectVisibility> {
  const result = await runGit(root, ["check-ignore", "-q", "--", `${exportFolder}/`]);
  return result.exitCode === 0 ? "ignored" : "tracked";
}

/**
 * Guess a project's delivery recipe from its repository's remotes, with
 * read-only `git remote -v`: any remote (even a `pushurl`-only or URL-less
 * stanza — anything `git remote -v` prints a line for) means work can reach
 * a forge, so `pull-request`; none means `local-merge`. A non-zero exit —
 * `remote -v` failed rather than answered, e.g. a broken `.git/config` —
 * also guesses `pull-request`: the safer default, and the same one existing
 * rows migrated to, rather than silently falling through to the less safe
 * `local-merge` for a failure nobody is told about. Only registration calls
 * this — an explicit value always wins, and editing a project never
 * re-guesses.
 */
export async function guessDeliveryRecipe(root: string): Promise<DeliveryRecipe> {
  const result = await runGit(root, ["remote", "-v"]);
  if (result.exitCode !== 0) return "pull-request";
  return result.stdout.trim().length > 0 ? "pull-request" : "local-merge";
}

/** Recipe or script names that usually mean "verify everything", most specific first. */
const VERIFY_TARGETS = ["verify", "check", "test"] as const;

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Names defined at the start of a line as `name:` or `name args:`, excluding `name :=` assignments. */
function definedTargets(source: string): Set<string> {
  const names = new Set<string>();
  for (const line of source.split("\n")) {
    const match = /^@?([A-Za-z0-9_][A-Za-z0-9_.-]*)(?:\s[^:\n]*)?:(?!=)/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

function fromJustfile(root: string): string | null {
  for (const name of ["justfile", "Justfile", ".justfile"]) {
    const source = readIfPresent(path.join(root, name));
    if (source === null) continue;
    const targets = definedTargets(source);
    const target = VERIFY_TARGETS.find((candidate) => targets.has(candidate));
    return target ? `just ${target}` : null;
  }
  return null;
}

function packageManager(root: string): string {
  if (readIfPresent(path.join(root, "pnpm-lock.yaml")) !== null) return "pnpm";
  if (readIfPresent(path.join(root, "yarn.lock")) !== null) return "yarn";
  if (
    readIfPresent(path.join(root, "bun.lock")) !== null ||
    readIfPresent(path.join(root, "bun.lockb")) !== null
  ) {
    return "bun";
  }
  return "npm";
}

function fromPackageJson(root: string): string | null {
  const source = readIfPresent(path.join(root, "package.json"));
  if (source === null) return null;
  let scripts: unknown;
  try {
    scripts = (JSON.parse(source) as { scripts?: unknown }).scripts;
  } catch {
    return null;
  }
  if (typeof scripts !== "object" || scripts === null) return null;
  const target = VERIFY_TARGETS.find(
    (candidate) => typeof (scripts as Record<string, unknown>)[candidate] === "string",
  );
  if (!target) return null;
  const manager = packageManager(root);
  return target === "test" ? `${manager} test` : `${manager} run ${target}`;
}

function fromMakefile(root: string): string | null {
  for (const name of ["GNUmakefile", "makefile", "Makefile"]) {
    const source = readIfPresent(path.join(root, name));
    if (source === null) continue;
    const targets = definedTargets(source);
    const target = VERIFY_TARGETS.find((candidate) => targets.has(candidate));
    return target ? `make ${target}` : null;
  }
  return null;
}

/**
 * Suggest a verify command from the build files at the repository root, or
 * null when none offers one. Only a default for the form: the operator
 * confirms or replaces it.
 *
 * Precedence, first match wins:
 *   1. justfile — `just verify`, `just check`, `just test`. A justfile is
 *      usually the layer that orchestrates everything else, so it goes first.
 *   2. package.json scripts — `verify`, `check`, `test`, run with the package
 *      manager its lockfile names (pnpm, yarn, bun, else npm).
 *   3. Makefile — `make verify`, `make check`, `make test`.
 * Within each file the same order applies: `verify`, then `check`, then `test`.
 */
export function suggestVerifyCommand(root: string): string | null {
  return fromJustfile(root) ?? fromPackageJson(root) ?? fromMakefile(root);
}

export interface ProjectFolderInspection {
  root: string;
  /** The root folder's name, the default project name. */
  name: string;
  verifyCommand: string | null;
  /** Seeded visibility for `exportFolder`, or null when no export folder was given. */
  visibility: ProjectVisibility | null;
  /** The export folder normalised against the root, or null when none was given. */
  exportFolder: string | null;
  /** From a valid declared tracker's `tickets_dir`; pre-fills a blank export folder. */
  trackerExportFolder: string | null;
  /** From a valid declared tracker's `ticket_format`; pre-fills a blank slug pattern. */
  trackerSlugPattern: string | null;
}

/**
 * Everything registration would detect about a folder, without registering it:
 * the resolved root, a default name, a suggested verify command, a declared
 * tracker's export folder and slug pattern suggestion when it has a valid one,
 * and — given an export folder — its seeded visibility. The form pre-fills
 * itself from this; an explicit value the operator has typed always wins over
 * a suggestion.
 */
export async function inspectProjectFolder(
  folder: string,
  exportFolder?: string | null,
): Promise<ProjectFolderInspection | Refused> {
  const resolved = await resolveGitRoot(folder);
  if ("refusal" in resolved) return resolved;
  const { root } = resolved;

  let normalizedExport: string | null = null;
  let visibility: ProjectVisibility | null = null;
  if (!blank(exportFolder)) {
    const normalized = normalizeExportFolder(root, exportFolder as string);
    if ("refusal" in normalized) return normalized;
    normalizedExport = normalized.exportFolder;
    visibility = await seedVisibility(root, normalizedExport);
  }

  const tracker = readProjectTracker(root);

  return {
    root,
    name: path.basename(root),
    verifyCommand: suggestVerifyCommand(root),
    visibility,
    exportFolder: normalizedExport,
    trackerExportFolder: tracker.kind === "valid" ? tracker.tracker.ticketsDir : null,
    trackerSlugPattern: tracker.kind === "valid" ? tracker.tracker.ticketFormat : null,
  };
}

function checkSlugPattern(pattern: string): Refused | null {
  if (/[\\/]/.test(pattern) || pattern.includes("..")) {
    return refuse(
      "invalid-slug-pattern",
      `The slug pattern names one folder, so it cannot contain a path separator or "..": ${pattern}`,
    );
  }
  return null;
}

function checkTrackerKind(kind: string): ProjectTrackerKind | Refused {
  return (PROJECT_TRACKER_KINDS as readonly string[]).includes(kind)
    ? (kind as ProjectTrackerKind)
    : refuse(
        "invalid-tracker-kind",
        `The tracker kind must be one of ${PROJECT_TRACKER_KINDS.join(", ")}: ${kind}`,
      );
}

function checkVisibility(visibility: string): ProjectVisibility | Refused {
  return (PROJECT_VISIBILITIES as readonly string[]).includes(visibility)
    ? (visibility as ProjectVisibility)
    : refuse(
        "invalid-visibility",
        `The visibility must be one of ${PROJECT_VISIBILITIES.join(", ")}: ${visibility}`,
      );
}

function checkDeliveryRecipe(recipe: string): DeliveryRecipe | Refused {
  return (DELIVERY_RECIPES as readonly string[]).includes(recipe)
    ? (recipe as DeliveryRecipe)
    : refuse(
        "invalid-delivery-recipe",
        `The delivery recipe must be one of ${DELIVERY_RECIPES.join(", ")}: ${recipe}`,
      );
}

/**
 * What `updateProject`'s merge carries forward for `deliveryRecipe`: the
 * patch when it is a recognized recipe, the existing value otherwise. A
 * blank patch (which `??` lets through unlike `undefined`/`null`) or an
 * unrecognized one is ignored rather than passed to `validate()` — where a
 * blank value there means "guess it". The action's `z.enum` already keeps
 * either case from reaching here through `update-project`; this is what
 * makes "editing never re-guesses" (see `guessDeliveryRecipe` and
 * `AGENTS.md`) true of this function's own contract, not just the action
 * layered in front of it.
 */
function sanitizedDeliveryRecipePatch(
  patch: string | null | undefined,
  existing: DeliveryRecipe,
): DeliveryRecipe {
  if (blank(patch)) return existing;
  const trimmed = (patch as string).trim();
  return (DELIVERY_RECIPES as readonly string[]).includes(trimmed)
    ? (trimmed as DeliveryRecipe)
    : existing;
}

async function findByRoot(root: string): Promise<Project | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.rootPath, root))
    .limit(1);
  return row;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  return row;
}

/** Every registered project, by name. */
export async function listProjects(): Promise<Project[]> {
  return getDb()
    .select()
    .from(schema.projects)
    .orderBy(schema.projects.name, schema.projects.id);
}

type ProjectValues = Omit<Project, "id" | "createdAt" | "updatedAt">;

/**
 * Validate a complete set of fields and resolve them to what is stored. Shared
 * by registration and editing, which differ only in where missing fields come
 * from: defaults for a new project, the stored row for an existing one; and in
 * whether the repo's declared tracker is read (`readTracker`) — only
 * registration and the explicit refresh action read it; an ordinary edit
 * carries the stored tracker fields over unchanged.
 */
async function validate(
  input: ProjectInput,
  existing: Project | undefined,
  options: { readTracker?: boolean } = {},
): Promise<{ values: ProjectValues } | Refused> {
  if (blank(input.root)) {
    return refuse("root-required", "A project needs a root folder.");
  }
  if (blank(input.verifyCommand)) {
    return refuse("verify-command-required", "A project needs a verify command.");
  }

  const resolved = await resolveGitRoot(input.root as string);
  if ("refusal" in resolved) return resolved;
  const { root } = resolved;

  // The declared tracker is read only at registration (and by the explicit
  // refresh action, which does not go through this function). Everywhere
  // else the stored values are carried over untouched.
  const tracker = options.readTracker ? readProjectTracker(root) : null;
  const trackerCommandsJson =
    tracker === null
      ? (existing?.trackerCommandsJson ?? null)
      : tracker.kind === "valid"
        ? JSON.stringify(tracker.tracker.commands)
        : null;
  const trackerDiagnostic =
    tracker === null
      ? (existing?.trackerDiagnostic ?? null)
      : tracker.kind === "invalid"
        ? tracker.diagnostic
        : null;
  const trackerExportFolder = tracker?.kind === "valid" ? tracker.tracker.ticketsDir : null;
  const trackerSlugPattern = tracker?.kind === "valid" ? tracker.tracker.ticketFormat : null;

  // Explicit input always wins; a valid tracker only fills a field the
  // caller left blank.
  const exportFolderInput = blank(input.exportFolder) ? trackerExportFolder : input.exportFolder;
  if (blank(exportFolderInput)) {
    return refuse("export-folder-required", "A project needs an export folder.");
  }

  const normalized = normalizeExportFolder(root, exportFolderInput as string);
  if ("refusal" in normalized) return normalized;
  const { exportFolder } = normalized;

  const slugPatternInput = blank(input.slugPattern) ? trackerSlugPattern : input.slugPattern;
  const slugPattern = blank(slugPatternInput)
    ? DEFAULT_PROJECT_SLUG_PATTERN
    : (slugPatternInput as string).trim();
  const slugRefusal = checkSlugPattern(slugPattern);
  if (slugRefusal) return slugRefusal;

  const trackerKind = checkTrackerKind(
    blank(input.trackerKind) ? "markdown" : (input.trackerKind as string).trim(),
  );
  if (typeof trackerKind !== "string") return trackerKind;

  let visibility: ProjectVisibility;
  if (blank(input.visibility)) {
    visibility = await seedVisibility(root, exportFolder);
  } else {
    const checked = checkVisibility((input.visibility as string).trim());
    if (typeof checked !== "string") return checked;
    visibility = checked;
  }

  // Guessed from the repository's remotes only when the caller gives none;
  // an edit always carries the existing value forward through `merged` in
  // `updateProject`, so this only guesses at registration.
  let deliveryRecipe: DeliveryRecipe;
  if (blank(input.deliveryRecipe)) {
    deliveryRecipe = await guessDeliveryRecipe(root);
  } else {
    const checked = checkDeliveryRecipe((input.deliveryRecipe as string).trim());
    if (typeof checked !== "string") return checked;
    deliveryRecipe = checked;
  }

  const clash = await findByRoot(root);
  if (clash && clash.id !== existing?.id) {
    return refuse(
      "project-exists",
      `A project is already registered for ${root}: ${clash.name}`,
    );
  }

  return {
    values: {
      name: blank(input.name) ? path.basename(root) : (input.name as string).trim(),
      rootPath: root,
      verifyCommand: (input.verifyCommand as string).trim(),
      exportFolder,
      slugPattern,
      trackerKind,
      buildRecordLogging: input.buildRecordLogging ?? false,
      visibility,
      deliveryRecipe,
      adversarialReview: input.adversarialReview ?? true,
      trackerCommandsJson,
      trackerDiagnostic,
    },
  };
}

/**
 * Register a project. Root, verify command and export folder are required;
 * the rest default. The root is resolved to its git top-level, the visibility
 * flag is seeded from `git check-ignore` unless given, and the repo's
 * declared tracker (if any) is read once to pre-fill a blank export folder or
 * slug pattern and to store its commands and diagnostic.
 */
export async function registerProject(
  input: ProjectInput,
): Promise<{ project: Project } | Refused> {
  const outcome = await validate(input, undefined, { readTracker: true });
  if ("refusal" in outcome) return outcome;

  const now = new Date().toISOString();
  const [project] = await getDb()
    .insert(schema.projects)
    .values({ id: randomUUID(), ...outcome.values, createdAt: now, updatedAt: now })
    .returning();
  return { project };
}

/**
 * Edit a project. Fields left undefined (or null) keep their stored value;
 * the merged result is validated exactly as registration validates it, so an
 * edit can never store what registration would refuse. The visibility flag is
 * not re-seeded on edit: once registered it is the operator's to change.
 */
export async function updateProject(
  id: string,
  patch: ProjectInput,
): Promise<{ project: Project } | Refused> {
  const existing = await getProject(id);
  if (!existing) {
    return refuse("project-not-found", `Project not found: ${id}`);
  }

  const merged: ProjectInput = {
    root: patch.root ?? existing.rootPath,
    name: patch.name ?? existing.name,
    verifyCommand: patch.verifyCommand ?? existing.verifyCommand,
    exportFolder: patch.exportFolder ?? existing.exportFolder,
    slugPattern: patch.slugPattern ?? existing.slugPattern,
    trackerKind: patch.trackerKind ?? existing.trackerKind,
    buildRecordLogging: patch.buildRecordLogging ?? existing.buildRecordLogging,
    visibility: patch.visibility ?? existing.visibility,
    deliveryRecipe: sanitizedDeliveryRecipePatch(patch.deliveryRecipe, existing.deliveryRecipe),
    adversarialReview: patch.adversarialReview ?? existing.adversarialReview,
  };

  const outcome = await validate(merged, existing, { readTracker: false });
  if ("refusal" in outcome) return outcome;

  const [project] = await getDb()
    .update(schema.projects)
    .set({ ...outcome.values, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, id))
    .returning();
  return { project };
}

/**
 * Re-read a project's declared tracker and update only what it governs: the
 * stored commands and diagnostic always, and the export folder and slug
 * pattern only when the tracker is valid. Nothing else about the project
 * changes, and nothing else in this module re-reads the tracker file — every
 * other edit carries the stored tracker fields over untouched.
 */
export async function refreshProjectTracker(
  id: string,
): Promise<{ project: Project } | Refused> {
  const existing = await getProject(id);
  if (!existing) {
    return refuse("project-not-found", `Project not found: ${id}`);
  }

  const tracker = readProjectTracker(existing.rootPath);
  const patch: Partial<ProjectValues> = {
    trackerCommandsJson: tracker.kind === "valid" ? JSON.stringify(tracker.tracker.commands) : null,
    trackerDiagnostic: tracker.kind === "invalid" ? tracker.diagnostic : null,
  };

  if (tracker.kind === "valid") {
    const normalized = normalizeExportFolder(existing.rootPath, tracker.tracker.ticketsDir);
    if (!("refusal" in normalized)) patch.exportFolder = normalized.exportFolder;

    const slugRefusal = checkSlugPattern(tracker.tracker.ticketFormat);
    if (!slugRefusal) patch.slugPattern = tracker.tracker.ticketFormat;
  }

  const [project] = await getDb()
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, id))
    .returning();
  return { project };
}
