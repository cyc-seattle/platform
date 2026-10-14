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
