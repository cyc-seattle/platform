import * as pulumi from "@pulumi/pulumi";
import { projectId, location } from "../../src/config";
import { network, subnet } from "./network";
import { postgres } from "./database";
import { externalZone, internalZone, shortZone } from "./dns";
import { artifactRepository } from "./artifact-repository";

// What the app stacks read through a StackReference.
export const networkId = network.id;
export const subnetId = subnet.id;
export const postgresInstanceName = postgres.name;
export const postgresPrivateIp = postgres.privateIpAddress;
export const postgresConnectionName = postgres.connectionName;
export const internalZoneName = internalZone.name;
export const artifactRepositoryProject = artifactRepository.project;
export const artifactRepositoryLocation = artifactRepository.location;
export const artifactRepositoryName = artifactRepository.name;
export const artifactRepositoryUrl = pulumi.interpolate`${location}-docker.pkg.dev/${projectId}/${artifactRepository.repositoryId}`;

// For the registrar delegation, a manual step.
export const nameServers = {
  external: externalZone.nameServers,
  internal: internalZone.nameServers,
  short: shortZone.nameServers,
};
