import type { MigrationEntry } from "@agent-native/core/db";

/** Bookkeeping table this app owns; never shared with framework migrations. */
export const MIGRATIONS_TABLE = "grill_room_migrations";

/**
 * The app's schema, as an ordered list of additive migrations.
 *
 * This list is the single description of the schema: the startup plugin applies
 * it to the local database and the test harness applies it to each test's
 * in-memory database. Append entries with a new `version` and a stable `name`;
 * never renumber, rename, or edit an entry that has shipped.
 */
export const appMigrations: MigrationEntry[] = [
  {
    version: 1,
    name: "global-settings-table",
    sql: `CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
];
