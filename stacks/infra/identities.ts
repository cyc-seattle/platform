import * as pulumi from "@pulumi/pulumi";

const bootstrap = new pulumi.StackReference(new pulumi.Config().require("bootstrapStack"));

interface Account {
  email: string;
  uniqueId: string;
  member: string;
  name: string;
}

/** An identity that the bootstrap stack exports. `requireOutput` fails a typo in every preview. */
function account(outputName: string): pulumi.Output<Account> {
  return bootstrap.requireOutput(outputName) as pulumi.Output<Account>;
}

export const deployRunner = account("deployRunner");
export const deployDev = account("deployDev");
export const gkeNodes = account("gkeNodes");

export const deployRunnerMember = deployRunner.member;
export const deployDevMember = deployDev.member;
export const gkeNodesMember = gkeNodes.member;
