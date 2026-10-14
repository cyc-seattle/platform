import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { projectId } from "../../src/config";
import { outputsObject, platformOutputsSchema, stateBucket, type PlatformOutputs } from "../../src/outputs";

/** The same shape as the values the reader returns, with each one an Input. */
type PlatformOutputsInput<T = PlatformOutputs> = {
  [K in keyof T]: T[K] extends string ? pulumi.Input<string> : PlatformOutputsInput<T[K]>;
};

/**
 * Writes an environment's platform values to its state bucket, where `getPlatformOutputs` reads
 * them. The reader's schema validates them first, and its bucket and object names place them, so
 * the writer and the reader can't drift.
 */
export function writePlatformOutputs(environment: string, outputs: PlatformOutputsInput): gcp.storage.BucketObject {
  return new gcp.storage.BucketObject(`${environment}-platform-outputs`, {
    bucket: stateBucket(projectId, environment),
    name: outputsObject,
    contentType: "application/json",
    content: pulumi
      .output(outputs)
      .apply((values) => JSON.stringify(platformOutputsSchema.parse(values), undefined, 2)),
  });
}
