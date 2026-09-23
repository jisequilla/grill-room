import { describe, expect, it } from "vitest";

import { readProjectTracker } from "../server/tracker.js";
import { useTempGitRepos } from "./git-repos.js";

const VALID_BLOCK = `---
tickets_dir: .scratch/tickets
ticket_format: "{seq}-{slug}"
commands:
  claim: bd update {id} --claim
  close: bd close {id}
---
# Issue tracker

Prose after the block is ignored.
`;

describe("readProjectTracker", () => {
  const repos = useTempGitRepos();

  it("reads a valid block", () => {
    const root = repos.create({ files: { "docs/agents/issue-tracker.md": VALID_BLOCK } });

    expect(readProjectTracker(root)).toEqual({
      kind: "valid",
      tracker: {
        ticketsDir: ".scratch/tickets",
        ticketFormat: "{seq}-{slug}",
        commands: { claim: "bd update {id} --claim", close: "bd close {id}" },
      },
    });
  });

  it("is no tracker when the file is missing", () => {
    const root = repos.create();

    expect(readProjectTracker(root)).toEqual({ kind: "none" });
  });

  it("is no tracker for a prose-only file", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md":
          "# Issue tracker\n\nIssues live as local markdown under .scratch/<feature>/.\n",
      },
    });

    expect(readProjectTracker(root)).toEqual({ kind: "none" });
  });

  it("is invalid, naming tickets_dir, when the block is missing it", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
ticket_format: "{slug}"
commands:
  claim: bd update {id} --claim
---
`,
      },
    });

    const result = readProjectTracker(root);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.diagnostic).toMatch(/tickets_dir/);
  });

  it("is invalid, naming ticket_format, when the block is missing it", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
tickets_dir: .scratch/tickets
commands:
  claim: bd update {id} --claim
---
`,
      },
    });

    const result = readProjectTracker(root);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.diagnostic).toMatch(/ticket_format/);
  });

  it("is invalid, naming commands, when the block is missing it", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
tickets_dir: .scratch/tickets
ticket_format: "{slug}"
---
`,
      },
    });

    const result = readProjectTracker(root);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.diagnostic).toMatch(/commands/);
  });

  it("is invalid, naming tickets_dir, when it resolves outside the root", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
tickets_dir: ../outside
ticket_format: "{slug}"
commands:
  claim: bd update {id} --claim
---
`,
      },
    });

    const result = readProjectTracker(root);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.diagnostic).toMatch(/tickets_dir/);
  });

  it("is invalid, naming tickets_dir, when it is absolute", () => {
    const root = repos.create({
      files: {
        "docs/agents/issue-tracker.md": `---
tickets_dir: /etc/tickets
ticket_format: "{slug}"
commands:
  claim: bd update {id} --claim
---
`,
      },
    });

    const result = readProjectTracker(root);
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.diagnostic).toMatch(/tickets_dir/);
  });
});
