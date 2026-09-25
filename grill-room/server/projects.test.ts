import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import { getDb, schema } from "./db/index.js";
import { runGit } from "./git.js";
import {
  guessDeliveryRecipe,
  inspectProjectFolder,
  listProjects,
  registerProject,
  suggestVerifyCommand,
  updateProject,
} from "./projects.js";

const repos = useTempGitRepos();

function refusalCode(outcome: object): string | undefined {
  return "refusal" in outcome
    ? (outcome as { refusal: { errorCode: string } }).refusal.errorCode
    : undefined;
}

function registered<T extends object>(outcome: T) {
  if ("refusal" in outcome) {
    throw new Error(`Expected a project, got a refusal: ${JSON.stringify(outcome)}`);
  }
  return (outcome as { project: import("./projects.js").Project }).project;
}

/** Add a bare remote to a temp repo — for delivery-recipe guessing tests only, never a write `runGit` allows. */
function addRemote(root: string, url = "https://example.invalid/repo.git"): void {
  execFileSync("git", ["-C", root, "remote", "add", "origin", url], { stdio: "ignore" });
}

describe("registerProject", () => {
  useTestDatabase();

  const required = {
    verifyCommand: "pnpm test",
    exportFolder: ".scratch",
  };

  it.each([
    ["root", "root-required"],
    ["verifyCommand", "verify-command-required"],
    ["exportFolder", "export-folder-required"],
  ] as const)("refuses a project without %s", async (field, code) => {
    const root = repos.create();
    const input = { root, ...required, [field]: "  " };

    expect(refusalCode(await registerProject(input))).toBe(code);
    expect(await listProjects()).toEqual([]);
  });

  it("refuses a folder that is not inside a git repository", async () => {
    const folder = repos.plainFolder({ "notes.md": "hello\n" });

    const outcome = await registerProject({ root: folder, ...required });

    expect(refusalCode(outcome)).toBe("not-a-git-repo");
    expect(await listProjects()).toEqual([]);
  });

  it("refuses a relative or missing root before asking git", async () => {
    expect(
      refusalCode(await registerProject({ root: "relative/repo", ...required })),
    ).toBe("folder-not-absolute");

    const missing = path.join(repos.plainFolder(), "does-not-exist");
    expect(refusalCode(await registerProject({ root: missing, ...required }))).toBe(
      "folder-not-found",
    );
  });

  it("resolves a subfolder to the repository's top level", async () => {
    const root = repos.create({ files: { "packages/app/index.ts": "export {};\n" } });

    const project = registered(
      await registerProject({ root: path.join(root, "packages", "app"), ...required }),
    );

    expect(project.rootPath).toBe(root);
  });

  it("defaults every optional field", async () => {
    const root = repos.create();

    const project = registered(await registerProject({ root, ...required }));

    expect(project).toMatchObject({
      name: path.basename(root),
      verifyCommand: "pnpm test",
      exportFolder: ".scratch",
      slugPattern: "{slug}",
      trackerKind: "markdown",
      buildRecordLogging: false,
      // No remote on this fixture, so the guessed recipe is local-merge.
      deliveryRecipe: "local-merge",
      adversarialReview: true,
    });
  });

  it("keeps the fields it is given", async () => {
    const root = repos.create();

    const project = registered(
      await registerProject({
        root,
        name: "My repo",
        verifyCommand: "just check",
        exportFolder: "docs/tickets/",
        slugPattern: "{seq}-{slug}",
        trackerKind: "beads",
        buildRecordLogging: true,
        visibility: "ignored",
        deliveryRecipe: "local-merge",
        adversarialReview: false,
      }),
    );

    expect(project).toMatchObject({
      name: "My repo",
      verifyCommand: "just check",
      exportFolder: "docs/tickets",
      slugPattern: "{seq}-{slug}",
      trackerKind: "beads",
      buildRecordLogging: true,
      visibility: "ignored",
      deliveryRecipe: "local-merge",
      adversarialReview: false,
    });
  });

  it("stores an absolute export folder inside the root as a relative one", async () => {
    const root = repos.create();

    const project = registered(
      await registerProject({ root, ...required, exportFolder: path.join(root, "out", "specs") }),
    );

    expect(project.exportFolder).toBe("out/specs");
  });

  it("refuses an export folder outside the root, or the root itself", async () => {
    const root = repos.create();

    expect(
      refusalCode(await registerProject({ root, ...required, exportFolder: "../elsewhere" })),
    ).toBe("export-folder-outside-root");
    expect(refusalCode(await registerProject({ root, ...required, exportFolder: "." }))).toBe(
      "export-folder-is-root",
    );
  });

  it("refuses a slug pattern that would nest folders", async () => {
    const root = repos.create();

    expect(
      refusalCode(await registerProject({ root, ...required, slugPattern: "{date}/{slug}" })),
    ).toBe("invalid-slug-pattern");
  });

  it("refuses an unknown tracker kind, visibility, or delivery recipe", async () => {
    const root = repos.create();

    expect(refusalCode(await registerProject({ root, ...required, trackerKind: "jira" }))).toBe(
      "invalid-tracker-kind",
    );
    expect(refusalCode(await registerProject({ root, ...required, visibility: "public" }))).toBe(
      "invalid-visibility",
    );
    expect(
      refusalCode(await registerProject({ root, ...required, deliveryRecipe: "carrier-pigeon" })),
    ).toBe("invalid-delivery-recipe");
  });

  it("refuses a second project for the same repository", async () => {
    const root = repos.create({ files: { "sub/file.txt": "x\n" } });
    registered(await registerProject({ root, ...required }));

    const outcome = await registerProject({ root: path.join(root, "sub"), ...required });

    expect(refusalCode(outcome)).toBe("project-exists");
    expect(await listProjects()).toHaveLength(1);
  });

  describe("visibility seeding", () => {
    it("seeds ignored for an export folder the repository ignores, even before it exists", async () => {
      const root = repos.create({ gitignore: ".scratch/\n" });

      const project = registered(await registerProject({ root, ...required }));

      expect(project.visibility).toBe("ignored");
    });

    it("seeds ignored for a folder nested under an ignored one", async () => {
      const root = repos.create({ gitignore: ".scratch/\n" });

      const project = registered(
        await registerProject({ root, ...required, exportFolder: ".scratch/specs" }),
      );

      expect(project.visibility).toBe("ignored");
    });

    it("seeds tracked for an export folder the repository does not ignore", async () => {
      const root = repos.create({ gitignore: "node_modules/\n" });

      const project = registered(
        await registerProject({ root, ...required, exportFolder: "docs/specs" }),
      );

      expect(project.visibility).toBe("tracked");
    });

    it("lets the caller override the seeded value", async () => {
      const root = repos.create({ gitignore: ".scratch/\n" });

      const project = registered(
        await registerProject({ root, ...required, visibility: "tracked" }),
      );

      expect(project.visibility).toBe("tracked");
    });
  });

  describe("delivery recipe guessing", () => {
    it("defaults to pull-request when the repository has a remote", async () => {
      const root = repos.create();
      addRemote(root);

      expect(await guessDeliveryRecipe(root)).toBe("pull-request");

      const project = registered(await registerProject({ root, ...required }));
      expect(project.deliveryRecipe).toBe("pull-request");
    });

    it("defaults to local-merge when the repository has no remote", async () => {
      const root = repos.create();

      expect(await guessDeliveryRecipe(root)).toBe("local-merge");

      const project = registered(await registerProject({ root, ...required }));
      expect(project.deliveryRecipe).toBe("local-merge");
    });

    it("lets an explicit value win over the guess, in either direction", async () => {
      const withRemote = repos.create();
      addRemote(withRemote);
      const explicitLocal = registered(
        await registerProject({ root: withRemote, ...required, deliveryRecipe: "local-merge" }),
      );
      expect(explicitLocal.deliveryRecipe).toBe("local-merge");

      const withoutRemote = repos.create();
      const explicitPr = registered(
        await registerProject({ root: withoutRemote, ...required, deliveryRecipe: "pull-request" }),
      );
      expect(explicitPr.deliveryRecipe).toBe("pull-request");
    });
  });

  it("a row written before this column existed reads as pull-request with review on", async () => {
    const now = new Date().toISOString();
    const [row] = await getDb()
      .insert(schema.projects)
      .values({
        id: "legacy-project",
        name: "Legacy",
        rootPath: "/legacy/repo",
        verifyCommand: "pnpm test",
        exportFolder: ".scratch",
        visibility: "tracked",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    expect(row).toMatchObject({ deliveryRecipe: "pull-request", adversarialReview: true });
  });

  it("never changes the target repository's git state", async () => {
    const root = repos.create({ gitignore: ".scratch/\n" });

    registered(await registerProject({ root, ...required }));

    const status = await runGit(root, ["status", "--porcelain", "--ignored"]);
    expect(status.stdout).toBe("");
  });

  it("registers a repository shaped like Grill Room's own with no special casing", async () => {
    // Stands in for this repository: a justfile at the root driving an app in
    // a subfolder, `.scratch/` exported into and tracked.
    const root = repos.create({
      files: {
        justfile:
          'set working-directory := "grill-room"\n\ndefault:\n    @just --list\n\ntest:\n    pnpm test\n\ncheck: typecheck test e2e\n',
        "grill-room/package.json": JSON.stringify({ scripts: { test: "vitest --run" } }),
        ".scratch/feature/spec.md": "# Spec\n",
      },
      gitignore: "node_modules/\n.claude/worktrees/\n",
    });

    const inspection = await inspectProjectFolder(path.join(root, "grill-room"), ".scratch");
    expect(inspection).toMatchObject({
      root,
      verifyCommand: "just check",
      visibility: "tracked",
      exportFolder: ".scratch",
    });

    const project = registered(
      await registerProject({
        root: path.join(root, "grill-room"),
        verifyCommand: "just check",
        exportFolder: ".scratch",
      }),
    );
    expect(project).toMatchObject({ rootPath: root, visibility: "tracked" });
  });
});

describe("suggestVerifyCommand", () => {
  it("suggests the justfile's verify recipe, preferring verify, then check, then test", () => {
    expect(suggestVerifyCommand(repos.plainFolder({ justfile: "test:\n    cargo test\n" }))).toBe(
      "just test",
    );
    expect(
      suggestVerifyCommand(
        repos.plainFolder({
          justfile: 'port := env("PORT", "8080")\n\ntest arg="":\n    x\n\ncheck: test\n    y\n',
        }),
      ),
    ).toBe("just check");
  });

  it("suggests the package.json script with the lockfile's package manager", () => {
    expect(
      suggestVerifyCommand(
        repos.plainFolder({
          "package.json": JSON.stringify({ scripts: { test: "vitest", build: "vite build" } }),
          "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        }),
      ),
    ).toBe("pnpm test");
    expect(
      suggestVerifyCommand(
        repos.plainFolder({
          "package.json": JSON.stringify({ scripts: { check: "tsc && vitest" } }),
        }),
      ),
    ).toBe("npm run check");
  });

  it("prefers the justfile over package.json, and package.json over a Makefile", () => {
    expect(
      suggestVerifyCommand(
        repos.plainFolder({
          justfile: "check:\n    pnpm test\n",
          "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
          Makefile: "test:\n\tmake-test\n",
        }),
      ),
    ).toBe("just check");
    expect(
      suggestVerifyCommand(
        repos.plainFolder({
          "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
          "yarn.lock": "",
          Makefile: "test:\n\tmake-test\n",
        }),
      ),
    ).toBe("yarn test");
  });

  it("suggests a Makefile target when nothing else offers one", () => {
    expect(
      suggestVerifyCommand(repos.plainFolder({ Makefile: "CC := gcc\n\ntest: build\n\t./run\n" })),
    ).toBe("make test");
  });

  it("suggests nothing when no build file offers a verify target", () => {
    expect(suggestVerifyCommand(repos.plainFolder({ "README.md": "hi\n" }))).toBeNull();
    expect(
      suggestVerifyCommand(repos.plainFolder({ justfile: "deploy:\n    ./deploy\n" })),
    ).toBeNull();
  });
});

describe("updateProject", () => {
  useTestDatabase();

  async function aProject() {
    const root = repos.create({ gitignore: ".scratch/\n" });
    return registered(
      await registerProject({ root, verifyCommand: "pnpm test", exportFolder: ".scratch" }),
    );
  }

  it("changes only the fields it is given", async () => {
    const project = await aProject();

    const updated = registered(
      await updateProject(project.id, { verifyCommand: "just check", trackerKind: "beads" }),
    );

    expect(updated).toMatchObject({
      id: project.id,
      rootPath: project.rootPath,
      exportFolder: ".scratch",
      verifyCommand: "just check",
      trackerKind: "beads",
      visibility: "ignored",
    });
  });

  it("does not re-seed visibility when the export folder changes", async () => {
    const project = await aProject();

    const updated = registered(await updateProject(project.id, { exportFolder: "docs" }));

    expect(updated).toMatchObject({ exportFolder: "docs", visibility: "ignored" });
  });

  it("changes the delivery recipe and the review switch, without re-guessing the recipe", async () => {
    const project = await aProject();
    expect(project.deliveryRecipe).toBe("local-merge");
    expect(project.adversarialReview).toBe(true);

    const updated = registered(
      await updateProject(project.id, { deliveryRecipe: "pull-request", adversarialReview: false }),
    );

    expect(updated).toMatchObject({ deliveryRecipe: "pull-request", adversarialReview: false });

    // Nothing else given: both settings carry over untouched.
    const untouched = registered(await updateProject(project.id, { name: "Renamed" }));
    expect(untouched).toMatchObject({ deliveryRecipe: "pull-request", adversarialReview: false });
  });

  it("refuses an unknown delivery recipe", async () => {
    const project = await aProject();

    expect(
      refusalCode(await updateProject(project.id, { deliveryRecipe: "carrier-pigeon" })),
    ).toBe("invalid-delivery-recipe");
  });

  it("refuses to blank a required field", async () => {
    const project = await aProject();

    expect(refusalCode(await updateProject(project.id, { verifyCommand: "" }))).toBe(
      "verify-command-required",
    );
  });

  it("refuses moving the root out of git", async () => {
    const project = await aProject();

    expect(refusalCode(await updateProject(project.id, { root: repos.plainFolder() }))).toBe(
      "not-a-git-repo",
    );
  });

  it("refuses an unknown project", async () => {
    expect(refusalCode(await updateProject("missing", { name: "x" }))).toBe("project-not-found");
  });
});

describe("runGit", () => {
  it("refuses any subcommand that could write", async () => {
    const root = repos.create();

    await expect(runGit(root, ["commit", "-m", "nope"])).rejects.toThrow(/read-only/);
    await expect(runGit(root, ["add", "."])).rejects.toThrow(/read-only/);
  });
});
