import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readEnv } from "../src/server/env.js";

const KEYS = [
  "KEYCLOAK_URL", "KEYCLOAK_REALM", "DATABASE_URL", "PG_AUTH", "PGHOST", "PGUSER", "PORT",
  "STORAGE_ACCOUNT_NAME", "STORAGE_BLOB_ENDPOINT", "STORAGE_CONTAINER", "AZURE_STORAGE_CONNECTION_STRING",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.KEYCLOAK_URL = "http://localhost:8080/";
  process.env.DATABASE_URL = "postgres://app:app@localhost:5432/app";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readEnv storage settings", () => {
  it("with no connection string (Azure), the account name is required", () => {
    expect(() => readEnv()).toThrow("Missing required environment variable STORAGE_ACCOUNT_NAME");
  });

  it("with no connection string, uses the account name given and the default endpoint and container", () => {
    process.env.STORAGE_ACCOUNT_NAME = "stacmedev";
    const env = readEnv();
    expect(env.storageAccountName).toBe("stacmedev");
    expect(env.storageConnectionString).toBeUndefined();
    expect(env.storageBlobEndpoint).toBe("https://stacmedev.blob.core.windows.net/");
    expect(env.storageContainer).toBe("uploads");
  });

  it("STORAGE_BLOB_ENDPOINT and STORAGE_CONTAINER override the defaults", () => {
    process.env.STORAGE_ACCOUNT_NAME = "stacmedev";
    process.env.STORAGE_BLOB_ENDPOINT = "https://custom.example/";
    process.env.STORAGE_CONTAINER = "files";
    const env = readEnv();
    expect(env.storageBlobEndpoint).toBe("https://custom.example/");
    expect(env.storageContainer).toBe("files");
  });

  it("an empty connection string counts as none", () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = "";
    expect(() => readEnv()).toThrow(/STORAGE_ACCOUNT_NAME/);
  });

  it("with a connection string (Azurite), devstoreaccount1 is the default", () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    const env = readEnv();
    expect(env.storageAccountName).toBe("devstoreaccount1");
    expect(env.storageConnectionString).toBe("UseDevelopmentStorage=true");
    expect(env.keycloakUrl).toBe("http://localhost:8080");
  });

  it("with a connection string, an explicit account name still wins", () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    process.env.STORAGE_ACCOUNT_NAME = "other";
    expect(readEnv().storageAccountName).toBe("other");
  });
});

describe("readEnv port, realm and database", () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
  });

  it("port defaults to 8080", () => {
    expect(readEnv().port).toBe(8080);
    process.env.PORT = "3000";
    expect(readEnv().port).toBe(3000);
  });

  it("KEYCLOAK_REALM is read when set and undefined otherwise", () => {
    expect(readEnv().keycloakRealm).toBeUndefined();
    process.env.KEYCLOAK_REALM = "acme";
    expect(readEnv().keycloakRealm).toBe("acme");
  });

  it("PG_AUTH=entra without DATABASE_URL does not throw", () => {
    delete process.env.DATABASE_URL;
    process.env.PG_AUTH = "entra";
    process.env.PGHOST = "h";
    process.env.PGUSER = "u";
    expect(readEnv().db).toMatchObject({ kind: "entra", host: "h", user: "u" });
  });
});
