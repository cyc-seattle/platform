import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getStringList, projectId } from "../../src/config.ts";
import { enableService } from "../../src/services.ts";
import { cluster } from "./cluster.ts";
import { prodNamespace } from "./prod.ts";

// Alerts on prod's Jobs, from the Kubernetes events GKE writes to Cloud Logging (#205).

const monitoringApi = enableService("monitoring.googleapis.com");
const loggingApi = enableService("logging.googleapis.com");

// Set as a secret in stack config: the repo and its Actions logs, which show previews, are public, so
// no address goes into a resource name, a display name, or plain config (#20).
export const alertChannels = getStringList("alertEmails").map(
  (email, i) =>
    new gcp.monitoring.NotificationChannel(
      `alerts-${i}`,
      { displayName: `Prod alerts ${i + 1}`, type: "email", labels: { email_address: pulumi.secret(email) } },
      { dependsOn: monitoringApi },
    ),
);

// GKE logs an event about anything but a pod or a node against the cluster resource.
const prodEvents = cluster.name.apply(
  (name) => `logName="projects/${projectId}/logs/events"
resource.type="k8s_cluster"
resource.labels.cluster_name="${name}"`,
);
const namespaceEvents = prodNamespace.metadata.name.apply(
  (namespace) => `jsonPayload.involvedObject.namespace="${namespace}"`,
);

/** The failure reasons Kubernetes gives a Job that has run out of retries or time. */
export const jobFailureReasons = ["BackoffLimitExceeded", "DeadlineExceeded"];

export const jobFailureAlert = new gcp.monitoring.AlertPolicy(
  "job-failed",
  {
    displayName: "A prod Job failed",
    combiner: "OR",
    conditions: [
      {
        displayName: "Job failed",
        conditionMatchedLog: {
          filter: pulumi.interpolate`${prodEvents}
${namespaceEvents}
jsonPayload.involvedObject.kind="Job"
jsonPayload.reason=(${jobFailureReasons.map((r) => `"${r}"`).join(" OR ")})`,
          labelExtractors: {
            job: "EXTRACT(jsonPayload.involvedObject.name)",
            reason: "EXTRACT(jsonPayload.reason)",
          },
        },
      },
    ],
    // A log-match condition requires a notification rate limit.
    alertStrategy: { notificationRateLimit: { period: "300s" }, autoClose: "86400s" },
    documentation: {
      mimeType: "text/markdown",
      content: "A Job in namespace `prod` failed. `kubectl -n prod logs job/<job>` shows its output.",
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: [monitoringApi, loggingApi] },
);

// The CronJob controller logs this event on the CronJob, naming it, for each Job it sees finish.
export const cronJobSuccesses = new gcp.logging.Metric(
  "cronjob-succeeded",
  {
    name: "prod-cronjob-succeeded",
    description: "Successful Jobs of each CronJob in prod.",
    filter: pulumi.interpolate`${prodEvents}
${namespaceEvents}
jsonPayload.involvedObject.kind="CronJob"
jsonPayload.reason="SawCompletedJob"
jsonPayload.message=~": Complete$"`,
    metricDescriptor: {
      metricKind: "DELTA",
      valueType: "INT64",
      labels: [{ key: "cronjob", valueType: "STRING", description: "The CronJob's name" }],
    },
    labelExtractors: { cronjob: "EXTRACT(jsonPayload.involvedObject.name)" },
  },
  { dependsOn: loggingApi },
);

// One time series per CronJob, so each one that stops succeeding alerts on its own. It also covers a
// CronJob that stops starting Jobs at all.
export const cronJobAbsenceAlert = new gcp.monitoring.AlertPolicy(
  "cronjob-absent",
  {
    displayName: "A prod CronJob hasn't succeeded in 3 hours",
    combiner: "OR",
    conditions: [
      {
        displayName: "No successful Job in 3 hours",
        conditionAbsent: {
          filter: pulumi.interpolate`metric.type="logging.googleapis.com/user/${cronJobSuccesses.name}" AND resource.type="k8s_cluster"`,
          duration: "10800s",
          aggregations: [{ alignmentPeriod: "600s", perSeriesAligner: "ALIGN_SUM" }],
          trigger: { count: 1 },
        },
      },
    ],
    // A deleted CronJob's series stops for good, so its incident closes itself after a day.
    alertStrategy: { autoClose: "86400s" },
    documentation: {
      mimeType: "text/markdown",
      content: "A CronJob in namespace `prod` has had no successful Job in 3 hours.",
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: monitoringApi },
);
