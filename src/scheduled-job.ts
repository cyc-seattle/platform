import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { checkRequests, podSpec, serviceAccount, workloadMember, type PodArgs } from "./workload.ts";

export interface ScheduledJobArgs extends PodArgs {
  /** A cron schedule, such as `0 * * * *`. */
  schedule: string;
  /** The schedule's time zone. Defaults to `America/Los_Angeles`. */
  timeZone?: string;
  /** How long one run may take, in seconds. Defaults to 3600. */
  activeDeadlineSeconds?: number;
  /** How many times a failed run retries. Defaults to 0, so the next scheduled run is the retry. */
  backoffLimit?: number;
  /**
   * Stops the scheduled runs, while a Job made from the CronJob still runs. Defaults to false. Unset,
   * it stays out of the spec, so the CronJobs deployed before it existed show no diff.
   */
  suspend?: boolean;
}

/**
 * A CronJob with the platform's secure defaults, and a Kubernetes ServiceAccount, both named `name`.
 * A run never overlaps the one before it. Its pods get no IAM; grant roles to `member`.
 */
export class ScheduledJob extends pulumi.ComponentResource {
  /** The pods' Workload Identity principal, for IAM grants. */
  readonly member: pulumi.Output<string>;
  readonly serviceAccountName: pulumi.Output<string>;

  constructor(name: string, args: ScheduledJobArgs, opts?: pulumi.ComponentResourceOptions) {
    super("cyc-seattle:platform:ScheduledJob", name, {}, opts);
    checkRequests("ScheduledJob", name, args.requests);

    const platform = pulumi.output(args.platform);
    const labels = { "app.kubernetes.io/name": name };
    const child = { parent: this, provider: args.provider };

    const account = serviceAccount(name, args, child);

    new k8s.batch.v1.CronJob(
      name,
      {
        metadata: { name, namespace: platform.namespace, labels },
        spec: {
          schedule: args.schedule,
          timeZone: args.timeZone ?? "America/Los_Angeles",
          concurrencyPolicy: "Forbid",
          ...(args.suspend !== undefined && { suspend: args.suspend }),
          jobTemplate: {
            metadata: { labels },
            spec: {
              activeDeadlineSeconds: args.activeDeadlineSeconds ?? 3600,
              backoffLimit: args.backoffLimit ?? 0,
              template: {
                metadata: { labels },
                spec: podSpec(name, args, account.metadata.name).apply((spec) => ({
                  ...spec,
                  restartPolicy: "Never",
                })),
              },
            },
          },
        },
      },
      child,
    );

    this.serviceAccountName = account.metadata.name;
    this.member = workloadMember(platform, this.serviceAccountName);
    this.registerOutputs({ member: this.member, serviceAccountName: this.serviceAccountName });
  }
}
