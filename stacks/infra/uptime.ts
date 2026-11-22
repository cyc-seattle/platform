import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";
import { enableService } from "../../src/services.ts";
import { alertChannels } from "./alerts.ts";
import { externalDomain, internalDomain } from "./dns.ts";

// Uptime and certificate checks on each public address (#170, #150 requirement 30). A new app adds
// its address here.

const monitoringApi = enableService("monitoring.googleapis.com");

export interface UptimeTarget {
  host: string;
  path: string;
  /** Also accepts a redirect, for an address that sends visitors elsewhere. */
  redirect?: boolean;
}

export const uptimeTargets: UptimeTarget[] = [
  { host: internalDomain, path: "/" },
  // Reads Directus's settings, so it fails when the database does. /server/health needs an admin.
  { host: `directus.${internalDomain}`, path: "/server/info" },
  { host: `login.${internalDomain}`, path: "/-/health/live/" },
  { host: externalDomain, path: "/", redirect: true },
  { host: `www.${externalDomain}`, path: "/", redirect: true },
  // Listmonk; /health doesn't touch its database.
  { host: `mail.${externalDomain}`, path: "/health" },
];

/** The days a certificate may have left before it alerts. Google renews at 30. */
export const certificateDays = 14;

export const uptimeChecks = uptimeTargets.map(
  ({ host, path, redirect }) =>
    new gcp.monitoring.UptimeCheckConfig(
      `uptime-${host}`,
      {
        displayName: host,
        period: "300s",
        timeout: "10s",
        // The fewest regions a check may use. The alert needs 2 of them to fail.
        selectedRegions: ["USA_OREGON", "USA_IOWA", "USA_VIRGINIA"],
        monitoredResource: { type: "uptime_url", labels: { project_id: projectId, host } },
        httpCheck: {
          path,
          port: 443,
          useSsl: true,
          validateSsl: true,
          acceptedResponseStatusCodes: [
            { statusClass: "STATUS_CLASS_2XX" },
            ...(redirect ? [{ statusClass: "STATUS_CLASS_3XX" }] : []),
          ],
        },
      },
      { dependsOn: monitoringApi },
    ),
);

const uptimeFilter = (metric: string) =>
  `metric.type="monitoring.googleapis.com/uptime_check/${metric}" AND resource.type="uptime_url"`;

export const uptimeAlert = new gcp.monitoring.AlertPolicy(
  "site-down",
  {
    displayName: "A public address is down",
    combiner: "OR",
    conditions: [
      {
        displayName: "Uptime check failing from 2 regions for 5 minutes",
        conditionThreshold: {
          filter: uptimeFilter("check_passed"),
          aggregations: [
            {
              alignmentPeriod: "300s",
              perSeriesAligner: "ALIGN_NEXT_OLDER",
              crossSeriesReducer: "REDUCE_COUNT_FALSE",
              groupByFields: ["resource.label.host"],
            },
          ],
          comparison: "COMPARISON_GT",
          thresholdValue: 1,
          duration: "300s",
          trigger: { count: 1 },
        },
      },
    ],
    documentation: {
      mimeType: "text/markdown",
      content: "A public address has failed its uptime check from 2 of 3 regions for 5 minutes. The incident names it.",
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: monitoringApi },
);

export const certificateAlert = new gcp.monitoring.AlertPolicy(
  "certificate-expiring",
  {
    displayName: `A certificate expires in under ${certificateDays} days`,
    combiner: "OR",
    conditions: [
      {
        displayName: `Under ${certificateDays} days left`,
        conditionThreshold: {
          filter: uptimeFilter("time_until_ssl_cert_expires"),
          aggregations: [
            {
              alignmentPeriod: "1200s",
              perSeriesAligner: "ALIGN_NEXT_OLDER",
              crossSeriesReducer: "REDUCE_MIN",
              groupByFields: ["resource.label.host"],
            },
          ],
          comparison: "COMPARISON_LT",
          thresholdValue: certificateDays,
          duration: "600s",
          trigger: { count: 1 },
        },
      },
    ],
    documentation: {
      mimeType: "text/markdown",
      content:
        "A public address's certificate expires soon, so its renewal has been failing. Certificate Manager renews cycsail.team's, and Firebase Hosting the website's once it moves.",
    },
    notificationChannels: alertChannels.map((channel) => channel.name),
  },
  { dependsOn: monitoringApi },
);
