import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config";
import { humanDeployers } from "./human-deployers";
import { ServiceAccount } from "../../src/service-account";

// Identity the gsuite-sync CronJob acts as. It holds the Groups Administrator role directly
// (assigned by hand in the Admin console), not domain-wide delegation, so nothing is impersonated.
export const gsuiteSyncRunner = new ServiceAccount("gsuite-sync", "Service account that runs the gsuite-sync job.");

gsuiteSyncRunner.allowImpersonation(humanDeployers);

// The gsuite-sync CronJob in namespace prod runs as this account through Workload Identity (#231).
new gcp.serviceaccount.IAMMember(
  "gsuite-sync-wif-prod",
  {
    serviceAccountId: gsuiteSyncRunner.name,
    role: "roles/iam.workloadIdentityUser",
    // Google documents only this form for impersonating a service account; principal:// is for direct resource grants.
    member: `serviceAccount:${projectId}.svc.id.goog[prod/gsuite-sync]`,
  },
  // An IAM member is read-modify-write against one shared policy (#153).
  { deleteBeforeReplace: true },
);
