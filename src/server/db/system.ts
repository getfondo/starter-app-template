import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Static table used by GET /healthz/db to prove a real write and read against Postgres.
export const healthzTable = pgTable("healthz_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note").notNull(),
  checked_at: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
});
