import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { unproducedInputsTurns } from "../server/interviewer/fake.js";
import { resetInterviewer, scriptInterviewer } from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import breakIntoTickets from "./break-into-tickets.js";
import createSession from "./create-session.js";
import listTickets from "./list-tickets.js";
import synthesizeSpec from "./synthesize-spec.js";

const SPEC_MARKDOWN = [
  "## Problem Statement",
  "",
  "A settled idea.",
  "",
  "## Solution",
  "",
  "A workspace.",
  "",
  "## User Stories",
  "",
  "1. As a user, I want a workspace, so that I can see what I am deciding.",
  "",
  "## Implementation Decisions",
  "",
  "- The shape is a workspace.",
  "",
  "## Testing Decisions",
  "",
  "- Behaviour is tested at the action boundary.",
  "",
  "## Out of Scope",
  "",
  "- Anything not decided above.",
  "",
  "## Further Notes",
  "",
  "- None.",
].join("\n");

async function aSessionWithTheUnproducedInputsBreakdown(): Promise<string> {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  await getDb()
    .update(schema.sessions)
    .set({ state: "confirmed" })
    .where(eq(schema.sessions.id, session.id));
  scriptInterviewer([
    { kind: "synthesize-spec", result: { markdown: SPEC_MARKDOWN } },
    ...unproducedInputsTurns().slice(-2),
  ]);
  await synthesizeSpec.run({ sessionId: session.id });
  await breakIntoTickets.run({ sessionId: session.id });
  return session.id;
}

describe("unresolvedInputs", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("reports the gap the unproduced-inputs scenario stores", async () => {
    const sessionId = await aSessionWithTheUnproducedInputsBreakdown();

    const listed = await listTickets.run({ sessionId });

    expect(listed.unresolvedInputs).toEqual([
      { ticket: 2, item: "spans writer", from: null, reason: "no-source" },
    ]);
  });

  it("is null once every row's consumes column is NULL", async () => {
    const sessionId = await aSessionWithTheUnproducedInputsBreakdown();
    await getDb()
      .update(schema.tickets)
      .set({ consumesJson: null })
      .where(eq(schema.tickets.sessionId, sessionId));

    const listed = await listTickets.run({ sessionId });

    expect(listed.unresolvedInputs).toBeNull();
  });
});
