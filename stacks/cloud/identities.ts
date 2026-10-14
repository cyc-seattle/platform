import * as pulumi from "@pulumi/pulumi";

const bootstrap = new pulumi.StackReference(new pulumi.Config().require("bootstrapStack"));

/** The IAM member of an identity that the bootstrap stack exports. */
function member(outputName: string): pulumi.Output<string> {
  return bootstrap.requireOutput(outputName).apply((value: { member: string }) => value.member);
}

export const deployRunnerMember = member("deployRunner");
export const deployDevMember = member("deployDev");
export const gkeNodesMember = member("gkeNodes");
