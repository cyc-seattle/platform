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

beforeAll(async () => {
  // Imported after setMocks, since the modules read the stack name when they load.
  const { deployDirectus } = await import("../stacks/backend/cluster.ts");
  await deployDirectus("admin@example.com", true);
  await settle();
});

describe("Directus on the cluster", () => {
  it("reads dev's license key and database password", () => {
    expect(secretReads()).toEqual(expect.arrayContaining(["dev-directus-license-key", "dev-db-directus-password"]));
  });

  it("probes /server/ping, which Directus answers without a sign-in", () => {
    expect(container("directus").readinessProbe.httpGet.path).toBe("/server/ping");
  });

  it("reads the OIDC client secret from authentik's stack in the same environment", () => {
    expect(find("pulumi:pulumi:StackReference", "organization/authentik/dev")).toBeDefined();
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
