import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location } from "../../src/config.ts";
import { network, privateServicesConnection } from "./network.ts";
import { enableService } from "../../src/services.ts";

const sqlApi = enableService("sqladmin.googleapis.com");

export interface PostgresInstanceArgs {
  network: pulumi.Input<string>;
  /** The instance's name. Defaults to the logical name plus a random suffix. */
  name?: string;
  /** Defaults to the shared-core `db-g1-small`. */
  tier?: string;
  /** Defaults to true, with 7 days of transaction logs. */
  pointInTimeRecovery?: boolean;
  /** How many daily backups to keep. Defaults to 30. */
  retainedBackups?: number;
  /** Defaults to true. */
  deletionProtection?: boolean;
  /** Overrides the tier's default `max_connections`. */
  maxConnections?: number;
}

/**
 * A Cloud SQL for PostgreSQL instance with secure, durable defaults: private IP only (no public
 * endpoint), automated backups and point-in-time recovery, and deletion protection. Attach it to a
 * private network whose service-networking connection already exists. Apps create their own
 * databases and users on it.
 */
export class PostgresInstance extends gcp.sql.DatabaseInstance {
  constructor(name: string, args: PostgresInstanceArgs, opts?: pulumi.CustomResourceOptions) {
    const pointInTimeRecovery = args.pointInTimeRecovery ?? true;
    super(
      name,
      {
        ...(args.name ? { name: args.name } : {}),
        databaseVersion: "POSTGRES_16",
        region: location,
        settings: {
          // Enterprise edition is required for the shared-core tiers; Cloud SQL now defaults new
          // instances to Enterprise Plus, which only allows db-perf-optimized-* tiers.
          edition: "ENTERPRISE",
          // Shared-core. Not covered by the Cloud SQL SLA; fine at this scale.
          tier: args.tier ?? "db-g1-small",
          availabilityType: "ZONAL",
          diskType: "PD_SSD",
          diskAutoresize: true,
          ...(args.maxConnections
            ? { databaseFlags: [{ name: "max_connections", value: String(args.maxConnections) }] }
            : {}),
          ipConfiguration: {
            ipv4Enabled: false,
            privateNetwork: args.network,
          },
          backupConfiguration: {
            enabled: true,
            pointInTimeRecoveryEnabled: pointInTimeRecovery,
            startTime: "09:00", // ~01:00-02:00 America/Los_Angeles, off-peak
            ...(pointInTimeRecovery ? { transactionLogRetentionDays: 7 } : {}),
            backupRetentionSettings: { retainedBackups: args.retainedBackups ?? 30 },
          },
        },
        deletionProtection: args.deletionProtection ?? true,
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

// Dev's instance (#215). Its data is disposable. Its fixed name keeps it out of db-tunnel's filter.
export const devPostgres = new PostgresInstance(
  "cyc-dev",
  {
    network: network.id,
    name: "cyc-dev",
    tier: "db-f1-micro",
    pointInTimeRecovery: false,
    retainedBackups: 7,
    deletionProtection: false,
    // The micro tier's default of 25 runs out during integration runs (cyc-seattle/isthmia#268).
    maxConnections: 50,
  },
  { dependsOn: [privateServicesConnection, sqlApi] },
);
