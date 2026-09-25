import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { checkIgnored, excludesPath } from "./check-ignore.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

/** Set one git config key on a real test repo (`user.name`/`.email` are already set by `useTempGitRepos`). */
function setGitConfig(root: string, key: string, value: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync("git", ["-C", root, "config", key, value], { env, stdio: "ignore" });
}

function expectOk(result: Awaited<ReturnType<typeof checkIgnored>>): Map<string, boolean> {
  if (result.status !== "ok") throw new Error(`expected status "ok", got ${result.status}`);
  return result.ignored;
}

describe("excludesPath", () => {
  it("treats the miss marker `::` as not excluded", () => {
    expect(excludesPath("::")).toBe(false);
  });

  it("treats an ordinary matching pattern as excluded", () => {
    expect(excludesPath(".gitignore:1:dist/")).toBe(true);
  });

  it("treats a negation pattern as not excluded", () => {
    expect(excludesPath(".gitignore:2:!keep.js")).toBe(false);
  });

  it("splits on the line-number field, not by counting colons, so a source path containing colons still parses", () => {
    expect(excludesPath("some:weird:path/.gitignore:3:dist/")).toBe(true);
    expect(excludesPath("some:weird:path/.gitignore:3:!dist/keep.js")).toBe(false);
  });

  it("fails safe (treats as excluded) when a line doesn't fit the expected shape", () => {
    expect(excludesPath("unexpected-format")).toBe(true);
  });
});

describe("checkIgnored", () => {
  it("returns an empty map for no paths, without calling git", async () => {
    const result = await checkIgnored("/nonexistent", []);
    expect(result).toEqual({ status: "ok", ignored: new Map() });
  });

  it("classifies ignored and not-ignored paths by position, in one call", async () => {
    const root = repos.create({ gitignore: "dist/\n" });

    const ignored = expectOk(await checkIgnored(root, ["dist/a.js", "src/a.js"]));

    expect(ignored.get("dist/a.js")).toBe(true);
    expect(ignored.get("src/a.js")).toBe(false);
  });

  it("treats a negation re-include (`keep/*` + `!keep/keep.js`) as not ignored", async () => {
    const root = repos.create({ gitignore: "keep/*\n!keep/keep.js\n" });

    const ignored = expectOk(await checkIgnored(root, ["keep/keep.js"]));

    expect(ignored.get("keep/keep.js")).toBe(false);
  });

  it("still refuses a create whose excluded parent folder a negation cannot re-include (`dist/` + `!dist/keep.js`)", async () => {
    const root = repos.create({ gitignore: "dist/\n!dist/keep.js\n" });

    const ignored = expectOk(await checkIgnored(root, ["dist/keep.js"]));

    expect(ignored.get("dist/keep.js")).toBe(true);
  });

  it("judges a path of `:/x` as the literal path, never `:/`-magic to `x`", async () => {
    // Rooted so it matches only a literal top-level `x`, never a path with a
    // `:` segment in front of it — only `:/`-magic's stripping of the
    // leading `:/` would make `:/x` match it.
    const root = repos.create({ gitignore: "/x\n" });

    const ignored = expectOk(await checkIgnored(root, [":/x"]));

    expect(ignored.get(":/x")).toBe(false);
  });

  it("judges a path of `:(glob)x` as the literal path, not long-form pathspec magic", async () => {
    // Without the `./` prefix, this makes `check-ignore` exit 128 ("pathspec
    // magic not supported by this command: 'glob'"), failing the whole
    // batch rather than judging this one path.
    const root = repos.create({ gitignore: "dist/\n" });

    const ignored = expectOk(await checkIgnored(root, [":(glob)x"]));

    expect(ignored.get(":(glob)x")).toBe(false);
  });

  it("classifies a decomposed (NFD) path under an ignored folder as ignored", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    // `git init` on macOS sets this by default; pinned so the test also
    // reproduces the bug on a host where it defaults to false.
    setGitConfig(root, "core.precomposeUnicode", "true");
    // "é" written as "e" + a combining acute accent (U+0301), not the single
    // precomposed code point U+00E9. With `core.precomposeUnicode=true`,
    // `check-ignore` echoes this back precomposed, so a check that compared
    // that echo against this exact string would miss it.
    const nfdPath = "dist/é.js";

    const ignored = expectOk(await checkIgnored(root, [nfdPath]));

    expect(ignored.get(nfdPath)).toBe(true);
  });

  it("classifies a path containing a quote under an ignored folder as ignored", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    const quotedPath = 'dist/a"b.js';

    const ignored = expectOk(await checkIgnored(root, [quotedPath]));

    expect(ignored.get(quotedPath)).toBe(true);
  });

  describe.each([
    ["core.quotePath=true", true],
    ["core.quotePath=false", false],
  ] as const)("under %s", (_label, quotePath) => {
    it("classifies a quoted path and a negation re-include the same way", async () => {
      const root = repos.create({ gitignore: "dist/\nkeep/*\n!keep/keep.js\n" });
      setGitConfig(root, "core.quotePath", String(quotePath));
      const quotedPath = 'dist/a"b.js';

      const ignored = expectOk(await checkIgnored(root, [quotedPath, "keep/keep.js"]));

      expect(ignored.get(quotedPath)).toBe(true);
      expect(ignored.get("keep/keep.js")).toBe(false);
    });
  });

  it("resolves to exit-error rather than throwing when the root is not a git repository", async () => {
    const root = repos.plainFolder();

    const result = await checkIgnored(root, ["anything.js"]);

    expect(result.status).toBe("exit-error");
    if (result.status !== "exit-error") throw new Error("unreachable");
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(1);
  });
});
