import { describe, it, expect } from "vitest";
import { readDbConnection, postgresOptions } from "../src/server/db/connection.js";

describe("readDbConnection", () => {
  it("PG_AUTH=entra uses A's PG* variables and needs no DATABASE_URL", () => {
    const c = readDbConnection({ PG_AUTH: "entra", PGHOST: "pg-acme-dev-abc.postgres.database.azure.com", PGPORT: "5432", PGDATABASE: "app", PGUSER: "id-acme-dev-app", PGSSLMODE: "require" });
    expect(c).toEqual({ kind: "entra", host: "pg-acme-dev-abc.postgres.database.azure.com", port: 5432, database: "app", user: "id-acme-dev-app" });
  });
  it("PG_AUTH=entra without PGHOST or PGUSER fails fast", () => {
    expect(() => readDbConnection({ PG_AUTH: "entra", PGUSER: "u" })).toThrow(/PGHOST/);
    expect(() => readDbConnection({ PG_AUTH: "entra", PGHOST: "h" })).toThrow(/PGUSER/);
  });
  it("PGDATABASE defaults to app and PGPORT to 5432", () => {
    expect(readDbConnection({ PG_AUTH: "entra", PGHOST: "h", PGUSER: "u" })).toMatchObject({ database: "app", port: 5432 });
  });
  it("without PG_AUTH=entra, DATABASE_URL is required (local docker compose)", () => {
    expect(readDbConnection({ DATABASE_URL: "postgres://app:app@localhost:5432/app" })).toEqual({ kind: "url", url: "postgres://app:app@localhost:5432/app" });
    expect(() => readDbConnection({})).toThrow(/DATABASE_URL/);
  });
});

describe("postgresOptions", () => {
  it("entra: ssl require and a password function that returns the token", async () => {
    const { url, options } = postgresOptions({ kind: "entra", host: "h", port: 5432, database: "app", user: "u" }, async () => "tok");
    expect(url).toBeUndefined();
    expect(options).toMatchObject({ host: "h", port: 5432, database: "app", username: "u", ssl: "require" });
    expect(typeof options.password).toBe("function");
    expect(await (options.password as () => Promise<string>)()).toBe("tok");
  });
  it("url: passes the url through", () => {
    expect(postgresOptions({ kind: "url", url: "postgres://x" }).url).toBe("postgres://x");
  });
});
