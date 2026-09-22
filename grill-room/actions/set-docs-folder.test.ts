import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import requestNextRound from "./request-next-round.js";
import setDocsFolder from "./set-docs-folder.js";

/** The directory holding this app's own source, which a docs folder must not contain. */
const APP_DIRECTORY = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "grill-room-docs-"));
  writeFileSync(path.join(scratch, "README.md"), "# A project\n");
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

describe("set-docs-folder", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(
      setDocsFolder.run({ sessionId: "missing", folder: scratch }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("stores an existing directory, normalised", async () => {
    const session = await aSession();

    const updated = await setDocsFolder.run({
      sessionId: session.id,
      folder: path.join(scratch, "nested", ".."),
    });

    expect(updated.docsFolder).toBe(scratch);
    expect(await getSession.run({ id: session.id })).toMatchObject({
      docsFolder: scratch,
    });
  });

  it("expands a leading ~ before judging the path", async () => {
    const session = await aSession();

    // The home directory itself is refused, which proves the `~` was expanded:
    // an unexpanded `~` would have been refused as relative instead.
    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: "~" }),
    ).rejects.toMatchObject({ errorCode: "folder-is-home" });
  });

  it("refuses a relative path", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: "relative/path" }),
    ).rejects.toMatchObject({ errorCode: "folder-not-absolute" });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      docsFolder: null,
    });
  });

  it("refuses a folder that does not exist", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({
        sessionId: session.id,
        folder: path.join(scratch, "not-here"),
      }),
    ).rejects.toMatchObject({ errorCode: "folder-not-found" });
  });

  it("refuses a file that is not a directory", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({
        sessionId: session.id,
        folder: path.join(scratch, "README.md"),
      }),
    ).rejects.toMatchObject({ errorCode: "folder-not-directory" });
  });

  it("refuses the filesystem root", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: path.parse(scratch).root }),
    ).rejects.toMatchObject({ errorCode: "folder-is-root" });
  });

  it("refuses the home directory itself", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: os.homedir() }),
    ).rejects.toMatchObject({ errorCode: "folder-is-home" });
  });

  it("refuses a folder containing the app, which would expose its own secrets", async () => {
    const session = await aSession();

    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: APP_DIRECTORY }),
    ).rejects.toMatchObject({ errorCode: "folder-contains-app" });

    await expect(
      setDocsFolder.run({
        sessionId: session.id,
        folder: path.dirname(APP_DIRECTORY),
      }),
    ).rejects.toMatchObject({ errorCode: "folder-contains-app" });
  });

  it("clears the folder when given null", async () => {
    const session = await aSession();
    await setDocsFolder.run({ sessionId: session.id, folder: scratch });

    const cleared = await setDocsFolder.run({
      sessionId: session.id,
      folder: null,
    });

    expect(cleared.docsFolder).toBeNull();
    expect(await getSession.run({ id: session.id })).toMatchObject({
      docsFolder: null,
    });
  });

  it("leaves the stored folder alone when a new one is refused", async () => {
    const session = await aSession();
    await setDocsFolder.run({ sessionId: session.id, folder: scratch });

    await expect(
      setDocsFolder.run({ sessionId: session.id, folder: os.homedir() }),
    ).rejects.toMatchObject({ errorCode: "folder-is-home" });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      docsFolder: scratch,
    });
  });
});

describe("create-session with a docs folder", () => {
  useTestDatabase();

  it("accepts and normalises one given at creation", async () => {
    const session = await createSession.run({
      title: "Observability",
      idea: "Grill the system I already built",
      docsFolder: scratch,
    });

    expect(session.docsFolder).toBe(scratch);
  });

  it("defaults to no folder", async () => {
    const session = await createSession.run({
      title: "Observability",
      idea: "Grill the system I already built",
    });

    expect(session.docsFolder).toBeNull();
  });

  it("refuses the same folders the action refuses, and creates nothing", async () => {
    await expect(
      createSession.run({
        title: "Observability",
        idea: "Grill the system I already built",
        docsFolder: os.homedir(),
      }),
    ).rejects.toMatchObject({ errorCode: "folder-is-home" });
  });
});

describe("what the interviewer is told about the folder", () => {
  useTestDatabase();
  afterEach(() => resetInterviewer());

  const emptyRound = {
    kind: "propose-round" as const,
    result: {
      proposedDecisions: [],
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };

  it("carries the session's folder into the turn's context", async () => {
    const interviewer = scriptInterviewer([emptyRound]);
    const session = await createSession.run({
      title: "Observability",
      idea: "Grill the system I already built",
      docsFolder: scratch,
    });

    await requestNextRound.run({ sessionId: session.id });

    expect(interviewer.requests[0].context).toMatchObject({
      docsFolder: scratch,
    });
  });

  it("carries null when the session has no folder", async () => {
    const interviewer = scriptInterviewer([emptyRound]);
    const session = await aSession();

    await requestNextRound.run({ sessionId: session.id });

    expect(interviewer.requests[0].context.docsFolder).toBeNull();
  });
});
