import crypto from "node:crypto";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { WebService } from "../../src/index.ts";
import { listmonkMediaBucket } from "../../src/outputs.ts";
import { appDatabase, appSecret, isDev, loadCluster, secretEnv } from "../../src/app/cluster.ts";
import {
  ACCESS_SYNC,
  listmonkSettings,
  settingsSql,
  TESTS,
  type ApiLogin,
  type Media,
  type SmtpServer,
} from "./settings.ts";

// Listmonk, the newsletter (cyc-seattle/platform#180). Prod sends through SES, whose identity and SMTP
// user `infra` makes; dev sends to the Mailpit `authentik` runs. `authentik` registers its sign-in.

const image = "listmonk/listmonk:v6.2.0";
const port = 9000;

const config = new pulumi.Config();
const hostname = config.require("hostname");
const rootUrl = `https://${hostname}`;

/** A JSON secret `infra` keeps in Secret Manager. */
function secretJson<T>(secret: string): pulumi.Output<T> {
  const value = gcp.secretmanager
    .getSecretVersionAccessOutput({ secret })
    .apply((version) => JSON.parse(version.secretData) as unknown);
  return pulumi.secret(value) as pulumi.Output<T>;
}

async function deploy() {
  const cluster = await loadCluster();
  const { platform, provider } = cluster;
  const db = appDatabase(cluster, "listmonk");

  const adminPassword = new random.RandomPassword("listmonk-admin-password", { length: 32, special: false }).result;
  const clientId = new random.RandomString("listmonk-oidc-client-id", { length: 40, special: false }).result;
  const clientSecret = new random.RandomPassword("listmonk-oidc-client-secret", { length: 64, special: false }).result;
  const listUuid = pulumi.output(config.require("listId"));
  const token = (name: string) => new random.RandomPassword(name, { length: 48, special: false }).result;
  // Each API login's token; the tests' only in dev.
  const logins: { login: ApiLogin; secret: string; token: pulumi.Output<string> }[] = [
    { login: ACCESS_SYNC, secret: "listmonk-access-sync", token: token("listmonk-access-sync-token") },
    ...(isDev ? [{ login: TESTS, secret: "listmonk-tests", token: token("listmonk-tests-token") }] : []),
  ];
  const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

  // Until `infra` has made SES's login (docs/manual-setup.md §12), prod sends through the Workspace relay,
  // which admits the cluster by its address and suits a few confirmation emails, not the newsletter.
  const ses = config.getBoolean("ses") ?? false;
  const smtp: pulumi.Output<SmtpServer> = isDev
    ? pulumi.output({ host: "mailpit", port: 1025, tls: "none" as const, username: "", password: "" })
    : !ses
      ? pulumi.output({ host: "smtp-relay.gmail.com", port: 587, tls: "STARTTLS" as const, username: "", password: "" })
      : secretJson<{ username: string; password: string }>("listmonk-ses-smtp").apply(({ username, password }) => ({
          host: "email-smtp.us-west-2.amazonaws.com",
          port: 587,
          tls: "STARTTLS" as const,
          username,
          password,
        }));

  // Dev's pictures are made up, so they live in the pod and go with it.
  // Prod's bucket and its key come from `bootstrap`, so until it's applied, prod's are in the pod too.
  const mediaInPod = isDev || !(config.getBoolean("mediaBucket") ?? false);
  const media: pulumi.Output<Media> = mediaInPod
    ? pulumi.output({ provider: "filesystem" as const })
    : secretJson<{ accessId: string; secret: string }>("listmonk-media-hmac").apply(({ accessId, secret }) => ({
        provider: "s3" as const,
        bucket: listmonkMediaBucket(platform.project),
        accessKeyId: accessId,
        secretAccessKey: secret,
      }));

  const sql = pulumi
    .all([smtp, media, clientId, clientSecret, listUuid, pulumi.all(logins.map((l) => l.token))])
    .apply(([smtp, media, id, secret, uuid, tokens]) =>
      settingsSql(
        listmonkSettings({
          rootUrl,
          fromEmail: config.require("fromEmail"),
          smtp,
          oidcIssuer: `https://login.${platform.domain}/application/o/listmonk/`,
          oidcClientId: id,
          oidcClientSecret: secret,
          trustedUrls: config.requireObject<string[]>("trustedUrls"),
          media,
          sesBounces: ses,
        }),
        uuid,
        logins.map(({ login }, i) => ({ login, tokenHash: sha256(tokens[i]!) })),
      ),
    );

  // Unnamed, so a change replaces it under a new name, and the Deployment rolls to write it.
  const settings = new k8s.core.v1.Secret(
    "listmonk-settings",
    { metadata: { namespace: platform.namespace }, stringData: { "settings.sql": pulumi.secret(sql) } },
    { provider },
  );
  const admin = new k8s.core.v1.Secret(
    "listmonk-admin",
    {
      metadata: { name: "listmonk-admin", namespace: platform.namespace },
      stringData: { LISTMONK_ADMIN_USER: "admin", LISTMONK_ADMIN_PASSWORD: adminPassword },
    },
    { provider },
  );

  const env = [
    { name: "LISTMONK_app__address", value: `0.0.0.0:${port}` },
    { name: "LISTMONK_db__host", value: db.host },
    { name: "LISTMONK_db__port", value: "5432" },
    { name: "LISTMONK_db__database", value: db.name },
    { name: "LISTMONK_db__user", value: db.name },
    secretEnv("LISTMONK_db__password", db.secret, "password"),
    { name: "LISTMONK_db__ssl_mode", value: "disable" },
    { name: "LISTMONK_db__max_open", value: "10" },
    { name: "LISTMONK_db__max_idle", value: "2" },
  ];
  // Listmonk reads its config from env alone with an empty --config, and runs from /listmonk.
  const noConfig = ["--config", ""];

  const listmonk = new WebService("listmonk", {
    platform,
    provider,
    hostname,
    image,
    port,
    requests: { cpu: "100m", memory: "128Mi" },
    readinessProbe: { httpGet: { path: "/health", port } },
    // The image's entrypoint makes a user and changes owners, which a non-root, read-only pod can't.
    command: ["./listmonk"],
    args: noConfig,
    env,
    initContainers: [
      {
        // Both steps are safe to run again: install does nothing once the tables exist.
        name: "migrate",
        command: [
          "sh",
          "-c",
          "./listmonk --install --idempotent --yes --config '' && ./listmonk --upgrade --yes --config ''",
        ],
        env,
        envFrom: [{ secretRef: { name: admin.metadata.name } }],
      },
      {
        name: "settings",
        image: "postgres:17-alpine",
        command: ["psql", "-v", "ON_ERROR_STOP=1", "-f", "/settings/settings.sql"],
        env: [
          { name: "PGHOST", value: db.host },
          { name: "PGDATABASE", value: db.name },
          { name: "PGUSER", value: db.name },
          secretEnv("PGPASSWORD", db.secret, "password"),
          { name: "HOME", value: "/tmp" },
        ],
      },
    ],
    volumes: [
      // Imports write their files here.
      { name: "tmp", mountPath: "/tmp", emptyDir: { sizeLimit: "256Mi" } },
      { name: "settings", mountPath: "/settings", secret: settings.metadata.name, readOnly: true },
      ...(mediaInPod ? [{ name: "uploads", mountPath: "/listmonk/uploads", emptyDir: { sizeLimit: "256Mi" } }] : []),
    ],
    runAsUser: 1000,
  });

  // What each API login signs in with: access-334's sync, to give each account its role, and dev's tests
  // (docs/newsletter.md).
  for (const { login, secret, token } of logins) {
    appSecret(cluster, secret, {
      LISTMONK_URL: "http://listmonk",
      LISTMONK_API_USER: login.username,
      LISTMONK_API_TOKEN: token,
    });
  }

  return {
    oidcClientId: clientId,
    oidcClientSecret: pulumi.secret(clientSecret),
    url: listmonk.url,
    listId: listUuid,
    adminPassword: pulumi.secret(adminPassword),
  };
}

const app = deploy();

/** Authentik registers Listmonk's client from these, as it does Directus's. */
export const oidcClientId = pulumi.output(app.then((a) => a.oidcClientId));
export const oidcClientSecret = pulumi.secret(app.then((a) => a.oidcClientSecret));
export const url = pulumi.output(app.then((a) => a.url));
/** The CSC Newsletter list's ID, which the website's signup form posts. */
export const listId = pulumi.output(app.then((a) => a.listId));
/** Listmonk's built-in admin, the break-glass login for its settings: `pulumi stack output --show-secrets`. */
export const adminPassword = pulumi.secret(app.then((a) => a.adminPassword));
