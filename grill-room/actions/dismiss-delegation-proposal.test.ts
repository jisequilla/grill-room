import { describe, expect, it } from "vitest";

import { storeBriefGrounding } from "../server/brief-grounding.js";
import {
  parseDelegationProposals,
  parseDelegationValues,
  serializeDelegationProposals,
  serializeDelegationValues,
  type DelegationProposals,
  type DelegationValues,
} from "../server/delegation-values.js";
import type { HandoffScoutResult } from "../server/interviewer/index.js";
import { aHandoffScoutResult } from "../server/interviewer/test-fixtures.js";
import { setDelegationDecision } from "../server/projects.js";
import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import createSession from "./create-session.js";
import dismissDelegationProposal from "./dismiss-delegation-proposal.js";
import getProject from "./get-project.js";
import registerProject from "./register-project.js";

const repos = useTempGitRepos();

const PRUNE = { command: "just prune", citation: "CLAUDE.md:4" };
const CAP = { value: 2, citation: "CLAUDE.md:7" };
const RULE = { citation: "AGENTS.md:3" };

describe("dismiss-delegation-proposal", () => {
  useTestDatabase();

  /** A session on a project, grounded (stale, which counts) with the given proposals. */
  async function aGroundedSession(proposals: Partial<HandoffScoutResult["delegationProposals"]> = {}) {
    const project = await registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      projectId: project.id,
    });
    const base = aHandoffScoutResult();
    await storeBriefGrounding({
      sessionId: session.id,
      result: { ...base, delegationProposals: { ...base.delegationProposals, ...proposals } },
      commitRead: null,
      handoffFingerprint: "not-the-handoff",
      model: "sonnet",
      turnId: null,
      ranAt: new Date().toISOString(),
    });
    return { project, session };
  }

  async function seed(projectId: string, values: DelegationValues, dismissed: DelegationProposals) {
    await setDelegationDecision(projectId, {
      delegationValuesJson: serializeDelegationValues(values),
      delegationProposalsJson: serializeDelegationProposals(dismissed),
    });
  }

  it("records the exact proposal as dismissed and leaves the values and the cap unchanged", async () => {
    const { project, session } = await aGroundedSession({ maxTicketsInFlight: CAP, reviewRule: RULE });
    await seed(project.id, { preflight: { citation: "AGENTS.md:1" } }, {});
    const before = await getProject.run({ id: project.id });

    const result = await dismissDelegationProposal.run({ sessionId: session.id, slot: "maxTicketsInFlight" });

    const after = await getProject.run({ id: project.id });
    expect(parseDelegationProposals(after.delegationProposalsJson)).toEqual({ maxTicketsInFlight: CAP });
    expect(after.delegationValuesJson).toBe(before.delegationValuesJson);
    expect(parseDelegationValues(after.delegationValuesJson)).toEqual({ preflight: { citation: "AGENTS.md:1" } });
    expect(after.maxTicketsInFlight).toBe(before.maxTicketsInFlight);
    expect(result.pendingProposals).toEqual([{ slot: "reviewRule", proposal: RULE, confirmed: null }]);
  });

  it("dismisses each of the other slots the same way", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE, reviewRule: RULE });

    await dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" });
    const result = await dismissDelegationProposal.run({ sessionId: session.id, slot: "reviewRule" });

    const after = await getProject.run({ id: project.id });
    expect(parseDelegationProposals(after.delegationProposalsJson)).toEqual({ pruneCommand: PRUNE, reviewRule: RULE });
    expect(after.delegationValuesJson).toBeNull();
    expect(result.pendingProposals).toEqual([]);
  });

  it("replaces an earlier dismissal of the same slot and keeps the other slots' dismissals", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });
    await seed(
      project.id,
      {},
      { pruneCommand: { command: "just prune", citation: "CLAUDE.md:5" }, reviewRule: { citation: "AGENTS.md:9" } },
    );

    await dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" });

    const after = await getProject.run({ id: project.id });
    expect(parseDelegationProposals(after.delegationProposalsJson)).toEqual({
      pruneCommand: PRUNE,
      reviewRule: { citation: "AGENTS.md:9" },
    });
  });

  it("refuses a session with no grounding, writing nothing", async () => {
    const project = await registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({ title: "T", idea: "An idea.", projectId: project.id });

    await expect(
      dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toMatchObject(project);
  });

  it("refuses a slot the grounding left null, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });

    await expect(
      dismissDelegationProposal.run({ sessionId: session.id, slot: "preflight" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toMatchObject(project);
  });

  it("refuses a proposal already dismissed, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });
    await seed(project.id, {}, { pruneCommand: PRUNE });
    const before = await getProject.run({ id: project.id });

    await expect(
      dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(before);
  });

  it("refuses a proposal equal to the confirmed value, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });
    await seed(project.id, { pruneCommand: { command: "just prune", citation: "CLAUDE.md:9" } }, {});
    const before = await getProject.run({ id: project.id });

    await expect(
      dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(before);
  });

  it("refuses an unknown session with 404 and a session with no project with no-project", async () => {
    await expect(
      dismissDelegationProposal.run({ sessionId: "missing", slot: "pruneCommand" }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const session = await createSession.run({ title: "T", idea: "An idea." });
    await expect(
      dismissDelegationProposal.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-project", statusCode: 409 });
  });
});
