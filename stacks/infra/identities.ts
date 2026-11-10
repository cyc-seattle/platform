import * as pulumi from "@pulumi/pulumi";

const bootstrap = new pulumi.StackReference(new pulumi.Config().require("bootstrapStack"));

export interface Account {
  email: string;
  uniqueId: string;
  member: string;
  name: string;
}

/**
 * Throws if a bootstrap identity isn't known. One unknown anywhere in bootstrap's outputs, left by a
 * `--target` or failed apply, makes them all unknown, and an unknown member reaches an update as
 * undefined, which replaces the IAM members that use it.
 */
export function knownAccount(outputName: string, value: Account | undefined): Account {
  if (value === undefined) {
    throw new Error(
      `The bootstrap stack's outputs aren't all known, so ${outputName} can't be read. Finish applying bootstrap first.`,
    );
  }
  return value;
}

/** An identity that the bootstrap stack exports. `requireOutputValue` fails a typo in every preview. */
function account(outputName: string): pulumi.Output<Account> {
  return pulumi.output(
    bootstrap.requireOutputValue(outputName).then((value: Account | undefined) => knownAccount(outputName, value)),
  );
}

export const deployRunner = account("deployRunner");
export const deployDev = account("deployDev");
export const gkeNodes = account("gkeNodes");

export const deployRunnerMember = deployRunner.member;
export const deployDevMember = deployDev.member;
export const gkeNodesMember = gkeNodes.member;
