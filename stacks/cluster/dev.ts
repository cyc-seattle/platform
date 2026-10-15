import * as gcp from "@pulumi/gcp";
import { location, projectId } from "../../src/config";
import { cluster, clusterEndpoint, provider } from "./cluster";
import { EnvironmentNamespace } from "./environment";
import { address, devDomain, gateway } from "./gateway";
import { writePlatformOutputs } from "./outputs";
import { cloudOutput, deployDev } from "./refs";

// Fits prod's apps plus Mailpit, the two fakes, smoke, and the integration tests' pods, with room
// for a rolling update (#231).
export const devNamespace = new EnvironmentNamespace(
  "dev",
  {
    quota: { cpu: "4", memory: "10Gi", pods: 30 },
    defaultRequests: { cpu: "250m", memory: "512Mi" },
    maxRequests: { cpu: "1", memory: "2Gi" },
  },
  { provider },
);

devNamespace.grantAdmin([deployDev.email, deployDev.uniqueId], "deploy-dev");
// The integration tests reach the fakes and Mailpit through the API's service proxy (#231).
devNamespace.admitApiProxy();
devNamespace.denyMailEgress();

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
  sqlHost: cloudOutput("devPostgresPrivateIp"),
  gatewayAddress: address.address,
  registry: cloudOutput("artifactRepositoryUrl"),
});
