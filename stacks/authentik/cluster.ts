import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as command from "@pulumi/command";
import { WebService, Workload } from "../../src/index.ts";
import { appDatabase, appSecret, loadCluster, secretEnv } from "../../src/app/cluster.ts";
import { dnsRecord } from "../../src/app/cloud.ts";
import { authentikEnv, authentikImage as image, loginRedirectRoute } from "./workloads.ts";
import { builtInQueries } from "./naming.ts";
import type { AuthentikSecrets } from "./prod-secrets.ts";

// Authentik on the cluster (cyc-seattle/isthmia#231): its database, its secrets, and the server and worker.

export interface AuthentikOnCluster {
  domain: string;
  url: string;
  bootstrapToken: pulumi.Output<string>;
  /** Resolves once the API answers with the bootstrap token at `url`. */
  ready: command.local.Command;
}

/**
 * Authentik in the environment's namespace. `existing` holds prod's secrets and database password
 * from the VM, which an instance on the same database must keep.
 */
export async function deployAuthentik(
  existing: AuthentikSecrets & { dbPassword: pulumi.Output<string> },
): Promise<AuthentikOnCluster> {
  const cluster = await loadCluster();
  const { platform, provider } = cluster;
  const domain = platform.domain;
  const url = `https://login.${domain}`;

  const db = appDatabase(cluster, "authentik", existing.dbPassword);
  const secrets: AuthentikSecrets = existing;
  const bootstrapToken = pulumi.secret(secrets.bootstrapToken);
  const secret = appSecret(cluster, "authentik", {
    AUTHENTIK_SECRET_KEY: pulumi.secret(secrets.secretKey),
    AUTHENTIK_BOOTSTRAP_TOKEN: bootstrapToken,
    AUTHENTIK_BOOTSTRAP_PASSWORD: pulumi.secret(secrets.bootstrapPassword),
  });

  // Mounted at /templates/email, since the email stage names its template `email/<name>.html`.
  const templatesDir = path.resolve(import.meta.dirname, "templates/email");
  const templates = new k8s.core.v1.ConfigMap(
    "authentik-templates",
    {
      metadata: { name: "authentik-templates", namespace: platform.namespace },
      data: Object.fromEntries(
        fs.readdirSync(templatesDir).map((name) => [name, fs.readFileSync(path.resolve(templatesDir, name), "utf8")]),
      ),
    },
    { provider },
  );

  const env = authentikEnv({
    dbHost: db.host,
    dbPassword: secretEnv("AUTHENTIK_POSTGRESQL__PASSWORD", db.secret, "password"),
    smtp: { host: "smtp-relay.gmail.com", port: 587, useTls: true },
    // Kept open (cyc-seattle/isthmia#302), they filled the database's connections, and Authentik and
    // Directus both went down. They close after each request until cyc-seattle/platform#111 is fixed.
    connMaxAge: 0,
  });
  // Authentik keeps its sockets and Prometheus files in TMPDIR, /dev/shm. Nothing else writes.
  const volumes = [
    { name: "shm", mountPath: "/dev/shm", emptyDir: { sizeLimit: "256Mi" } },
    { name: "templates", mountPath: "/templates/email", configMap: templates.metadata.name, readOnly: true },
  ];

  // Every check is a request that opens its own connection, and db-f1-micro's shared core takes
  // over a second to answer at GKE's default cadence (cyc-seattle/isthmia#268). Prod's idle database sat at 21% CPU,
  // most likely from them (cyc-seattle/isthmia#264), so the probe and the load balancer check less often.
  const readinessProbe = { httpGet: { path: "/-/health/ready/", port: 9000 }, periodSeconds: 30, timeoutSeconds: 10 };
  // Even that took up to 9s against the load balancer's 10s, and a miss dropped sign-in with a
  // 503 (cyc-seattle/platform#111). /-/health/live/ still queries the database, through Authentik's
  // middleware, so the load balancer asks for a file the server's Go router serves from disk. The
  // readiness probe still takes a pod whose database or Python side fails out of the load balancer.
  // An upgrade that moves the file fails the wait below.
  const healthCheckPath = "/static/dist/assets/icons/icon.png";
  // Autopilot bills the requests, and the CPU limits let a startup or a burst of sign-ins use a
  // node's spare CPU. Memory stays above the peak (cyc-seattle/isthmia#264). At 250m, a fresh instance's
  // worker took over 15 minutes to apply the built-in blueprints, so it can burst to 500m. The
  // server, which Autopilot won't evict (below), gets at least 500m from it, so it asks for that.
  const sizes = {
    server: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "1" } },
    worker: { requests: { cpu: "100m", memory: "512Mi" }, limits: { cpu: "500m" } },
  };
  // Everything that goes into each pod, in one place, so the readiness check below re-runs whenever
  // a change rolls the pods.
  const pods = {
    server: {
      args: ["server"],
      ...sizes.server,
      readinessProbe,
      env: [...env, { name: "AUTHENTIK_WEB__WORKERS", value: "2" }, { name: "AUTHENTIK_WEB__THREADS", value: "2" }],
      envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
      volumes,
      // Keeps Autopilot from moving it to consolidate nodes (cyc-seattle/isthmia#253). One replica fits the quota.
      ...(new pulumi.Config().getBoolean("safeToEvict") === false && {
        podAnnotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
      }),
    },
    worker: {
      args: ["worker"],
      ...sizes.worker,
      env: [
        ...env,
        { name: "AUTHENTIK_WORKER__PROCESSES", value: "1" },
        { name: "AUTHENTIK_WORKER__THREADS", value: "2" },
      ],
      envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
      volumes,
    },
  };
  const server = new WebService("authentik-server", {
    platform,
    provider,
    hostname: `login.${domain}`,
    image,
    port: 9000,
    healthCheck: { path: healthCheckPath, checkIntervalSec: 30, timeoutSec: 10 },
    // A new pod can wait minutes for a node, then take two more to pull the image, which ran past the
    // default 600s and failed a deploy that went on to finish (cyc-seattle/platform#153).
    progressDeadlineSeconds: 1200,
    ...pods.server,
  });

  // The bootstrap token takes effect when the worker first starts.
  const worker = new Workload("authentik-worker", { platform, provider, image, ...pods.worker });

  new k8s.apiextensions.CustomResource(
    "authentik-login-redirects",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: "authentik-login-redirects", namespace: platform.namespace },
      spec: loginRedirectRoute(platform.gateway, domain),
    },
    { provider },
  );

  // The record moved here from the VM.
  const record = [dnsRecord("authentik-a", `login.${domain}`, platform.gatewayAddress)];

  // A ready pod isn't enough: the load balancer takes minutes to admit a new route, the worker
  // applies the bootstrap token after it starts, and it creates the built-in flows and mappings this
  // project looks up in the background after that. The Authentik provider needs all of them.
  const ready = new command.local.Command(
    "authentik-api-ready",
    {
      create: ["../../scripts/wait-for-authentik", ...builtInQueries().map((q) => `'${q}'`)].join(" "),
      environment: { AUTHENTIK_URL: url, AUTHENTIK_TOKEN: bootstrapToken, AUTHENTIK_HEALTH_PATH: healthCheckPath },
      // Any change to the pods rolls them too, and the lookups 503 until the new server is admitted.
      triggers: [image, pulumi.jsonStringify(pulumi.output(pods))],
    },
    { dependsOn: [server, worker, ...record] },
  );

  return {
    domain,
    url,
    bootstrapToken,
    ready,
  };
}
