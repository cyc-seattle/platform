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
const deployDevId = "114358314096459279273";

const stackOutputs: Record<string, Record<string, unknown>> = {
  "organization/bootstrap/prod": {
    gkeNodes: { email: "gke-nodes@example-project.iam.gserviceaccount.com" },
    deployDev: { email: deployDevEmail, uniqueId: deployDevId },
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
    devPostgresPrivateIp: "10.159.0.6",
    postgresConnectionName: "example-project:us-west1:substrate-1234",
    postgresPrivateIp: "10.159.0.5",
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
        if (args.type === "gcp:compute/globalAddress:GlobalAddress") {
          return {
            id: `${args.name}_id`,
            state: { ...args.inputs, name: `${args.name}_name`, address: "203.0.113.10" },
          };
        }
        if (args.type === "gcp:certificatemanager/dnsAuthorization:DnsAuthorization") {
          const challenge = {
            name: `_acme-challenge.${args.inputs.domain}.`,
            type: "CNAME",
            data: "challenge.example.",
          };
          return { id: `${args.name}_id`, state: { ...args.inputs, dnsResourceRecords: [challenge] } };
        }
        // Stands in for Pulumi's autonaming.
        const name = args.type.startsWith("gcp:") ? { name: `${args.name}_name` } : {};
        return { id: `${args.name}_id`, state: { ...name, ...args.inputs } };
      },
      call: (args) => {
        switch (args.token) {
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
  pulumi.runtime.setConfig("cluster:alertEmails", JSON.stringify(["alerts@example.org"]));
  // The modules build their resources on import, so they load only after the mocks are set.
  await import("../stacks/cluster/index.ts");
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

  it("declares the private endpoint GKE sets when there is no IP endpoint", () => {
    expect(cluster().privateClusterConfig).toEqual({ enablePrivateNodes: true, enablePrivateEndpoint: true });
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

describe("Kubernetes provider", () => {
  // Renaming it would replace every Kubernetes resource in the stack.
  const provider = () => byName("pulumi:providers:kubernetes", "cyc");

  it("keeps its name, and is pinned to the cluster", () => {
    expect(provider().clusterIdentifier).toBe("cyc_id");
  });

  it("talks to the cluster's DNS endpoint through the auth plugin, with no token in its kubeconfig", () => {
    // A token would change the kubeconfig, and so the provider, on every run.
    expect(JSON.parse(provider().kubeconfig)).toMatchObject({
      clusters: [{ cluster: { server: "https://gke-example.us-west1.gke.goog" } }],
      users: [
        { user: { exec: { command: "gke-gcloud-auth-plugin", args: ["--use_application_default_credentials"] } } },
      ],
    });
    expect(provider().kubeconfig).not.toContain("token");
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
    ["https-dev", "dev.example.team", "dev"],
    ["https-dev-wildcard", "*.dev.example.team", "dev"],
    ["https-prod", "example.team", "prod"],
    ["https-prod-wildcard", "*.example.team", "prod"],
  ])("admits %s routes only from namespaces labeled %s", (name: string, hostname: string, environment: string) => {
    expect(listener(name)).toEqual({
      name,
      hostname,
      protocol: "HTTPS",
      port: 443,
      allowedRoutes: {
        kinds: [{ kind: "HTTPRoute" }],
        namespaces: { from: "Selector", selector: { matchLabels: { "cycsail.team/environment": environment } } },
      },
    });
  });

  it("has no other listeners", () => {
    expect(gateway().spec.listeners.map((l: { name: string }) => l.name)).toEqual([
      "http",
      "https-dev",
      "https-dev-wildcard",
      "https-prod",
      "https-prod-wildcard",
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

describe("prod certificate and DNS", () => {
  it("covers the domain and its subdomains", () => {
    expect(byName("gcp:certificatemanager/certificate:Certificate", "prod")).toMatchObject({
      managed: { domains: ["example.team", "*.example.team"], dnsAuthorizations: ["prod_id"] },
    });
  });

  it("proves control of the domain with the authorization's CNAME", () => {
    expect(byName("gcp:dns/recordSet:RecordSet", "prod-dns-authorization")).toMatchObject({
      managedZone: "internal-zone",
      name: "_acme-challenge.example.team.",
      type: "CNAME",
    });
  });

  it.each([
    ["prod", "example.team"],
    ["prod-wildcard", "*.example.team"],
  ])("maps %s to the certificate", (name: string, hostname: string) => {
    expect(byName("gcp:certificatemanager/certificateMapEntry:CertificateMapEntry", name)).toMatchObject({
      map: "gateway_name",
      hostname,
      certificates: ["prod_id"],
    });
  });

  it("writes no A records, which the apps own", () => {
    const records = created.filter((r) => r.type === "gcp:dns/recordSet:RecordSet" && r.inputs.type === "A");
    expect(records.map((r) => r.name).sort()).toEqual(["dev", "dev-wildcard"]);
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
      "requests.cpu": "4",
      "requests.memory": "10Gi",
      pods: "30",
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

  const policy = (name: string) => byName("kubernetes:networking.k8s.io/v1:NetworkPolicy", name);

  it("denies ingress from other namespaces, except the load balancer's, on any port", () => {
    expect(policy("dev-isolation").spec).toEqual({
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        { from: [{ podSelector: {} }] },
        { from: [{ ipBlock: { cidr: "35.191.0.0/16" } }, { ipBlock: { cidr: "130.211.0.0/22" } }] },
      ],
    });
  });

  it("admits the API's proxy from the konnectivity agents only", () => {
    expect(policy("dev-api-proxy")).toMatchObject({
      metadata: { namespace: "dev", name: "allow-api-proxy" },
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
    });
  });

  it("allows egress to the cluster on any port, and outside it on all but the mail ports", () => {
    expect(policy("dev-mail-egress")).toMatchObject({
      metadata: { namespace: "dev", name: "deny-mail-egress" },
      spec: {
        podSelector: {},
        policyTypes: ["Egress"],
        egress: [
          { to: [{ namespaceSelector: {} }] },
          {
            ports: [
              { protocol: "TCP", port: 1, endPort: 24 },
              { protocol: "TCP", port: 26, endPort: 464 },
              { protocol: "TCP", port: 466, endPort: 586 },
              { protocol: "TCP", port: 588, endPort: 65535 },
              { protocol: "UDP" },
            ],
          },
        ],
      },
    });
  });

  const bindings = () =>
    created.filter((r) => r.type === "kubernetes:rbac.authorization.k8s.io/v1:RoleBinding").map((r) => r.inputs);
  // GKE names a caller by its numeric ID when the token lacks the email scope, as ADC's does.
  const deployDev = [
    { apiGroup: "rbac.authorization.k8s.io", kind: "User", name: deployDevEmail },
    { apiGroup: "rbac.authorization.k8s.io", kind: "User", name: deployDevId },
  ];

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
      sqlHost: "10.159.0.6",
      gatewayAddress: "203.0.113.10",
      registry: "us-west1-docker.pkg.dev/example-project/artifact-docker-repository",
    });
  });
});

describe("prod namespace", () => {
  const ofProd = (type: string) => created.filter((r) => r.type === type && r.inputs.metadata?.namespace === "prod");

  it("carries the environment label and the restricted Pod Security Standard", () => {
    expect(byName("kubernetes:core/v1:Namespace", "prod").metadata).toEqual({
      name: "prod",
      labels: { "cycsail.team/environment": "prod", "pod-security.kubernetes.io/enforce": "restricted" },
    });
  });

  it("caps total requests and allows no load balancer or node port", () => {
    const [quota] = ofProd("kubernetes:core/v1:ResourceQuota");
    expect(quota!.inputs.spec.hard).toEqual({
      "requests.cpu": "3",
      "requests.memory": "8Gi",
      pods: "20",
      "services.loadbalancers": "0",
      "services.nodeports": "0",
    });
  });

  it("defaults and caps each container's requests", () => {
    const [limitRange] = ofProd("kubernetes:core/v1:LimitRange");
    expect(limitRange!.inputs.spec.limits).toEqual([
      {
        type: "Container",
        default: { cpu: "250m", memory: "512Mi" },
        defaultRequest: { cpu: "250m", memory: "512Mi" },
        max: { cpu: "2", memory: "4Gi" },
      },
    ]);
  });

  it("denies ingress from other namespaces, and has no other policy", () => {
    const policies = ofProd("kubernetes:networking.k8s.io/v1:NetworkPolicy");
    expect(policies.map((p) => p.inputs.metadata.name)).toEqual(["deny-other-namespaces"]);
  });

  it("binds no one, because deploy-runner's container.admin covers it", () => {
    expect(ofProd("kubernetes:rbac.authorization.k8s.io/v1:RoleBinding")).toEqual([]);
  });
});

describe("prod platform outputs", () => {
  const object = () => byName("gcp:storage/bucketObject:BucketObject", "prod-platform-outputs");

  it("lives at platform/outputs.json in prod's state bucket", () => {
    expect(object()).toMatchObject({ bucket: "example-project-pulumi-prod", name: "platform/outputs.json" });
  });

  it("holds prod's values", () => {
    expect(JSON.parse(object().content.value)).toEqual({
      project: "example-project",
      projectNumber: "123456789",
      region: "us-west1",
      cluster: "cyc",
      clusterEndpoint: "gke-example.us-west1.gke.goog",
      namespace: "prod",
      gateway: { name: "shared", namespace: "gateway" },
      domain: "example.team",
      sqlConnectionName: "example-project:us-west1:substrate-1234",
      sqlHost: "10.159.0.5",
      gatewayAddress: "203.0.113.10",
      registry: "us-west1-docker.pkg.dev/example-project/artifact-docker-repository",
    });
  });
});

describe("Job alerts", () => {
  const policy = (name: string) => byName("gcp:monitoring/alertPolicy:AlertPolicy", name);

  it("email each address in alertEmails, kept secret and out of the names", () => {
    const channel = byName("gcp:monitoring/notificationChannel:NotificationChannel", "alerts-0");
    expect(channel).toMatchObject({ type: "email", displayName: "Prod alerts 1" });
    // A secret reaches the mocks wrapped with Pulumi's secret signature.
    expect(channel.labels).toMatchObject({
      [pulumi.runtime.specialSigKey]: pulumi.runtime.specialSecretSig,
      value: { email_address: "alerts@example.org" },
    });
    for (const name of ["job-failed", "cronjob-absent"]) {
      expect(policy(name).notificationChannels).toEqual(["alerts-0_name"]);
    }
  });

  it("alert on a prod Job that runs out of retries or time", () => {
    const [condition] = policy("job-failed").conditions;
    const filter: string = condition.conditionMatchedLog.filter;
    expect(filter).toContain('logName="projects/example-project/logs/events"');
    expect(filter).toContain('resource.labels.cluster_name="cyc"');
    expect(filter).toContain('jsonPayload.involvedObject.namespace="prod"');
    expect(filter).toContain('jsonPayload.involvedObject.kind="Job"');
    expect(filter).toContain('jsonPayload.reason=("BackoffLimitExceeded" OR "DeadlineExceeded")');
    expect(condition.conditionMatchedLog.labelExtractors).toMatchObject({
      job: "EXTRACT(jsonPayload.involvedObject.name)",
    });
    expect(policy("job-failed").alertStrategy.notificationRateLimit).toEqual({ period: "300s" });
  });

  it("count each prod CronJob's successful Jobs", () => {
    const metric = byName("gcp:logging/metric:Metric", "cronjob-succeeded");
    expect(metric.filter).toContain('jsonPayload.involvedObject.namespace="prod"');
    expect(metric.filter).toContain('jsonPayload.reason="SawCompletedJob"');
    expect(metric.filter).toContain('jsonPayload.message=~": Complete$"');
    expect(metric.labelExtractors).toEqual({ cronjob: "EXTRACT(jsonPayload.involvedObject.name)" });
  });

  it("alert on each CronJob with no successful Job in 3 hours", () => {
    const [condition] = policy("cronjob-absent").conditions;
    expect(condition.conditionAbsent).toMatchObject({
      filter: 'metric.type="logging.googleapis.com/user/prod-cronjob-succeeded" AND resource.type="k8s_cluster"',
      duration: "10800s",
    });
    // A cross-series reducer would merge the CronJobs into one series.
    expect(condition.conditionAbsent.aggregations[0].crossSeriesReducer).toBeUndefined();
  });
});
