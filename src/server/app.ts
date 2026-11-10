import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin, type AuthOptions } from "./auth.js";
import { healthRoutes } from "./routes/health.js";
import { entityRoutes } from "./routes/entities.js";
import { uploadRoutes } from "./routes/uploads.js";
import { staticRoutes } from "./static.js";
import type { BlobStore } from "./blob.js";
import type { Db } from "./db/client.js";

export type PublicConfig = { keycloakUrl: string; realm: string; clientId: string };

export type AppOptions = {
  logLevel?: string;
  auth: AuthOptions;
  db: Db;
  blob: BlobStore;
  /** Azure Front Door ID. When non-empty, requests must carry a matching X-Azure-FDID header. */
  frontdoorId?: string;
  /** Public Keycloak settings the browser needs to start sign in. Served at GET /api/config. */
  publicConfig: PublicConfig;
  /** Directory holding the built web app. Omit in tests and in dev (Vite serves the web app). */
  serveWeb?: string;
};

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  // Fastify's logger is pino: one JSON object per line, which Log Analytics parses as structured fields.
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization"],
    },
  });

  const frontdoorId = opts.frontdoorId ?? "";
  if (frontdoorId) {
    app.addHook("onRequest", async (req, reply) => {
      // Container Apps health probes hit the container directly, not through Front Door,
      // so they never carry X-Azure-FDID. Exempt exactly /healthz (query string ignored)
      // so probes pass. Nothing else is exempt, including /healthz/db, /healthz/blob, /healthz/auth.
      if (req.url.split("?")[0] === "/healthz") return;
      if (req.headers["x-azure-fdid"] !== frontdoorId) {
        return reply.code(403).send({ error: "forbidden" });
      }
    });
  }

  await app.register(authPlugin, opts.auth);
  app.get("/api/config", async () => opts.publicConfig);
  await app.register(healthRoutes, { db: opts.db, blob: opts.blob });
  await app.register(entityRoutes, { db: opts.db, prefix: "/api" });
  await app.register(uploadRoutes, { blob: opts.blob, prefix: "/api" });
  if (opts.serveWeb) await app.register(staticRoutes, { root: opts.serveWeb });
  return app;
}
