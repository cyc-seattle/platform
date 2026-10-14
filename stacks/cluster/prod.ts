import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config";
import { cluster, clusterEndpoint, provider } from "./cluster";
import { EnvironmentNamespace } from "./environment";
import { address, gateway, prodDomain } from "./gateway";
import { writePlatformOutputs } from "./outputs";
import { cloudOutput } from "./refs";

// Fits Authentik's server and worker, Directus, the portal, and the two syncs, with room for a
// rolling update (#231). deploy-runner deploys it through its project-wide container.admin.
export const prodNamespace = new EnvironmentNamespace(
  "prod",
  {
    quota: { cpu: "3", memory: "8Gi", pods: 20 },
    defaultRequests: { cpu: "250m", memory: "512Mi" },
    maxRequests: { cpu: "2", memory: "4Gi" },
  },
  { provider },
);

export const prodOutputs = writePlatformOutputs("prod", {
  project: projectId,
  projectNumber: gcp.organizations.getProjectOutput({ projectId }).number,
  region: location,
  cluster: cluster.name,
  clusterEndpoint,
  namespace: prodNamespace.metadata.name,
  gateway: { name: gateway.metadata.name, namespace: gateway.metadata.namespace },
  domain: prodDomain,
  sqlConnectionName: cloudOutput("postgresConnectionName"),
  sqlHost: cloudOutput("postgresPrivateIp"),
  gatewayAddress: address.address,
  registry: cloudOutput("artifactRepositoryUrl"),
});
