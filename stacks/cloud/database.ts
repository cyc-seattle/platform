import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config";
import { network, privateServicesConnection } from "./network";
import { enableService } from "../../src/services";

const sqlApi = enableService("sqladmin.googleapis.com");

/**
 * A Cloud SQL for PostgreSQL instance with secure, durable defaults: private IP only (no public
 * endpoint), automated backups and point-in-time recovery, and deletion protection. Attach it to a
 * private network whose service-networking connection already exists. Apps create their own
 * databases and users on it.
 */
export class PostgresInstance extends gcp.sql.DatabaseInstance {
  constructor(name: string, args: { network: pulumi.Input<string> }, opts?: pulumi.CustomResourceOptions) {
    super(
      name,
      {
        databaseVersion: "POSTGRES_16",
        region: location,
        settings: {
          // Enterprise edition is required for the shared-core tier below; Cloud SQL now defaults
          // new instances to Enterprise Plus, which only allows db-perf-optimized-* tiers.
          edition: "ENTERPRISE",
          // Shared-core. Not covered by the Cloud SQL SLA; fine at this scale.
          tier: "db-g1-small",
          availabilityType: "ZONAL",
          diskType: "PD_SSD",
          diskAutoresize: true,
          ipConfiguration: {
            ipv4Enabled: false,
            privateNetwork: args.network,
          },
          backupConfiguration: {
            enabled: true,
            pointInTimeRecoveryEnabled: true,
            startTime: "09:00", // ~01:00-02:00 America/Los_Angeles, off-peak
            transactionLogRetentionDays: 7,
            backupRetentionSettings: { retainedBackups: 30 },
          },
        },
        deletionProtection: true,
      },
      opts,
    );
  }
}

// The prod instance. isthmia's scripts/db-tunnel finds it with `name~substrate`.
export const postgres = new PostgresInstance(
  "substrate",
  { network: network.id },
  { dependsOn: [privateServicesConnection, sqlApi] },
);
