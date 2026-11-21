import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config.ts";
import { listmonkMediaBucket } from "../../src/outputs.ts";
import { ServiceAccount } from "../../src/service-account.ts";
import { deployRunner } from "./deploy-runner.ts";

// What Listmonk, the newsletter, needs that no deploy identity may make (cyc-seattle/platform#180).

const iamOpts: pulumi.CustomResourceOptions = { deleteBeforeReplace: true };

// Listmonk uploads through Cloud Storage's S3 API, which takes only an HMAC key, and deploy-runner may
// make neither a service account nor a key.
const uploader = new ServiceAccount("listmonk-media", "Listmonk's uploads to its public pictures bucket");

/** Prod's newsletter pictures. Public: an email's pictures must load for everyone who opens it. */
export const listmonkMedia = new gcp.storage.Bucket(
  "listmonk-media-prod",
  {
    name: listmonkMediaBucket(projectId),
    location,
    uniformBucketLevelAccess: true,
    versioning: { enabled: true },
    lifecycleRules: [{ action: { type: "Delete" }, condition: { daysSinceNoncurrentTime: 30 } }],
  },
  { protect: true },
);

new gcp.storage.BucketIAMMember(
  "listmonk-media-prod-public",
  { bucket: listmonkMedia.name, role: "roles/storage.objectViewer", member: "allUsers" },
  iamOpts,
);
new gcp.storage.BucketIAMMember(
  "listmonk-media-prod-uploader",
  { bucket: listmonkMedia.name, role: "roles/storage.objectUser", member: uploader.member },
  iamOpts,
);

const key = new gcp.storage.HmacKey("listmonk-media", { serviceAccountEmail: uploader.email });
const keySecret = new gcp.secretmanager.Secret("listmonk-media-hmac", {
  secretId: "listmonk-media-hmac",
  replication: { auto: {} },
});
new gcp.secretmanager.SecretVersion("listmonk-media-hmac", {
  secret: keySecret.id,
  secretData: pulumi.secret(pulumi.jsonStringify({ accessId: key.accessId, secret: key.secret })),
});

// CSC's AWS role trusts deploy-runner's own Google ID token, so infra signs in to SES with no stored key
// (docs/manual-setup.md §10).
new gcp.serviceaccount.IAMMember(
  "deploy-runner-own-id-token",
  {
    serviceAccountId: deployRunner.name,
    role: "roles/iam.serviceAccountOpenIdTokenCreator",
    member: deployRunner.member,
  },
  iamOpts,
);
