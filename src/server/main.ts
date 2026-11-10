import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet } from "jose";
import { buildApp } from "./app.js";
import { readEnv } from "./env.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createBlobStore } from "./blob.js";

const env = readEnv();
const plan = JSON.parse(readFileSync(new URL("../../plan.json", import.meta.url), "utf8")) as { slug: string; productName: string };

const realm = env.keycloakRealm ?? plan.slug;
const issuer = `${env.keycloakUrl}/realms/${realm}`;
// Keys are fetched from the realm's JWKS endpoint and cached by jose. The issuer claim must match the public URL.
const getKey = createRemoteJWKSet(new URL(`${env.keycloakJwksUrl}/realms/${realm}/protocol/openid-connect/certs`));

if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
  await runMigrations(env.db);
}

const { db, sql } = createDb(env.db);
const blob = createBlobStore({ accountName: env.storageAccountName, blobEndpoint: env.storageBlobEndpoint, containerName: env.storageContainer, connectionString: env.storageConnectionString });
await blob.ensureLocal();

const app = await buildApp({
  logLevel: env.logLevel,
  db,
  blob,
  frontdoorId: env.frontdoorId,
  auth: { issuer, audience: "api", getKey },
  publicConfig: { keycloakUrl: env.keycloakUrl, realm, clientId: "web" },
  serveWeb: fileURLToPath(new URL("../web/", import.meta.url)),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.port, host: "0.0.0.0" });
app.log.info({ product: plan.productName, realm }, "started");
