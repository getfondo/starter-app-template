import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { postgresOptions, readDbConnection, type DbConnection } from "./connection.js";

const LOCK_KEY = 727001;

// Runs the committed SQL migrations in ./drizzle. Safe to call from every replica at startup:
// a session-level advisory lock serialises concurrent starters on the same database.
export async function runMigrations(conn: DbConnection, migrationsDir = resolve(process.cwd(), "drizzle")): Promise<void> {
  const { url, options } = postgresOptions(conn);
  const onnotice = () => {};
  const sql = url ? postgres(url, { ...options, max: 1, onnotice }) : postgres({ ...options, max: 1, onnotice });
  const db = drizzle(sql);
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    try {
      await migrate(db, { migrationsFolder: migrationsDir });
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let conn: DbConnection;
  try {
    conn = readDbConnection();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  runMigrations(conn).then(
    () => console.log(JSON.stringify({ level: "info", msg: "migrations applied" })),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
