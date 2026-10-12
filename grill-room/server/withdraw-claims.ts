import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import type { DbHandle } from "./session-state.js";
import { CLEARED_SUPERSESSION } from "./tree.js";

/**
 * Withdraws every pending supersession on another row that names
 * `decisionId`: the claim that this decision, as it reads now, answers or
 * replaces that row. The proposal may quote this decision's text, so it goes
 * whenever that text stops standing as it was — a reopen, an accepted
 * deferral, or an accepted restatement.
 *
 * Given `db`, the write goes through that handle, so a caller's transaction
 * carries it; without one, it uses the app's database.
 */
export async function withdrawSupersessionsNaming(
  decisionId: string,
  now: string,
  db: DbHandle = getDb(),
): Promise<void> {
  await db
    .update(schema.decisions)
    .set({ ...CLEARED_SUPERSESSION, updatedAt: now })
    .where(eq(schema.decisions.supersededById, decisionId));
}

/**
 * Drops the claims other decisions make about `decisionId`'s settled answer,
 * once that answer no longer stands (a reopen, or an accepted deferral).
 *
 * A pending supersession on another row is the claim that this decision, as
 * settled, answers or replaces it, so that proposal is withdrawn. Nor does it
 * still replace anything: the decisions it replaced read as current again. A
 * loose end it settled keeps `settledById`, which records where that answer
 * came from rather than a claim about this one.
 *
 * Given `db`, both writes go through that handle.
 */
export async function withdrawClaimsOn(
  decisionId: string,
  now: string,
  db: DbHandle = getDb(),
): Promise<void> {
  await withdrawSupersessionsNaming(decisionId, now, db);

  await db
    .update(schema.decisions)
    .set({ replacedById: null, replacedReason: null, updatedAt: now })
    .where(eq(schema.decisions.replacedById, decisionId));
}
