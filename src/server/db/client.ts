import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import * as system from "./system.js";
import { postgresOptions, type DbConnection } from "./connection.js";

export function createDb(conn: DbConnection) {
  const { url, options } = postgresOptions(conn);
  const onnotice = () => {};
  const sql = url ? postgres(url, { ...options, max: 10, onnotice }) : postgres({ ...options, max: 10, onnotice });
  const db = drizzle(sql, { schema: { ...schema, ...system } });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>["db"];
