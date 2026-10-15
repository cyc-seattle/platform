import * as pulumi from "@pulumi/pulumi";
import { cluster, clusterEndpoint } from "./cluster";
import { address } from "./gateway";
import { devOutputs } from "./dev";
import { prodOutputs } from "./prod";
import "./alerts";

export const clusterName = cluster.name;
export { clusterEndpoint };
export const gatewayAddress = address.address;
export const devPlatformOutputs = pulumi.interpolate`gs://${devOutputs.bucket}/${devOutputs.name}`;
export const prodPlatformOutputs = pulumi.interpolate`gs://${prodOutputs.bucket}/${prodOutputs.name}`;
