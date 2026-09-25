import { describe, expect, it } from "vitest";

import {
  BUNDLE_TOKEN,
  bundlePathFor,
  CODEBASE_FACTS_SLOT,
  FILE_BOUNDARIES_SLOT,
  fillBundlePath,
  handoffFingerprint,
  type HandoffGrounding,
  type HandoffSource,
  renderBrief,
  renderHandoff,
} from "./handoff.js";

const ROOT = "/repos/target";

/** The local-merge recipe must never tell a building session to push, use `gh`, or open a pull request. */
function expectNoDeliveryMentions(text: string): void {
  expect(text).not.toMatch(/\bpush(es|ed|ing)?\b/i);
  expect(text).not.toMatch(/\bgh\b/i);
  expect(text).not.toMatch(/pull[ -]request/i);
  expect(text).not.toMatch(/\bPR\b/);
  expect(text).not.toMatch(/\borigin\b/i);
}

/** With the review switch off, nothing should mention a reviewer, in any case. */
function expectNoReviewerMention(text: string): void {
  expect(text).not.toMatch(/reviewer/i);
}

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
      deliveryRecipe: "pull-request",
      adversarialReview: true,
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

  it("embeds the pull-request lifecycle with the verify command filled in, review on by default", () => {
    const { markdown } = renderHandoff(aSource());
    expect(markdown).toContain("## Delegation lifecycle");
    expect(markdown).toContain("Local `main` holds nothing unpushed");
    expect(markdown).toContain("naming the files the ticket builds on");
    expect(markdown).toContain("Commits only on its worktree branch");
    expect(markdown).toContain("- Runs `just verify`; it must pass.");
    expect(markdown).toContain("stops before pushing and reports \"push pending: gh account\"");
    expect(markdown).toContain("opens a **draft** pull request against `main` with `gh pr create --draft`");
    expect(markdown).toContain("It never merges, and a draft is never merged by anyone.");
    expect(markdown).toContain("Read the PR diff (`gh pr diff <n>`)");
    expect(markdown).toContain("re-run `just verify` yourself in the worktree, plus any browser check");
    expect(markdown).toContain("gh pr ready --undo <n>");
    expect(markdown).toContain("send the failure back to the same agent");
    expect(markdown).toContain("`gh pr merge <n> --merge --delete-branch`. Never merge a draft.");
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

describe("delivery recipe and the review gate", () => {
  it("renders the pull-request recipe with review on: draft PR, reviewer section, undo ready on a failed re-verify", () => {
    const { markdown } = renderHandoff(aSource({ deliveryRecipe: "pull-request", adversarialReview: true }));
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain("opens a **draft** pull request against `main` with `gh pr create --draft`");
    expect(markdown).toContain("Never merge a draft.");
    expect(markdown).toContain('2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below)');
    expect(markdown).toContain("gh pr ready --undo <n>");
    expect(markdown).toContain("## Reviewing a ticket");
    expect(markdown).toContain("never the builder's report");
    expect(markdown).toContain(
      'It posts its verdict as a pull request comment, starting "Review verdict: approved" or "Review verdict: changes requested" with each finding, then runs `gh pr ready <n>` on approval.',
    );
    expect(markdown).toContain("After two rejected rounds, the operator decides.");
    expect(markdown).toContain("The reviewer changes no code and never merges.");
    expect(markdown).toContain("done (PR #<n>)");
  });

  it("renders the pull-request recipe with review off: draft PR, no reviewer anywhere", () => {
    const { markdown } = renderHandoff(aSource({ deliveryRecipe: "pull-request", adversarialReview: false }));
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain("opens a **draft** pull request against `main` with `gh pr create --draft`");
    expect(markdown).toContain("Never merge a draft.");
    expect(markdown).toContain("Mark the pull request ready (`gh pr ready <n>`) once you are satisfied");
    expect(markdown).not.toContain("## Reviewing a ticket");
    expectNoReviewerMention(markdown);
    expect(markdown).not.toContain("Review verdict");
  });

  it("renders the local-merge recipe with review on: baseRef head, verdict recorded through the tracker, never a push/gh/PR/origin", () => {
    const { markdown } = renderHandoff(aSource({ deliveryRecipe: "local-merge", adversarialReview: true }));
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain(
      'Add the `worktree.baseRef` key, set to `"head"`, to this repository\'s `.claude/settings.json`',
    );
    expect(markdown).toContain("merge it into whatever settings are already there, never replace the file");
    expect(markdown).toContain(".claude/settings.local.json` instead when this setting should stay personal");
    expect(markdown).toContain("keep `main` checked out in this session");
    expect(markdown).toContain("Commit again whenever the bundle is re-exported.");
    expect(markdown).toContain(
      "Local `main` holds every change you want the next worktree to start from — commit it before delegating.",
    );
    expect(markdown).toContain("Reports its branch name, then stops. It never merges.");
    expect(markdown).toContain("Read the branch diff (`git diff main..<branch>`)");
    expect(markdown).toContain('2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below)');
    expect(markdown).toContain("Merge only approved, verified work, locally: `git merge --no-ff <branch>`.");
    expect(markdown).toContain("Re-run `just verify` on `main` after merging.");
    expect(markdown).toContain(
      "done (merged)` (the ticket's `## Review` section already carries the reviewer's verdict).",
    );
    expect(markdown).toContain("## Reviewing a ticket");
    expect(markdown).toContain("it writes to neither the tracker nor the bundle");
    expect(markdown).toContain("append a `## Review` section to the ticket file with the verdict and any findings");
    expect(markdown.toLowerCase()).not.toContain("no remote");
    expect(markdown.toLowerCase()).not.toContain("remote");
    expectNoDeliveryMentions(markdown);
  });

  it("renders the local-merge recipe with review off: baseRef head, no reviewer, never a push/gh/PR/origin", () => {
    const { markdown } = renderHandoff(aSource({ deliveryRecipe: "local-merge", adversarialReview: false }));
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain(
      'Add the `worktree.baseRef` key, set to `"head"`, to this repository\'s `.claude/settings.json`',
    );
    expect(markdown).toContain(".claude/settings.local.json` instead when this setting should stay personal");
    expect(markdown).toContain(
      "Local `main` holds every change you want the next worktree to start from — commit it before delegating.",
    );
    expect(markdown).toContain("Merge only verified work, locally: `git merge --no-ff <branch>`.");
    expect(markdown).toContain("Re-run `just verify` on `main` after merging.");
    expect(markdown).toContain("done (merged)`.");
    expect(markdown).not.toContain("## Reviewing a ticket");
    expectNoReviewerMention(markdown);
    expect(markdown).not.toContain("Review verdict");
    expect(markdown.toLowerCase()).not.toContain("remote");
    expectNoDeliveryMentions(markdown);
  });

  it("renders the local-merge recipe with beads and review on: verdict recorded as a bead comment", () => {
    const { markdown } = renderHandoff(
      aSource({ deliveryRecipe: "local-merge", adversarialReview: true, trackerKind: "beads" }),
    );
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain("as a comment on the ticket's bead.");
    expect(markdown).toContain(
      "Close the ticket's bead with a comment naming the merge commit and the reviewer's verdict.",
    );
    expect(markdown).not.toContain("Status:");
    expectNoDeliveryMentions(markdown);
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
    expect(brief).toContain("never commit directly on `main`, and never merge anything");
    expect(brief).toContain("`git push -u origin HEAD`, then `gh pr create --draft` against `main`");
    expect(brief).toContain("push pending: gh account");
    expect(brief).toContain("## Report, then stop");
    expect(brief).toContain("A separate reviewer reviews the work before any merge.");
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

  describe("delivery recipe and the review gate", () => {
    it("renders the pull-request recipe with review on: draft PR, the reviewer marks it ready, reviewer noted before stop", () => {
      const brief = renderHandoff(aSource({ deliveryRecipe: "pull-request", adversarialReview: true })).briefs[1]!
        .markdown;
      expect(brief).toMatchSnapshot();
      expect(brief).toContain("Your worktree was created from `origin/main`.");
      expect(brief).toContain("## Delivery");
      expect(brief).toContain("`git push -u origin HEAD`, then `gh pr create --draft` against `main`");
      expect(brief).toContain("Never merge, and never mark it ready — the reviewer does that once it approves.");
      expect(brief).toContain("- the PR URL, or \"push pending: gh account\" with your commit hash;");
      expect(brief).toContain("A separate reviewer reviews the work before any merge.");
    });

    it("renders the pull-request recipe with review off: draft PR, the main session marks it ready, no reviewer mention", () => {
      const brief = renderHandoff(aSource({ deliveryRecipe: "pull-request", adversarialReview: false })).briefs[1]!
        .markdown;
      expect(brief).toMatchSnapshot();
      expect(brief).toContain("`git push -u origin HEAD`, then `gh pr create --draft` against `main`");
      expect(brief).toContain(
        "Never merge, and never mark it ready — the main session does that once it is satisfied.",
      );
      expectNoReviewerMention(brief);
    });

    it("renders the local-merge recipe with review on: worktree from the main session's current main, reviewer noted before stop, never a push/gh/PR/origin", () => {
      const brief = renderHandoff(aSource({ deliveryRecipe: "local-merge", adversarialReview: true })).briefs[1]!
        .markdown;
      expect(brief).toMatchSnapshot();
      expect(brief).toContain("Your worktree was created from the main session's current `main`.");
      expect(brief).toContain("## Delivery");
      expect(brief).toContain(
        "Commit your work on your worktree branch, then report its name: this project uses the local-merge recipe, so nothing you do here reaches `main` on its own.",
      );
      expect(brief).toContain("A separate reviewer reviews the work before any merge.");
      expect(brief).not.toContain("- the PR URL, or \"push pending: gh account\" with your commit hash;");
      expect(brief.toLowerCase()).not.toContain("remote");
      expectNoDeliveryMentions(brief);
    });

    it("renders the local-merge recipe with review off: worktree from the main session's current main, no reviewer mention, never a push/gh/PR/origin", () => {
      const brief = renderHandoff(aSource({ deliveryRecipe: "local-merge", adversarialReview: false })).briefs[1]!
        .markdown;
      expect(brief).toMatchSnapshot();
      expect(brief).toContain("Your worktree was created from the main session's current `main`.");
      expect(brief).toContain(
        "Commit your work on your worktree branch, then report its name: this project uses the local-merge recipe, so nothing you do here reaches `main` on its own.",
      );
      expectNoReviewerMention(brief);
      expect(brief.toLowerCase()).not.toContain("remote");
      expectNoDeliveryMentions(brief);
    });
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

  it("hashes a project on the delivery-recipe/review defaults exactly as it did before those fields existed", () => {
    // Pinned by running the pre-change `handoffFingerprint` (the version
    // with no `deliveryRecipe`/`adversarialReview` in its canonical object
    // at all) over this same `aSource()` fixture, minus those two fields.
    // `deliveryRecipe: "pull-request"` and `adversarialReview: true` are the
    // migration defaults every existing project got, so a project still on
    // them must keep hashing this way — otherwise every handoff stored
    // before this change goes stale on upgrade for nothing that actually
    // changed.
    expect(handoffFingerprint(aSource())).toBe(
      "7cb3834b6357f33c1d8fd7a276ceb2266946f3cf08139ebab86bf924b1125261",
    );
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
      aSource({ deliveryRecipe: "local-merge" }),
      aSource({ adversarialReview: false }),
    ];
    for (const variant of variants) {
      expect(handoffFingerprint(variant)).not.toBe(base);
    }
  });
});

describe("grounded briefs", () => {
  /** Ticket 1 has no blockers, so its grounding exercises facts and an empty "Builds on". */
  const TICKET_1_GROUNDING = {
    number: 1,
    filesToChange: [
      { path: "server/projects.ts", change: "create" as const },
      { path: "server/db/schema.ts", change: "edit" as const },
    ],
    buildsOnFiles: ["server/git.ts:10-20"],
    facts: [
      {
        statement: "Projects are registered through registerProject.",
        citation: "actions/register-project.ts:5",
      },
    ],
    buildsOn: [],
    provedBy: {
      testPath: "server/projects.test.ts",
      command: "pnpm exec vitest run server/projects.test.ts",
    },
  };

  /** Ticket 2 is blocked by 1, so its grounding exercises a "Builds on" dependency on a created path. */
  const TICKET_2_GROUNDING = {
    number: 2,
    filesToChange: [{ path: "server/export-bundle.ts", change: "edit" as const }],
    buildsOnFiles: [],
    facts: [],
    buildsOn: [
      {
        blocker: 1,
        provides: "the project registry",
        citation: null,
        createdPath: "server/projects.ts",
        editedPath: null,
        symbol: null,
        check: "test -f server/projects.ts",
      },
    ],
    provedBy: {
      testPath: "server/export-bundle.test.ts",
      command: "pnpm exec vitest run server/export-bundle.test.ts",
    },
  };

  const CURRENT_GROUNDING: HandoffGrounding = {
    tickets: [TICKET_1_GROUNDING, TICKET_2_GROUNDING],
    commitRead: "abcdef1234567890",
    current: true,
    staleReason: null,
  };

  /** `markdown`'s section from `heading` up to (not including) the next `## ` heading. */
  function section(markdown: string, heading: string): string {
    const start = markdown.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    return markdown.slice(start, markdown.indexOf("\n## ", start + 1)).replace(/\n+$/, "");
  }

  /**
   * The whole grounded block, from "## File boundaries" up to (not
   * including) "## Rules": pins not just each section's text but where the
   * new sections sit — directly after Codebase facts, directly before Rules,
   * in this order, with nothing else between them.
   */
  function groundedBlock(markdown: string): string {
    const start = markdown.indexOf("## File boundaries");
    expect(start).toBeGreaterThan(-1);
    const end = markdown.indexOf("\n## Rules", start);
    expect(end).toBeGreaterThan(-1);
    return markdown.slice(start, end).replace(/\n+$/, "");
  }

  function ticketByNumber(number: number) {
    return aSource().tickets.find((ticket) => ticket.number === number)!;
  }

  it("fills File boundaries and Codebase facts, and adds Builds on and Proved by, from current grounding, in that order before Rules", () => {
    const brief = renderBrief(aSource(), ticketByNumber(2), { grounding: CURRENT_GROUNDING });

    expect(groundedBlock(brief)).toBe(
      [
        "## File boundaries",
        "",
        "Files to edit:",
        "",
        "- `server/export-bundle.ts`",
        "",
        "## Codebase facts",
        "",
        "No codebase facts cited.",
        "",
        "## Builds on",
        "",
        "- Ticket 01: the project registry — created by ticket 01 at `server/projects.ts` — check: `test -f server/projects.ts`",
        "",
        "## Proved by",
        "",
        "Test: `server/export-bundle.test.ts`",
        "",
        "```bash",
        "pnpm exec vitest run server/export-bundle.test.ts",
        "```",
      ].join("\n"),
    );
  });

  it("names what a blocker adds to a file it edits, and the check, in Builds on", () => {
    const grounding: HandoffGrounding = {
      ...CURRENT_GROUNDING,
      tickets: [
        ...CURRENT_GROUNDING.tickets,
        {
          number: 3,
          filesToChange: [{ path: "server/export.test.ts", change: "edit" }],
          buildsOnFiles: [],
          facts: [],
          buildsOn: [
            {
              blocker: 1,
              provides: "the column that records a project's root",
              citation: null,
              createdPath: null,
              editedPath: "server/db/schema.ts",
              symbol: "rootPath",
              check: "grep -n rootPath server/db/schema.ts",
            },
          ],
          provedBy: {
            testPath: "server/export.test.ts",
            command: "pnpm exec vitest run server/export.test.ts",
          },
        },
      ],
    };

    const brief = renderBrief(aSource(), ticketByNumber(3), { grounding });

    expect(section(brief, "## Builds on")).toBe(
      [
        "## Builds on",
        "",
        "- Ticket 01: the column that records a project's root — ticket 01 adds `rootPath` to `server/db/schema.ts` — check: `grep -n rootPath server/db/schema.ts`",
      ].join("\n"),
    );
  });

  it("escapes a single backtick inside a Builds-on citation by widening the inline-code fence", () => {
    const grounding: HandoffGrounding = {
      ...CURRENT_GROUNDING,
      tickets: [
        TICKET_1_GROUNDING,
        {
          ...TICKET_2_GROUNDING,
          buildsOn: [
            {
              blocker: 1,
              provides: "the project registry",
              citation: "server/git.ts:10 (calls `runGit`)",
              createdPath: null,
              editedPath: null,
              symbol: null,
              check: "test -f server/projects.ts",
            },
          ],
        },
      ],
    };

    const brief = renderBrief(aSource(), ticketByNumber(2), { grounding });

    expect(section(brief, "## Builds on")).toBe(
      [
        "## Builds on",
        "",
        "- Ticket 01: the project registry — ``server/git.ts:10 (calls `runGit`)`` — check: `test -f server/projects.ts`",
      ].join("\n"),
    );
  });

  it("escapes a double backtick inside a Builds-on citation with a triple-backtick fence", () => {
    const grounding: HandoffGrounding = {
      ...CURRENT_GROUNDING,
      tickets: [
        TICKET_1_GROUNDING,
        {
          ...TICKET_2_GROUNDING,
          buildsOn: [
            {
              blocker: 1,
              provides: "the project registry",
              citation: "server/git.ts:10 (the ``raw`` diff)",
              createdPath: null,
              editedPath: null,
              symbol: null,
              check: "test -f server/projects.ts",
            },
          ],
        },
      ],
    };

    const brief = renderBrief(aSource(), ticketByNumber(2), { grounding });

    expect(section(brief, "## Builds on")).toBe(
      [
        "## Builds on",
        "",
        "- Ticket 01: the project registry — ```server/git.ts:10 (the ``raw`` diff)``` — check: `test -f server/projects.ts`",
      ].join("\n"),
    );
  });

  it("marks a file to edit that a blocker creates with the ticket that creates it, and only for a blocker", () => {
    const createsTest = {
      ...TICKET_1_GROUNDING,
      filesToChange: [
        ...TICKET_1_GROUNDING.filesToChange,
        { path: "server/projects.test.ts", change: "create" as const },
      ],
    };
    const editsTest = (number: number) => ({
      ...TICKET_2_GROUNDING,
      number,
      filesToChange: [
        { path: "server/export-bundle.ts", change: "edit" as const },
        { path: "server/projects.test.ts", change: "edit" as const },
      ],
    });
    const grounding: HandoffGrounding = {
      ...CURRENT_GROUNDING,
      tickets: [createsTest, editsTest(2), editsTest(3)],
    };

    const blocked = renderBrief(aSource(), ticketByNumber(2), { grounding });
    const unblocked = renderBrief(aSource(), ticketByNumber(3), { grounding });

    expect(section(blocked, "## File boundaries")).toBe(
      [
        "## File boundaries",
        "",
        "Files to edit:",
        "",
        "- `server/export-bundle.ts`",
        "- `server/projects.test.ts` (created by ticket 01)",
      ].join("\n"),
    );
    expect(section(unblocked, "## File boundaries")).toBe(
      [
        "## File boundaries",
        "",
        "Files to edit:",
        "",
        "- `server/export-bundle.ts`",
        "- `server/projects.test.ts`",
      ].join("\n"),
    );
  });

  it("fills a ticket with no blockers: cited facts, an existing file it builds on, and no Builds on section, Proved by directly before Rules", () => {
    const brief = renderBrief(aSource(), ticketByNumber(1), { grounding: CURRENT_GROUNDING });

    expect(groundedBlock(brief)).toBe(
      [
        "## File boundaries",
        "",
        "Files to create:",
        "",
        "- `server/projects.ts`",
        "",
        "Files to edit:",
        "",
        "- `server/db/schema.ts`",
        "",
        "Existing files it builds on:",
        "",
        "- `server/git.ts:10-20`",
        "",
        "## Codebase facts",
        "",
        "- Projects are registered through registerProject. (`actions/register-project.ts:5`)",
        "",
        "## Proved by",
        "",
        "Test: `server/projects.test.ts`",
        "",
        "```bash",
        "pnpm exec vitest run server/projects.test.ts",
        "```",
      ].join("\n"),
    );
    expect(brief).not.toContain("## Builds on");
  });

  it("shows the command alone, with no Test line, for a ticket whose testPath is null", () => {
    const grounding: HandoffGrounding = {
      ...CURRENT_GROUNDING,
      tickets: [
        {
          ...TICKET_1_GROUNDING,
          provedBy: { testPath: null, command: "cd backend && go build ./..." },
        },
      ],
    };
    const brief = renderBrief(aSource(), ticketByNumber(1), { grounding });

    expect(section(brief, "## Proved by")).toBe(
      ["## Proved by", "", "```bash", "cd backend && go build ./...", "```"].join("\n"),
    );
    expect(brief).not.toContain("Test: ");
    expect(brief.indexOf("## Proved by")).toBeLessThan(brief.indexOf("## Rules"));
  });

  it("renders stale grounding under one line naming an earlier version of the handoff", () => {
    const stale: HandoffGrounding = { ...CURRENT_GROUNDING, current: false, staleReason: "handoff-changed" };
    const brief = renderBrief(aSource(), ticketByNumber(1), { grounding: stale });

    expect(section(brief, "## File boundaries")).toBe(
      [
        "## File boundaries",
        "",
        "_Grounded at commit `abcdef1` for an earlier version of the handoff (tickets or project settings)._",
        "",
        "Files to create:",
        "",
        "- `server/projects.ts`",
        "",
        "Files to edit:",
        "",
        "- `server/db/schema.ts`",
        "",
        "Existing files it builds on:",
        "",
        "- `server/git.ts:10-20`",
      ].join("\n"),
    );
    // Codebase facts, Builds on and Proved by are unaffected by staleness beyond the shared banner.
    expect(section(brief, "## Codebase facts")).toBe(
      [
        "## Codebase facts",
        "",
        "- Projects are registered through registerProject. (`actions/register-project.ts:5`)",
      ].join("\n"),
    );
  });

  it("renders stale grounding under one line naming that the repository has moved since", () => {
    const stale: HandoffGrounding = { ...CURRENT_GROUNDING, current: false, staleReason: "head-moved" };
    const brief = renderBrief(aSource(), ticketByNumber(1), { grounding: stale });

    expect(section(brief, "## File boundaries")).toBe(
      [
        "## File boundaries",
        "",
        "_Grounded at commit `abcdef1`; the repository has moved since._",
        "",
        "Files to create:",
        "",
        "- `server/projects.ts`",
        "",
        "Files to edit:",
        "",
        "- `server/db/schema.ts`",
        "",
        "Existing files it builds on:",
        "",
        "- `server/git.ts:10-20`",
      ].join("\n"),
    );
  });

  it("keeps today's slots exactly when there is no grounding", () => {
    const withoutOption = renderBrief(aSource(), ticketByNumber(2));
    const withNullGrounding = renderBrief(aSource(), ticketByNumber(2), { grounding: null });
    expect(withNullGrounding).toBe(withoutOption);
    expect(withoutOption).toContain(FILE_BOUNDARIES_SLOT);
    expect(withoutOption).toContain(CODEBASE_FACTS_SLOT);
    expect(withoutOption).not.toContain("## Builds on");
    expect(withoutOption).not.toContain("## Proved by");
    expect(withoutOption).not.toContain("_Grounded");
  });

  it("keeps a grounding ticket's absence the same as no grounding for that ticket", () => {
    const partial: HandoffGrounding = { ...CURRENT_GROUNDING, tickets: [TICKET_2_GROUNDING] };
    const brief = renderBrief(aSource(), ticketByNumber(1), { grounding: partial });
    expect(brief).toContain(FILE_BOUNDARIES_SLOT);
    expect(brief).toContain(CODEBASE_FACTS_SLOT);
  });

  it("renderHandoff grounds every brief the grounding covers, ticket 3 (uncovered) keeping today's empty slots", () => {
    const { briefs } = renderHandoff(aSource(), { grounding: CURRENT_GROUNDING });

    const first = briefs.find((brief) => brief.ticketNumber === 1)!.markdown;
    expect(first).toContain("Files to create:");
    expect(first).toContain("## Proved by");

    const second = briefs.find((brief) => brief.ticketNumber === 2)!.markdown;
    expect(second).toContain("## Builds on");

    // Ticket 3 has no grounding entry, so it keeps today's empty slots.
    const third = briefs.find((brief) => brief.ticketNumber === 3)!.markdown;
    expect(third).toContain(FILE_BOUNDARIES_SLOT);
  });

  it("HANDOFF.md tells the orchestrator to check the slots, not fill them, when grounding is current", () => {
    const current = renderHandoff(aSource(), { grounding: CURRENT_GROUNDING }).markdown;
    expect(current).toContain("grounded and current");
    expect(current).not.toContain("Fill the brief's **File boundaries** slot");
    expect(current).not.toContain("Fill the **Codebase facts** slot");

    const stale = renderHandoff(aSource(), {
      grounding: { ...CURRENT_GROUNDING, current: false, staleReason: "head-moved" },
    }).markdown;
    expect(stale).toContain("Fill the brief's **File boundaries** slot");
    expect(stale).toContain("Fill the **Codebase facts** slot");

    const none = renderHandoff(aSource()).markdown;
    expect(none).toContain("Fill the brief's **File boundaries** slot");
    expect(none).toContain("Fill the **Codebase facts** slot");
  });
});
