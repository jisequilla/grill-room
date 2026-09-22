import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import setExportTarget from "./set-export-target.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

describe("set-export-target", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(
      setExportTarget.run({ sessionId: "missing", folder: "/tmp/somewhere" }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("rejects a relative path", async () => {
    const session = await aSession();

    await expect(
      setExportTarget.run({ sessionId: session.id, folder: "relative/path" }),
    ).rejects.toMatchObject({ errorCode: "folder-not-absolute" });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      exportTargetFolder: null,
    });
  });

  it("expands a leading ~ to the home directory", async () => {
    const session = await aSession();

    const updated = await setExportTarget.run({
      sessionId: session.id,
      folder: "~/exports/grill-room",
    });

    expect(updated.exportTargetFolder).toBe(
      path.join(os.homedir(), "exports/grill-room"),
    );
  });

  it("expands a bare ~ to the home directory", async () => {
    const session = await aSession();

    const updated = await setExportTarget.run({
      sessionId: session.id,
      folder: "~",
    });

    expect(updated.exportTargetFolder).toBe(os.homedir());
  });

  it("normalizes the stored path with path.resolve", async () => {
    const session = await aSession();

    const updated = await setExportTarget.run({
      sessionId: session.id,
      folder: "/tmp/one/../two//three",
    });

    expect(updated.exportTargetFolder).toBe(path.resolve("/tmp/two/three"));
  });

  it("does not require the folder to exist", async () => {
    const session = await aSession();

    const updated = await setExportTarget.run({
      sessionId: session.id,
      folder: "/definitely/does/not/exist/anywhere",
    });

    expect(updated.exportTargetFolder).toBe("/definitely/does/not/exist/anywhere");
    expect(await getSession.run({ id: session.id })).toMatchObject({
      exportTargetFolder: "/definitely/does/not/exist/anywhere",
    });
  });
});
