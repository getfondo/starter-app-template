import type postgres from "postgres";
import { DefaultAzureCredential } from "@azure/identity";

export type DbConnection =
  | { kind: "url"; url: string }
  | { kind: "entra"; host: string; port: number; database: string; user: string };

export const ENTRA_POSTGRES_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

// In Azure (PG_AUTH=entra) the app identity signs in to Postgres with a token. DATABASE_URL is the local docker compose path only.
export function readDbConnection(env: NodeJS.ProcessEnv = process.env): DbConnection {
  if (env.PG_AUTH === "entra") {
    return { kind: "entra", host: need(env, "PGHOST"), port: Number(env.PGPORT ?? 5432), database: env.PGDATABASE || "app", user: need(env, "PGUSER") };
  }
  return { kind: "url", url: need(env, "DATABASE_URL") };
}

let credential: DefaultAzureCredential | undefined;
async function entraToken(): Promise<string> {
  credential ??= new DefaultAzureCredential(); // picks the user-assigned identity from AZURE_CLIENT_ID
  const t = await credential.getToken(ENTRA_POSTGRES_SCOPE);
  if (!t) throw new Error("no Entra token for Postgres");
  return t.token;
}

// postgres.js calls a function password on every new connection, so tokens refresh without a restart.
export function postgresOptions(conn: DbConnection, token: () => Promise<string> = entraToken): { url?: string; options: postgres.Options<{}> } {
  if (conn.kind === "url") return { url: conn.url, options: {} };
  return { options: { host: conn.host, port: conn.port, database: conn.database, username: conn.user, ssl: "require", password: token } };
}
