import fs from "node:fs";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config.ts";
import { directusFilesBucket, stateBucket } from "../../src/outputs.ts";
import { ServiceAccount } from "../../src/service-account.ts";
import { enableService } from "../../src/services.ts";
import { humanDeployers } from "./human-deployers.ts";

// Copies of prod's databases and buckets in a project of their own, away from us-west1 (#170). It's in
// bootstrap, applied by a person, so no deploy identity can change what's kept or for how long.
// docs/backups.md has the restore steps.

const iamOpts: pulumi.CustomResourceOptions = { deleteBeforeReplace: true };

export const backupsLocation = "us-central1";

const day = 24 * 60 * 60;
/** How long a nightly copy is kept, and how long no one can delete it. */
export const dailyDays = 35;
/** How long the 1st of each month's copy is kept: 13 months. */
export const monthlyDays = 396;
/** How long a replaced or deleted file's old version is kept. */
export const fileVersionDays = 90;

/** The buckets copied to the files bucket each run, by name. */
export const backedUpBuckets = [directusFilesBucket(projectId, "prod"), stateBucket(projectId, "prod")];

const main = gcp.organizations.getProjectOutput({ projectId });

export const backupsProject = new gcp.organizations.Project(
  "csc-backups",
  {
    projectId: "csc-backups",
    name: "CSC backups",
    orgId: main.orgId,
    billingAccount: main.billingAccount,
    autoCreateNetwork: false,
    deletionPolicy: "PREVENT",
  },
  { protect: true },
);

const backupsServices = ["storage.googleapis.com", "sqladmin.googleapis.com"].map(
  (service) =>
    new gcp.projects.Service(`csc-backups-${service}`, {
      project: backupsProject.projectId,
      service,
      disableOnDestroy: false,
    }),
);

// The drill makes and deletes a Cloud SQL instance here, and reads the copies.
for (const member of humanDeployers) {
  new gcp.projects.IAMMember(
    `csc-backups-owner-${member}`,
    { project: backupsProject.projectId, role: "roles/owner", member },
    iamOpts,
  );
}

function backupBucket(plainId: string, args: Partial<gcp.storage.BucketArgs>): gcp.storage.Bucket {
  return new gcp.storage.Bucket(
    plainId,
    {
      project: backupsProject.projectId,
      name: pulumi.interpolate`${backupsProject.projectId}-${plainId}`,
      location: backupsLocation,
      storageClass: "NEARLINE",
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
      ...args,
    },
    { protect: true, dependsOn: backupsServices },
  );
}

// Unlocked, since locking is permanent. Each run writes new names, so nothing needs to overwrite.
export const databasesBucket = backupBucket("databases", {
  retentionPolicy: { retentionPeriod: String(dailyDays * day) },
  lifecycleRules: [
    { action: { type: "Delete" }, condition: { age: dailyDays, matchesPrefixes: ["daily/"] } },
    { action: { type: "Delete" }, condition: { age: monthlyDays, matchesPrefixes: ["monthly/"] } },
  ],
});

// The transfer replaces a file whose source changed, which a retention policy would refuse.
export const filesBucket = backupBucket("files", {
  versioning: { enabled: true },
  lifecycleRules: [{ action: { type: "Delete" }, condition: { daysSinceNoncurrentTime: fileVersionDays } }],
});

// The prod instance, found as isthmia's db-tunnel finds it. Its own account writes each export.
const instance = gcp.sql.getDatabaseInstancesOutput({ project: projectId, region: location }).apply(({ instances }) => {
  const prod = instances.filter((i) => i.name.startsWith("substrate-"));
  if (prod.length !== 1) {
    throw new Error(`Expected one prod Cloud SQL instance named substrate-*, found ${prod.length}.`);
  }
  return prod[0]!;
});
const instanceMember = pulumi.interpolate`serviceAccount:${instance.serviceAccountEmailAddress}`;

// Create and read only: an export can't delete or replace a copy, and an import needs to read one.
for (const role of ["roles/storage.objectCreator", "roles/storage.objectViewer"]) {
  new gcp.storage.BucketIAMMember(
    `databases-prod-sql-${role.replace("roles/storage.", "")}`,
    { bucket: databasesBucket.name, role, member: instanceMember },
    iamOpts,
  );
}

const transferApi = enableService("storagetransfer.googleapis.com");
const workflowsApi = enableService("workflows.googleapis.com");
const schedulerApi = enableService("cloudscheduler.googleapis.com");

const transferAgent = gcp.storage.getTransferProjectServiceAccountOutput(
  { project: projectId },
  { dependsOn: transferApi },
);
const transferMember = pulumi.interpolate`serviceAccount:${transferAgent.email}`;

// The roles Storage Transfer documents for a bucket-to-bucket copy.
new gcp.storage.BucketIAMMember(
  "files-transfer-writer",
  { bucket: filesBucket.name, role: "roles/storage.legacyBucketWriter", member: transferMember },
  iamOpts,
);

/** One transfer job per bucket, into a folder named after it. Run by the Workflow, so it has no schedule. */
const transferJobs = backedUpBuckets.map((source) => {
  for (const role of ["roles/storage.objectViewer", "roles/storage.legacyBucketReader"]) {
    new gcp.storage.BucketIAMMember(
      `${source}-transfer-${role.replace("roles/storage.", "")}`,
      { bucket: source, role, member: transferMember },
      iamOpts,
    );
  }
  const job = new gcp.storage.TransferJob(
    `backup-${source}`,
    {
      description: `Copies ${source} to the backups project`,
      transferSpec: {
        gcsDataSource: { bucketName: source },
        gcsDataSink: { bucketName: filesBucket.name, path: `${source}/` },
        // A file deleted at the source becomes an old version here, kept for fileVersionDays.
        transferOptions: { overwriteWhen: "DIFFERENT", deleteObjectsUniqueInSink: true },
      },
    },
    { dependsOn: transferApi },
  );
  return { source, name: job.name };
});

export const backupRunner = new ServiceAccount("backup-runner", "Runs the nightly backup Workflow.");

export const backupRunnerRole = new gcp.projects.IAMCustomRole("backupRunner", {
  roleId: "backupRunner",
  title: "Backup runner",
  description: "Exports prod's databases and runs the backup transfer jobs.",
  permissions: [
    "cloudsql.databases.list",
    "cloudsql.instances.export",
    // Reads the export's operation until it finishes.
    "cloudsql.instances.get",
    "storagetransfer.jobs.get",
    "storagetransfer.jobs.run",
    "storagetransfer.operations.get",
  ],
});

// The Scheduler job starts the Workflow as this account too.
for (const [label, role] of [
  ["backupRunner", backupRunnerRole.name],
  ["logging.logWriter", "roles/logging.logWriter"],
  ["workflows.invoker", "roles/workflows.invoker"],
] as const) {
  new gcp.projects.IAMMember(
    `backup-runner-${label}`,
    { project: projectId, role, member: backupRunner.member },
    iamOpts,
  );
}

export const backupWorkflow = new gcp.workflows.Workflow(
  "backup",
  {
    name: "backup",
    region: location,
    description: "Copies prod's databases and buckets to the backups project.",
    serviceAccount: backupRunner.email,
    sourceContents: fs.readFileSync(path.join(import.meta.dirname, "backup.workflow.yaml"), "utf8"),
    userEnvVars: {
      INSTANCE: instance.name,
      BUCKET: databasesBucket.name,
      TRANSFER_JOBS: pulumi.jsonStringify(transferJobs),
    },
    deletionProtection: true,
  },
  { dependsOn: workflowsApi },
);

// Twice a day, because an absence alert can wait at most 23.5 hours: one missed run leaves a gap of
// 24, so it alerts, where a nightly run would alert every night.
export const backupSchedule = new gcp.cloudscheduler.Job(
  "backup",
  {
    name: "backup",
    region: location,
    schedule: "0 2,14 * * *",
    timeZone: "America/Los_Angeles",
    httpTarget: {
      httpMethod: "POST",
      uri: pulumi.interpolate`https://workflowexecutions.googleapis.com/v1/${backupWorkflow.id}/executions`,
      body: Buffer.from("{}").toString("base64"),
      headers: { "Content-Type": "application/json" },
      oauthToken: {
        serviceAccountEmail: backupRunner.email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      },
    },
  },
  { dependsOn: schedulerApi },
);
