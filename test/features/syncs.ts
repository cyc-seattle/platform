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

// The syncs, run in the test's own process with their CronJob's config, and scoped to one scenario's
// camp or program. A Job takes minutes to get a pod and to sync every test's data, and only one may
// run at a time (cyc-seattle/isthmia#251).

winston.configure({
  level: "warn",
  format: winston.format.simple(),
  transports: new winston.transports.Stream({ stream: process.stderr }),
});

/** A URL in dev's namespace, such as `http://directus`, as this process reaches it. */
async function reachable(inCluster: string): Promise<string> {
  const url = new URL(inCluster);
  const base = await serviceUrl(url.hostname, Number(url.port || 80));
  return `${base}${url.pathname.replace(/\/$/, "")}`;
}

let clubspotEnv: Promise<Record<string, string>> | undefined;

/** Signs in to the Clubspot fake once per test file, since the Parse SDK keeps one session per process. */
function clubspotSignIn(): Promise<Record<string, string>> {
  clubspotEnv ??= (async () => {
    const env = await cronJobEnv("clubspot-sync");
    const clubspot = new Clubspot({ serverUrl: await reachable(env["CLUBSPOT_SERVER_URL"]!) });
    await clubspot.initialize(env["CLUBSPOT_EMAIL"]!, env["CLUBSPOT_PASSWORD"]!);
    return env;
  })();
  return clubspotEnv;
}

/** Runs clubspot-sync for one camp, as `--camp` does, and fails if the run does. */
export async function runClubspotSync(campId: string): Promise<void> {
  const env = await clubspotSignIn();
  const directus = new DirectusClient(await reachable(env["DIRECTUS_URL"]!), env["DIRECTUS_TOKEN"]!);
  const result = await oneAtATime("clubspot-sync", () =>
    runSync({
      clubId: env["CLUBSPOT_CLUB_ID"]!,
      campId,
      now: new Date(),
      directus,
      queue: new SyncQueue(directus),
      personSync: new PersonSync(directus),
      gateway,
    }),
  );
  if (result.status !== "ok") {
    throw new Error(`clubspot-sync failed for the camp ${campId}: ${JSON.stringify(result)}`);
  }
}

/** Runs gsuite-sync for one program's group, and fails if the run does. */
export async function runGoogleSync(programId: string): Promise<void> {
  const env = await cronJobEnv("gsuite-sync");
  const directus = new DirectusClient(await reachable(env["DIRECTUS_URL"]!), env["DIRECTUS_TOKEN"]!);
  // The Workspace fake ignores auth, and the forwarder sends the cluster's token in its place.
  const { directory, settingsReader } = googleClients(
    new google.auth.GoogleAuth({ apiKey: "unused" }),
    await reachable(env["GSUITE_ROOT_URL"]!),
  );
  const result = await oneAtATime("gsuite-sync", () =>
    runGroupSync({
      now: new Date(),
      directus,
      queue: new SyncQueue(directus),
      adder: directory,
      settingsApplier: settingsReader,
      directory,
      settingsReader,
      groupOwners: env["GSUITE_SYNC_GROUP_OWNERS"]!.split(","),
      customer: env["GSUITE_SYNC_CUSTOMER"]!,
      programId,
    }),
  );
  if (result.status !== "ok") {
    throw new Error(`gsuite-sync failed for the program ${programId}: ${JSON.stringify(result)}`);
  }
}
