import { randomBytes } from "node:crypto";
import { devDirectusAdmin, type DirectusSession } from "./directus.ts";
import { devPlatform, kube } from "./support.ts";

// What the sync features share: dev's fakes, reached through the Kubernetes API's service proxy, the
// syncs' CronJobs, and dev's Directus as its admin.

/** Names a scenario's data, so runs never read or break each other's. Lowercase, for emails and Kubernetes names. */
export function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}

/** A path in dev's namespace, such as `/apis/batch/v1/namespaces/dev/jobs`. */
async function namespaced(group: string, resource: string): Promise<string> {
  const { namespace } = await devPlatform();
  return `${group === "" ? "/api/v1" : `/apis/${group}`}/namespaces/${namespace}/${resource}`;
}

/** Calls dev's cluster API. */
async function devKube(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return kube(await devPlatform(), method, path, body, headers);
}

/** Calls a dev Service that isn't on the Gateway through the API's service proxy, and fails on anything but a 2xx. */
export async function proxyOk(
  service: string,
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<any> {
  const response = await devKube(
    method,
    `${await namespaced("", "services")}/${service}:${port}/proxy${path}`,
    body,
    headers,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${service}:${port}${path}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

/** The last lines of each pod's log that a Job ran, for a failure message. */
async function jobLogs(job: string): Promise<string> {
  const pods = await devKube("GET", `${await namespaced("", "pods")}?labelSelector=job-name%3D${job}`);
  const logs = [];
  for (const pod of pods.body?.items ?? []) {
    const log = await devKube("GET", `${await namespaced("", "pods")}/${pod.metadata.name}/log?tailLines=40`);
    logs.push(`--- ${pod.metadata.name}\n${log.body}`);
  }
  return logs.join("\n");
}

function jobFinished(job: any): boolean {
  const conditions: { type: string; status: string }[] = job.status?.conditions ?? [];
  return conditions.some((c) => (c.type === "Complete" || c.type === "Failed") && c.status === "True");
}

/** Whether a Job the CronJob owns, such as another test's or a reset's, hasn't finished. */
async function cronJobRunning(jobs: string, cronUid: string): Promise<boolean> {
  const list = await devKube("GET", jobs);
  if (list.status !== 200) {
    throw new Error(`Can't list Jobs: ${list.status} ${JSON.stringify(list.body)}`);
  }
  return (list.body.items ?? []).some(
    (job: any) => !jobFinished(job) && (job.metadata.ownerReferences ?? []).some((ref: any) => ref.uid === cronUid),
  );
}

/**
 * Runs a CronJob once, as `kubectl create job --from=cronjob/<name>` does, and waits for it. Dev's
 * sync CronJobs are suspended, so no scheduled run competes with it (cyc-seattle/isthmia#271).
 */
export async function runCronJob(cronJob: string, runId: string, timeoutMs = 20 * 60_000): Promise<void> {
  const cron = await devKube("GET", `${await namespaced("batch/v1", "cronjobs")}/${cronJob}`);
  if (cron.status !== 200) {
    throw new Error(`Can't read the CronJob ${cronJob}: ${cron.status} ${JSON.stringify(cron.body)}`);
  }
  const name = `${cronJob}-${runId}`;
  const jobs = await namespaced("batch/v1", "jobs");
  const deadline = Date.now() + timeoutMs;

  // The queue allows one worker at a time, so a second would fail the run (cyc-seattle/isthmia#251).
  while (await cronJobRunning(jobs, cron.body.metadata.uid)) {
    if (Date.now() > deadline) {
      throw new Error(`The CronJob ${cronJob} was still running a Job after ${timeoutMs / 60_000} minutes.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const created = await devKube("POST", jobs, {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      annotations: { "cronjob.kubernetes.io/instantiate": "manual" },
      labels: cron.body.spec.jobTemplate.metadata?.labels,
      // Owned like a scheduled run, so a later run of this helper waits for it too.
      ownerReferences: [
        { apiVersion: "batch/v1", kind: "CronJob", name: cronJob, uid: cron.body.metadata.uid, controller: true },
      ],
    },
    spec: { ...cron.body.spec.jobTemplate.spec, ttlSecondsAfterFinished: 3600 },
  });
  if (created.status !== 201) {
    throw new Error(`Can't create the Job ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  }

  while (Date.now() < deadline) {
    const job = await devKube("GET", `${jobs}/${name}`);
    const conditions: { type: string; status: string; message?: string }[] = job.body?.status?.conditions ?? [];
    if (conditions.some((c) => c.type === "Complete" && c.status === "True")) {
      return;
    }
    const failed = conditions.find((c) => c.type === "Failed" && c.status === "True");
    if (failed) {
      throw new Error(`The Job ${name} failed: ${failed.message}\n${await jobLogs(name)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`The Job ${name} didn't finish in ${timeoutMs / 60_000} minutes.\n${await jobLogs(name)}`);
}

let admin: Promise<DirectusSession> | undefined;

/** A Directus REST call as dev's built-in admin, which must succeed. Returns the response's `data`. */
export async function asAdmin(method: string, path: string, body?: unknown): Promise<any> {
  admin ??= devDirectusAdmin();
  return (await admin).ok(method, path, body);
}
