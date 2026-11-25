import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { ScheduledJob } from "../../src/index.ts";
import { appSecret, type Cluster, deployedImage } from "../../src/app/cluster.ts";
import { syncImageTag } from "./sync-image.ts";
import { Secret } from "../../src/app/secret.ts";

// clubspot-sync on the cluster (cyc-seattle/isthmia#231): an hourly CronJob that reaches Directus inside the namespace.
// It syncs from Clubspot, with the login set by hand in Secret Manager.

/** The CronJob, its Secret and image. */
export async function deployClubspotSync(cluster: Cluster, directusToken: pulumi.Input<string>): Promise<void> {
  // Set by hand. The deploy reads them into the CronJob's Secret.
  new Secret("clubspot-username");
  new Secret("clubspot-password");
  // Its keys kept their names when the project folded into backend (cyc-seattle/workplace#6).
  const config = new pulumi.Config("clubspot-sync");
  const { platform, provider } = cluster;

  const clubspot = clubspotLogin();

  const secret = appSecret(cluster, "clubspot-sync", {
    DIRECTUS_TOKEN: directusToken,
    CLUBSPOT_EMAIL: clubspot.email,
    CLUBSPOT_PASSWORD: clubspot.password,
  });

  const image = await deployedImage(cluster, "clubspot-sync", {
    context: "../..",
    target: "clubspot-sync",
    tag: syncImageTag,
  });

  new ScheduledJob("clubspot-sync", {
    platform,
    provider,
    image,
    // Hourly matches BASE_INTERVAL_MS in backoff.ts, so a camp that just wrote something is due again
    // on the very next run.
    schedule: "0 * * * *",
    requests: { cpu: "250m", memory: "512Mi" },
    env: [
      { name: "CLUBSPOT_CLUB_ID", value: config.require("clubId") },
      { name: "DIRECTUS_URL", value: "http://directus" },
    ],
    envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
  });
}

function clubspotLogin() {
  const read = (secret: string) =>
    pulumi.secret(gcp.secretmanager.getSecretVersionAccessOutput({ secret }).apply((version) => version.secretData));
  return { email: read("clubspot-username"), password: read("clubspot-password") };
}
