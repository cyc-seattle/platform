import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it, vi } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const valueOf = <T>(output: pulumi.Output<T>): Promise<T> => (output as any).promise();

// dev's outputs file, as the cluster stack writes it.
const dev = {
  project: "cyc-admin-scripts",
  projectNumber: "123456789",
  region: "us-west1",
  cluster: "cyc",
  clusterEndpoint: "gke-example.us-west1.gke.goog",
  namespace: "dev",
  gateway: { name: "shared", namespace: "gateway" },
  domain: "dev.cycsail.team",
  sqlConnectionName: "cyc-admin-scripts:us-west1:cyc-dev",
  sqlHost: "10.159.0.5",
  gatewayAddress: "203.0.113.10",
  registry: "us-west1-docker.pkg.dev/cyc-admin-scripts/artifact-docker-repository",
};
const reads: { bucket: string; name: string }[] = [];

let smoke: typeof import("../stacks/smoke/index.ts");

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (a) => {
        created.push({ type: a.type, name: a.name, inputs: a.inputs });
        return { id: `${a.name}_id`, state: a.inputs };
      },
      call: (a) => {
        if (a.token === "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
          reads.push(a.inputs);
          return { content: JSON.stringify(dev) };
        }
        return a.inputs;
      },
    },
    "smoke",
    "dev",
  );
  pulumi.runtime.setConfig("gcp:project", "cyc-admin-scripts");
  // The program builds its resources on import, so it loads only after the mocks are set.
  smoke = await import("../stacks/smoke/index.ts");
});

describe("smoke", () => {
  it("reads dev's outputs file", async () => {
    await valueOf(smoke.url);
    expect(reads).toContainEqual({ bucket: "cyc-admin-scripts-pulumi-dev", name: "platform/outputs.json" });
  });

  it("serves its hostname, which is in dev's domain", async () => {
    expect(await valueOf(smoke.url)).toBe("https://smoke.dev.cycsail.team/");
  });

  it("talks to the cluster's DNS endpoint through the auth plugin", async () => {
    // The provider registers only once the outputs file resolves.
    const provider = await vi.waitFor(() => {
      const found = created.find((r) => r.type === "pulumi:providers:kubernetes");
      expect(found).toBeDefined();
      return found!;
    });
    expect(JSON.parse(provider.inputs.kubeconfig)).toMatchObject({
      clusters: [{ cluster: { server: "https://gke-example.us-west1.gke.goog" } }],
      users: [
        { user: { exec: { command: "gke-gcloud-auth-plugin", args: ["--use_application_default_credentials"] } } },
      ],
    });
  });
});
