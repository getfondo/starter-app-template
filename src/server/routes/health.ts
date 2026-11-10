import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { BlobStore } from "../blob.js";
import { healthzTable } from "../db/system.js";

export type HealthOptions = { db: Db; blob: BlobStore };

export async function healthRoutes(app: FastifyInstance, opts: HealthOptions): Promise<void> {
  app.get("/healthz", async () => ({ ok: true, time: new Date().toISOString() }));
  // Valid realm token from any client. The post-deploy checker uses a service-account token.
  // /healthz/db and /healthz/blob use the same preHandler.
  app.get("/healthz/auth", { preHandler: app.requireRealmToken }, async () => ({ ok: true }));

  // "It worked but it is wrong" guard: insert, read back, delete. A connection that accepts queries but has no schema fails here.
  app.get("/healthz/db", { preHandler: app.requireRealmToken }, async (req, reply) => {
    try {
      const [inserted] = await opts.db.insert(healthzTable).values({ note: "healthz" }).returning();
      if (!inserted) throw new Error("insert returned no row");
      const [read] = await opts.db.select().from(healthzTable).where(eq(healthzTable.id, inserted.id));
      await opts.db.delete(healthzTable).where(eq(healthzTable.id, inserted.id));
      if (!read || read.note !== "healthz") throw new Error("row did not round-trip");
      return { ok: true, db: "roundtrip" };
    } catch (err) {
      req.log.error({ err }, "db health check failed");
      return reply.code(503).send({ ok: false, error: "db" });
    }
  });

  app.get("/healthz/blob", { preHandler: app.requireRealmToken }, async (req, reply) => {
    try {
      await opts.blob.roundTrip();
      return { ok: true, blob: "roundtrip" };
    } catch (err) {
      req.log.error({ err }, "blob health check failed");
      return reply.code(503).send({ ok: false, error: "blob" });
    }
  });
}
