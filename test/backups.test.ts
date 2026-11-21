import * as pulumi from "@pulumi/pulumi";
import * as yaml from "js-yaml";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

interface Created {
  type: string;
  name: string;
  inputs: any;
}

const created: Created[] = [];
const byName = (type: string, name: string) => created.find((r) => r.type === type && r.name === name)!.inputs;
const ofType = (type: string) => created.filter((r) => r.type === type).map((r) => r.inputs);
const bucketMembers = (bucket: string) =>
  ofType("gcp:storage/bucketIAMMember:BucketIAMMember").filter((g) => g.bucket === bucket);

const sqlAccount = "serviceAccount:p123-abc@gcp-sa-cloud-sql.iam.gserviceaccount.com";
const transferAgent = "serviceAccount:project-123@storage-transfer-service.iam.gserviceaccount.com";

beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        created.push({ type: args.type, name: args.name, inputs: args.inputs });
        const state =
          args.type === "gcp:serviceaccount/account:Account"
            ? {
                ...args.inputs,
                email: `${args.inputs.accountId}@example-project.iam.gserviceaccount.com`,
                member: `serviceAccount:${args.inputs.accountId}@example-project.iam.gserviceaccount.com`,
              }
            : args.type === "gcp:storage/transferJob:TransferJob"
              ? { ...args.inputs, name: `transferJobs/${args.name}` }
              : args.type === "gcp:projects/iAMCustomRole:IAMCustomRole"
                ? {
                    ...args.inputs,
                    name: `projects/${args.inputs.project ?? "example-project"}/roles/${args.inputs.roleId}`,
                  }
                : args.inputs;
        return { id: `${args.name}_id`, state };
      },
      call: (args) => {
        switch (args.token) {
          case "gcp:organizations/getProject:getProject":
            return { ...args.inputs, number: "123", orgId: "456", billingAccount: "BILLING" };
          case "gcp:sql/getDatabaseInstances:getDatabaseInstances":
            return {
              instances: [
                { name: "cyc-dev", serviceAccountEmailAddress: "dev@gcp-sa-cloud-sql.iam.gserviceaccount.com" },
                {
                  name: "substrate-1234",
                  serviceAccountEmailAddress: "p123-abc@gcp-sa-cloud-sql.iam.gserviceaccount.com",
                },
              ],
            };
          case "gcp:storage/getTransferProjectServiceAccount:getTransferProjectServiceAccount":
            return { email: "project-123@storage-transfer-service.iam.gserviceaccount.com" };
          default:
            return args.inputs;
        }
      },
    },
    "bootstrap",
  );
  pulumi.runtime.setConfig("gcp:project", "example-project");
  pulumi.runtime.setConfig("gcp:region", "us-west1");
  pulumi.runtime.setConfig("bootstrap:humanDeployers", JSON.stringify(["user:deployer@example.com"]));
  await import("../stacks/bootstrap/backups.ts");
  await new Promise((r) => setImmediate(r));
});

describe("backups project", () => {
  it("is its own project under the same organization and billing account, never deleted", () => {
    expect(byName("gcp:organizations/project:Project", "csc-backups")).toMatchObject({
      projectId: "csc-backups",
      orgId: "456",
      billingAccount: "BILLING",
      deletionPolicy: "PREVENT",
    });
  });

  it("is owned by the people who apply bootstrap, and no deploy identity", () => {
    const owners = ofType("gcp:projects/iAMMember:IAMMember").filter((g) => g.project === "csc-backups");
    expect(owners.map((g) => [g.role, g.member])).toEqual([["roles/owner", "user:deployer@example.com"]]);
  });
});

describe("databases bucket", () => {
  const bucket = () => byName("gcp:storage/bucket:Bucket", "databases");

  it("is private, outside us-west1", () => {
    expect(bucket()).toMatchObject({
      project: "csc-backups",
      name: "csc-backups-databases",
      location: "us-central1",
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
    });
  });

  it("keeps every copy 35 days, and the monthly copies 13 months", () => {
    expect(bucket().retentionPolicy).toEqual({ retentionPeriod: String(35 * 86400) });
    expect(bucket().retentionPolicy.isLocked).toBeUndefined();
    expect(bucket().lifecycleRules).toEqual([
      { action: { type: "Delete" }, condition: { age: 35, matchesPrefixes: ["daily/"] } },
      { action: { type: "Delete" }, condition: { age: 396, matchesPrefixes: ["monthly/"] } },
    ]);
  });

  it("lets the prod instance only create copies, and backup-runner only list them", () => {
    expect(
      bucketMembers("csc-backups-databases")
        .map((g) => [g.role, g.member])
        .sort(),
    ).toEqual([
      ["projects/csc-backups/roles/copyLister", "serviceAccount:backup-runner@example-project.iam.gserviceaccount.com"],
      ["roles/storage.objectCreator", sqlAccount],
    ]);
    expect(byName("gcp:projects/iAMCustomRole:IAMCustomRole", "copyLister").permissions).toEqual([
      "storage.objects.list",
    ]);
  });
});

describe("files bucket", () => {
  const bucket = () => byName("gcp:storage/bucket:Bucket", "files");

  it("keeps a replaced or deleted file's old version 90 days", () => {
    expect(bucket()).toMatchObject({ location: "us-central1", versioning: { enabled: true } });
    expect(bucket().lifecycleRules).toEqual([
      { action: { type: "Delete" }, condition: { daysSinceNoncurrentTime: 90 } },
    ]);
  });

  it("is written only by Storage Transfer", () => {
    expect(bucketMembers("csc-backups-files").map((g) => [g.role, g.member])).toEqual([
      ["roles/storage.legacyBucketWriter", transferAgent],
    ]);
  });

  it("gets Directus's prod files and prod's Pulumi state, each in its own folder", () => {
    const jobs = ofType("gcp:storage/transferJob:TransferJob");
    expect(jobs.map((j) => [j.transferSpec.gcsDataSource.bucketName, j.transferSpec.gcsDataSink.path])).toEqual([
      ["example-project-directus-files-prod", "example-project-directus-files-prod/"],
      ["example-project-pulumi-prod", "example-project-pulumi-prod/"],
    ]);
    for (const job of jobs) {
      expect(job.schedule).toBeUndefined();
      expect(job.transferSpec.transferOptions).toEqual({ overwriteWhen: "DIFFERENT", deleteObjectsUniqueInSink: true });
    }
  });
});

describe("backup Workflow", () => {
  const workflow = () => byName("gcp:workflows/workflow:Workflow", "backup");

  it("runs as backup-runner on the prod instance, writing to the databases bucket", () => {
    expect(workflow()).toMatchObject({
      region: "us-west1",
      serviceAccount: "backup-runner@example-project.iam.gserviceaccount.com",
      deletionProtection: true,
    });
    expect(workflow().userEnvVars).toMatchObject({ INSTANCE: "substrate-1234", BUCKET: "csc-backups-databases" });
    expect(JSON.parse(workflow().userEnvVars.TRANSFER_JOBS)).toEqual([
      {
        source: "example-project-directus-files-prod",
        name: "transferJobs/backup-example-project-directus-files-prod",
      },
      { source: "example-project-pulumi-prod", name: "transferJobs/backup-example-project-pulumi-prod" },
    ]);
  });

  it("is valid YAML that logs the lines infra's alerts read", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "../stacks/bootstrap/backup.workflow.yaml"), "utf8");
    expect(yaml.load(source)).toHaveProperty("main.steps");
    expect(source).toContain("backup: finished");
    expect(source).toContain("backup: failed");
  });

  it("names every copy by the second it was made, since the bucket refuses to replace one", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "../stacks/bootstrap/backup.workflow.yaml"), "utf8");
    expect(source).toContain('"/daily/" + database.name + "/" + stamp + ".sql.gz"');
    expect(source).toContain('"/monthly/" + database.name + "/" + month + "/" + stamp + ".sql.gz"');
  });

  it("starts twice a day in UTC, so the 23.5-hour absence alert catches one missed run", () => {
    expect(byName("gcp:cloudscheduler/job:Job", "backup")).toMatchObject({
      schedule: "0 10,22 * * *",
      timeZone: "Etc/UTC",
      httpTarget: { oauthToken: { serviceAccountEmail: "backup-runner@example-project.iam.gserviceaccount.com" } },
    });
  });

  it("gives backup-runner only export, transfer, logging and invoking", () => {
    const roles = ofType("gcp:projects/iAMMember:IAMMember")
      .filter((g) => g.member === "serviceAccount:backup-runner@example-project.iam.gserviceaccount.com")
      .map((g) => g.role);
    expect(roles.sort()).toEqual([
      "projects/example-project/roles/backupRunner",
      "roles/logging.logWriter",
      "roles/workflows.invoker",
    ]);
    expect(byName("gcp:projects/iAMCustomRole:IAMCustomRole", "backupRunner").permissions.sort()).toEqual([
      "cloudsql.databases.list",
      "cloudsql.instances.export",
      "cloudsql.instances.get",
      "storagetransfer.jobs.get",
      "storagetransfer.jobs.run",
      "storagetransfer.operations.get",
    ]);
  });
});
