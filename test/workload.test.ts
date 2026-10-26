import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import type { PlatformOutputs } from "../src/outputs.ts";
import { ScheduledJob, type ScheduledJobArgs } from "../src/scheduled-job.ts";
import { Workload, type WorkloadArgs } from "../src/workload.ts";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const find = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)?.inputs;
const valueOf = <T>(output: pulumi.Output<T>): Promise<T> => (output as any).promise();

const platform = (env: string): PlatformOutputs => ({
  project: "example-project",
  projectNumber: "123456789",
  region: "us-west1",
  cluster: "cyc",
  clusterEndpoint: "gke-example.us-west1.gke.goog",
  namespace: env,
  gateway: { name: "shared", namespace: "gateway" },
  domain: `${env}.example.org`,
  sqlConnectionName: `example-project:us-west1:${env}`,
  sqlHost: "10.159.0.5",
  gatewayAddress: "203.0.113.10",
  registry: "us-west1-docker.pkg.dev/example-project/docker",
});

let provider: k8s.Provider;
const workloadArgs = (env: string): WorkloadArgs => ({
  platform: platform(env),
  provider,
  image: "example/worker:1",
  requests: { cpu: "250m", memory: "768Mi" },
});
const jobArgs = (env: string): ScheduledJobArgs => ({
  platform: platform(env),
  provider,
  image: "example/sync:1",
  schedule: "0 * * * *",
  requests: { cpu: "100m", memory: "256Mi" },
});

let member: pulumi.Output<string>;
let jobMember: pulumi.Output<string>;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (a) => {
        created.push({ type: a.type, name: a.name, inputs: a.inputs });
        return { id: `${a.name}_id`, state: a.inputs };
      },
      call: (a) => a.inputs,
    },
    "workload",
  );
  provider = new k8s.Provider("cluster", {});
  member = new Workload("dev-worker", workloadArgs("dev")).member;
  new Workload("prod-worker", workloadArgs("prod"));
  new Workload("mailpit", {
    ...workloadArgs("dev"),
    command: ["/mailpit"],
    args: ["--smtp", ":1025"],
    ports: [
      { name: "smtp", port: 1025 },
      { name: "http", port: 8025 },
    ],
    env: [{ name: "MP_MAX_MESSAGES", value: "500" }],
    envFrom: [{ secretRef: { name: "mailpit" } }],
    volumes: [
      { name: "tmp", mountPath: "/tmp", emptyDir: { sizeLimit: "64Mi" } },
      { name: "config", mountPath: "/etc/mailpit/config.yml", configMap: "mailpit", subPath: "config.yml" },
      { name: "certs", mountPath: "/certs", secret: "mailpit-tls", readOnly: true },
    ],
    readinessProbe: { tcpSocket: { port: 1025 } },
    livenessProbe: { httpGet: { path: "/livez", port: 8025 } },
    startupProbe: { exec: { command: ["true"] } },
    replicas: 2,
    runAsUser: 1000,
    serviceAccountAnnotations: { "iam.gke.io/gcp-service-account": "mailpit@example-project.iam.gserviceaccount.com" },
  });
  new Workload("prod-ha", {
    ...workloadArgs("prod"),
    replicas: 2,
    minAvailable: 1,
    spreadAcrossZones: true,
    podAnnotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
  });
  jobMember = new ScheduledJob("dev-sync", jobArgs("dev")).member;
  new ScheduledJob("prod-sync", {
    ...jobArgs("prod"),
    timeZone: "UTC",
    activeDeadlineSeconds: 600,
    backoffLimit: 2,
  });
  new ScheduledJob("suspended-sync", { ...jobArgs("dev"), suspend: true });
  await new Promise((r) => setImmediate(r));
});

const podSpec = (name: string) => find("kubernetes:apps/v1:Deployment", name).spec.template.spec;
const jobSpec = (name: string) => find("kubernetes:batch/v1:CronJob", name).spec;
const jobPodSpec = (name: string) => jobSpec(name).jobTemplate.spec.template.spec;

describe.each([
  ["Workload", podSpec, "dev-worker", "prod-worker"],
  ["ScheduledJob", jobPodSpec, "dev-sync", "prod-sync"],
])("%s defaults", (_kind, spec, dev, prod) => {
  it("runs as non-root with the RuntimeDefault seccomp profile", () => {
    expect(spec(dev).securityContext).toEqual({ runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } });
  });

  it("locks the container down", () => {
    expect(spec(dev).containers[0].securityContext).toEqual({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    });
  });

  it("mounts no service account token", () => {
    expect(spec(dev).automountServiceAccountToken).toBe(false);
    expect(find("kubernetes:core/v1:ServiceAccount", dev).automountServiceAccountToken).toBe(false);
  });

  it("runs as its own ServiceAccount", () => {
    expect(spec(dev).serviceAccountName).toBe(dev);
  });

  it("sets its limits to its requests", () => {
    const { resources } = spec(dev).containers[0];
    expect(resources.limits).toEqual(resources.requests);
  });

  it("uses Spot pods in dev only", () => {
    expect(spec(dev).nodeSelector).toEqual({ "cloud.google.com/gke-spot": "true" });
    expect(spec(prod).nodeSelector).toEqual({});
  });

  it("puts every resource in the environment's namespace", () => {
    const resources = created.filter((c) => c.name === dev && c.type.startsWith("kubernetes:"));
    expect(resources.length).toBeGreaterThan(0);
    for (const r of resources) {
      expect(r.inputs.metadata.namespace).toBe("dev");
    }
  });
});

describe("Workload", () => {
  it("has no route, health check, or Service without ports", () => {
    const types = created.filter((c) => c.name === "dev-worker").map((c) => c.type);
    expect(types.sort()).toEqual([
      "cyc-seattle:platform:Workload",
      "kubernetes:apps/v1:Deployment",
      "kubernetes:core/v1:ServiceAccount",
    ]);
  });

  it("defaults to one replica", () => {
    expect(find("kubernetes:apps/v1:Deployment", "dev-worker").spec.replicas).toBe(1);
  });

  it("has no pod annotations, zone spread, or disruption budget by default", () => {
    const deployment = find("kubernetes:apps/v1:Deployment", "dev-worker");
    expect(deployment.spec.template.metadata.annotations).toBeUndefined();
    expect(podSpec("dev-worker").topologySpreadConstraints).toBeUndefined();
    expect(find("kubernetes:policy/v1:PodDisruptionBudget", "dev-worker")).toBeUndefined();
  });

  it("annotates its pods", () => {
    expect(find("kubernetes:apps/v1:Deployment", "prod-ha").spec.template.metadata).toEqual({
      labels: { "app.kubernetes.io/name": "prod-ha" },
      annotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
    });
  });

  it("prefers spreading its pods across zones", () => {
    expect(podSpec("prod-ha").topologySpreadConstraints).toEqual([
      {
        maxSkew: 1,
        topologyKey: "topology.kubernetes.io/zone",
        whenUnsatisfiable: "ScheduleAnyway",
        labelSelector: { matchLabels: { "app.kubernetes.io/name": "prod-ha" } },
      },
    ]);
  });

  it("keeps minAvailable pods up through drains", () => {
    expect(find("kubernetes:policy/v1:PodDisruptionBudget", "prod-ha")).toMatchObject({
      metadata: { name: "prod-ha", namespace: "prod", labels: { "app.kubernetes.io/name": "prod-ha" } },
      spec: { minAvailable: 1, selector: { matchLabels: { "app.kubernetes.io/name": "prod-ha" } } },
    });
  });

  it("refuses a disruption budget that would block every drain", () => {
    expect(() => new Workload("too-few", { ...workloadArgs("prod"), minAvailable: 1 })).toThrow(
      /too-few: "minAvailable" \(1\) must be below "replicas" \(1\)/,
    );
  });

  it("exposes each port at the same number on its Service", () => {
    expect(find("kubernetes:core/v1:Service", "mailpit").spec).toEqual({
      selector: { "app.kubernetes.io/name": "mailpit" },
      ports: [
        { name: "smtp", port: 1025, targetPort: "smtp" },
        { name: "http", port: 8025, targetPort: "http" },
      ],
    });
    expect(podSpec("mailpit").containers[0].ports).toEqual([
      { name: "smtp", containerPort: 1025 },
      { name: "http", containerPort: 8025 },
    ]);
  });

  it("passes the command, the environment, and the probes through", () => {
    expect(podSpec("mailpit").containers[0]).toMatchObject({
      command: ["/mailpit"],
      args: ["--smtp", ":1025"],
      env: [{ name: "MP_MAX_MESSAGES", value: "500" }],
      envFrom: [{ secretRef: { name: "mailpit" } }],
      readinessProbe: { tcpSocket: { port: 1025 } },
      livenessProbe: { httpGet: { path: "/livez", port: 8025 } },
      startupProbe: { exec: { command: ["true"] } },
    });
    expect(find("kubernetes:apps/v1:Deployment", "mailpit").spec.replicas).toBe(2);
  });

  it("mounts emptyDir, ConfigMap, and Secret volumes", () => {
    expect(podSpec("mailpit").volumes).toEqual([
      { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
      { name: "config", configMap: { name: "mailpit" } },
      { name: "certs", secret: { secretName: "mailpit-tls" } },
    ]);
    expect(podSpec("mailpit").containers[0].volumeMounts).toEqual([
      { name: "tmp", mountPath: "/tmp" },
      { name: "config", mountPath: "/etc/mailpit/config.yml", subPath: "config.yml" },
      { name: "certs", mountPath: "/certs", readOnly: true },
    ]);
  });

  it("runs as the given user and group", () => {
    expect(podSpec("mailpit").securityContext).toMatchObject({ runAsUser: 1000, runAsGroup: 1000 });
  });

  it("annotates its ServiceAccount", () => {
    expect(find("kubernetes:core/v1:ServiceAccount", "mailpit").metadata.annotations).toEqual({
      "iam.gke.io/gcp-service-account": "mailpit@example-project.iam.gserviceaccount.com",
    });
  });

  it("exposes its Workload Identity principal", async () => {
    expect(await valueOf(member)).toBe(
      "principal://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/example-project.svc.id.goog/subject/ns/dev/sa/dev-worker",
    );
  });

  it("requires CPU and memory requests", () => {
    expect(() => new Workload("no-requests", { ...workloadArgs("dev"), requests: { cpu: "50m" } as any })).toThrow(
      /Workload "no-requests" needs CPU and memory requests/,
    );
  });
});

describe("ScheduledJob", () => {
  it("runs on its schedule in Pacific time, never overlapping", () => {
    expect(jobSpec("dev-sync")).toMatchObject({
      schedule: "0 * * * *",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
    });
  });

  it("gives a run an hour and no retries by default", () => {
    expect(jobSpec("dev-sync").jobTemplate.spec).toMatchObject({ activeDeadlineSeconds: 3600, backoffLimit: 0 });
    expect(jobPodSpec("dev-sync").restartPolicy).toBe("Never");
  });

  it("takes a time zone, a deadline, and retries", () => {
    expect(jobSpec("prod-sync")).toMatchObject({
      timeZone: "UTC",
      jobTemplate: { spec: { activeDeadlineSeconds: 600, backoffLimit: 2 } },
    });
  });

  it("leaves suspend out of the spec unless it's set, so it runs on its schedule", () => {
    expect(jobSpec("dev-sync")).not.toHaveProperty("suspend");
  });

  it("can be suspended", () => {
    expect(jobSpec("suspended-sync").suspend).toBe(true);
  });

  it("exposes its Workload Identity principal", async () => {
    expect(await valueOf(jobMember)).toBe(
      "principal://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/example-project.svc.id.goog/subject/ns/dev/sa/dev-sync",
    );
  });

  it("requires CPU and memory requests", () => {
    expect(() => new ScheduledJob("no-requests", { ...jobArgs("dev"), requests: {} as any })).toThrow(
      /ScheduledJob "no-requests" needs CPU and memory requests/,
    );
  });
});

describe("pods", () => {
  it("create no IAM", () => {
    expect(created.filter((r) => r.type.startsWith("gcp:"))).toEqual([]);
  });
});
