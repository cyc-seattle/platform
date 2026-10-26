import * as pulumi from "@pulumi/pulumi";
import { cluster, clusterEndpoint } from "./cluster.ts";
import { address } from "./gateway.ts";
import { devOutputs } from "./dev.ts";
import { prodOutputs } from "./prod.ts";
import "./alerts.ts";

export const clusterName = cluster.name;
export { clusterEndpoint };
export const gatewayAddress = address.address;
export const devPlatformOutputs = pulumi.interpolate`gs://${devOutputs.bucket}/${devOutputs.name}`;
export const prodPlatformOutputs = pulumi.interpolate`gs://${prodOutputs.bucket}/${prodOutputs.name}`;
