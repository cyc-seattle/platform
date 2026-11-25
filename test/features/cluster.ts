import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { directusAdmin, type DirectusSession } from "./directus.ts";
import { localService, localTarget } from "./target.ts";

// What the sync features share: the fakes, the syncs' config, and Directus as its admin.

/** Names a scenario's data, so runs never read or break each other's. Lowercase, for emails and Kubernetes names. */
export function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}

/** Calls one of the CI stack's Services, and fails on anything but a 2xx. */
export async function proxyOk(
  service: string,
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<any> {
  const response = await fetch(`${localService(localTarget(), service, port)}${path}`, {
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

/** A Service's URL on the runner, for a client that makes its own requests, such as the Parse SDK. */
export function serviceUrl(service: string, port: number): string {
  return localService(localTarget(), service, port);
}

/** The env a sync's CronJob gives its container, as the CI stack describes it. */
export function cronJobEnv(cronJob: string): Record<string, string> {
  const env = localTarget().cronJobs[cronJob];
  if (env === undefined) {
    throw new Error(`The CI stack has no CronJob ${cronJob}.`);
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

/** A Directus REST call as the built-in admin, which must succeed. Returns the response's `data`. */
export async function asAdmin(method: string, path: string, body?: unknown): Promise<any> {
  admin ??= directusAdmin();
  return (await admin).ok(method, path, body);
}
