import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config.ts";
import { directusFilesBucket } from "../../src/outputs.ts";

// Directus's uploaded files, such as the public website's images (cyc-seattle/platform#150). A pod's own disk
// loses them on every restart. infra makes the bucket and its grant because neither deploy identity may.

const projectNumber = gcp.organizations.getProjectOutput({ projectId }).number;

/**
 * One environment's bucket: private, since only signed-in Directus users read a file, and versioned, so
 * a deleted or replaced file can be restored for 30 days. Directus's pod writes it through Workload
 * Identity, as its Kubernetes service account `directus` in `namespace`.
 */
export function directusFiles(environment: string, namespace: pulumi.Input<string>): gcp.storage.Bucket {
  const bucket = new gcp.storage.Bucket(
    `directus-files-${environment}`,
    {
      name: directusFilesBucket(projectId, environment),
      location,
      uniformBucketLevelAccess: true,
      publicAccessPrevention: "enforced",
      versioning: { enabled: true },
      lifecycleRules: [{ action: { type: "Delete" }, condition: { daysSinceNoncurrentTime: 30 } }],
    },
    { protect: true },
  );
  new gcp.storage.BucketIAMMember(
    `directus-files-${environment}-directus`,
    {
      bucket: bucket.name,
      role: "roles/storage.objectUser",
      member: pulumi.interpolate`principal://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${projectId}.svc.id.goog/subject/ns/${namespace}/sa/directus`,
    },
    { deleteBeforeReplace: true },
  );
  return bucket;
}
