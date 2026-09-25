import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { aHandoffScoutResult } from "./interviewer/test-fixtures.js";
import {
  reasonsToRefuseHandoffGrounding,
  unquoteGitPath,
  type GroundedHandoffTicket,
} from "./brief-grounding.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

/**
 * What `git check-ignore` prints for `relativePath` under a repo whose
 * `.gitignore` ignores everything under `dist/`, with `core.quotePath` set
 * as given. Uses the real binary so the round-trip tests below exercise
 * exactly what git 2.x actually prints, not a hand-rolled guess at it.
 */
function printedByCheckIgnore(relativePath: string, quotePath: boolean): string {
  const root = repos.create({ gitignore: "dist/\n" });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  const output = execFileSync(
    "git",
    ["-C", root, "-c", `core.quotePath=${quotePath}`, "check-ignore", "--", relativePath],
    { env, encoding: "utf8" },
  );
  return output.split("\n")[0]!;
}

describe("unquoteGitPath", () => {
  it("passes an unquoted path through unchanged", () => {
    expect(unquoteGitPath("dist/plain.js")).toBe("dist/plain.js");
  });

  it("decodes an octal-escaped non-ASCII byte", () => {
    expect(unquoteGitPath('"dist/caf\\303\\251.js"')).toBe("dist/café.js");
  });

  const cases: Array<[string, string]> = [
    ["an emoji alone", "dist/😀.js"],
    ["an emoji combined with a quote", 'dist/😀".js'],
    ["an emoji combined with a backslash", "dist/😀\\.js"],
    ["an emoji combined with a tab", "dist/😀\t.js"],
  ];

  describe.each([
    ["core.quotePath=true", true],
    ["core.quotePath=false", false],
  ] as const)("under %s", (_label, quotePath) => {
    it.each(cases)("round-trips %s", (_case, relativePath) => {
      const printed = printedByCheckIgnore(relativePath, quotePath);
      expect(unquoteGitPath(printed)).toBe(relativePath);
    });
  });
});

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

describe("reasonsToRefuseHandoffGrounding's ignored-path check", () => {
  it("rejects a create inside an emoji path git ignores, quote and all", async () => {
    const root = repos.create({ gitignore: "dist/\n" });
    const result = aBareResult();
    result.tickets[0]!.filesToChange = [{ path: 'dist/😀".js', change: "create" }];

    const reasons = await reasonsToRefuseHandoffGrounding(result, {
      projectRoot: root,
      tickets: aSingleTicket(),
    });

    expect(reasons).toEqual([
      expect.stringContaining('Ticket 1 marks dist/😀".js as create, but git ignores that path'),
    ]);
  });

  it("judges a create of `:/x` as the literal path, not `:/`-magic to `x`", async () => {
    // Rooted so it matches only a literal top-level `x`, never a path with a
    // `:` segment in front of it.
    const root = repos.create({ gitignore: "/x\n" });
    const result = aBareResult();
    result.tickets[0]!.filesToChange = [{ path: ":/x", change: "create" }];

    const reasons = await reasonsToRefuseHandoffGrounding(result, {
      projectRoot: root,
      tickets: aSingleTicket(),
    });

    expect(reasons).toEqual([]);
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

    const reasons = await reasonsToRefuseHandoffGrounding(result, {
      projectRoot: root,
      tickets: aSingleTicket(),
    });

    expect(reasons).toEqual([
      expect.stringContaining("Ticket 1 marks dist/plain.js as create, but git ignores that path"),
    ]);
  });
});
