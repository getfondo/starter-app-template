import { readDbConnection, type DbConnection } from "./db/connection.js";

export type Env = {
  port: number;
  logLevel: string;
  db: DbConnection;
  keycloakRealm: string | undefined;
  keycloakUrl: string;
  keycloakJwksUrl: string;
  storageAccountName: string;
  storageConnectionString: string | undefined;
  storageBlobEndpoint: string;
  storageContainer: string;
  frontdoorId: string;
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function readEnv(): Env {
  const keycloakUrl = required("KEYCLOAK_URL").replace(/\/+$/, "");
  const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || undefined;
  // Locally a connection string points at Azurite, whose account is devstoreaccount1. In Azure there is no
  // connection string (managed identity), so the real account name must be set.
  const storageAccountName = storageConnectionString ? (process.env.STORAGE_ACCOUNT_NAME || "devstoreaccount1") : required("STORAGE_ACCOUNT_NAME");
  return {
    port: Number(process.env.PORT ?? 8080),
    logLevel: process.env.LOG_LEVEL ?? "info",
    db: readDbConnection(),
    keycloakRealm: process.env.KEYCLOAK_REALM || undefined,
    keycloakUrl,
    keycloakJwksUrl: (process.env.KEYCLOAK_JWKS_URL ?? keycloakUrl).replace(/\/+$/, ""),
    storageAccountName,
    storageConnectionString,
    storageBlobEndpoint: process.env.STORAGE_BLOB_ENDPOINT || `https://${storageAccountName}.blob.core.windows.net/`,
    storageContainer: process.env.STORAGE_CONTAINER || "uploads",
    frontdoorId: process.env.FRONTDOOR_ID ?? "",
  };
}
