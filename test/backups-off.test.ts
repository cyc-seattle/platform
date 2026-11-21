import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

const types: string[] = [];

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        types.push(args.type);
        return { id: `${args.name}_id`, state: args.inputs };
      },
      call: (args) => {
        if (args.token === "gcp:sql/getDatabaseInstances:getDatabaseInstances") {
          throw new Error("A rebuild has no prod instance to look up.");
        }
        return { ...args.inputs, number: "123", orgId: "456", billingAccount: "BILLING" };
      },
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify(["user:deployer@example.com"]));
  pulumi.runtime.setConfig("bootstrap:backupCopies", "false");
  await import("../stacks/bootstrap/backups.ts");
  await new Promise((r) => setImmediate(r));
});

describe("backups with backupCopies false, for a rebuild", () => {
  it("keeps the project and its buckets, and copies nothing from a prod that doesn't exist yet", () => {
    expect(types).toContain("gcp:organizations/project:Project");
    // The backups project's two, and Listmonk's pictures, which bootstrap also makes.
    expect(types.filter((t) => t === "gcp:storage/bucket:Bucket")).toHaveLength(3);
    for (const type of [
      "gcp:workflows/workflow:Workflow",
      "gcp:cloudscheduler/job:Job",
      "gcp:storage/transferJob:TransferJob",
    ]) {
      expect(types).not.toContain(type);
    }
  });
});
