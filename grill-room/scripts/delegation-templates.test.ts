import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";

const BUILDER = readFileSync(
  repoPath(".claude/templates/delegation/builder.md"),
  "utf8",
);

const FIX = readFileSync(
  repoPath(".claude/templates/delegation/fix.md"),
  "utf8",
);

const REVIEWER = readFileSync(
  repoPath(".claude/templates/delegation/reviewer.md"),
  "utf8",
);

const MARKER = "<the Evidence entry's test command>";

const REVERT_BLOCK = [
  "git fetch origin",
  "P=$(mktemp)",
  "git diff --no-renames --name-only origin/main...HEAD | grep -v -E '\\.(test|spec)\\.[cm]?[jt]sx?$|\\.snap$|(^|/)(e2e|test|__snapshots__)/' | xargs -r git diff --no-renames --binary origin/main...HEAD -- > \"$P\"",
  'if [ -s "$P" ]; then',
  '  if git apply -R "$P"; then',
  "    " + MARKER,
  '    git apply "$P"',
  "  else",
  '    echo "git apply -R failed"',
  "  fi",
  "else",
  '  echo "test-only PR: no source to revert"',
  "fi",
].join("\n");

const REVERT_PARAGRAPH =
  "The block reads commits, not the working tree, so commit the change on the worktree branch before running it. Substitute your own test command for the marker line and run the whole block as one command: shell state, `P` included, does not survive between separate tool calls. A failing test does not stop the block, so the source is always re-applied. Run the block from the worktree root: `git diff --name-only` prints paths from the repo root, but `xargs git diff -- <paths>` reads them relative to the current directory, so from `grill-room/` the block would revert nothing and print the test-only line. If the test command needs `grill-room/`, put the `cd grill-room` in a subshell on the marker line, as `(cd grill-room && <test command>)`. The red run is that command's output between `git apply -R` and `git apply`; the green run is a separate run of the same command after the block finishes.";

const FAILURE_BULLET =
  "- If `git apply -R` or `git apply` fails, stop and report, quoting the error. With the block above, a failed `git apply -R` shows as the printed line `git apply -R failed`, not as the block's exit code. Never rebuild the change by hand.";

const revertBlockOf = (text: string): string => {
  const lines = text.split("\n");
  const start = lines.indexOf("### Revert");
  const open = lines.indexOf("```bash", start);
  const close = lines.indexOf("```", open + 1);
  return lines.slice(open + 1, close).join("\n");
};

const runBlock = (
  marker: string,
  env: { rStatus: number; patch: string },
): { stdout: string; calls: string[] } => {
  const dir = mkdtempSync(join(tmpdir(), "revert-block-"));
  try {
    const log = join(dir, "calls.log");
    writeFileSync(log, "");
    const stub = join(dir, "git");
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        'case "$1" in',
        "  fetch) exit 0 ;;",
        '  diff) case "$*" in',
        '    *--name-only*) echo src/a.ts ;;',
        '    *--binary*) [ -n "$STUB_PATCH" ] && printf "%s\\n" "$STUB_PATCH" ;;',
        "  esac; exit 0 ;;",
        '  apply) if [ "$2" = "-R" ]; then echo "apply -R" >> "$STUB_LOG"; exit "$STUB_R_STATUS"; fi',
        '    echo "apply" >> "$STUB_LOG"; exit 0 ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
    const script = revertBlockOf(BUILDER).replace(MARKER, marker);
    const stdout = execFileSync("bash", ["-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        STUB_LOG: log,
        STUB_R_STATUS: String(env.rStatus),
        STUB_PATCH: env.patch,
      },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { stdout, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const EVIDENCE_BULLET =
  '- `## Evidence`: one entry per numbered acceptance line. Each entry gives the acceptance number, the test file and test name, the source ranges the test covers (written as under "Evidence ranges" below), the quoted red run and the quoted green run. For a test-only PR, the entry quotes that line from the Revert block and gives the covered ranges. For a UI change, it also names the absolute folder of the screenshots and the exact command that regenerates them.';

const EXPECTED_ROWS: Array<[string, boolean]> = [
  ["grill-room/server/a.ts:10-20", true],
  ["grill-room/server/a.ts:7-7", true],
  ["grill-room/server/a.ts:10-20,grill-room/server/a.ts:40-52", true],
  [".claude/workflows/ticket-build-review-loop.js:102-107", true],
  ["grill-room/server/a.ts:7", false],
  ["brief-grounding.ts:701-705", false],
  [":663-667", false],
  ["grill-room/x.ts:1-5,9-12", false],
  ["/Users/me/repo/grill-room/x.ts:1-5", false],
];

const RANGE_PIECE = /^(?:[^/\s,:]+\/)+[^/\s,:]+:\d+-\d+$/;
const PREFER_ARGUMENT = /^(.+):(\d+)-(\d+)$/;

const parseRows = (): Array<[string, boolean]> =>
  BUILDER.split("\n").flatMap((line) => {
    const m = /^\| `([^`]+)` \| (yes|no) \|$/.exec(line);
    return m ? [[m[1], m[2] === "yes"] as [string, boolean]] : [];
  });

const accepted = (range: string): boolean =>
  range.split(",").every((piece) => RANGE_PIECE.test(piece));

describe("builder.md", () => {
  it("the Evidence bullet", () => {
    const bullet = BUILDER.split("\n").find((l) =>
      l.startsWith("- `## Evidence`"),
    );
    expect(bullet).toBe(EVIDENCE_BULLET);
  });

  it("the Evidence ranges table", () => {
    expect(BUILDER).toContain("### Evidence ranges");
    expect(parseRows()).toEqual(EXPECTED_ROWS);
  });

  it("each row of the Evidence ranges table agrees with the range check", () => {
    const rows = parseRows();
    expect(rows).toHaveLength(9);
    for (const [range, flag] of rows) {
      expect({ range, accepted: accepted(range) }).toEqual({
        range,
        accepted: flag,
      });
    }
  });

  it("accepted ranges survive the Mutate prompt's prefix strip", () => {
    const rows = parseRows();
    expect(rows).toHaveLength(9);
    const candidates = rows.filter(
      ([range, flag]) => flag && range.startsWith("grill-room/"),
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const [range] of candidates) {
      for (const piece of range.split(",")) {
        const stripped = piece.replace(/^grill-room\//, "");
        expect(stripped).toMatch(PREFER_ARGUMENT);
        expect(stripped.startsWith("grill-room/")).toBe(false);
      }
    }
  });

  it("the pnpm rules", () => {
    const lines = BUILDER.split("\n");
    expect(
      lines.find((l) => l.startsWith("- If `node_modules` is missing")),
    ).toBe(
      "- If `node_modules` is missing, run `(cd grill-room && pnpm install --frozen-lockfile)` first.",
    );
    expect(lines.find((l) => l.startsWith("- Never pass `--pm-on-fail`"))).toBe(
      "- Never pass `--pm-on-fail` to pnpm. If pnpm says the project is configured to use a different pnpm version, stop and report the message: another pnpm version rewrites `grill-room/pnpm-workspace.yaml`.",
    );
  });

  it("placeholders", () => {
    const found = new Set(BUILDER.match(/\{\{\s*\w+\s*\}\}/g) ?? []);
    for (const p of found) {
      expect(["{{bead}}", "{{title}}", "{{ticket}}"]).toContain(
        p.replace(/\s/g, ""),
      );
    }
  });
});

describe("Revert block", () => {
  it.each([
    ["builder.md", BUILDER],
    ["fix.md", FIX],
    ["reviewer.md", REVIEWER],
  ])("is identical in %s", (_name, text) => {
    expect(revertBlockOf(text)).toBe(REVERT_BLOCK);
  });

  it("a failed git apply -R runs no test and no re-apply", () => {
    const r = runBlock("echo TEST_RAN", { rStatus: 1, patch: "diff" });
    expect(r.stdout).toBe("git apply -R failed\n");
    expect(r.calls).toEqual(["apply -R"]);
  });

  it("a failing test still re-applies", () => {
    const r = runBlock("echo TEST_RAN; false", { rStatus: 0, patch: "diff" });
    expect(r.stdout).toBe("TEST_RAN\n");
    expect(r.calls).toEqual(["apply -R", "apply"]);
  });

  it("a passing test re-applies", () => {
    const r = runBlock("echo TEST_RAN", { rStatus: 0, patch: "diff" });
    expect(r.stdout).toBe("TEST_RAN\n");
    expect(r.calls).toEqual(["apply -R", "apply"]);
  });

  it("an empty patch prints the test-only line", () => {
    const r = runBlock("echo TEST_RAN", { rStatus: 0, patch: "" });
    expect(r.stdout).toBe("test-only PR: no source to revert\n");
    expect(r.calls).toEqual([]);
  });
});

describe("Revert paragraph", () => {
  it("builder.md and fix.md end with the separate green run", () => {
    for (const text of [BUILDER, FIX]) {
      const line = text
        .split("\n")
        .find((l) => l.startsWith("The block reads commits, not the working tree"));
      expect(line).toBe(REVERT_PARAGRAPH);
    }
  });
});

describe("Revert failure bullet", () => {
  it("builder.md and fix.md name the printed line", () => {
    for (const text of [BUILDER, FIX]) {
      const line = text
        .split("\n")
        .find((l) => l.startsWith("- If `git apply -R` or `git apply` fails"));
      expect(line).toBe(FAILURE_BULLET);
    }
  });
});

describe("fix.md", () => {
  it("the Verify, push and report heading", () => {
    const lines = FIX.split("\n");
    const h = lines.indexOf("## Verify, push and report");
    expect(h).toBeGreaterThan(-1);
    expect(lines.filter((l) => l === "## Verify, push and report")).toHaveLength(1);
    expect(lines.slice(h, h + 3)).toEqual([
      "## Verify, push and report",
      "",
      "Run the ticket's Verify commands in the foreground, and let each one finish before you report. A result that says verification is still running is not a result.",
    ]);
    expect(lines.indexOf("## Evidence and the PR body")).toBeLessThan(h);
    expect(
      lines.findIndex((l) => l.startsWith("- Update the PR body with")),
    ).toBeLessThan(h);
  });
});

describe("reviewer.md", () => {
  const lines = REVIEWER.split("\n");

  it("the git apply failure bullets", () => {
    const branch = "origin/{" + "{branch}}";
    expect(
      lines.find((l) => l.startsWith("- If `git apply -R` fails, stop the re-run")),
    ).toBe(
      "- If `git apply -R` fails, stop the re-run: remove the scratch worktree with `git worktree remove --force <folder>` (the tree may be left modified, and then a plain remove exits 128), create a fresh one in a new folder that keeps the `rv<pr>-r<round>-<lens>` naming with a `-2` suffix, detached at `" +
        branch +
        "`, and run the block once more. If it fails again, record a `blocker` whose `claim` quotes the error and whose `evidence` is the block with that command. Never rebuild the change by hand.",
    );
    expect(
      lines.find((l) => l.startsWith("- If `git apply` fails, do the same")),
    ).toBe(
      "- If `git apply` fails, do the same: a fresh worktree, one more try, then a `blocker` whose `claim` quotes the error and whose `evidence` is the block with that command.",
    );
  });

  it("the no-scope pointer", () => {
    expect(
      lines.find((l) => l.startsWith("   A `status` of `no-scope`")),
    ).toBe(
      "   A `status` of `no-scope` means nothing was mutated (the no-scope row above).",
    );
  });
});
