import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { PlatformOutputs } from "./outputs";

type Probe = k8s.types.input.core.v1.Probe;
type EnvVar = k8s.types.input.core.v1.EnvVar;
type EnvFromSource = k8s.types.input.core.v1.EnvFromSource;

/** A volume and where the container mounts it. Give exactly one of `emptyDir`, `configMap`, or `secret`. */
export interface WorkloadVolume {
  name: string;
  mountPath: string;
  emptyDir?: { sizeLimit?: string };
  /** A ConfigMap's name. */
  configMap?: pulumi.Input<string>;
  /** A Secret's name. */
  secret?: pulumi.Input<string>;
  subPath?: string;
  readOnly?: boolean;
}

/** What every pod of `Workload`, `WebService`, and `ScheduledJob` takes. */
export interface PodArgs {
  /** The environment's platform values, from `getPlatformOutputs`. */
  platform: pulumi.Input<PlatformOutputs>;
  /** The environment's cluster, from `clusterProvider`. Required, so it never uses a local kubeconfig. */
  provider: k8s.Provider;
  image: pulumi.Input<string>;
  command?: string[];
  args?: string[];
  /** The container's requests, which are also its limits. */
  requests: { cpu: pulumi.Input<string>; memory: pulumi.Input<string> };
  env?: pulumi.Input<EnvVar>[];
  envFrom?: pulumi.Input<EnvFromSource>[];
  volumes?: WorkloadVolume[];
  /** Needed when the image's user is a name, which `runAsNonRoot` can't check. Also sets the group. */
  runAsUser?: number;
  /** Annotations on the Kubernetes ServiceAccount, such as `iam.gke.io/gcp-service-account`. */
  serviceAccountAnnotations?: Record<string, string>;
}

export interface WorkloadArgs extends PodArgs {
  /** The container's ports. The Service exposes each at the same number. Without any, there's no Service. */
  ports?: { name: string; port: number }[];
  readinessProbe?: Probe;
  livenessProbe?: Probe;
  startupProbe?: Probe;
  /** Defaults to 1. */
  replicas?: number;
}

/** The pods' Workload Identity principal, for IAM grants. */
export function workloadMember(
  platform: pulumi.Output<PlatformOutputs>,
  serviceAccountName: pulumi.Input<string>,
): pulumi.Output<string> {
  return pulumi.interpolate`principal://iam.googleapis.com/projects/${platform.projectNumber}/locations/global/workloadIdentityPools/${platform.project}.svc.id.goog/subject/ns/${platform.namespace}/sa/${serviceAccountName}`;
}

export function checkRequests(kind: string, name: string, requests: PodArgs["requests"] | undefined): void {
  // The types already require them, but a JavaScript caller or a cast can skip them.
  if (!requests?.cpu || !requests?.memory) {
    throw new Error(`${kind} "${name}" needs CPU and memory requests.`);
  }
}

/** A ServiceAccount named `name` that mounts no token. */
export function serviceAccount(
  name: string,
  args: PodArgs,
  opts: pulumi.CustomResourceOptions,
): k8s.core.v1.ServiceAccount {
  const platform = pulumi.output(args.platform);
  return new k8s.core.v1.ServiceAccount(
    name,
    {
      metadata: {
        name,
        namespace: platform.namespace,
        labels: { "app.kubernetes.io/name": name },
        ...(args.serviceAccountAnnotations && { annotations: args.serviceAccountAnnotations }),
      },
      automountServiceAccountToken: false,
    },
    opts,
  );
}

/** A pod spec with the platform's secure defaults: non-root, read-only, no token, and Spot in dev only. */
export function podSpec(
  name: string,
  args: PodArgs,
  serviceAccountName: pulumi.Input<string>,
  container: Partial<k8s.types.input.core.v1.Container> = {},
): pulumi.Output<k8s.types.input.core.v1.PodSpec> {
  const volumes = args.volumes ?? [];
  // The namespace is the environment's name.
  return pulumi.output(args.platform).namespace.apply((namespace) => ({
    serviceAccountName,
    automountServiceAccountToken: false,
    // Autopilot schedules a pod with this selector on Spot capacity.
    nodeSelector: namespace === "dev" ? { "cloud.google.com/gke-spot": "true" } : {},
    securityContext: {
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
      ...(args.runAsUser !== undefined && { runAsUser: args.runAsUser, runAsGroup: args.runAsUser }),
    },
    ...(volumes.length > 0 && {
      volumes: volumes.map((v) => ({
        name: v.name,
        ...(v.emptyDir && { emptyDir: v.emptyDir }),
        ...(v.configMap !== undefined && { configMap: { name: v.configMap } }),
        ...(v.secret !== undefined && { secret: { secretName: v.secret } }),
      })),
    }),
    containers: [
      {
        name,
        image: args.image,
        ...(args.command && { command: args.command }),
        ...(args.args && { args: args.args }),
        ...container,
        // A LimitRange's default limit could otherwise sit below the request, which the API refuses.
        resources: { requests: args.requests, limits: args.requests },
        ...(args.env && { env: args.env }),
        ...(args.envFrom && { envFrom: args.envFrom }),
        ...(volumes.length > 0 && {
          volumeMounts: volumes.map((v) => ({
            name: v.name,
            mountPath: v.mountPath,
            ...(v.subPath !== undefined && { subPath: v.subPath }),
            ...(v.readOnly !== undefined && { readOnly: v.readOnly }),
          })),
        }),
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] },
        },
      },
    ],
  }));
}

export interface DeploymentParts {
  serviceAccount: k8s.core.v1.ServiceAccount;
  service?: k8s.core.v1.Service;
}

/**
 * The Deployment, ServiceAccount, and Service of a `Workload` or a `WebService`, as children of
 * `parent`. `http` is a `WebService`'s port, which its Service exposes as port 80.
 */
export function deployment(parent: pulumi.Resource, name: string, args: WorkloadArgs, http?: number): DeploymentParts {
  const platform = pulumi.output(args.platform);
  const labels = { "app.kubernetes.io/name": name };
  const metadata = { name, namespace: platform.namespace, labels };
  const child = { parent, provider: args.provider };

  const account = serviceAccount(name, args, child);
  const ports = [...(http !== undefined ? [{ name: "http", port: http }] : []), ...(args.ports ?? [])];

  new k8s.apps.v1.Deployment(
    name,
    {
      metadata,
      spec: {
        replicas: args.replicas ?? 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: podSpec(name, args, account.metadata.name, {
            ...(ports.length > 0 && { ports: ports.map((p) => ({ name: p.name, containerPort: p.port })) }),
            ...(args.readinessProbe && { readinessProbe: args.readinessProbe }),
            ...(args.livenessProbe && { livenessProbe: args.livenessProbe }),
            ...(args.startupProbe && { startupProbe: args.startupProbe }),
          }),
        },
      },
    },
    child,
  );

  if (ports.length === 0) {
    return { serviceAccount: account };
  }
  const service = new k8s.core.v1.Service(
    name,
    {
      metadata,
      spec: {
        selector: labels,
        ports: ports.map((p) => ({
          name: p.name,
          port: p.name === "http" && http !== undefined ? 80 : p.port,
          targetPort: p.name,
        })),
      },
    },
    child,
  );
  return { serviceAccount: account, service };
}

/**
 * A long-running process with no route: a Deployment, a Kubernetes ServiceAccount, and, when it has
 * ports, a ClusterIP Service, all named `name`. Its pods get no IAM; grant roles to `member`.
 */
export class Workload extends pulumi.ComponentResource {
  /** The pods' Workload Identity principal, for IAM grants. */
  readonly member: pulumi.Output<string>;
  readonly serviceAccountName: pulumi.Output<string>;
  /** The name other pods in the namespace reach its Service by. */
  readonly host: string;

  constructor(name: string, args: WorkloadArgs, opts?: pulumi.ComponentResourceOptions) {
    super("cyc-seattle:platform:Workload", name, {}, opts);
    checkRequests("Workload", name, args.requests);

    const { serviceAccount } = deployment(this, name, args);
    this.serviceAccountName = serviceAccount.metadata.name;
    this.member = workloadMember(pulumi.output(args.platform), this.serviceAccountName);
    this.host = name;
    this.registerOutputs({ member: this.member, serviceAccountName: this.serviceAccountName, host: this.host });
  }
}
