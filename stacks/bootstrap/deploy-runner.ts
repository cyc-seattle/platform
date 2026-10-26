import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config.ts";
import { gkeNodes } from "./gke-nodes.ts";

// The identity GitHub Actions impersonates to deploy (#118 adds the Workload Identity Federation
// pool and the workflow that assumes this account; this project only creates the identity itself).
export const deployRunner = new gcp.serviceaccount.Account("deploy-runner", {
  accountId: "deploy-runner",
  displayName: "CI deploy identity — impersonated by GitHub Actions to run pulumi up.",
});

const predefinedRoles = [
  "roles/serviceusage.serviceUsageAdmin",
  "roles/compute.admin",
  "roles/cloudsql.admin",
  "roles/servicenetworking.networksAdmin",
  "roles/dns.admin",
  "roles/artifactregistry.admin",
  "roles/secretmanager.admin",
  "roles/container.admin",
  "roles/certificatemanager.editor",
  // The infra stack's Job alerts and their email channels (#205).
  "roles/monitoring.alertPolicyEditor",
  "roles/monitoring.notificationChannelEditor",
];

for (const role of predefinedRoles) {
  new gcp.projects.IAMMember(`deploy-runner-${role.replace("roles/", "")}`, {
    project: projectId,
    role,
    member: deployRunner.member,
  });
}

// What no predefined role grants without over-granting. Excludes project-IAM and role-edit
// permissions on purpose, so deploy-runner can't grant itself Owner. It holds no
// `iam.serviceAccounts.setIamPolicy` either: with it, deploy-runner could make itself a token creator
// on any service account (#215).
export const deployerRole = new gcp.projects.IAMCustomRole("deployer", {
  roleId: "deployer",
  title: "Deployer",
  description: "Scoped project permissions for the CI deploy identity, deploy-runner.",
  permissions: [
    "resourcemanager.projects.get",
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.list",
    "iam.serviceAccounts.getIamPolicy",
    "iam.roles.get",
    "iam.roles.list",
    // The infra stack's log-based metric (#205). roles/logging.configWriter would add sinks too.
    "logging.logMetrics.create",
    "logging.logMetrics.delete",
    "logging.logMetrics.get",
    "logging.logMetrics.list",
    "logging.logMetrics.update",
  ],
});

new gcp.projects.IAMMember("deploy-runner-deployer", {
  project: projectId,
  role: deployerRole.name,
  member: deployRunner.member,
});

// Lets the infra stack attach gke-nodes to the Autopilot cluster.
new gcp.serviceaccount.IAMMember("deploy-runner-user-gke-nodes", {
  serviceAccountId: gkeNodes.name,
  role: "roles/iam.serviceAccountUser",
  member: deployRunner.member,
});
