/**
 * Who the current owner is.
 *
 * With login off there is one owner, `local-owner`. With login on the owner is
 * the signed-in Better Auth user, and the first such user to resolve inherits
 * everything stamped `local-owner`: the sessions, and the technical level when
 * their own is unset. Sessions created later with login off are handed to the
 * same inheritor on the next login-on resolve, by whoever makes it.
 */
import { getDbExec } from "@agent-native/core/db";
import { and, eq, isNull } from "@agent-native/core/db/schema";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { LOCAL_OWNER_ID } from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";
import {
  getOrCreateOwnerProfile,
  getTechnicalLevel,
  setTechnicalLevel,
} from "./owner-profiles.js";

const MARKER_ID = "singleton";

/** The framework's login-off rule, which `@agent-native/core` does not export. */
export function isAuthDisabled(): boolean {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Login is on and the request names no user the app can find. */
export class OwnerNotResolvedError extends Error {
  constructor(message = "No signed-in owner could be resolved.") {
    super(message);
    this.name = "OwnerNotResolvedError";
  }
}

/**
 * Make `userId` the inheritor if nobody is yet. True only when this call set
 * it, so of two concurrent claims exactly one wins.
 */
export async function claimInheritance(userId: string): Promise<boolean> {
  await getDb()
    .insert(schema.migrationInheritance)
    .values({ id: MARKER_ID, inheritorUserId: null })
    .onConflictDoNothing({ target: schema.migrationInheritance.id });

  const claimed = await getDb()
    .update(schema.migrationInheritance)
    .set({ inheritorUserId: userId })
    .where(
      and(
        eq(schema.migrationInheritance.id, MARKER_ID),
        isNull(schema.migrationInheritance.inheritorUserId),
      ),
    )
    .returning({ id: schema.migrationInheritance.id });
  return claimed.length > 0;
}

async function inheritorId(): Promise<string | null> {
  const [row] = await getDb()
    .select({ inheritorUserId: schema.migrationInheritance.inheritorUserId })
    .from(schema.migrationInheritance)
    .where(eq(schema.migrationInheritance.id, MARKER_ID));
  return row?.inheritorUserId ?? null;
}

/** Move everything stamped `local-owner` to the inheritor. */
async function handOffLocalOwner(inheritor: string): Promise<void> {
  await getDb()
    .update(schema.sessions)
    .set({ ownerId: inheritor })
    .where(eq(schema.sessions.ownerId, LOCAL_OWNER_ID));

  const [localProfile] = await getDb()
    .select({ technicalLevel: schema.ownerProfiles.technicalLevel })
    .from(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, LOCAL_OWNER_ID));
  if (!localProfile) return;

  const localLevel = localProfile.technicalLevel ?? null;
  if (localLevel !== null && (await getTechnicalLevel(inheritor)) === null) {
    await setTechnicalLevel(inheritor, localLevel);
  }
  await getDb()
    .delete(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, LOCAL_OWNER_ID));
}

async function findUserId(email: string): Promise<string | null> {
  const { rows } = await getDbExec().execute({
    sql: 'SELECT id FROM "user" WHERE LOWER(email) = LOWER(?) LIMIT 1',
    args: [email],
  });
  const row = rows[0] as { id?: unknown } | undefined;
  return row?.id == null ? null : String(row.id);
}

/**
 * The current owner's id. `local-owner` with login off; otherwise the signed-in
 * user's id, after handing anything stamped `local-owner` to the inheritor.
 * Throws {@link OwnerNotResolvedError} when login is on and no user resolves.
 */
export async function resolveOwnerId(): Promise<string> {
  if (isAuthDisabled()) {
    await getOrCreateOwnerProfile(LOCAL_OWNER_ID);
    return LOCAL_OWNER_ID;
  }

  const email = getRequestUserEmail()?.trim();
  if (!email) throw new OwnerNotResolvedError();

  const userId = await findUserId(email);
  if (userId === null) {
    throw new OwnerNotResolvedError(`No user found for ${email}.`);
  }

  await getOrCreateOwnerProfile(userId);
  await claimInheritance(userId);

  const inheritor = await inheritorId();
  if (inheritor !== null) await handOffLocalOwner(inheritor);

  return userId;
}
