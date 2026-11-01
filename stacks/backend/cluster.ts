import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as command from "@pulumi/command";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { WebService } from "../../src/index.ts";
import { appDatabase, appSecret, isDev, loadCluster, secretEnv } from "../../src/app/cluster.ts";
import { dnsRecord } from "../../src/app/cloud.ts";
import { directusEnv } from "./workloads.ts";
import type { GroupPoliciesConfig, QueryGuardConfig, SavedVersionsConfig } from "./policies.ts";

// Directus on the cluster (cyc-seattle/isthmia#231). Its uploads are ephemeral, as on the VM.

const image = "directus/directus:12.3.1";

export interface DirectusOnCluster {
  baseUrl: string;
  adminPassword: pulumi.Output<string>;
  /** Directus names it as the default role at start, before `backend` creates the role with this ID. */
  communityRoleId: pulumi.Output<string>;
  /** Directus's client at Authentik, which Authentik registers from this stack's outputs. */
  oidcClientId: pulumi.Output<string>;
  oidcClientSecret: pulumi.Output<string>;
  /** Resolves once Directus answers at `baseUrl`. */
  ready: pulumi.Resource;
}

/** Prod's values, which Directus had on the VM (./prod-state.ts). */
export interface ExistingDirectus {
  key: pulumi.Output<string>;
  secret: pulumi.Output<string>;
  dbPassword: pulumi.Output<string>;
  adminPassword: pulumi.Output<string>;
  communityRoleId: pulumi.Output<string>;
  oidcClientId: pulumi.Output<string>;
  oidcClientSecret: pulumi.Output<string>;
}

function generated(name: string, length: number): pulumi.Output<string> {
  return new random.RandomPassword(name, { length, special: false }).result;
}

/** The configs of the hook extensions Directus loads (./policies.ts). */
export interface DirectusExtensions {
  queryGuard: QueryGuardConfig;
  groupPolicies: GroupPoliciesConfig;
  savedVersions: SavedVersionsConfig;
  /** The planning engine's modules, which the saved-versions hook loads (./engine-files.ts). */
  engine: Record<string, string>;
}

/**
 * `licensed` false runs Directus on its unlicensed Core tier, with no `LICENSE_KEY`. Given `existing`,
 * Directus keeps prod's keys, database, Community role, and OIDC client; otherwise this generates
 * its own.
 */
export async function deployDirectus(
  adminEmail: string,
  licensed: boolean,
  extensions: DirectusExtensions,
  existing?: ExistingDirectus,
): Promise<DirectusOnCluster> {
  // Only so dev's tests can clean up the saved plan versions they make (docs/planning-schema.md).
  if (extensions.savedVersions.deletable && !isDev) {
    throw new Error(
      "backend: savedVersionsDeletable is for dev's tests only. A saved plan version never changes in prod.",
    );
  }
  const config = new pulumi.Config();
  const cluster = await loadCluster();
  const { platform, provider } = cluster;
  const domain = platform.domain;
  const baseUrl = `https://directus.${domain}`;

  const db = appDatabase(cluster, "directus", existing?.dbPassword);
  const adminPassword = existing ? existing.adminPassword : generated("directus-admin-password", 32);
  const communityRoleId = existing
    ? existing.communityRoleId
    : new random.RandomUuid("directus-community-role-id").result;
  // Set by hand in Secret Manager; dev's has its own name (cyc-seattle/isthmia#172). The Access variant needs only the
  // accessor role, which is all deploy-dev holds.
  const licenseKey = licensed
    ? gcp.secretmanager
        .getSecretVersionAccessOutput({ secret: `${isDev ? "dev-" : ""}directus-license-key` })
        .apply((version) => version.secretData)
    : undefined;
  const oidcClientId = existing
    ? existing.oidcClientId
    : new random.RandomString("directus-oidc-client-id", { length: 40, special: false }).result;
  const oidcClientSecret = pulumi.secret(
    existing ? existing.oidcClientSecret : generated("directus-oidc-client-secret", 64),
  );

  const secret = appSecret(cluster, "directus", {
    KEY: existing ? existing.key : generated("directus-key", 64),
    SECRET: existing ? existing.secret : generated("directus-secret", 64),
    ADMIN_PASSWORD: adminPassword,
    ...(licenseKey && { LICENSE_KEY: pulumi.secret(licenseKey) }),
    AUTH_AUTHENTIK_CLIENT_SECRET: oidcClientSecret,
  });

  // Directus loads extensions only at start. Unnamed, so a change replaces it under a new name, and
  // the Deployment rolls.
  const extension = (name: string, type: "hook" | "display", source: string, files: Record<string, string> = {}) => {
    const configMap = new k8s.core.v1.ConfigMap(
      `directus-${name}`,
      {
        metadata: { namespace: platform.namespace },
        data: {
          "package.json": JSON.stringify({
            name,
            version: "1.0.0",
            "directus:extension": { type, path: "index.js", source: "index.js", host: "^12.0.0" },
          }),
          "index.js": fs.readFileSync(path.resolve(import.meta.dirname, source), "utf8"),
          ...files,
        },
      },
      { provider },
    );
    return { name, configMap };
  };
  const hook = (name: string, source: string, config: object, files: Record<string, string> = {}) =>
    extension(name, "hook", source, { "config.json": JSON.stringify(config), ...files });
  const mounts = [
    hook("community-query-guard", "community-query-guard.cjs", extensions.queryGuard),
    hook("group-policies", "group-policies.cjs", extensions.groupPolicies),
    hook("saved-versions", "saved-versions.cjs", extensions.savedVersions, extensions.engine),
    extension("cents-as-dollars", "display", "cents-display.mjs"),
  ];
  // Directus runs each migration it hasn't recorded at start, before it serves.
  const migrationsDir = path.resolve(import.meta.dirname, "migrations");
  const migrations = new k8s.core.v1.ConfigMap(
    "directus-migrations",
    {
      metadata: { namespace: platform.namespace },
      data: Object.fromEntries(
        fs
          .readdirSync(migrationsDir)
          .filter((file) => file.endsWith(".cjs"))
          .map((file) => [file, fs.readFileSync(path.join(migrationsDir, file), "utf8")]),
      ),
    },
    { provider },
  );

  const directus = new WebService("directus", {
    platform,
    provider,
    hostname: `directus.${domain}`,
    image,
    port: 8055,
    // A sync after a reset pins Directus at 250m. Each stack can raise it within its namespace quota.
    requests: { cpu: config.get("directusCpu") ?? "250m", memory: config.get("directusMemory") ?? "768Mi" },
    // Directus 12 answers /server/health only to a signed-in caller, so probes would never pass.
    readinessProbe: { httpGet: { path: "/server/ping", port: 8055 } },
    env: [
      // dev's db-f1-micro allows about 25 connections across Authentik, Directus, and Parse. Prod's
      // db-g1-small allows about 50, and 10 is Directus's default, as on the VM.
      ...directusEnv({ domain, adminEmail, dbHost: db.host, communityRoleId, oidcClientId, poolMax: isDev ? 4 : 10 }),
      secretEnv("DB_PASSWORD", db.secret, "password"),
    ],
    envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
    // Where Directus writes: pm2's state, uploads, and the bundled app extensions.
    volumes: [
      { name: "pm2", mountPath: "/home/node/.pm2", emptyDir: {} },
      { name: "uploads", mountPath: "/directus/uploads", emptyDir: { sizeLimit: "1Gi" } },
      { name: "extensions", mountPath: "/directus/node_modules/.directus", emptyDir: {} },
      ...mounts.map(({ name, configMap }) => ({
        name,
        mountPath: `/directus/extensions/${name}`,
        configMap: configMap.metadata.name,
        readOnly: true,
      })),
      { name: "migrations", mountPath: "/directus/migrations", configMap: migrations.metadata.name, readOnly: true },
    ],
    // The image's user is `node`, a name, which runAsNonRoot can't check.
    runAsUser: 1000,
    // A second replica would need Redis to share its schema and permission caches, so this keeps
    // Autopilot from moving the one it has to consolidate nodes (cyc-seattle/isthmia#253).
    ...(config.getBoolean("safeToEvict") === false && {
      podAnnotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
    }),
  });

  // Dev's hostnames fall under platform's wildcard record. Prod's moves from the VM (./prod-state.ts).
  const record = isDev ? [] : [dnsRecord("directus-a", `directus.${domain}`, platform.gatewayAddress)];

  // The load balancer takes minutes to admit a new route, longer than the Directus resources wait. In
  // prod, the record moves in the same update, so this also waits out the old answer's TTL.
  const ready = new command.local.Command(
    "directus-ready",
    {
      create: 'curl -fsS -o /dev/null --retry 90 --retry-delay 10 --retry-all-errors "$DIRECTUS_URL/server/ping"',
      environment: { DIRECTUS_URL: baseUrl },
      // A changed Secret replaces the Deployment too, so Directus restarts.
      triggers: [
        image,
        secret.metadata.uid,
        migrations.metadata.uid,
        ...mounts.map(({ configMap }) => configMap.metadata.uid),
      ],
    },
    { dependsOn: [directus, ...record] },
  );

  return {
    baseUrl,
    adminPassword: pulumi.secret(adminPassword),
    communityRoleId,
    oidcClientId,
    oidcClientSecret,
    ready,
  };
}
