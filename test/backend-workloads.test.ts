import { describe, expect, it } from "vitest";
import { directusEnv } from "../stacks/backend/workloads.ts";
import { databaseSecretName, databaseUri } from "../src/app/cluster.ts";

function envMap(env: { name: unknown; value?: unknown }[]): Record<string, unknown> {
  return Object.fromEntries(env.map(({ name, value }) => [name, value]));
}

describe("directusEnv", () => {
  const env = envMap(
    directusEnv({
      domain: "dev.example.com",
      adminEmail: "admin@example.com",
      dbHost: "10.0.0.5",
      communityRoleId: "r",
      oidcClientId: "client",
      poolMax: 7,
    }),
  );

  it("points Directus at its hostnames and the default role", () => {
    expect(env).toMatchObject({
      PUBLIC_URL: "https://directus.dev.example.com",
      AUTH_AUTHENTIK_CLIENT_ID: "client",
      AUTH_AUTHENTIK_ISSUER_URL: "https://login.dev.example.com/application/o/directus/",
      AUTH_AUTHENTIK_DEFAULT_ROLE_ID: "r",
      CORS_ORIGIN: "https://dev.example.com",
      AUTH_AUTHENTIK_REDIRECT_ALLOW_LIST: "https://dev.example.com",
      DB_HOST: "10.0.0.5",
      DB_POOL__MAX: "7",
    });
  });

  it("lets only Claude's MCP clients register, by metadata document", () => {
    expect(env).toMatchObject({
      MCP_OAUTH_ENABLED: "true",
      MCP_OAUTH_CIMD_ENABLED: "true",
      MCP_OAUTH_DCR_ENABLED: "false",
      MCP_OAUTH_CIMD_ALLOWED_DOMAINS: "claude.ai,claude.com",
      MCP_OAUTH_ALLOWED_REDIRECT_DOMAINS: "claude.ai,claude.com",
      MCP_OAUTH_ALLOWED_CUSTOM_REDIRECTS: "",
    });
  });
});

describe("databaseUri", () => {
  it("escapes the password", () => {
    expect(databaseUri("10.0.0.5", "clubspot_fake", "p@ss/w:rd")).toBe(
      "postgres://clubspot_fake:p%40ss%2Fw%3Ard@10.0.0.5:5432/clubspot_fake",
    );
  });
});

describe("databaseSecretName", () => {
  it("replaces underscores, which Kubernetes names can't hold", () => {
    expect(databaseSecretName("clubspot_fake")).toBe("clubspot-fake-db");
  });
});
