import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";

// The infra stack writes this object to each environment's state bucket, because a StackReference
// can't cross from a dev stack into prod's backend (cyc-seattle/isthmia#215).
export const platformOutputsSchema = z.object({
  project: z.string().min(1),
  projectNumber: z.string().regex(/^\d+$/),
  region: z.string().min(1),
  cluster: z.string().min(1),
  clusterEndpoint: z.string().min(1),
  namespace: z.string().min(1),
  gateway: z.object({ name: z.string().min(1), namespace: z.string().min(1) }),
  domain: z.string().min(1),
  sqlConnectionName: z.string().min(1),
  /** The environment's Cloud SQL private IP, which pods reach directly. */
  sqlHost: z.string().min(1),
  /** The shared Gateway's IPv4 address, for an app's own DNS records. */
  gatewayAddress: z.string().min(1),
  registry: z.string().min(1),
});

/** One environment's platform values: where its cluster, Gateway, database, and registry are. */
export type PlatformOutputs = z.infer<typeof platformOutputsSchema>;

export const outputsObject = "platform/outputs.json";

/** The state bucket of an environment, as `stacks/bootstrap/state.ts` names it. */
export function stateBucket(project: string, environment: string): string {
  return `${project}-pulumi-${environment}`;
}

/** Parses and validates the outputs file's text. `source` names the file in error messages. */
export function parsePlatformOutputs(text: string, source: string): PlatformOutputs {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`${source} is not valid JSON: ${(e as Error).message}`);
  }
  const result = platformOutputsSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`${source} doesn't hold the platform outputs:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export interface PlatformOutputsArgs {
  /** The environment, which names the state bucket. Defaults to the stack's name. */
  environment?: string;
  /** The project that holds the state bucket. Defaults to `gcp:project`. */
  project?: string;
}

/** Reads this environment's platform values from its state bucket. Most programs want `getPlatformOutputs`. */
export async function readPlatformOutputs(args: PlatformOutputsArgs = {}): Promise<PlatformOutputs> {
  const project = args.project ?? new pulumi.Config("gcp").require("project");
  const bucket = stateBucket(project, args.environment ?? pulumi.getStack());
  const source = `gs://${bucket}/${outputsObject}`;
  let content: string;
  try {
    ({ content } = await gcp.storage.getBucketObjectContent({ bucket, name: outputsObject }));
  } catch (e) {
    throw new Error(`Can't read ${source}. The infra stack writes it.\n${(e as Error).message}`);
  }
  if (!content) {
    throw new Error(`${source} is empty. The infra stack writes it.`);
  }
  return parsePlatformOutputs(content, source);
}

/** Reads this environment's platform values from its state bucket. */
export function getPlatformOutputs(args: PlatformOutputsArgs = {}): pulumi.Output<PlatformOutputs> {
  return pulumi.output(readPlatformOutputs(args));
}
