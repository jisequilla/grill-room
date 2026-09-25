import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { aHandoffScoutResult } from "./interviewer/test-fixtures.js";
import { reasonsToRefuseHandoffGrounding, type GroundedHandoffTicket } from "./brief-grounding.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

/** Set one git config key on a real test repo (`user.name`/`.email` are already set by `useTempGitRepos`). */
function setGitConfig(root: string, key: string, value: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync("git", ["-C", root, "config", key, value], { env, stdio: "ignore" });
}

/** The `GroundedHandoffTicket` input for a single, unblocked ticket. */
function aSingleTicket(): GroundedHandoffTicket[] {
  return [{ number: 1, blockedBy: [] }];
}

/** A minimal, otherwise-valid handoff scout result for one ticket that plans no files. */
function aBareResult(): ReturnType<typeof aHandoffScoutResult> {
  return {
    tickets: [
      {
        number: 1,
        filesToChange: [],
        buildsOnFiles: [],
        facts: [],
        buildsOn: [],
        provedBy: { testPath: "test/fixture.test.ts", command: "npm test" },
      },
    ],
  };
}

/**
 * Runs `reasonsToRefuseHandoffGrounding` for a single ticket that creates
 * `path`, and proves itself with it, so the ignore check is the only one in
 * play.
 */
function refuseSingleCreate(root: string, path: string): Promise<string[]> {
  const result = aBareResult();
  result.tickets[0]!.filesToChange = [{ path, change: "create" }];
  result.tickets[0]!.provedBy.testPath = path;
  return reasonsToRefuseHandoffGrounding(result, { projectRoot: root, tickets: aSingleTicket() });
}

describe("reasonsToRefuseHandoffGrounding's ignored-path check", () => {
  it("rejects a create inside an emoji path git ignores, quote and all, under core.quotePath=false", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    // Pinned rather than left at the host's default: this is the setting
    // under which an emoji is printed raw instead of octal-escaped, which is
    // what the match has to survive without decoding git's echoed pathname
    // at all (the check reads matched/not-matched off line position, per
    // argument, never off that text — see the comment in brief-grounding.ts).
    setGitConfig(root, "core.quotePath", "false");

    const reasons = await refuseSingleCreate(root, 'dist/😀".js');

    expect(reasons).toEqual([
      expect.stringContaining('Ticket 1 marks dist/😀".js as create, but git ignores that path'),
    ]);
  });

  it("rejects a decomposed (NFD) path under an ignored folder", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    // `git init` on macOS sets this by default; pinned so the test also
    // reproduces the bug on a host where it defaults to false.
    setGitConfig(root, "core.precomposeUnicode", "true");
    // "é" written as "e" + a combining acute accent (U+0301), not the single
    // precomposed code point U+00E9. With `core.precomposeUnicode=true`,
    // `check-ignore` echoes this back precomposed, so a check that compared
    // that echo against this exact string would miss it.
    const nfdPath = "dist/é.js";

    const reasons = await refuseSingleCreate(root, nfdPath);

    expect(reasons).toEqual([
      expect.stringContaining(`Ticket 1 marks ${nfdPath} as create, but git ignores that path`),
    ]);
  });

  it("judges a create of `:/x` as the literal path, not `:/`-magic to `x`", async () => {
    // Rooted so it matches only a literal top-level `x`, never a path with a
    // `:` segment in front of it.
    const root = repos.create({ gitignore: "/x\n" });

    const reasons = await refuseSingleCreate(root, ":/x");

    expect(reasons).toEqual([]);
  });

  it("judges a create of `:(glob)x` as the literal path, not long-form pathspec magic", async () => {
    // Before the `./` prefix, this made `check-ignore` exit 128 ("pathspec
    // magic not supported by this command: 'glob'"), failing the whole
    // batch rather than judging this one path.
    const root = repos.create({ gitignore: "dist/\n" });

    const reasons = await refuseSingleCreate(root, ":(glob)x");

    expect(reasons).toEqual([]);
  });

  it("fails safe on a path containing a lone surrogate", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    // An unpaired high surrogate: not valid Unicode text, but a plausible
    // shape for a model's malformed JSON to produce. It cannot survive
    // as-is over a child process's argv (neither Node nor git can represent
    // it), so this asserts the ignore check still resolves — inside the
    // ignored `dist/` folder either way — rather than crashing or silently
    // treating it as not ignored.
    const path = "dist/\uD83D.js";

    const reasons = await refuseSingleCreate(root, path);

    expect(reasons).toEqual([
      expect.stringContaining(`Ticket 1 marks ${path} as create, but git ignores that path`),
    ]);
  });

  it("still rejects an ordinary ignored create alongside a `:/`-led one that is not ignored", async () => {
    // `/x` is rooted, so it never matches a path with a `:` segment in
    // front of it — only `:/`-magic's stripping of the leading `:/` would
    // make `:/x` match it.
    const root = repos.create({ gitignore: "dist/\n\n/x\n" });
    const result = aBareResult();
    result.tickets[0]!.filesToChange = [
      { path: "dist/plain.js", change: "create" },
      { path: ":/x", change: "create" },
    ];
    result.tickets[0]!.provedBy.testPath = ":/x";

    const reasons = await reasonsToRefuseHandoffGrounding(result, {
      projectRoot: root,
      tickets: aSingleTicket(),
    });

    expect(reasons).toEqual([
      expect.stringContaining("Ticket 1 marks dist/plain.js as create, but git ignores that path"),
    ]);
  });

  describe.each([
    ["core.quotePath=true", true],
    ["core.quotePath=false", false],
  ] as const)("negation rules under %s", (_label, quotePath) => {
    it("accepts a create a negation re-includes (`keep/*` + `!keep/keep.js`)", async () => {
      const root = repos.create({ gitignore: "keep/*\n!keep/keep.js\n" });
      setGitConfig(root, "core.quotePath", String(quotePath));

      const reasons = await refuseSingleCreate(root, "keep/keep.js");

      expect(reasons).toEqual([]);
    });

    it("accepts a create a negation re-includes (`*.log` + `!important.log`)", async () => {
      const root = repos.create({ gitignore: "*.log\n!important.log\n" });
      setGitConfig(root, "core.quotePath", String(quotePath));

      const reasons = await refuseSingleCreate(root, "important.log");

      expect(reasons).toEqual([]);
    });

    it("still refuses a create whose excluded parent folder a negation cannot re-include (`dist/` + `!dist/keep.js`)", async () => {
      const root = repos.create({ gitignore: "dist/\n!dist/keep.js\n" });
      setGitConfig(root, "core.quotePath", String(quotePath));

      const reasons = await refuseSingleCreate(root, "dist/keep.js");

      expect(reasons).toEqual([
        expect.stringContaining("Ticket 1 marks dist/keep.js as create, but git ignores that path"),
      ]);
    });
  });
});
