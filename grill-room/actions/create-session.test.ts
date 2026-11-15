import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import setDefaultModel from "./set-default-model.js";

describe("create-session", () => {
  useTestDatabase();

  it("creates a session with the fields the user supplied", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
      model: "opus",
      answeringMode: "one-at-a-time",
    });

    expect(session).toMatchObject({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
      model: "opus",
      answeringMode: "one-at-a-time",
      state: "interviewing",
      conversationId: null,
      exportTargetFolder: null,
    });
    expect(session.id).toBeTruthy();
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBeTruthy();
  });

  it("defaults the model to the global default model when omitted", async () => {
    await setDefaultModel.run({ model: "sonnet" });

    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
    });

    expect(session.model).toBe("sonnet");
  });

  it("defaults the model to fable when no global default was ever set", async () => {
    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
    });

    expect(session.model).toBe("fable");
  });

  it("defaults answering mode to whole-round when omitted", async () => {
    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
    });

    expect(session.answeringMode).toBe("whole-round");
  });

  it("C1 stores the chosen depth", async () => {
    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
      depth: "full-spec",
    });

    expect(session.depth).toBe("full-spec");
  });

  it("C2 defaults the depth", async () => {
    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
    });

    expect(session.depth).toBe("first-working-version");
  });

  it("C3 rejects an unknown depth", async () => {
    await expect(
      createSession.run({
        title: "Micro SaaS",
        idea: "A tiny paid tool",
        // @ts-expect-error not a depth
        depth: "deep",
      }),
    ).rejects.toThrow();
    expect(await getDb().select().from(schema.sessions)).toHaveLength(0);

    const session = await createSession.run({
      title: "Micro SaaS",
      idea: "A tiny paid tool",
      depth: "full-spec",
    });
    expect(session.depth).toBe("full-spec");
    expect(await getDb().select().from(schema.sessions)).toHaveLength(1);
  });
});
