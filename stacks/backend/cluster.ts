import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as command from "@pulumi/command";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { WebService } from "../../src/index.ts";
import { checkHostname } from "../../src/web-service.ts";
import { directusFilesBucket } from "../../src/outputs.ts";
import { appDatabase, appSecret, isDev, loadCluster, secretEnv } from "../../src/app/cluster.ts";
import { dnsRecord } from "../../src/app/cloud.ts";
import { directusEnv, mailEnv } from "./workloads.ts";
import { AUTHENTIK_ACCESS_SECRET } from "./policies.ts";
import { extensionDirs, migrationFiles, type DirectusExtensions } from "./directus-files.ts";
import { directusImage } from "./images.ts";

// Directus on the cluster (cyc-seattle/isthmia#231). Its uploaded files are in a bucket infra makes.

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
  // Only so dev's tests can clean up the frozen Financial Plans they make (docs/planning-schema.md).
  if (extensions.frozenPlans.deletable && !isDev) {
    throw new Error(
      "backend: frozenPlansDeletable is for dev's tests only. A frozen Financial Plan never changes in prod.",
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
  // The website-publish hook's GitHub App key, set by hand in Secret Manager (docs/manual-setup.md §6).
  const publishKey =
    extensions.websitePublish.appId === undefined
      ? undefined
      : gcp.secretmanager
          .getSecretVersionAccessOutput({ secret: "csc-website-publish-key" })
          .apply((version) => version.secretData);
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
    ...(publishKey && { WEBSITE_PUBLISH_PRIVATE_KEY: pulumi.secret(publishKey) }),
  });

  // Directus loads extensions only at start. Unnamed, so a change replaces it under a new name, and
  // the Deployment rolls.
  const mounts = extensionDirs(extensions).map(({ name, files }) => ({
    name,
    configMap: new k8s.core.v1.ConfigMap(
      `directus-${name}`,
      { metadata: { namespace: platform.namespace }, data: files },
      { provider },
    ),
  }));
  const migrations = new k8s.core.v1.ConfigMap(
    "directus-migrations",
    { metadata: { namespace: platform.namespace }, data: migrationFiles() },
    { provider },
  );

  const directus = new WebService("directus", {
    platform,
    provider,
    hostname: `directus.${domain}`,
    image: directusImage,
    port: 8055,
    // Autopilot bills the requests. A sync or a reset bursts toward the CPU limit when the node has room.
    // 500m is Autopilot's least for a pod it won't evict (`safeToEvict: false`, below), as in prod.
    requests: { cpu: config.get("directusCpu") ?? "500m", memory: config.get("directusMemory") ?? "768Mi" },
    limits: { cpu: "1" },
    // Directus 12 answers /server/health only to a signed-in caller, so probes would never pass.
    readinessProbe: { httpGet: { path: "/server/ping", port: 8055 } },
    env: [
      // 10 is Directus's default. Dev's instance allows 50 connections, and Authentik holds up to about
      // 12, so even a rollout's two pods fit. A smaller pool queued the tests' requests past the load
      // balancer's 30 s timeout.
      ...directusEnv({
        domain,
        adminEmail,
        dbHost: db.host,
        communityRoleId,
        oidcClientId,
        poolMax: 10,
        filesBucket: directusFilesBucket(platform.project, pulumi.getStack()),
      }),
      secretEnv("DB_PASSWORD", db.secret, "password"),
      // The contact form's mail (./forms.cjs): the Workspace relay, which admits the cluster's address, or
      // dev's Mailpit, which Authentik runs.
      ...mailEnv(isDev),
      // Dev's tests log every request, more than any other pod; its warnings and errors stay.
      ...(isDev ? [{ name: "LOG_LEVEL", value: "warn" }] : []),
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
      // The `authentik` stack writes it, after this one deploys. A mounted Secret follows its changes, so
      // the group-policies hook picks it up without a restart.
      {
        name: "authentik-access",
        mountPath: extensions.groupPolicies.authentikDir,
        secret: AUTHENTIK_ACCESS_SECRET,
        optional: true,
        readOnly: true,
      },
    ],
    // The image's user is `node`, a name, which runAsNonRoot can't check.
    runAsUser: 1000,
    // A second replica would need Redis to share its schema and permission caches, so this keeps
    // Autopilot from moving the one it has to consolidate nodes (cyc-seattle/isthmia#253).
    ...(config.getBoolean("safeToEvict") === false && {
      podAnnotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
    }),
  });

  // The website's forms post to <formsHostname>/forms/, on the public domain, and Listmonk serves the rest
  // of that address (cyc-seattle/csc-website#9). The longer path wins.
  new k8s.apiextensions.CustomResource(
    "directus-forms",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: "directus-forms", namespace: platform.namespace },
      spec: {
        parentRefs: [{ name: platform.gateway.name, namespace: platform.gateway.namespace }],
        hostnames: [checkHostname(extensions.formsHostname, platform.domain)],
        rules: [
          {
            matches: [{ path: { type: "PathPrefix", value: "/forms/" } }],
            backendRefs: [{ name: "directus", port: 80 }],
          },
        ],
      },
    },
    { provider, dependsOn: directus },
  );

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
        directusImage,
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
