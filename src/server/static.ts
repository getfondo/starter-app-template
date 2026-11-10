import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

// Serves the Vite build. Any GET that is not an API or health path gets index.html so client-side routes deep-link.
export async function staticRoutes(app: FastifyInstance, opts: { root: string }): Promise<void> {
  await app.register(fastifyStatic, { root: opts.root, wildcard: false, index: ["index.html"] });
  app.setNotFoundHandler(async (req, reply) => {
    const isApi = req.url.startsWith("/api") || req.url.startsWith("/healthz");
    if (req.method === "GET" && !isApi) return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send({ error: "not_found" });
  });
}
