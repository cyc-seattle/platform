import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { PlatformOutputs } from "./outputs";

type Probe = k8s.types.input.core.v1.Probe;

export interface WebServiceArgs {
  /** The environment's platform values, from `getPlatformOutputs`. */
  platform: pulumi.Input<PlatformOutputs>;
  /** The environment's cluster, from `clusterProvider`. Required, so it never uses a local kubeconfig. */
  provider: k8s.Provider;
  /** The public hostname. It must be in the environment's domain. */
  hostname: string;
  image: pulumi.Input<string>;
  /** The port the container serves HTTP on. */
  port: number;
  requests: { cpu: pulumi.Input<string>; memory: pulumi.Input<string> };
  /** An HTTP GET probe. The load balancer's health check uses the same path. */
  readinessProbe: Probe & { httpGet: pulumi.Input<k8s.types.input.core.v1.HTTPGetAction> };
  livenessProbe?: Probe;
  env?: pulumi.Input<k8s.types.input.core.v1.EnvVar>[];
  replicas?: number;
  /** Needed when the image's user is a name, which `runAsNonRoot` can't check. */
  runAsUser?: number;
}

/** Returns `hostname` if it is the environment's domain or a name under it, and throws otherwise. */
export function checkHostname(hostname: string, domain: string): string {
  const host = hostname.toLowerCase();
  const base = domain.toLowerCase();
  if (host !== base && !host.endsWith(`.${base}`)) {
    throw new Error(`Hostname ${hostname} isn't in the environment's domain, ${domain}.`);
  }
  return hostname;
}

/**
 * An HTTP service behind the environment's shared Gateway: a Deployment, a Service, an HTTPRoute, a
 * Kubernetes ServiceAccount, and a HealthCheckPolicy. Its pods get no IAM; grant roles to `member`.
 */
export class WebService extends pulumi.ComponentResource {
  /** The pods' Workload Identity principal, for IAM grants. */
  readonly member: pulumi.Output<string>;
  readonly url: pulumi.Output<string>;

  constructor(name: string, args: WebServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("cyc-seattle:platform:WebService", name, {}, opts);

    // The types already require these, but a JavaScript caller or a cast can skip them.
    if (!args.requests?.cpu || !args.requests?.memory) {
      throw new Error(`WebService "${name}" needs CPU and memory requests.`);
    }
    if (!args.readinessProbe?.httpGet) {
      throw new Error(`WebService "${name}" needs an HTTP readiness probe.`);
    }

    const platform = pulumi.output(args.platform);
    const namespace = platform.namespace;
    // A bad hostname fails the HTTPRoute's registration, so preview fails before anything applies.
    const hostname = platform.domain.apply((domain) => checkHostname(args.hostname, domain));
    // The namespace is the environment's name.
    const spot = namespace.apply((ns) => ns === "dev");
    const labels = { "app.kubernetes.io/name": name };
    const metadata = { name, namespace, labels };
    const child = { parent: this, provider: args.provider };

    const serviceAccount = new k8s.core.v1.ServiceAccount(
      name,
      { metadata, automountServiceAccountToken: false },
      child,
    );

    new k8s.apps.v1.Deployment(
      name,
      {
        metadata,
        spec: {
          replicas: args.replicas ?? 1,
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              serviceAccountName: serviceAccount.metadata.name,
              automountServiceAccountToken: false,
              // Autopilot schedules a pod with this selector on Spot capacity.
              nodeSelector: spot.apply((s) => (s ? { "cloud.google.com/gke-spot": "true" } : {})),
              securityContext: {
                runAsNonRoot: true,
                seccompProfile: { type: "RuntimeDefault" },
                ...(args.runAsUser !== undefined && { runAsUser: args.runAsUser, runAsGroup: args.runAsUser }),
              },
              containers: [
                {
                  name,
                  image: args.image,
                  ports: [{ name: "http", containerPort: args.port }],
                  resources: { requests: args.requests },
                  readinessProbe: args.readinessProbe,
                  ...(args.livenessProbe && { livenessProbe: args.livenessProbe }),
                  ...(args.env && { env: args.env }),
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: true,
                    capabilities: { drop: ["ALL"] },
                  },
                },
              ],
            },
          },
        },
      },
      child,
    );

    const service = new k8s.core.v1.Service(
      name,
      {
        metadata,
        spec: {
          selector: labels,
          ports: [{ name: "http", port: 80, targetPort: "http" }],
        },
      },
      child,
    );

    new k8s.apiextensions.CustomResource(
      name,
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "HTTPRoute",
        metadata,
        spec: {
          parentRefs: [{ name: platform.gateway.name, namespace: platform.gateway.namespace }],
          hostnames: [hostname],
          rules: [{ backendRefs: [{ name: service.metadata.name, port: 80 }] }],
        },
      },
      child,
    );

    // Without it, the load balancer checks `/` on the serving port, which an app may not answer.
    new k8s.apiextensions.CustomResource(
      name,
      {
        apiVersion: "networking.gke.io/v1",
        kind: "HealthCheckPolicy",
        metadata,
        spec: {
          default: {
            config: {
              type: "HTTP",
              httpHealthCheck: {
                portSpecification: "USE_SERVING_PORT",
                requestPath: pulumi.output(args.readinessProbe.httpGet).apply((get) => get?.path ?? "/"),
              },
            },
          },
          targetRef: { group: "", kind: "Service", name: service.metadata.name },
        },
      },
      child,
    );

    this.member = pulumi.interpolate`principal://iam.googleapis.com/projects/${platform.projectNumber}/locations/global/workloadIdentityPools/${platform.project}.svc.id.goog/subject/ns/${namespace}/sa/${serviceAccount.metadata.name}`;
    this.url = pulumi.interpolate`https://${hostname}/`;
    this.registerOutputs({ member: this.member, url: this.url });
  }
}
