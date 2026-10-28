import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

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
  groupPolicies: { grantable: ["CRM Writer"], roles: ["Community", "Crew", "Admin"] },
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

  it("keeps its connection pool small", () => {
    expect(envNames("directus")).toMatchObject({ DB_POOL__MAX: "4", PUBLIC_URL: "https://directus.dev.example.com" });
  });

  it("leaves dev's Spot pods movable", () => {
    expect(
      find("kubernetes:apps/v1:Deployment", "directus").inputs["spec"].template.metadata.annotations,
    ).toBeUndefined();
  });
});

describe("Directus's hook extensions", () => {
  it.each(["community-query-guard", "group-policies"])("mounts %s with its config", (name) => {
    const data = find("kubernetes:core/v1:ConfigMap", `directus-${name}`).inputs["data"];
    expect(JSON.parse(data["package.json"])["directus:extension"].type).toBe("hook");
    expect(JSON.parse(data["config.json"])).toEqual(
      name === "group-policies" ? extensions.groupPolicies : extensions.queryGuard,
    );
    expect(container("directus").volumeMounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ mountPath: `/directus/extensions/${name}` })]),
    );
  });
});
