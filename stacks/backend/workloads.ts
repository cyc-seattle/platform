import type * as pulumi from "@pulumi/pulumi";
import type * as k8s from "@pulumi/kubernetes";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/** Where an MCP client's metadata document and redirects may live: Claude's. Loopback redirects, which
 * desktop clients use, are always allowed. */
export const MCP_CLIENT_DOMAINS = ["claude.ai", "claude.com"];

// A pure builder for the on-cluster Directus (./cluster.ts), testable without Pulumi.

export interface DirectusEnvArgs {
  domain: string;
  adminEmail: string;
  dbHost: string;
  communityRoleId: pulumi.Input<string>;
  oidcClientId: pulumi.Input<string>;
  /** The most connections Directus holds open. */
  poolMax: number;
}

/** Directus's env, as in the VM's compose file, without the secrets. */
export function directusEnv({
  domain,
  adminEmail,
  dbHost,
  communityRoleId,
  oidcClientId,
  poolMax,
}: DirectusEnvArgs): EnvVar[] {
  const site = `https://${domain}`;
  const values: Record<string, pulumi.Input<string>> = {
    DB_CLIENT: "pg",
    DB_HOST: dbHost,
    DB_PORT: "5432",
    DB_DATABASE: "directus",
    DB_USER: "directus",
    DB_POOL__MIN: "0",
    DB_POOL__MAX: String(poolMax),
    ADMIN_EMAIL: adminEmail,
    PUBLIC_URL: `https://directus.${domain}`,
    // The built-in admin is the break-glass login if Authentik is down (cyc-seattle/isthmia#166).
    AUTH_PROVIDERS: "authentik",
    AUTH_AUTHENTIK_DRIVER: "openid",
    AUTH_AUTHENTIK_CLIENT_ID: oidcClientId,
    AUTH_AUTHENTIK_ISSUER_URL: `https://login.${domain}/application/o/directus/`,
    AUTH_AUTHENTIK_IDENTIFIER_KEY: "email",
    // The portal's roster calls Directus with fetch, which needs a session cookie, not a refresh token.
    AUTH_AUTHENTIK_MODE: "session",
    AUTH_AUTHENTIK_ALLOW_PUBLIC_REGISTRATION: "true",
    AUTH_AUTHENTIK_DEFAULT_ROLE_ID: communityRoleId,
    AUTH_AUTHENTIK_REDIRECT_ALLOW_LIST: site,
    CORS_ENABLED: "true",
    CORS_ORIGIN: site,
    CORS_CREDENTIALS: "true",
    // The settings in ./index.ts turn MCP on as well (docs/mcp.md). A client registers by its metadata
    // document, never dynamically.
    MCP_OAUTH_ENABLED: "true",
    MCP_OAUTH_CIMD_ENABLED: "true",
    MCP_OAUTH_DCR_ENABLED: "false",
    MCP_OAUTH_CIMD_ALLOWED_DOMAINS: MCP_CLIENT_DOMAINS.join(","),
    MCP_OAUTH_ALLOWED_REDIRECT_DOMAINS: MCP_CLIENT_DOMAINS.join(","),
    // Empty allows no custom-scheme redirect, such as Cursor's, which Directus allows by default.
    MCP_OAUTH_ALLOWED_CUSTOM_REDIRECTS: "",
  };
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
