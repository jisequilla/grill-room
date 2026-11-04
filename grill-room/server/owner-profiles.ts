/**
 * Owner profiles: what the app knows about one owner across every session
 * they run, keyed by user id. Today that is only how technical they are.
 *
 * The one place `gr_owner_profiles` is read or written.
 */
import { eq } from "@agent-native/core/db/schema";

import {
  TECHNICAL_LEVELS,
  type TechnicalLevel,
} from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";

export interface OwnerProfile {
  userId: string;
  technicalLevel: TechnicalLevel | null;
}

/** The owner's profile, inserting one with no level when none exists. */
export async function getOrCreateOwnerProfile(
  userId: string,
): Promise<OwnerProfile> {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.ownerProfiles)
    .values({ userId, technicalLevel: null, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: schema.ownerProfiles.userId });

  const [row] = await getDb()
    .select({
      userId: schema.ownerProfiles.userId,
      technicalLevel: schema.ownerProfiles.technicalLevel,
    })
    .from(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, userId));
  return { userId: row!.userId, technicalLevel: row!.technicalLevel ?? null };
}

/** The owner's technical level, or null when unset or when they have no profile. Creates no row. */
export async function getTechnicalLevel(
  userId: string,
): Promise<TechnicalLevel | null> {
  const [row] = await getDb()
    .select({ technicalLevel: schema.ownerProfiles.technicalLevel })
    .from(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, userId));
  return row?.technicalLevel ?? null;
}

/**
 * Set the owner's technical level, or clear it with null, creating the
 * profile when none exists. Refuses a value outside {@link TECHNICAL_LEVELS}
 * before writing anything.
 */
export async function setTechnicalLevel(
  userId: string,
  level: TechnicalLevel | null,
): Promise<void> {
  if (level !== null && !(TECHNICAL_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `Unknown technical level ${JSON.stringify(level)}: expected one of ${TECHNICAL_LEVELS.join(", ")}, or null.`,
    );
  }
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.ownerProfiles)
    .values({ userId, technicalLevel: level, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.ownerProfiles.userId,
      set: { technicalLevel: level, updatedAt: now },
    });
}
