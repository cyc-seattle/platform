import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config";
import { humanDeployers } from "./human-deployers";
import { ServiceAccount } from "../../src/service-account";

// Identity the gsuite-sync Cloud Run job acts as. Separate from clubspotSyncRunner: it holds the
// Groups Administrator role directly (assigned by hand in the Admin console, docs/manual-setup.md
// §5.4), not domain-wide delegation, so unlike substrateRunner (substrate.ts) it needs no
// tokenCreator self-grant - nothing is impersonated.
export const gsuiteSyncRunner = new ServiceAccount("gsuite-sync", "Service account that runs the gsuite-sync job.");

gsuiteSyncRunner.allowImpersonation(humanDeployers);

// The gsuite-sync CronJob in namespace prod runs as this account through Workload Identity (#231).
new gcp.serviceaccount.IAMMember(
  "gsuite-sync-wif-prod",
  {
    serviceAccountId: gsuiteSyncRunner.name,
    role: "roles/iam.workloadIdentityUser",
    member: gcp.organizations
      .getProjectOutput({ projectId })
      .number.apply(
        (number) =>
          `principal://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${projectId}.svc.id.goog/subject/ns/prod/sa/gsuite-sync`,
      ),
  },
  // An IAM member is read-modify-write against one shared policy (#153).
  { deleteBeforeReplace: true },
);
