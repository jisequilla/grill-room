import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import { CLEARED_SUPERSESSION } from "./tree.js";

/**
 * Drops the claims other decisions make about `decisionId`'s settled answer,
 * once that answer no longer stands (a reopen, or an accepted deferral).
 *
 * A pending supersession on another row is the claim that this decision, as
 * settled, answers or replaces it, so that proposal is withdrawn. Nor does it
 * still replace anything: the decisions it replaced read as current again. A
 * loose end it settled keeps `settledById`, which records where that answer
 * came from rather than a claim about this one.
 */
export async function withdrawClaimsOn(
  decisionId: string,
  now: string,
): Promise<void> {
  const db = getDb();

  await db
    .update(schema.decisions)
    .set({ ...CLEARED_SUPERSESSION, updatedAt: now })
    .where(eq(schema.decisions.supersededById, decisionId));

  await db
    .update(schema.decisions)
    .set({ replacedById: null, replacedReason: null, updatedAt: now })
    .where(eq(schema.decisions.replacedById, decisionId));
}
