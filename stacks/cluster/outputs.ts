import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { stateBucket } from "./refs";

/**
 * One environment's platform values, which @cyc-seattle/platform's reader validates. Dev stacks
 * can't read this stack's outputs, so each environment's state bucket gets a copy (#215).
 */
export interface PlatformOutputs {
  project: string;
  projectNumber: string;
  region: string;
  cluster: string;
  /** The DNS-based control-plane endpoint's hostname. */
  clusterEndpoint: string;
  namespace: string;
  gateway: { name: string; namespace: string };
  domain: string;
  sqlConnectionName: string;
  registry: string;
}

/** The same shape, with each value an Input. */
type PlatformOutputsArgs<T = PlatformOutputs> = {
  [K in keyof T]: T[K] extends string ? pulumi.Input<string> : PlatformOutputsArgs<T[K]>;
};

/** Writes an environment's platform values to `platform/outputs.json` in its state bucket. */
export function writePlatformOutputs(environment: string, outputs: PlatformOutputsArgs): gcp.storage.BucketObject {
  return new gcp.storage.BucketObject(`${environment}-platform-outputs`, {
    bucket: stateBucket(environment),
    name: "platform/outputs.json",
    contentType: "application/json",
    content: pulumi.jsonStringify(outputs, undefined, 2),
  });
}
