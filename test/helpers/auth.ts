import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";

export type TokenOverrides = {
  /** A string sets the audience, null leaves it out. Default is the API audience. */
  audience?: string | null;
  /** Mint the token under a different issuer. */
  issuer?: string;
};

export type TestIssuer = {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
  token: (roles: string[], sub?: string, overrides?: TokenOverrides) => Promise<string>;
};

// A throwaway RSA key pair stands in for Keycloak. The app verifies against the same JWKS it would fetch from the realm.
export async function testIssuer(): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const issuer = "http://localhost:8080/realms/test";
  const audience = "api";
  return {
    issuer,
    audience,
    getKey: createLocalJWKSet({ keys: [jwk] }),
    token: (roles, sub = "user-1", overrides = {}) => {
      const jwt = new SignJWT({ realm_access: { roles }, name: "Test User", email: "test@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(overrides.issuer ?? issuer)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("5m");
      const aud = overrides.audience === undefined ? audience : overrides.audience;
      if (aud !== null) jwt.setAudience(aud);
      return jwt.sign(privateKey);
    },
  };
}
