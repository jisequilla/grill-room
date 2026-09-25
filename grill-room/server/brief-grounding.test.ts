import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { aHandoffScoutResult } from "./interviewer/test-fixtures.js";
import {
  isTestFileByName,
  reasonsToRefuseHandoffGrounding,
  type GroundedHandoffTicket,
} from "./brief-grounding.js";

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

/**
 * One ticket's grounding: `files` as `path: change`, proved by `testPath`
 * (run by `command`), one `createdPath` buildsOn per blocker, each checked by
 * its `check` or, by default, `test -f <createdPath>`.
 */
function aTicket(
  number: number,
  files: Record<string, "create" | "edit">,
  testPath: string | null,
  buildsOn: { blocker: number; createdPath: string; check?: string }[] = [],
  command = "cd backend && go test ./export/...",
): ScoutTicket {
  return {
    number,
    filesToChange: Object.entries(files).map(([path, change]) => ({ path, change })),
    buildsOnFiles: [],
    facts: [],
    buildsOn: buildsOn.map(({ blocker, createdPath, check }) => ({
      blocker,
      provides: `What ticket ${blocker} creates.`,
      citation: null,
      createdPath,
      editedPath: null,
      symbol: null,
      check: check ?? `test -f ${createdPath}`,
    })),
    provedBy: { testPath, command },
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

  it("accepts the buildsOn shapes the scout prompt describes for an edit of a blocker's create", async () => {
    // As buildHandoffScoutPrompt tells the scout: one buildsOn entry per
    // ticket in the Blocked by line, never a second one for the same blocker,
    // and none for a blocker further up the chain.
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    const server = "backend/server/server.go";
    const serverTest = "backend/server/server_test.go";

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          // Direct blocker whose single entry already names another file it creates.
          // Its check and its proof follow the cd rule: after `cd backend`,
          // paths are relative to backend; the build covers the whole module.
          aTicket(
            3,
            { [EXPORT_TEST]: "edit" },
            EXPORT_TEST,
            [
              {
                blocker: 1,
                createdPath: EXPORT,
                check: "cd backend && grep -n 'func ' export/export.go",
              },
            ],
            "cd backend && go build ./... && go test ./export/...",
          ),
          // Direct blocker whose single entry is the file this ticket edits.
          aTicket(4, { [server]: "create", [serverTest]: "create", [EXPORT_TEST]: "edit" }, serverTest, [
            { blocker: 1, createdPath: EXPORT_TEST },
          ]),
          // Ticket 1 is further up the chain: only ticket 4, its direct blocker, has an entry.
          // Its check does not cd, so it names the path from the repository root.
          aTicket(5, { [EXPORT_TEST]: "edit" }, EXPORT_TEST, [
            { blocker: 4, createdPath: server, check: `grep -n 'func ' ${server}` },
          ]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 3, blockedBy: [1] },
          { number: 4, blockedBy: [1] },
          { number: 5, blockedBy: [4] },
        ],
      },
    );

    expect(reasons).toEqual([]);
  });

  it("accepts the third run's ticket 5 as the prompt now describes it: it edits only server.go, the spec excludes handler tests, testPath is null and a build proves it", async () => {
    const root = repos.create({
      files: { "backend/server/server.go": "package server\n" },
    });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(3, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          {
            ...aTicket(
              5,
              { "backend/server/server.go": "edit" },
              null,
              [{ blocker: 3, createdPath: EXPORT, check: "cd backend && grep -n 'func ' export/export.go" }],
              "cd backend && go build ./...",
            ),
            facts: [
              {
                statement: "The spec excludes handler tests, so this ticket is proved by building the whole module; server.go is the package the handler joins.",
                citation: "backend/server/server.go:1",
              },
            ],
          },
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 3, blockedBy: [] },
          { number: 5, blockedBy: [3] },
        ],
      },
    );

    expect(reasons).toEqual([]);
  });

  it("collides two creates that differ only in case, Unicode form or a trailing slash", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    const upper = "backend/export/Export_test.go";

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(3, { [upper]: "create" }, upper, [{ blocker: 1, createdPath: EXPORT }]),
          // Precomposed "é" with a trailing slash, against a decomposed, upper-case "E" + U+0301.
          aTicket(4, { "docs/café/": "create" }, "docs/café/", [
            { blocker: 1, createdPath: EXPORT },
          ]),
          aTicket(5, { "docs/CAFÉ": "create" }, "docs/CAFÉ", [
            { blocker: 1, createdPath: EXPORT },
          ]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 1, blockedBy: [] },
          { number: 3, blockedBy: [1] },
          { number: 4, blockedBy: [1] },
          { number: 5, blockedBy: [1] },
        ],
      },
    );

    const doubles = reasons.filter((reason) => reason.includes("only one ticket may create a path"));
    expect(doubles).toEqual([
      `Tickets 1 and 3 both mark ${EXPORT_TEST} (as ${upper} in ticket 3, the same path on a case-insensitive file system) as create; only one ticket may create a path. Ticket 1 comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create. Ticket 3 is blocked by ticket 1, so mark ${EXPORT_TEST} as edit in ticket 3: a ticket may edit a file one of its blockers creates.`,
      "Tickets 4 and 5 both mark docs/café/ (as docs/CAFÉ in ticket 5, the same path on a case-insensitive file system) as create; only one ticket may create a path. Ticket 4 comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create. Ticket 5 may mark it edit only when it is blocked by ticket 4, directly or through its blockers, and it is not; drop it from ticket 5's filesToChange, or have ticket 5 create a file of its own beside it.",
    ]);
  });

  it("leaves a creator the handoff does not have to the missing-ticket reason", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(9, { [EXPORT_TEST]: "create" }, EXPORT_TEST),
        ],
      },
      { projectRoot: root, tickets: [{ number: 1, blockedBy: [] }] },
    );

    expect(reasons).toEqual([
      "Ticket 9 is not a ticket of this handoff; report only tickets 1.",
    ]);
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
    result.tickets[0]!.filesToChange = [
      { path: "src/missing.ts", change: "edit" },
      { path: "src/missing.test.ts", change: "create" },
    ];
    result.tickets[0]!.provedBy.testPath = "src/missing.test.ts";

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

/**
 * One ticket blocked by ticket 1, its single `buildsOn` entry a citation form
 * naming `citation` verbatim (no other validation applied), proved by
 * `README.md`.
 */
function aCitationBuildsOnTicket(citation: string): ScoutTicket {
  return {
    number: 2,
    filesToChange: [],
    buildsOnFiles: [],
    facts: [],
    buildsOn: [
      {
        blocker: 1,
        provides: "What ticket 1 already wrote.",
        citation,
        createdPath: null,
        editedPath: null,
        symbol: null,
        check: "true",
      },
    ],
    provedBy: { testPath: null, command: "true" },
  };
}

describe("reasonsToRefuseHandoffGrounding's buildsOn citation syntax check", () => {
  /** Ticket 1, unblocked, planning no files, proved by its command alone. */
  function blockerTicket(): ScoutTicket {
    return aTicket(1, {}, null, [], "true");
  }

  const TICKETS: GroundedHandoffTicket[] = [
    { number: 1, blockedBy: [] },
    { number: 2, blockedBy: [1] },
  ];

  it("refuses a buildsOn citation with a `..` segment, even when the path it resolves to exists", async () => {
    // src/x/../a.ts resolves to src/a.ts, which exists — so checkCitation's
    // own resolve-then-compare check would accept it; the syntax check must
    // catch the `..` on shape alone, before that happens.
    const root = repos.create({ files: { "src/a.ts": "export const a = 1;\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [blockerTicket(), aCitationBuildsOnTicket("src/x/../a.ts:1")] },
      { projectRoot: root, tickets: TICKETS },
    );

    expect(reasons).toEqual([
      `Ticket 2's buildsOn on ticket 1 cites "src/x/../a.ts:1", whose path is not relative to the project root or steps outside it; cite a path with no leading /, ~ or drive letter and no .. segment.`,
    ]);
  });

  it("refuses an absolute buildsOn citation", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [blockerTicket(), aCitationBuildsOnTicket("/abs/a.ts:1")] },
      { projectRoot: root, tickets: TICKETS },
    );

    expect(reasons).toEqual(
      expect.arrayContaining([
        `Ticket 2's buildsOn on ticket 1 cites "/abs/a.ts:1", whose path is not relative to the project root or steps outside it; cite a path with no leading /, ~ or drive letter and no .. segment.`,
      ]),
    );
  });

  it("refuses a buildsOn citation whose line range runs backwards", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\nSecond line\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [blockerTicket(), aCitationBuildsOnTicket("README.md:2-1")] },
      { projectRoot: root, tickets: TICKETS },
    );

    expect(reasons).toEqual(
      expect.arrayContaining([
        `Ticket 2's buildsOn on ticket 1 cites "README.md:2-1", whose line range ends before it starts; cite a range from its first line to its last.`,
      ]),
    );
  });

  it("accepts a valid buildsOn citation", async () => {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [blockerTicket(), aCitationBuildsOnTicket("README.md:1")] },
      { projectRoot: root, tickets: TICKETS },
    );

    expect(reasons).toEqual([]);
  });
});

describe("reasonsToRefuseHandoffGrounding on a check or command whose path ignores its own cd", () => {
  /** The third run's tickets 3 and 4: 3 creates the export and its test, 4 extends the test. */
  async function refuseTicket4(
    check: string,
    command = "cd backend && go test ./export/... -v",
  ): Promise<string[]> {
    const root = repos.create({ files: { "README.md": "# Marathon\n" } });
    return reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(3, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(
            4,
            { [EXPORT_TEST]: "edit" },
            EXPORT_TEST,
            [{ blocker: 3, createdPath: EXPORT_TEST, check }],
            command,
          ),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 3, blockedBy: [] },
          { number: 4, blockedBy: [3] },
        ],
      },
    );
  }

  it("refuses the third run's check, naming the ticket, the blocker and the path", async () => {
    const reasons = await refuseTicket4(
      "cd backend && go test ./export/... && grep -n 'func Test' backend/export/export_test.go",
    );

    expect(reasons).toEqual([
      "Ticket 4's buildsOn check on ticket 3 runs `cd backend` and then names backend/export/export_test.go; after `cd backend`, paths are relative to backend, so it would look for backend/backend/export/export_test.go. Write it as export/export_test.go, or run the command from the repository root without the cd.",
    ]);
  });

  it.each([
    ["a leading ./ and a trailing slash on the folder", "cd ./backend/ && grep -n x backend/export/export.go"],
    ["a ; instead of &&", "cd backend; grep -n x backend/export/export.go"],
    ["a quoted path", "cd backend && grep -n x 'backend/export/export.go'"],
    ["a ./ in front of the path", "cd backend && grep -n x ./backend/export/export.go"],
  ])("refuses it with %s", async (_label, check) => {
    const reasons = await refuseTicket4(check);

    expect(reasons).toEqual([
      expect.stringContaining(
        "Ticket 4's buildsOn check on ticket 3 runs `cd backend` and then names backend/export/export.go; after `cd backend`, paths are relative to backend",
      ),
    ]);
  });

  it.each([
    ["a cd whose paths are relative to it", "cd backend && go test ./export/..."],
    ["a root path with no cd", "grep -n x backend/export/export.go"],
    ["a word that holds the folder only mid-word", "cd a && ls b/a/x"],
    [
      "a root path after a second cd back to the root",
      "cd backend && go vet ./export/... && cd .. && grep -n x backend/export/export.go",
    ],
  ])("accepts %s", async (_label, check) => {
    expect(await refuseTicket4(check)).toEqual([]);
  });

  it.each([
    ["Django's mysite/mysite/", "mysite", "mysite/mysite/settings.py", "cd mysite && grep -n INSTALLED_APPS mysite/settings.py"],
    ["a package named like its folder", "api", "api/api/tests/test_export.py", "cd api && pytest api/tests/test_export.py"],
  ])("accepts a path after cd when the project really nests the folder: %s", async (_label, dir, nested, command) => {
    const root = repos.create({ files: { [nested]: "x = 1\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [aTicket(1, { [`${dir}/new_test.py`]: "create" }, `${dir}/new_test.py`, [], command)] },
      { projectRoot: root, tickets: aSingleTicket() },
    );

    expect(reasons).toEqual([]);
  });

  it("still refuses the third run's check in a project with a backend/ folder but no backend/backend/", async () => {
    const root = repos.create({ files: { "backend/go.mod": "module backend\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(3, { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST),
          aTicket(4, { [EXPORT_TEST]: "edit" }, EXPORT_TEST, [
            {
              blocker: 3,
              createdPath: EXPORT_TEST,
              check: "cd backend && go test ./export/... && grep -n 'func Test' backend/export/export_test.go",
            },
          ]),
        ],
      },
      {
        projectRoot: root,
        tickets: [
          { number: 3, blockedBy: [] },
          { number: 4, blockedBy: [3] },
        ],
      },
    );

    expect(reasons).toEqual([
      expect.stringContaining("Ticket 4's buildsOn check on ticket 3 runs `cd backend` and then names backend/export/export_test.go"),
    ]);
  });

  it("suggests the folder itself for a bare <dir>/, never an empty path", async () => {
    const reasons = await refuseTicket4("cd backend && ls backend/");

    expect(reasons).toEqual([
      "Ticket 4's buildsOn check on ticket 3 runs `cd backend` and then names backend/; after `cd backend`, paths are relative to backend, so it would look for backend/backend/. Write it as . (the folder the cd moved into), or run the command from the repository root without the cd.",
    ]);
  });

  it("applies the same rule to provedBy.command", async () => {
    const reasons = await refuseTicket4(
      "test -f backend/export/export_test.go",
      "cd backend && go test ./export/... && grep -n 'func Test' backend/export/export_test.go",
    );

    expect(reasons).toEqual([
      "Ticket 4's provedBy.command runs `cd backend` and then names backend/export/export_test.go; after `cd backend`, paths are relative to backend, so it would look for backend/backend/export/export_test.go. Write it as export/export_test.go, or run the command from the repository root without the cd.",
    ]);
  });
});

describe("reasonsToRefuseHandoffGrounding on what counts as a proof", () => {
  it("refuses the third run's ticket 1: proved by the openapi.yaml it edits, with a parse that passes today", async () => {
    const root = repos.create({ files: { "api/openapi.yaml": "openapi: 3.0.3\n" } });

    const reasons = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(
            1,
            { "api/openapi.yaml": "edit" },
            "api/openapi.yaml",
            [],
            "cd frontend && npx openapi-typescript ../api/openapi.yaml -o /dev/null",
          ),
        ],
      },
      { projectRoot: root, tickets: aSingleTicket() },
    );

    expect(reasons).toEqual([
      "Ticket 1 is proved by api/openapi.yaml, a file it edits that is not a test by its name (a source file named *_test.*, *_spec.*, *.test.*, *.spec.* or test_*, or one under a __tests__/, test/, tests/, Tests/, *.Tests/ or spec/ folder), so it would pass before the change as well as after. The proof must be a test, or a command that fails on the current commit (a build, or a grep for what the ticket adds), with a test path the ticket creates or edits; when the spec rules out tests for this kind of change, set testPath to null and give that command alone.",
    ]);
  });

  it("accepts a null testPath on a ticket that changes files, and still applies the cd rule to its command", async () => {
    const root = repos.create({ files: { "backend/server/server.go": "package server\n" } });
    const accepted = await reasonsToRefuseHandoffGrounding(
      { tickets: [aTicket(1, { "backend/server/server.go": "edit" }, null, [], "cd backend && go build ./...")] },
      { projectRoot: root, tickets: aSingleTicket() },
    );
    const refused = await reasonsToRefuseHandoffGrounding(
      {
        tickets: [
          aTicket(1, { "backend/server/server.go": "edit" }, null, [], "cd backend && grep -n Export backend/server/server.go"),
        ],
      },
      { projectRoot: root, tickets: aSingleTicket() },
    );

    expect(accepted).toEqual([]);
    expect(refused).toEqual([
      expect.stringContaining("Ticket 1's provedBy.command runs `cd backend` and then names backend/server/server.go"),
    ]);
  });

  it.each([
    ["a _test.go it creates", { [EXPORT]: "create", [EXPORT_TEST]: "create" }, EXPORT_TEST],
    ["a foo.spec.ts it edits", { "src/foo.ts": "edit", "src/foo.spec.ts": "edit" }, "src/foo.spec.ts"],
    ["a file under tests/ it edits", { "app/export.py": "edit", "tests/helpers.py": "edit" }, "tests/helpers.py"],
    ["a non-test file it creates", { "backend/export/check.go": "create" }, "backend/export/check.go"],
  ] as const)("accepts %s", async (_label, files, testPath) => {
    const root = repos.create({
      files: {
        "src/foo.ts": "export const foo = 1;\n",
        "src/foo.spec.ts": "import { foo } from './foo';\n",
        "app/export.py": "def export(): pass\n",
        "tests/helpers.py": "def helper(): pass\n",
      },
    });

    const reasons = await reasonsToRefuseHandoffGrounding(
      { tickets: [aTicket(1, { ...files }, testPath)] },
      { projectRoot: root, tickets: aSingleTicket() },
    );

    expect(reasons).toEqual([]);
  });
});

describe("isTestFileByName", () => {
  it.each([
    "backend/export/export_test.go",
    "src/a.test.ts",
    "src/a.test.tsx",
    "web/a.spec.js",
    "pkg/test_export.py",
    "pkg/export_test.py",
    "src/__tests__/a.ts",
    "tests/helpers.py",
    "src/test/java/ExportIT.java",
    "spec/models/user_spec.rb",
    "app/spec/support/helpers.rb",
    "Tests/FooTests/FooTests.swift",
    "MyApp.Tests/UnitTest1.cs",
    "lib/foo_test.exs",
  ])("counts %s as a test", (candidate) => {
    expect(isTestFileByName(candidate)).toBe(true);
  });

  it.each([
    "api/openapi.yaml",
    "backend/generated/api/api.gen.go",
    "frontend/src/api/schema.d.ts",
    "src/latest/a.ts",
    "src/contest.ts",
    "pkg/attest_export.py",
    "docker-compose.test.yml",
    "src/test/resources/application.yml",
    "tests/fixtures/export.json",
  ])("does not count %s as a test", (candidate) => {
    expect(isTestFileByName(candidate)).toBe(false);
  });
});
