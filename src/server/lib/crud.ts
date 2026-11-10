import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Db } from "../db/client.js";

export type EntityAction = "read" | "create" | "update" | "delete";

export type EntityTable = AnyPgTable & {
  id: AnyPgColumn;
  created_at: AnyPgColumn;
  updated_at: AnyPgColumn;
  owner_id?: AnyPgColumn;
};

export type EntityDef = {
  name: string;
  label: string;
  labelPlural: string;
  path: string;
  table: EntityTable;
  insertSchema: z.ZodObject<Record<string, z.ZodType>>;
  ownedBy?: string;
  permissions: Record<string, EntityAction[]>;
};

export type CrudOptions = {
  db: Db;
  defs: EntityDef[];
  userTypes: string[];
  defaultUserType?: string;
};

// A user's type is the first Plan user type that appears among their realm roles.
// Self-serve sign-ups have no role yet, so they land on defaultUserType (the least privileged user type) when the plan allows it.
export function resolveUserType(roles: string[], userTypes: string[], defaultUserType?: string): string | null {
  for (const ut of userTypes) if (roles.includes(ut)) return ut;
  return defaultUserType ?? null;
}

type IdParams = { id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres error code for a foreign key violation. Drizzle may wrap the driver error, so look at the cause too.
function isForeignKeyViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23503") return true;
  }
  return false;
}

async function withForeignKeyCheck<T>(reply: FastifyReply, message: string, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    if (isForeignKeyViolation(err)) return reply.code(409).send({ error: "conflict", message });
    throw err;
  }
}

export function registerEntityRoutes(app: FastifyInstance, opts: CrudOptions): void {
  for (const def of opts.defs) {
    const base = `/${def.path}`;

    const guard = (action: EntityAction) => async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
      const ut = resolveUserType(req.user.roles, opts.userTypes, opts.defaultUserType);
      if (!ut || !def.permissions[ut]?.includes(action)) {
        return reply.code(403).send({ error: "forbidden", action, entity: def.name });
      }
      req.userType = ut;
      return undefined;
    };

    // A malformed id can never match a row. Answer 404 instead of letting Postgres reject the cast.
    const validId = async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
      return undefined;
    };

    // Rows of an owned entity are private to the owning user type. Other user types see every row their permissions allow.
    const ownerFilter = (req: FastifyRequest): SQL | undefined =>
      def.ownedBy && def.table.owner_id && req.userType === def.ownedBy ? eq(def.table.owner_id, req.user!.sub) : undefined;

    const whereId = (req: FastifyRequest, id: string): SQL => {
      const f = ownerFilter(req);
      return f ? and(eq(def.table.id, id), f)! : eq(def.table.id, id);
    };

    app.get(base, { preHandler: guard("read") }, async (req) => {
      let q = opts.db.select().from(def.table).$dynamic();
      const f = ownerFilter(req);
      if (f) q = q.where(f);
      return q.orderBy(desc(def.table.created_at)).limit(200);
    });

    app.get<{ Params: IdParams }>(`${base}/:id`, { preHandler: [guard("read"), validId] }, async (req, reply) => {
      const rows = await opts.db.select().from(def.table).where(whereId(req, req.params.id)).limit(1);
      if (!rows[0]) return reply.code(404).send({ error: "not_found" });
      return rows[0];
    });

    app.post(base, { preHandler: guard("create") }, async (req, reply) => {
      const parsed = def.insertSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid", issues: parsed.error.issues });
      const values: Record<string, unknown> = { ...parsed.data };
      if (def.table.owner_id) values["owner_id"] = req.user!.sub;
      return withForeignKeyCheck(reply, "A linked record does not exist.", async () => {
        const rows = await opts.db.insert(def.table).values(values as typeof def.table.$inferInsert).returning();
        return reply.code(201).send(rows[0]);
      });
    });

    app.put<{ Params: IdParams }>(`${base}/:id`, { preHandler: [guard("update"), validId] }, async (req, reply) => {
      const parsed = def.insertSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid", issues: parsed.error.issues });
      const values: Record<string, unknown> = { ...parsed.data, updated_at: new Date() };
      delete values["owner_id"];
      return withForeignKeyCheck(reply, "A linked record does not exist.", async () => {
        const rows = await opts.db
          .update(def.table)
          .set(values as typeof def.table.$inferInsert)
          .where(whereId(req, req.params.id))
          .returning();
        if (!rows[0]) return reply.code(404).send({ error: "not_found" });
        return rows[0];
      });
    });

    app.delete<{ Params: IdParams }>(`${base}/:id`, { preHandler: [guard("delete"), validId] }, async (req, reply) => {
      return withForeignKeyCheck(reply, `Other records still point to this ${def.label}. Remove or change them first.`, async () => {
        const rows = await opts.db.delete(def.table).where(whereId(req, req.params.id)).returning();
        if (!rows[0]) return reply.code(404).send({ error: "not_found" });
        return reply.code(204).send();
      });
    });
  }
}
