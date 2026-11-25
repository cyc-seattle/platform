import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byName = (name: string) => created.find((r) => r.name === name)!;
const ofType = (type: string) => created.filter((r) => r.type === type);

const human = "user:deployer@example.com";
const deployRunner = "serviceAccount:deploy-runner@example-project.iam.gserviceaccount.com";

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        const state =
          args.type === "gcp:serviceaccount/account:Account"
            ? {
                ...args.inputs,
                member: `serviceAccount:${args.inputs.accountId}@example-project.iam.gserviceaccount.com`,
              }
            : args.inputs;
        return { id: `${args.name}_id`, state };
      },
      call: (args) => args.inputs,
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify([human]));
  // The module builds its resources on import, so it loads only after the mocks are set.
  await import("../stacks/bootstrap/state.ts");
  await new Promise((r) => setImmediate(r));
});

describe("state buckets", () => {
  it("are prod's alone", () => {
    expect(ofType("gcp:storage/bucket:Bucket").map((r) => r.name)).toEqual(["pulumi-prod"]);
  });

  it("names pulumi-prod after the project", () => {
    expect(byName("pulumi-prod").inputs).toMatchObject({ name: "example-project-pulumi-prod", location: "us-west1" });
  });

  it("locks pulumi-prod down and keeps 30 noncurrent versions", () => {
    expect(byName("pulumi-prod").inputs).toMatchObject({
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
      versioning: { enabled: true },
      lifecycleRules: [{ action: { type: "Delete" }, condition: { numNewerVersions: 30, withState: "ARCHIVED" } }],
    });
  });
});

describe("state keys", () => {
  it("live in the pulumi key ring in the region", () => {
    expect(byName("pulumi").inputs).toMatchObject({ name: "pulumi", location: "us-west1" });
  });

  it("are prod's alone", () => {
    expect(ofType("gcp:kms/cryptoKey:CryptoKey").map((r) => r.name)).toEqual(["state-prod"]);
  });

  it("rotates state-prod every 90 days", () => {
    expect(byName("state-prod").inputs).toMatchObject({
      name: "state-prod",
      keyRing: "pulumi_id",
      rotationPeriod: "7776000s",
    });
  });
});

describe("state access", () => {
  const bucketMembers = (bucket: string) =>
    ofType("gcp:storage/bucketIAMMember:BucketIAMMember")
      .filter((r) => r.inputs.bucket === `example-project-${bucket}`)
      .map((r) => r.inputs);
  const keyMembers = (key: string) =>
    ofType("gcp:kms/cryptoKeyIAMMember:CryptoKeyIAMMember")
      .filter((r) => r.inputs.cryptoKeyId === `${key}_id`)
      .map((r) => r.inputs.member)
      .sort();

  it("gives the human deployers and deploy-runner prod's bucket and key", () => {
    expect(bucketMembers("pulumi-prod")).toEqual(
      expect.arrayContaining([
        { bucket: "example-project-pulumi-prod", role: "roles/storage.objectUser", member: human },
        { bucket: "example-project-pulumi-prod", role: "roles/storage.objectUser", member: deployRunner },
      ]),
    );
    expect(bucketMembers("pulumi-prod")).toHaveLength(2);
    expect(keyMembers("state-prod")).toEqual([deployRunner, human].sort());
  });

  it("grants encrypt and decrypt only", () => {
    for (const grant of ofType("gcp:kms/cryptoKeyIAMMember:CryptoKeyIAMMember")) {
      expect(grant.inputs.role).toBe("roles/cloudkms.cryptoKeyEncrypterDecrypter");
    }
  });
});
