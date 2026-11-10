import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { authPlugin } from "../src/server/auth.js";
import { registerEntityRoutes, resolveUserType, type EntityDef } from "../src/server/lib/crud.js";
import { createDb } from "../src/server/db/client.js";
import { testIssuer, type TestIssuer } from "./helpers/auth.js";

// Tables owned by this test file only, so it never depends on the generated schema.
const noteTable = pgTable("crud_test_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  owner_id: text("owner_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const commentTable = pgTable("crud_test_comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  body: text("body").notNull(),
  note_id: uuid("note_id").notNull().references(() => noteTable.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const defs: EntityDef[] = [
  {
    name: "Note",
    label: "note",
    labelPlural: "notes",
    path: "notes",
    table: noteTable,
    insertSchema: z.object({ title: z.string().min(1) }),
    ownedBy: "customer",
    permissions: { staff: ["read", "update", "delete"], customer: ["read", "create"] },
  },
  {
    name: "Comment",
    label: "comment",
    labelPlural: "comments",
    path: "comments",
    table: commentTable,
    insertSchema: z.object({ body: z.string().min(1), note_id: z.string().uuid() }),
    permissions: { staff: ["read", "create", "delete"], customer: ["read", "create"] },
  },
];
const userTypes = ["staff", "customer"];

const databaseUrl = process.env.DATABASE_URL;
let issuer: TestIssuer;
let conn: ReturnType<typeof createDb>;

async function crudApp(defaultUserType?: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin, { issuer: issuer.issuer, audience: issuer.audience, getKey: issuer.getKey });
  await app.register(async (scoped) => registerEntityRoutes(scoped, { db: conn.db, defs, userTypes, defaultUserType }), { prefix: "/api" });
  await app.ready();
  return app;
}

const as = async (roles: string[], sub = "user-1") => ({ authorization: `Bearer ${await issuer.token(roles, sub)}` });

beforeAll(async () => {
  issuer = await testIssuer();
  // postgres.js connects lazily, so the tests that never reach the database need no Postgres.
  conn = createDb({ kind: "url", url: databaseUrl ?? "postgres://nobody:nobody@127.0.0.1:1/none" });
});

afterAll(async () => {
  await conn.sql.end({ timeout: 5 });
});

describe("resolveUserType", () => {
  it("returns the first plan user type found among the roles, in plan order", () => {
    expect(resolveUserType(["customer", "staff"], ["staff", "customer"])).toBe("staff");
    expect(resolveUserType(["offline_access", "customer"], ["staff", "customer"])).toBe("customer");
  });

  it("falls back to the default when no role matches", () => {
    expect(resolveUserType(["offline_access"], ["staff", "customer"], "customer")).toBe("customer");
    expect(resolveUserType([], ["staff", "customer"], "customer")).toBe("customer");
  });

  it("returns null with no matching role and no default", () => {
    expect(resolveUserType([], ["staff", "customer"])).toBeNull();
    expect(resolveUserType(["admin"], ["staff", "customer"], undefined)).toBeNull();
  });
});

describe("authorization (no database needed)", () => {
  let app: FastifyInstance;
  let withDefault: FastifyInstance;
  beforeAll(async () => {
    app = await crudApp();
    withDefault = await crudApp("customer");
  });
  afterAll(async () => {
    await app.close();
    await withDefault.close();
  });

  it("403 when the user type lacks the action", async () => {
    const create = await app.inject({ method: "POST", url: "/api/notes", headers: await as(["staff"]), payload: { title: "x" } });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toEqual({ error: "forbidden", action: "create", entity: "Note" });
    const del = await app.inject({ method: "DELETE", url: `/api/notes/${randomUUID()}`, headers: await as(["customer"]) });
    expect(del.statusCode).toBe(403);
  });

  it("no role and no default user type: 403 on every action", async () => {
    for (const [method, url] of [["GET", "/api/notes"], ["POST", "/api/notes"], ["GET", `/api/notes/${randomUUID()}`]] as const) {
      const res = await app.inject({ method, url, headers: await as([]), payload: method === "POST" ? { title: "x" } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("no role with a default user type: gets exactly the default's permissions", async () => {
    // customer may create, so the guard passes and the body check answers.
    const create = await withDefault.inject({ method: "POST", url: "/api/notes", headers: await as([]), payload: {} });
    expect(create.statusCode).toBe(400);
    // customer may not delete.
    const del = await withDefault.inject({ method: "DELETE", url: `/api/notes/${randomUUID()}`, headers: await as([]) });
    expect(del.statusCode).toBe(403);
  });

  it("a known role wins over the default", async () => {
    const res = await withDefault.inject({ method: "POST", url: "/api/notes", headers: await as(["staff"]), payload: { title: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/api/notes" })).statusCode).toBe(401);
  });

  it("a malformed id is a 404, not a database error", async () => {
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/api/notes/not-a-uuid", headers: await as(["staff"]), payload: method === "PUT" ? { title: "x" } : undefined });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
    }
  });

  it("checks permission before the id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/notes/not-a-uuid", headers: await as(["customer"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe.skipIf(!databaseUrl)("authorization with a database (DATABASE_URL set)", () => {
  let app: FastifyInstance;
  let withDefault: FastifyInstance;

  beforeAll(async () => {
    await conn.sql.unsafe(`
      DROP TABLE IF EXISTS crud_test_comment;
      DROP TABLE IF EXISTS crud_test_note;
      CREATE TABLE crud_test_note (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, owner_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE crud_test_comment (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text NOT NULL,
        note_id uuid NOT NULL REFERENCES crud_test_note(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    `);
    app = await crudApp();
    withDefault = await crudApp("customer");
  });

  afterAll(async () => {
    await app.close();
    await withDefault.close();
    await conn.sql.unsafe("DROP TABLE IF EXISTS crud_test_comment; DROP TABLE IF EXISTS crud_test_note;");
  });

  const create = async (a: FastifyInstance, roles: string[], sub: string, title: string) => {
    const res = await a.inject({ method: "POST", url: "/api/notes", headers: await as(roles, sub), payload: { title } });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; owner_id: string };
  };

  it("the owning user type sees only its own rows; other user types with read see all", async () => {
    const a = await create(app, ["customer"], "cust-a", "from a");
    const b = await create(app, ["customer"], "cust-b", "from b");
    expect(a.owner_id).toBe("cust-a");

    const listA = (await app.inject({ method: "GET", url: "/api/notes", headers: await as(["customer"], "cust-a") })).json() as { id: string }[];
    expect(listA.map((r) => r.id)).toContain(a.id);
    expect(listA.map((r) => r.id)).not.toContain(b.id);

    const otherRow = await app.inject({ method: "GET", url: `/api/notes/${b.id}`, headers: await as(["customer"], "cust-a") });
    expect(otherRow.statusCode).toBe(404);

    const staffList = (await app.inject({ method: "GET", url: "/api/notes", headers: await as(["staff"], "staff-1") })).json() as { id: string }[];
    expect(staffList.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const staffRow = await app.inject({ method: "GET", url: `/api/notes/${b.id}`, headers: await as(["staff"], "staff-1") });
    expect(staffRow.statusCode).toBe(200);
  });

  it("a user with no role lands on the default user type, owner filter included", async () => {
    const mine = await create(withDefault, [], "new-signup", "mine");
    const theirs = await create(withDefault, ["customer"], "someone-else", "theirs");
    expect(mine.owner_id).toBe("new-signup");
    const list = (await withDefault.inject({ method: "GET", url: "/api/notes", headers: await as([], "new-signup") })).json() as { id: string }[];
    expect(list.map((r) => r.id)).toEqual([mine.id]);
    expect(list.map((r) => r.id)).not.toContain(theirs.id);
  });

  it("a valid but unknown id is a 404", async () => {
    const res = await app.inject({ method: "GET", url: `/api/notes/${randomUUID()}`, headers: await as(["staff"]) });
    expect(res.statusCode).toBe(404);
  });

  it("deleting a row other rows point to is a 409 with a plain message", async () => {
    const note = await create(app, ["customer"], "cust-fk", "has comments");
    const comment = await app.inject({ method: "POST", url: "/api/comments", headers: await as(["customer"], "cust-fk"), payload: { body: "hi", note_id: note.id } });
    expect(comment.statusCode, comment.body).toBe(201);

    const del = await app.inject({ method: "DELETE", url: `/api/notes/${note.id}`, headers: await as(["staff"]) });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toEqual({ error: "conflict", message: "Other records still point to this note. Remove or change them first." });
    expect(del.body).not.toContain("crud_test_comment");
  });

  it("creating a row that points to a missing row is a 409", async () => {
    const res = await app.inject({ method: "POST", url: "/api/comments", headers: await as(["staff"]), payload: { body: "orphan", note_id: randomUUID() } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "conflict", message: "A linked record does not exist." });
  });
});
