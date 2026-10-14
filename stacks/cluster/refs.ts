import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const bootstrap = new pulumi.StackReference(config.require("bootstrapStack"));
const cloud = new pulumi.StackReference(config.require("cloudStack"));

interface Account {
  email: string;
  member: string;
  name: string;
}

interface StateBackend {
  url: string;
  secretsProvider: string;
}

export const gkeNodes = bootstrap.requireOutput("gkeNodes") as pulumi.Output<Account>;
export const deployDev = bootstrap.requireOutput("deployDev") as pulumi.Output<Account>;
const stateBackends = bootstrap.requireOutput("stateBackends") as pulumi.Output<Record<string, StateBackend>>;

/** The name of an environment's state bucket, from its `gs://` backend URL. */
export function stateBucket(environment: string): pulumi.Output<string> {
  return stateBackends.apply((backends) => new URL(backends[environment]!.url).host);
}

/** A string output of the cloud stack. */
export function cloudOutput(name: string): pulumi.Output<string> {
  return cloud.requireOutput(name) as pulumi.Output<string>;
}
