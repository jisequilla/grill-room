import { describe, expect, it } from "vitest";

import {
  BUNDLE_TOKEN,
  bundlePathFor,
  CODEBASE_FACTS_SLOT,
  type ExportFacts,
  FILE_BOUNDARIES_SLOT,
  fillBundlePath,
  handoffFingerprint,
  type HandoffGrounding,
  type HandoffSource,
  parseBriefs,
  renderBrief,
  renderHandoff,
  renderHandoffMarkdown,
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

const FIXTURE_SPEC = [
  "## Problem Statement",
  "",
  "Sessions end in a spec nobody can find from the repository.",
  "",
  "## Solution",
  "",
  "Export each grilled session into the repository it builds.",
  "",
  "## User Stories",
  "",
  "1. As an operator, I want the bundle in my repository, so that agents can read it.",
  "",
].join("\n");

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
    spec: {
      updatedAt: "2026-09-01T10:00:00.000Z",
      ticketsGeneratedAt: "2026-09-01T10:05:00.000Z",
      markdown: FIXTURE_SPEC,
    },
    tickets: [
      { id: "t1", number: 1, slug: "register-projects", title: "Register projects", body: "Build the registry.", blockedBy: [] },
      { id: "t2", number: 2, slug: "export-bundle", title: "Export the bundle", body: "Write the bundle.", blockedBy: [1] },
      { id: "t3", number: 3, slug: "slug-proposal", title: "Propose a slug", body: "Propose it.", blockedBy: [] },
    ],
    waves: [[1, 3], [2]],
    project: {
      rootPath: ROOT,
      workingExportFolder: ".scratch",
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

const PAYMENT_ACCOUNT = "A live account on the payment platform, with API keys issued.";

/**
 * Like {@link aSource}, with a gate: 01 and 03 are build tickets, 02 is a
 * gate on a payment account, and 03 is blocked by 01 and the gate. The gate
 * is blocked by `gateBlockedBy` (none by default).
 */
function aSourceWithGate(
  overrides: Partial<HandoffSource["project"]> = {},
  gateBlockedBy: number[] = [],
): HandoffSource {
  const base = aSource(overrides);
  return {
    ...base,
    tickets: [
      { id: "t1", number: 1, slug: "register-projects", title: "Register projects", body: "Build the registry.", blockedBy: [] },
      {
        id: "t2",
        number: 2,
        slug: "payment-account",
        title: "Payment account is live",
        body: "The owner opens the account; it is in place once API keys are issued.",
        blockedBy: gateBlockedBy,
        kind: "gate",
        waitsFor: PAYMENT_ACCOUNT,
      },
      { id: "t3", number: 3, slug: "export-bundle", title: "Export the bundle", body: "Write the bundle.", blockedBy: [1, 2], kind: "build", waitsFor: null },
    ],
    waves: gateBlockedBy.length > 0 ? [[1], [2], [3]] : [[1, 2], [3]],
  };
}

/** One top-level section, from its heading up to the next one. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end === -1 ? undefined : end).trimEnd();
}

/** The exact `## Build records` section: one command template, session id filled in. */
function buildRecordTemplate(sessionId: string): string {
  return [
    "## Build records",
    "",
    "Log each ticket's outcome in Grill Room once it closes. Run this command from the Grill Room app folder (it reaches its running dev server), once per ticket: set `<ticket-number>` to the ticket's number and fill in the other placeholders.",
    "",
    "```bash",
    `pnpm action set-build-record --sessionId ${sessionId} --ticketNumber <ticket-number> --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done`,
    "```",
  ].join("\n");
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

  it("opens with the spec's Problem Statement and Solution, then the labelled idea, then where things are", () => {
    const opening = [
      "# Handoff: Export anywhere",
      "",
      "## Problem Statement",
      "",
      "Sessions end in a spec nobody can find from the repository.",
      "",
      "## Solution",
      "",
      "Export each grilled session into the repository it builds.",
      "",
      "## The original idea, before the interview",
      "",
      "Export a grilled session into any repository.",
      "",
      "## Where things are",
      "",
      "This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.",
      "",
      "Paths below are relative to the repository root (`/repos/target`). The bundle lives in `.scratch`, which git tracks.",
      "",
      `- Spec: \`${BUNDLE_TOKEN}/spec.md\``,
      "",
    ].join("\n");
    const withSpec = renderHandoff(aSource()).markdown;
    expect(withSpec.startsWith(opening)).toBe(true);

    const noHeadings = { ...aSource(), spec: { ...aSource().spec, markdown: "## Problem\n\nA spec." } };
    const withoutSpec = renderHandoff(noHeadings).markdown;
    const specSections = [
      "## Problem Statement",
      "",
      "Sessions end in a spec nobody can find from the repository.",
      "",
      "## Solution",
      "",
      "Export each grilled session into the repository it builds.",
      "",
      "",
    ].join("\n");
    expect(withSpec.replace(specSections, "")).toBe(withoutSpec);
    expect(withoutSpec.startsWith(
      "# Handoff: Export anywhere\n\n## The original idea, before the interview\n\nExport a grilled session into any repository.\n\n## Where things are\n\n",
    )).toBe(true);
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

  it("gives one build-record command template with the session id filled in, only when the toggle is on", () => {
    const off = renderHandoff(aSource({ buildRecordLogging: false }));
    expect(off.markdown).not.toContain("## Build records");
    expect(off.markdown).not.toContain("set-build-record");

    const on = renderHandoff(aSource({ buildRecordLogging: true }));
    expect(section(on.markdown, "## Build records")).toBe(buildRecordTemplate("session-123"));
  });

  it("renders the same template for one ticket as for three", () => {
    const three = renderHandoff(aSource({ buildRecordLogging: true }));
    const oneTicketSource: HandoffSource = {
      ...aSource({ buildRecordLogging: true }),
      tickets: [aSource().tickets[0]],
      waves: [[1]],
    };
    const one = renderHandoff(oneTicketSource);

    expect(section(one.markdown, "## Build records")).toBe(section(three.markdown, "## Build records"));
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

describe("parseBriefs", () => {
  it("keeps a string generatedSha256 and drops a non-string one, keeping the brief", () => {
    const json = JSON.stringify([
      { ticketNumber: 1, relativePath: "briefs/01-a.md", markdown: "# A\n", generatedSha256: "abc" },
      { ticketNumber: 2, relativePath: "briefs/02-b.md", markdown: "# B\n", generatedSha256: 42 },
      { ticketNumber: 3, relativePath: "briefs/03-c.md", markdown: "# C\n", generatedSha256: null },
      { ticketNumber: 4, relativePath: "briefs/04-d.md", markdown: "# D\n" },
    ]);
    expect(parseBriefs(json)).toEqual([
      { ticketNumber: 1, relativePath: "briefs/01-a.md", markdown: "# A\n", generatedSha256: "abc" },
      { ticketNumber: 2, relativePath: "briefs/02-b.md", markdown: "# B\n" },
      { ticketNumber: 3, relativePath: "briefs/03-c.md", markdown: "# C\n" },
      { ticketNumber: 4, relativePath: "briefs/04-d.md", markdown: "# D\n" },
    ]);
  });
});

describe("handoffFingerprint", () => {
  it("is stable for the same inputs", () => {
    expect(handoffFingerprint(aSource())).toBe(handoffFingerprint(aSource()));
  });

  it("ignores the spec's text, since every write of it also moves updatedAt", () => {
    const otherText = { ...aSource(), spec: { ...aSource().spec, markdown: "## Problem Statement\n\nOther." } };
    expect(handoffFingerprint(otherText)).toBe(handoffFingerprint(aSource()));
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

  it("hashes a project's working export folder exactly as it did before that field was renamed", () => {
    // Pinned by running the pre-rename `handoffFingerprint` (gr-0hy.1) over
    // this same `aSource()` fixture, when its project field was still the
    // export-folder field under its old name. The fingerprint's own
    // canonical key stays that same literal key so this must still match: an
    // existing session's stored handoff must not go stale just because the
    // field that feeds it was renamed.
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
      aSource({ workingExportFolder: "docs" }),
      aSource({ trackerCommandsJson: "{}" }),
      aSource({ rootPath: "/elsewhere" }),
      aSource({ deliveryRecipe: "local-merge" }),
      aSource({ adversarialReview: false }),
      aSource({ maxTicketsInFlight: 2 }),
    ];
    for (const variant of variants) {
      expect(handoffFingerprint(variant)).not.toBe(base);
    }
  });

  it("hashes a project on the default in-flight cap exactly as before, and a changed cap differently", () => {
    const pinned = "7cb3834b6357f33c1d8fd7a276ceb2266946f3cf08139ebab86bf924b1125261";

    expect(handoffFingerprint(aSource())).toBe(pinned);
    expect(handoffFingerprint(aSource({ maxTicketsInFlight: 3 }))).toBe(pinned);
    expect(handoffFingerprint(aSource({ maxTicketsInFlight: 2 }))).not.toBe(pinned);
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

describe("export-time facts", () => {
  const TRACKED_NOTE = `Paths below are relative to the repository root (\`${ROOT}\`). The bundle lives in \`.scratch\`, which git tracks.`;
  const TRACKED_GREENFIELD_NOTE = `Paths below are relative to the repository root (\`${ROOT}\`). The bundle lives in \`.scratch\`, which git will track once it is committed; this repository has no commits yet.`;
  const IGNORED_NOTE = `Paths below are absolute, into the main checkout at \`${ROOT}\`. The bundle lives in \`.scratch\`, which git ignores: it never reaches a worktree through git.`;
  const GREENFIELD_PARAGRAPH =
    "This repository has no commits yet (greenfield). A worktree branches from a commit, so make the first commit before delegating the first ticket.";
  const SPEC = `\`${BUNDLE_TOKEN}/spec.md\``;
  const TICKET = `\`${BUNDLE_TOKEN}/issues/01-register-projects.md\``;
  const TRACKED_ACCESS = `The bundle is committed in this repository, so your worktree has it. Read the spec at ${SPEC} and your ticket at ${TICKET}, relative to the repository root in your worktree.`;
  const TRACKED_GREENFIELD_ACCESS = `This repository had no commits when the bundle was exported. HANDOFF.md has the operator commit the bundle before delegating, so your worktree should have it: read the spec at ${SPEC} and your ticket at ${TICKET}, relative to the repository root in your worktree. If they are missing, stop and report.`;
  const IGNORED_ACCESS = `The bundle is ignored by git, so it is NOT in your worktree. Read it by absolute path from the main checkout: the spec at ${SPEC} and your ticket at ${TICKET}. Never write to it.`;

  /** The "Before delegating" section alone, up to the next top-level heading. */
  function beforeDelegating(markdown: string): string {
    const start = markdown.indexOf("## Before delegating the first ticket");
    expect(start).toBeGreaterThan(-1);
    return markdown.slice(start, markdown.indexOf("\n## ", start + 1));
  }

  function briefAt(
    source: HandoffSource,
    index: number,
    facts?: { visibility: "tracked" | "ignored"; greenfield: boolean },
  ) {
    return renderBrief(source, source.tickets[index]!, {}, facts);
  }

  describe("pathsNote", () => {
    it("tracked, not greenfield: unchanged", () => {
      const markdown = renderHandoffMarkdown(aSource(), false, { visibility: "tracked", greenfield: false });
      expect(markdown).toContain(TRACKED_NOTE);
      expect(markdown).toBe(renderHandoffMarkdown(aSource()));
    });

    it("tracked, greenfield: git will track it once committed", () => {
      const markdown = renderHandoffMarkdown(aSource(), false, { visibility: "tracked", greenfield: true });
      expect(markdown).toContain(TRACKED_GREENFIELD_NOTE);
      expect(markdown).not.toContain("which git tracks");
    });

    it.each([false, true])("ignored, greenfield %s: the ignored sentence", (greenfield) => {
      const markdown = renderHandoffMarkdown(aSource(), false, { visibility: "ignored", greenfield });
      expect(markdown).toContain(IGNORED_NOTE);
      expect(markdown).not.toContain("which git tracks");
    });
  });

  describe("beforeDelegatingSection", () => {
    it.each([
      ["tracked", "pull-request"],
      ["tracked", "local-merge"],
      ["ignored", "pull-request"],
      ["ignored", "local-merge"],
    ] as const)(
      "greenfield (%s, %s): the greenfield paragraph comes first, then the section for the effective visibility",
      (visibility, deliveryRecipe) => {
        const greenfield = beforeDelegating(
          renderHandoffMarkdown(aSource({ deliveryRecipe, visibility: "tracked" }), false, {
            visibility,
            greenfield: true,
          }),
        );
        const plain = beforeDelegating(renderHandoffMarkdown(aSource({ deliveryRecipe, visibility })));
        expect(greenfield).toBe(
          plain.replace(
            "## Before delegating the first ticket\n\n",
            `## Before delegating the first ticket\n\n${GREENFIELD_PARAGRAPH}\n\n`,
          ),
        );
        if (deliveryRecipe === "local-merge") {
          expect(greenfield.indexOf(GREENFIELD_PARAGRAPH)).toBeLessThan(greenfield.indexOf("worktree.baseRef"));
        }
      },
    );

    it.each(["tracked", "ignored"] as const)("not greenfield (%s): unchanged", (visibility) => {
      const markdown = renderHandoffMarkdown(aSource({ visibility }), false, { visibility, greenfield: false });
      expect(markdown).not.toContain(GREENFIELD_PARAGRAPH);
      expect(markdown).toBe(renderHandoffMarkdown(aSource({ visibility })));
    });
  });

  describe("bundleAccess", () => {
    it("tracked, not greenfield: unchanged", () => {
      const brief = briefAt(aSource(), 0, { visibility: "tracked", greenfield: false });
      expect(brief).toContain(TRACKED_ACCESS);
      expect(brief).toBe(briefAt(aSource(), 0));
    });

    it("tracked, greenfield: the operator commits the bundle first", () => {
      const brief = briefAt(aSource(), 0, { visibility: "tracked", greenfield: true });
      expect(brief).toContain(TRACKED_GREENFIELD_ACCESS);
      expect(brief).not.toContain("The bundle is committed in this repository");
    });

    it.each([false, true])("ignored, greenfield %s: the ignored sentence", (greenfield) => {
      const brief = briefAt(aSource(), 0, { visibility: "ignored", greenfield });
      expect(brief).toContain(IGNORED_ACCESS);
      expect(brief).not.toContain("The bundle is committed in this repository");
    });
  });

  it("the facts override the stored flag, and omitting them renders from the stored flag", () => {
    const stale = aSource({ visibility: "tracked" });
    expect(renderHandoffMarkdown(stale, false, { visibility: "ignored", greenfield: false })).toBe(
      renderHandoffMarkdown(aSource({ visibility: "ignored" })),
    );
    expect(briefAt(stale, 0, { visibility: "ignored", greenfield: false })).toBe(
      briefAt(aSource({ visibility: "ignored" }), 0),
    );
  });

  describe("the verify command in a repository with no commits yet", () => {
    const HANDOFF_LINE =
      "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing, and every other ticket waits for ticket 01.";
    const FIRST_BRIEF_LINE =
      "This repository has no commits yet: this ticket sets up `just verify`. Make it run and pass from the repository root; that is part of your acceptance.";
    const OTHER_BRIEF_LINE = "`just verify` is established by ticket 01, which is merged before this ticket starts.";
    const NOT_REACHING_BRIEF_LINE =
      "`just verify` is set up by ticket 01, but this ticket does not depend on it, so it may not exist yet. If `just verify` does not run from the repository root, stop and report; do not create it yourself.";
    const ONE_NOT_REACHING_LINE =
      "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing. Ticket 03 does not depend on ticket 01, so run ticket 01 first and merge it before starting ticket 03.";
    const TWO_NOT_REACHING_LINE =
      "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing. Tickets 03 and 05 do not depend on ticket 01, so run ticket 01 first and merge it before starting them.";
    const THREE_NOT_REACHING_LINE =
      "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing. Tickets 03, 05 and 07 do not depend on ticket 01, so run ticket 01 first and merge it before starting them.";

    /** One top-level section, from its heading up to the next one. */
    function section(markdown: string, heading: string): string {
      const start = markdown.indexOf(heading);
      expect(start).toBeGreaterThan(-1);
      const end = markdown.indexOf("\n## ", start + 1);
      return markdown.slice(start, end === -1 ? undefined : end).trimEnd();
    }

    /**
     * Like {@link aSource}, but ticket 3 is blocked by 2 instead of
     * unblocked, so every ticket reaches ticket 1 through Blocked-by (3
     * transitively, through 2). `aSource` itself keeps ticket 3 unblocked
     * because the wave-order test above relies on it; these greenfield
     * reach tests need a fixture where every ticket actually reaches
     * ticket 1, so they use this one instead.
     */
    function aReachableSource(overrides: Partial<HandoffSource["project"]> = {}): HandoffSource {
      const source = aSource(overrides);
      return {
        ...source,
        tickets: source.tickets.map((ticket) => (ticket.number === 3 ? { ...ticket, blockedBy: [2] } : ticket)),
        waves: [[1], [2], [3]],
      };
    }

    /**
     * `count` tickets: 1 has no blockers; each number in `unblocked` has none
     * either, so it does not reach ticket 1; every other ticket is blocked
     * by 1.
     */
    function aSourceWithTickets(count: number, unblocked: readonly number[] = []): HandoffSource {
      const tickets = Array.from({ length: count }, (_, index) => ({
        id: `t${index + 1}`,
        number: index + 1,
        slug: `ticket-${index + 1}`,
        title: `Ticket ${index + 1}`,
        body: "Do it.",
        blockedBy: index === 0 || unblocked.includes(index + 1) ? [] : [1],
      }));
      return {
        ...aSource(),
        tickets,
        waves: [[1], tickets.slice(1).map((ticket) => ticket.number)],
      };
    }

    it.each(["tracked", "ignored"] as const)(
      "HANDOFF, greenfield (%s), every ticket reaches ticket 1: the Verify command section is unchanged, then the line",
      (visibility) => {
        const greenfield = section(
          renderHandoffMarkdown(aReachableSource(), false, { visibility, greenfield: true }),
          "## Verify command",
        );
        const plain = section(renderHandoffMarkdown(aReachableSource()), "## Verify command");
        expect(greenfield).toBe(`${plain}\n\n${HANDOFF_LINE}`);
      },
    );

    it("HANDOFF, greenfield, one ticket does not reach ticket 1: named in its own sentence", () => {
      const greenfield = section(
        renderHandoffMarkdown(aSource(), false, { visibility: "ignored", greenfield: true }),
        "## Verify command",
      );
      const plain = section(renderHandoffMarkdown(aSource()), "## Verify command");
      expect(greenfield).toBe(`${plain}\n\n${ONE_NOT_REACHING_LINE}`);
    });

    it("HANDOFF, greenfield, two tickets do not reach ticket 1: joined with \"and\"", () => {
      const source = aSourceWithTickets(5, [3, 5]);
      const greenfield = section(
        renderHandoffMarkdown(source, false, { visibility: "ignored", greenfield: true }),
        "## Verify command",
      );
      const plain = section(renderHandoffMarkdown(source), "## Verify command");
      expect(greenfield).toBe(`${plain}\n\n${TWO_NOT_REACHING_LINE}`);
    });

    it("HANDOFF, greenfield, three or more tickets do not reach ticket 1: joined with commas", () => {
      const source = aSourceWithTickets(7, [3, 5, 7]);
      const greenfield = section(
        renderHandoffMarkdown(source, false, { visibility: "ignored", greenfield: true }),
        "## Verify command",
      );
      const plain = section(renderHandoffMarkdown(source), "## Verify command");
      expect(greenfield).toBe(`${plain}\n\n${THREE_NOT_REACHING_LINE}`);
    });

    it.each(["tracked", "ignored"] as const)("HANDOFF, not greenfield (%s): unchanged", (visibility) => {
      const markdown = renderHandoffMarkdown(aSource({ visibility }), false, { visibility, greenfield: false });
      expect(markdown).not.toContain("does not exist until ticket");
      expect(markdown).toBe(renderHandoffMarkdown(aSource({ visibility })));
    });

    it.each(["tracked", "ignored"] as const)(
      "brief for ticket 1, greenfield (%s): the set-up line comes after the bundle-access paragraph",
      (visibility) => {
        const facts = { visibility, greenfield: true };
        const stepZero = section(briefAt(aSource(), 0, facts), "## Step 0: confirm your base");
        expect(stepZero.endsWith(`\n\n${FIRST_BRIEF_LINE}`)).toBe(true);
        expect(stepZero).not.toContain("is established by ticket");
      },
    );

    it.each([
      [1, "tracked"],
      [2, "tracked"],
      [1, "ignored"],
      [2, "ignored"],
    ] as const)(
      "brief for another ticket that reaches ticket 1 (index %i, %s), greenfield: the command is established by ticket 01",
      (index, visibility) => {
        const facts = { visibility, greenfield: true };
        const stepZero = section(briefAt(aReachableSource(), index, facts), "## Step 0: confirm your base");
        expect(stepZero.endsWith(`\n\n${OTHER_BRIEF_LINE}`)).toBe(true);
        expect(stepZero).not.toContain("this ticket sets up");
      },
    );

    it.each(["tracked", "ignored"] as const)(
      "brief for a ticket that does not reach ticket 1 (%s), greenfield: it may not exist yet",
      (visibility) => {
        const facts = { visibility, greenfield: true };
        const stepZero = section(briefAt(aSource(), 2, facts), "## Step 0: confirm your base");
        expect(stepZero.endsWith(`\n\n${NOT_REACHING_BRIEF_LINE}`)).toBe(true);
        expect(stepZero).not.toContain("this ticket sets up");
        expect(stepZero).not.toContain("is established by ticket");
      },
    );

    it.each([0, 1, 2])("brief at index %i, not greenfield: unchanged", (index) => {
      for (const visibility of ["tracked", "ignored"] as const) {
        const brief = briefAt(aSource({ visibility }), index, { visibility, greenfield: false });
        expect(brief).not.toContain("this ticket sets up");
        expect(brief).not.toContain("is established by ticket");
        expect(brief).toBe(briefAt(aSource({ visibility }), index));
      }
    });

    it("the ticket number is padded as every other ticket reference: 001 in a set of 100", () => {
      const source = aSourceWithTickets(100);
      const facts = { visibility: "ignored" as const, greenfield: true };

      expect(renderHandoffMarkdown(source, false, facts)).toContain(
        "This repository has no commits yet, so this command does not exist until ticket 001 sets it up. Ticket 001's acceptance includes it passing, and every other ticket waits for ticket 001.",
      );
      expect(briefAt(source, 1, facts)).toContain(
        "`just verify` is established by ticket 001, which is merged before this ticket starts.",
      );
    });

    it("the ticket number is padded in the non-reaching wording too: 001 and 003 in a set of 100", () => {
      const source = aSourceWithTickets(100, [3]);
      const facts = { visibility: "ignored" as const, greenfield: true };

      expect(renderHandoffMarkdown(source, false, facts)).toContain(
        "This repository has no commits yet, so this command does not exist until ticket 001 sets it up. Ticket 001's acceptance includes it passing. Ticket 003 does not depend on ticket 001, so run ticket 001 first and merge it before starting ticket 003.",
      );
      expect(briefAt(source, 2, facts)).toContain(
        "`just verify` is set up by ticket 001, but this ticket does not depend on it, so it may not exist yet. If `just verify` does not run from the repository root, stop and report; do not create it yourself.",
      );
    });

    it("a ticket that fails to reach ticket 1 only indirectly is named too: blocked by another non-reaching ticket", () => {
      // Ticket 3 is unblocked (non-reaching); ticket 4 is blocked by 3, not by
      // 1, so it does not reach ticket 1 either, only transitively through 3's
      // own non-reach.
      const base = aSourceWithTickets(5);
      const tickets = base.tickets.map((ticket) => {
        if (ticket.number === 3) return { ...ticket, blockedBy: [] };
        if (ticket.number === 4) return { ...ticket, blockedBy: [3] };
        return ticket;
      });
      const source: HandoffSource = { ...base, tickets, waves: [[1, 3], [2, 4], [5]] };
      const facts = { visibility: "ignored" as const, greenfield: true };

      expect(renderHandoffMarkdown(source, false, facts)).toContain(
        "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing. Tickets 03 and 04 do not depend on ticket 01, so run ticket 01 first and merge it before starting them.",
      );
    });

    it("a verify command with a backtick is still written as inline code", () => {
      const source = aSource({ verifyCommand: "echo `date`" });
      const facts = { visibility: "ignored" as const, greenfield: true };

      expect(briefAt(source, 0, facts)).toContain("this ticket sets up `` echo `date` ``.");
      expect(briefAt(source, 1, facts)).toContain("`` echo `date` `` is established by ticket 01");
    });

    it("the lifecycle, report and every other part are unchanged: only the two lines differ", () => {
      // Ignored visibility, where the bundle-access sentence and paths note
      // do not depend on greenfield, so the only other difference is the
      // "Before delegating" paragraph from gr-ibp.4.1.
      const facts = { visibility: "ignored" as const, greenfield: true };
      const source = aReachableSource({ visibility: "ignored" });

      expect(
        renderHandoffMarkdown(source, false, facts)
          .replace(`\n\n${HANDOFF_LINE}`, "")
          .replace(`${GREENFIELD_PARAGRAPH}\n\n`, ""),
      ).toBe(renderHandoffMarkdown(source));
      expect(briefAt(source, 0, facts).replace(`\n\n${FIRST_BRIEF_LINE}`, "")).toBe(briefAt(source, 0));
      expect(briefAt(source, 1, facts).replace(`\n\n${OTHER_BRIEF_LINE}`, "")).toBe(briefAt(source, 1));
    });
  });
});

describe("the waves section at export", () => {
  const CHECKED_LINE =
    "Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most 3 at a time. Start a wave only once every ticket of the previous wave is merged and verified.";
  const NOT_CHECKED_LINE =
    "Tickets in one wave have no Blocked-by between them. Whether they change the same files was not checked, because the briefs are not grounded against the current code: run them one at a time, or ground the briefs first. Start a wave only once every ticket of the previous wave is merged and verified.";

  /** The "Waves" section alone, up to the next top-level heading. */
  function wavesOf(markdown: string): string {
    const start = markdown.indexOf("## Waves");
    expect(start).toBeGreaterThan(-1);
    return markdown.slice(start, markdown.indexOf("\n## ", start + 1));
  }

  /** The ticket labels of each `### Wave N`, in order. */
  function labelsByWave(section: string): string[][] {
    return section
      .split("### Wave ")
      .slice(1)
      .map((wave) => [...wave.matchAll(/^- \*\*(\d+) /gm)].map((match) => match[1]!));
  }

  const plain = { visibility: "tracked" as const, greenfield: false };

  describe("current grounding", () => {
    it("keeps the whole parallel line, puts one line per implicit edge under it, and lays out the separated waves", () => {
      const section = wavesOf(
        renderHandoffMarkdown(aSource(), false, {
          ...plain,
          waves: [[1], [2, 3]],
          implicitEdges: [{ ticket: 3, waitsFor: 1, sharedPaths: ["server/export.ts"] }],
        }),
      );

      expect(section.startsWith(
        `## Waves\n\n${CHECKED_LINE}\n\n- Ticket 03 waits for ticket 01: both change \`server/export.ts\`.\n\n### Wave 1\n`,
      )).toBe(true);
      expect(labelsByWave(section)).toEqual([["01"], ["02", "03"]]);
      expect(section).not.toContain("was not checked");
    });

    it.each([
      [["a"], "`a`"],
      [["a", "b"], "`a` and `b`"],
      [["a", "b", "c"], "`a`, `b` and `c`"],
      [["a", "b", "c", "d"], "`a`, `b`, `c` and `d`"],
    ])("names shared paths %j as %s", (sharedPaths, named) => {
      const section = wavesOf(
        renderHandoffMarkdown(aSource(), false, {
          ...plain,
          waves: [[1], [2, 3]],
          implicitEdges: [{ ticket: 3, waitsFor: 1, sharedPaths }],
        }),
      );
      expect(section).toContain(`\n- Ticket 03 waits for ticket 01: both change ${named}.\n`);
    });

    it("writes the edge lines in wave order, not ticket order", () => {
      const section = wavesOf(
        renderHandoffMarkdown(aSource(), false, {
          ...plain,
          waves: [[2], [3], [1]],
          implicitEdges: [
            { ticket: 1, waitsFor: 3, sharedPaths: ["a"] },
            { ticket: 3, waitsFor: 2, sharedPaths: ["b"] },
          ],
        }),
      );
      expect(section).toContain(
        `${CHECKED_LINE}\n\n- Ticket 03 waits for ticket 02: both change \`b\`.\n- Ticket 01 waits for ticket 03: both change \`a\`.\n\n### Wave 1`,
      );
      expect(labelsByWave(section)).toEqual([["02"], ["03"], ["01"]]);
    });

    it("pads ticket numbers as every other ticket reference: 005 and 004 in a set of 100", () => {
      const tickets = Array.from({ length: 100 }, (_, index) => ({
        id: `t${index + 1}`,
        number: index + 1,
        slug: `ticket-${index + 1}`,
        title: `Ticket ${index + 1}`,
        body: "Do it.",
        blockedBy: [],
      }));
      const source: HandoffSource = {
        ...aSource(),
        tickets,
        waves: [tickets.map((ticket) => ticket.number)],
      };
      const numbers = tickets.map((ticket) => ticket.number).filter((number) => number !== 5);

      const markdown = renderHandoffMarkdown(source, false, {
        ...plain,
        waves: [numbers, [5]],
        implicitEdges: [{ ticket: 5, waitsFor: 4, sharedPaths: ["server/export.ts"] }],
      });

      expect(markdown).toContain("\n- Ticket 005 waits for ticket 004: both change `server/export.ts`.\n");
    });

    it("with no overlaps: the Blocked-by waves and today's text, with no added lines", () => {
      const source = aSource();
      const section = wavesOf(
        renderHandoffMarkdown(source, false, { ...plain, waves: source.waves, implicitEdges: [] }),
      );

      expect(section).toBe(
        wavesOf(renderHandoffMarkdown(source)).replace(NOT_CHECKED_LINE, CHECKED_LINE),
      );
      expect(section).not.toContain("waits for");
      expect(labelsByWave(section)).toEqual([["01", "03"], ["02"]]);
    });
  });

  describe("absent or stale grounding", () => {
    it("replaces the whole parallel line with the not-checked line, and keeps the Blocked-by waves", () => {
      const section = wavesOf(renderHandoffMarkdown(aSource(), false, plain));

      expect(section.startsWith(`## Waves\n\n${NOT_CHECKED_LINE}\n\n### Wave 1\n`)).toBe(true);
      expect(section).not.toContain("do not block each other");
      expect(section).not.toContain("at most 3 at a time");
      expect(section).not.toContain("waits for");
      expect(labelsByWave(section)).toEqual([["01", "03"], ["02"]]);
    });

    it("keys off exportFacts.waves, never the grounded wording", () => {
      const groundedWording = wavesOf(renderHandoffMarkdown(aSource(), true, plain));
      expect(groundedWording).toContain(NOT_CHECKED_LINE);
      expect(groundedWording).not.toContain(CHECKED_LINE);

      const source = aSource();
      const checkedWithoutGroundedWording = wavesOf(
        renderHandoffMarkdown(source, false, { ...plain, waves: source.waves, implicitEdges: [] }),
      );
      expect(checkedWithoutGroundedWording).toContain(CHECKED_LINE);
    });
  });
});

describe("gates", () => {
  const GATE_INTRO =
    "A ticket marked (gate) is not code and has no brief: nothing is delegated for it. Ask the owner whether what it waits for is in place, and once it is, mark the gate met. A met gate counts as merged and verified for starting the next wave, and no ticket blocked by a gate starts before the gate is met.";
  const CHECKED_LINE =
    "Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most 3 at a time. Start a wave only once every ticket of the previous wave is merged and verified.";
  const NOT_CHECKED_LINE =
    "Tickets in one wave have no Blocked-by between them. Whether they change the same files was not checked, because the briefs are not grounded against the current code: run them one at a time, or ground the briefs first. Start a wave only once every ticket of the previous wave is merged and verified.";
  const plain = { visibility: "tracked" as const, greenfield: false };

  /** One top-level section, from its heading up to the next one. */
  function section(markdown: string, heading: string): string {
    const start = markdown.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    const end = markdown.indexOf("\n## ", start + 1);
    return markdown.slice(start, end === -1 ? undefined : end).trimEnd();
  }

  /** The same source with every gate turned into a plain build ticket. */
  function withoutGates(source: HandoffSource): HandoffSource {
    return {
      ...source,
      tickets: source.tickets.map(({ kind: _kind, waitsFor: _waitsFor, ...ticket }) => ticket),
    };
  }

  describe("the waves entry", () => {
    it("renders a gate with its wait, its ticket file and a ready-for-human status, on a markdown tracker", () => {
      const markdown = renderHandoffMarkdown(aSourceWithGate());

      expect(markdown).toContain(
        [
          "- **02 Payment account is live** (gate)",
          `  - Wait for: ${PAYMENT_ACCOUNT}`,
          `  - Ticket: \`${BUNDLE_TOKEN}/issues/02-payment-account.md\``,
          "  - Status: ready-for-human",
          "",
        ].join("\n"),
      );
    });

    it("names a gate's own blockers after the word gate", () => {
      const markdown = renderHandoffMarkdown(aSourceWithGate({}, [1]));

      expect(markdown).toContain("- **02 Payment account is live** (gate; blocked by 01)\n");
    });

    it("leaves the Status line out on a beads tracker", () => {
      const waves = section(renderHandoffMarkdown(aSourceWithGate({ trackerKind: "beads" })), "## Waves");

      expect(waves).toContain(
        [
          "- **02 Payment account is live** (gate)",
          `  - Wait for: ${PAYMENT_ACCOUNT}`,
          `  - Ticket: \`${BUNDLE_TOKEN}/issues/02-payment-account.md\``,
          "",
        ].join("\n"),
      );
      expect(waves).not.toContain("Status:");
    });

    it("gives a gate no Brief line", () => {
      const waves = section(renderHandoffMarkdown(aSourceWithGate()), "## Waves");

      expect(waves).not.toContain("briefs/02-");
      expect(waves).toContain(`  - Brief: [\`${BUNDLE_TOKEN}/briefs/01-register-projects.md\`]`);
      expect(waves).toContain(`  - Brief: [\`${BUNDLE_TOKEN}/briefs/03-export-bundle.md\`]`);
    });

    it("lists a gate among a build ticket's blockers as it does any other", () => {
      const markdown = renderHandoffMarkdown(aSourceWithGate());

      expect(markdown).toContain("- **03 Export the bundle** (blocked by 01, 02)\n");
    });
  });

  describe("the waves intro", () => {
    it("follows the not-checked intro with the gate paragraph", () => {
      const waves = section(renderHandoffMarkdown(aSourceWithGate()), "## Waves");

      expect(waves.startsWith(`## Waves\n\n${NOT_CHECKED_LINE}\n\n${GATE_INTRO}\n\n### Wave 1`)).toBe(true);
    });

    it("follows the checked intro with the gate paragraph, before the implicit edges", () => {
      const waves = section(
        renderHandoffMarkdown(aSourceWithGate(), false, {
          ...plain,
          waves: [[1, 2], [3]],
          implicitEdges: [{ ticket: 3, waitsFor: 1, sharedPaths: ["server/export.ts"] }],
        }),
        "## Waves",
      );

      expect(
        waves.startsWith(
          `## Waves\n\n${CHECKED_LINE}\n\n${GATE_INTRO}\n\n- Ticket 03 waits for ticket 01: both change \`server/export.ts\`.`,
        ),
      ).toBe(true);
    });

    it("has no gate paragraph without gates", () => {
      expect(renderHandoffMarkdown(aSource())).not.toContain(GATE_INTRO);
    });
  });

  describe("where things are", () => {
    it.each([
      ["ungrounded", false, "each ready to paste as a delegation prompt once its two slots are filled"],
      ["grounded", true, "grounded and ready to paste as a delegation prompt"],
    ])("says one brief per ticket except gates, %s", (_, groundingCurrent, rest) => {
      expect(renderHandoffMarkdown(aSourceWithGate(), groundingCurrent)).toContain(
        `- Briefs: \`${BUNDLE_TOKEN}/briefs/\`, one per ticket except gates, ${rest}`,
      );
      expect(renderHandoffMarkdown(aSource(), groundingCurrent)).toContain(
        `- Briefs: \`${BUNDLE_TOKEN}/briefs/\`, one per ticket, ${rest}`,
      );
    });
  });

  describe("tracking", () => {
    it("gives a gate a bead too, after the first paragraph", () => {
      const tracking = section(renderHandoffMarkdown(aSourceWithGate({ trackerKind: "beads" })), "## Tracking with beads");

      expect(tracking).toContain(
        [
          "never from memory.",
          "",
          "A gate gets a bead too. Close it once the owner confirms that what it waits for is in place, with a comment saying what was confirmed.",
          "",
          "- `bd ready`: find work that is ready",
        ].join("\n"),
      );
    });

    it("tells a markdown tracker how a gate's Status line is met", () => {
      const tracking = section(renderHandoffMarkdown(aSourceWithGate()), "## Tracking in this file");

      expect(tracking).toContain(
        [
          "once you have verified and merged it.",
          "",
          "A gate's `Status:` line reads `ready-for-human`; set it to `met` once the owner confirms that what it waits for is in place.",
        ].join("\n"),
      );
    });

    it.each(["beads", "markdown"] as const)("says nothing of gates on a %s tracker without them", (trackerKind) => {
      const markdown = renderHandoffMarkdown(aSource({ trackerKind }));

      expect(markdown).not.toContain("A gate gets a bead too.");
      expect(markdown).not.toContain("A gate's `Status:` line");
    });
  });

  describe("build records", () => {
    const ONE_GATE_LINE = "Ticket 02 is a gate and gets no build record: `set-build-record` refuses its number.";
    const TWO_GATES_LINE =
      "Tickets 02 and 04 are gates and get no build record: `set-build-record` refuses their numbers.";
    const THREE_GATES_LINE =
      "Tickets 02, 04 and 06 are gates and get no build record: `set-build-record` refuses their numbers.";
    const PADDED_GATE_LINE = "Ticket 005 is a gate and gets no build record: `set-build-record` refuses its number.";

    function buildTicket(number: number): HandoffSource["tickets"][number] {
      return { id: `t${number}`, number, slug: `ticket-${number}`, title: `Ticket ${number}`, body: "Do it.", blockedBy: [] };
    }

    function gateTicket(number: number): HandoffSource["tickets"][number] {
      return {
        id: `t${number}`,
        number,
        slug: `gate-${number}`,
        title: `Gate ${number}`,
        body: "Wait for it.",
        blockedBy: [],
        kind: "gate" as const,
        waitsFor: PAYMENT_ACCOUNT,
      };
    }

    it("gives the template, then names the gate that gets no record", () => {
      const markdown = renderHandoffMarkdown(aSourceWithGate({ buildRecordLogging: true }));
      const records = section(markdown, "## Build records");

      expect(records).toBe([buildRecordTemplate("session-123"), "", ONE_GATE_LINE].join("\n"));
    });

    it("names two gates in the plural", () => {
      const source: HandoffSource = {
        ...aSource({ buildRecordLogging: true }),
        tickets: [buildTicket(1), gateTicket(2), buildTicket(3), gateTicket(4)],
        waves: [[1], [2], [3], [4]],
      };
      const records = section(renderHandoffMarkdown(source), "## Build records");

      expect(records).toBe([buildRecordTemplate("session-123"), "", TWO_GATES_LINE].join("\n"));
    });

    it("names three gates, joined with a final 'and'", () => {
      const source: HandoffSource = {
        ...aSource({ buildRecordLogging: true }),
        tickets: [buildTicket(1), gateTicket(2), buildTicket(3), gateTicket(4), buildTicket(5), gateTicket(6)],
        waves: [[1], [2], [3], [4], [5], [6]],
      };
      const records = section(renderHandoffMarkdown(source), "## Build records");

      expect(records).toBe([buildRecordTemplate("session-123"), "", THREE_GATES_LINE].join("\n"));
    });

    it("pads a gate's number to three digits once the set holds 100 tickets", () => {
      const tickets = Array.from({ length: 100 }, (_, index) => {
        const number = index + 1;
        return number === 5 ? gateTicket(number) : buildTicket(number);
      });
      const source: HandoffSource = {
        ...aSource({ buildRecordLogging: true }),
        tickets,
        waves: [tickets.map((ticket) => ticket.number)],
      };
      const records = section(renderHandoffMarkdown(source), "## Build records");

      expect(records).toBe([buildRecordTemplate("session-123"), "", PADDED_GATE_LINE].join("\n"));
    });

    it("is left out when every ticket is a gate", () => {
      const source = aSourceWithGate({ buildRecordLogging: true });
      const onlyGates: HandoffSource = {
        ...source,
        tickets: source.tickets.map((ticket) => ({ ...ticket, kind: "gate" as const, waitsFor: PAYMENT_ACCOUNT })),
      };

      expect(renderHandoffMarkdown(onlyGates)).not.toContain("## Build records");
    });

    it.each(["beads", "markdown"] as const)("renders the same template on a %s tracker", (trackerKind) => {
      const markdown = renderHandoffMarkdown(aSource({ trackerKind, buildRecordLogging: true }));

      expect(section(markdown, "## Build records")).toBe(buildRecordTemplate("session-123"));
    });
  });

  describe("the verify command in a repository with no commits yet", () => {
    it("says every other build ticket waits for ticket 01, and never names a gate as not reaching it", () => {
      const verify = section(
        renderHandoffMarkdown(aSourceWithGate(), false, { visibility: "tracked", greenfield: true }),
        "## Verify command",
      );

      expect(verify.endsWith(
        "This repository has no commits yet, so this command does not exist until ticket 01 sets it up. Ticket 01's acceptance includes it passing, and every other build ticket waits for ticket 01.",
      )).toBe(true);
    });
  });

  it.each(["## Delegation lifecycle", "## Reviewing a ticket", "## What to record per ticket"])(
    "leaves %s unchanged",
    (heading) => {
      const source = aSourceWithGate({ buildRecordLogging: true });

      expect(section(renderHandoffMarkdown(source), heading)).toBe(
        section(renderHandoffMarkdown(withoutGates(source)), heading),
      );
    },
  );

  it("renders no brief for a gate", () => {
    const { briefs } = renderHandoff(aSourceWithGate());

    expect(briefs.map((brief) => [brief.ticketNumber, brief.relativePath])).toEqual([
      [1, "briefs/01-register-projects.md"],
      [3, "briefs/03-export-bundle.md"],
    ]);
  });

  describe("the brief's Blocked by line", () => {
    /** 01 and 02 build tickets, 03 and 04 gates, 05 the brief under test. */
    function aSourceBlockedBy(blockedBy: number[]): HandoffSource {
      const base = aSource();
      const ticket = (number: number, kind: "build" | "gate", blockers: number[] = []) => ({
        id: `t${number}`,
        number,
        slug: `ticket-${number}`,
        title: `Ticket ${number}`,
        body: `Do ticket ${number}.`,
        blockedBy: blockers,
        kind,
        waitsFor: kind === "gate" ? PAYMENT_ACCOUNT : null,
      });
      return {
        ...base,
        tickets: [ticket(1, "build"), ticket(2, "build"), ticket(3, "gate"), ticket(4, "gate"), ticket(5, "build", blockedBy)],
        waves: [[1, 2, 3, 4], [5]],
      };
    }

    it.each<[string, number[], string]>([
      ["none", [], "Blocked by: none"],
      ["builds 01, 02", [2, 1], "Blocked by: 01, 02 (merged before this brief was delegated)"],
      ["gate 03", [3], "Blocked by: gate 03 (met before this brief was delegated)"],
      ["gates 03, 04", [4, 3], "Blocked by: gates 03, 04 (met before this brief was delegated)"],
      [
        "builds 01, 02 and gate 03",
        [3, 2, 1],
        "Blocked by: 01, 02 (merged before this brief was delegated); gate 03 (met before this brief was delegated)",
      ],
    ])("%s", (_, blockedBy, line) => {
      const source = aSourceBlockedBy(blockedBy);

      expect(renderBrief(source, source.tickets[4]!).split("\n")).toContain(line);
    });
  });
});

describe("stories no ticket implements", () => {
  const STORY_4 = {
    number: 4,
    text: "As a project owner, I want deleting the working folder to lose nothing anyone still reads, so that cleanup is safe by construction.",
  };
  const STORY_9 = {
    number: 9,
    text: "As an existing project owner whose export folder is already under docs, I want it to become the durable root and the working root to default to `.grill-room`, so that my documentation stays where it is.",
  };
  const SECTION = [
    "## Stories no ticket implements",
    "",
    "No ticket lists these user stories from the spec in its `implements`. Before calling the feature done, add a ticket for each one, or confirm with the owner that it needs none.",
    "",
    `- Story 4: ${STORY_4.text}`,
    `- Story 9: ${STORY_9.text}`,
  ].join("\n");

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", []],
  ] as const)("renders no section when uncoveredStories is %s", (_, uncoveredStories) => {
    const markdown = renderHandoffMarkdown({ ...aSource(), uncoveredStories });
    expect(markdown).toBe(renderHandoffMarkdown(aSource()));
    expect(markdown).not.toContain("## Stories no ticket implements");
  });

  it("renders one bullet per story, right after Waves and before the delegation lifecycle", () => {
    const without = renderHandoffMarkdown(aSource());
    const markdown = renderHandoffMarkdown({ ...aSource(), uncoveredStories: [STORY_4, STORY_9] });

    expect(markdown).toBe(
      without.replace("\n\n## Delegation lifecycle", `\n\n${SECTION}\n\n## Delegation lifecycle`),
    );
    const waves = markdown.indexOf("## Waves");
    const section = markdown.indexOf("## Stories no ticket implements");
    const lifecycle = markdown.indexOf("## Delegation lifecycle");
    expect(waves).toBeGreaterThan(-1);
    expect(waves).toBeLessThan(section);
    expect(section).toBeLessThan(lifecycle);
  });

  it("renders a single story as one bullet", () => {
    const markdown = renderHandoffMarkdown({ ...aSource(), uncoveredStories: [STORY_4] });
    expect(markdown).toContain(
      `confirm with the owner that it needs none.\n\n- Story 4: ${STORY_4.text}\n\n## Delegation lifecycle`,
    );
  });

  it("leaves the briefs and the fingerprint alone", () => {
    const withStories = { ...aSource(), uncoveredStories: [STORY_4] };
    expect(renderHandoff(withStories).briefs).toEqual(renderHandoff(aSource()).briefs);
    expect(handoffFingerprint(withStories)).toBe(handoffFingerprint(aSource()));
  });
});

describe("execution plan", () => {
  const plain = { visibility: "tracked" as const, greenfield: false };
  const WHY =
    "Every ticket in flight draws on the same subscription's rate limit, and a rate-limited failure reads like a failed ticket; each one's reports also need your attention before it can merge.";
  const UNGROUNDED = " Until the briefs are grounded, run one at a time, as Waves says.";

  /** The "Execution plan" section alone, up to the next top-level heading. */
  function executionPlanOf(markdown: string): string {
    const start = markdown.indexOf("## Execution plan");
    expect(start).toBeGreaterThan(-1);
    return markdown.slice(start, markdown.indexOf("\n## ", start + 1));
  }

  /** The line of the section that starts with `prefix`. */
  function lineOf(markdown: string, prefix: string): string {
    const line = executionPlanOf(markdown)
      .split("\n")
      .find((candidate) => candidate.startsWith(prefix));
    expect(line, `a line starting ${prefix}`).toBeDefined();
    return line!;
  }

  /** The source's own waves, as export facts: overlaps checked, none found. */
  function checked(source: HandoffSource) {
    return { ...plain, waves: source.waves, implicitEdges: [] };
  }

  function withTickets(
    tickets: { number: number; blockedBy?: number[]; kind?: "build" | "gate" }[],
    waves: number[][],
  ): HandoffSource {
    return {
      ...aSource(),
      tickets: tickets.map((ticket) => ({
        id: `t${ticket.number}`,
        number: ticket.number,
        slug: `ticket-${ticket.number}`,
        title: `Ticket ${ticket.number}`,
        body: "Build it.",
        blockedBy: ticket.blockedBy ?? [],
        ...(ticket.kind === "gate" ? { kind: "gate" as const, waitsFor: PAYMENT_ACCOUNT } : {}),
      })),
      waves,
    };
  }

  it.each<[string, HandoffSource, ExportFacts | undefined, string]>([
    ["aSource()", aSource(), undefined, "2 build tickets, built one after another: 01 → 02."],
    ["aSourceWithGate()", aSourceWithGate(), undefined, "2 build tickets, built one after another: 01 → 03."],
    [
      "aSourceWithGate({}, [1])",
      aSourceWithGate({}, [1]),
      undefined,
      "2 build tickets, built one after another: 01 → gate 02 → 03.",
    ],
    ["one build ticket", withTickets([{ number: 1 }], [[1]]), undefined, "1 build ticket: 01."],
    [
      "every ticket a gate",
      withTickets([{ number: 1, kind: "gate" }, { number: 2, kind: "gate", blockedBy: [1] }], [[1], [2]]),
      undefined,
      "no build tickets.",
    ],
    [
      "an ordering the overlap separation added",
      withTickets([{ number: 1 }, { number: 2 }, { number: 3 }], [[1, 2, 3]]),
      { ...plain, waves: [[1, 2], [3]], implicitEdges: [{ ticket: 3, waitsFor: 1, sharedPaths: ["a.ts"] }] },
      "2 build tickets, built one after another: 01 → 03.",
    ],
  ])("the longest chain line: %s", (_, source, facts, text) => {
    expect(lineOf(renderHandoffMarkdown(source, false, facts), "- Longest chain: ")).toBe(
      `- Longest chain: ${text}`,
    );
  });

  it.each<[string, HandoffSource, string]>([
    ["aSource()", aSource(), "- Wave widths, in build tickets: 2, 1 (wave 1 first)."],
    ["aSourceWithGate()", aSourceWithGate(), "- Wave widths, in build tickets: 1, 1 (wave 1 first)."],
    [
      "aSourceWithGate({}, [1])",
      aSourceWithGate({}, [1]),
      "- Wave widths, in build tickets: 1, gate only, 1 (wave 1 first).",
    ],
  ])("the wave widths line: %s", (_, source, line) => {
    expect(lineOf(renderHandoffMarkdown(source), "- Wave widths")).toBe(line);
  });

  it.each<[string, number | undefined, boolean, string]>([
    ["absent, checked", undefined, true, `- Run at most 3 tickets at a time, even when a wave is wider. ${WHY}`],
    ["3, checked", 3, true, `- Run at most 3 tickets at a time, even when a wave is wider. ${WHY}`],
    [
      "absent, not checked",
      undefined,
      false,
      `- Run at most 3 tickets at a time, even when a wave is wider. ${WHY}${UNGROUNDED}`,
    ],
    [
      "3, not checked",
      3,
      false,
      `- Run at most 3 tickets at a time, even when a wave is wider. ${WHY}${UNGROUNDED}`,
    ],
    ["2, checked", 2, true, `- Run at most 2 tickets at a time, even when a wave is wider. ${WHY}`],
    ["1, checked", 1, true, `- Run one ticket at a time. ${WHY}`],
    ["1, not checked", 1, false, `- Run one ticket at a time. ${WHY}`],
  ])("the cap line: %s", (_, cap, isChecked, line) => {
    const source = aSource(cap === undefined ? {} : { maxTicketsInFlight: cap });
    const markdown = renderHandoffMarkdown(source, false, isChecked ? checked(source) : plain);
    const plan = executionPlanOf(markdown);

    expect(plan.trimEnd().split("\n").pop()).toBe(line);
    expect(plan).toBe(
      [
        "## Execution plan",
        "",
        "- Longest chain: 2 build tickets, built one after another: 01 → 02.",
        "- Wave widths, in build tickets: 2, 1 (wave 1 first).",
        line,
        "",
      ].join("\n"),
    );
  });

  it.each<[string, number | undefined, string]>([
    ["absent", undefined, "start with at most 3 at a time"],
    ["3", 3, "start with at most 3 at a time"],
    ["5", 5, "start with at most 5 at a time"],
    ["1", 1, "start with one at a time"],
  ])("the checked waves intro follows the project's cap: %s", (_, cap, phrase) => {
    const source = aSource(cap === undefined ? {} : { maxTicketsInFlight: cap });
    const markdown = renderHandoffMarkdown(source, false, checked(source));

    expect(markdown).toContain(
      `## Waves\n\nTickets in one wave do not block each other and may run in parallel, each in its own worktree; ${phrase}. Start a wave only once every ticket of the previous wave is merged and verified.`,
    );
  });

  it("sits right before the waves", () => {
    const markdown = renderHandoffMarkdown(aSource());
    const plan = executionPlanOf(markdown);

    expect(markdown).toContain(`${plan}\n## Waves\n`);
    expect(markdown.indexOf("## Before delegating")).toBeLessThan(markdown.indexOf("## Execution plan"));
    expect(markdown.split("## Execution plan")).toHaveLength(2);
  });
});
