import Keycloak from "keycloak-js";

type PublicConfig = { keycloakUrl: string; realm: string; clientId: string };

let keycloak: Keycloak | null = null;

export async function initAuth(): Promise<Keycloak> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`config failed: ${res.status}`);
  const cfg = (await res.json()) as PublicConfig;
  keycloak = new Keycloak({ url: cfg.keycloakUrl, realm: cfg.realm, clientId: cfg.clientId });
  // Authorization Code with PKCE S256. Tokens stay in memory. login-required sends anonymous visitors to the branded login page.
  await keycloak.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false });
  return keycloak;
}

export async function getToken(): Promise<string> {
  if (!keycloak) throw new Error("auth not initialised");
  await keycloak.updateToken(30);
  return keycloak.token ?? "";
}

export function currentUser(): { name: string; roles: string[] } {
  const parsed = keycloak?.tokenParsed as { name?: string; preferred_username?: string; realm_access?: { roles?: string[] } } | undefined;
  return { name: parsed?.name ?? parsed?.preferred_username ?? "", roles: parsed?.realm_access?.roles ?? [] };
}

export function signOut(): void {
  void keycloak?.logout({ redirectUri: window.location.origin });
}
