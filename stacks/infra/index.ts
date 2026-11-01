import * as pulumi from "@pulumi/pulumi";
import { clusterNatAddress, network, subnet } from "./network.ts";
import { postgres } from "./database.ts";
import { externalZone, internalDomain, internalZone, shortZone } from "./dns.ts";
import { artifactRepository, artifactRepositoryUrl } from "./artifact-repository.ts";
import { cluster, clusterEndpoint } from "./cluster.ts";
import { address } from "./gateway.ts";
import { devOutputs } from "./dev.ts";
import { prodOutputs } from "./prod.ts";
import "./dev-databases.ts";
import "./alerts.ts";
import "./logs.ts";

// What the app stacks read through a StackReference.
export const networkId = network.id;
export const subnetId = subnet.id;
export const postgresInstanceName = postgres.name;
export const postgresPrivateIp = postgres.privateIpAddress;
export const postgresConnectionName = postgres.connectionName;
export const internalZoneName = internalZone.name;
export { internalDomain };
export const artifactRepositoryProject = artifactRepository.project;
export const artifactRepositoryLocation = artifactRepository.location;
export const artifactRepositoryName = artifactRepository.name;
export { artifactRepositoryUrl };

export const clusterName = cluster.name;
export { clusterEndpoint };
export const gatewayAddress = address.address;
export const devPlatformOutputs = pulumi.interpolate`gs://${devOutputs.bucket}/${devOutputs.name}`;
export const prodPlatformOutputs = pulumi.interpolate`gs://${prodOutputs.bucket}/${prodOutputs.name}`;

// For the Workspace SMTP relay's allowlist, a manual step.
export const natAddress = clusterNatAddress.address;

// For the registrar delegation, a manual step.
export const nameServers = {
  external: externalZone.nameServers,
  internal: internalZone.nameServers,
  short: shortZone.nameServers,
};
