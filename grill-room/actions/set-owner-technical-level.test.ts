import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { BETTER_AUTH_MIGRATIONS } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOwnerId } from "../server/current-owner.js";
import { resetInterviewer, scriptInterviewer } from "../server/interviewer/index.js";
import { getTechnicalLevel } from "../server/owner-profiles.js";
import { LOCAL_OWNER_ID } from "../shared/session-constants.js";
import { applyMigrations, getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getOwnerProfile from "./get-owner-profile.js";
import getSession from "./get-session.js";
import requestNextRound from "./request-next-round.js";
import setOwnerTechnicalLevel from "./set-owner-technical-level.js";

useTestDatabase();

let authTablesBuilt = false;
beforeEach(async () => {
  if (!authTablesBuilt) {
    await applyMigrations(BETTER_AUTH_MIGRATIONS, "_better_auth_migrations");
    authTablesBuilt = true;
  }
  await getDb().delete(schema.ownerProfiles);
  await getDb().delete(schema.migrationInheritance);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetInterviewer();
});

const ANA = { id: "u-ana", email: "ana@example.test" };
const BEN = { id: "u-ben", email: "ben@example.test" };

function loginOn(): void {
  vi.stubEnv("AUTH_DISABLED", "");
  vi.stubEnv("AGENT_USER_EMAIL", "");
}

async function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  return await runWithRequestContext({ userEmail: email }, fn);
}

async function insertUsers(): Promise<void> {
  const now = new Date().toISOString();
  for (const user of [ANA, BEN]) {
    await getDbExec().execute({
      sql: 'INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [user.id, user.email, user.id, false, now, now],
    });
  }
}

async function insertSession(ownerId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await getDb().insert(schema.sessions).values({
    id,
    title: `Session ${id.slice(0, 4)}`,
    idea: "An idea",
    ownerId,
    state: "interviewing",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("set-owner-technical-level", () => {
  it("L1: the level belongs to the owner, so every session reads it", async () => {
    await createSession.run({ title: "First", idea: "An idea" });
    const other = await createSession.run({ title: "Second", idea: "Another idea" });

    const result = await setOwnerTechnicalLevel.run({ technicalLevel: "builder" });

    expect(result).toEqual({ ownerId: LOCAL_OWNER_ID, technicalLevel: "builder" });
    expect((await getSession.run({ id: other.id })).technicalLevel).toBe("builder");

    const interviewer = scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
    ]);
    await requestNextRound.run({ sessionId: other.id });
    const request = interviewer.requests[0] as { context: { technicalLevel?: string } };
    expect(request.context.technicalLevel).toBe("builder");
  });

  it("L2: with login on, the signed-in owner's level is written, not the local owner's", async () => {
    loginOn();
    await insertUsers();
    const benSession = await insertSession(BEN.id);
    await as(BEN.email, async () => resolveOwnerId());

    const result = await as(ANA.email, async () =>
      setOwnerTechnicalLevel.run({ technicalLevel: "builder" }),
    );
    const anaProfile = await as(ANA.email, async () => getOwnerProfile.run({}));
    const benView = await as(BEN.email, async () => getSession.run({ id: benSession }));

    expect(result).toEqual({ ownerId: ANA.id, technicalLevel: "builder" });
    expect(anaProfile).toEqual({ ownerId: ANA.id, technicalLevel: "builder" });
    expect(benView.technicalLevel).toBeNull();
  });

  it("L3: a clear or an unknown level is refused before anything is written", async () => {
    await expect(
      // @ts-expect-error a level is changed, never cleared
      setOwnerTechnicalLevel.run({ technicalLevel: null }),
    ).rejects.toThrow();
    await expect(
      // @ts-expect-error not a technical level
      setOwnerTechnicalLevel.run({ technicalLevel: "expert" }),
    ).rejects.toThrow();

    expect(await getTechnicalLevel(LOCAL_OWNER_ID)).toBeNull();
  });
});
