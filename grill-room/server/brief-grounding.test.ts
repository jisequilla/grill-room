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

type ScoutTicket = ReturnType<typeof aHandoffScoutResult>["tickets"][number];

/** One ticket's grounding: `files` as `path: change`, proved by `testPath`, one `createdPath` buildsOn per blocker. */
function aTicket(
  number: number,
  files: Record<string, "create" | "edit">,
  testPath: string,
  buildsOn: { blocker: number; createdPath: string }[] = [],
): ScoutTicket {
  return {
    number,
    filesToChange: Object.entries(files).map(([path, change]) => ({ path, change })),
    buildsOnFiles: [],
    facts: [],
    buildsOn: buildsOn.map(({ blocker, createdPath }) => ({
      blocker,
      provides: `What ticket ${blocker} creates.`,
      citation: null,
      createdPath,
      editedPath: null,
      symbol: null,
      check: `test -f ${createdPath}`,
    })),
    provedBy: { testPath, command: "cd backend && go test ./export/..." },
  };
}

const EXPORT = "backend/export/export.go";
const EXPORT_TEST = "backend/export/export_test.go";

describe("reasonsToRefuseHandoffGrounding on a file a blocker creates", () => {
  it("accepts the export split: ticket 1 creates the test file and is proved by it, ticket 3 edits it and is proved by it", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(3, { [EXPORT_TEST]: "edit" }, EXPORT_TEST, [{ blocker: 1, createdPath: EXPORT }]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 3, blockedBy: [1] },
        ],
      },
    );

    expect(reasons).toEqual([]);
  });

  it("accepts an edit of a create two blockers up: ticket 5, blocked by 4, which is blocked by 1", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    const server = "backend/server/server.go";
    const serverTest = "backend/server/server_test.go";

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(4, { [server]: "create", [serverTest]: "create" }, serverTest, [
            { blocker: 1, createdPath: EXPORT },
          ]),
          aTicket(5, { [EXPORT_TEST]: "edit" }, EXPORT_TEST, [{ blocker: 4, createdPath: server }]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 4, blockedBy: [1] },
          { number: 5, blockedBy: [4] },
        ],
      },
    );

    expect(reasons).toEqual([]);
  });

  it("refuses an edit of a path a ticket that does not block it creates, and says so", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(2, { [EXPORT_TEST]: "edit" }, EXPORT_TEST),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 2, blockedBy: [] },
        ],
      },
    );

    expect(reasons).toEqual([
      `Ticket 2 marks ${EXPORT_TEST} as edit, but no such file exists in the project and none of its blockers creates it; mark it create, name a file that exists, or edit a file one of its blockers (directly or through their own blockers) marks as create. Ticket 1 creates it but does not block ticket 2, so ticket 2 cannot edit it; create a file of its own instead.`,
    ]);
  });

  it("offers editing a blocker's create when an edit target is missing and no ticket creates it", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    const result = aBareResult();
    result.tickets[0]!.filesToChange = [{ path: "src/missing.ts", change: "edit" }];
    result.tickets[0]!.provedBy.testPath = "src/missing.ts";

    const reasons = await reasonsToRefuseHandoffGrounding(result, {
      projectRoot: root,
      tickets: aSingleTicket(),
    });

    expect(reasons).toEqual([
      "Ticket 1 marks src/missing.ts as edit, but no such file exists in the project and none of its blockers creates it; mark it create, name a file that exists, or edit a file one of its blockers (directly or through their own blockers) marks as create.",
    ]);
  });

  it("refuses a path two tickets create, naming both and telling the blocked one to mark it edit", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(3, { [EXPORT_TEST]: "create" }, EXPORT_TEST, [{ blocker: 1, createdPath: EXPORT }]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 3, blockedBy: [1] },
        ],
      },
    );

    expect(reasons).toEqual([
      `Tickets 1 and 3 both mark ${EXPORT_TEST} as create; only one ticket may create a path. Ticket 1 comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create. Ticket 3 is blocked by ticket 1, so mark ${EXPORT_TEST} as edit in ticket 3: a ticket may edit a file one of its blockers creates.`,
    ]);
  });

  it("orders two creators by wave before number, and says when the later one is not blocked by the first", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    const one = "backend/one.go";
    const shared = "backend/shared.go";
    const threeTest = "backend/three_test.go";

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [one]: "create" }, one),
          aTicket(2, { [shared]: "create" }, shared, [{ blocker: 1, createdPath: one }]),
          aTicket(3, { [shared]: "create", [threeTest]: "create" }, threeTest),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 2, blockedBy: [1] },
          { number: 3, blockedBy: [] },
        ],
      },
    );

    expect(reasons).toEqual([
      `Tickets 3 and 2 both mark ${shared} as create; only one ticket may create a path. Ticket 3 comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create. Ticket 2 may mark it edit only when it is blocked by ticket 3, directly or through its blockers, and it is not; drop it from ticket 2's filesToChange, or have ticket 2 create a file of its own beside it.`,
    ]);
  });
});
