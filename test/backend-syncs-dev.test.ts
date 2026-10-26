import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

// The syncs in backend's dev stack. backend-syncs-prod.test.ts covers prod.

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
  sqlHost: "10.1.2.5",
  gatewayAddress: "203.0.113.1",
  registry: "us-west1-docker.pkg.dev/test-project/images",
};

interface Registered {
  type: string;
  name: string;
  inputs: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const resources: Registered[] = [];

pulumi.runtime.setMocks(
  {
    newResource: ({ type, name, inputs }) => {
      resources.push({ type, name, inputs });
      const state = type === "docker-build:index:Image" ? { ...inputs, ref: `${name}@sha256:dev` } : inputs;
      return { id: `${name}-id`, state };
    },
    call: ({ token, inputs }) => {
      if (token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
        return { ...inputs, content: JSON.stringify(platform) };
      }
      if (token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess") {
        return { ...inputs, secretData: `${String(inputs["secret"])}-value` };
      }
      return inputs;
    },
  },
  "backend",
  "dev",
  false,
);
pulumi.runtime.setConfig("gcp:project", "test-project");
pulumi.runtime.setConfig("clubspot-sync:clubId", "seedClub01");
pulumi.runtime.setConfig("clubspot-sync:clubspotEmail", "dockmaster@example.test");
pulumi.runtime.setConfig("clubspot-sync:clubspotPassword", "fake-password");
pulumi.runtime.setConfig("gsuite-sync:groupOwners", "owner@example.test");
pulumi.runtime.setConfig("gsuite-sync:workspaceCustomer", "C00000000");

function find(type: string, name: string): Registered {
  const found = resources.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`No ${type} named ${name}. Registered: ${resources.map((r) => r.name).join(", ")}`);
  return found;
}

function cronJob(name: string) {
  return find("kubernetes:batch/v1:CronJob", name).inputs["spec"];
}

function env(name: string): Record<string, unknown> {
  const container = cronJob(name).jobTemplate.spec.template.spec.containers[0];
  return Object.fromEntries((container.env ?? []).map((e: { name: string; value?: unknown }) => [e.name, e.value]));
}

// The mock passes secret values through wrapped, as `{ <signature>, value }`.
function stringData(secret: string): Record<string, unknown> {
  return find("kubernetes:core/v1:Secret", secret).inputs["stringData"].value;
}

beforeAll(async () => {
  // Imported after setMocks, since the modules read the stack name when they load.
  const { loadCluster } = await import("../src/app/cluster.ts");
  const { deployClubspotSync } = await import("../stacks/backend/clubspot-sync.ts");
  const { deployGsuiteSync } = await import("../stacks/backend/gsuite-sync.ts");
  const cluster = await loadCluster();
  deployClubspotSync(cluster, "clubspot-token");
  deployGsuiteSync(cluster, "gsuite-token");
  await new Promise((resolve) => setTimeout(resolve, 200));
});

describe("The syncs on dev's cluster", () => {
  it("are suspended, so only a test's or a reset's Job runs them (cyc-seattle/isthmia#271)", () => {
    expect(cronJob("clubspot-sync")).toMatchObject({ schedule: "0 * * * *", suspend: true });
    expect(cronJob("gsuite-sync")).toMatchObject({ schedule: "30 * * * *", suspend: true });
  });

  it("build their images from the repo's Dockerfile", () => {
    for (const name of ["clubspot-sync", "gsuite-sync"]) {
      expect(find("docker-build:index:Image", name).inputs).toMatchObject({
        context: { location: "../.." },
        target: name,
      });
    }
  });

  it("run the fakes they sync with", () => {
    expect(find("kubernetes:apps/v1:Deployment", "clubspot-fake")).toBeDefined();
    expect(find("kubernetes:apps/v1:Deployment", "workspace-fake")).toBeDefined();
  });

  it("point clubspot-sync at the Clubspot fake, with its seed's login", () => {
    expect(env("clubspot-sync")).toEqual({
      CLUBSPOT_SERVER_URL: "http://clubspot-fake:1337/parse",
      CLUBSPOT_CLUB_ID: "seedClub01",
      DIRECTUS_URL: "http://directus",
    });
    expect(stringData("clubspot-sync")).toEqual({
      DIRECTUS_TOKEN: "clubspot-token",
      CLUBSPOT_EMAIL: "dockmaster@example.test",
      CLUBSPOT_PASSWORD: "fake-password",
    });
  });

  it("point gsuite-sync at the Workspace fake", () => {
    expect(env("gsuite-sync")["GSUITE_ROOT_URL"]).toBe("http://workspace-fake:8080");
    expect(stringData("gsuite-sync")).toEqual({ DIRECTUS_TOKEN: "gsuite-token" });
  });
});
