import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byName = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)!.inputs;

const deployDevEmail = "deploy-dev@example-project.iam.gserviceaccount.com";

const stackOutputs: Record<string, Record<string, unknown>> = {
  "organization/bootstrap/prod": {
    gkeNodes: { email: "gke-nodes@example-project.iam.gserviceaccount.com" },
    deployDev: { email: deployDevEmail },
    stateBackends: {
      dev: { url: "gs://example-project-pulumi-dev" },
      prod: { url: "gs://example-project-pulumi-prod" },
    },
  },
  "organization/cloud/prod": {
    networkId: "network_id",
    clusterSubnetId: "cluster_subnet_id",
    clusterPodsRangeName: "pods",
    clusterServicesRangeName: "services",
    internalZoneName: "internal-zone",
    internalDomain: "example.team",
    devPostgresConnectionName: "example-project:us-west1:cyc-dev",
    artifactRepositoryUrl: "us-west1-docker.pkg.dev/example-project/artifact-docker-repository",
  },
};

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        if (args.type === "pulumi:pulumi:StackReference") {
          return { id: args.name, state: { outputs: stackOutputs[args.name] } };
        }
        if (args.type === "gcp:container/cluster:Cluster") {
          const state = {
            ...args.inputs,
            controlPlaneEndpointsConfig: { dnsEndpointConfig: { endpoint: "gke-example.us-west1.gke.goog" } },
          };
          return { id: `${args.name}_id`, state };
        }
        if (args.type === "gcp:certificatemanager/dnsAuthorization:DnsAuthorization") {
          const challenge = { name: "_acme-challenge.dev.example.team.", type: "CNAME", data: "challenge.example." };
          return { id: `${args.name}_id`, state: { ...args.inputs, dnsResourceRecords: [challenge] } };
        }
        // Stands in for Pulumi's autonaming.
        const name = args.type.startsWith("gcp:") ? { name: `${args.name}_name` } : {};
        return { id: `${args.name}_id`, state: { ...name, ...args.inputs } };
      },
      call: (args) => {
        switch (args.token) {
          case "gcp:organizations/getClientConfig:getClientConfig":
            return { accessToken: "token" };
          case "gcp:organizations/getProject:getProject":
            return { ...args.inputs, number: "123456789" };
          default:
            return args.inputs;
        }
      },
    },
    "cluster",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("cluster:bootstrapStack", "organization/bootstrap/prod");
  pulumi.runtime.setConfig("cluster:cloudStack", "organization/cloud/prod");
  // The modules build their resources on import, so they load only after the mocks are set.
  await import("../stacks/cluster/index.js");
  await new Promise((r) => setImmediate(r));
});

describe("cluster", () => {
  const cluster = () => byName("gcp:container/cluster:Cluster", "cyc");

  it("is Autopilot on the Regular channel, with private nodes run as gke-nodes", () => {
    expect(cluster()).toMatchObject({
      name: "cyc",
      location: "us-west1",
      enableAutopilot: true,
      releaseChannel: { channel: "REGULAR" },
      privateClusterConfig: { enablePrivateNodes: true },
      clusterAutoscaling: {
        autoProvisioningDefaults: { serviceAccount: "gke-nodes@example-project.iam.gserviceaccount.com" },
      },
      deletionProtection: true,
    });
  });

  it("has only the DNS-based control-plane endpoint", () => {
    expect(cluster().controlPlaneEndpointsConfig).toEqual({
      dnsEndpointConfig: { allowExternalTraffic: true },
      ipEndpointsConfig: { enabled: false },
    });
  });

  it("serves the Gateway API's standard channel", () => {
    expect(cluster().gatewayApiConfig).toEqual({ channel: "CHANNEL_STANDARD" });
  });

  it("uses the cloud stack's subnet and ranges", () => {
    expect(cluster()).toMatchObject({
      subnetwork: "cluster_subnet_id",
      ipAllocationPolicy: { clusterSecondaryRangeName: "pods", servicesSecondaryRangeName: "services" },
    });
  });
});

describe("Gateway", () => {
  const gateway = () => byName("kubernetes:gateway.networking.k8s.io/v1:Gateway", "shared");
  const listener = (name: string) => gateway().spec.listeners.find((l: { name: string }) => l.name === name);

  it("is the global external managed class on the static address, with the certificate map", () => {
    expect(gateway()).toMatchObject({
      metadata: { name: "shared", namespace: "gateway", annotations: { "networking.gke.io/certmap": "gateway_name" } },
      spec: {
        gatewayClassName: "gke-l7-global-external-managed",
        addresses: [{ type: "NamedAddress", value: "gateway_name" }],
      },
    });
  });

  it("admits only routes from its own namespace on HTTP", () => {
    expect(listener("http")).toEqual({
      name: "http",
      protocol: "HTTP",
      port: 80,
      allowedRoutes: { namespaces: { from: "Same" } },
    });
  });

  it("only redirects HTTP to HTTPS", () => {
    const routes = created.filter((r) => r.type === "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute");
    expect(routes.map((r) => r.inputs)).toEqual([
      {
        apiVersion: "gateway.networking.k8s.io/v1",
        kind: "HTTPRoute",
        metadata: { name: "http-redirect", namespace: "gateway" },
        spec: {
          parentRefs: [{ name: "shared", sectionName: "http" }],
          rules: [{ filters: [{ type: "RequestRedirect", requestRedirect: { scheme: "https", statusCode: 301 } }] }],
        },
      },
    ]);
  });

  it.each([
    ["https-dev", "dev.example.team"],
    ["https-dev-wildcard", "*.dev.example.team"],
  ])("admits %s routes only from namespaces labeled dev", (name: string, hostname: string) => {
    expect(listener(name)).toEqual({
      name,
      hostname,
      protocol: "HTTPS",
      port: 443,
      allowedRoutes: {
        kinds: [{ kind: "HTTPRoute" }],
        namespaces: { from: "Selector", selector: { matchLabels: { "cycsail.team/environment": "dev" } } },
      },
    });
  });

  it("has no other listeners", () => {
    expect(gateway().spec.listeners.map((l: { name: string }) => l.name)).toEqual([
      "http",
      "https-dev",
      "https-dev-wildcard",
    ]);
  });
});

describe("dev certificate and DNS", () => {
  it("covers the domain and its subdomains", () => {
    expect(byName("gcp:certificatemanager/certificate:Certificate", "dev")).toMatchObject({
      managed: { domains: ["dev.example.team", "*.dev.example.team"], dnsAuthorizations: ["dev_id"] },
    });
  });

  it("proves control of the domain with the authorization's CNAME", () => {
    expect(byName("gcp:dns/recordSet:RecordSet", "dev-dns-authorization")).toMatchObject({
      managedZone: "internal-zone",
      name: "_acme-challenge.dev.example.team.",
      type: "CNAME",
      rrdatas: ["challenge.example."],
    });
  });

  it.each([
    ["dev", "dev.example.team."],
    ["dev-wildcard", "*.dev.example.team."],
  ])("points %s at the Gateway's address", (name: string, dnsName: string) => {
    expect(byName("gcp:dns/recordSet:RecordSet", name)).toMatchObject({
      managedZone: "internal-zone",
      name: dnsName,
      type: "A",
    });
  });
});

describe("dev namespace", () => {
  const ofDev = (type: string) => created.filter((r) => r.type === type && r.inputs.metadata?.namespace === "dev");

  it("carries the environment label and the restricted Pod Security Standard", () => {
    expect(byName("kubernetes:core/v1:Namespace", "dev").metadata).toEqual({
      name: "dev",
      labels: { "cycsail.team/environment": "dev", "pod-security.kubernetes.io/enforce": "restricted" },
    });
  });

  it("caps total requests and allows no load balancer or node port", () => {
    const [quota] = ofDev("kubernetes:core/v1:ResourceQuota");
    expect(quota!.inputs.spec.hard).toEqual({
      "requests.cpu": "2",
      "requests.memory": "6Gi",
      pods: "20",
      "services.loadbalancers": "0",
      "services.nodeports": "0",
    });
  });

  it("defaults and caps each container's requests", () => {
    const [limitRange] = ofDev("kubernetes:core/v1:LimitRange");
    expect(limitRange!.inputs.spec.limits).toEqual([
      {
        type: "Container",
        default: { cpu: "250m", memory: "512Mi" },
        defaultRequest: { cpu: "250m", memory: "512Mi" },
        max: { cpu: "1", memory: "2Gi" },
      },
    ]);
  });

  it("denies ingress from other namespaces, except the load balancer's, on any port", () => {
    const [policy] = ofDev("kubernetes:networking.k8s.io/v1:NetworkPolicy");
    expect(policy!.inputs.spec).toEqual({
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        { from: [{ podSelector: {} }] },
        { from: [{ ipBlock: { cidr: "35.191.0.0/16" } }, { ipBlock: { cidr: "130.211.0.0/22" } }] },
      ],
    });
  });

  const bindings = () =>
    created.filter((r) => r.type === "kubernetes:rbac.authorization.k8s.io/v1:RoleBinding").map((r) => r.inputs);
  const deployDev = [{ apiGroup: "rbac.authorization.k8s.io", kind: "User", name: deployDevEmail }];

  it("binds admin to deploy-dev in dev only", () => {
    expect(bindings()).toContainEqual({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: { namespace: "dev", name: "deploy-dev-admin" },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "admin" },
      subjects: deployDev,
    });
  });

  it("lets deploy-dev edit HTTPRoutes and HealthCheckPolicies in dev only", () => {
    const [role] = created.filter((r) => r.type === "kubernetes:rbac.authorization.k8s.io/v1:Role");
    expect(role!.inputs.metadata).toEqual({ namespace: "dev", name: "route-editor" });
    expect(role!.inputs.rules).toEqual([
      expect.objectContaining({ apiGroups: ["gateway.networking.k8s.io"], resources: ["httproutes"] }),
      expect.objectContaining({ apiGroups: ["networking.gke.io"], resources: ["healthcheckpolicies"] }),
    ]);
    for (const rule of role!.inputs.rules) {
      expect(rule.verbs).toEqual(expect.arrayContaining(["create", "patch", "delete"]));
    }
    expect(bindings()).toContainEqual({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: { namespace: "dev", name: "deploy-dev-routes" },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "route-editor" },
      subjects: deployDev,
    });
  });

  it("grants deploy-dev nothing cluster-wide or in another namespace", () => {
    expect(created.map((r) => r.type)).not.toContain("kubernetes:rbac.authorization.k8s.io/v1:ClusterRoleBinding");
    expect(bindings()).toHaveLength(2);
    for (const binding of bindings()) {
      expect(binding.metadata.namespace).toBe("dev");
    }
  });
});

describe("dev platform outputs", () => {
  const object = () => byName("gcp:storage/bucketObject:BucketObject", "dev-platform-outputs");

  it("lives at platform/outputs.json in dev's state bucket", () => {
    expect(object()).toMatchObject({
      bucket: "example-project-pulumi-dev",
      name: "platform/outputs.json",
      contentType: "application/json",
    });
  });

  it("holds every platform value, and nothing else", () => {
    // The provider marks an object's content secret.
    expect(JSON.parse(object().content.value)).toEqual({
      project: "example-project",
      projectNumber: "123456789",
      region: "us-west1",
      cluster: "cyc",
      clusterEndpoint: "gke-example.us-west1.gke.goog",
      namespace: "dev",
      gateway: { name: "shared", namespace: "gateway" },
      domain: "dev.example.team",
      sqlConnectionName: "example-project:us-west1:cyc-dev",
      registry: "us-west1-docker.pkg.dev/example-project/artifact-docker-repository",
    });
  });
});
