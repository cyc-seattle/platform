import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";
import { ServiceAccount } from "../../src/service-account.ts";

// The identity dev deploys run as (#215). It holds nothing in prod: the cloud and cluster stacks grant
// its Artifact Registry writer and its `admin` RoleBinding in namespace `dev`, and state.ts grants
// the dev state bucket and key. It has no Cloud SQL role: Cloud SQL ignores IAM conditions on its user
// and database calls, so the cloud stack creates dev's databases instead (#231).
export const deployDev = new ServiceAccount("deploy-dev", "Dev deploy identity, impersonated by GitHub Actions.");

new gcp.projects.IAMMember("deploy-dev-container.clusterViewer", {
  project: projectId,
  role: "roles/container.clusterViewer",
  member: deployDev.member,
});

/** Dev's Secret Manager secrets, hand-set or written by the cloud stack, carry this prefix in their IDs (#231). */
export const devSecretPrefix = "dev-";

// Secret Manager names a secret by the project's number, not its ID.
const projectNumber = gcp.organizations.getProjectOutput({ projectId }).number;

// Reads dev's secret values, including its database passwords, at deploy time (#231). Use `getSecretVersionAccess`: `getSecretVersion`
// also reads the version's metadata, which the accessor role doesn't grant.
new gcp.projects.IAMMember(
  "deploy-dev-secretmanager.secretAccessor",
  {
    project: projectId,
    role: "roles/secretmanager.secretAccessor",
    member: deployDev.member,
    condition: {
      title: `Only secrets named ${devSecretPrefix}*`,
      expression: pulumi.interpolate`resource.name.startsWith("projects/${projectNumber}/secrets/${devSecretPrefix}")`,
    },
  },
  { deleteBeforeReplace: true },
);
