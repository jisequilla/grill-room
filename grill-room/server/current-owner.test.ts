import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import { BETTER_AUTH_MIGRATIONS } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createSession from "../actions/create-session.js";
import getSession from "../actions/get-session.js";
import listSessions from "../actions/list-sessions.js";
import { LOCAL_OWNER_ID, type TechnicalLevel } from "../shared/session-constants.js";
import { applyMigrations, getDb, schema, useTestDatabase } from "../test/db.js";
import {
  claimInheritance,
  OwnerNotResolvedError,
  resolveOwnerId,
} from "./current-owner.js";
import { getTechnicalLevel } from "./owner-profiles.js";

useTestDatabase();

let authTablesBuilt = false;
beforeEach(async () => {
  if (authTablesBuilt) return;
  await applyMigrations(BETTER_AUTH_MIGRATIONS, "_better_auth_migrations");
  authTablesBuilt = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ANA = { id: "u-ana", email: "ana@example.test" };
const BEN = { id: "u-ben", email: "ben@example.test" };

function loginOn(): void {
  vi.stubEnv("AUTH_DISABLED", "");
  vi.stubEnv("AGENT_USER_EMAIL", "");
}

async function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: email }, fn);
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

async function setMarker(inheritorUserId: string | null): Promise<void> {
  await getDb()
    .insert(schema.migrationInheritance)
    .values({ id: "singleton", inheritorUserId })
    .onConflictDoUpdate({
      target: schema.migrationInheritance.id,
      set: { inheritorUserId },
    });
}

async function marker(): Promise<string | null | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.migrationInheritance)
    .where(eq(schema.migrationInheritance.id, "singleton"));
  return row === undefined ? undefined : row.inheritorUserId;
}

async function insertProfile(
  userId: string,
  technicalLevel: TechnicalLevel | null,
): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.ownerProfiles)
    .values({ userId, technicalLevel, createdAt: now, updatedAt: now });
}

async function profileExists(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, userId));
  return rows.length > 0;
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

async function ownersOf(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const [row] = await getDb()
      .select({ ownerId: schema.sessions.ownerId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id));
    out.push(row!.ownerId);
  }
  return out;
}

async function sessionCount(ownerId: string): Promise<number> {
  const rows = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.ownerId, ownerId));
  return rows.length;
}

describe("resolveOwnerId with login off", () => {
  beforeEach(async () => {
    await insertUsers();
    await setMarker(null);
  });

  it("R1: returns local-owner, creates its profile and leaves the marker alone", async () => {
    vi.stubEnv("AUTH_DISABLED", "true");
    expect(await resolveOwnerId()).toBe(LOCAL_OWNER_ID);
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(true);
    expect(await marker()).toBeNull();
  });

  it("R1c: runs no hand-off, even with an inheritor named", async () => {
    vi.stubEnv("AUTH_DISABLED", "true");
    await setMarker(ANA.id);
    const ids = [await insertSession(LOCAL_OWNER_ID), await insertSession(LOCAL_OWNER_ID)];
    await insertProfile(LOCAL_OWNER_ID, "builder");

    expect(await resolveOwnerId()).toBe(LOCAL_OWNER_ID);
    expect(await ownersOf(ids)).toEqual([LOCAL_OWNER_ID, LOCAL_OWNER_ID]);
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(true);
    expect(await getTechnicalLevel(LOCAL_OWNER_ID)).toBe("builder");
    expect(await marker()).toBe(ANA.id);
  });

  it("R1b: trims and lower-cases AUTH_DISABLED, and prefers login off over a signed-in email", async () => {
    vi.stubEnv("AUTH_DISABLED", " TRUE ");
    expect(await as(ANA.email, resolveOwnerId)).toBe(LOCAL_OWNER_ID);
    expect(await marker()).toBeNull();
  });

  it("R11: treats AUTH_DISABLED false as login on", async () => {
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("AGENT_USER_EMAIL", "");
    await expect(resolveOwnerId()).rejects.toBeInstanceOf(OwnerNotResolvedError);
  });
});

describe("resolveOwnerId with login on", () => {
  beforeEach(async () => {
    loginOn();
    await insertUsers();
    await setMarker(null);
  });

  async function arrangeR2(): Promise<string[]> {
    const ids = [
      await insertSession(LOCAL_OWNER_ID),
      await insertSession(LOCAL_OWNER_ID),
      await insertSession(LOCAL_OWNER_ID),
    ];
    await insertProfile(LOCAL_OWNER_ID, "builder");
    return ids;
  }

  it("R2: the first user inherits the sessions, the level and the marker, and the local row goes", async () => {
    const ids = await arrangeR2();

    expect(await as(ANA.email, resolveOwnerId)).toBe(ANA.id);

    expect(await ownersOf(ids)).toEqual([ANA.id, ANA.id, ANA.id]);
    expect(await getTechnicalLevel(ANA.id)).toBe("builder");
    expect(await marker()).toBe(ANA.id);
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(false);
  });

  it("R3: keeps an inheritor's level that is already set", async () => {
    const ids = await arrangeR2();
    await insertProfile(ANA.id, "not-technical");

    await as(ANA.email, resolveOwnerId);

    expect(await getTechnicalLevel(ANA.id)).toBe("not-technical");
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(false);
    expect(await ownersOf(ids)).toEqual([ANA.id, ANA.id, ANA.id]);
  });

  it("R4: a later user claims nothing", async () => {
    await setMarker(ANA.id);

    expect(await as(BEN.email, resolveOwnerId)).toBe(BEN.id);

    expect(await marker()).toBe(ANA.id);
    expect(await sessionCount(BEN.id)).toBe(0);
    expect(await profileExists(BEN.id)).toBe(true);
  });

  it("R5: a later user's resolve hands later local sessions and level to the inheritor", async () => {
    await setMarker(ANA.id);
    await insertProfile(ANA.id, null);
    const ids = [await insertSession(LOCAL_OWNER_ID), await insertSession(LOCAL_OWNER_ID)];
    await insertProfile(LOCAL_OWNER_ID, "technical-not-building");

    expect(await as(BEN.email, resolveOwnerId)).toBe(BEN.id);

    expect(await ownersOf(ids)).toEqual([ANA.id, ANA.id]);
    expect(await getTechnicalLevel(ANA.id)).toBe("technical-not-building");
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(false);
    expect(await sessionCount(BEN.id)).toBe(0);
  });

  it("R5b: the level moves to an inheritor with no profile row", async () => {
    await setMarker(ANA.id);
    await insertSession(LOCAL_OWNER_ID);
    await insertSession(LOCAL_OWNER_ID);
    await insertProfile(LOCAL_OWNER_ID, "technical-not-building");

    await as(BEN.email, resolveOwnerId);

    expect(await getTechnicalLevel(ANA.id)).toBe("technical-not-building");
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(false);
  });

  it("R6: a second resolve changes nothing", async () => {
    const ids = await arrangeR2();
    await as(ANA.email, resolveOwnerId);

    expect(await as(ANA.email, resolveOwnerId)).toBe(ANA.id);

    expect(await ownersOf(ids)).toEqual([ANA.id, ANA.id, ANA.id]);
    expect(await getTechnicalLevel(ANA.id)).toBe("builder");
    expect(await marker()).toBe(ANA.id);
    expect(await profileExists(LOCAL_OWNER_ID)).toBe(false);
  });

  it("R12: inserts a missing marker row and claims it", async () => {
    await getDb().delete(schema.migrationInheritance);
    expect(await marker()).toBeUndefined();

    expect(await as(ANA.email, resolveOwnerId)).toBe(ANA.id);

    expect(await marker()).toBe(ANA.id);
  });

  it("R13: looks the user up by the trimmed email", async () => {
    expect(await as(` ${ANA.email} `, resolveOwnerId)).toBe(ANA.id);
  });

  it("R9: rejects with no request context, and for an email with no user", async () => {
    await expect(resolveOwnerId()).rejects.toBeInstanceOf(OwnerNotResolvedError);
    await expect(as("nobody@example.test", resolveOwnerId)).rejects.toBeInstanceOf(
      OwnerNotResolvedError,
    );

    await expect(listSessions.run({})).rejects.toBeInstanceOf(OwnerNotResolvedError);
    await expect(getSession.run({ id: "any" })).rejects.toBeInstanceOf(
      OwnerNotResolvedError,
    );
    await expect(
      createSession.run({ title: "T", idea: "I", answeringMode: "whole-round" }),
    ).rejects.toBeInstanceOf(OwnerNotResolvedError);
    expect(await getDb().select().from(schema.sessions)).toEqual([]);
  });

  it("R10: of two concurrent claims exactly one wins", async () => {
    const results = await Promise.all([
      claimInheritance(ANA.id),
      claimInheritance(BEN.id),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? ANA.id : BEN.id;
    expect(await marker()).toBe(winner);
  });
});

describe("session actions with login on", () => {
  beforeEach(async () => {
    loginOn();
    await insertUsers();
    await setMarker(ANA.id);
  });

  it("R7: create-session stamps the current owner", async () => {
    const created = await as(ANA.email, () =>
      createSession.run({ title: "T", idea: "I", answeringMode: "whole-round" }),
    );

    expect(created!.ownerId).toBe(ANA.id);
    expect(await ownersOf([created!.id])).toEqual([ANA.id]);
  });

  it("R8: list-sessions and get-session see only the current owner's sessions", async () => {
    const a = await insertSession(ANA.id);
    const b = await insertSession(BEN.id);

    await as(ANA.email, async () => {
      const listed = await listSessions.run({});
      expect(listed.map((row) => row.id)).toEqual([a]);
      expect((await getSession.run({ id: a })).id).toBe(a);
      await expect(getSession.run({ id: b })).rejects.toThrow(
        `Session not found: ${b}`,
      );
    });
  });
});
