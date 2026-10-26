import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/** The namespace label the Gateway's listeners select an environment's routes by. */
export const environmentLabel = "cycsail.team/environment";

// Where a global external Application Load Balancer's health checks and proxied requests come from:
// https://cloud.google.com/load-balancing/docs/firewall-rules
export const loadBalancerRanges = ["35.191.0.0/16", "130.211.0.0/22"];

/**
 * The Gateway's HTTPS listeners for an environment's domain and its subdomains. Each admits routes
 * only from namespaces labeled with the environment, so a route in dev can't claim a prod hostname.
 */
export function httpsListeners(environment: string, domain: pulumi.Input<string>) {
  const allowedRoutes = {
    kinds: [{ kind: "HTTPRoute" }],
    namespaces: { from: "Selector", selector: { matchLabels: { [environmentLabel]: environment } } },
  };
  // A wildcard hostname doesn't match the domain itself, so each needs its own listener.
  return [
    { name: `https-${environment}`, hostname: domain, protocol: "HTTPS", port: 443, allowedRoutes },
    {
      name: `https-${environment}-wildcard`,
      hostname: pulumi.interpolate`*.${domain}`,
      protocol: "HTTPS",
      port: 443,
      allowedRoutes,
    },
  ];
}

/** SMTP, SMTPS, and submission. */
export const mailPorts = [25, 465, 587];

/** The TCP port ranges, as `[port, endPort]`, that cover every port but `excluded`. */
export function allPortsExcept(excluded: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 1;
  for (const port of [...excluded].sort((a, b) => a - b)) {
    if (port > start) {
      ranges.push([start, port - 1]);
    }
    start = port + 1;
  }
  ranges.push([start, 65535]);
  return ranges;
}

const editVerbs = ["get", "list", "watch", "create", "update", "patch", "delete"];

export interface EnvironmentNamespaceArgs {
  /** The namespace's total CPU and memory requests, and its pod count. */
  quota: { cpu: string; memory: string; pods: number };
  /** A container's default requests, which Autopilot also makes its limits. */
  defaultRequests: { cpu: string; memory: string };
  /** The most one container may request. */
  maxRequests: { cpu: string; memory: string };
}

/**
 * One environment's namespace, labeled for the Gateway's listeners. It enforces the `restricted`
 * Pod Security Standard, caps its total requests, defaults each container's, and denies ingress
 * from other namespaces except the load balancer's. Use {@link EnvironmentNamespace.grantAdmin} to
 * let a deploy identity manage it.
 */
export class EnvironmentNamespace extends k8s.core.v1.Namespace {
  private readonly provider: pulumi.ProviderResource;
  private readonly routeEditor: k8s.rbac.v1.Role;

  readonly environment: string;

  constructor(
    environment: string,
    args: EnvironmentNamespaceArgs,
    opts: pulumi.CustomResourceOptions & { provider: pulumi.ProviderResource },
  ) {
    super(
      environment,
      {
        metadata: {
          name: environment,
          labels: {
            [environmentLabel]: environment,
            "pod-security.kubernetes.io/enforce": "restricted",
          },
        },
      },
      opts,
    );

    this.environment = environment;
    this.provider = opts.provider;
    const metadata = { namespace: this.metadata.name };

    new k8s.core.v1.ResourceQuota(
      `${environment}-quota`,
      {
        metadata: { ...metadata, name: "quota" },
        spec: {
          hard: {
            "requests.cpu": args.quota.cpu,
            "requests.memory": args.quota.memory,
            pods: String(args.quota.pods),
            // Traffic enters through the shared Gateway, not a load balancer or node port of its own.
            "services.loadbalancers": "0",
            "services.nodeports": "0",
          },
        },
      },
      { provider: this.provider },
    );

    new k8s.core.v1.LimitRange(
      `${environment}-limits`,
      {
        metadata: { ...metadata, name: "limits" },
        spec: {
          limits: [
            {
              type: "Container",
              default: args.defaultRequests,
              defaultRequest: args.defaultRequests,
              max: args.maxRequests,
            },
          ],
        },
      },
      { provider: this.provider },
    );

    // The Gateway API and GKE's policies are CRDs, which the built-in `admin` role may not
    // aggregate.
    this.routeEditor = new k8s.rbac.v1.Role(
      `${environment}-route-editor`,
      {
        metadata: { ...metadata, name: "route-editor" },
        rules: [
          { apiGroups: ["gateway.networking.k8s.io"], resources: ["httproutes"], verbs: editVerbs },
          { apiGroups: ["networking.gke.io"], resources: ["healthcheckpolicies"], verbs: editVerbs },
        ],
      },
      { provider: this.provider },
    );

    // No ports, so it admits the load balancer on whichever port a service serves.
    new k8s.networking.v1.NetworkPolicy(
      `${environment}-isolation`,
      {
        metadata: { ...metadata, name: "deny-other-namespaces" },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress"],
          ingress: [
            { from: [{ podSelector: {} }] },
            { from: loadBalancerRanges.map((cidr) => ({ ipBlock: { cidr } })) },
          ],
        },
      },
      { provider: this.provider },
    );
  }

  /**
   * Admits the Kubernetes API's service and pod proxy. GKE's control plane reaches pods through the
   * konnectivity agents, so the proxied requests come from their pods in kube-system.
   */
  admitApiProxy(): void {
    new k8s.networking.v1.NetworkPolicy(
      `${this.environment}-api-proxy`,
      {
        metadata: { namespace: this.metadata.name, name: "allow-api-proxy" },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress"],
          ingress: [
            {
              from: [
                {
                  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } },
                  podSelector: { matchLabels: { "k8s-app": "konnectivity-agent" } },
                },
              ],
            },
          ],
        },
      },
      { provider: this.provider },
    );
  }

  /**
   * Denies TCP egress to the mail ports (25, 465, 587) outside the cluster, so the environment can't
   * send real mail. Other egress stays open. A policy can only allow, so it allows every other port.
   */
  denyMailEgress(): void {
    new k8s.networking.v1.NetworkPolicy(
      `${this.environment}-mail-egress`,
      {
        metadata: { namespace: this.metadata.name, name: "deny-mail-egress" },
        spec: {
          podSelector: {},
          policyTypes: ["Egress"],
          egress: [
            // Any port to pods in the cluster, such as a mail catcher.
            { to: [{ namespaceSelector: {} }] },
            {
              ports: [
                ...allPortsExcept(mailPorts).map(([port, endPort]) => ({ protocol: "TCP", port, endPort })),
                { protocol: "UDP" },
              ],
            },
          ],
        },
      },
      { provider: this.provider },
    );
  }

  /**
   * Binds the `admin` ClusterRole, in this namespace only, to a Google service account, and the
   * Gateway resources a `WebService` creates, which `admin` may not cover. `usernames` are the
   * account's email and its numeric unique ID: GKE names a caller by its email only when the token
   * has the `userinfo.email` scope, which Application Default Credentials lack, and by the ID
   * otherwise.
   */
  grantAdmin(usernames: pulumi.Input<string>[], granteeLabel: string): void {
    const subjects = usernames.map((name) => ({ apiGroup: "rbac.authorization.k8s.io", kind: "User", name }));
    new k8s.rbac.v1.RoleBinding(
      `${this.environment}-${granteeLabel}-admin`,
      {
        metadata: { namespace: this.metadata.name, name: `${granteeLabel}-admin` },
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "admin" },
        subjects,
      },
      { provider: this.provider },
    );
    new k8s.rbac.v1.RoleBinding(
      `${this.environment}-${granteeLabel}-routes`,
      {
        metadata: { namespace: this.metadata.name, name: `${granteeLabel}-routes` },
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: this.routeEditor.metadata.name },
        subjects,
      },
      { provider: this.provider },
    );
  }
}
