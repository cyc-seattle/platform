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

/** A string output of the cloud stack. `requireOutput` fails a typo in every preview, not partway through `up`. */
export function cloudOutput(name: string): pulumi.Output<string> {
  return cloud.requireOutput(name) as pulumi.Output<string>;
}
