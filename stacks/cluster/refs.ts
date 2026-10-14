import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const bootstrap = new pulumi.StackReference(config.require("bootstrapStack"));
const cloud = new pulumi.StackReference(config.require("cloudStack"));

interface Account {
  email: string;
  uniqueId: string;
  member: string;
  name: string;
}

export const gkeNodes = bootstrap.requireOutput("gkeNodes") as pulumi.Output<Account>;
export const deployDev = bootstrap.requireOutput("deployDev") as pulumi.Output<Account>;

/**
 * A string output of the cloud stack. A deploy applies cloud first, but a preview of both runs
 * before cloud exports a new output, so there it is unknown instead of missing.
 */
export function cloudOutput(name: string): pulumi.Output<string> {
  return cloud.getOutput(name).apply((value: string | undefined) => {
    if (value !== undefined) {
      return value;
    }
    if (pulumi.runtime.isDryRun()) {
      return pulumi.unknown as unknown as string;
    }
    throw new Error(`The cloud stack has no output "${name}".`);
  });
}
