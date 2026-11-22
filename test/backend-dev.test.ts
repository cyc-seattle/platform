import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { requestsAutopilotRaises } from "./autopilot.ts";

const platform = {
  project: "test-project",
  projectNumber: "123",
  region: "us-west1",
  cluster: "cluster",
  clusterEndpoint: "cluster.example.com",
  namespace: "dev",
  gateway: { name: "gateway", namespace: "infra" },
  domain: "dev.example.com",
  sqlConnectionName: "test-project:us-west1:cyc-dev",
  sqlHost: "10.1.2.3",
  gatewayAddress: "203.0.113.1",
  registry: "us-west1-docker.pkg.dev/test-project/images",
};

interface Registered {
  type: string;
  name: string;
  inputs: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const resources: Registered[] = [];
const calls: { token: string; inputs: Record<string, unknown> }[] = [];

pulumi.runtime.setMocks(
  {
    newResource: ({ type, name, inputs }) => {
      resources.push({ type, name, inputs });
      const state =
        type === "pulumi:pulumi:StackReference"
          ? { ...inputs, outputs: { directusOidcClientSecret: "oidc-secret" } }
          : { ...inputs, result: `${name}-value`, ref: `${name}@sha256:abc` };
      return { id: `${name}-id`, state };
    },
    call: ({ token, inputs }) => {
      calls.push({ token, inputs });
      if (token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
        return { ...inputs, content: JSON.stringify(platform) };
      }
      if (token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess") {
        const secret = String(inputs["secret"]);
        return { ...inputs, secretData: secret.startsWith("dev-db-") ? "pa$$word" : "license" };
      }
      return inputs;
    },
  },
  "backend",
  "dev",
  false,
);
pulumi.runtime.setConfig("gcp:project", "test-project");
pulumi.runtime.setConfig("backend:directusCpu", "500m");

function find(type: string, name: string): Registered {
  const found = resources.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`No ${type} named ${name}. Registered: ${resources.map((r) => r.name).join(", ")}`);
  return found;
}

function container(deployment: string) {
  return find("kubernetes:apps/v1:Deployment", deployment).inputs["spec"].template.spec.containers[0];
}

function envNames(deployment: string): Record<string, unknown> {
  return Object.fromEntries(
    (container(deployment).env ?? []).map((e: { name: string; value?: unknown }) => [e.name, e.value]),
  );
}

function secretReads(): unknown[] {
  return calls
    .filter((c) => c.token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess")
    .map((c) => c.inputs["secret"]);
}

// Lets the registrations an awaited deploy queued reach the mocks.
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

const extensions = {
  queryGuard: { policies: { Crew: { people: [{ fields: "*" as const, filtered: false }] } } },
  groupPolicies: {
    grantable: ["CRM Writer"],
    roles: ["Community", "Team", "Crew", "Admin"],
    community: "Community",
    team: "Team",
    teamMonths: 12,
    signIn: [],
    authentikDir: "/directus/authentik-access",
  },
  frozenPlans: {
    rows: ["plan_offerings"],
    results: [],
    links: {},
    deletable: true,
    platformVersion: "1.0.0+engine.abc",
    decimals: {},
  },
  websitePublish: {
    collections: ["website_pages"],
    watched: {},
    folder: "website-folder",
    repository: "cyc-seattle/csc-website",
    workflow: "publish.yml",
    ref: "main",
  },
  forms: { to: "info@example.org", allowedOrigins: ["https://example.org"], siteUrl: "https://example.org", perIp: 10 },
  formsHostname: "mail.dev.example.team",
  engine: { "planning-index.mjs": "" },
};

beforeAll(async () => {
  // Imported after setMocks, since the modules read the stack name when they load.
  const { deployDirectus } = await import("../stacks/backend/cluster.ts");
  await deployDirectus("admin@example.com", true, extensions);
  await settle();
});

describe("Directus on the cluster", () => {
  it("reads dev's license key and database password", () => {
    expect(secretReads()).toEqual(expect.arrayContaining(["dev-directus-license-key", "dev-db-directus-password"]));
  });

  it("probes /server/ping, which Directus answers without a sign-in", () => {
    expect(container("directus").readinessProbe.httpGet.path).toBe("/server/ping");
  });

  it("generates its own OIDC client, and reads nothing from Authentik's stack", () => {
    expect(envNames("directus")).toMatchObject({ AUTH_AUTHENTIK_CLIENT_ID: "directus-oidc-client-id-value" });
    expect(find("kubernetes:core/v1:Secret", "directus").inputs["stringData"].value).toMatchObject({
      AUTH_AUTHENTIK_CLIENT_SECRET: "directus-oidc-client-secret-value",
    });
    expect(resources.filter((r) => r.type === "pulumi:pulumi:StackReference")).toEqual([]);
  });

  // The deepest Community rule nests deeper than the default (test/community-rules.test.ts), and
  // crm.feature shows it still resolves (cyc-seattle/isthmia#175).
  it("leaves MAX_RELATIONAL_DEPTH at Directus's default", () => {
    expect(envNames("directus")).not.toHaveProperty("MAX_RELATIONAL_DEPTH");
  });

  it("uses Directus's default connection pool", () => {
    expect(envNames("directus")).toMatchObject({ DB_POOL__MAX: "10", PUBLIC_URL: "https://directus.dev.example.com" });
  });

  it("keeps uploaded files in dev's bucket", () => {
    expect(envNames("directus")).toMatchObject({ STORAGE_GCS_BUCKET: "test-project-directus-files-dev" });
  });

  it("has no key to publish the website with", () => {
    expect(secretReads()).not.toContain("csc-website-publish-key");
    expect(find("kubernetes:core/v1:Secret", "directus").inputs["stringData"].value).not.toHaveProperty(
      "WEBSITE_PUBLISH_PRIVATE_KEY",
    );
  });

  it("logs only warnings and errors", () => {
    expect(envNames("directus")).toMatchObject({ LOG_LEVEL: "warn" });
  });

  it("asks for half a vCPU and bursts to 1 for a reset", () => {
    expect(
      find("kubernetes:apps/v1:Deployment", "directus").inputs["spec"].template.spec.containers[0].resources,
    ).toEqual({ requests: { cpu: "500m", memory: "768Mi" }, limits: { cpu: "1", memory: "768Mi" } });
  });

  it("leaves dev's Spot pods movable", () => {
    expect(
      find("kubernetes:apps/v1:Deployment", "directus").inputs["spec"].template.metadata.annotations,
    ).toBeUndefined();
  });
});

describe("Directus's extensions", () => {
  it.each([
    ["community-query-guard", extensions.queryGuard],
    ["group-policies", extensions.groupPolicies],
    ["frozen-plans", extensions.frozenPlans],
    ["school-choice", {}],
    ["link-preview", {}],
    ["website-publish", extensions.websitePublish],
  ])("mounts %s with its config", (name, config) => {
    const data = find("kubernetes:core/v1:ConfigMap", `directus-${name}`).inputs["data"];
    expect(JSON.parse(data["package.json"])["directus:extension"].type).toBe("hook");
    expect(JSON.parse(data["config.json"])).toEqual(config);
    expect(container("directus").volumeMounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ mountPath: `/directus/extensions/${name}` })]),
    );
  });

  it("mounts the website's forms as an endpoint, with their config", () => {
    const data = find("kubernetes:core/v1:ConfigMap", "directus-forms").inputs["data"];
    expect(JSON.parse(data["package.json"])["directus:extension"].type).toBe("endpoint");
    expect(JSON.parse(data["config.json"])).toEqual(extensions.forms);
  });

  it("routes only /forms/ on the forms' public address to Directus", () => {
    expect(find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "directus-forms").inputs["spec"]).toMatchObject({
      hostnames: ["mail.dev.example.team"],
      rules: [
        {
          matches: [{ path: { type: "PathPrefix", value: "/forms/" } }],
          backendRefs: [{ name: "directus", port: 80 }],
        },
      ],
    });
  });

  it("sends mail to dev's Mailpit", () => {
    expect(envNames("directus")).toMatchObject({
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "noreply@cyccommunitysailing.org",
      EMAIL_SMTP_HOST: "mailpit",
      EMAIL_SMTP_PORT: "1025",
    });
  });

  it("mounts the Secret the authentik stack writes for the group-policies hook, and starts without it", () => {
    const spec = find("kubernetes:apps/v1:Deployment", "directus").inputs["spec"].template.spec;
    expect(spec.volumes).toEqual(
      expect.arrayContaining([
        { name: "authentik-access", secret: { secretName: "directus-authentik-access", optional: true } },
      ]),
    );
    expect(container("directus").volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "authentik-access", mountPath: extensions.groupPolicies.authentikDir, readOnly: true },
      ]),
    );
  });

  it("mounts the display that shows cents as dollars, with no config", () => {
    const data = find("kubernetes:core/v1:ConfigMap", "directus-cents-as-dollars").inputs["data"];
    expect(JSON.parse(data["package.json"])["directus:extension"].type).toBe("display");
    expect(data["config.json"]).toBeUndefined();
    expect(container("directus").volumeMounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ mountPath: "/directus/extensions/cents-as-dollars" })]),
    );
  });

  it("ask for at least what Autopilot gives a pod it won't evict", () => {
    expect(requestsAutopilotRaises(resources)).toEqual([]);
  });
});
