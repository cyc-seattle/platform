import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";

// Prod's Directus on the cluster keeps what it had on the VM (cyc-seattle/isthmia#231).
// backend-dev.test.ts covers dev.

const platform = {
  project: "test-project",
  projectNumber: "123",
  region: "us-west1",
  cluster: "cluster",
  clusterEndpoint: "cluster.example.com",
  namespace: "prod",
  gateway: { name: "gateway", namespace: "infra" },
  domain: "example.com",
  sqlConnectionName: "test-project:us-west1:prod-sql",
  sqlHost: "10.1.2.3",
  gatewayAddress: "203.0.113.1",
  registry: "us-west1-docker.pkg.dev/test-project/images",
};

interface Registered {
  type: string;
  name: string;
  inputs: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  opts: Record<string, unknown>;
}

const resources: Registered[] = [];
const secretReads: unknown[] = [];

pulumi.runtime.setMocks(
  {
    newResource: ({ type, name, inputs }) => {
      resources.push({ type, name, inputs, opts: {} });
      const state =
        type === "pulumi:pulumi:StackReference"
          ? {
              ...inputs,
              outputs: {
                directusOidcClientSecret: "oidc-secret",
                internalDomain: "example.com",
                publicIp: "198.51.100.7",
                directusBaseUrl: "https://directus.example.com",
                internalZoneName: "zone",
                postgresInstanceName: "prod-sql",
              },
            }
          : { ...inputs, hex: `${name}-hex`, result: `${name}-value`, roleId: `${name}-role-id` };
      return { id: `${name}-id`, state };
    },
    call: ({ token, inputs }) => {
      if (token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
        return { ...inputs, content: JSON.stringify(platform) };
      }
      if (token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess") {
        secretReads.push(inputs["secret"]);
        return { ...inputs, secretData: "license" };
      }
      return inputs;
    },
  },
  "backend",
  "prod",
  false,
);
pulumi.runtime.setConfig("gcp:project", "test-project");
pulumi.runtime.setConfig("backend:safeToEvict", "false");

function find(type: string, name: string): Registered {
  const found = resources.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`No ${type} named ${name}. Registered: ${resources.map((r) => r.name).join(", ")}`);
  return found;
}

function container() {
  return find("kubernetes:apps/v1:Deployment", "directus").inputs["spec"].template.spec;
}

/** A Secret's data, which the mocks see wrapped as a secret when any value in it is one. */
function stringData(name: string): Record<string, unknown> {
  const data = find("kubernetes:core/v1:Secret", name).inputs["stringData"];
  return "value" in data ? data.value : data;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

const extensions = {
  queryGuard: { policies: { Crew: { people: [{ fields: "*" as const, filtered: false }] } } },
  groupPolicies: { grantable: ["CRM Writer"], roles: ["Community", "Crew", "Admin"] },
  savedVersions: { versioned: ["plan_offerings"], links: {}, deletable: false },
};

beforeAll(async () => {
  const { prodDirectus } = await import("../stacks/backend/prod-state.ts");
  const { deployDirectus } = await import("../stacks/backend/cluster.ts");
  const prod = prodDirectus({
    adminEmail: "admin@example.com",
    admins: [],
    externalDomain: "example.org",
    baseUrl: "https://directus.example.com",
  });
  await deployDirectus("admin@example.com", true, extensions, prod.values);
  await settle();
});

describe("prod's Directus on the cluster", () => {
  it("runs one replica that Autopilot won't move to consolidate nodes", () => {
    const { spec } = find("kubernetes:apps/v1:Deployment", "directus").inputs;
    expect(spec.replicas).toBe(1);
    expect(spec.template.metadata.annotations).toEqual({ "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" });
  });

  it("points directus. at the Gateway", () => {
    const records = resources.filter((r) => r.type === "gcp:dns/recordSet:RecordSet");
    expect(records.map((r) => r.inputs)).toEqual([
      expect.objectContaining({ name: "directus.example.com.", rrdatas: [platform.gatewayAddress] }),
    ]);
  });

  it("keeps the VM's keys and database password", () => {
    expect(stringData("directus")).toMatchObject({
      KEY: "directus-key-value-hex",
      SECRET: "directus-secret-value-hex",
      ADMIN_PASSWORD: "directus-admin-bootstrap-password-value-hex",
      LICENSE_KEY: "license",
    });
    expect(stringData("directus-db")).toMatchObject({
      password: "directus-db-password-value-hex",
      host: platform.sqlHost,
    });
  });

  it("generates no second database user, key, password, Community role ID, or OIDC client", () => {
    expect(resources.filter((r) => r.type === "gcp:sql/user:User").map((r) => r.name)).toEqual(["directus-user"]);
    const generated = resources.filter((r) => r.type.startsWith("random:") && !r.type.endsWith("RandomBytes"));
    expect(generated.map((r) => r.name)).toEqual([]);
  });

  it("keeps the OIDC client Authentik generated, so sign-in never breaks", () => {
    const env = Object.fromEntries(
      container().containers[0].env.map((e: { name: string; value?: unknown }) => [e.name, e.value]),
    );
    expect(env["AUTH_AUTHENTIK_CLIENT_ID"]).toBe("directus");
    expect(stringData("directus")).toMatchObject({
      AUTH_AUTHENTIK_CLIENT_SECRET: "directus-oidc-client-secret-value-hex",
    });
  });

  it("reads prod's license key", () => {
    expect(secretReads).toEqual(["directus-license-key"]);
  });

  it("names the existing Community role as the default", () => {
    const env = Object.fromEntries(
      container().containers[0].env.map((e: { name: string; value?: unknown }) => [e.name, e.value]),
    );
    expect(env).toMatchObject({
      AUTH_AUTHENTIK_DEFAULT_ROLE_ID: "crm-community-role-id",
      PUBLIC_URL: "https://directus.example.com",
      DB_POOL__MAX: "10",
    });
  });

  it("runs on regular capacity, bursting to 1 vCPU", () => {
    expect(container().nodeSelector).toEqual({});
    expect(container().containers[0].resources).toEqual({
      requests: { cpu: "250m", memory: "768Mi" },
      limits: { cpu: "1", memory: "768Mi" },
    });
  });

  it("keeps Directus's info logs", () => {
    expect(container().containers[0].env.map((e: { name: string }) => e.name)).not.toContain("LOG_LEVEL");
  });
});

describe("prod's saved plan versions", () => {
  it("can't be deleted: the stack refuses the flag that lets dev's tests delete them", async () => {
    const { deployDirectus } = await import("../stacks/backend/cluster.ts");
    const deletable = { ...extensions, savedVersions: { ...extensions.savedVersions, deletable: true } };
    await expect(deployDirectus("admin@example.com", true, deletable)).rejects.toThrow(/dev's tests only/);
  });

  it("aren't made deletable by prod's config", () => {
    const file = path.join(import.meta.dirname, "../stacks/backend/Pulumi.prod.yaml");
    const { config } = yaml.load(fs.readFileSync(file, "utf8")) as { config: Record<string, unknown> };
    expect(config["backend:savedVersionsDeletable"]).toBeUndefined();
  });
});
