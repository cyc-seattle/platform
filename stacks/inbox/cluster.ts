import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as command from "@pulumi/command";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { WebService } from "../../src/index.ts";
import { appDatabase, appSecret, deployedImage, inputsTag, loadCluster, secretEnv } from "../../src/app/cluster.ts";
import { dnsRecord } from "../../src/app/cloud.ts";
import { Secret } from "../../src/app/secret.ts";

// FreeScout on the cluster (cyc-seattle/platform#182): its database and its disk. Our own image
// (./image) runs it as www-data on a read-only root filesystem.

/** The image's www-data, by number. */
const WWW_DATA = 82;

export const imageTag = inputsTag(path.join(import.meta.dirname, "image"), ["."]);

export interface InboxOnCluster {
  url: string;
  /** FreeScout's client at Authentik, which Authentik registers from this stack's outputs. */
  oidcClientId: pulumi.Output<string>;
  oidcClientSecret: pulumi.Output<string>;
  adminPassword: pulumi.Output<string>;
}

function generated(name: string, length: number): pulumi.Output<string> {
  return new random.RandomPassword(name, { length, special: false }).result;
}

/** Keeps a generated value in Secret Manager too, for a restore or a break-glass sign-in. */
function keepCopy(name: string, value: pulumi.Output<string>): void {
  const secret = new Secret(name);
  new gcp.secretmanager.SecretVersion(`${name}-version`, { secret: secret.id, secretData: value }, { parent: secret });
}

export async function deployInbox(adminEmail: string, mailFrom: string): Promise<InboxOnCluster> {
  const cluster = await loadCluster();
  const { platform, provider } = cluster;
  const hostname = `inbox.${platform.domain}`;
  const url = `https://${hostname}`;

  const db = appDatabase(cluster, "inbox");
  // Laravel's key. It encrypts each mailbox's sign-in in the database, so a restore needs it.
  const appKey = pulumi.secret(
    new random.RandomBytes("inbox-app-key", { length: 32 }).base64.apply((key) => `base64:${key}`),
  );
  keepCopy("inbox-app-key", appKey);
  const adminPassword = pulumi.secret(generated("inbox-admin-password", 32));
  keepCopy("inbox-admin-password", adminPassword);
  // Set by hand: the licence keys of FreeScout's OAuth & Social Login and API & Webhooks modules, kept
  // for a rebuild (docs/manual-setup.md §11).
  new Secret("inbox-oauth-licence");
  new Secret("inbox-api-licence");
  const oidcClientId = new random.RandomString("inbox-oidc-client-id", { length: 40, special: false }).result;
  const oidcClientSecret = pulumi.secret(generated("inbox-oidc-client-secret", 64));

  const secret = appSecret(cluster, "inbox", { APP_KEY: appKey, INBOX_ADMIN_PASSWORD: adminPassword });

  // Attachments and installed modules. A pod's own disk loses them on every restart. Protected, so
  // no deploy deletes it: the storage class deletes the disk with the claim.
  const data = new k8s.core.v1.PersistentVolumeClaim(
    "inbox-data",
    {
      metadata: {
        name: "inbox-data",
        namespace: platform.namespace,
        // The class binds a claim only once a pod uses it, so waiting for it here never ends.
        annotations: { "pulumi.com/skipAwait": "true" },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: "standard-rwo",
        resources: { requests: { storage: "10Gi" } },
      },
    },
    { provider, protect: true },
  );

  const image = await deployedImage(cluster, "freescout", { context: "image", tag: imageTag });

  const service = new WebService("inbox", {
    platform,
    provider,
    hostname,
    image,
    port: 8080,
    // It averages under 50m; the limit covers its migrations and cron (#171).
    requests: { cpu: "100m", memory: "512Mi" },
    limits: { cpu: "500m" },
    readinessProbe: { httpGet: { path: "/login", port: 8080 }, periodSeconds: 30, timeoutSeconds: 10 },
    // FreeScout answers 403 to any other Host (GHSA-822g-7rw5-53xj).
    checksHost: true,
    // It migrates the database before it serves.
    progressDeadlineSeconds: 1200,
    recreate: true,
    runAsUser: WWW_DATA,
    fsGroup: WWW_DATA,
    env: [
      { name: "APP_URL", value: url },
      // The name FreeScout greets SMTP servers with. Google's relay refuses an IP address.
      { name: "SERVER_NAME", value: hostname },
      // FreeScout's own log file would fill the disk; this sends it to the pod's log.
      { name: "APP_LOG", value: "errorlog" },
      // The Gateway's load balancer is the only way in.
      { name: "APP_TRUSTED_PROXIES", value: "**" },
      { name: "SESSION_SECURE_COOKIE", value: "true" },
      { name: "DB_CONNECTION", value: "pgsql" },
      { name: "DB_HOST", value: db.host },
      { name: "DB_PORT", value: "5432" },
      { name: "DB_DATABASE", value: db.name },
      { name: "DB_USERNAME", value: db.name },
      secretEnv("DB_PASSWORD", db.secret, "password"),
      { name: "INBOX_ADMIN_EMAIL", value: adminEmail },
      { name: "INBOX_COMPANY_NAME", value: "CYC Community Sailing Center" },
      { name: "INBOX_MAIL_FROM", value: mailFrom },
      // Where FreeScout sends its own mail, such as notifications. Each mailbox sets its own in the UI.
      { name: "INBOX_SMTP_HOST", value: "smtp-relay.gmail.com" },
      { name: "INBOX_SMTP_PORT", value: "587" },
      { name: "INBOX_SMTP_ENCRYPTION", value: "tls" },
    ],
    envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
    volumes: [
      { name: "data", mountPath: "/data", persistentVolumeClaim: data.metadata.name },
      { name: "cache", mountPath: "/cache", emptyDir: {} },
      { name: "tmp", mountPath: "/tmp", emptyDir: {} },
    ],
  });

  const record = [dnsRecord("inbox-a", hostname, platform.gatewayAddress)];

  // The load balancer takes minutes to admit a new route. Waiting for the pod first keeps the
  // migrations out of these 15 minutes.
  new command.local.Command(
    "inbox-ready",
    {
      create: 'curl -fsS -o /dev/null --retry 90 --retry-delay 10 --retry-all-errors "$INBOX_URL/login"',
      environment: { INBOX_URL: url },
      triggers: [image, secret.metadata.uid],
    },
    { dependsOn: [service, ...record] },
  );

  return { url, oidcClientId, oidcClientSecret, adminPassword };
}
