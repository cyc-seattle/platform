import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import type { DirectusOnCluster } from "./cluster.ts";

/**
 * The Directus scripts/ci-stack runs in containers, at `backend:localUrl`. It starts Directus with the
 * same admin password and Community role this reads from config, so nothing here creates them.
 */
export async function localDirectus(): Promise<DirectusOnCluster> {
  const config = new pulumi.Config();
  const baseUrl = config.require("localUrl");
  const ready = new command.local.Command("directus-ready", {
    create: 'curl -fsS -o /dev/null --retry 60 --retry-delay 2 --retry-all-errors "$DIRECTUS_URL/server/ping"',
    environment: { DIRECTUS_URL: baseUrl },
  });
  return {
    baseUrl,
    adminPassword: config.requireSecret("localAdminPassword"),
    communityRoleId: pulumi.output(config.require("communityRoleId")),
    oidcClientId: pulumi.output("none"),
    oidcClientSecret: pulumi.secret("none"),
    ready,
  };
}
