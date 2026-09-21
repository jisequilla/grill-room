import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import getTree from "./get-tree.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

describe("add-decision", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(
      addDecision.run({ sessionId: "missing", title: "Anything", body: "" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("adds a decision introduced by the user, awaiting placement", async () => {
    const session = await aSession();

    const added = await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
      body: "Came to me in the shower.",
    });

    expect(added).toMatchObject({
      questionTitle: "Should we support offline mode?",
      questionBody: "Came to me in the shower.",
      introducedBy: "user",
      state: "unplaced",
      dependsOn: [],
      answer: null,
    });
    expect(added.key).toEqual(expect.any(String));
    expect(added.awaitingPlacementSince).toEqual(
      expect.stringMatching(/^\d{4}-/),
    );

    const tree = await getTree.run({ sessionId: session.id });
    expect(tree.decisions).toMatchObject([
      { key: added.key, state: "unplaced", introducedBy: "user" },
    ]);
  });

  it("gives every added decision a distinct key, even for the same title", async () => {
    const session = await aSession();

    const first = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
      body: "",
    });
    const second = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
      body: "",
    });

    expect(first.key).not.toEqual(second.key);
  });

  it("defaults the body to empty", async () => {
    const session = await aSession();

    const added = await addDecision.run({
      sessionId: session.id,
      title: "Add analytics?",
    });

    expect(added.questionBody).toEqual("");
  });
});
