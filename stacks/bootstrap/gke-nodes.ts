import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config";
import { ServiceAccount } from "../../src/service-account";

// The identity the GKE Autopilot nodes run as, instead of the default Compute Engine account, which
// holds Editor (#215). The cloud stack grants it Artifact Registry read.
export const gkeNodes = new ServiceAccount("gke-nodes", "Service account the GKE Autopilot nodes run as.");

new gcp.projects.IAMMember("gke-nodes-container.defaultNodeServiceAccount", {
  project: projectId,
  role: "roles/container.defaultNodeServiceAccount",
  member: gkeNodes.member,
});
