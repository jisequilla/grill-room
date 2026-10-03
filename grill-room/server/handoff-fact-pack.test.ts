import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import {
  collectHandoffFactPack,
  MAX_FACT_PACK_DOC_LINES,
  MAX_FACT_PACK_FILES,
} from "./handoff-fact-pack.js";

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
