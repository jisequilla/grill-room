import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import { getDb, schema } from "./db/index.js";
import { runGit } from "./git.js";
import {
  getProject,
  hasGitRemote,
  recipeRemoteWarning,
  guessDeliveryRecipe,
  inspectProjectFolder,
  exportRootsOverlap,
  listProjects,
  recheckVisibility,
  refreshProjectTracker,
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
    workingExportFolder: ".scratch",
  };

  it.each([
    ["root", "root-required"],
    ["verifyCommand", "verify-command-required"],
    ["workingExportFolder", "export-folder-required"],
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
      workingExportFolder: ".scratch",
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
        workingExportFolder: "docs/tickets/",
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
      workingExportFolder: "docs/tickets",
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
      await registerProject({ root, ...required, workingExportFolder: path.join(root, "out", "specs") }),
    );

    expect(project.workingExportFolder).toBe("out/specs");
  });

  it("refuses an export folder outside the root, or the root itself", async () => {
    const root = repos.create();

    expect(
      refusalCode(await registerProject({ root, ...required, workingExportFolder: "../elsewhere" })),
    ).toBe("export-folder-outside-root");
    expect(refusalCode(await registerProject({ root, ...required, workingExportFolder: "." }))).toBe(
      "export-folder-is-root",
    );
  });

  describe("durable export folder", () => {
    it("defaults a blank durable folder to docs/specs", async () => {
      const root = repos.create();

      const omitted = registered(await registerProject({ root, ...required }));
      expect(omitted.durableExportFolder).toBe("docs/specs");

      const other = repos.create();
      const blanked = registered(
        await registerProject({ root: other, ...required, durableExportFolder: "  " }),
      );
      expect(blanked.durableExportFolder).toBe("docs/specs");
    });

    it("stores a given durable folder, normalised against the root", async () => {
      const root = repos.create();

      const project = registered(
        await registerProject({
          root,
          ...required,
          durableExportFolder: path.join(root, "architecture", "specs/"),
        }),
      );

      expect(project).toMatchObject({
        workingExportFolder: ".scratch",
        durableExportFolder: "architecture/specs",
      });
    });

    it("refuses a durable folder outside the root, or the root itself", async () => {
      const root = repos.create();

      expect(
        refusalCode(
          await registerProject({ root, ...required, durableExportFolder: "../elsewhere" }),
        ),
      ).toBe("durable-folder-outside-root");
      expect(
        refusalCode(await registerProject({ root, ...required, durableExportFolder: "." })),
      ).toBe("durable-folder-is-root");
      expect(await listProjects()).toEqual([]);
    });

    it.each([
      ["docs/specs", "docs/specs"],
      ["docs", "docs/specs"],
      ["docs/specs", "docs"],
      ["./docs/specs/", "docs/specs/tickets"],
    ])(
      "refuses working %s with durable %s: the roots overlap",
      async (workingExportFolder, durableExportFolder) => {
        const root = repos.create();

        const outcome = await registerProject({
          root,
          ...required,
          workingExportFolder,
          durableExportFolder,
        });

        expect(refusalCode(outcome)).toBe("export-roots-overlap");
        const message = (outcome as { refusal: { message: string } }).refusal.message;
        expect(message).toContain(path.posix.normalize(workingExportFolder).replace(/\/$/, ""));
        expect(message).toContain(durableExportFolder);
        expect(await listProjects()).toEqual([]);
      },
    );

    it.each([
      ["docs", "docs-specs"],
      ["docs-specs", "docs"],
      ["specs", "specs2"],
      [".grill-room", "docs/specs"],
    ])(
      "accepts working %s with durable %s: siblings sharing a prefix do not overlap",
      async (workingExportFolder, durableExportFolder) => {
        const root = repos.create();

        const project = registered(
          await registerProject({ root, ...required, workingExportFolder, durableExportFolder }),
        );

        expect(project).toMatchObject({ workingExportFolder, durableExportFolder });
      },
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
        await registerProject({ root, ...required, workingExportFolder: ".scratch/specs" }),
      );

      expect(project.visibility).toBe("ignored");
    });

    it("seeds tracked for an export folder the repository does not ignore", async () => {
      const root = repos.create({ gitignore: "node_modules/\n" });

      const project = registered(
        await registerProject({ root, ...required, workingExportFolder: "out/tickets" }),
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

  describe("recipe and remote", () => {
    it("hasGitRemote tells a remote, none, and not a repository apart", async () => {
      const withRemote = repos.create();
      addRemote(withRemote);
      expect(await hasGitRemote(withRemote)).toBe(true);
      expect(await hasGitRemote(repos.create())).toBe(false);

      const plain = mkdtempSync(path.join(os.tmpdir(), "no-repo-"));
      try {
        expect(await hasGitRemote(plain)).toBeNull();
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    it.each([
      ["pull-request", false, "pull-request-without-remote"],
      ["pull-request", true, null],
      ["pull-request", null, null],
      ["local-merge", false, null],
      ["local-merge", true, null],
      ["something-else", false, null],
      ["something-else", true, null],
      ["something-else", null, null],
    ] as const)("recipeRemoteWarning(%s, %s) is %s", (recipe, hasRemote, expected) => {
      expect(recipeRemoteWarning(recipe, hasRemote)).toBe(expected);
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

    it("falls back to pull-request, not local-merge, when git remote -v fails", async () => {
      const root = repos.create();
      // A broken .git/config makes every git subcommand exit non-zero with
      // empty stdout — indistinguishable from "no remotes" by stdout alone,
      // so the exit code is what must be checked.
      appendFileSync(path.join(root, ".git", "config"), "not valid ini [[[\n");

      expect(await guessDeliveryRecipe(root)).toBe("pull-request");
    });
  });

  it("defaults tickets in flight to 3 and keeps a given value", async () => {
    const omitted = registered(await registerProject({ root: repos.create(), ...required }));
    expect(omitted.maxTicketsInFlight).toBe(3);

    const nulled = registered(
      await registerProject({ root: repos.create(), ...required, maxTicketsInFlight: null }),
    );
    expect(nulled.maxTicketsInFlight).toBe(3);

    const given = registered(
      await registerProject({ root: repos.create(), ...required, maxTicketsInFlight: 5 }),
    );
    expect(given.maxTicketsInFlight).toBe(5);
    expect((await getProject(given.id))?.maxTicketsInFlight).toBe(5);
  });

  it.each([0, 11, -1, 2.5, Number.NaN])(
    "refuses tickets in flight of %s at registration, and stores nothing",
    async (value) => {
      const outcome = await registerProject({
        root: repos.create(),
        ...required,
        maxTicketsInFlight: value,
      });

      expect(outcome).toEqual({
        refusal: {
          errorCode: "invalid-max-tickets-in-flight",
          message: `Tickets in flight must be a whole number from 1 to 10: ${String(value)}`,
        },
      });
      expect(await listProjects()).toEqual([]);
    },
  );

  it("a row written before this column existed reads as pull-request with review on", async () => {
    const now = new Date().toISOString();
    const [row] = await getDb()
      .insert(schema.projects)
      .values({
        id: "legacy-project",
        name: "Legacy",
        rootPath: "/legacy/repo",
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
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
      workingExportFolder: ".scratch",
    });

    const project = registered(
      await registerProject({
        root: path.join(root, "grill-room"),
        verifyCommand: "just check",
        workingExportFolder: ".scratch",
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
      await registerProject({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" }),
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
      workingExportFolder: ".scratch",
      verifyCommand: "just check",
      trackerKind: "beads",
      visibility: "ignored",
    });
  });

  it("does not re-seed visibility when the export folder changes", async () => {
    const project = await aProject();

    const updated = registered(await updateProject(project.id, { workingExportFolder: "out" }));

    expect(updated).toMatchObject({ workingExportFolder: "out", visibility: "ignored" });
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

  it("registers preflightStep as true by default, and keeps or changes it on update", async () => {
    const project = await aProject();
    expect(project.preflightStep).toBe(true);

    const off = registered(
      await registerProject({
        root: repos.create({ gitignore: ".scratch/\n" }),
        verifyCommand: "pnpm test",
        workingExportFolder: ".scratch",
        preflightStep: false,
      }),
    );
    expect(off.preflightStep).toBe(false);

    const switchedOff = registered(await updateProject(project.id, { preflightStep: false }));
    expect(switchedOff.preflightStep).toBe(false);

    const kept = registered(await updateProject(project.id, { name: "x" }));
    expect(kept.preflightStep).toBe(false);
  });

  it("keeps a project's delegation values and proposals through an update", async () => {
    const project = await aProject();
    expect(project.delegationValuesJson).toBeNull();
    expect(project.delegationProposalsJson).toBeNull();

    const values = '{"reviewRule":{"citation":"a.md:1"}}';
    const proposals = '{"maxTicketsInFlight":{"value":3,"citation":"a.md:2"}}';
    await getDb()
      .update(schema.projects)
      .set({ delegationValuesJson: values, delegationProposalsJson: proposals })
      .where(eq(schema.projects.id, project.id));

    const renamed = registered(await updateProject(project.id, { name: "x" }));
    expect(renamed).toMatchObject({ delegationValuesJson: values, delegationProposalsJson: proposals });

    const switched = registered(await updateProject(project.id, { preflightStep: false }));
    expect(switched).toMatchObject({ delegationValuesJson: values, delegationProposalsJson: proposals });
  });

  it("changes tickets in flight and keeps it when omitted", async () => {
    const project = await aProject();
    expect(project.maxTicketsInFlight).toBe(3);

    const two = registered(await updateProject(project.id, { maxTicketsInFlight: 2 }));
    const { updatedAt: _before, maxTicketsInFlight: _was, ...rest } = project;
    const { updatedAt: _after, maxTicketsInFlight, ...restAfter } = two;
    expect(maxTicketsInFlight).toBe(2);
    expect(restAfter).toEqual(rest);

    expect(registered(await updateProject(project.id, { name: "Renamed" })).maxTicketsInFlight).toBe(2);
    expect(
      registered(await updateProject(project.id, { maxTicketsInFlight: null })).maxTicketsInFlight,
    ).toBe(2);
    expect(registered(await updateProject(project.id, { maxTicketsInFlight: 1 })).maxTicketsInFlight).toBe(1);
    expect(registered(await updateProject(project.id, { maxTicketsInFlight: 10 })).maxTicketsInFlight).toBe(10);
    expect((await getProject(project.id))?.maxTicketsInFlight).toBe(10);
  });

  it.each([0, 11, -1, 2.5, Number.NaN])(
    "refuses tickets in flight outside 1 to 10, or not whole, and stores nothing: %s",
    async (value) => {
      const project = await aProject();

      expect(await updateProject(project.id, { maxTicketsInFlight: value })).toEqual({
        refusal: {
          errorCode: "invalid-max-tickets-in-flight",
          message: `Tickets in flight must be a whole number from 1 to 10: ${String(value)}`,
        },
      });
      expect(await getProject(project.id)).toEqual(project);
    },
  );

  it("ignores a blank delivery recipe in a patch, keeping the existing value rather than re-guessing", async () => {
    const project = await aProject();
    expect(project.deliveryRecipe).toBe("local-merge");

    // A remote added after registration would flip a fresh guess to
    // pull-request; it must not flip an edit that only reaches `blank()`.
    addRemote(project.rootPath);

    const blankPatch = registered(await updateProject(project.id, { deliveryRecipe: "" }));
    expect(blankPatch.deliveryRecipe).toBe("local-merge");
  });

  it("refuses an unrecognized delivery recipe in a patch", async () => {
    const project = await aProject();
    expect(project.deliveryRecipe).toBe("local-merge");

    expect(
      refusalCode(await updateProject(project.id, { deliveryRecipe: "carrier-pigeon" })),
    ).toBe("invalid-delivery-recipe");

    // Refused, not silently kept-or-changed.
    const untouched = registered(await updateProject(project.id, { name: "Renamed" }));
    expect(untouched.deliveryRecipe).toBe("local-merge");
  });

  it("refuses to blank a required field", async () => {
    const project = await aProject();

    expect(refusalCode(await updateProject(project.id, { verifyCommand: "" }))).toBe(
      "verify-command-required",
    );
  });

  it("changes the durable folder, keeping it through edits that do not name it", async () => {
    const project = await aProject();
    expect(project.durableExportFolder).toBe("docs/specs");

    const updated = registered(
      await updateProject(project.id, { durableExportFolder: "docs/architecture" }),
    );
    expect(updated.durableExportFolder).toBe("docs/architecture");

    const untouched = registered(await updateProject(project.id, { name: "Renamed" }));
    expect(untouched.durableExportFolder).toBe("docs/architecture");
  });

  it("refuses to blank the durable folder", async () => {
    const project = await aProject();

    expect(refusalCode(await updateProject(project.id, { durableExportFolder: " " }))).toBe(
      "durable-folder-required",
    );
  });

  it("refuses a durable folder outside the root, or the root itself", async () => {
    const project = await aProject();

    expect(
      refusalCode(await updateProject(project.id, { durableExportFolder: "../elsewhere" })),
    ).toBe("durable-folder-outside-root");
    expect(refusalCode(await updateProject(project.id, { durableExportFolder: "." }))).toBe(
      "durable-folder-is-root",
    );
  });

  it("refuses an edit that makes the roots overlap, in either direction", async () => {
    const project = await aProject();

    // Durable moved inside the working folder.
    expect(
      refusalCode(await updateProject(project.id, { durableExportFolder: ".scratch/specs" })),
    ).toBe("export-roots-overlap");
    // Working moved to contain the durable folder.
    expect(refusalCode(await updateProject(project.id, { workingExportFolder: "docs" }))).toBe(
      "export-roots-overlap",
    );
    // Both at once, equal.
    expect(
      refusalCode(
        await updateProject(project.id, {
          workingExportFolder: "notes",
          durableExportFolder: "notes",
        }),
      ),
    ).toBe("export-roots-overlap");

    const untouched = registered(await updateProject(project.id, { name: "Renamed" }));
    expect(untouched).toMatchObject({
      workingExportFolder: ".scratch",
      durableExportFolder: "docs/specs",
    });
  });

  it("accepts sibling roots that share a prefix", async () => {
    const project = await aProject();

    const updated = registered(
      await updateProject(project.id, { workingExportFolder: "docs", durableExportFolder: "docs-specs" }),
    );

    expect(updated).toMatchObject({ workingExportFolder: "docs", durableExportFolder: "docs-specs" });
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

describe("visibility re-check after a migration moved the working folder", () => {
  useTestDatabase();

  /** What v66 does to a `docs/...` project: working moves to `.grill-room`, visibility is left as measured before, and the row is flagged. */
  async function aMovedProject(options: { gitignore?: string; staleVisibility: "tracked" | "ignored" }) {
    const root = repos.create({ gitignore: options.gitignore });
    const project = registered(
      await registerProject({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" }),
    );
    await getDb()
      .update(schema.projects)
      .set({
        workingExportFolder: ".grill-room",
        durableExportFolder: "docs/specs",
        visibility: options.staleVisibility,
        visibilityRecheck: true,
      })
      .where(eq(schema.projects.id, project.id));
    return project;
  }

  async function storedRow(id: string) {
    const [row] = await getDb()
      .select({
        visibility: schema.projects.visibility,
        visibilityRecheck: schema.projects.visibilityRecheck,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, id));
    return row;
  }

  it("re-seeds ignored for a moved row whose repository ignores the new working folder, and clears the flag", async () => {
    const project = await aMovedProject({ gitignore: ".grill-room/\n", staleVisibility: "tracked" });

    const read = await getProject(project.id);

    expect(read?.visibility).toBe("ignored");
    expect(read).not.toHaveProperty("visibilityRecheck");
    expect(await storedRow(project.id)).toEqual({ visibility: "ignored", visibilityRecheck: false });
  });

  it("re-seeds tracked for a moved row whose repository does not ignore it, through listProjects too", async () => {
    const project = await aMovedProject({ gitignore: "node_modules/\n", staleVisibility: "ignored" });

    const [listed] = await listProjects();

    expect(listed).toMatchObject({ id: project.id, visibility: "tracked" });
    expect(listed).not.toHaveProperty("visibilityRecheck");
    expect(await storedRow(project.id)).toEqual({ visibility: "tracked", visibilityRecheck: false });
  });

  it("leaves an unflagged row as stored, even when its visibility disagrees with git", async () => {
    const root = repos.create({ gitignore: ".grill-room/\n" });
    const project = registered(
      await registerProject({
        root,
        verifyCommand: "pnpm test",
        workingExportFolder: ".grill-room",
        visibility: "tracked",
      }),
    );

    expect((await getProject(project.id))?.visibility).toBe("tracked");
    expect(await storedRow(project.id)).toEqual({ visibility: "tracked", visibilityRecheck: false });
  });

  it("leaves a moved row unchanged, flag included, when its root is gone or not a repository", async () => {
    const project = await aMovedProject({ gitignore: ".grill-room/\n", staleVisibility: "tracked" });
    const missing = path.join(repos.plainFolder(), "gone");
    await getDb()
      .update(schema.projects)
      .set({ rootPath: missing })
      .where(eq(schema.projects.id, project.id));

    expect(await getProject(project.id)).toMatchObject({ rootPath: missing, visibility: "tracked" });
    expect(await storedRow(project.id)).toEqual({ visibility: "tracked", visibilityRecheck: true });

    const notARepo = repos.plainFolder();
    await getDb()
      .update(schema.projects)
      .set({ rootPath: notARepo })
      .where(eq(schema.projects.id, project.id));

    expect(await listProjects()).toMatchObject([{ rootPath: notARepo, visibility: "tracked" }]);
    expect(await storedRow(project.id)).toEqual({ visibility: "tracked", visibilityRecheck: true });
  });

  it("an explicit visibility on update clears the flag; an edit without one keeps it", async () => {
    // `git check-ignore` refuses a path beyond a symbolic link (exit 128), so
    // the re-check cannot answer here and the flag survives the read that
    // `updateProject` starts with.
    const project = await aMovedProject({ staleVisibility: "tracked" });
    mkdirSync(path.join(project.rootPath, "real"));
    symlinkSync(path.join(project.rootPath, "real"), path.join(project.rootPath, "link"));
    await getDb()
      .update(schema.projects)
      .set({ workingExportFolder: "link/tickets" })
      .where(eq(schema.projects.id, project.id));

    registered(await updateProject(project.id, { name: "Renamed" }));
    expect(await storedRow(project.id)).toEqual({ visibility: "tracked", visibilityRecheck: true });

    const updated = registered(await updateProject(project.id, { visibility: "ignored" }));

    expect(updated.visibility).toBe("ignored");
    expect(updated).not.toHaveProperty("visibilityRecheck");
    expect(await storedRow(project.id)).toEqual({ visibility: "ignored", visibilityRecheck: false });
  });
});

describe("runGit", () => {
  it("refuses any subcommand that could write", async () => {
    const root = repos.create();

    await expect(runGit(root, ["commit", "-m", "nope"])).rejects.toThrow(/read-only/);
    await expect(runGit(root, ["add", "."])).rejects.toThrow(/read-only/);
  });
});

describe("recheckVisibility", () => {
  useTestDatabase();

  async function aProject(gitignore?: string) {
    const root = repos.create({ gitignore });
    const project = registered(
      await registerProject({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" }),
    );
    return project;
  }

  async function setStored(id: string, values: { visibility: "tracked" | "ignored"; visibilityRecheck: boolean }) {
    await getDb().update(schema.projects).set(values).where(eq(schema.projects.id, id));
  }

  async function storedRow(id: string) {
    const [row] = await getDb().select().from(schema.projects).where(eq(schema.projects.id, id));
    return row;
  }

  it("writes the measured value and clears the flag while the flag is still set", async () => {
    const project = await aProject(".scratch/\n");
    await setStored(project.id, { visibility: "tracked", visibilityRecheck: true });
    const row = await storedRow(project.id);

    const result = await recheckVisibility(row);

    expect(result).toMatchObject({ visibility: "ignored", visibilityRecheck: false });
    const after = await storedRow(project.id);
    expect(after).toMatchObject({ visibility: "ignored", visibilityRecheck: false });
  });

  it("does not overwrite an explicit edit that cleared the flag after the row was read", async () => {
    const project = await aProject("node_modules/\n");
    await setStored(project.id, { visibility: "tracked", visibilityRecheck: true });
    const stale = await storedRow(project.id);
    await setStored(project.id, { visibility: "ignored", visibilityRecheck: false });

    const result = await recheckVisibility(stale);

    expect(result).toMatchObject({ visibility: "ignored", visibilityRecheck: false });
    expect(await storedRow(project.id)).toMatchObject({ visibility: "ignored", visibilityRecheck: false });
  });

  it("returns a row whose flag is clear as passed, without measuring or writing", async () => {
    const project = await aProject(".scratch/\n");
    await setStored(project.id, { visibility: "tracked", visibilityRecheck: true });
    const callerRow = { ...(await storedRow(project.id)), visibilityRecheck: false };

    const result = await recheckVisibility(callerRow);

    expect(result).toBe(callerRow);
    expect(await storedRow(project.id)).toMatchObject({ visibility: "tracked", visibilityRecheck: true });
  });

  it("returns the row as passed and writes nothing when git cannot answer", async () => {
    const project = await aProject(".scratch/\n");
    await setStored(project.id, { visibility: "tracked", visibilityRecheck: true });
    const notARepo = repos.plainFolder();
    await getDb().update(schema.projects).set({ rootPath: notARepo }).where(eq(schema.projects.id, project.id));
    const row = await storedRow(project.id);

    const result = await recheckVisibility(row);

    expect(result).toBe(row);
    expect(await storedRow(project.id)).toMatchObject({ visibility: "tracked", visibilityRecheck: true });
  });
});

describe("refreshProjectTracker", () => {
  useTestDatabase();

  it("the result carries no visibilityRecheck", async () => {
    const root = repos.create();
    const project = registered(
      await registerProject({ root, verifyCommand: "pnpm test", workingExportFolder: ".scratch" }),
    );

    const outcome = await refreshProjectTracker(project.id);

    const refreshed = registered(outcome);
    expect("visibilityRecheck" in refreshed).toBe(false);
  });
});

describe("exportRootsOverlap", () => {
  it.each([
    ["Docs", "docs/specs", true],
    ["docs/specs", "DOCS/SPECS", true],
    [".grill-room", ".Grill-Room/x", true],
    ["docs", "docs/specs", true],
    ["docs", "docs-specs", false],
    ["Docs", "docs-specs", false],
    ["a/b", "a/c", false],
  ])("%s vs %s is %s", (a, b, expected) => {
    expect(exportRootsOverlap(a, b)).toBe(expected);
  });
});
