import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config";
import { ServiceAccount } from "../../src/service-account";

// The identity dev deploys run as (#215). It holds nothing in prod: the cloud and cluster stacks grant
// its Artifact Registry writer and its `admin` RoleBinding in namespace `dev`, and state.ts grants
// the dev state bucket and key.
export const deployDev = new ServiceAccount("deploy-dev", "Dev deploy identity, impersonated by GitHub Actions.");

new gcp.projects.IAMMember("deploy-dev-container.clusterViewer", {
  project: projectId,
  role: "roles/container.clusterViewer",
  member: deployDev.member,
});

/** The dev Cloud SQL instance, which `cloud` names. */
export const devInstance = "cyc-dev";

/** Dev's hand-set Secret Manager secrets carry this prefix in their IDs (#231). */
export const devSecretPrefix = "dev-";

// Creates dev's databases and users through the Admin API (#231). Cloud SQL checks a user or
// database call against the subresource's own name, under the instance, so match both.
new gcp.projects.IAMMember(
  "deploy-dev-cloudsql.admin",
  {
    project: projectId,
    role: "roles/cloudsql.admin",
    member: deployDev.member,
    condition: {
      title: `Only ${devInstance}`,
      expression: `(resource.name == "projects/${projectId}/instances/${devInstance}" || resource.name.startsWith("projects/${projectId}/instances/${devInstance}/")) && resource.service == "sqladmin.googleapis.com"`,
    },
  },
  // An IAM member is read-modify-write against one shared policy (#153).
  { deleteBeforeReplace: true },
);

// Secret Manager names a secret by the project's number, not its ID.
const projectNumber = gcp.organizations.getProjectOutput({ projectId }).number;

// Reads dev's hand-set values at deploy time (#231). Use `getSecretVersionAccess`: `getSecretVersion`
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
