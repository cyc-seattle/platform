import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

const platform = {
  project: "test-project",
  projectNumber: "123",
  region: "us-west1",
  cluster: "cluster",
  clusterEndpoint: "cluster.example.com",
  namespace: "prod",
  gateway: { name: "gateway", namespace: "infra" },
  domain: "example.com",
  sqlConnectionName: "test-project:us-west1:cyc-prod",
  sqlHost: "10.1.2.4",
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
      const state =
        type === "pulumi:pulumi:StackReference"
          ? { ...inputs, outputs: { internalZoneName: "zone" } }
          : { ...inputs, base64: `${name}-base64`, result: `${name}-value` };
      return { id: `${name}-id`, state };
    },
    call: ({ token, inputs }) => {
      if (token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
        return { ...inputs, content: JSON.stringify(platform) };
      }
      if (token === "gcp:artifactregistry/getDockerImage:getDockerImage") {
        return { ...inputs, selfLink: "us-west1-docker.pkg.dev/test-project/images/freescout@sha256:abc" };
      }
      return inputs;
    },
  },
  "inbox",
  "prod",
  false,
);
pulumi.runtime.setConfig("gcp:project", "test-project");

function find(type: string, name: string): Registered {
  const found = resources.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`No ${type} named ${name}. Registered: ${resources.map((r) => r.name).join(", ")}`);
  return found;
}

function env(): Record<string, unknown> {
  const container = find("kubernetes:apps/v1:Deployment", "inbox").inputs["spec"].template.spec.containers[0];
  return Object.fromEntries((container.env ?? []).map((e: { name: string; value?: unknown }) => [e.name, e.value]));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

beforeAll(async () => {
  const { deployInbox } = await import("../stacks/inbox/cluster.ts");
  await deployInbox("admin@example.com", "inbox@example.com");
  await settle();
});

describe("the shared inbox in prod", () => {
  it("creates its own database and user on the Cloud SQL instance", () => {
    expect(find("gcp:sql/database:Database", "inbox-db").inputs).toMatchObject({ name: "inbox" });
    expect(find("gcp:sql/user:User", "inbox-db-user").inputs).toMatchObject({ name: "inbox" });
  });

  it("runs the image dev built, by digest", () => {
    const container = find("kubernetes:apps/v1:Deployment", "inbox").inputs["spec"].template.spec.containers[0];
    expect(container.image).toBe("us-west1-docker.pkg.dev/test-project/images/freescout@sha256:abc");
  });

  it("sends its own mail through the Workspace relay, and runs no GreenMail", () => {
    expect(env()).toMatchObject({
      INBOX_SMTP_HOST: "smtp-relay.gmail.com",
      INBOX_SMTP_PORT: "587",
      INBOX_SMTP_ENCRYPTION: "tls",
    });
    expect(env()).not.toHaveProperty("APP_REMOTE_HOST_WHITE_LIST");
    expect(resources.find((r) => r.name === "greenmail")).toBeUndefined();
  });

  it("keeps the app key and the break-glass password in Secret Manager", () => {
    const secrets = resources
      .filter((r) => r.type === "gcp:secretmanager/secret:Secret")
      .map((r) => r.inputs["secretId"]);
    expect(secrets).toEqual(expect.arrayContaining(["inbox-app-key", "inbox-admin-password"]));
  });

  it("owns its DNS record", () => {
    expect(find("gcp:dns/recordSet:RecordSet", "inbox-a").inputs).toMatchObject({
      name: "inbox.example.com.",
      rrdatas: ["203.0.113.1"],
    });
  });
});
