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
  custom: boolean;
}

const resources: Registered[] = [];
const calls: { token: string; inputs: Record<string, unknown> }[] = [];

pulumi.runtime.setMocks(
  {
    newResource: ({ type, name, inputs, custom }) => {
      resources.push({ type, name, inputs, custom: custom ?? true });
      const state =
        type === "kubernetes:core/v1:Service" && name === "greenmail-service"
          ? { spec: { clusterIP: "10.3.0.7" } }
          : { ...inputs, base64: `${name}-base64`, result: `${name}-value`, ref: `${name}@sha256:abc` };
      return { id: `${name}-id`, state };
    },
    call: ({ token, inputs }) => {
      calls.push({ token, inputs });
      if (token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
        return { ...inputs, content: JSON.stringify(platform) };
      }
      if (token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess") {
        return { ...inputs, secretData: "pa$$word" };
      }
      return inputs;
    },
  },
  "inbox",
  "dev",
  false,
);
pulumi.runtime.setConfig("gcp:project", "test-project");

function find(type: string, name: string): Registered {
  const found = resources.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`No ${type} named ${name}. Registered: ${resources.map((r) => r.name).join(", ")}`);
  return found;
}

function pod(deployment: string) {
  return find("kubernetes:apps/v1:Deployment", deployment).inputs["spec"].template.spec;
}

function env(deployment: string): Record<string, unknown> {
  return Object.fromEntries(
    (pod(deployment).containers[0].env ?? []).map((e: { name: string; value?: unknown }) => [e.name, e.value]),
  );
}

// Lets the registrations an awaited deploy queued reach the mocks.
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

beforeAll(async () => {
  // Imported after setMocks, since the modules read the stack name when they load.
  const { deployInbox } = await import("../stacks/inbox/cluster.ts");
  await deployInbox("admin@example.com", "inbox@example.com");
  await settle();
});

describe("the shared inbox in dev", () => {
  it("uses the database platform made in dev, creating none of its own", () => {
    expect(resources.filter((r) => r.type.startsWith("gcp:sql/"))).toEqual([]);
    expect(
      calls
        .filter((c) => c.token === "gcp:secretmanager/getSecretVersionAccess:getSecretVersionAccess")
        .map((c) => c.inputs["secret"]),
    ).toContain("dev-db-inbox-password");
    expect(env("inbox")).toMatchObject({ DB_CONNECTION: "pgsql", DB_HOST: "10.1.2.3", DB_DATABASE: "inbox" });
  });

  it("serves inbox.<domain>", () => {
    const route = find("kubernetes:gateway.networking.k8s.io/v1:HTTPRoute", "inbox");
    expect(route.inputs["spec"].hostnames).toEqual(["inbox.dev.example.com"]);
    expect(env("inbox")).toMatchObject({ APP_URL: "https://inbox.dev.example.com" });
  });

  it("runs as www-data, which owns the disk, and stops the old pod before starting a new one", () => {
    expect(pod("inbox").securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 82, fsGroup: 82 });
    expect(pod("inbox").containers[0].securityContext).toMatchObject({ readOnlyRootFilesystem: true });
    expect(find("kubernetes:apps/v1:Deployment", "inbox").inputs["spec"].strategy).toEqual({ type: "Recreate" });
  });

  it("keeps its data on a protected disk", () => {
    const claim = find("kubernetes:core/v1:PersistentVolumeClaim", "inbox-data");
    expect(claim.inputs["spec"]).toMatchObject({ accessModes: ["ReadWriteOnce"], storageClassName: "standard-rwo" });
    expect(pod("inbox").volumes).toContainEqual({ name: "data", persistentVolumeClaim: { claimName: "inbox-data" } });
  });

  it("sends mail to GreenMail, and lets FreeScout reach it at its private address", () => {
    expect(pod("greenmail").containers[0].image).toMatch(/^greenmail\/standalone:/);
    expect(env("inbox")).toMatchObject({
      INBOX_SMTP_HOST: "greenmail",
      INBOX_SMTP_PORT: "3025",
      APP_REMOTE_HOST_WHITE_LIST: "greenmail,10.3.0.7",
    });
  });

  it("keeps no copies in Secret Manager, which deploy-dev can't write", () => {
    expect(resources.filter((r) => r.type.startsWith("gcp:secretmanager/"))).toEqual([]);
  });

  it("makes no DNS record, since dev's hostnames are under platform's wildcard", () => {
    expect(resources.filter((r) => r.type === "gcp:dns/recordSet:RecordSet")).toEqual([]);
  });
});
