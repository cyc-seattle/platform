import { describe, expect, it } from "vitest";
import { authentikEnv, loginRedirectRoute, TRUSTED_PROXY_CIDRS } from "../stacks/authentik/workloads.ts";

function envMap(env: { name: unknown; value?: unknown }[]): Record<string, unknown> {
  return Object.fromEntries(env.map(({ name, value }) => [name, value]));
}

describe("authentikEnv", () => {
  const dbPassword = { name: "AUTHENTIK_POSTGRESQL__PASSWORD", valueFrom: { secretKeyRef: { name: "s", key: "k" } } };

  it("sends mail to Mailpit without TLS", () => {
    const env = envMap(
      authentikEnv({
        dbHost: "10.0.0.5",
        dbPassword,
        smtp: { host: "mailpit", port: 1025, useTls: false },
        connMaxAge: 0,
      }),
    );

    expect(env).toMatchObject({
      AUTHENTIK_POSTGRESQL__HOST: "10.0.0.5",
      AUTHENTIK_EMAIL__HOST: "mailpit",
      AUTHENTIK_EMAIL__PORT: "1025",
      AUTHENTIK_EMAIL__USE_TLS: "false",
      AUTHENTIK_POSTGRESQL__CONN_MAX_AGE: "0",
    });
    expect(env).not.toHaveProperty("AUTHENTIK_POSTGRESQL__CONN_HEALTH_CHECKS");
  });

  it("checks a kept connection before reusing it", () => {
    const env = envMap(
      authentikEnv({
        dbHost: "10.0.0.5",
        dbPassword,
        smtp: { host: "mailpit", port: 1025, useTls: false },
        connMaxAge: 60,
      }),
    );

    expect(env).toMatchObject({
      AUTHENTIK_POSTGRESQL__CONN_MAX_AGE: "60",
      AUTHENTIK_POSTGRESQL__CONN_HEALTH_CHECKS: "true",
    });
  });

  it("trusts the load balancer's proxies", () => {
    expect(TRUSTED_PROXY_CIDRS.split(",")).toEqual(expect.arrayContaining(["35.191.0.0/16", "130.211.0.0/22"]));
  });
});

describe("loginRedirectRoute", () => {
  it("sends / and /if/user/ to sail-team's home page", () => {
    const route = loginRedirectRoute({ name: "gateway", namespace: "infra" }, "dev.example.com");

    expect(route.hostnames).toEqual(["login.dev.example.com"]);
    expect(route.rules.map((rule) => rule.matches[0]?.path)).toEqual([
      { type: "Exact", value: "/" },
      { type: "Exact", value: "/if/user/" },
    ]);
    for (const rule of route.rules) {
      expect(rule.filters[0]?.requestRedirect).toEqual({
        scheme: "https",
        hostname: "dev.example.com",
        path: { type: "ReplaceFullPath", replaceFullPath: "/" },
        statusCode: 302,
      });
    }
  });
});
