import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppOptions } from "../src/server/app.js";
import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";
import type { ZodTypeAny } from "zod";
import { testIssuer, type TestIssuer } from "./helpers/auth.js";
import { createBlobStore, type BlobStore } from "../src/server/blob.js";
import { createDb } from "../src/server/db/client.js";
import { runMigrations } from "../src/server/db/migrate.js";
import { entityDefs, userTypes } from "../src/server/routes/entities.js";

type Check = { kind: string };
function checksOf(schema: ZodTypeAny): Check[] {
  return (schema._def as { checks?: Check[] }).checks ?? [];
}

function hasRequiredReference(def: (typeof entityDefs)[number]): boolean {
  return Object.values(def.insertSchema.shape).some((f) => !f.isOptional() && checksOf(f).some((c) => c.kind === "uuid"));
}

function pickEntity() {
  return entityDefs.find((d) => !hasRequiredReference(d)) ?? entityDefs[0]!;
}

// Builds a value that satisfies a required zod field: enum first option, uuid, email, url, YYYY-MM-DD for regex, else text.
function sampleFor(schema: ZodTypeAny): unknown {
  const typeName = (schema._def as { typeName: string }).typeName;
  // z.preprocess(...) wraps the real schema; sample the inner one.
  if (typeName === "ZodEffects") return sampleFor((schema._def as unknown as { schema: ZodTypeAny }).schema);
  if (typeName === "ZodBoolean") return true;
  if (typeName === "ZodNumber") return 1;
  if (typeName === "ZodDate") return new Date().toISOString();
  if (typeName === "ZodEnum") return (schema as unknown as { options: string[] }).options[0];
  if (typeName === "ZodString") {
    const kinds = checksOf(schema).map((c) => c.kind);
    if (kinds.includes("uuid")) return randomUUID();
    if (kinds.includes("email")) return "smoke@example.com";
    if (kinds.includes("url")) return "https://example.com/";
    if (kinds.includes("regex")) return "2026-01-01";
    return "smoke";
  }
  return "smoke";
}

const publicConfig = { keycloakUrl: "http://localhost:8080", realm: "test", clientId: "web" };

let app: FastifyInstance;
let issuer: TestIssuer;
let db: ReturnType<typeof createDb>["db"];
let blob: BlobStore;
let appOptions: AppOptions;

function authOf(i: TestIssuer): AppOptions["auth"] {
  return { issuer: i.issuer, audience: i.audience, getKey: i.getKey };
}

beforeAll(async () => {
  issuer = await testIssuer();
  // postgres.js connects lazily, so a dead URL is fine for the tests that never touch the database.
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://nobody:nobody@127.0.0.1:1/none";
  db = createDb({ kind: "url", url: databaseUrl }).db;
  // The blob client connects lazily, so tests that never touch storage need no Azurite.
  blob = createBlobStore({
    accountName: process.env.STORAGE_ACCOUNT_NAME ?? "devstoreaccount1",
    blobEndpoint: process.env.STORAGE_BLOB_ENDPOINT ?? "http://127.0.0.1:10000/devstoreaccount1/",
    containerName: process.env.STORAGE_CONTAINER ?? "uploads",
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING ?? "UseDevelopmentStorage=true",
  });
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) await blob.ensureLocal();
  appOptions = { db, blob, auth: authOf(issuer), publicConfig };
  app = await buildApp(appOptions);
  app.get("/api/whoami", { preHandler: app.requireUser }, async (req) => req.user);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("smoke", () => {
  it("GET /healthz returns 200 with ok true", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("GET /api/config is public and names the web client", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ clientId: "web" });
  });

  it("GET /healthz/db without a token returns 401 (no database needed)", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz/db" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /healthz/blob without a token returns 401 (no Azurite needed)", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz/blob" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/uploads rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "POST", url: "/api/uploads" });
    expect(res.statusCode).toBe(401);
  });

  describe.skipIf(!process.env.AZURE_STORAGE_CONNECTION_STRING)("with Azurite (AZURE_STORAGE_CONNECTION_STRING set)", () => {
    it("GET /healthz/blob writes and reads a blob with a realm token", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz/blob", headers: { authorization: `Bearer ${await issuer.token(["member"])}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, blob: "roundtrip" });
    });

    it("POST /api/uploads stores the file in the private container", async () => {
      const auth = { authorization: `Bearer ${await issuer.token([userTypes[0]!], "uploader")}` };
      const boundary = "----fondosmoke";
      const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hello world.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`);
      const res = await app.inject({ method: "POST", url: "/api/uploads", headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
      expect(res.statusCode, res.body).toBe(201);
      const { blobName, size } = res.json() as { blobName: string; size: number };
      expect(blobName.startsWith("uploader/")).toBe(true);
      expect(size).toBe(5);
      const service = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
      const container = service.getContainerClient(process.env.STORAGE_CONTAINER ?? "uploads");
      const read = (await container.getBlockBlobClient(blobName).downloadToBuffer()).toString("utf8");
      expect(read).toBe("hello");
    });
  });

  it("serves index.html for unknown GET paths when serveWeb is on", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>spa</title>");
    const web = await buildApp({ ...appOptions, serveWeb: dir });
    await web.ready();
    const res = await web.inject({ method: "GET", url: "/records/123" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("spa");
    const api = await web.inject({ method: "GET", url: "/api/nothing-here" });
    expect(api.statusCode).toBe(404);
    await web.close();
  });

  it("entity routes reject unauthenticated requests", async () => {
    const first = entityDefs[0]!;
    const res = await app.inject({ method: "GET", url: `/api/${first.path}` });
    expect(res.statusCode).toBe(401);
  });

  describe.skipIf(!process.env.DATABASE_URL)("with a database (DATABASE_URL set)", () => {
    beforeAll(async () => {
      await runMigrations({ kind: "url", url: process.env.DATABASE_URL! });
    });

    it("GET /healthz/db round-trips a row with a realm token", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz/db", headers: { authorization: `Bearer ${await issuer.token(["member"])}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, db: "roundtrip" });
    });

    it("authenticated request creates then lists an entity", async () => {
      const first = pickEntity();
      const role = userTypes.find((ut) => first.permissions[ut]?.includes("create") && first.permissions[ut]?.includes("read"))!;
      const auth = { authorization: `Bearer ${await issuer.token([role], "owner-1")}` };
      const body: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(first.insertSchema.shape)) {
        if (field.isOptional()) continue;
        body[key] = sampleFor(field);
      }
      const created = await app.inject({ method: "POST", url: `/api/${first.path}`, headers: auth, payload: body });
      expect(created.statusCode, created.body).toBe(201);
      const list = await app.inject({ method: "GET", url: `/api/${first.path}`, headers: auth });
      expect(list.statusCode).toBe(200);
      expect(list.json().some((r: { id: string }) => r.id === created.json().id)).toBe(true);
    });
  });
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("token validation", () => {
  it("rejects a request without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/whoami" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed by another key", async () => {
    const other = await testIssuer();
    const res = await app.inject({ method: "GET", url: "/api/whoami", headers: bearer(await other.token(["member"])) });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid token and exposes realm roles", async () => {
    const res = await app.inject({ method: "GET", url: "/api/whoami", headers: bearer(await issuer.token(["member"], "abc")) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: "abc", roles: ["member"] });
  });

  it("requireUser rejects a valid realm token without the api audience", async () => {
    const res = await app.inject({ method: "GET", url: "/api/whoami", headers: bearer(await issuer.token(["member"], "abc", { audience: "account" })) });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /healthz/auth", () => {
  const get = (headers?: Record<string, string>) => app.inject({ method: "GET", url: "/healthz/auth", headers });

  it("no token: 401", async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it("bad signature: 401", async () => {
    const other = await testIssuer();
    expect((await get(bearer(await other.token(["member"])))).statusCode).toBe(401);
  });

  it("wrong issuer: 401", async () => {
    const t = await issuer.token(["member"], "x", { issuer: "http://localhost:8080/realms/other" });
    expect((await get(bearer(t))).statusCode).toBe(401);
  });

  it("valid token with audience api: 200", async () => {
    const res = await get(bearer(await issuer.token(["member"])));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("valid token with another audience: 200", async () => {
    expect((await get(bearer(await issuer.token([], "svc", { audience: "account" })))).statusCode).toBe(200);
  });

  it("valid token with no audience: 200", async () => {
    expect((await get(bearer(await issuer.token([], "svc", { audience: null })))).statusCode).toBe(200);
  });

  it("/healthz stays public", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });
});

describe("front door check", () => {
  async function withId(id: string | undefined, fn: (a: FastifyInstance) => Promise<void>) {
    const a = await buildApp(id === undefined ? { auth: authOf(issuer), db, blob, publicConfig } : { auth: authOf(issuer), db, blob, publicConfig, frontdoorId: id });
    await a.ready();
    try {
      await fn(a);
    } finally {
      await a.close();
    }
  }

  it("unset: /healthz returns 200", async () => {
    await withId(undefined, async (a) => {
      const res = await a.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
    });
  });

  it("empty string: no check", async () => {
    await withId("", async (a) => {
      const res = await a.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
    });
  });

  it("set and no header: /healthz is exempt (200), also with a query string", async () => {
    await withId("abc-123", async (a) => {
      expect((await a.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
      expect((await a.inject({ method: "GET", url: "/healthz?probe=1" })).statusCode).toBe(200);
    });
  });

  it("set and no header: non-health paths are 403 with forbidden body", async () => {
    await withId("abc-123", async (a) => {
      for (const url of ["/healthz/db", "/healthz/", "/nope"]) {
        const res = await a.inject({ method: "GET", url });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: "forbidden" });
      }
    });
  });

  it("set and header mismatched: 403 on a non-health path", async () => {
    await withId("abc-123", async (a) => {
      const res = await a.inject({ method: "GET", url: "/nope", headers: { "x-azure-fdid": "nope" } });
      expect(res.statusCode).toBe(403);
    });
  });

  it("set and header equal: 200", async () => {
    await withId("abc-123", async (a) => {
      const res = await a.inject({ method: "GET", url: "/healthz", headers: { "x-azure-fdid": "abc-123" } });
      expect(res.statusCode).toBe(200);
    });
  });
});
