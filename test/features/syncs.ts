import { Clubspot } from "@cyc-seattle/clubspot-sdk";
import { google } from "googleapis";
import winston from "winston";
import { gateway } from "../../src/syncs/clubspot/main.ts";
import { PersonSync } from "../../src/syncs/clubspot/person-sync.ts";
import { runSync } from "../../src/syncs/clubspot/sync-run.ts";
import { googleClients } from "../../src/syncs/gsuite/main.ts";
import { runGroupSync } from "../../src/syncs/gsuite/run.ts";
import { DirectusClient, SyncQueue } from "../../src/syncs/runtime/index.ts";
import { cronJobEnv, oneAtATime, serviceUrl } from "./cluster.ts";
import { localTarget } from "./target.ts";

// The syncs, run in the test's own process with their CronJob's config, and scoped to one scenario's
// camp or program. A Job takes minutes to get a pod and to sync every test's data, and only one may
// run at a time (cyc-seattle/isthmia#251).

winston.configure({
  level: "warn",
  format: winston.format.simple(),
  transports: new winston.transports.Stream({ stream: process.stderr }),
});

/** The CI stack's Directus, in place of the CronJob's in-cluster `http://directus`. */
function directus(token: string): DirectusClient {
  return new DirectusClient(localTarget().directus.url, token);
}

/** A fake's in-cluster URL, such as `http://workspace-fake:8080`, as this process reaches it. */
function reachable(inCluster: string): string {
  const url = new URL(inCluster);
  const base = serviceUrl(url.hostname, Number(url.port || 80));
  return `${base}${url.pathname.replace(/\/$/, "")}`;
}

let clubspotEnv: Promise<Record<string, string>> | undefined;

/** Signs in to the Clubspot fake once per test file, since the Parse SDK keeps one session per process. */
function clubspotSignIn(): Promise<Record<string, string>> {
  clubspotEnv ??= (async () => {
    const env = cronJobEnv("clubspot-sync");
    const clubspot = new Clubspot({ serverUrl: reachable(env["CLUBSPOT_SERVER_URL"]!) });
    await clubspot.initialize(env["CLUBSPOT_EMAIL"]!, env["CLUBSPOT_PASSWORD"]!);
    return env;
  })();
  return clubspotEnv;
}

/** Runs clubspot-sync for one camp, as `--camp` does, and fails if the run does. */
export async function runClubspotSync(campId: string): Promise<void> {
  const env = await clubspotSignIn();
  const client = directus(env["DIRECTUS_TOKEN"]!);
  const result = await oneAtATime("clubspot-sync", () =>
    runSync({
      clubId: env["CLUBSPOT_CLUB_ID"]!,
      campId,
      now: new Date(),
      directus: client,
      queue: new SyncQueue(client),
      personSync: new PersonSync(client),
      gateway,
    }),
  );
  if (result.status !== "ok") {
    throw new Error(`clubspot-sync failed for the camp ${campId}: ${JSON.stringify(result)}`);
  }
}

/** Runs gsuite-sync for one program's group, and fails if the run does. */
export function runGoogleSync(programId: string): Promise<void> {
  return runGoogleSyncFor({ programId });
}

/** Runs gsuite-sync for one CRM group's Google group, and fails if the run does. */
export function runGoogleSyncForGroup(accessGroupId: string): Promise<void> {
  return runGoogleSyncFor({ accessGroupId });
}

async function runGoogleSyncFor(target: { programId: string } | { accessGroupId: string }): Promise<void> {
  const env = cronJobEnv("gsuite-sync");
  const client = directus(env["DIRECTUS_TOKEN"]!);
  // The Workspace fake ignores auth. A fixed token, since a GoogleAuth of its own would look for credentials the CI runner hasn't got.
  const unused = new google.auth.OAuth2();
  unused.setCredentials({ access_token: "unused" });
  const { directory, settingsReader } = googleClients(
    // Any client does for the fake; googleClients is typed for the real sync's.
    new google.auth.GoogleAuth({ authClient: unused }) as unknown as Parameters<typeof googleClients>[0],
    reachable(env["GSUITE_ROOT_URL"]!),
  );
  const result = await oneAtATime("gsuite-sync", () =>
    runGroupSync({
      now: new Date(),
      directus: client,
      queue: new SyncQueue(client),
      adder: directory,
      remover: directory,
      settingsApplier: settingsReader,
      directory,
      settingsReader,
      groupOwners: env["GSUITE_SYNC_GROUP_OWNERS"]!.split(","),
      customer: env["GSUITE_SYNC_CUSTOMER"]!,
      ...target,
    }),
  );
  if (result.status !== "ok") {
    throw new Error(`gsuite-sync failed for ${JSON.stringify(target)}: ${JSON.stringify(result)}`);
  }
}
