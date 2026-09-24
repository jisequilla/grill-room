import { describe, expect, it } from "vitest";

import { completeTurn, createTurn } from "../server/turn-records.js";
import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getActiveTurn from "./get-active-turn.js";

async function aSession(): Promise<string> {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  return session.id;
}

describe("get-active-turn", () => {
  useTestDatabase();

  it("returns null for a session with no turn record at all", async () => {
    const sessionId = await aSession();
    expect(await getActiveTurn.run({ sessionId })).toBeNull();
  });

  it("returns the turn still running, whichever kind it is", async () => {
    const sessionId = await aSession();
    const { turnId } = await createTurn({
      sessionId,
      turnKind: "assess-readiness",
      model: "fable",
    });

    const active = await getActiveTurn.run({ sessionId });
    expect(active?.id).toBe(turnId);
    expect(active?.turnKind).toBe("assess-readiness");
    expect(active?.completedAt).toBeNull();
  });

  it("falls back to the most recently completed turn once nothing is running", async () => {
    const sessionId = await aSession();
    const first = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "sonnet",
    });
    await completeTurn({ turnId: first.turnId, outcome: "succeeded" });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await createTurn({
      sessionId,
      turnKind: "review-stale",
      model: "sonnet",
    });
    await completeTurn({ turnId: second.turnId, outcome: "rate-limited" });

    const active = await getActiveTurn.run({ sessionId });
    expect(active?.id).toBe(second.turnId);
    expect(active?.turnKind).toBe("review-stale");
    expect(active?.outcome).toBe("rate-limited");
  });

  it("prefers a still-running turn over an older completed one", async () => {
    const sessionId = await aSession();
    const completed = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "sonnet",
    });
    await completeTurn({ turnId: completed.turnId, outcome: "succeeded" });

    const running = await createTurn({
      sessionId,
      turnKind: "find-superseded",
      model: "sonnet",
    });

    const active = await getActiveTurn.run({ sessionId });
    expect(active?.id).toBe(running.turnId);
    expect(active?.completedAt).toBeNull();
  });

  it("never mixes turns across sessions", async () => {
    const sessionId = await aSession();
    const otherSessionId = await aSession();
    await createTurn({
      sessionId: otherSessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    expect(await getActiveTurn.run({ sessionId })).toBeNull();
  });
});
