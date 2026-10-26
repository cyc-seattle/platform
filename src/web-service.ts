import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { checkRequests, deployment, workloadMember, type WorkloadArgs } from "./workload.ts";

type Probe = k8s.types.input.core.v1.Probe;

export interface WebServiceArgs extends WorkloadArgs {
  /** The public hostname. It must be in the environment's domain. */
  hostname: string;
  /** The port the container serves HTTP on. The Service exposes it as port 80, named `http`. */
  port: number;
  /** An HTTP GET probe. The load balancer's health check uses the same path. */
  readinessProbe: Probe & { httpGet: pulumi.Input<k8s.types.input.core.v1.HTTPGetAction> };
  /**
   * The load balancer's check timing. GKE's default is every 5s from each of several probers, which
   * an app whose readiness check reaches its database may not afford.
   */
  healthCheck?: { checkIntervalSec?: number; timeoutSec?: number };
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
 * An HTTP service behind the environment's shared Gateway: a `Workload`'s Deployment, Service, and
 * Kubernetes ServiceAccount, plus an HTTPRoute and a HealthCheckPolicy. Its pods get no IAM; grant
 * roles to `member`.
 */
export class WebService extends pulumi.ComponentResource {
  /** The pods' Workload Identity principal, for IAM grants. */
  readonly member: pulumi.Output<string>;
  readonly serviceAccountName: pulumi.Output<string>;
  /** The name other pods in the namespace reach its Service by, on port 80. */
  readonly host: string;
  readonly url: pulumi.Output<string>;

  constructor(name: string, args: WebServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("cyc-seattle:platform:WebService", name, {}, opts);

    checkRequests("WebService", name, args.requests);
    if (!args.readinessProbe?.httpGet) {
      throw new Error(`WebService "${name}" needs an HTTP readiness probe.`);
    }

    const platform = pulumi.output(args.platform);
    // A bad hostname fails the HTTPRoute's registration, so preview fails before anything applies.
    const hostname = platform.domain.apply((domain) => checkHostname(args.hostname, domain));
    const metadata = { name, namespace: platform.namespace, labels: { "app.kubernetes.io/name": name } };
    const child = { parent: this, provider: args.provider };

    const { serviceAccount, service } = deployment(this, name, args, args.port);

    new k8s.apiextensions.CustomResource(
      name,
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "HTTPRoute",
        metadata,
        spec: {
          parentRefs: [{ name: platform.gateway.name, namespace: platform.gateway.namespace }],
          hostnames: [hostname],
          rules: [{ backendRefs: [{ name: service!.metadata.name, port: 80 }] }],
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
            ...args.healthCheck,
            config: {
              type: "HTTP",
              httpHealthCheck: {
                portSpecification: "USE_SERVING_PORT",
                requestPath: pulumi.output(args.readinessProbe.httpGet).apply((get) => get?.path ?? "/"),
              },
            },
          },
          targetRef: { group: "", kind: "Service", name: service!.metadata.name },
        },
      },
      child,
    );

    this.serviceAccountName = serviceAccount.metadata.name;
    this.member = workloadMember(platform, this.serviceAccountName);
    this.host = name;
    this.url = pulumi.interpolate`https://${hostname}/`;
    this.registerOutputs({
      member: this.member,
      serviceAccountName: this.serviceAccountName,
      host: this.host,
      url: this.url,
    });
  }
}
