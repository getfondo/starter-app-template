import fp from "fastify-plugin";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type AuthUser = { sub: string; roles: string[]; name?: string; email?: string };
export type AuthOptions = { issuer: string; audience: string; getKey: JWTVerifyGetKey };

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    userType: string | null;
    /** True when the bearer token has a valid signature and issuer, from any client of the realm. */
    realmTokenValid: boolean;
  }
  interface FastifyInstance {
    /** Requires a token for the `api` audience. Use for user routes. */
    requireUser: PreHandler;
    /** Requires a valid realm token from any client (audience not checked). Use for post-deploy health checks. */
    requireRealmToken: PreHandler;
  }
}

// Source for jwtVerify with a JWKS getter: https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md
export const authPlugin = fp(async (app: FastifyInstance, opts: AuthOptions) => {
  app.decorateRequest("user", null);
  app.decorateRequest("userType", null);
  app.decorateRequest("realmTokenValid", false);

  app.addHook("onRequest", async (req) => {
    req.user = null;
    req.realmTokenValid = false;
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return;
    try {
      // Signature, expiry and issuer are checked here. The audience is checked below, so that
      // service-account tokens (which do not carry the `api` audience) still count as realm tokens.
      const { payload } = await jwtVerify(header.slice("Bearer ".length), opts.getKey, { issuer: opts.issuer });
      req.realmTokenValid = true;
      const aud = payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(opts.audience)) return;
      const realmAccess = payload["realm_access"] as { roles?: string[] } | undefined;
      req.user = {
        sub: payload.sub ?? "",
        roles: realmAccess?.roles ?? [],
        name: typeof payload["name"] === "string" ? payload["name"] : undefined,
        email: typeof payload["email"] === "string" ? payload["email"] : undefined,
      };
    } catch (err) {
      req.log.warn({ err }, "bearer token rejected");
    }
  });

  app.decorate("requireUser", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    return undefined;
  });

  app.decorate("requireRealmToken", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.realmTokenValid) return reply.code(401).send({ error: "unauthenticated" });
    return undefined;
  });
});
