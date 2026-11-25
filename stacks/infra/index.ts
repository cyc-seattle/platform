import * as pulumi from "@pulumi/pulumi";
import { clusterNatAddress, network, subnet } from "./network.ts";
import { postgres } from "./database.ts";
import { externalZone, internalDomain, internalZone, shortZone } from "./dns.ts";
import { artifactRepository, artifactRepositoryUrl } from "./artifact-repository.ts";
import { cluster, clusterEndpoint } from "./cluster.ts";
import { address } from "./gateway.ts";
import { prodOutputs } from "./prod.ts";
import { websiteSite } from "./website.ts";
import "./alerts.ts";
import "./backups.ts";
import "./uptime.ts";
import "./logs.ts";
import { sesSetup } from "./ses.ts";
import { enableService } from "../../src/services.ts";

// Every app's secrets need it. isthmia's retired `infrastructure` stack enabled it before.
enableService("secretmanager.googleapis.com");

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
export const prodPlatformOutputs = pulumi.interpolate`gs://${prodOutputs.bucket}/${prodOutputs.name}`;

// csc-website's Firebase Hosting site.
export const websiteSiteId = websiteSite.siteId;
export const websiteDefaultUrl = websiteSite.defaultUrl;

// For the Workspace SMTP relay's allowlist, a manual step.
export const natAddress = clusterNatAddress.address;

// SES's identity and its bounce and complaint topic, once CSC's AWS account exists.
export const sesIdentityArn = sesSetup?.identityArn;
export const sesFeedbackTopicArn = sesSetup?.feedbackTopicArn;

// For the registrar delegation, a manual step.
export const nameServers = {
  external: externalZone.nameServers,
  internal: internalZone.nameServers,
  short: shortZone.nameServers,
};
