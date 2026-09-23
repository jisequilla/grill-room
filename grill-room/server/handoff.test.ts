import { describe, expect, it } from "vitest";

import {
  BUNDLE_TOKEN,
  bundlePathFor,
  CODEBASE_FACTS_SLOT,
  FILE_BOUNDARIES_SLOT,
  fillBundlePath,
  handoffFingerprint,
  type HandoffSource,
  renderHandoff,
} from "./handoff.js";

const ROOT = "/repos/target";

/**
 * Three tickets: 01 and 03 have no blockers, 02 is blocked by 01. Waves are
 * given out of number order on purpose (wave 1 = [1, 3], wave 2 = [2]) so the
 * rendered order can only come from the waves.
 */
function aSource(overrides: Partial<HandoffSource["project"]> = {}): HandoffSource {
  return {
    session: {
      id: "session-123",
      title: "Export anywhere",
      idea: "Export a grilled session into any repository.",
    },
    spec: { updatedAt: "2026-09-01T10:00:00.000Z", ticketsGeneratedAt: "2026-09-01T10:05:00.000Z" },
    tickets: [
      { id: "t1", number: 1, slug: "register-projects", title: "Register projects", body: "Build the registry.", blockedBy: [] },
      { id: "t2", number: 2, slug: "export-bundle", title: "Export the bundle", body: "Write the bundle.", blockedBy: [1] },
      { id: "t3", number: 3, slug: "slug-proposal", title: "Propose a slug", body: "Propose it.", blockedBy: [] },
    ],
    waves: [[1, 3], [2]],
    project: {
      rootPath: ROOT,
      exportFolder: ".scratch",
      verifyCommand: "just verify",
      trackerKind: "markdown",
      buildRecordLogging: false,
      visibility: "tracked",
      trackerCommandsJson: null,
      ...overrides,
    },
  };
}

describe("HANDOFF.md", () => {
  it("renders the tracked variant", () => {
    const { markdown } = renderHandoff(aSource());
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain("relative to the repository root");
    expect(markdown).toContain(`git add ${BUNDLE_TOKEN}`);
    expect(markdown).toContain("Commit and push again whenever the bundle is re-exported.");
    expect(markdown).not.toContain("never reaches a worktree");
  });

  it("renders the ignored variant", () => {
    const { markdown } = renderHandoff(aSource({ visibility: "ignored" }));
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain(`Paths below are absolute, into the main checkout at \`${ROOT}\``);
    expect(markdown).toContain("must read the spec, their ticket and their brief by absolute path");
    expect(markdown).not.toContain("git add");
  });

  it("carries the session title and idea, the spec path, and the verify command", () => {
    const { markdown } = renderHandoff(aSource());
    expect(markdown.startsWith("# Handoff: Export anywhere\n")).toBe(true);
    expect(markdown).toContain("Export a grilled session into any repository.");
    expect(markdown).toContain(`- Spec: \`${BUNDLE_TOKEN}/spec.md\``);
    expect(markdown).toContain("```bash\njust verify\n```");
  });

  it("lists tickets in wave order, each with its brief link", () => {
    const { markdown } = renderHandoff(aSource());
    const wave1 = markdown.indexOf("### Wave 1");
    const wave2 = markdown.indexOf("### Wave 2");
    const t1 = markdown.indexOf("**01 Register projects**");
    const t3 = markdown.indexOf("**03 Propose a slug**");
    const t2 = markdown.indexOf("**02 Export the bundle** (blocked by 01)");
    expect(wave1).toBeGreaterThan(-1);
    expect([wave1, t1, t3, wave2, t2]).toEqual([...[wave1, t1, t3, wave2, t2]].sort((a, b) => a - b));
    expect(markdown).toContain(
      `  - Brief: [\`${BUNDLE_TOKEN}/briefs/02-export-bundle.md\`](briefs/02-export-bundle.md)`,
    );
    expect(markdown).toContain(`  - Ticket: \`${BUNDLE_TOKEN}/issues/02-export-bundle.md\``);
  });

  it("embeds the PR lifecycle with the verify command filled in", () => {
    const { markdown } = renderHandoff(aSource());
    expect(markdown).toContain("## Delegation lifecycle");
    expect(markdown).toContain("Local `main` holds nothing unpushed");
    expect(markdown).toContain("naming the files the ticket builds on");
    expect(markdown).toContain("Commits only on its worktree branch");
    expect(markdown).toContain("- Runs `just verify`; it must pass.");
    expect(markdown).toContain("stops before pushing and reports \"push pending: gh account\"");
    expect(markdown).toContain("opens a pull request against `main` with `gh pr create`");
    expect(markdown).toContain("It never merges.");
    expect(markdown).toContain("Read the PR diff (`gh pr diff <n>`)");
    expect(markdown).toContain("Re-run `just verify` yourself in the worktree, plus any browser check");
    expect(markdown).toContain("Send failures back to the same agent");
    expect(markdown).toContain("`gh pr merge <n> --merge --delete-branch`");
    expect(markdown).toContain("`git pull` on local `main` and re-run `just verify`");
    expect(markdown).toContain("Prune merged worktrees");
    expect(markdown).not.toContain("sync-to-local-main");
  });

  it("says what to record per ticket", () => {
    const { markdown } = renderHandoff(aSource());
    expect(markdown).toContain("## What to record per ticket");
    expect(markdown).toContain("the model the subagent ran on");
    expect(markdown).toContain("whether its first attempt passed verification");
    expect(markdown).toContain("whether it escalated to a stronger model");
    expect(markdown).toContain("what the delegation prompt was missing");
  });

  it("gives markdown projects a Status line per ticket and no bead commands", () => {
    const { markdown } = renderHandoff(aSource({ trackerKind: "markdown" }));
    expect(markdown.match(/^ {2}- Status: ready-for-agent$/gm)).toHaveLength(3);
    expect(markdown).toContain("## Tracking in this file");
    expect(markdown).not.toContain("bd ");
    expect(markdown).not.toContain("bead");
  });

  it("gives beads projects bead commands and no Status lines", () => {
    const { markdown } = renderHandoff(aSource({ trackerKind: "beads" }));
    expect(markdown).toContain("## Tracking with beads");
    expect(markdown).toContain("`bd update <id> --claim`");
    expect(markdown).not.toContain("Status: ready-for-agent");
    expect(markdown).toContain("Close the ticket's bead with a comment naming the PR.");
  });

  it("cites the tracker's stored commands when present", () => {
    const commands = JSON.stringify({ claim: "bd update {id} --claim", close: "bd close {id}" });
    const beads = renderHandoff(aSource({ trackerKind: "beads", trackerCommandsJson: commands }));
    expect(beads.markdown).toContain("The repository's declared tracker commands:");
    expect(beads.markdown).toContain("- `claim`: `bd update {id} --claim`");
    expect(beads.markdown).not.toContain("`bd ready`: find work");

    const markdownKind = renderHandoff(aSource({ trackerCommandsJson: commands }));
    expect(markdownKind.markdown).toContain("- `close`: `bd close {id}`");
  });

  it("includes build-record commands with the session id and ticket numbers only when the toggle is on", () => {
    const off = renderHandoff(aSource({ buildRecordLogging: false }));
    expect(off.markdown).not.toContain("## Build records");
    expect(off.markdown).not.toContain("set-build-record");

    const on = renderHandoff(aSource({ buildRecordLogging: true }));
    expect(on.markdown).toContain("## Build records");
    for (const number of [1, 2, 3]) {
      expect(on.markdown).toContain(
        `pnpm action set-build-record --sessionId session-123 --ticketNumber ${number} `,
      );
    }
  });
});

describe("briefs", () => {
  it("renders one brief per ticket at briefs/NN-slug.md", () => {
    const { briefs } = renderHandoff(aSource());
    expect(briefs.map((brief) => [brief.ticketNumber, brief.relativePath])).toEqual([
      [1, "briefs/01-register-projects.md"],
      [2, "briefs/02-export-bundle.md"],
      [3, "briefs/03-slug-proposal.md"],
    ]);
  });

  it("contains the invariant parts and both labelled, empty slots", () => {
    const brief = renderHandoff(aSource()).briefs[1]!.markdown;
    expect(brief).toMatchSnapshot();

    expect(brief).toContain("## The ticket");
    expect(brief).toContain("### 02 Export the bundle\n\nWrite the bundle.");
    expect(brief).toContain("Blocked by: 01");
    expect(brief).toContain("```bash\njust verify\n```");
    expect(brief).toContain("Create and edit files only within the file boundaries above");
    expect(brief).toContain("never commit on or push to `main`, and never merge anything");
    expect(brief).toContain("`git push -u origin HEAD`, then `gh pr create` against `main`");
    expect(brief).toContain("push pending: gh account");
    expect(brief).toContain("## Report, then stop");
    expect(brief).toContain("Then stop. Do no further work of any kind.");

    for (const [heading, slot] of [
      ["## File boundaries", FILE_BOUNDARIES_SLOT],
      ["## Codebase facts", CODEBASE_FACTS_SLOT],
    ] as const) {
      const start = brief.indexOf(heading);
      expect(start).toBeGreaterThan(-1);
      const section = brief.slice(start, brief.indexOf("\n## ", start + 1));
      expect(section).toContain(slot);
      // Only the heading, the slot marker and the italic label: nothing pre-filled.
      expect(section.split("\n").filter((line) => line.trim().length > 0)).toHaveLength(3);
    }
  });

  it("states how to reach the bundle for each visibility", () => {
    const tracked = renderHandoff(aSource()).briefs[0]!.markdown;
    expect(tracked).toContain("The bundle is committed in this repository, so your worktree has it.");

    const ignored = renderHandoff(aSource({ visibility: "ignored" })).briefs[0]!.markdown;
    expect(ignored).toContain("so it is NOT in your worktree. Read it by absolute path from the main checkout");
  });

  it("says a ticket with no blockers is blocked by none", () => {
    const brief = renderHandoff(aSource()).briefs[0]!.markdown;
    expect(brief).toContain("Blocked by: none");
  });
});

describe("bundle paths", () => {
  it("fills the bundle token with a repo-relative path when tracked and an absolute one when ignored", () => {
    const bundleDir = `${ROOT}/.scratch/export-anywhere`;
    expect(bundlePathFor("tracked", ROOT, bundleDir)).toBe(".scratch/export-anywhere");
    expect(bundlePathFor("ignored", ROOT, bundleDir)).toBe(bundleDir);
    expect(fillBundlePath(`${BUNDLE_TOKEN}/spec.md and ${BUNDLE_TOKEN}/briefs/`, "x")).toBe(
      "x/spec.md and x/briefs/",
    );
  });
});

describe("handoffFingerprint", () => {
  it("is stable for the same inputs", () => {
    expect(handoffFingerprint(aSource())).toBe(handoffFingerprint(aSource()));
  });

  it("changes with a blocker, a ticket field, the spec, or a project field the templates use", () => {
    const base = handoffFingerprint(aSource());
    const variants: HandoffSource[] = [
      { ...aSource(), tickets: aSource().tickets.map((t) => (t.number === 3 ? { ...t, blockedBy: [1] } : t)) },
      { ...aSource(), tickets: aSource().tickets.map((t) => (t.number === 1 ? { ...t, title: "Other" } : t)) },
      { ...aSource(), tickets: aSource().tickets.map((t) => (t.number === 1 ? { ...t, body: "Other" } : t)) },
      { ...aSource(), tickets: aSource().tickets.map((t) => (t.number === 1 ? { ...t, id: "t9" } : t)) },
      { ...aSource(), spec: { ...aSource().spec, updatedAt: "2026-09-02T00:00:00.000Z" } },
      { ...aSource(), spec: { ...aSource().spec, ticketsGeneratedAt: "2026-09-02T00:00:00.000Z" } },
      aSource({ verifyCommand: "pnpm test" }),
      aSource({ trackerKind: "beads" }),
      aSource({ buildRecordLogging: true }),
      aSource({ visibility: "ignored" }),
      aSource({ exportFolder: "docs" }),
      aSource({ trackerCommandsJson: "{}" }),
      aSource({ rootPath: "/elsewhere" }),
    ];
    for (const variant of variants) {
      expect(handoffFingerprint(variant)).not.toBe(base);
    }
  });
});
