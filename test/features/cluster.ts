import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { devDirectusAdmin, type DirectusSession } from "./directus.ts";
import { accessToken, devPlatform, isConnectError, kube } from "./support.ts";
import { localService, localTarget } from "./target.ts";

// What the sync features share: the fakes, on dev reached through the Kubernetes API's service proxy,
// the syncs' config, and Directus as its admin.

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
  const local = localTarget();
  if (local) {
    const response = await fetch(`${localService(local, service, port)}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${service}:${port}${path}: ${response.status} ${text}`);
    }
    return response.headers.get("content-type")?.startsWith("application/json") && text ? JSON.parse(text) : text;
  }
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
  const local = localTarget();
  if (local) {
    return Promise.resolve(localService(local, service, port));
  }
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

/** A dev Secret's keys and values. */
export async function secretData(name: string): Promise<Record<string, string>> {
  const secret = await devKube("GET", `${await namespaced("", "secrets")}/${name}`);
  if (secret.status !== 200) {
    throw new Error(`Can't read the Secret ${name}: ${secret.status}`);
  }
  return Object.fromEntries(
    Object.entries<string>(secret.body.data ?? {}).map(([key, value]) => [
      key,
      Buffer.from(value, "base64").toString("utf8"),
    ]),
  );
}

/** The env a CronJob's container gets: its own values, and every key of the Secrets it reads. */
export async function cronJobEnv(cronJob: string): Promise<Record<string, string>> {
  const local = localTarget()?.cronJobs[cronJob];
  if (local) {
    return local;
  }
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

let admin: Promise<DirectusSession> | undefined;

/** A Directus REST call as dev's built-in admin, which must succeed. Returns the response's `data`. */
export async function asAdmin(method: string, path: string, body?: unknown): Promise<any> {
  admin ??= devDirectusAdmin();
  return (await admin).ok(method, path, body);
}
