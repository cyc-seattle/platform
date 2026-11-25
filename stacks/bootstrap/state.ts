import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config.ts";
import { deployRunner } from "./deploy-runner.ts";
import { humanDeployers } from "./human-deployers.ts";
import { enableService } from "../../src/services.ts";

// Pulumi state: one bucket and one KMS key per environment (#215), now prod's alone (cyc-seattle/platform#171).

const kmsApi = enableService("cloudkms.googleapis.com");
const storageApi = enableService("storage.googleapis.com");

// An IAM member resource is read-modify-write against one shared policy, so the default
// create-then-delete replacement strips the member it just added (#153).
const iamOpts: pulumi.CustomResourceOptions = { deleteBeforeReplace: true };

/**
 * A bucket for one environment's Pulumi state: uniform bucket-level access, public access
 * prevention, and versioning that keeps the 30 newest noncurrent versions of each object. Use
 * {@link StateBucket.grant} to let a member read and write state.
 */
export class StateBucket extends gcp.storage.Bucket {
  protected readonly plainId: string;

  constructor(plainId: string, opts?: pulumi.CustomResourceOptions) {
    super(
      plainId,
      {
        name: `${projectId}-${plainId}`,
        location,
        uniformBucketLevelAccess: true,
        publicAccessPrevention: "enforced",
        versioning: { enabled: true },
        lifecycleRules: [{ action: { type: "Delete" }, condition: { numNewerVersions: 30, withState: "ARCHIVED" } }],
      },
      { protect: true, dependsOn: storageApi, ...opts },
    );
    this.plainId = plainId;
  }

  /** Lets a member read and write every object. `granteeLabel` names the resource. */
  grant(member: pulumi.Input<string>, granteeLabel: string): gcp.storage.BucketIAMMember {
    return new gcp.storage.BucketIAMMember(
      `${this.plainId}-${granteeLabel}`,
      { bucket: this.name, role: "roles/storage.objectUser", member },
      iamOpts,
    );
  }
}

/** The key ring for the state keys. GCP never deletes a key ring. */
export const keyRing = new gcp.kms.KeyRing(
  "pulumi",
  { name: "pulumi", location },
  { protect: true, dependsOn: kmsApi },
);

/**
 * A KMS key that encrypts one environment's Pulumi secrets, rotated every 90 days. Use
 * {@link StateKey.grant} to let a member encrypt and decrypt with it.
 */
export class StateKey extends gcp.kms.CryptoKey {
  protected readonly plainId: string;

  constructor(plainId: string, opts?: pulumi.CustomResourceOptions) {
    super(plainId, { name: plainId, keyRing: keyRing.id, rotationPeriod: "7776000s" }, { protect: true, ...opts });
    this.plainId = plainId;
  }

  /** Lets a member encrypt and decrypt with this key. `granteeLabel` names the resource. */
  grant(member: pulumi.Input<string>, granteeLabel: string): gcp.kms.CryptoKeyIAMMember {
    return new gcp.kms.CryptoKeyIAMMember(
      `${this.plainId}-${granteeLabel}`,
      { cryptoKeyId: this.id, role: "roles/cloudkms.cryptoKeyEncrypterDecrypter", member },
      iamOpts,
    );
  }
}

const prodBucket = new StateBucket("pulumi-prod");
const prodKey = new StateKey("state-prod");

for (const member of humanDeployers) {
  for (const resource of [prodBucket, prodKey]) {
    resource.grant(member, member);
  }
}

prodBucket.grant(deployRunner.member, "deploy-runner");
prodKey.grant(deployRunner.member, "deploy-runner");

function backend(bucket: StateBucket, key: StateKey) {
  return {
    url: pulumi.interpolate`gs://${bucket.name}`,
    secretsProvider: pulumi.interpolate`gcpkms://${key.id}`,
  };
}

export const stateBackends = { prod: backend(prodBucket, prodKey) };
