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
import confirmDelegationValue from "./confirm-delegation-value.js";
import createSession from "./create-session.js";
import getProject from "./get-project.js";
import registerProject from "./register-project.js";

const repos = useTempGitRepos();

const PRUNE = { command: "just prune", citation: "CLAUDE.md:4" };
const CAP = { value: 2, citation: "CLAUDE.md:7" };
const RULE = { citation: "AGENTS.md:3" };
const PREFLIGHT = { citation: ".claude/rules/preflight.md:1" };

describe("confirm-delegation-value", () => {
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

  async function stored(projectId: string) {
    const project = await getProject.run({ id: projectId });
    return {
      project,
      values: parseDelegationValues(project.delegationValuesJson),
      dismissed: parseDelegationProposals(project.delegationProposalsJson),
    };
  }

  it("confirming the cap sets the project's cap and records its citation", async () => {
    const { project, session } = await aGroundedSession({ maxTicketsInFlight: CAP });

    const result = await confirmDelegationValue.run({ sessionId: session.id, slot: "maxTicketsInFlight" });

    const after = await stored(project.id);
    expect(after.project.maxTicketsInFlight).toBe(2);
    expect(after.values).toEqual({ maxTicketsInFlight: { citation: "CLAUDE.md:7" } });
    expect(result.project.maxTicketsInFlight).toBe(2);
    expect(result.pendingProposals).toEqual([]);
  });

  it("confirming the prune command stores its command and citation", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });

    await confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" });

    const after = await stored(project.id);
    expect(after.values).toEqual({ pruneCommand: PRUNE });
    expect(after.project.maxTicketsInFlight).toBe(project.maxTicketsInFlight);
  });

  it("confirming the review rule stores its citation", async () => {
    const { project, session } = await aGroundedSession({ reviewRule: RULE });

    await confirmDelegationValue.run({ sessionId: session.id, slot: "reviewRule" });

    expect((await stored(project.id)).values).toEqual({ reviewRule: RULE });
  });

  it("confirming the pre-flight procedure stores its citation", async () => {
    const { project, session } = await aGroundedSession({ preflight: PREFLIGHT });

    await confirmDelegationValue.run({ sessionId: session.id, slot: "preflight" });

    expect((await stored(project.id)).values).toEqual({ preflight: PREFLIGHT });
  });

  it("removes that slot's dismissal, keeps the other slots' values and dismissals, and returns what is still pending", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE, reviewRule: RULE });
    await seed(
      project.id,
      { preflight: PREFLIGHT },
      {
        pruneCommand: { command: "just prune", citation: "CLAUDE.md:5" },
        reviewRule: { citation: "AGENTS.md:9" },
      },
    );

    const result = await confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" });

    const after = await stored(project.id);
    expect(after.values).toEqual({ preflight: PREFLIGHT, pruneCommand: PRUNE });
    expect(after.dismissed).toEqual({ reviewRule: { citation: "AGENTS.md:9" } });
    expect(result.pendingProposals).toEqual([{ slot: "reviewRule", proposal: RULE, confirmed: null }]);
  });

  it("refuses a session with no grounding, writing nothing", async () => {
    const project = await registerProject.run({
      root: repos.create(),
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await createSession.run({ title: "T", idea: "An idea.", projectId: project.id });

    await expect(
      confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(project);
  });

  it("refuses a slot the grounding left null, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });

    await expect(
      confirmDelegationValue.run({ sessionId: session.id, slot: "reviewRule" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(project);
  });

  it("refuses a proposal the owner dismissed, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });
    await seed(project.id, {}, { pruneCommand: PRUNE });
    const before = await getProject.run({ id: project.id });

    await expect(
      confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(before);
  });

  it("refuses a proposal equal to the confirmed value, writing nothing", async () => {
    const { project, session } = await aGroundedSession({ pruneCommand: PRUNE });
    await seed(project.id, { pruneCommand: { command: "just prune", citation: "CLAUDE.md:9" } }, {});
    const before = await getProject.run({ id: project.id });

    await expect(
      confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-pending-proposal", statusCode: 409 });
    expect(await getProject.run({ id: project.id })).toEqual(before);
  });

  it("refuses an unknown session with 404 and a session with no project with no-project", async () => {
    await expect(
      confirmDelegationValue.run({ sessionId: "missing", slot: "pruneCommand" }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const session = await createSession.run({ title: "T", idea: "An idea." });
    await expect(
      confirmDelegationValue.run({ sessionId: session.id, slot: "pruneCommand" }),
    ).rejects.toMatchObject({ errorCode: "no-project", statusCode: 409 });
  });
});
