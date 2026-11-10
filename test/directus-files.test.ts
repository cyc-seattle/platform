import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const find = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)!.inputs;

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}_id`, state: args.inputs };
      },
      call: (args) => (args.token === "gcp:organizations/getProject:getProject" ? { number: "123" } : args.inputs),
    },
    "infra",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  const { directusFiles } = await import("../stacks/infra/directus-files.ts");
  directusFiles("dev", "dev");
  await new Promise((r) => setImmediate(r));
});

describe("directusFiles", () => {
  it("makes a private, versioned bucket that keeps a replaced file for 30 days", () => {
    expect(find("gcp:storage/bucket:Bucket", "directus-files-dev")).toMatchObject({
      name: "example-project-directus-files-dev",
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
      versioning: { enabled: true },
      lifecycleRules: [{ action: { type: "Delete" }, condition: { daysSinceNoncurrentTime: 30 } }],
    });
  });

  it("lets only Directus's pod in that namespace use it", async () => {
    const grant = find("gcp:storage/bucketIAMMember:BucketIAMMember", "directus-files-dev-directus");
    expect(grant.role).toBe("roles/storage.objectUser");
    expect(grant.member).toBe(
      "principal://iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/example-project.svc.id.goog/subject/ns/dev/sa/directus",
    );
  });
});
