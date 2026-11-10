import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";
import { location, projectId } from "../../src/config.ts";
import { cluster, clusterEndpoint, provider } from "./cluster.ts";
import { EnvironmentNamespace } from "./environment.ts";
import { address, devDomain, gateway } from "./gateway.ts";
import { writePlatformOutputs } from "./outputs.ts";
import { artifactRepositoryUrl } from "./artifact-repository.ts";
import { devPostgres } from "./database.ts";
import { deployDev } from "./identities.ts";
import { directusFiles } from "./directus-files.ts";

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

directusFiles("dev", devNamespace.metadata.name);

// The csc-website build's Directus token for dev (cyc-seattle/platform#150). `backend` gives it to the build's
// Directus user, and the site's PR previews read it. deploy-dev reads `dev-` secrets but can't write them.
const cscWebsiteToken = new gcp.secretmanager.Secret("dev-csc-website-directus-token", {
  project: projectId,
  secretId: "dev-csc-website-directus-token",
  replication: { auto: {} },
});
new gcp.secretmanager.SecretVersion("dev-csc-website-directus-token", {
  secret: cscWebsiteToken.id,
  secretData: new random.RandomPassword("dev-csc-website-directus-token", { length: 64, special: false }).result,
});

export const devOutputs = writePlatformOutputs("dev", {
  project: projectId,
  projectNumber: gcp.organizations.getProjectOutput({ projectId }).number,
  region: location,
  cluster: cluster.name,
  clusterEndpoint,
  namespace: devNamespace.metadata.name,
  gateway: { name: gateway.metadata.name, namespace: gateway.metadata.namespace },
  domain: devDomain,
  sqlConnectionName: devPostgres.connectionName,
  sqlHost: devPostgres.privateIpAddress,
  gatewayAddress: address.address,
  registry: artifactRepositoryUrl,
});
