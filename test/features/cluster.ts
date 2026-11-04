import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { devDirectusAdmin, type DirectusSession } from "./directus.ts";
import { accessToken, devPlatform, isConnectError, kube } from "./support.ts";

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

const forwarders = new Map<string, Promise<string>>();

/**
 * A local URL for a dev Service that forwards each request through the API's service proxy, for a
 * client that can't send the API's token itself, such as the Parse SDK. The API's token replaces the
 * client's own `Authorization`, so a Service that needs one can't be reached this way.
 */
export function serviceUrl(service: string, port: number): Promise<string> {
  const key = `${service}:${port}`;
  let url = forwarders.get(key);
  if (url === undefined) {
    url = forward(service, port);
    forwarders.set(key, url);
  }
  return url;
}

async function forward(service: string, port: number): Promise<string> {
  const { clusterEndpoint } = await devPlatform();
  const base = `https://${clusterEndpoint}${await namespaced("", "services")}/${service}:${port}/proxy`;
  const server = http.createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);
      const contentType = request.headers["content-type"];
      const upstream = await fetch(`${base}${request.url}`, {
        method: request.method ?? "GET",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          ...(contentType && { "content-type": contentType }),
        },
        ...(body.length > 0 && { body }),
      });
      const payload = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      response.end(payload);
    } catch (error) {
      // A 503 for a failed connect, which never reached the Service, so the syncs' clients retry it.
      response.writeHead(isConnectError(error) ? 503 : 502, { "content-type": "text/plain" });
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Lets the test worker exit without closing it.
  server.unref();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The env a CronJob's container gets: its own values, and every key of the Secrets it reads. */
export async function cronJobEnv(cronJob: string): Promise<Record<string, string>> {
  const cron = await devKube("GET", `${await namespaced("batch/v1", "cronjobs")}/${cronJob}`);
  if (cron.status !== 200) {
    throw new Error(`Can't read the CronJob ${cronJob}: ${cron.status} ${JSON.stringify(cron.body)}`);
  }
  const container = cron.body.spec.jobTemplate.spec.template.spec.containers[0];
  const env: Record<string, string> = {};
  for (const { secretRef } of (container.envFrom ?? []) as { secretRef?: { name: string } }[]) {
    if (secretRef === undefined) {
      continue;
    }
    const secret = await devKube("GET", `${await namespaced("", "secrets")}/${secretRef.name}`);
    if (secret.status !== 200) {
      throw new Error(`Can't read the Secret ${secretRef.name}: ${secret.status}`);
    }
    for (const [key, value] of Object.entries<string>(secret.body.data ?? {})) {
      env[key] = Buffer.from(value, "base64").toString("utf8");
    }
  }
  for (const variable of (container.env ?? []) as { name: string; value?: string }[]) {
    if (variable.value !== undefined) {
      env[variable.name] = variable.value;
    }
  }
  return env;
}

/**
 * Runs `run` while no other test file runs the same sync. Each run's club-wide passes, such as
 * making offerings and merging people, would race another's and make a row twice.
 */
export async function oneAtATime<T>(sync: string, run: () => Promise<T>): Promise<T> {
  const lock = join(tmpdir(), `cyc-platform-features-${sync}.lock`);
  const owner = join(lock, "pid");
  for (;;) {
    try {
      await mkdir(lock);
      await writeFile(owner, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      // A lock whose test worker has died, such as one an interrupted local run left.
      const pid = Number(await readFile(owner, "utf8").catch(() => ""));
      if (pid > 0 && !alive(pid)) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await sleep(1_000);
    }
  }
  try {
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
 * sync CronJobs are suspended, so no scheduled run competes with it (cyc-seattle/isthmia#271). Each
 * sync's feature runs it once, to prove its image and config; the rest run the sync in-process.
 */
export function runCronJob(cronJob: string, runId: string, timeoutMs = 20 * 60_000): Promise<void> {
  return oneAtATime(cronJob, () => runJob(cronJob, runId, timeoutMs));
}

async function runJob(cronJob: string, runId: string, timeoutMs: number): Promise<void> {
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
