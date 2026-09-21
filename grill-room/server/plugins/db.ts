import { runMigrations } from "@agent-native/core/db";

import { appMigrations, MIGRATIONS_TABLE } from "../db/migrations.js";

export default runMigrations(appMigrations, { table: MIGRATIONS_TABLE });
