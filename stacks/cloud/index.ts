import * as pulumi from "@pulumi/pulumi";
import { projectId, location } from "../../src/config";
import { clusterPodsRange, clusterServicesRange, clusterSubnet, network, subnet } from "./network";
import { devPostgres, postgres } from "./database";
import { externalZone, internalDomain, internalZone, shortZone } from "./dns";
import { artifactRepository } from "./artifact-repository";

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
export const artifactRepositoryUrl = pulumi.interpolate`${location}-docker.pkg.dev/${projectId}/${artifactRepository.repositoryId}`;

// What the cluster stack reads (#215).
export const clusterSubnetId = clusterSubnet.id;
export const clusterPodsRangeName = clusterPodsRange;
export const clusterServicesRangeName = clusterServicesRange;
export const devPostgresConnectionName = devPostgres.connectionName;

// For the registrar delegation, a manual step.
export const nameServers = {
  external: externalZone.nameServers,
  internal: internalZone.nameServers,
  short: shortZone.nameServers,
};
