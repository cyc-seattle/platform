import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import * as outputs from "../src/outputs.ts";

const valueOf = <T>(output: pulumi.Output<T>): Promise<T> => (output as any).promise();

const good = {
  project: "example-project",
  projectNumber: "123456789",
  region: "us-west1",
  cluster: "cyc",
  clusterEndpoint: "gke-example.us-west1.gke.goog",
  namespace: "dev",
  gateway: { name: "shared", namespace: "gateway" },
  domain: "dev.example.org",
  sqlConnectionName: "example-project:us-west1:cyc-dev",
  sqlHost: "10.159.0.5",
  gatewayAddress: "203.0.113.10",
  registry: "us-west1-docker.pkg.dev/example-project/docker",
};

// The mocked bucket contents, by bucket name. A bucket missing here fails like a missing object.
const objects: Record<string, string> = {
  "example-project-pulumi-dev": JSON.stringify(good),
  "example-project-pulumi-empty": "",
};

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (a) => ({ id: `${a.name}_id`, state: a.inputs }),
      call: (a) => {
        if (a.token !== "gcp:storage/getBucketObjectContent:getBucketObjectContent") {
          return a.inputs;
        }
        const content = objects[a.inputs.bucket];
        if (content === undefined || a.inputs.name !== "platform/outputs.json") {
          throw new Error("googleapi: Error 404: No such object");
        }
        return { ...a.inputs, content };
      },
    },
    "smoke",
    "dev",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
});

describe("parsePlatformOutputs", () => {
  const parse = (value: unknown) => outputs.parsePlatformOutputs(JSON.stringify(value), "outputs.json");

  it("returns a good file's values", () => {
    expect(parse(good)).toEqual(good);
  });

  it("names a missing field", () => {
    const missing: Partial<typeof good> = { ...good };
    delete missing.clusterEndpoint;
    expect(() => parse(missing)).toThrow(/outputs\.json doesn't hold the platform outputs:[\s\S]*clusterEndpoint/);
  });

  it.each(["sqlHost", "gatewayAddress"] as const)("requires %s", (field) => {
    const missing: Partial<typeof good> = { ...good };
    delete missing[field];
    expect(() => parse(missing)).toThrow(new RegExp(field));
    expect(() => parse({ ...good, [field]: "" })).toThrow(new RegExp(field));
  });

  it("names a field of the wrong type", () => {
    expect(() => parse({ ...good, gateway: "shared" })).toThrow(/expected object[\s\S]*gateway/);
  });

  it("rejects a project number that isn't a number", () => {
    expect(() => parse({ ...good, projectNumber: "example-project" })).toThrow(/projectNumber/);
  });

  it("rejects text that isn't JSON", () => {
    expect(() => outputs.parsePlatformOutputs("{", "outputs.json")).toThrow(/outputs\.json is not valid JSON/);
  });
});

// A rejected Output leaves Pulumi's internal promises unhandled, so the failures go through the promise.
describe("readPlatformOutputs", () => {
  it("reads the stack's environment from its state bucket", async () => {
    expect(await valueOf(outputs.getPlatformOutputs())).toEqual(good);
  });

  it("says which object is missing", async () => {
    await expect(outputs.readPlatformOutputs({ environment: "prod" })).rejects.toThrow(
      /Can't read gs:\/\/example-project-pulumi-prod\/platform\/outputs\.json\. The infra stack writes it\./,
    );
  });

  it("says when the object is empty", async () => {
    await expect(outputs.readPlatformOutputs({ environment: "empty" })).rejects.toThrow(
      /gs:\/\/example-project-pulumi-empty\/platform\/outputs\.json is empty/,
    );
  });
});
