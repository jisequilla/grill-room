import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import {
  collectHandoffFactPack,
  keepWithinBudget,
  MAX_FACT_PACK_DOC_BYTES,
  MAX_FACT_PACK_DOC_LINE_CHARS,
  MAX_FACT_PACK_DOC_LINES,
  MAX_FACT_PACK_FILES,
  MAX_FACT_PACK_FILES_BYTES,
} from "./handoff-fact-pack.js";
import { renderHandoffFactPack } from "./interviewer/prompt.js";

const repos = useTempGitRepos();

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
}

describe("collectHandoffFactPack: tracked files", () => {
  it("lists only src/a.ts when .env and config/prod.pem are tracked beside it", async () => {
    const root = repos.create({
      files: { ".env": "S=1\n", "config/prod.pem": "k\n", "src/a.ts": "a\n" },
    });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles).toContain("src/a.ts");
    expect(pack.trackedFiles).not.toContain(".env");
    expect(pack.trackedFiles).not.toContain("config/prod.pem");
  });

  it("does not list a tracked file deleted from the working tree", async () => {
    const root = repos.create({ files: { "src/gone.ts": "x\n", "src/a.ts": "a\n" } });
    fs.rmSync(path.join(root, "src/gone.ts"));
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles).toContain("src/a.ts");
    expect(pack.trackedFiles).not.toContain("src/gone.ts");
  });

  it("keeps the first 3,000 of 3,200 listable tracked files and counts the other 200", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 3200 - 1; index += 1) {
      files[`f/${String(index).padStart(5, "0")}.txt`] = "x";
    }
    const root = repos.create({ files });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles).toHaveLength(MAX_FACT_PACK_FILES);
    expect(pack.trackedFilesOmitted).toBe(200);
    expect(pack.trackedFiles).toEqual([...pack.trackedFiles].sort());
  });

  it("leaves out the excluded folder's 5 files and counts omitted after that", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 5; index += 1) files[`.grill-room/out/${index}.md`] = "x";
    // README.md from the fixture plus 3,003 others: 3,004 listable files.
    for (let index = 0; index < 3003; index += 1) {
      files[`f/${String(index).padStart(5, "0")}.txt`] = "x";
    }
    const root = repos.create({ files });
    const pack = await collectHandoffFactPack(root, { excludeFolder: ".grill-room/out" });
    expect(pack.trackedFiles).toHaveLength(MAX_FACT_PACK_FILES);
    expect(pack.trackedFiles.some((file) => file.startsWith(".grill-room/out/"))).toBe(false);
    expect(pack.trackedFilesOmitted).toBe(4);
  });

  it("lists nothing for a repository with no commits and nothing staged", async () => {
    const root = repos.create({ commit: false });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles).toEqual([]);
    expect(pack.trackedFilesOmitted).toBe(0);
  });

  it("matches secret patterns case-sensitively: KEY.PEM listed, .pem left out", async () => {
    const root = repos.create({ files: { "KEY.PEM": "k\n", ".pem": "k\n" } });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles).toContain("KEY.PEM");
    expect(pack.trackedFiles).not.toContain(".pem");
  });

  it("throws for a folder that is not a git repository", async () => {
    const folder = repos.plainFolder({ "CLAUDE.md": "x\n" });
    await expect(collectHandoffFactPack(folder, {})).rejects.toThrow();
  });
});

describe("collectHandoffFactPack: root documents", () => {
  it("shows AGENTS.md once when CLAUDE.md is a symlink to it", async () => {
    const root = repos.create({ files: { "AGENTS.md": "a\n" } });
    fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toHaveLength(1);
    expect(namedDocs[0]!.paths).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it("shows docs/agent.md first when CLAUDE.md is a symlink to it", async () => {
    const root = repos.create({ files: { "docs/agent.md": "a\n" } });
    fs.symlinkSync("docs/agent.md", path.join(root, "CLAUDE.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toHaveLength(1);
    expect(namedDocs[0]!.paths).toEqual(["docs/agent.md", "CLAUDE.md"]);
  });

  it("shows package.json once when CLAUDE.md and AGENTS.md are both symlinks to it", async () => {
    const root = repos.create({ files: { "package.json": "{}\n" } });
    fs.symlinkSync("package.json", path.join(root, "CLAUDE.md"));
    fs.symlinkSync("package.json", path.join(root, "AGENTS.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toHaveLength(1);
    expect(namedDocs[0]!.paths).toEqual(["package.json", "CLAUDE.md", "AGENTS.md"]);
  });

  it("finds a regular CLAUDE.md when the root is passed as a symlink to the repository", async () => {
    const root = repos.create({ files: { "CLAUDE.md": "hello\n" } });
    const link = path.join(repos.plainFolder(), "link");
    fs.symlinkSync(root, link);
    const { namedDocs } = await collectHandoffFactPack(link, {});
    expect(namedDocs).toHaveLength(1);
    expect(namedDocs[0]!.paths).toEqual(["CLAUDE.md"]);
    expect(namedDocs[0]!.lines).toEqual(["hello"]);
  });

  it("leaves out a CLAUDE.md that is a symlink into the repository's own metadata folder", async () => {
    const root = repos.create({ files: { "src/a.ts": "a\n" } });
    fs.symlinkSync(".git/config", path.join(root, "CLAUDE.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toEqual([]);
  });

  it("leaves out a CLAUDE.md that links outside the root or to .env", async () => {
    const outside = repos.plainFolder({ "outside.md": "secret\n" });
    const root = repos.create({ files: { ".env": "S=1\n" } });
    fs.symlinkSync(path.join(outside, "outside.md"), path.join(root, "CLAUDE.md"));
    fs.symlinkSync(".env", path.join(root, "AGENTS.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toEqual([]);
  });

  it("leaves out a dangling symlink and a directory without error", async () => {
    const root = repos.create({});
    fs.symlinkSync("nowhere.md", path.join(root, "CLAUDE.md"));
    fs.mkdirSync(path.join(root, "AGENTS.md"));
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs).toEqual([]);
  });

  it("keeps 400 lines and truncated false for a 400-line package.json", async () => {
    const root = repos.create({ files: { "package.json": lines(400) } });
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs[0]!.lines).toHaveLength(MAX_FACT_PACK_DOC_LINES);
    expect(namedDocs[0]!.truncated).toBe(false);
  });

  it("keeps 400 lines and truncated true for a 600-line package.json", async () => {
    const root = repos.create({ files: { "package.json": lines(600) } });
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs[0]!.lines).toHaveLength(MAX_FACT_PACK_DOC_LINES);
    expect(namedDocs[0]!.lines[MAX_FACT_PACK_DOC_LINES - 1]).toBe("line 400");
    expect(namedDocs[0]!.truncated).toBe(true);
  });

  it("splits AGENTS.md of a, b and a trailing newline into two lines", async () => {
    const root = repos.create({ files: { "AGENTS.md": "a\nb\n" } });
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs[0]!.lines).toEqual(["a", "b"]);
  });

  it("keeps a trailing carriage return and gives an empty file no lines", async () => {
    const root = repos.create({ files: { "AGENTS.md": "a\r\nb\r\n", "CLAUDE.md": "" } });
    const { namedDocs } = await collectHandoffFactPack(root, {});
    expect(namedDocs.find((doc) => doc.paths[0] === "CLAUDE.md")!.lines).toEqual([]);
    expect(namedDocs.find((doc) => doc.paths[0] === "AGENTS.md")!.lines).toEqual(["a\r", "b\r"]);
  });
});

describe("collectHandoffFactPack: verify command", () => {
  it("returns the registered command as registered", async () => {
    const root = repos.create({});
    const pack = await collectHandoffFactPack(root, { verifyCommand: "pnpm test" });
    expect(pack.verifyCommand).toEqual({ command: "pnpm test", source: "registered" });
  });

  it("falls back to a suggestion from the project's recipes", async () => {
    const root = repos.create({ files: { justfile: "verify:\n\techo ok\n" } });
    const pack = await collectHandoffFactPack(root, { verifyCommand: null });
    expect(pack.verifyCommand).toEqual({ command: "just verify", source: "suggested" });
  });

  it("is null when nothing is registered or suggested", async () => {
    const root = repos.create({});
    const pack = await collectHandoffFactPack(root, { verifyCommand: null });
    expect(pack.verifyCommand).toBeNull();
  });
});

function docOf(root: string) {
  return collectHandoffFactPack(root, {}).then((pack) => pack.namedDocs[0]!);
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

describe("collectHandoffFactPack: byte budget", () => {
  it("shows a 1,200-character doc line as its first 500 characters and ' …', and lists it in cutLines", async () => {
    const root = repos.create({ files: { "package.json": `a\n${"x".repeat(1200)}\n` } });
    const doc = await docOf(root);
    expect(doc.lines).toEqual(["a", `${"x".repeat(500)} …`]);
    expect(doc.cutLines).toEqual([2]);
    expect(doc.truncated).toBe(false);
  });

  it("counts a cut line as 505 bytes against the budget", async () => {
    const root = repos.create({ files: { "package.json": `${"x".repeat(1200)}\n` } });
    const doc = await docOf(root);
    expect(bytes(doc.lines[0]!) + 1).toBe(505);
    const many = repos.create({
      files: { "package.json": `${Array.from({ length: 79 }, () => "x".repeat(1200)).join("\n")}\n` },
    });
    const long = await docOf(many);
    expect(long.lines).toHaveLength(79);
    expect(long.cutLines).toHaveLength(79);
  });

  it("shows a line of 499 ASCII characters plus one emoji whole", async () => {
    const line = `${"x".repeat(499)}😀`;
    const root = repos.create({ files: { "package.json": `${line}\n` } });
    const doc = await docOf(root);
    expect(doc.lines).toEqual([line]);
    expect(doc.cutLines).toEqual([]);
  });

  it("cuts after the emoji at code point 500 without splitting it, costing 508 bytes", async () => {
    const root = repos.create({ files: { "package.json": `${"x".repeat(499)}😀more text\n` } });
    const doc = await docOf(root);
    expect(doc.lines).toEqual([`${"x".repeat(499)}😀 …`]);
    expect(doc.cutLines).toEqual([1]);
    expect(bytes(doc.lines[0]!) + 1).toBe(508);
  });

  it("does not list a long line beyond the 400-line cap in cutLines", async () => {
    const body = [...Array.from({ length: 400 }, () => "a"), "y".repeat(900)].join("\n");
    const root = repos.create({ files: { "package.json": body } });
    const doc = await docOf(root);
    expect(doc.lines).toHaveLength(MAX_FACT_PACK_DOC_LINES);
    expect(doc.cutLines).toEqual([]);
    expect(doc.truncated).toBe(true);
  });

  it("does not list a long line dropped by the byte budget in cutLines", async () => {
    const body = [
      ...Array.from({ length: 198 }, () => "a".repeat(200)),
      "y".repeat(900),
    ].join("\n");
    const root = repos.create({ files: { "package.json": body } });
    const doc = await docOf(root);
    expect(doc.lines).toHaveLength(198);
    expect(doc.cutLines).toEqual([]);
    expect(doc.truncated).toBe(true);
  });

  it("shows a doc line of exactly 500 characters whole", async () => {
    const root = repos.create({ files: { "package.json": `${"x".repeat(500)}\n` } });
    const doc = await docOf(root);
    expect(doc.lines).toEqual(["x".repeat(MAX_FACT_PACK_DOC_LINE_CHARS)]);
    expect(doc.cutLines).toEqual([]);
  });

  it("keeps 199 of 300 lines of 200 characters and sets truncated", async () => {
    const body = Array.from({ length: 300 }, () => "a".repeat(200)).join("\n") + "\n";
    const root = repos.create({ files: { "package.json": body } });
    const doc = await docOf(root);
    expect(doc.lines).toHaveLength(199);
    expect(doc.truncated).toBe(true);
    const rendered = renderHandoffFactPack({
      trackedFiles: [],
      trackedFilesOmitted: 0,
      namedDocs: [doc],
      verifyCommand: null,
    }).join("\n");
    expect(rendered).toContain("(truncated after line 199:");
  });

  it("keeps 199 lines and sets truncated for exactly 400 lines of 200 characters", async () => {
    const body = Array.from({ length: 400 }, () => "a".repeat(200)).join("\n") + "\n";
    const root = repos.create({ files: { "package.json": body } });
    const doc = await docOf(root);
    expect(doc.lines).toHaveLength(199);
    expect(doc.truncated).toBe(true);
  });

  it("stops at the first line that does not fit and never skips ahead to a shorter one", async () => {
    const body = [
      ...Array.from({ length: 198 }, () => "a".repeat(200)),
      "b".repeat(300),
      "",
      "",
    ].join("\n");
    const root = repos.create({ files: { "package.json": body } });
    const doc = await docOf(root);
    expect(doc.lines).toHaveLength(198);
    expect(doc.truncated).toBe(true);
  });

  it("leaves a doc under every cap unchanged", async () => {
    const root = repos.create({ files: { "package.json": "{\n}\n" } });
    const doc = await docOf(root);
    expect(doc.lines).toEqual(["{", "}"]);
    expect(doc.cutLines).toEqual([]);
    expect(doc.truncated).toBe(false);
  });

  it("keeps 2 of three 40,000-character items and a short one within 100,000 bytes", () => {
    expect(
      keepWithinBudget(
        ["a".repeat(40_000), "b".repeat(40_000), "c".repeat(40_000), "d"],
        100_000,
      ),
    ).toEqual({ kept: 2 });
  });

  it("keeps sorted paths up to 100,000 bytes of 3,000 paths of 60 bytes and counts the rest as omitted", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 3000; index += 1) {
      files[`${String(index).padStart(5, "0")}${"p".repeat(54)}`] = "x";
    }
    const root = repos.create({ files });
    const pack = await collectHandoffFactPack(root, {});
    const listable = 3001;
    expect(pack.trackedFiles.length).toBeLessThan(MAX_FACT_PACK_FILES);
    expect(pack.trackedFiles.reduce((sum, file) => sum + bytes(file) + 1, 0)).toBeLessThanOrEqual(
      MAX_FACT_PACK_FILES_BYTES,
    );
    expect(pack.trackedFiles).toEqual([...pack.trackedFiles].sort());
    expect(pack.trackedFilesOmitted).toBe(listable - pack.trackedFiles.length);
    expect(pack.trackedFilesOmitted).toBeGreaterThan(1000);
  });

  it("counts paths dropped by the byte budget as omitted for a list under 3,000 paths", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 1500; index += 1) {
      files[`${String(index).padStart(5, "0")}${"p".repeat(94)}`] = "x";
    }
    const root = repos.create({ files });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.trackedFiles.length).toBeLessThan(1501);
    expect(pack.trackedFilesOmitted).toBe(1501 - pack.trackedFiles.length);
    expect(pack.trackedFilesOmitted).toBeGreaterThan(0);
  });

  it("renders the worst case the caps allow in under 250,000 bytes", async () => {
    const wide = (tag: string) =>
      Array.from({ length: MAX_FACT_PACK_DOC_LINES }, (_, index) =>
        `${tag}${index}${"x".repeat(600)}`,
      ).join("\n") + "\n";
    const files: Record<string, string> = {
      "CLAUDE.md": wide("c"),
      "AGENTS.md": wide("a"),
      "package.json": wide("p"),
    };
    for (let index = 0; index < 3000; index += 1) {
      files[`z/${String(index).padStart(5, "0")}${"p".repeat(120)}`] = "x";
    }
    const root = repos.create({ files });
    const pack = await collectHandoffFactPack(root, {});
    expect(pack.namedDocs).toHaveLength(3);
    for (const doc of pack.namedDocs) {
      expect(doc.lines.reduce((sum, line) => sum + bytes(line) + 1, 0)).toBeLessThanOrEqual(
        MAX_FACT_PACK_DOC_BYTES,
      );
    }
    const rendered = renderHandoffFactPack(pack).join("\n");
    expect(bytes(rendered)).toBeLessThan(250_000);
    expect(bytes(rendered)).toBeGreaterThan(100_000);
  });
});
