import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";
import { ServiceAccount } from "../../src/service-account.ts";

// The identity the GKE Autopilot nodes run as, instead of the default Compute Engine account, which
// holds Editor (#215). The infra stack grants it Artifact Registry read.
export const gkeNodes = new ServiceAccount("gke-nodes", "Service account the GKE Autopilot nodes run as.");

new gcp.projects.IAMMember("gke-nodes-container.defaultNodeServiceAccount", {
  project: projectId,
  role: "roles/container.defaultNodeServiceAccount",
  member: gkeNodes.member,
});
