import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config";
import { cluster, clusterEndpoint, provider } from "./cluster";
import { EnvironmentNamespace } from "./environment";
import { devDomain, gateway } from "./gateway";
import { writePlatformOutputs } from "./outputs";
import { cloudOutput, deployDev } from "./refs";

// Caps dev at what its Phase 6 apps need, on Spot pods (#215).
export const devNamespace = new EnvironmentNamespace(
  "dev",
  {
    quota: { cpu: "2", memory: "6Gi", pods: 20 },
    defaultRequests: { cpu: "250m", memory: "512Mi" },
    maxRequests: { cpu: "1", memory: "2Gi" },
  },
  { provider },
);

devNamespace.grantAdmin([deployDev.email, deployDev.uniqueId], "deploy-dev");

export const devOutputs = writePlatformOutputs("dev", {
  project: projectId,
  projectNumber: gcp.organizations.getProjectOutput({ projectId }).number,
  region: location,
  cluster: cluster.name,
  clusterEndpoint,
  namespace: devNamespace.metadata.name,
  gateway: { name: gateway.metadata.name, namespace: gateway.metadata.namespace },
  domain: devDomain,
  sqlConnectionName: cloudOutput("devPostgresConnectionName"),
  registry: cloudOutput("artifactRepositoryUrl"),
});
