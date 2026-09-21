import { table, text } from "@agent-native/core/db/schema";

/** App-wide preferences that are not tied to a single session. */
export const globalSettings = table("global_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
