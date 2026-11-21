import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { enableService } from "../../src/services.ts";
import { alertChannels } from "./alerts.ts";

// Alerts on the backup Workflow that bootstrap's backups.ts runs twice a day (#170). It logs a line with
// `backup` set to `finished` for each database and bucket it copies, and to `failed` when a run fails.

const monitoringApi = enableService("monitoring.googleapis.com");
const loggingApi = enableService("logging.googleapis.com");

const workflowLogs = `resource.type="workflows.googleapis.com/Workflow"
resource.labels.workflow_id="backup"`;

const runbook = "[docs/backups.md](https://cyc-seattle.github.io/platform/backups/#a-missed-backup) has the steps.";

export const backupFailedAlert = new gcp.monitoring.AlertPolicy(
  "backup-failed",
  {
    displayName: "A prod backup failed",
    combiner: "OR",
    conditions: [
      {
        displayName: "Backup run failed",
        conditionMatchedLog: { filter: `${workflowLogs}\njsonPayload.backup="failed"` },
      },
    ],
    // A log-match condition requires a notification rate limit.
    alertStrategy: { notificationRateLimit: { period: "300s" }, autoClose: "86400s" },
    documentation: {
      mimeType: "text/markdown",
      content: `The backup Workflow failed. \`gcloud workflows executions list backup --location us-west1\` shows its runs. ${runbook}`,
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: [monitoringApi, loggingApi] },
);

export const backupSuccesses = new gcp.logging.Metric(
  "backup-finished",
  {
    name: "prod-backup-finished",
    description: "Each database and bucket the backup Workflow copied.",
    filter: `${workflowLogs}\njsonPayload.backup="finished"`,
    metricDescriptor: {
      metricKind: "DELTA",
      valueType: "INT64",
      labels: [{ key: "item", valueType: "STRING", description: "database/<name> or files/<bucket>" }],
    },
    labelExtractors: { item: "EXTRACT(jsonPayload.item)" },
  },
  { dependsOn: loggingApi },
);

// One series per item, so a database or bucket that stops being copied alerts on its own. 23.5 hours is
// the longest an absence condition waits, which is why the Workflow runs twice a day.
export const backupAbsenceAlert = new gcp.monitoring.AlertPolicy(
  "backup-absent",
  {
    displayName: "A prod backup hasn't finished in 23.5 hours",
    combiner: "OR",
    conditions: [
      {
        displayName: "No finished backup in 23.5 hours",
        conditionAbsent: {
          filter: pulumi.interpolate`metric.type="logging.googleapis.com/user/${backupSuccesses.name}" AND resource.type="workflows.googleapis.com/Workflow"`,
          duration: "84600s",
          aggregations: [{ alignmentPeriod: "600s", perSeriesAligner: "ALIGN_SUM" }],
          trigger: { count: 1 },
        },
      },
    ],
    // A database that's dropped stops its series for good, so its incident closes itself after a day.
    alertStrategy: { autoClose: "86400s" },
    documentation: {
      mimeType: "text/markdown",
      content: `A database or bucket hasn't been copied to the backups project in 23.5 hours. ${runbook}`,
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: monitoringApi },
);
