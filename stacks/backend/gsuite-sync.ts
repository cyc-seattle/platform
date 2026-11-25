import * as pulumi from "@pulumi/pulumi";
import { ScheduledJob } from "../../src/index.ts";
import { appSecret, type Cluster, deployedImage } from "../../src/app/cluster.ts";
import { syncImageTag } from "./sync-image.ts";
import { enableService } from "../../src/services.ts";

// gsuite-sync on the cluster (cyc-seattle/isthmia#231): an hourly CronJob that reaches Directus inside the namespace.
// It calls the Workspace APIs as gsuite-sync@, through Workload Identity.

/** The CronJob, its Secret and image. */
export async function deployGsuiteSync(cluster: Cluster, directusToken: pulumi.Input<string>): Promise<void> {
  // The Directory API, for group membership, nesting, and roles, and the Groups Settings API.
  enableService("admin.googleapis.com");
  enableService("groupssettings.googleapis.com");
  // Its keys kept their names when the project folded into backend (cyc-seattle/workplace#6).
  const config = new pulumi.Config("gsuite-sync");
  const { platform, provider } = cluster;

  const secret = appSecret(cluster, "gsuite-sync", {
    DIRECTUS_TOKEN: directusToken,
  });

  const image = await deployedImage(cluster, "gsuite-sync", {
    context: "../..",
    target: "gsuite-sync",
    tag: syncImageTag,
  });

  new ScheduledJob("gsuite-sync", {
    platform,
    provider,
    image,
    // Half past, so it doesn't run alongside clubspot-sync, and passes on the hour's changes within
    // half an hour.
    schedule: "30 * * * *",
    requests: { cpu: "250m", memory: "512Mi" },
    env: [
      { name: "DIRECTUS_URL", value: "http://directus" },
      { name: "GSUITE_SYNC_GROUP_OWNERS", value: config.require("groupOwners") },
      { name: "GSUITE_SYNC_CUSTOMER", value: config.require("workspaceCustomer") },
    ],
    envFrom: [{ secretRef: { name: secret.metadata.name, optional: false } }],
    // gsuite-sync@ holds the Groups Administrator role in Workspace. platform's bootstrap lets this
    // ServiceAccount act as it (cyc-seattle/isthmia#231).
    serviceAccountAnnotations: {
      "iam.gke.io/gcp-service-account": `gsuite-sync@${platform.project}.iam.gserviceaccount.com`,
    },
  });
}
